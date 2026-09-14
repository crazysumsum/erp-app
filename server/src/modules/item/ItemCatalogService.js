import {
  attributeCodeTaken,
  attributeInUse,
  attributeNotFound,
  attributeOptionInUse,
  attributeOptionNotFound,
  attributeOptionValueTaken,
  attributeValueInvalid,
  brandNameTaken,
  brandNotFound,
  catalogInUse,
  categoryAttributesStale,
  categoryCycle,
  categoryHasChildren,
  categoryMaxDepthExceeded,
  categoryNameTaken,
  categoryNotFound,
  categoryParentNotActive,
  statusTransitionInvalid,
  uomCodeTaken,
  uomNotFound,
  versionConflict
} from "./itemErrors.js";
import { CATALOG_LIST_SORT_FIELDS } from "./itemConstants.js";
import { ItemAuditLogService } from "./ItemAuditLogService.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";

/**
 * Category、Brand、UOM 的查詢、新增、修改、狀態變更、受控刪除。設計說明見
 * docs/items_management/design_spec.md §4.1、§5.3–§5.5、§8.2。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與 RoleAdminService
 * 同一個理由。不用一個接收 table name 的 generic CRUD：Category 的樹狀結構
 * （移動、cycle、深度）跟 Brand／UOM 的單純列表差太多，硬共用只會把每個方法
 * 都塞滿只對某一種資料成立的分支。Brand／UOM 之間的狀態轉換雖然幾乎一樣，
 * 但各自維持一份直接的實作，而不是抽出第三個只為了省幾行 SQL 的參數化
 * helper——那種 helper 需要的參數（table、欄位、summary 映射、錯誤 factory）
 * 加起來不會比三份直接寫的實作更好懂。
 *
 * `categoryMaxDepth` 由呼叫端注入（來自 config/item.js 正規化後的值），不在
 * constructor 內部 import config——依賴清楚列在建構參數上，測試才不用真的載入
 * 應用設定就能覆寫這個上限。
 */

function isDuplicateEntry(error) {
  return (error?.cause?.code || error?.code) === "ER_DUP_ENTRY";
}

/** FK RESTRICT 擋落嚟嘅刪除／改動——真正嘅 mysql2 error code 喺 `.cause`
 * 度，唔喺 error 本身（`MySqlDatabaseExecutor` 包裝，見 T23 對呢個現象嘅
 * 說明）。 */
function isRowReferenced(error) {
  return (error?.cause?.code || error?.code) === "ER_ROW_IS_REFERENCED_2";
}

/** `%`、`_`、`\` 是 LIKE 的萬用字元／跳脫字元，使用者輸入的字面值要先跳脫。
 * 與 UserAdminService 那份是同一個三行函式——見那個檔案對「這種規模的純函式
 * 重複一份，比為了它另開一個共用檔案划算」的說明。 */
