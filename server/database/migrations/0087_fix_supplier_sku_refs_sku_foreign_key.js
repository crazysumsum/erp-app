/**
 * 令 `supplier_sku_refs.sku_id` 嘅 FK 真係生效（DEF-029；HD-113 A，做法按 REV-100 H-1 改咗，見 HD-114）。
 *
 * InnoDB 用第一個以 `sku_id` 開頭嘅 index 去做 FK 檢查。0081 只建咗 `(sku_id, relationship_status, last_supplied_at)`，
 * 尾欄可以係 NULL，MySQL 26.7.0 喺呢個情況下寫子表時唔檢查：指向唔存在 SKU 嘅關係都入到（刪 SKU 就照樣拒絕）。
 * 淨係喺後面加 `(sku_id)` index 冇用，因為複合 index 仲排喺前面。所以用一句 ALTER（INPLACE、LOCK=NONE）：
 * 加 `idx_supplier_sku_refs_sku (sku_id)`，刪複合 index 再加返，令 `(sku_id)` 排先（如果之前有人手加過排錯位嘅
 * `(sku_id)`，先另外刪咗佢）。FK 由頭到尾都喺度，唔使重建張表，期間讀寫照常。
 * 前後都查孤兒資料（關係指向唔存在嘅 SKU）：有就停低列出嚟，唔會自己刪，runner 亦唔會記低呢個 migration。
 * ALTER 之前檢查嗰陣 FK 仲未生效，所以 ALTER 之後要再查一次；之後 FK 已經生效，唔會再有新嘅孤兒。
 * 重跑：已經修好就只查孤兒。`foreign_key_checks` 係 0 嘅連線會拒絕，因為咁樣寫入唔受 FK 約束。
 * 等 metadata lock 最多 `lockWaitSeconds`（預設 10 秒），等唔到就失敗講明原因，同 0080 一樣。
 * `table` 只係俾測試用一張複製表，FK 名跟住表名（真表就係 `fk_supplier_sku_refs_sku`）。
 * migration runner 冇 down；`down` 要人手跑：刪 `(sku_id)` index，FK 退返用複合 index，即係 0081 嘅樣（再次唔生效）。
 */
const SKU_INDEX = "idx_supplier_sku_refs_sku";
const COMPOSITE_INDEX = "idx_supplier_sku_refs_sku_status_supplied";
const COMPOSITE_COLUMNS = "sku_id, relationship_status, last_supplied_at";
const ORPHAN_REPORT_LIMIT = 20;

async function inspect(connection, table) {
  const [indexRows] = await connection.query(`SHOW INDEX FROM \`${table}\``);
  const skuColumns = indexRows.filter((row) => row.Key_name === SKU_INDEX).map((row) => row.Column_name);
  if (skuColumns.length > 0 && skuColumns.join(",") !== "sku_id") {
    throw new Error(`Incompatible existing Supplier schema index: ${table}.${SKU_INDEX}`);
  }
  // SHOW INDEX 按 index 喺表入面嘅次序列出，即係 InnoDB 揀 FK index 嘅次序：第一個以 sku_id 開頭嘅就係 FK 用嗰個。
  const first = indexRows.find((row) => Number(row.Seq_in_index) === 1 && row.Column_name === "sku_id")?.Key_name ?? null;
  const [[{ fks }]] = await connection.query(
    `SELECT COUNT(*) AS fks FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?`, [table, `fk_${table}_sku`]);
  if (Number(fks) === 0) throw new Error(`Incompatible existing Supplier schema: ${table} has no foreign key fk_${table}_sku`);
  return {
    hasSkuIndex: skuColumns.length > 0,
    hasComposite: indexRows.some((row) => row.Key_name === COMPOSITE_INDEX),
    servingIndex: first
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

export async function up(connection, { lockWaitSeconds = 10, table = "supplier_sku_refs" } = {}) {
  const [[{ checks }]] = await connection.query("SELECT @@SESSION.foreign_key_checks AS checks");
  if (Number(checks) !== 1) throw new Error("foreign_key_checks must be 1 to make the supplier_sku_refs SKU foreign key effective");
  const state = await inspect(connection, table);
  await refuseOrphans(connection, table);
  if (state.servingIndex === SKU_INDEX && state.hasComposite) return;
  await withLockWait(connection, table, lockWaitSeconds, async () => {
    // 排錯位嘅 `(sku_id)` 同一句入面刪咗再加返，複合 index 仍然排先（實測），所以要先刪。之後就係 0081 嘅樣，
    // 中途停咗重跑都得。
    if (state.hasSkuIndex) await connection.query(`ALTER TABLE \`${table}\` DROP INDEX ${SKU_INDEX}, ALGORITHM=INPLACE, LOCK=NONE`);
    const changes = [`ADD INDEX ${SKU_INDEX} (sku_id)`, state.hasComposite && `DROP INDEX ${COMPOSITE_INDEX}`,
      `ADD INDEX ${COMPOSITE_INDEX} (${COMPOSITE_COLUMNS})`].filter(Boolean);
    await connection.query(`ALTER TABLE \`${table}\` ${changes.join(", ")}, ALGORITHM=INPLACE, LOCK=NONE`);
  });
  const after = await inspect(connection, table);
  // 例如另一個以 sku_id 開頭嘅 UNIQUE index：MySQL 一定將 UNIQUE 排喺普通 index 前面，FK 會繼續用佢。
  if (after.servingIndex !== SKU_INDEX) {
    throw new Error(`${table}.${after.servingIndex} still serves fk_${table}_sku ahead of ${SKU_INDEX}; the foreign key may stay unenforced`);
  }
  await refuseOrphans(connection, table);
}

export async function down(connection, { lockWaitSeconds = 10, table = "supplier_sku_refs" } = {}) {
  const state = await inspect(connection, table);
  if (!state.hasSkuIndex) return;
  await withLockWait(connection, table, lockWaitSeconds, () =>
    connection.query(`ALTER TABLE \`${table}\` DROP INDEX ${SKU_INDEX}, ALGORITHM=INPLACE, LOCK=NONE`));
}
