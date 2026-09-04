import {
  categoryCycle,
  categoryHasChildren,
  categoryMaxDepthExceeded,
  categoryNameTaken,
  categoryNotFound,
  categoryParentNotActive,
  statusTransitionInvalid,
  versionConflict
} from "./itemErrors.js";
import { ItemAuditLogService } from "./ItemAuditLogService.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";

/**
 * Category（本檔案，Brand／UOM／Attribute 之後在同一個 class 上擴充）的
 * 查詢、新增、修改（含移動）、狀態變更、受控刪除。設計說明見
 * docs/items_management/design_spec.md §4.1、§5.3、§8.2。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與 RoleAdminService
 * 同一個理由。不用一個接收 table name 的 generic CRUD：Category、Brand、UOM
 * 的規則（樹狀結構、大小寫唯一、in-use 保護）不夠像，硬共用只會把每個方法都
 * 塞滿只對某一種資料成立的分支。
 *
 * `categoryMaxDepth` 由呼叫端注入（來自 config/item.js 正規化後的值），不在
 * constructor 內部 import config——依賴清楚列在建構參數上，測試才不用真的載入
 * 應用設定就能覆寫這個上限。
 */

function isDuplicateEntry(error) {
  return (error?.cause?.code || error?.code) === "ER_DUP_ENTRY";
}

export class ItemCatalogService {
  constructor({ database, logger, time, categoryMaxDepth } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("ItemCatalogService requires database, logger and time");
    }

    if (!Number.isInteger(categoryMaxDepth) || categoryMaxDepth < 1) {
      throw new TypeError("ItemCatalogService requires a positive integer categoryMaxDepth");
    }