function escapeLikeTerm(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const CATALOG_SORT_COLUMNS = Object.freeze({
  name: "name",
  status: "status",
  updatedAt: "updated_at"
});

function sortColumn(sortBy) {
  return CATALOG_LIST_SORT_FIELDS.includes(sortBy)
    ? CATALOG_SORT_COLUMNS[sortBy]
    : CATALOG_SORT_COLUMNS.name;
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
      let categoryMap = await this.#categoryMapById(connection);
      let current = categoryMap.get(Number(id));

      if (!current) {
        throw categoryNotFound(id);
      }

      // 整組覆蓋，不是 PATCH：呼叫端提交它讀到的完整可編輯欄位（跟
      // RoleAdminService.update 同一個慣例），不接受「只給改了的欄位」——
      // 那種部分更新語意會讓「這個欄位是特意留白還是沒帶」永遠曖昧不清。
      const normalizedName = String(name ?? "").trim();
      const nextParentId = parentId ?? null;
      const nextSortOrder = sortOrder;
      let parentChanged = Number(nextParentId ?? 0) !== Number(current.parent_id ?? 0);

      if (parentChanged) {
        // 「移動」才鎖整棵樹重讀一次：上面的 categoryMap 只是這次交易一開始
        // 的快照，若兩個並行請求各自把 A 移到 B 底下、把 B 移到 A 底下，各自
        // 憑自己那份舊快照都驗證得過（各自看到的 A、B 都還沒動），而兩句
        // UPDATE 又是改不同列、互不衝突，兩邊都會成功——結果就是資料庫裡真的
        // 出現一個環（A 的父層是 B，B 的父層是 A）。cycle／depth 檢查本來就要
        // 走訪任意長的祖先鏈與子孫子樹，只鎖 target 與新 parent 這兩列擋不住
        // 三個以上並行移動互相繞成環的情況，所以這裡鎖整棵樹——design_spec.md
        // §6.4：「service 在同一交易鎖 target 和新 parent，檢查深度及
        // cycle」，鎖整棵樹是達成同一個要求裡最簡單、不必再論證「哪幾列才夠」
        // 的做法，分類的量級（百到千）撐得住偶爾一次的整表鎖定。
        categoryMap = await this.#categoryMapByIdForUpdate(connection);
        const relocked = categoryMap.get(Number(id));
        if (!relocked) {
          throw categoryNotFound(id);
        }
        current = relocked;
        parentChanged = Number(nextParentId ?? 0) !== Number(current.parent_id ?? 0);
      }

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
        // 上面 #requireCategory 只是一次快照讀（沒有 FOR UPDATE），DELETE 檢查
        // 的卻是最新已提交的資料——中間這段窄窗仍然可能被別的交易先刪掉這一
        // 列。重新查一次，NOT_FOUND 與 VERSION_CONFLICT 才分得準，不能直接
        // 假設一定是版本問題（同 updateCategory 的處理方式）。
        await this.#requireCategory(connection, id);
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

  /**
   * 同 `#categoryMapById`，但加 `FOR UPDATE`：只有「移動」（parentId 真的
   * 改變）才需要，見 `updateCategory` 呼叫處的說明。
   */
  async #categoryMapByIdForUpdate(connection) {
    const [rows] = await connection.query(
      `SELECT id, parent_id, name, status, sort_order, version, created_at, updated_at
         FROM item_categories
        ORDER BY sort_order, name
          FOR UPDATE`
    );
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

  // --- Brand：查詢 ---------------------------------------------------------

  /** 分頁清單（design_spec.md §6.4：「Brand／Attribute 仍分頁」，跟不分頁的 Category／UOM 不同）。 */
  async listBrands({
    actorId,
    claimedRoles,
    claimedPermissions,
    page = 1,
    pageSize = 20,
    q = "",
    status,
    sortBy = "name",
    descending = false
  }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const term = String(q ?? "").trim();
    if (term) {
      conditions.push("name LIKE ?");
      params.push(`%${escapeLikeTerm(term)}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const direction = descending ? "DESC" : "ASC";
    const offset = (page - 1) * pageSize;

    const [totalRows] = await this.database.query(
      `SELECT COUNT(*) AS total FROM item_brands ${whereClause}`,
      params
    );
    const [rows] = await this.database.query(
      `SELECT id, name, official_name, description, status, version, created_at, updated_at
         FROM item_brands ${whereClause}
        ORDER BY ${sortColumn(sortBy)} ${direction}
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      items: rows.map((row) => this.#toBrandSummary(row)),
      total: Number(totalRows[0].total),
      page,
      pageSize
    };
  }

  // --- Brand：新增／修改 -----------------------------------------------------

  async createBrand({
    actorId,
    claimedRoles,
    claimedPermissions,
    name,
    officialName = "",
    description = "",
    requestId,
    ip
  }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const normalizedName = String(name ?? "").trim();
      const nowMs = this.time.nowMs();

      let brandId;
      try {
        const [result] = await connection.execute(
          `INSERT INTO item_brands
             (name, official_name, description, version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
          [normalizedName, officialName, description, nowMs, nowMs, actorId, actorId]
        );
        brandId = result.insertId;
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw brandNameTaken(normalizedName);
        }
        throw error;
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "brand.create",
        targetType: "brand",
        targetId: brandId,
        targetLabel: normalizedName,
        requestId,
        ip
      });

      return this.#toBrandSummary({
        id: brandId,
        name: normalizedName,
        official_name: officialName,
        description,
        status: "active",
        version: 1,
        created_at: nowMs,
        updated_at: nowMs
      });
    });
  }

  async updateBrand({
    actorId,
    claimedRoles,
    claimedPermissions,
    id,
    name,
    officialName,
    description,
    version,
    requestId,
    ip
  }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireBrand(connection, id);
      const normalizedName = String(name ?? "").trim();
      const nowMs = this.time.nowMs();

      let result;
      try {
        [result] = await connection.execute(
          `UPDATE item_brands
              SET name = ?, official_name = ?, description = ?, updated_at = ?, updated_by = ?,
                  version = version + 1
            WHERE id = ? AND version = ?`,
          [normalizedName, officialName ?? "", description ?? "", nowMs, actorId, id, version]
        );
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw brandNameTaken(normalizedName);
        }
        throw error;
      }

      if (result.affectedRows === 0) {
        await this.#requireBrand(connection, id);
        throw versionConflict();
      }

      const detail = {};
      if (normalizedName !== current.name) {
        detail.name = { before: current.name, after: normalizedName };
      }
      if ((officialName ?? "") !== current.official_name) {
        detail.officialName = { before: current.official_name, after: officialName ?? "" };
      }
      if ((description ?? "") !== current.description) {
        detail.description = { before: current.description, after: description ?? "" };
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "brand.update",
        targetType: "brand",
        targetId: id,
        targetLabel: normalizedName,
        detail: Object.keys(detail).length > 0 ? detail : null,
        requestId,
        ip
      });

      return this.#toBrandSummary({
        id: Number(id),
        name: normalizedName,
        official_name: officialName ?? "",
        description: description ?? "",
        status: current.status,
        version: version + 1,
        created_at: current.created_at,
        updated_at: nowMs
      });
    });
  }

  // --- Brand：狀態變更 -------------------------------------------------------

  async activateBrand(options) {
    return this.#transitionBrandStatus(options, { fromStatuses: ["inactive"], toStatus: "active" });
  }

  async deactivateBrand(options) {
    return this.#transitionBrandStatus(options, { fromStatuses: ["active"], toStatus: "inactive" });
  }

  async archiveBrand(options) {
    return this.#transitionBrandStatus(options, {
      fromStatuses: ["active", "inactive"],
      toStatus: "archived"
    });
  }

  /** 只恢復到 Inactive，跟 Category／Item 是同一個決策方向。 */
  async restoreBrand(options) {
    return this.#transitionBrandStatus(options, { fromStatuses: ["archived"], toStatus: "inactive" });
  }

  // --- Brand：受控刪除 -------------------------------------------------------

  /**
   * 永久刪除。目前沒有任何表引用 item_brands，所以這裡沒有 in-use 檢查；等
   * 第一個真引用（items.brand_id）出現時，那張表的 FK RESTRICT 會在資料庫層
   * 擋下，屆時再把對應的公開錯誤（`CATALOG_IN_USE`）接上，不用先為一張還不
   * 存在的表寫檢查（design_spec.md §8.4 的 reference guard 原則）。
   */
  async deleteBrand({ actorId, claimedRoles, claimedPermissions, id, version, reason, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireBrand(connection, id);

      const [result] = await connection.execute(
        "DELETE FROM item_brands WHERE id = ? AND version = ?",
        [id, version]
      );

      if (result.affectedRows === 0) {
        // #requireBrand 只是一次快照讀，DELETE 檢查的是最新已提交的資料——
        // 重新查一次才分得清 NOT_FOUND 與 VERSION_CONFLICT，不能直接假設一定
        // 是版本問題（同 updateBrand 的處理方式）。
        await this.#requireBrand(connection, id);
        throw versionConflict();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "brand.delete",
        targetType: "brand",
        targetId: id,
        targetLabel: current.name,
        reason,
        requestId,
        ip
      });

      return { id: Number(id) };
    });
  }

  // --- 內部：Brand ---------------------------------------------------------

  async #transitionBrandStatus(
    { actorId, claimedRoles, claimedPermissions, id, version, reason, requestId, ip },
    { fromStatuses, toStatus }
  ) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireBrand(connection, id);
      const nowMs = this.time.nowMs();

      const placeholders = fromStatuses.map(() => "?").join(",");
      const [result] = await connection.execute(
        `UPDATE item_brands
            SET status = ?, updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ? AND status IN (${placeholders})`,
        [toStatus, nowMs, actorId, id, version, ...fromStatuses]
      );

      if (result.affectedRows === 0) {
        if (Number(current.version) !== Number(version)) {
          throw versionConflict();
        }
        throw statusTransitionInvalid(current.status, toStatus);
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "brand.status",
        targetType: "brand",
        targetId: id,
        targetLabel: current.name,
        reason,
        detail: { status: { before: current.status, after: toStatus } },
        requestId,
        ip
      });

      return this.#toBrandSummary({
        id: Number(id),
        name: current.name,
        official_name: current.official_name,
        description: current.description,
        status: toStatus,
        version: Number(version) + 1,
        created_at: current.created_at,
        updated_at: nowMs
      });
    });
  }

  async #requireBrand(connection, id) {
    const [rows] = await connection.query(
      `SELECT id, name, official_name, description, status, version, created_at, updated_at
         FROM item_brands WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      throw brandNotFound(id);
    }

    return rows[0];
  }

  #toBrandSummary(row) {
    return {
      id: Number(row.id),
      name: row.name,
      officialName: row.official_name,
      description: row.description,
      status: row.status,
      version: Number(row.version),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  // --- UOM：查詢 -------------------------------------------------------------

  /** 不分頁的小目錄，跟 RoleAdminService.list() 同一個理由：量級是十到百位數。 */
  async listUoms({ actorId, claimedRoles, claimedPermissions, includeArchived = false }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const whereClause = includeArchived ? "" : "WHERE status != 'archived'";
    const [rows] = await this.database.query(
      `SELECT id, code, name, symbol, status, version, created_at, updated_at
         FROM item_uoms ${whereClause}
        ORDER BY name`
    );

    return { items: rows.map((row) => this.#toUomSummary(row)) };
  }

  // --- UOM：新增／修改 ---------------------------------------------------------

  async createUom({ actorId, claimedRoles, claimedPermissions, code, name, symbol = "", requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const normalizedCode = String(code ?? "").trim();
      const normalizedName = String(name ?? "").trim();
      const nowMs = this.time.nowMs();

      let uomId;
      try {
        const [result] = await connection.execute(
          `INSERT INTO item_uoms
             (code, name, symbol, version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
          [normalizedCode, normalizedName, symbol, nowMs, nowMs, actorId, actorId]
        );
        uomId = result.insertId;
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw uomCodeTaken(normalizedCode);
        }
        throw error;
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "uom.create",
        targetType: "uom",
        targetId: uomId,
        targetLabel: normalizedCode,
        requestId,
        ip
      });

      return this.#toUomSummary({
        id: uomId,
        code: normalizedCode,
        name: normalizedName,
        symbol,
        status: "active",
        version: 1,
        created_at: nowMs,
        updated_at: nowMs
      });
    });
  }

  /**
   * 改名稱／符號。`code` 刻意不接受修改：它是 SKU UOM／barcode 未來拿來引用
   * 的穩定代碼，跟 SKU Code 同一個道理（識別與描述分離，design_spec.md
   * 核心原則 3）。要換代碼就封存舊的、建一個新的。
   */
  async updateUom({ actorId, claimedRoles, claimedPermissions, id, name, symbol, version, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireUom(connection, id);
      const normalizedName = String(name ?? "").trim();
      const nowMs = this.time.nowMs();

      const [result] = await connection.execute(
        `UPDATE item_uoms
            SET name = ?, symbol = ?, updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ?`,
        [normalizedName, symbol ?? "", nowMs, actorId, id, version]
      );

      if (result.affectedRows === 0) {
        await this.#requireUom(connection, id);
        throw versionConflict();
      }

      const detail = {};
      if (normalizedName !== current.name) {
        detail.name = { before: current.name, after: normalizedName };
      }
      if ((symbol ?? "") !== current.symbol) {
        detail.symbol = { before: current.symbol, after: symbol ?? "" };
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "uom.update",
        targetType: "uom",
        targetId: id,
        targetLabel: current.code,
        detail: Object.keys(detail).length > 0 ? detail : null,
        requestId,
        ip
      });

      return this.#toUomSummary({
        id: Number(id),
        code: current.code,
        name: normalizedName,
        symbol: symbol ?? "",
        status: current.status,
        version: version + 1,
        created_at: current.created_at,
        updated_at: nowMs
      });
    });
  }

  // --- UOM：狀態變更 -----------------------------------------------------------

  async activateUom(options) {
    return this.#transitionUomStatus(options, { fromStatuses: ["inactive"], toStatus: "active" });
  }

  async deactivateUom(options) {
    return this.#transitionUomStatus(options, { fromStatuses: ["active"], toStatus: "inactive" });
  }

  async archiveUom(options) {
    return this.#transitionUomStatus(options, {
      fromStatuses: ["active", "inactive"],
      toStatus: "archived"
    });
  }

  async restoreUom(options) {
    return this.#transitionUomStatus(options, { fromStatuses: ["archived"], toStatus: "inactive" });
  }

  // --- UOM：受控刪除 -----------------------------------------------------------

  /**
   * 永久刪除。跟 deleteBrand 同一個理由：目前沒有 item_sku_uoms／
   * item_sku_barcodes／net_content 等表存在，in-use 檢查等那些表出現時再
   * 接上對應的 FK 與 `CATALOG_IN_USE` 錯誤。
   */
  async deleteUom({ actorId, claimedRoles, claimedPermissions, id, version, reason, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireUom(connection, id);

      const [result] = await connection.execute(
        "DELETE FROM item_uoms WHERE id = ? AND version = ?",
        [id, version]
      );

      if (result.affectedRows === 0) {
        // #requireUom 只是一次快照讀，DELETE 檢查的是最新已提交的資料——
        // 重新查一次才分得清 NOT_FOUND 與 VERSION_CONFLICT，不能直接假設一定
        // 是版本問題（同 updateUom 的處理方式）。
        await this.#requireUom(connection, id);
        throw versionConflict();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "uom.delete",
        targetType: "uom",
        targetId: id,
        targetLabel: current.code,
        reason,
        requestId,
        ip
      });

      return { id: Number(id) };
    });
  }

  // --- 內部：UOM ---------------------------------------------------------------

  async #transitionUomStatus(
    { actorId, claimedRoles, claimedPermissions, id, version, reason, requestId, ip },
    { fromStatuses, toStatus }
  ) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireUom(connection, id);
      const nowMs = this.time.nowMs();

      const placeholders = fromStatuses.map(() => "?").join(",");
      const [result] = await connection.execute(
        `UPDATE item_uoms
            SET status = ?, updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ? AND status IN (${placeholders})`,
        [toStatus, nowMs, actorId, id, version, ...fromStatuses]
      );

      if (result.affectedRows === 0) {
        if (Number(current.version) !== Number(version)) {
          throw versionConflict();
        }
        throw statusTransitionInvalid(current.status, toStatus);
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "uom.status",
        targetType: "uom",
        targetId: id,
        targetLabel: current.code,
        reason,
        detail: { status: { before: current.status, after: toStatus } },
        requestId,
        ip
      });

      return this.#toUomSummary({
        id: Number(id),
        code: current.code,
        name: current.name,
        symbol: current.symbol,
        status: toStatus,
        version: Number(version) + 1,
        created_at: current.created_at,
        updated_at: nowMs
      });
    });
  }

  async #requireUom(connection, id) {
    const [rows] = await connection.query(
      `SELECT id, code, name, symbol, status, version, created_at, updated_at
         FROM item_uoms WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      throw uomNotFound(id);
    }

    return rows[0];
  }

  #toUomSummary(row) {
    return {
      id: Number(row.id),
      code: row.code,
      name: row.name,
      symbol: row.symbol,
      status: row.status,
      version: Number(row.version),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  // --- Attribute：查詢 ---------------------------------------------------------

  /** 分頁清單，同 Brand 一樣（design_spec.md §6.4）。每個 row 連同其 option 集合
   * 一次帶出——Attribute 建立後即需要 option 才有意義（single_option 型別），
   * 拆成逐個 attribute 再查一次 option 只會多一輪 round trip，冇實際好處。 */
  async listAttributes({
    actorId,
    claimedRoles,
    claimedPermissions,
    page = 1,
    pageSize = 20,
    q = "",
    status,
    dataType,
    sortBy = "name",
    descending = false
  }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (dataType) {
      conditions.push("data_type = ?");
      params.push(dataType);
    }

    const term = String(q ?? "").trim();
    if (term) {
      conditions.push("(name LIKE ? OR code LIKE ?)");
      const escaped = `%${escapeLikeTerm(term)}%`;
      params.push(escaped, escaped);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const direction = descending ? "DESC" : "ASC";
    const offset = (page - 1) * pageSize;

    const [totalRows] = await this.database.query(
      `SELECT COUNT(*) AS total FROM item_attribute_definitions ${whereClause}`,
      params
    );
    const [rows] = await this.database.query(
      `SELECT id, code, name, data_type, uom_id, is_variant, is_filterable, status, version, created_at, updated_at
         FROM item_attribute_definitions ${whereClause}
        ORDER BY ${sortColumn(sortBy)} ${direction}
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const attributeIds = rows.map((row) => Number(row.id));
    const optionsByAttribute = new Map(attributeIds.map((id) => [id, []]));
    if (attributeIds.length > 0) {
      const placeholders = attributeIds.map(() => "?").join(",");
      const [optionRows] = await this.database.query(
        `SELECT id, attribute_id, value, label, sort_order, status
           FROM item_attribute_options
          WHERE attribute_id IN (${placeholders})
          ORDER BY attribute_id, sort_order, id`,
        attributeIds
      );
      for (const row of optionRows) {
        optionsByAttribute.get(Number(row.attribute_id)).push(row);
      }
    }

    return {
      items: rows.map((row) => this.#toAttributeSummary(row, optionsByAttribute.get(Number(row.id)) ?? [])),
      total: Number(totalRows[0].total),
      page,
      pageSize
    };
  }

  // --- Attribute：新增／修改 ---------------------------------------------------

  async createAttribute({
    actorId,
    claimedRoles,
    claimedPermissions,
    code,
    name,
    dataType,
    uomId = null,
    isVariant = false,
    isFilterable = false,
    options = [],
    requestId,
    ip
  }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const normalizedCode = String(code ?? "").trim();
      const normalizedName = String(name ?? "").trim();

      this.#assertOptionsShapeValid(dataType, options);

      if (uomId !== null && uomId !== undefined) {
        if (dataType !== "decimal") {
          throw attributeValueInvalid("uomId 只適用於 decimal 型別屬性");
        }
        await this.#requireUom(connection, uomId);
      }

      const nowMs = this.time.nowMs();

      let attributeId;
      try {
        const [result] = await connection.execute(
          `INSERT INTO item_attribute_definitions
             (code, name, data_type, uom_id, is_variant, is_filterable, status, version,
              created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
          [
            normalizedCode,
            normalizedName,
            dataType,
            uomId ?? null,
            isVariant ? 1 : 0,
            isFilterable ? 1 : 0,
            nowMs,
            nowMs,
            actorId,
            actorId
          ]
        );
        attributeId = result.insertId;
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw attributeCodeTaken(normalizedCode);
        }
        throw error;
      }

      for (const option of options) {
        const normalizedValue = String(option.value ?? "").trim();
        const normalizedLabel = String(option.label ?? "").trim();
        try {
          await connection.execute(
            `INSERT INTO item_attribute_options
               (attribute_id, value, label, sort_order, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
            [attributeId, normalizedValue, normalizedLabel, option.sortOrder ?? 0, nowMs, nowMs, actorId, actorId]
          );
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw attributeOptionValueTaken(normalizedValue);
          }
          throw error;
        }
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "attribute.create",
        targetType: "attribute",
        targetId: attributeId,
        targetLabel: normalizedCode,
        detail: {
          name: normalizedName,
          dataType,
          isVariant: !!isVariant,
          isFilterable: !!isFilterable,
          optionCount: options.length
        },
        requestId,
        ip
      });

      const optionRows = await this.#attributeOptions(connection, attributeId);
      return this.#toAttributeSummary(
        {
          id: attributeId,
          code: normalizedCode,
          name: normalizedName,
          data_type: dataType,
          uom_id: uomId ?? null,
          is_variant: isVariant ? 1 : 0,
          is_filterable: isFilterable ? 1 : 0,
          status: "active",
          version: 1,
          created_at: nowMs,
          updated_at: nowMs
        },
        optionRows
      );
    });
  }

  /**
   * 原子覆蓋 option 集合（design_spec.md §6.4：「Attribute update 原子覆蓋
   * option 集合」）。`code`／`dataType` 不接受修改（同 UOM code 一樣「建立後
   * 不可改」）；`isVariant` 喺呢個屬性已經有 `item_sku_attribute_values` 用緊
   * 之後鎖死，唔喺呢度先重新開放。
   *
   * Option 唔係刪晒重插（同 updateSku 嘅 UOM／barcode 唔一樣）：option 的 id
   * 可能已被 `item_attribute_values`／`item_sku_attribute_values` 的
   * `option_id` FK RESTRICT 指住，刪一個仲用緊嘅 option 會俾資料庫擋——帶
   * `id` 嘅 option 係「保留呢一行、改佢嘅內容」，唔帶 `id` 先係新增，原本存在
   * 但今次冇再出現嘅先刪除。
   */
  async updateAttribute({
    actorId,
    claimedRoles,
    claimedPermissions,
    id,
    name,
    uomId = null,
    isVariant,
    isFilterable,
    options = [],
    version,
    requestId,
    ip
  }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireAttribute(connection, id);
      const currentOptions = await this.#attributeOptions(connection, id);
      const normalizedName = String(name ?? "").trim();

      this.#assertOptionsShapeValid(current.data_type, options);

      if (uomId !== null && uomId !== undefined) {
        if (current.data_type !== "decimal") {
          throw attributeValueInvalid("uomId 只適用於 decimal 型別屬性");
        }
        await this.#requireUom(connection, uomId);
      }

      const nextIsVariant = !!isVariant;
      if (nextIsVariant !== !!current.is_variant) {
        const [[usage]] = await connection.query(
          "SELECT 1 AS used FROM item_sku_attribute_values WHERE attribute_id = ? LIMIT 1",
          [id]
        );
        if (usage) {
          throw attributeInUse();
        }
      }

      const nowMs = this.time.nowMs();
      const [result] = await connection.execute(
        `UPDATE item_attribute_definitions
            SET name = ?, uom_id = ?, is_variant = ?, is_filterable = ?, updated_at = ?, updated_by = ?,
                version = version + 1
          WHERE id = ? AND version = ?`,
        [normalizedName, uomId ?? null, nextIsVariant ? 1 : 0, isFilterable ? 1 : 0, nowMs, actorId, id, version]
      );

      if (result.affectedRows === 0) {
        await this.#requireAttribute(connection, id);
        throw versionConflict();
      }

      const currentById = new Map(currentOptions.map((row) => [Number(row.id), row]));
      const withId = options.filter((option) => option.id !== undefined && option.id !== null);
      const withoutId = options.filter((option) => option.id === undefined || option.id === null);

      for (const option of withId) {
        if (!currentById.has(Number(option.id))) {
          throw attributeOptionNotFound(option.id);
        }
      }

      const keepIds = new Set(withId.map((option) => Number(option.id)));
      const toDelete = currentOptions.filter((row) => !keepIds.has(Number(row.id)));

      for (const row of toDelete) {
        try {
          await connection.execute("DELETE FROM item_attribute_options WHERE id = ?", [row.id]);
        } catch (error) {
          if (isRowReferenced(error)) {
            throw attributeOptionInUse(row.value);
          }
          throw error;
        }
      }

      for (const option of withId) {
        const normalizedValue = String(option.value ?? "").trim();
        const normalizedLabel = String(option.label ?? "").trim();
        try {
          await connection.execute(
            `UPDATE item_attribute_options
                SET value = ?, label = ?, sort_order = ?, status = ?, updated_at = ?, updated_by = ?,
                    version = version + 1
              WHERE id = ?`,
            [
              normalizedValue,
              normalizedLabel,
              option.sortOrder ?? 0,
              option.status ?? "active",
              nowMs,
              actorId,
              option.id
            ]
          );
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw attributeOptionValueTaken(normalizedValue);
          }
          throw error;
        }
      }

      for (const option of withoutId) {
        const normalizedValue = String(option.value ?? "").trim();
        const normalizedLabel = String(option.label ?? "").trim();
        try {
          await connection.execute(
            `INSERT INTO item_attribute_options
               (attribute_id, value, label, sort_order, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
            [
              id,
              normalizedValue,
              normalizedLabel,
              option.sortOrder ?? 0,
              option.status ?? "active",
              nowMs,
              nowMs,
              actorId,
              actorId
            ]
          );
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw attributeOptionValueTaken(normalizedValue);
          }
          throw error;
        }
      }

      const detail = { optionCount: options.length };
      if (normalizedName !== current.name) {
        detail.name = { before: current.name, after: normalizedName };
      }
      const currentUomId = current.uom_id === null || current.uom_id === undefined ? null : Number(current.uom_id);
      if ((uomId ?? null) !== currentUomId) {
        detail.uomId = { before: currentUomId, after: uomId ?? null };
      }
      if (nextIsVariant !== !!current.is_variant) {
        detail.isVariant = { before: !!current.is_variant, after: nextIsVariant };
      }
      if (!!isFilterable !== !!current.is_filterable) {
        detail.isFilterable = { before: !!current.is_filterable, after: !!isFilterable };
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "attribute.update",
        targetType: "attribute",
        targetId: id,
        targetLabel: current.code,
        detail,
        requestId,
        ip
      });

      const optionRows = await this.#attributeOptions(connection, id);
      return this.#toAttributeSummary(
        {
          id: Number(id),
          code: current.code,
          name: normalizedName,
          data_type: current.data_type,
          uom_id: uomId ?? null,
          is_variant: nextIsVariant ? 1 : 0,
          is_filterable: isFilterable ? 1 : 0,
          status: current.status,
          version: Number(version) + 1,
          created_at: current.created_at,
          updated_at: nowMs
        },
        optionRows
      );
    });
  }

  // --- Attribute：狀態變更 -----------------------------------------------------

  async activateAttribute(options) {
    return this.#transitionAttributeStatus(options, { fromStatuses: ["inactive"], toStatus: "active" });
  }

  async deactivateAttribute(options) {
    return this.#transitionAttributeStatus(options, { fromStatuses: ["active"], toStatus: "inactive" });
  }

  async archiveAttribute(options) {
    return this.#transitionAttributeStatus(options, {
      fromStatuses: ["active", "inactive"],
      toStatus: "archived"
    });
  }

  async restoreAttribute(options) {
    return this.#transitionAttributeStatus(options, { fromStatuses: ["archived"], toStatus: "inactive" });
  }

  // --- Attribute：受控刪除 -----------------------------------------------------

  /**
   * 永久刪除。`item_category_attributes`／`item_attribute_values`／
   * `item_sku_attribute_values` 三張表都對 `attribute_id` 設 FK RESTRICT
   * （見 0020–0022 migration），呢三張表喺呢個 task 已經真實存在（唔似
   * deleteBrand／deleteUom 嗰陣，被引用嗰張表仲未建立），所以呢度直接接住
   * FK RESTRICT 轉做公開錯誤，唔留返俾之後先補。
   */
  async deleteAttribute({ actorId, claimedRoles, claimedPermissions, id, version, reason, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireAttribute(connection, id);

      let result;
      try {
        [result] = await connection.execute(
          "DELETE FROM item_attribute_definitions WHERE id = ? AND version = ?",
          [id, version]
        );
      } catch (error) {
        if (isRowReferenced(error)) {
          throw catalogInUse(["category_rules_or_values"]);
        }
        throw error;
      }

      if (result.affectedRows === 0) {
        await this.#requireAttribute(connection, id);
        throw versionConflict();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "attribute.delete",
        targetType: "attribute",
        targetId: id,
        targetLabel: current.code,
        reason,
        requestId,
        ip
      });

      return { id: Number(id) };
    });
  }

  // --- Category attribute assignment ------------------------------------------

  /** 目前指派俾呢個 category 嘅 attribute 規則，俾前端讀出嚟組
   * `expectedAttributeIds`（design_spec.md §6.4）。 */
  async getCategoryAttributes({ actorId, claimedRoles, claimedPermissions, categoryId }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });
    await this.#requireCategory(this.database, categoryId);
    const rows = await this.#categoryAttributeRows(this.database, categoryId);

    return {
      categoryId: Number(categoryId),
      assignments: rows.map((row) => this.#toCategoryAttributeAssignment(row))
    };
  }

  /**
   * 原子覆蓋一個 category 嘅 attribute 規則集合（design_spec.md §8.2：
   * 「鎖現況、比較 expected IDs、原子覆蓋 mapping」）。`item_category_attributes`
   * 冇逐行 version（0020 migration 的說明：規則透過成組覆蓋管理，唔係逐行改），
   * 所以 compare-and-set 用嘅係成組 attribute id（`expectedAttributeIds`）
   * 同資料庫現況比對，唔一致就拒絕覆蓋。
   */
  async assignAttributes({
    actorId,
    claimedRoles,
    claimedPermissions,
    categoryId,
    assignments = [],
    expectedAttributeIds = [],
    requestId,
    ip
  }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const category = await this.#requireCategory(connection, categoryId);

      const currentRows = await this.#categoryAttributeRows(connection, categoryId);
      const currentIds = new Set(currentRows.map((row) => Number(row.attribute_id)));
      const expectedIds = new Set((expectedAttributeIds ?? []).map(Number));
      const sameSize = currentIds.size === expectedIds.size;
      const matches = sameSize && [...currentIds].every((attributeId) => expectedIds.has(attributeId));
      if (!matches) {
        throw categoryAttributesStale();
      }

      const attributeIds = assignments.map((assignment) => Number(assignment.attributeId));
      if (new Set(attributeIds).size !== attributeIds.length) {
        throw attributeValueInvalid("同一個屬性不可以在同一個分類重複指派");
      }
      const nextById = new Map(
        assignments.map((assignment) => [
          Number(assignment.attributeId),
          {
            attributeId: Number(assignment.attributeId),
            requiredForActivation: !!assignment.requiredForActivation,
            sortOrder: Number(assignment.sortOrder ?? 0)
          }
        ])
      );
      for (const attributeId of new Set(attributeIds)) {
        await this.#requireAttribute(connection, attributeId);
      }

      const currentById = new Map(
        currentRows.map((row) => {
          const assignment = this.#toCategoryAttributeAssignment(row);
          return [assignment.attributeId, assignment];
        })
      );
      const nowMs = this.time.nowMs();
      const toDelete = [...currentIds].filter((attributeId) => !nextById.has(attributeId));
      const toInsert = [...nextById.keys()].filter((attributeId) => !currentIds.has(attributeId));
      const toUpdate = [...nextById.keys()].filter((attributeId) => {
        const current = currentById.get(attributeId);
        const next = nextById.get(attributeId);
        return current && (current.requiredForActivation !== next.requiredForActivation || current.sortOrder !== next.sortOrder);
      });

      if (toDelete.length > 0) {
        const placeholders = toDelete.map(() => "?").join(",");
        await connection.execute(
          `DELETE FROM item_category_attributes WHERE category_id = ? AND attribute_id IN (${placeholders})`,
          [categoryId, ...toDelete]
        );
      }

      for (const attributeId of toInsert) {
        const assignment = nextById.get(attributeId);
        await connection.execute(
          `INSERT INTO item_category_attributes
             (category_id, attribute_id, required_for_activation, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [categoryId, attributeId, assignment.requiredForActivation ? 1 : 0, assignment.sortOrder ?? 0, nowMs, nowMs]
        );
      }

      for (const attributeId of toUpdate) {
        const assignment = nextById.get(attributeId);
        await connection.execute(
          `UPDATE item_category_attributes
              SET required_for_activation = ?, sort_order = ?, updated_at = ?
            WHERE category_id = ? AND attribute_id = ?`,
          [assignment.requiredForActivation ? 1 : 0, assignment.sortOrder ?? 0, nowMs, categoryId, attributeId]
        );
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "category.attributes.assign",
        targetType: "category",
        targetId: categoryId,
        targetLabel: category.name,
        detail: {
          added: toInsert.map((attributeId) => nextById.get(attributeId)),
          removed: toDelete.map((attributeId) => currentById.get(attributeId)),
          updated: toUpdate.map((attributeId) => ({
            before: currentById.get(attributeId),
            after: nextById.get(attributeId)
          }))
        },
        requestId,
        ip
      });

      const rows = await this.#categoryAttributeRows(connection, categoryId);
      return {
        categoryId: Number(categoryId),
        assignments: rows.map((row) => this.#toCategoryAttributeAssignment(row))
      };
    });
  }

  // --- 內部：Attribute -----------------------------------------------------

  async #transitionAttributeStatus(
    { actorId, claimedRoles, claimedPermissions, id, version, reason, requestId, ip },
    { fromStatuses, toStatus }
  ) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireAttribute(connection, id);
      const nowMs = this.time.nowMs();

      const placeholders = fromStatuses.map(() => "?").join(",");
      const [result] = await connection.execute(
        `UPDATE item_attribute_definitions
            SET status = ?, updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ? AND status IN (${placeholders})`,
        [toStatus, nowMs, actorId, id, version, ...fromStatuses]
      );

      if (result.affectedRows === 0) {
        if (Number(current.version) !== Number(version)) {
          throw versionConflict();
        }
        throw statusTransitionInvalid(current.status, toStatus);
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "attribute.status",
        targetType: "attribute",
        targetId: id,
        targetLabel: current.code,
        reason,
        detail: { status: { before: current.status, after: toStatus } },
        requestId,
        ip
      });

      const optionRows = await this.#attributeOptions(connection, id);
      return this.#toAttributeSummary(
        {
          id: Number(id),
          code: current.code,
          name: current.name,
          data_type: current.data_type,
          uom_id: current.uom_id,
          is_variant: current.is_variant,
          is_filterable: current.is_filterable,
          status: toStatus,
          version: Number(version) + 1,
          created_at: current.created_at,
          updated_at: nowMs
        },
        optionRows
      );
    });
  }

  #assertOptionsShapeValid(dataType, options) {
    if (dataType !== "single_option") {
      if (options.length > 0) {
        throw attributeValueInvalid("只有 single_option 型別的屬性可以有選項");
      }
      return;
    }

    if (options.length === 0) {
      throw attributeValueInvalid("single_option 型別的屬性至少要有一個選項");
    }

    const seen = new Set();
    for (const option of options) {
      const value = String(option.value ?? "").trim();
      if (seen.has(value)) {
        throw attributeOptionValueTaken(value);
      }
      seen.add(value);
    }
  }

  async #requireAttribute(connection, id) {
    const [rows] = await connection.query(
      `SELECT id, code, name, data_type, uom_id, is_variant, is_filterable, status, version, created_at, updated_at
         FROM item_attribute_definitions WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      throw attributeNotFound(id);
    }

    return rows[0];
  }

  async #attributeOptions(connection, attributeId) {
    const [rows] = await connection.query(
      `SELECT id, value, label, sort_order, status
         FROM item_attribute_options
        WHERE attribute_id = ?
        ORDER BY sort_order, id`,
      [attributeId]
    );
    return rows;
  }

  async #categoryAttributeRows(connection, categoryId) {
    const [rows] = await connection.query(
      `SELECT attribute_id, required_for_activation, sort_order
         FROM item_category_attributes
        WHERE category_id = ?
        ORDER BY sort_order, attribute_id`,
      [categoryId]
    );
    return rows;
  }

  #toCategoryAttributeAssignment(row) {
    return {
      attributeId: Number(row.attribute_id),
      requiredForActivation: !!row.required_for_activation,
      sortOrder: Number(row.sort_order)
    };
  }

  #toAttributeSummary(row, optionRows = []) {
    return {
      id: Number(row.id),
      code: row.code,
      name: row.name,
      dataType: row.data_type,
      uomId: row.uom_id === null || row.uom_id === undefined ? null : Number(row.uom_id),
      isVariant: !!row.is_variant,
      isFilterable: !!row.is_filterable,
      status: row.status,
      version: Number(row.version),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      options: optionRows.map((option) => this.#toOptionSummary(option))
    };
  }

  #toOptionSummary(row) {
    return {
      id: Number(row.id),
      value: row.value,
      label: row.label,
      sortOrder: Number(row.sort_order),
      status: row.status
    };
  }
}
