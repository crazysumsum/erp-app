/**
 * 供應商列表嘅排序 index（TASK-050；HD-088 批准）。
 *
 * - `idx_suppliers_updated_id (updated_at, id)`：預設列表同各種篩選「按更新時間排序」。冇佢，排除封存嘅
 *   `status != 'archived'` 用唔到 `(status, updated_at, id)`，每頁都要排序成張表（100k 時 28 ms）。
 * - `idx_suppliers_name_id (supplier_name, id)`：按名稱排序。`supplier_name_key` 嘅 collation 唔同，用佢會改變次序。
 *
 * 文字搜尋唔加 index：FULLTEXT ngram 實測慢過而家嘅 LIKE、搵唔到電話同 email、標點會錯配（performance_report.md）。
 * Online 加（INPLACE、LOCK=NONE），唔鎖讀寫。重跑時已有就唔再加；同名但欄位唔同就拒絕。
 */
const INDEXES = Object.freeze({
  idx_suppliers_updated_id: ["updated_at", "id"],
  idx_suppliers_name_id: ["supplier_name", "id"]
});

export async function up(connection) {
  const [rows] = await connection.query(
    `SELECT index_name AS index_name, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'suppliers' AND index_name IN (?)
      ORDER BY index_name, seq_in_index`,
    [Object.keys(INDEXES)]
  );
  const existing = new Map();
  for (const row of rows) existing.set(row.index_name, [...(existing.get(row.index_name) ?? []), row.column_name]);
  for (const [name, columns] of Object.entries(INDEXES)) {
    if (existing.has(name)) {
      if (existing.get(name).join(",") !== columns.join(",")) {
        throw new Error(`Incompatible existing Supplier schema index: suppliers.${name}`);
      }
      continue;
    }
    await connection.query(`ALTER TABLE suppliers ADD INDEX ${name} (${columns.join(", ")}), ALGORITHM=INPLACE, LOCK=NONE`);
  }
}
