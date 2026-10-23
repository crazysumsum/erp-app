// DEF-037（HD-129 A，migration 批准：HD-136）：地址同聯絡人要可以排序（FR-PARTY-001）。
//
// 每張表加 sort_order INT NOT NULL DEFAULT 0：同一 Supplier 入面嘅顯示次序，細者先。舊資料按而家嘅顯示次序填 1、2、3…
// （地址 status, id；聯絡人 status, name, id），所以使用者睇到嘅次序唔變。唔加 index（每個 Supplier 嘅行數好少），亦唔設
// unique（上移／下移喺同一個 transaction 交換兩行，中途會短暫同號）。加有預設值嘅欄位喺 MySQL 8 係 INSTANT DDL。
//
// 0101、0102 已經俾進行中嘅 sales-archive 分支用咗，所以用 0103。Runner 以完整檔名記錄，跳號唔影響。
const TABLES = Object.freeze({
  supplier_addresses: "status, id",
  supplier_contacts: "status, name, id"
});

/** 兩張表都有 `sort_order INT NOT NULL DEFAULT 0` 就 true；冇就 false；型別唔啱就拋。開機自我檢查都用佢。 */
export async function inspectSupplierPartySortOrder(connection) {
  const [rows] = await connection.query(
    `SELECT table_name AS table_name, data_type AS data_type, is_nullable AS is_nullable, column_default AS column_default
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND column_name = 'sort_order' AND table_name IN ('supplier_addresses', 'supplier_contacts')`
  );
  for (const row of rows) {
    const type = String(row.data_type ?? row.DATA_TYPE).toLowerCase();
    const nullable = String(row.is_nullable ?? row.IS_NULLABLE);
    const fallback = String(row.column_default ?? row.COLUMN_DEFAULT);
    if (type !== "int" || nullable !== "NO" || fallback !== "0") {
      throw new Error(`Incompatible existing Supplier sort_order column: ${row.table_name ?? row.TABLE_NAME}`);
    }
  }
  return rows.length === Object.keys(TABLES).length;
}

export async function up(connection) {
  if (await inspectSupplierPartySortOrder(connection)) return;
  for (const [table, order] of Object.entries(TABLES)) {
    const [[present]] = await connection.query(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'sort_order'",
      [table]
    );
    if (Number(present.n) === 0) await connection.query(`ALTER TABLE ${table} ADD COLUMN sort_order INT NOT NULL DEFAULT 0`);
    await connection.query(
      `UPDATE ${table} t
         JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY supplier_id ORDER BY ${order}) AS position FROM ${table}) ranked ON ranked.id = t.id
          SET t.sort_order = ranked.position
        WHERE t.sort_order = 0`
    );
  }
}
