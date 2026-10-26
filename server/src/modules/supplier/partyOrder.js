import { supplierConflict } from "./supplierErrors.js";

/**
 * 地址同聯絡人嘅顯示次序（DEF-037、HD-129 A、HD-136）。兩張表都有 `sort_order`，細者先；列表次序 `status, sort_order, id`。
 * Caller 要已經鎖住 Supplier 行（FOR UPDATE）。下面嘅讀取都係 locking read：transaction 係 REPEATABLE READ，
 * 普通 SELECT 會用 authorize() 時定咗嘅 read view，睇唔到等鎖期間另一個請求剛 commit 嘅行（REV-118 M-1）。
 */
const TABLES = Object.freeze({ supplier_addresses: true, supplier_contacts: true });

function table(name) {
  if (!TABLES[name]) throw new TypeError(`unknown Supplier party table ${name}`);
  return name;
}

/** 新增嘅行排最後。 */
export async function nextSortOrder(connection, tableName, supplierId) {
  const [rows] = await connection.query(`SELECT sort_order FROM ${table(tableName)} WHERE supplier_id = ? FOR UPDATE`, [supplierId]);
  return rows.reduce((max, row) => Math.max(max, Number(row.sort_order)), 0) + 1;
}

/**
 * 同上一個／下一個有效行交換次序，回 `{ before, after, neighbour }`（`neighbour` 係 `{ id, before, after }`）。
 * 有同號（舊資料、或者修正前並發新增留低嘅）就先將呢個 Supplier 嘅行按畫面次序重新編成 1..n，再交換，咁一次移動一定只係一格。
 * 已經係第一個／最後一個就拒絕，唔扮成功。
 *
 * 只有被移動嗰行 version + 1：鄰居嘅內容冇變，佢嘅 version 唔郁，咁打開緊鄰居編輯嘅人唔會無端撞版本衝突（REV-118 L-3）；
 * 鄰居嘅前後次序記喺 Audit。
 */
export async function swapWithNeighbour(connection, tableName, { supplierId, current, direction, actorId, nowMs }) {
  const name = table(tableName);
  const [rows] = await connection.query(`SELECT id, status, sort_order FROM ${name} WHERE supplier_id = ? ORDER BY status, sort_order, id FOR UPDATE`, [supplierId]);
  const values = rows.map((row) => Number(row.sort_order));
  const order = new Map(rows.map((row, index) => [Number(row.id), values[index]]));
  if (new Set(values).size !== values.length) {
    for (const [index, row] of rows.entries()) {
      if (Number(row.sort_order) === index + 1) continue;
      await connection.execute(`UPDATE ${name} SET sort_order = ? WHERE id = ? AND supplier_id = ?`, [index + 1, row.id, supplierId]);
    }
    rows.forEach((row, index) => order.set(Number(row.id), index + 1));
  }
  const active = rows.filter((row) => row.status === "active").map((row) => Number(row.id));
  const position = active.indexOf(Number(current.id));
  const neighbourId = active[direction === "up" ? position - 1 : position + 1];
  if (position < 0 || neighbourId === undefined) {
    throw supplierConflict("SUPPLIER_PARTY_MOVE_NOT_POSSIBLE", direction === "up" ? "已經排在最前" : "已經排在最後");
  }
  const before = order.get(Number(current.id));
  const after = order.get(neighbourId);
  await connection.execute(`UPDATE ${name} SET sort_order = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND supplier_id = ?`,
    [after, nowMs, actorId, current.id, supplierId]);
  await connection.execute(`UPDATE ${name} SET sort_order = ?, updated_at = ?, updated_by = ? WHERE id = ? AND supplier_id = ?`,
    [before, nowMs, actorId, neighbourId, supplierId]);
  return { before, after, neighbour: { id: neighbourId, before: after, after: before } };
}
