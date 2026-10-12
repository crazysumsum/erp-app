/**
 * Supplier–SKU 軟性供貨關係同 append-only 供貨事件（TASK-038；設計 §5.11、§5.11.1；Item §5.14；HD-086 批准）。
 *
 * 兩張表一齊建：事件 FK 指向關係，分開就有一段時間只有半套。Item 嘅 SKU／UOM 表唔喺度就明確失敗，
 * 唔會建一張冇 FK 嘅弱化表（MIG-007）。重跑時只驗證現有 schema，唔改。
 */
const TABLES = Object.freeze({
  supplier_sku_refs: {
    columns: {
      id: ["bigint unsigned", "NO"], supplier_id: ["bigint unsigned", "NO"], sku_id: ["bigint unsigned", "NO"],
      supplier_item_code: ["varchar(190)", "NO"], supplier_item_code_key: ["varchar(190)", "YES"],
      supplier_item_name: ["varchar(190)", "NO"], purchase_sku_uom_id: ["bigint unsigned", "YES"],
      minimum_order_qty: ["int unsigned", "YES"], standard_lead_time_days: ["smallint unsigned", "YES"],
      relationship_status: ["varchar(20)", "NO"], first_supplied_at: ["bigint unsigned", "YES"], last_supplied_at: ["bigint unsigned", "YES"],
      source: ["varchar(20)", "NO"], version: ["int unsigned", "NO"], created_at: ["bigint unsigned", "NO"],
      updated_at: ["bigint unsigned", "NO"], created_by: ["bigint unsigned", "YES"], updated_by: ["bigint unsigned", "YES"]
    },
    indexes: [
      "PRIMARY:0:id",
      "uq_supplier_sku_refs_supplier_sku:0:supplier_id,sku_id",
      "uq_supplier_sku_refs_item_code:0:supplier_id,supplier_item_code_key",
      "idx_supplier_sku_refs_sku_status_supplied:1:sku_id,relationship_status,last_supplied_at"
    ],
    foreignKeys: [
      "supplier_id>suppliers(id):RESTRICT", "sku_id>item_skus(id):RESTRICT",
      "purchase_sku_uom_id,sku_id>item_sku_uoms(id,sku_id):RESTRICT",
      "created_by>users(id):SET NULL", "updated_by>users(id):SET NULL"
    ]
  },
  supplier_supply_events: {
    columns: {
      id: ["bigint unsigned", "NO"], event_id: ["varchar(64)", "NO"], source_type: ["varchar(30)", "NO"],
      source_id: ["bigint unsigned", "NO"], source_line_id: ["bigint unsigned", "NO"], supplier_id: ["bigint unsigned", "NO"],
      sku_id: ["bigint unsigned", "NO"], relation_id: ["bigint unsigned", "NO"], supplied_at: ["bigint unsigned", "NO"],
      payload_hash: ["char(64)", "NO"], created_at: ["bigint unsigned", "NO"]
    },
    indexes: [
      "PRIMARY:0:id",
      "uq_supplier_supply_events_event:0:event_id",
      "uq_supplier_supply_events_source:0:source_type,source_id,source_line_id",
      "idx_supplier_supply_events_relation:1:relation_id,supplied_at"
    ],
    foreignKeys: ["supplier_id>suppliers(id):RESTRICT", "sku_id>item_skus(id):RESTRICT", "relation_id>supplier_sku_refs(id):RESTRICT"]
  }
});

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    "SELECT 1 AS present FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [table]);
  return rows.length > 0;
}

/**
 * 驗證現有表同設計一樣：欄位、index，同埋每條 FK 嘅欄位、目標同 ON DELETE 規則（一張 CASCADE 嘅手建表唔可以
 * 當成已經有）。`as` 俾測試用 probe 表，用 `table` 嘅規格去驗。冇呢張表就回 false。
 */