    this.database = database;
    this.logger = logger;
    this.time = time;
    this.categoryMaxDepth = categoryMaxDepth;
    this.auditLog = new ItemAuditLogService({ database, logger, time });
  }

  // --- Category：查詢 -----------------------------------------------------

  /**
   * 整棵分類樹，一次 query 取所有列，在 service 組樹（design_spec.md §8.2）。
   * 預設不含 Archived（FR-DELETE-005：封存資料預設不在日常列表顯示）；
   * `includeArchived: true` 才連同封存的一起回。
   */
  async loadCategoryTree({ actorId, claimedRoles, claimedPermissions, includeArchived = false }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const rows = includeArchived
      ? await this.#allCategoryRows(this.database)
      : (await this.#allCategoryRows(this.database)).filter((row) => row.status !== "archived");

    return { items: this.#buildTree(rows) };
  }

  // --- Category：新增／修改 ------------------------------------------------

  async createCategory({
    actorId,
    claimedRoles,
    claimedPermissions,
    name,
    parentId = null,
    sortOrder = 0,
    requestId,
    ip
  }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const normalizedName = String(name ?? "").trim();
      const nowMs = this.time.nowMs();

      const categoryMap = await this.#categoryMapById(connection);

      if (parentId !== null && parentId !== undefined) {
        this.#assertParentUsable(categoryMap, parentId);

        const depth = this.#depthOf(categoryMap, parentId) + 1;
        if (depth > this.categoryMaxDepth) {
          throw categoryMaxDepthExceeded(this.categoryMaxDepth);
        }
      }

      let categoryId;
      try {
        const [result] = await connection.execute(
          `INSERT INTO item_categories
             (parent_id, name, sort_order, version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
          [parentId ?? null, normalizedName, sortOrder, nowMs, nowMs, actorId, actorId]
        );
        categoryId = result.insertId;
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw categoryNameTaken(normalizedName);
        }
        throw error;
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "category.create",
        targetType: "category",
        targetId: categoryId,
        targetLabel: normalizedName,
        detail: { name: normalizedName, parentId: parentId ?? null },
        requestId,
        ip
      });

      return this.#toSummary({
        id: categoryId,
        parent_id: parentId ?? null,
        name: normalizedName,
        status: "active",
        sort_order: sortOrder,
        version: 1,
        created_at: nowMs,
        updated_at: nowMs
      });
    });
  }

  /**
   * 改名稱／排序／移動父層，三者可以一次一起提交，整組 compare-and-set。
   * 「移動」是 parentId 與現有值不同的那一次呼叫；design_spec.md §6.4：
   * 「Category move 的 update body 帶 parentId 及 version；service 在同一
   * 交易鎖 target 和新 parent，檢查深度及 cycle」。
   */
  async updateCategory({
    actorId,
    claimedRoles,
    claimedPermissions,
    id,
    name,
    parentId,
    sortOrder,
    version,
    requestId,
    ip
  }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const categoryMap = await this.#categoryMapById(connection);
      const current = categoryMap.get(Number(id));

      if (!current) {
        throw categoryNotFound(id);
      }

      // 整組覆蓋，不是 PATCH：呼叫端提交它讀到的完整可編輯欄位（跟
      // RoleAdminService.update 同一個慣例），不接受「只給改了的欄位」——
      // 那種部分更新語意會讓「這個欄位是特意留白還是沒帶」永遠曖昧不清。
      const normalizedName = String(name ?? "").trim();
      const nextParentId = parentId ?? null;
      const nextSortOrder = sortOrder;
      const parentChanged = Number(nextParentId ?? 0) !== Number(current.parent_id ?? 0);

      if (parentChanged && nextParentId !== null) {
        this.#assertParentUsable(categoryMap, nextParentId);

        if (this.#isSelfOrDescendant(categoryMap, Number(id), Number(nextParentId))) {
          throw categoryCycle();
        }

        const newDepth = this.#depthOf(categoryMap, nextParentId) + 1;
        const subtreeHeight = this.#subtreeHeight(categoryMap, Number(id));
        if (newDepth + subtreeHeight > this.categoryMaxDepth) {
          throw categoryMaxDepthExceeded(this.categoryMaxDepth);
        }
      } else if (parentChanged) {
        // 移到根層級：depth 固定是 1，仍要確認子樹不會因此超過上限（子樹本身
        // 移到更淺的位置不可能超過，但保留檢查讓規則只有一個出口，不因為
        // 「根層級」這個特例而分岔出第二套判斷）。
        const subtreeHeight = this.#subtreeHeight(categoryMap, Number(id));
        if (1 + subtreeHeight > this.categoryMaxDepth) {
          throw categoryMaxDepthExceeded(this.categoryMaxDepth);
        }
      }

      const nowMs = this.time.nowMs();
      let result;
      try {
        [result] = await connection.execute(
          `UPDATE item_categories
              SET name = ?, parent_id = ?, sort_order = ?, updated_at = ?, updated_by = ?,
                  version = version + 1
            WHERE id = ? AND version = ?`,
          [normalizedName, nextParentId ?? null, nextSortOrder, nowMs, actorId, id, version]
        );
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw categoryNameTaken(normalizedName);
        }
        throw error;
      }

      if (result.affectedRows === 0) {
        // 上面讀到的 categoryMap 只是這次交易一開始的快照：id 存在不代表
        // 「現在」還存在——沒有 FOR UPDATE 鎖住它，這中間仍有極窄的窗讓另一
        // 個交易先刪掉它。affectedRows = 0 時重新查一次現況，NOT_FOUND 與
        // VERSION_CONFLICT 才分得準，而不是直接假設是版本問題。
        await this.#requireCategory(connection, id);
        throw versionConflict();
      }

      const detail = {};
      if (normalizedName !== current.name) {
        detail.name = { before: current.name, after: normalizedName };
      }
      if (parentChanged) {
        detail.parentId = { before: current.parent_id, after: nextParentId ?? null };
      }
      if (Number(nextSortOrder) !== Number(current.sort_order)) {
        detail.sortOrder = { before: current.sort_order, after: nextSortOrder };
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "category.update",
        targetType: "category",
        targetId: id,
        targetLabel: normalizedName,
        detail: Object.keys(detail).length > 0 ? detail : null,
        requestId,
        ip
      });

      return this.#toSummary({
        id: Number(id),
        parent_id: nextParentId ?? null,
        name: normalizedName,
        status: current.status,
        sort_order: nextSortOrder,
        version: version + 1,
        created_at: current.created_at,
        updated_at: nowMs
      });
    });
  }

  // --- Category：狀態變更 ---------------------------------------------------

  async activateCategory(options) {
    return this.#transitionCategoryStatus(options, {
      fromStatuses: ["inactive"],
      toStatus: "active",
      action: "category.status"
    });
  }

  async deactivateCategory(options) {
    return this.#transitionCategoryStatus(options, {
      fromStatuses: ["active"],
      toStatus: "inactive",
      action: "category.status"
    });
  }

  async archiveCategory(options) {
    return this.#transitionCategoryStatus(options, {
      fromStatuses: ["active", "inactive"],
      toStatus: "archived",
      action: "category.status"
    });
  }

  /** 只恢復到 Inactive，不自動回到 Active——跟 Item restore 是同一個決策方向。 */
  async restoreCategory(options) {
    return this.#transitionCategoryStatus(options, {
      fromStatuses: ["archived"],
      toStatus: "inactive",
      action: "category.status"
    });
  }

  // --- Category：受控刪除 ---------------------------------------------------

  /**
   * 永久刪除。子分類存在就拒絕（COUNT 查詢；`fk_item_categories_parent` 的
   * `ON DELETE RESTRICT` 是競態下的最後防線，見 0011_create_item_categories.js）。
   * 被 Item 引用的檢查等 items 表存在後才有意義：屆時 `items.category_id` 的
   * FK RESTRICT 會在資料庫層擋下，這裡不用先為一張還不存在的表寫檢查。
   */
  async deleteCategory({ actorId, claimedRoles, claimedPermissions, id, version, reason, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireCategory(connection, id);

      const [[{ childCount }]] = await connection.query(
        "SELECT COUNT(*) AS childCount FROM item_categories WHERE parent_id = ?",
        [id]
      );
      if (Number(childCount) > 0) {
        throw categoryHasChildren();
      }

      const [result] = await connection.execute(
        "DELETE FROM item_categories WHERE id = ? AND version = ?",
        [id, version]
      );

      if (result.affectedRows === 0) {
        // 同一支交易內、DELETE 之前才剛讀過一次，這裡不會是 NOT_FOUND；
        // 唯一站得住腳的解釋是版本已經被別人改過。
        throw versionConflict();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "category.delete",
        targetType: "category",
        targetId: id,
        targetLabel: current.name,
        reason,
        requestId,
        ip
      });

      return { id: Number(id) };
    });
  }

  // --- 內部：Category ------------------------------------------------------

  async #transitionCategoryStatus(
    { actorId, claimedRoles, claimedPermissions, id, version, reason, requestId, ip },
    { fromStatuses, toStatus, action }
  ) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireCategory(connection, id);
      const nowMs = this.time.nowMs();

      const placeholders = fromStatuses.map(() => "?").join(",");
      const [result] = await connection.execute(
        `UPDATE item_categories
            SET status = ?, updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ? AND status IN (${placeholders})`,
        [toStatus, nowMs, actorId, id, version, ...fromStatuses]
      );

      if (result.affectedRows === 0) {
        // id 存在（上面已確認），所以是版本不對或狀態不允許這個轉換其中一種。
        if (Number(current.version) !== Number(version)) {
          throw versionConflict();
        }
        throw statusTransitionInvalid(current.status, toStatus);
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action,
        targetType: "category",
        targetId: id,
        targetLabel: current.name,
        reason,
        detail: { status: { before: current.status, after: toStatus } },
        requestId,
        ip
      });

      return this.#toSummary({
        id: Number(id),
        parent_id: current.parent_id,
        name: current.name,
        status: toStatus,
        sort_order: current.sort_order,
        version: Number(version) + 1,
        created_at: current.created_at,
        updated_at: nowMs
      });
    });
  }

  async #requireCategory(connection, id) {
    const [rows] = await connection.query(
      `SELECT id, parent_id, name, status, sort_order, version, created_at, updated_at
         FROM item_categories WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      throw categoryNotFound(id);
    }

    return rows[0];
  }

  async #allCategoryRows(connection) {
    const [rows] = await connection.query(
      `SELECT id, parent_id, name, status, sort_order, version, created_at, updated_at
         FROM item_categories
        ORDER BY sort_order, name`
    );
    return rows;
  }

  /**
   * 一次載入全部分類（含 Archived——cycle／depth 檢查必須看到完整結構，
   * 不能因為某個祖先剛好是 Archived 就假裝它不存在），組成 `Map<id, row>`
   * 供本次交易內的驗證使用。分類量級是百到千，一次載入比逐層查詢單純，
   * 也不會是效能瓶頸。
   */
  async #categoryMapById(connection) {
    const rows = await this.#allCategoryRows(connection);
    return new Map(rows.map((row) => [Number(row.id), row]));
  }

  #assertParentUsable(categoryMap, parentId) {
    const parent = categoryMap.get(Number(parentId));
    if (!parent) {
      throw categoryNotFound(parentId);
    }
    if (parent.status !== "active") {
      throw categoryParentNotActive();
    }
  }

  /** 根層級（parent_id 為 null）depth 是 1。安全上限防止資料異常造成無窮迴圈。 */
  #depthOf(categoryMap, id) {
    let depth = 1;
    let current = categoryMap.get(Number(id));
    let guard = 0;

    while (current?.parent_id !== null && current?.parent_id !== undefined) {
      depth += 1;
      current = categoryMap.get(Number(current.parent_id));
      guard += 1;
      if (guard > categoryMap.size + 1) {
        break;
      }
    }

    return depth;
  }

  /** candidateId 是不是 targetId 自己，或 targetId 的子孫。 */
  #isSelfOrDescendant(categoryMap, targetId, candidateId) {
    if (candidateId === targetId) {
      return true;
    }

    let current = categoryMap.get(candidateId);
    let guard = 0;

    while (current?.parent_id !== null && current?.parent_id !== undefined) {
      if (Number(current.parent_id) === targetId) {
        return true;
      }
      current = categoryMap.get(Number(current.parent_id));
      guard += 1;
      if (guard > categoryMap.size + 1) {
        break;
      }
    }

    return false;
  }

  /** targetId 底下子孫的最大相對深度；沒有子孫是 0。 */
  #subtreeHeight(categoryMap, targetId) {
    const childrenByParent = new Map();
    for (const row of categoryMap.values()) {
      if (row.parent_id === null || row.parent_id === undefined) {
        continue;
      }
      const key = Number(row.parent_id);
      const list = childrenByParent.get(key) ?? [];
      list.push(Number(row.id));
      childrenByParent.set(key, list);
    }

    const visit = (id, guard) => {
      if (guard > categoryMap.size + 1) {
        return 0;
      }
      const children = childrenByParent.get(id) ?? [];
      if (children.length === 0) {
        return 0;
      }
      return 1 + Math.max(...children.map((childId) => visit(childId, guard + 1)));
    };

    return visit(targetId, 0);
  }

  #buildTree(rows) {
    const nodesById = new Map(
      rows.map((row) => [Number(row.id), { ...this.#toSummary(row), children: [] }])
    );
    const roots = [];

    for (const row of rows) {
      const node = nodesById.get(Number(row.id));
      const parentId = row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id);
      const parentNode = parentId === null ? null : nodesById.get(parentId);

      if (parentNode) {
        parentNode.children.push(node);
      } else {
        // 父層不在這次結果集裡——包括真正的根層級，以及「父層被篩掉了」
        // （例如父層是 Archived 而這次沒 includeArchived）——兩種都在畫面上
        // 當成頂層節點顯示，不憑空捏造一個不存在的父層。
        roots.push(node);
      }
    }

    return roots;
  }

  #toSummary(row) {
    return {
      id: Number(row.id),
      name: row.name,
      status: row.status,
      parentId: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
      sortOrder: Number(row.sort_order),
      version: Number(row.version),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }
}
