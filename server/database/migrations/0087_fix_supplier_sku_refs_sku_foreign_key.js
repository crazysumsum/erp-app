/**
 * 令 `supplier_sku_refs.sku_id` 嘅 FK 真係生效（DEF-029；HD-113 A 批准）。
 *
 * InnoDB 用第一個以 `sku_id` 開頭嘅 index 去做 FK 檢查。0081 只建咗 `(sku_id, relationship_status, last_supplied_at)`，
 * 尾欄可以係 NULL，MySQL 26.7.0 喺呢個情況下寫子表時唔檢查：指向唔存在 SKU 嘅關係都入到（刪 SKU 就照樣拒絕）。
 * 淨係加 `(sku_id)` index、或者刪咗 FK 再加都冇用，因為複合 index 仲排喺前面。要咁做：
 *   1. 刪 FK、刪複合 index（如果之前有人手加過 `(sku_id)` 都一齊刪），加 `idx_supplier_sku_refs_sku (sku_id)`，再加返複合 index；
 *   2. 加返 FK（ON DELETE RESTRICT 不變）。呢步用 COPY 重建張表，server 會逐行檢查，期間只可以讀、唔可以寫。
 * 開始之前先查孤兒資料（關係指向唔存在嘅 SKU）：有就停低列出嚟，唔會自己刪。
 * 重跑：已經修好就乜都唔做；第 1 步做完但第 2 步未做（例如等 lock 超時）就淨係補 FK。
 * 等 metadata lock 最多 `lockWaitSeconds`（預設 10 秒），等唔到就失敗講明原因，同 0080 一樣。
 * `table` 只係俾測試用一張複製表，FK 名跟住表名（真表就係 `fk_supplier_sku_refs_sku`）。
 * migration runner 冇 down；`down` 要人手跑，還原 0081 嘅定義（index 次序除外，FK 會再次唔生效）。
 */
const SKU_INDEX = "idx_supplier_sku_refs_sku";
const COMPOSITE_INDEX = "idx_supplier_sku_refs_sku_status_supplied";
const COMPOSITE_COLUMNS = "sku_id, relationship_status, last_supplied_at";
const ORPHAN_REPORT_LIMIT = 20;

async function inspect(connection, table) {
  const [indexRows] = await connection.query(`SHOW INDEX FROM \`${table}\``);
  // SHOW INDEX 按 index 喺表入面嘅次序列出，即係 InnoDB 揀 FK index 嘅次序。
  const order = [...new Set(indexRows.map((row) => row.Key_name))];
  const skuColumns = indexRows.filter((row) => row.Key_name === SKU_INDEX).map((row) => row.Column_name);
  if (skuColumns.length > 0 && skuColumns.join(",") !== "sku_id") {
    throw new Error(`Incompatible existing Supplier schema index: ${table}.${SKU_INDEX}`);
  }
  const [[{ fks }]] = await connection.query(
    `SELECT COUNT(*) AS fks FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?`, [table, `fk_${table}_sku`]);
  return {
    hasSkuIndex: skuColumns.length > 0,
    hasComposite: order.includes(COMPOSITE_INDEX),
    skuIndexFirst: skuColumns.length > 0 && (!order.includes(COMPOSITE_INDEX) || order.indexOf(SKU_INDEX) < order.indexOf(COMPOSITE_INDEX)),
    hasForeignKey: Number(fks) > 0
  };
}

async function refuseOrphans(connection, table) {
  const [rows] = await connection.query(
    `SELECT r.id AS id, r.supplier_id AS supplier_id, r.sku_id AS sku_id FROM \`${table}\` r
       LEFT JOIN item_skus s ON s.id = r.sku_id WHERE s.id IS NULL ORDER BY r.id LIMIT ${ORPHAN_REPORT_LIMIT + 1}`);
  if (rows.length === 0) return;
  const listed = rows.slice(0, ORPHAN_REPORT_LIMIT).map((row) => `id=${row.id} supplier_id=${row.supplier_id} sku_id=${row.sku_id}`);
  throw new Error(`${table} has relations whose SKU does not exist; fix or remove them and rerun the migration: ${listed.join("; ")}`
    + (rows.length > ORPHAN_REPORT_LIMIT ? `; and more` : ""));
}

async function withLockWait(connection, table, lockWaitSeconds, work) {
  const [[{ previous }]] = await connection.query("SELECT @@SESSION.lock_wait_timeout AS previous");
  await connection.query("SET SESSION lock_wait_timeout = ?", [lockWaitSeconds]);
  try {
    await work();
  } catch (error) {
    if ((error?.cause?.code ?? error?.code) === "ER_LOCK_WAIT_TIMEOUT") {
      throw new Error(`Waited ${lockWaitSeconds} s for the metadata lock on ${table}: a long transaction holds it; let it finish and rerun the migration`);
    }
    throw error;
  } finally {
    await connection.query("SET SESSION lock_wait_timeout = ?", [Number(previous)]);
  }
}

const addForeignKey = (table) =>
  `ALTER TABLE \`${table}\` ADD CONSTRAINT \`fk_${table}_sku\` FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT`;

export async function up(connection, { lockWaitSeconds = 10, table = "supplier_sku_refs" } = {}) {
  const state = await inspect(connection, table);
  if (state.skuIndexFirst && state.hasComposite && state.hasForeignKey) return;
  await refuseOrphans(connection, table);
  await withLockWait(connection, table, lockWaitSeconds, async () => {
    if (!state.skuIndexFirst || !state.hasComposite) {
      const drops = [
        state.hasForeignKey && `DROP FOREIGN KEY \`fk_${table}_sku\``,
        state.hasSkuIndex && `DROP INDEX ${SKU_INDEX}`,
        state.hasComposite && `DROP INDEX ${COMPOSITE_INDEX}`
      ].filter(Boolean);
      await connection.query(`ALTER TABLE \`${table}\` ${[...drops, `ADD INDEX ${SKU_INDEX} (sku_id)`,
        `ADD INDEX ${COMPOSITE_INDEX} (${COMPOSITE_COLUMNS})`].join(", ")}, ALGORITHM=INPLACE, LOCK=NONE`);
    }
    await connection.query(addForeignKey(table));
  });
}

export async function down(connection, { lockWaitSeconds = 10, table = "supplier_sku_refs" } = {}) {
  const state = await inspect(connection, table);
  if (!state.hasSkuIndex) return;
  await withLockWait(connection, table, lockWaitSeconds, async () => {
    if (state.hasForeignKey) await connection.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`fk_${table}_sku\``);
    await connection.query(`ALTER TABLE \`${table}\` DROP INDEX ${SKU_INDEX}`);
    await connection.query(addForeignKey(table));
  });
}