export async function inspectSupplierSkuRelationSchema(connection, table, { as = table } = {}) {
  const spec = TABLES[table];
  const [rows] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type, is_nullable AS is_nullable
       FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`, [as]);
  if (rows.length === 0) return false;
  const found = new Map(rows.map((row) => [row.column_name, row]));
  if (found.size !== Object.keys(spec.columns).length) throw new Error(`Incompatible existing Supplier schema: ${table}`);
  for (const [name, [type, nullable]] of Object.entries(spec.columns)) {
    const row = found.get(name);
    if (!row || String(row.column_type).toLowerCase() !== type || row.is_nullable !== nullable) {
      throw new Error(`Incompatible existing Supplier schema: ${table}.${name}`);
    }
  }
  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique, column_name AS column_name
       FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? ORDER BY index_name, seq_in_index`, [as]);
  const grouped = new Map();
  for (const row of indexRows) {
    const key = `${row.index_name}:${Number(row.non_unique)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row.column_name]);
  }
  const actual = new Set([...grouped].map(([key, columns]) => `${key}:${columns.join(",")}`));
  for (const expected of spec.indexes) {
    if (!actual.has(expected)) throw new Error(`Incompatible existing Supplier schema index: ${table}.${expected}`);
  }
  const [keyRows] = await connection.query(
    `SELECT k.constraint_name AS constraint_name, k.column_name AS column_name, k.referenced_table_name AS referenced_table,
            k.referenced_column_name AS referenced_column, r.delete_rule AS delete_rule
       FROM information_schema.key_column_usage k
       JOIN information_schema.referential_constraints r
         ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name AND r.table_name = k.table_name
      WHERE k.table_schema = DATABASE() AND k.table_name = ? AND k.referenced_table_name IS NOT NULL
      ORDER BY k.constraint_name, k.ordinal_position`, [as]);
  const keys = new Map();
  for (const row of keyRows) {
    const key = keys.get(row.constraint_name) ?? { columns: [], targets: [], table: row.referenced_table, rule: row.delete_rule };
    key.columns.push(row.column_name);
    key.targets.push(row.referenced_column);
    keys.set(row.constraint_name, key);
  }
  const actualKeys = new Set([...keys.values()].map((key) => `${key.columns.join(",")}>${key.table}(${key.targets.join(",")}):${key.rule}`));
  for (const expected of spec.foreignKeys) {
    if (!actualKeys.has(expected)) throw new Error(`Incompatible existing Supplier schema foreign key: ${table}.${expected}`);
  }
  return true;
}

/** Composite FK 要 `item_sku_uoms` 有 `UNIQUE(id, sku_id)`（Item §5.8、§5.14 保證）。 */
async function assertItemProvider(connection) {
  for (const table of ["item_skus", "item_sku_uoms"]) {
    if (!(await tableExists(connection, table))) {
      throw new Error(`Supplier SKU relations need the Item table ${table}; deploy the Item SKU/UOM schema first`);
    }
  }
  const [rows] = await connection.query(
    `SELECT index_name AS index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_list
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'item_sku_uoms' AND non_unique = 0
      GROUP BY index_name`);
  if (!rows.some((row) => row.columns_list === "id,sku_id")) {
    throw new Error("Supplier SKU relations need UNIQUE(id, sku_id) on item_sku_uoms");
  }
}

export async function up(connection) {
  const refs = await inspectSupplierSkuRelationSchema(connection, "supplier_sku_refs");
  const events = await inspectSupplierSkuRelationSchema(connection, "supplier_supply_events");
  if (refs && events) return;
  await assertItemProvider(connection);
  if (!refs) {
    await connection.query(`
      CREATE TABLE supplier_sku_refs (
        id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        supplier_id             BIGINT UNSIGNED NOT NULL,
        sku_id                  BIGINT UNSIGNED NOT NULL,
        supplier_item_code      VARCHAR(190) NOT NULL DEFAULT '',
        supplier_item_code_key  VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
        supplier_item_name      VARCHAR(190) NOT NULL DEFAULT '',
        purchase_sku_uom_id     BIGINT UNSIGNED NULL,
        minimum_order_qty       INT UNSIGNED NULL,
        standard_lead_time_days SMALLINT UNSIGNED NULL,
        relationship_status     VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'alternative',
        first_supplied_at       BIGINT UNSIGNED NULL,
        last_supplied_at        BIGINT UNSIGNED NULL,
        source                  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manual',
        version                 INT UNSIGNED NOT NULL DEFAULT 1,
        created_at              BIGINT UNSIGNED NOT NULL,
        updated_at              BIGINT UNSIGNED NOT NULL,
        created_by              BIGINT UNSIGNED NULL,
        updated_by              BIGINT UNSIGNED NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_supplier_sku_refs_supplier_sku (supplier_id, sku_id),
        UNIQUE KEY uq_supplier_sku_refs_item_code (supplier_id, supplier_item_code_key),
        KEY idx_supplier_sku_refs_sku_status_supplied (sku_id, relationship_status, last_supplied_at),
        CONSTRAINT fk_supplier_sku_refs_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
        CONSTRAINT fk_supplier_sku_refs_sku FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT,
        CONSTRAINT fk_supplier_sku_refs_purchase_uom FOREIGN KEY (purchase_sku_uom_id, sku_id)
          REFERENCES item_sku_uoms (id, sku_id) ON DELETE RESTRICT,
        CONSTRAINT fk_supplier_sku_refs_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT fk_supplier_sku_refs_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
      )
    `);
  }
  if (!events) {
    await connection.query(`
      CREATE TABLE supplier_supply_events (
        id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id       VARCHAR(64) NOT NULL,
        source_type    VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        source_id      BIGINT UNSIGNED NOT NULL,
        source_line_id BIGINT UNSIGNED NOT NULL,
        supplier_id    BIGINT UNSIGNED NOT NULL,
        sku_id         BIGINT UNSIGNED NOT NULL,
        relation_id    BIGINT UNSIGNED NOT NULL,
        supplied_at    BIGINT UNSIGNED NOT NULL,
        payload_hash   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        created_at     BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_supplier_supply_events_event (event_id),
        UNIQUE KEY uq_supplier_supply_events_source (source_type, source_id, source_line_id),
        KEY idx_supplier_supply_events_relation (relation_id, supplied_at),
        CONSTRAINT fk_supplier_supply_events_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
        CONSTRAINT fk_supplier_supply_events_sku FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT,
        CONSTRAINT fk_supplier_supply_events_relation FOREIGN KEY (relation_id) REFERENCES supplier_sku_refs (id) ON DELETE RESTRICT
      )
    `);
  }
  await inspectSupplierSkuRelationSchema(connection, "supplier_sku_refs");
  await inspectSupplierSkuRelationSchema(connection, "supplier_supply_events");
}
