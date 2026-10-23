import { supplierConflict } from "./supplierErrors.js";

/**
 * 地址同聯絡人嘅顯示次序（DEF-037、HD-129 A、HD-136）。兩張表都有 `sort_order`，細者先；列表次序 `status, sort_order, id`。
 * Caller 要已經鎖住 Supplier 行（FOR UPDATE），所以同一個 Supplier 嘅新增同調位唔會撞。
 */
const TABLES = Object.freeze({ supplier_addresses: true, supplier_contacts: true });

function table(name) {
  if (!TABLES[name]) throw new TypeError(`unknown Supplier party table ${name}`);
  return name;
}

/** 新增嘅行排最後。 */
export async function nextSortOrder(connection, tableName, supplierId) {
  const [[row]] = await connection.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM ${table(tableName)} WHERE supplier_id = ?`, [supplierId]);
  return Number(row.next);
}

/**
 * 同上一個／下一個有效行交換次序。`current` 係已經 FOR UPDATE 鎖住、版本核對過嘅行。回 `{ before, after }`（被移動嗰行嘅 sort_order）。
 * 已經係第一個／最後一個就拒絕，唔扮成功。
 */
export async function swapWithNeighbour(connection, tableName, { supplierId, current, direction, actorId, nowMs }) {
  const name = table(tableName);
  const up = direction === "up";
  const [[neighbour]] = await connection.query(
    `SELECT id, sort_order FROM ${name}
      WHERE supplier_id = ? AND status = 'active' AND id != ?
        AND (sort_order ${up ? "<" : ">"} ? OR (sort_order = ? AND id ${up ? "<" : ">"} ?))
      ORDER BY sort_order ${up ? "DESC" : "ASC"}, id ${up ? "DESC" : "ASC"}
      LIMIT 1 FOR UPDATE`,
    [supplierId, current.id, current.sort_order, current.sort_order, current.id]
  );
  if (!neighbour) {
    throw supplierConflict("SUPPLIER_PARTY_MOVE_NOT_POSSIBLE", up ? "已經排在最前" : "已經排在最後");
  }
  // 兩行同號（例如舊資料）都要分得開：被移動嗰行攞鄰居嘅位，鄰居攞返佢嘅位；同號就按方向差一。
  const before = Number(current.sort_order);
  const target = Number(neighbour.sort_order);
  const after = target === before ? (up ? before - 1 : before + 1) : target;
  await connection.execute(`UPDATE ${name} SET sort_order = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND supplier_id = ?`,
    [after, nowMs, actorId, current.id, supplierId]);
  await connection.execute(`UPDATE ${name} SET sort_order = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND supplier_id = ?`,
    [before, nowMs, actorId, neighbour.id, supplierId]);
  return { before, after };
}
