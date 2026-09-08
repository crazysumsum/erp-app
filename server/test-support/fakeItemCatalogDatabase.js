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
  brands = [],
  uoms = [],
  attributes = [],
  attributeOptions = [],
  categoryAttributes = [],
  // 唔係真正嘅表——用嚟喺假資料庫模擬「呢個屬性已經被 SKU 用緊」，對應真
  // MySQL 入面 item_sku_attribute_values 有冇 row 指住呢個 attribute_id。
  skuAttributeValueAttributeIds = [],
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
    brands: new Map(brands.map((b) => [b.id, { ...b }])),
    uoms: new Map(uoms.map((u) => [u.id, { ...u }])),
    attributes: new Map(attributes.map((a) => [a.id, { ...a }])),
    attributeOptions: new Map(attributeOptions.map((o) => [o.id, { ...o }])),
    // key: `${categoryId}::${attributeId}`
    categoryAttributes: new Map(
      categoryAttributes.map((row) => [`${row.category_id}::${row.attribute_id}`, { ...row }])
    ),
    skuAttributeValueAttributeIds: new Set(skuAttributeValueAttributeIds),
    auditRows: [],
    nextCategoryId: categories.reduce((max, c) => Math.max(max, c.id), 0) + 1,
    nextBrandId: brands.reduce((max, b) => Math.max(max, b.id), 0) + 1,
    nextUomId: uoms.reduce((max, u) => Math.max(max, u.id), 0) + 1,
    nextAttributeId: attributes.reduce((max, a) => Math.max(max, a.id), 0) + 1,
    nextAttributeOptionId: attributeOptions.reduce((max, o) => Math.max(max, o.id), 0) + 1
  };

  function likeMatches(haystack, likeParam) {
    // service 端固定包成 `%term%`（已 escape），這裡只需要拆掉頭尾的 % 做
    // 不分大小寫 substring 比對，不需要重現完整 LIKE 語法。
    const term = String(likeParam).slice(1, -1).toLowerCase();
    return haystack.toLowerCase().includes(term);
  }

  function scopeKey(parentId, name) {
    return `${parentId ?? 0}::${String(name).toLowerCase()}`;
  }

  function duplicateEntryError() {
    const error = new Error("Duplicate entry");
    error.code = "ER_DUP_ENTRY";
    return error;
  }

  function rowReferencedError() {
    const error = new Error("Cannot delete or update a parent row: a foreign key constraint fails");
    error.code = "ER_ROW_IS_REFERENCED_2";
    return error;
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

    // --- Brand ---------------------------------------------------------------

    // 一定要先確認係 SELECT：「DELETE FROM item_brands WHERE id = ? AND
    // version = ?」本身就包含「FROM item_brands WHERE id = ?」呢個子字串，
    // 冇呢條 guard 會截走下面 DELETE 嗰個分支，令 delete 睇落成功咗但其實
    // 乜都冇做（affectedRows 冇被檢查，直接回一個查到嘅 row）。
    if (sql.startsWith("SELECT") && sql.includes("FROM item_brands WHERE id = ?")) {
      const row = state.brands.get(params[0]);
      return [row ? [{ ...row }] : []];
    }

    if (sql.includes("SELECT COUNT(*) AS total FROM item_brands")) {
      let rows = [...state.brands.values()];
      let cursor = 0;
      // 注意：cursor++ 一定要在 filter() 的回呼**外面**先取值——回呼對每一列
      // 都會被呼叫一次，把 params[cursor++] 直接寫在回呼裡會讓 cursor 每列都
      // 往前跳一格，第二列開始比對的就是錯的 param 了。
      if (sql.includes("status = ?")) {
        const statusParam = params[cursor++];
        rows = rows.filter((row) => row.status === statusParam);
      }
      if (sql.includes("name LIKE ?")) {
        const likeParam = params[cursor++];
        rows = rows.filter((row) => likeMatches(row.name, likeParam));
      }
      return [[{ total: rows.length }]];
    }

    if (sql.includes("FROM item_brands") && sql.includes("ORDER BY")) {
      let rows = [...state.brands.values()];
      let cursor = 0;
      if (sql.includes("status = ?")) {
        const statusParam = params[cursor++];
        rows = rows.filter((row) => row.status === statusParam);
      }
      if (sql.includes("name LIKE ?")) {
        const likeParam = params[cursor++];
        rows = rows.filter((row) => likeMatches(row.name, likeParam));
      }
      // 過濾條件消耗掉的 params 都在前面（cursor 個），剩下固定是
      // [pageSize, offset]（見 ItemCatalogService.listBrands 的
      // `[...params, pageSize, offset]`）。
      const pageSize = params[cursor];
      const offset = params[cursor + 1];
      const [, column, direction] = sql.match(/ORDER BY (\w+) (ASC|DESC)/);
      const descending = direction === "DESC";
      const toKey = (row) => (column === "official_name" ? row.official_name : row[column]);
      rows.sort((a, b) => {
        const result = String(toKey(a)).localeCompare(String(toKey(b)));
        return descending ? -result : result;
      });
      const paged = rows.slice(Number(offset), Number(offset) + Number(pageSize));
      return [paged.map((row) => ({ ...row }))];
    }

    if (sql.includes("INSERT INTO item_brands")) {
      const [name, officialName, description, createdAt, updatedAt, createdBy, updatedBy] = params;
      if ([...state.brands.values()].some((row) => row.name.toLowerCase() === String(name).toLowerCase())) {
        const error = new Error("Duplicate entry");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      const id = state.nextBrandId++;
      state.brands.set(id, {
        id,
        name,
        official_name: officialName,
        description,
        status: "active",
        version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
        created_by: createdBy,
        updated_by: updatedBy
      });
      return [{ insertId: id }];
    }

    if (sql.includes("UPDATE item_brands") && sql.includes("SET name = ?")) {
      const [name, officialName, description, updatedAt, updatedBy, id, version] = params;
      const row = state.brands.get(id);
      if (!row || row.version !== version) {
        return [{ affectedRows: 0 }];
      }
      if (
        [...state.brands.values()].some(
          (other) => other.id !== id && other.name.toLowerCase() === String(name).toLowerCase()
        )
      ) {
        const error = new Error("Duplicate entry");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      row.name = name;
      row.official_name = officialName;
      row.description = description;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("UPDATE item_brands") && sql.includes("SET status = ?")) {
      const [toStatus, updatedAt, updatedBy, id, version, ...fromStatuses] = params;
      const row = state.brands.get(id);
      if (!row || row.version !== version || !fromStatuses.includes(row.status)) {
        return [{ affectedRows: 0 }];
      }
      row.status = toStatus;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("DELETE FROM item_brands WHERE id = ? AND version = ?")) {
      const [id, version] = params;
      const row = state.brands.get(id);
      if (!row || row.version !== version) {
        return [{ affectedRows: 0 }];
      }
      state.brands.delete(id);
      return [{ affectedRows: 1 }];
    }

    // --- UOM -------------------------------------------------------------------

    // 同上：DELETE 查詢本身包含 "FROM item_uoms WHERE id = ?" 這個子字串，
    // 一定要先確認係 SELECT 先截。
    if (sql.startsWith("SELECT") && sql.includes("FROM item_uoms WHERE id = ?")) {
      const row = state.uoms.get(params[0]);
      return [row ? [{ ...row }] : []];
    }

    if (sql.includes("FROM item_uoms") && sql.includes("ORDER BY name")) {
      let rows = [...state.uoms.values()];
      if (sql.includes("status != 'archived'")) {
        rows = rows.filter((row) => row.status !== "archived");
      }
      rows = rows.map((row) => ({ ...row })).sort((a, b) => a.name.localeCompare(b.name));
      return [rows];
    }

    if (sql.includes("INSERT INTO item_uoms")) {
      const [code, name, symbol, createdAt, updatedAt, createdBy, updatedBy] = params;
      if ([...state.uoms.values()].some((row) => row.code.toLowerCase() === String(code).toLowerCase())) {
        const error = new Error("Duplicate entry");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      const id = state.nextUomId++;
      state.uoms.set(id, {
        id,
        code,
        name,
        symbol,
        status: "active",
        version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
        created_by: createdBy,
        updated_by: updatedBy
      });
      return [{ insertId: id }];
    }

    if (sql.includes("UPDATE item_uoms") && sql.includes("SET name = ?")) {
      const [name, symbol, updatedAt, updatedBy, id, version] = params;
      const row = state.uoms.get(id);
      if (!row || row.version !== version) {
        return [{ affectedRows: 0 }];
      }
      row.name = name;
      row.symbol = symbol;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("UPDATE item_uoms") && sql.includes("SET status = ?")) {
      const [toStatus, updatedAt, updatedBy, id, version, ...fromStatuses] = params;
      const row = state.uoms.get(id);
      if (!row || row.version !== version || !fromStatuses.includes(row.status)) {
        return [{ affectedRows: 0 }];
      }
      row.status = toStatus;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("DELETE FROM item_uoms WHERE id = ? AND version = ?")) {
      const [id, version] = params;
      const row = state.uoms.get(id);
      if (!row || row.version !== version) {
        return [{ affectedRows: 0 }];
      }
      state.uoms.delete(id);
      return [{ affectedRows: 1 }];
    }

    // --- Attribute ---------------------------------------------------------

    if (sql.includes("SELECT COUNT(*) AS total FROM item_attribute_definitions")) {
      let rows = [...state.attributes.values()];
      let cursor = 0;
      if (sql.includes("status = ?")) {
        rows = rows.filter((row) => row.status === params[cursor++]);
      }
      if (sql.includes("data_type = ?")) {
        rows = rows.filter((row) => row.data_type === params[cursor++]);
      }
      if (sql.includes("name LIKE ? OR code LIKE ?")) {
        const likeParam = params[cursor];
        rows = rows.filter((row) => likeMatches(row.name, likeParam) || likeMatches(row.code, likeParam));
      }
      return [[{ total: rows.length }]];
    }

    if (sql.includes("FROM item_attribute_definitions") && sql.includes("ORDER BY") && sql.includes("LIMIT")) {
      let rows = [...state.attributes.values()];
      let cursor = 0;
      if (sql.includes("status = ?")) {
        rows = rows.filter((row) => row.status === params[cursor++]);
      }
      if (sql.includes("data_type = ?")) {
        rows = rows.filter((row) => row.data_type === params[cursor++]);
      }
      if (sql.includes("name LIKE ? OR code LIKE ?")) {
        const likeParam = params[cursor++];
        rows = rows.filter((row) => likeMatches(row.name, likeParam) || likeMatches(row.code, likeParam));
      }
      const pageSize = params[cursor];
      const offset = params[cursor + 1];
      const [, column, direction] = sql.match(/ORDER BY (\w+) (ASC|DESC)/);
      const descending = direction === "DESC";
      rows.sort((a, b) => {
        const result = String(a[column]).localeCompare(String(b[column]));
        return descending ? -result : result;
      });
      const paged = rows.slice(Number(offset), Number(offset) + Number(pageSize));
      return [paged.map((row) => ({ ...row }))];
    }

    if (
      sql.startsWith("SELECT") &&
      sql.includes("FROM item_attribute_definitions WHERE id = ?") &&
      !sql.includes("IN (")
    ) {
      const row = state.attributes.get(params[0]);
      return [row ? [{ ...row }] : []];
    }

    if (sql.includes("SELECT id, attribute_id, value, label, sort_order, status") && sql.includes("attribute_id IN (")) {
      const ids = new Set(params.map(Number));
      const rows = [...state.attributeOptions.values()]
        .filter((row) => ids.has(Number(row.attribute_id)))
        .sort((a, b) => a.attribute_id - b.attribute_id || a.sort_order - b.sort_order || a.id - b.id);
      return [rows.map((row) => ({ ...row }))];
    }

    if (sql.includes("SELECT id, value, label, sort_order, status") && sql.includes("WHERE attribute_id = ?")) {
      const rows = [...state.attributeOptions.values()]
        .filter((row) => row.attribute_id === params[0])
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return [rows.map((row) => ({ ...row }))];
    }

    if (sql.includes("SELECT 1 AS used FROM item_sku_attribute_values WHERE attribute_id = ?")) {
      return [state.skuAttributeValueAttributeIds.has(params[0]) ? [{ used: 1 }] : []];
    }

    if (sql.includes("INSERT INTO item_attribute_definitions")) {
      const [code, name, dataType, uomId, isVariant, isFilterable, createdAt, updatedAt, createdBy, updatedBy] =
        params;
      if ([...state.attributes.values()].some((row) => row.code === code)) {
        throw duplicateEntryError();
      }
      const id = state.nextAttributeId++;
      state.attributes.set(id, {
        id,
        code,
        name,
        data_type: dataType,
        uom_id: uomId,
        is_variant: isVariant,
        is_filterable: isFilterable,
        status: "active",
        version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
        created_by: createdBy,
        updated_by: updatedBy
      });
      return [{ insertId: id }];
    }

    if (sql.includes("UPDATE item_attribute_definitions") && sql.includes("SET name = ?")) {
      const [name, uomId, isVariant, isFilterable, updatedAt, updatedBy, id, version] = params;
      const row = state.attributes.get(id);
      if (!row || row.version !== version) {
        return [{ affectedRows: 0 }];
      }
      row.name = name;
      row.uom_id = uomId;
      row.is_variant = isVariant;
      row.is_filterable = isFilterable;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("UPDATE item_attribute_definitions") && sql.includes("SET status = ?")) {
      const [toStatus, updatedAt, updatedBy, id, version, ...fromStatuses] = params;
      const row = state.attributes.get(id);
      if (!row || row.version !== version || !fromStatuses.includes(row.status)) {
        return [{ affectedRows: 0 }];
      }
      row.status = toStatus;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("DELETE FROM item_attribute_definitions WHERE id = ? AND version = ?")) {
      const [id, version] = params;
      const row = state.attributes.get(id);
      if (!row || row.version !== version) {
        return [{ affectedRows: 0 }];
      }
      const referenced =
        [...state.categoryAttributes.values()].some((r) => r.attribute_id === id) ||
        state.skuAttributeValueAttributeIds.has(id);
      if (referenced) {
        throw rowReferencedError();
      }
      state.attributes.delete(id);
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("INSERT INTO item_attribute_options") && sql.includes("VALUES (?, ?, ?, ?, 'active', 1")) {
      const [attributeId, value, label, sortOrder, createdAt, updatedAt, createdBy, updatedBy] = params;
      if (
        [...state.attributeOptions.values()].some((row) => row.attribute_id === attributeId && row.value === value)
      ) {
        throw duplicateEntryError();
      }
      const id = state.nextAttributeOptionId++;
      state.attributeOptions.set(id, {
        id,
        attribute_id: attributeId,
        value,
        label,
        sort_order: sortOrder,
        status: "active",
        version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
        created_by: createdBy,
        updated_by: updatedBy
      });
      return [{ insertId: id }];
    }

    if (sql.includes("INSERT INTO item_attribute_options") && sql.includes("VALUES (?, ?, ?, ?, ?, 1")) {
      const [attributeId, value, label, sortOrder, status, createdAt, updatedAt, createdBy, updatedBy] = params;
      if (
        [...state.attributeOptions.values()].some((row) => row.attribute_id === attributeId && row.value === value)
      ) {
        throw duplicateEntryError();
      }
      const id = state.nextAttributeOptionId++;
      state.attributeOptions.set(id, {
        id,
        attribute_id: attributeId,
        value,
        label,
        sort_order: sortOrder,
        status,
        version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
        created_by: createdBy,
        updated_by: updatedBy
      });
      return [{ insertId: id }];
    }

    if (sql.includes("UPDATE item_attribute_options") && sql.includes("SET value = ?")) {
      const [value, label, sortOrder, status, updatedAt, updatedBy, id] = params;
      const row = state.attributeOptions.get(id);
      if (!row) {
        return [{ affectedRows: 0 }];
      }
      if (
        [...state.attributeOptions.values()].some(
          (other) => other.id !== id && other.attribute_id === row.attribute_id && other.value === value
        )
      ) {
        throw duplicateEntryError();
      }
      row.value = value;
      row.label = label;
      row.sort_order = sortOrder;
      row.status = status;
      row.updated_at = updatedAt;
      row.updated_by = updatedBy;
      row.version += 1;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("DELETE FROM item_attribute_options WHERE id = ?")) {
      const [id] = params;
      const row = state.attributeOptions.get(id);
      if (!row) {
        return [{ affectedRows: 0 }];
      }
      // 冇建模 item_attribute_values／item_sku_attribute_values 嘅
      // option_id RESTRICT——呢個假資料庫冇需要測到嗰一層，真正嘅 FK 行為
      // 由 itemAttributeMigrations.integration.test.js 對真 MySQL 驗證。
      state.attributeOptions.delete(id);
      return [{ affectedRows: 1 }];
    }

    // --- Category attribute assignment --------------------------------------

    if (
      sql.includes("SELECT attribute_id, required_for_activation, sort_order") &&
      sql.includes("FROM item_category_attributes") &&
      sql.includes("WHERE category_id = ?")
    ) {
      const rows = [...state.categoryAttributes.values()]
        .filter((row) => row.category_id === params[0])
        .sort((a, b) => a.sort_order - b.sort_order || a.attribute_id - b.attribute_id);
      return [rows.map((row) => ({ ...row }))];
    }

    if (sql.includes("DELETE FROM item_category_attributes WHERE category_id = ? AND attribute_id IN (")) {
      const [categoryId, ...attributeIds] = params;
      const idSet = new Set(attributeIds.map(Number));
      for (const key of [...state.categoryAttributes.keys()]) {
        const row = state.categoryAttributes.get(key);
        if (row.category_id === categoryId && idSet.has(Number(row.attribute_id))) {
          state.categoryAttributes.delete(key);
        }
      }
      return [{ affectedRows: attributeIds.length }];
    }

    if (sql.includes("INSERT INTO item_category_attributes")) {
      const [categoryId, attributeId, requiredForActivation, sortOrder, createdAt, updatedAt] = params;
      state.categoryAttributes.set(`${categoryId}::${attributeId}`, {
        category_id: categoryId,
        attribute_id: attributeId,
        required_for_activation: requiredForActivation,
        sort_order: sortOrder,
        created_at: createdAt,
        updated_at: updatedAt
      });
      return [{ insertId: 0 }];
    }

    if (sql.includes("UPDATE item_category_attributes") && sql.includes("SET required_for_activation = ?")) {
      const [requiredForActivation, sortOrder, updatedAt, categoryId, attributeId] = params;
      const row = state.categoryAttributes.get(`${categoryId}::${attributeId}`);
      if (!row) {
        return [{ affectedRows: 0 }];
      }
      row.required_for_activation = requiredForActivation;
      row.sort_order = sortOrder;
      row.updated_at = updatedAt;
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
