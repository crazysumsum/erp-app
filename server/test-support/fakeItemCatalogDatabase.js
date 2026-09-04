/**
 * Category catalog 的關聯式記憶體替身，供 itemCatalogService.test.js 與
 * itemCatalogHandlers.test.js 共用。理由與 roleAdminService.test.js 的同名
 * 私有 helper 一樣：這支 service 的正確性建立在好幾句 SQL 對同一份資料的結果
 * 彼此一致上（cycle／depth 檢查要看到完整樹，compare-and-set 要看到同一份
 * version）。
 *
 * SQL 語法（generated column、collation、FK delete rule）不是這裡的責任，交給
 * migrations.integration.test.js 對真 MySQL 驗證。
 */

export const ADMIN_ACTOR = Object.freeze({
  actorId: 10,
  claimedRoles: ["system-admin"],
  claimedPermissions: ["item.view", "item.mgmt"]
});

export function createFakeItemCatalogDatabase({
  users = [{ id: 10, username: "admin", status: "active" }],
  categories = [],
  // 這個假資料庫不建模真正的角色／權限表；assertActorFresh 會拿使用者現在的
  // 角色／權限跟 token 的 claims 比對（見 adminGuard.assertPermissionsCurrent），
  // 兩邊要完全相等測試才通得過，所以這裡讓查詢直接照 ADMIN_ACTOR 的 claims
  // 回覆，等於「這個使用者現在真的持有這些角色／權限」。
  currentRoles = ADMIN_ACTOR.claimedRoles,
  currentPermissions = ADMIN_ACTOR.claimedPermissions
} = {}) {
  const state = {
    users: new Map(users.map((u) => [u.id, { ...u }])),
    categories: new Map(categories.map((c) => [c.id, { ...c }])),
    auditRows: [],
    nextCategoryId: categories.reduce((max, c) => Math.max(max, c.id), 0) + 1
  };

  function scopeKey(parentId, name) {
    return `${parentId ?? 0}::${String(name).toLowerCase()}`;
  }

  function nameCollides(parentId, name, excludeId) {
    return [...state.categories.values()].some(
      (row) =>
        row.id !== excludeId &&
        scopeKey(row.parent_id, row.name) === scopeKey(parentId, name)
    );
  }

  async function run(sql, params = []) {
    if (sql.includes("SELECT username FROM users WHERE id = ? AND status = 'active'")) {
      const user = state.users.get(params[0]);
      return [user && user.status === "active" ? [{ username: user.username }] : []];
    }

    if (sql.includes("FROM roles r JOIN user_roles ur")) {
      return [currentRoles.map((name) => ({ name }))];
    }

    if (sql.includes("JOIN user_roles ur ON ur.role_id = rp.role_id")) {
      return [currentPermissions.map((name) => ({ name }))];
    }

    if (
      sql.includes("SELECT id, parent_id, name, status, sort_order, version, created_at, updated_at") &&
      sql.includes("FROM item_categories WHERE id = ?")
    ) {
      const row = state.categories.get(params[0]);
      return [row ? [{ ...row }] : []];
    }

    if (
      sql.includes("SELECT id, parent_id, name, status, sort_order, version, created_at, updated_at") &&
      sql.includes("FROM item_categories") &&
      sql.includes("ORDER BY sort_order, name")
    ) {
      const rows = [...state.categories.values()]
        .map((row) => ({ ...row }))
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      return [rows];
    }

    if (sql.includes("INSERT INTO item_categories")) {
      const [parentId, name, sortOrder, createdAt, updatedAt, createdBy, updatedBy] = params;

      if (nameCollides(parentId, name, null)) {
        const error = new Error("Duplicate entry");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }

      const id = state.nextCategoryId++;
      state.categories.set(id, {
        id,
        parent_id: parentId,
        name,
        status: "active",
        sort_order: sortOrder,
        version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
        created_by: createdBy,
        updated_by: updatedBy
      });
      return [{ insertId: id }];
    }

    if (sql.includes("UPDATE item_categories") && sql.includes("SET name = ?")) {
      const [name, parentId, sortOrder, updatedAt, updatedBy, id, version] = params;
      const row = state.categories.get(id);
      if (!row || row.version !== version) {
        return [{ affectedRows: 0 }];
      }
      if (nameCollides(parentId, name, id)) {
        const error = new Error("Duplicate entry");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      row.name = name;
      row.parent_id = parentId;
      row.sort_order = sortOrder;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("UPDATE item_categories") && sql.includes("SET status = ?")) {
      // 最後幾個 params 是 status IN (...) 的 from-statuses；前面固定五個是
      // status, updated_at, updated_by, id, version。
      const [toStatus, updatedAt, updatedBy, id, version, ...fromStatuses] = params;
      const row = state.categories.get(id);
      if (!row || row.version !== version || !fromStatuses.includes(row.status)) {
        return [{ affectedRows: 0 }];
      }
      row.status = toStatus;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("SELECT COUNT(*) AS childCount FROM item_categories WHERE parent_id = ?")) {
      const count = [...state.categories.values()].filter((row) => row.parent_id === params[0]).length;
      return [[{ childCount: count }]];
    }

    if (sql.includes("DELETE FROM item_categories WHERE id = ? AND version = ?")) {
      const [id, version] = params;
      const row = state.categories.get(id);
      if (!row || row.version !== version) {
        return [{ affectedRows: 0 }];
      }
      state.categories.delete(id);
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("INSERT INTO item_audit_logs")) {
      state.auditRows.push(params);
      return [{ affectedRows: 1 }];
    }

    throw new Error(`Unhandled SQL in fake item catalog database: ${sql}`);
  }

  return {
    state,
    query: run,
    execute: run,
    withTransaction: async (work) => work({ query: run, execute: run })
  };
}
