/**
 * 供應商列表嘅排序 index（TASK-050；HD-088 批准）。
 *
 * - `idx_suppliers_updated_id (updated_at, id)`：預設列表同各種篩選「按更新時間排序」。冇佢，排除封存嘅
 *   `status != 'archived'` 用唔到 `(status, updated_at, id)`，每頁都要排序成張表（100k 時 28 ms）。
 * - `idx_suppliers_name_id (supplier_name, id)`：按名稱排序。`supplier_name_key` 嘅 collation 唔同，用佢會改變次序。
 *
 * 文字搜尋唔加 index：FULLTEXT ngram 實測慢過而家嘅 LIKE、搵唔到電話同 email、標點會錯配（performance_report.md）。
 * INPLACE、LOCK=NONE：建 index 期間讀寫照常。但開始同結束要攞 `suppliers` 嘅 metadata lock：有冇做完嘅 transaction
 * 揸住呢張表，ALTER 就要等，而排喺佢後面嘅讀寫都會一齊等（REV-084 L-3）。所以只等 `lockWaitSeconds`（預設 10 秒），
 * 等唔到就失敗並講明原因：完成長 transaction 之後重跑就得。重跑時已有就唔再加；同名但欄位唔同就拒絕。
 */
const INDEXES = Object.freeze({
  idx_suppliers_updated_id: ["updated_at", "id"],
  idx_suppliers_name_id: ["supplier_name", "id"]
});

export async function up(connection, { lockWaitSeconds = 10 } = {}) {
  const [rows] = await connection.query(
    `SELECT index_name AS index_name, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'suppliers' AND index_name IN (?)
      ORDER BY index_name, seq_in_index`,
    [Object.keys(INDEXES)]
  );
  const existing = new Map();
  for (const row of rows) existing.set(row.index_name, [...(existing.get(row.index_name) ?? []), row.column_name]);
  const missing = [];
  for (const [name, columns] of Object.entries(INDEXES)) {
    if (!existing.has(name)) missing.push([name, columns]);
    else if (existing.get(name).join(",") !== columns.join(",")) throw new Error(`Incompatible existing Supplier schema index: suppliers.${name}`);
  }
  if (missing.length === 0) return;
  const [[{ previous }]] = await connection.query("SELECT @@SESSION.lock_wait_timeout AS previous");
  await connection.query("SET SESSION lock_wait_timeout = ?", [lockWaitSeconds]);
  try {
    for (const [name, columns] of missing) {
      await connection.query(`ALTER TABLE suppliers ADD INDEX ${name} (${columns.join(", ")}), ALGORITHM=INPLACE, LOCK=NONE`);
    }
  } catch (error) {
    if ((error?.cause?.code ?? error?.code) === "ER_LOCK_WAIT_TIMEOUT") {
      throw new Error(`Waited ${lockWaitSeconds} s for the metadata lock on suppliers: a long transaction holds it; let it finish and rerun the migration`);
    }
    throw error;
  } finally {
    await connection.query("SET SESSION lock_wait_timeout = ?", [Number(previous)]);
  }
}
