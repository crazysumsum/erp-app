const TABLES = {
  inventory_stocktakes: {
    columns: {
      id: ["bigint unsigned", "NO"], stocktake_number: ["varchar(50)", "NO"], warehouse_id: ["bigint unsigned", "NO"],
      status: ["varchar(30)", "NO", "ascii_bin"],
      ...Object.fromEntries(["create", "start", "ready", "post", "cancel"].map(name => [`${name}_operation_id`, ["bigint unsigned", name === "create" ? "NO" : "YES"]])),
      reason: ["varchar(500)", "NO"], version: ["int unsigned", "NO"],
      ...Object.fromEntries(["created", "updated", "started", "ready", "posted", "cancelled"].flatMap(name => [
        [`${name}_at`, ["bigint unsigned", ["created", "updated"].includes(name) ? "NO" : "YES"]], [`${name}_by`, ["bigint unsigned", "YES"]]
      ]))
    },
    defaults: { status: "DRAFT", reason: "", version: 1 },
    indexes: ["PRIMARY:0:id", "uq_inventory_stocktakes_number:0:stocktake_number",
      ...["create", "start", "ready", "post", "cancel"].map(name => `uq_inventory_stocktakes_${name}_operation:0:${name}_operation_id`),
      "idx_inventory_stocktakes_list:1:warehouse_id,status,updated_at,id", "idx_inventory_stocktakes_status:1:status,updated_at,id"],
    keys: {
      fk_inventory_stocktakes_warehouse: "warehouse_id:inventory_warehouses:id:RESTRICT",
      ...Object.fromEntries(["create", "start", "ready", "post", "cancel"].map(name => [`fk_inventory_stocktakes_${name}_operation`, `${name}_operation_id:inventory_operation_requests:id:RESTRICT`])),
      ...Object.fromEntries(["created", "updated", "started", "ready", "posted", "cancelled"].map(name => [`fk_inventory_stocktakes_${name}_by`, `${name}_by:users:id:SET NULL`]))
    },
    checks: { chk_inventory_stocktakes_status: "status IN ('DRAFT', 'COUNTING', 'READY_TO_POST', 'POSTED', 'CANCELLED')", chk_inventory_stocktakes_version: "version > 0" }
  },
  inventory_stocktake_bins: {
    columns: { id: ["bigint unsigned", "NO"], stocktake_id: ["bigint unsigned", "NO"], bin_id: ["bigint unsigned", "NO"],
      bin_code_snapshot: ["varchar(50)", "NO"], created_at: ["bigint unsigned", "NO"] },
    indexes: ["PRIMARY:0:id", "uq_inventory_stocktake_bin:0:stocktake_id,bin_id", "uq_inventory_stocktake_bin_owner:0:id,stocktake_id,bin_id"],
    keys: { fk_inventory_stocktake_bins_header: "stocktake_id:inventory_stocktakes:id:RESTRICT", fk_inventory_stocktake_bins_bin: "bin_id:inventory_bins:id:RESTRICT" }
  },
  inventory_bin_locks: {
    columns: { id: ["bigint unsigned", "NO"], bin_id: ["bigint unsigned", "NO"], lock_type: ["varchar(20)", "NO", "ascii_bin"],
      stocktake_id: ["bigint unsigned", "NO"], stocktake_bin_id: ["bigint unsigned", "NO"], locked_at: ["bigint unsigned", "NO"],
      locked_by: ["bigint unsigned", "YES"], released_at: ["bigint unsigned", "YES"], released_by: ["bigint unsigned", "YES"],
      release_reason: ["varchar(100)", "NO"], active_scope: ["tinyint", "YES"] },
    defaults: { release_reason: "" }, generated: { active_scope: "IF(released_at IS NULL,1,NULL)" },
    indexes: ["PRIMARY:0:id", "uq_inventory_bin_active_lock:0:bin_id,active_scope", "idx_inventory_bin_locks_owner:1:stocktake_id,released_at,id"],
    keys: { fk_inventory_bin_locks_owner: "stocktake_bin_id,stocktake_id,bin_id:inventory_stocktake_bins:id,stocktake_id,bin_id:RESTRICT",
      fk_inventory_bin_locks_locked_by: "locked_by:users:id:SET NULL", fk_inventory_bin_locks_released_by: "released_by:users:id:SET NULL" },
    checks: { chk_inventory_bin_locks_type: "lock_type = 'STOCKTAKE'" }
  },
  inventory_stocktake_lines: {
    columns: { id: ["bigint unsigned", "NO"], stocktake_id: ["bigint unsigned", "NO"], stocktake_bin_id: ["bigint unsigned", "NO"],
      stock_balance_id: ["bigint unsigned", "YES"], bin_id: ["bigint unsigned", "NO"], sku_id: ["bigint unsigned", "NO"],
      lot_id: ["bigint unsigned", "YES"], stock_status: ["varchar(20)", "NO", "ascii_bin"], lot_scope: ["bigint unsigned", "YES"],
      snapshot_quantity: ["bigint unsigned", "NO"], snapshot_balance_version: ["int unsigned", "NO"], counted_quantity: ["bigint unsigned", "YES"],
      is_not_found: ["tinyint(1)", "NO"], variance_quantity: ["bigint", "YES"], movement_id: ["bigint unsigned", "YES"], version: ["int unsigned", "NO"],
      counted_at: ["bigint unsigned", "YES"], counted_by: ["bigint unsigned", "YES"] },
    defaults: { snapshot_quantity: 0, snapshot_balance_version: 0, is_not_found: 0, version: 1 }, generated: { lot_scope: "IFNULL(lot_id,0)" },
    indexes: ["PRIMARY:0:id", "uq_inventory_stocktake_dimension:0:stocktake_id,bin_id,sku_id,lot_scope,stock_status",
      "idx_inventory_stocktake_lines_progress:1:stocktake_id,counted_quantity,is_not_found,id"],
    keys: { fk_inventory_stocktake_lines_owner: "stocktake_bin_id,stocktake_id,bin_id:inventory_stocktake_bins:id,stocktake_id,bin_id:RESTRICT",
      fk_inventory_stocktake_lines_balance: "stock_balance_id:inventory_stock_balances:id:RESTRICT", fk_inventory_stocktake_lines_sku: "sku_id:item_skus:id:RESTRICT",
      fk_inventory_stocktake_lines_lot: "lot_id,sku_id:inventory_lots:id,sku_id:RESTRICT", fk_inventory_stocktake_lines_movement: "movement_id:inventory_movements:id:RESTRICT",
      fk_inventory_stocktake_lines_counted_by: "counted_by:users:id:SET NULL" },
    checks: { chk_inventory_stocktake_lines_status: "stock_status IN ('AVAILABLE', 'QUARANTINED', 'DAMAGED')",
      chk_inventory_stocktake_lines_not_found: "is_not_found IN (0, 1)", chk_inventory_stocktake_lines_version: "version > 0" }
  }
};
const MOVEMENT_KEYS = { fk_inventory_movements_stocktake: "stocktake_id:inventory_stocktakes:id:RESTRICT",
  fk_inventory_movements_stocktake_line: "stocktake_line_id:inventory_stocktake_lines:id:RESTRICT" };
const TABLE_NAMES = "'inventory_stocktakes', 'inventory_stocktake_bins', 'inventory_bin_locks', 'inventory_stocktake_lines'";

function incompatible(kind, name) { throw new Error(`Incompatible existing Inventory stocktake ${kind}: ${name}`); }
function normalize(clause) {
  return String(clause).replace(/\\'/gu, "'")
    .split(/('[^']*')/u).map((part, index) => index % 2 ? part : part
      .replace(/_(?:ascii|utf8mb4)/giu, "").replace(/\b(?:IN|IS|NULL|OR|IF|IFNULL)\b/giu, word => word.toUpperCase()).replace(/[\s`()]/gu, "")).join("");
}
async function foreignKeys(connection) {
  const [rows] = await connection.query(`SELECT k.table_name AS table_name, k.constraint_name AS constraint_name,
    k.column_name AS column_name, k.referenced_table_name AS referenced_table_name, k.referenced_column_name AS referenced_column_name,
    k.table_schema AS table_schema, k.referenced_table_schema AS referenced_table_schema, r.delete_rule AS delete_rule, r.update_rule AS update_rule
    FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r
      ON r.constraint_schema = k.constraint_schema AND r.table_name = k.table_name AND r.constraint_name = k.constraint_name
    WHERE k.table_schema = DATABASE() AND k.table_name IN (${TABLE_NAMES}, 'inventory_movements')
    ORDER BY k.table_name, k.constraint_name, k.ordinal_position`);
  const grouped = new Map();
  for (const row of rows) {
    if (row.table_schema !== row.referenced_table_schema) incompatible("foreign key", row.constraint_name);
    const name = `${row.table_name}:${row.constraint_name}`;
    if (!grouped.has(name)) grouped.set(name, { columns: [], parents: [], row });
    const value = grouped.get(name); value.columns.push(row.column_name); value.parents.push(row.referenced_column_name);
  }
  return new Map([...grouped].map(([name, { columns, parents, row }]) => [name,
    `${columns.join(",")}:${row.referenced_table_name}:${parents.join(",")}:${row.delete_rule}:${row.update_rule}`]));
}
export async function inspectInventoryStocktakeSchema(connection) {
  const [rows] = await connection.query(`SELECT table_name AS table_name, column_name AS column_name, column_type AS column_type,
    is_nullable AS is_nullable, collation_name AS collation_name, extra AS extra, column_default AS column_default, generation_expression AS generation_expression
    FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN (${TABLE_NAMES})`);
  const found = new Set(rows.map(row => row.table_name));
  for (const table of found) {
    const definition = TABLES[table];
    const columns = new Map(rows.filter(row => row.table_name === table).map(row => [row.column_name, row]));
    if (columns.size !== Object.keys(definition.columns).length) incompatible("columns", table);
    for (const [name, [type, nullable, collation]] of Object.entries(definition.columns)) {
      const row = columns.get(name);
      if (!row || row.column_type.toLowerCase() !== type || row.is_nullable !== nullable ||
          (collation && row.collation_name !== collation) || (name === "id" && row.extra !== "auto_increment")) incompatible("columns", `${table}.${name}`);
      const value = definition.defaults?.[name];
      if (value === undefined ? row.column_default !== null : String(row.column_default) !== String(value)) incompatible("default", `${table}.${name}`);
      const expression = definition.generated?.[name];
      if (expression ? row.extra !== "STORED GENERATED" || normalize(row.generation_expression) !== normalize(expression) : row.generation_expression !== "") {
        incompatible("generated", `${table}.${name}`);
      }
    }
  }
  const [indexRows] = await connection.query(`SELECT table_name AS table_name, index_name AS index_name, non_unique AS non_unique,
    column_name AS column_name, sub_part AS sub_part FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name IN (${TABLE_NAMES}) ORDER BY table_name, index_name, seq_in_index`);
  const grouped = new Map();
  for (const row of indexRows) {
    const name = `${row.table_name}:${row.index_name}:${Number(row.non_unique)}`;
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(row.sub_part === null ? row.column_name : `${row.column_name}(${row.sub_part})`);
  }
  const indexes = new Set([...grouped].map(([name, fields]) => `${name}:${fields.join(",")}`));
  const keys = await foreignKeys(connection);
  const [checkRows] = await connection.query(`SELECT tc.table_name AS table_name, tc.constraint_name AS constraint_name,
    tc.enforced AS enforced, cc.check_clause AS check_clause FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE() AND tc.table_name IN (${TABLE_NAMES})`);
  const checks = new Map(checkRows.map(row => [`${row.table_name}:${row.constraint_name}`, row]));
  for (const table of found) {
    const definition = TABLES[table];
    for (const index of definition.indexes) if (!indexes.has(`${table}:${index}`)) incompatible("index", `${table}:${index}`);
    for (const [name, rule] of Object.entries(definition.keys)) if (keys.get(`${table}:${name}`) !== `${rule}:NO ACTION`) incompatible("foreign key", `${table}:${name}`);
    for (const [name, clause] of Object.entries(definition.checks ?? {})) {
      const row = checks.get(`${table}:${name}`);
      if (!row || row.enforced !== "YES" || normalize(row.check_clause) !== normalize(clause)) incompatible("check", `${table}:${name}`);
    }
  }
  let movementsComplete = true;
  for (const [name, rule] of Object.entries(MOVEMENT_KEYS)) {
    const actual = keys.get(`inventory_movements:${name}`);
    if (actual === undefined) movementsComplete = false;
    else if (actual !== `${rule}:NO ACTION`) incompatible("foreign key", name);
  }
  return Object.keys(TABLES).every(table => found.has(table)) && movementsComplete;
}
function keySql(name, rule) {
  const [columns, table, parents, onDelete] = rule.split(":");
  return `CONSTRAINT ${name} FOREIGN KEY (${columns}) REFERENCES ${table} (${parents}) ON DELETE ${onDelete}`;
}
export async function up(connection) {
  if (await inspectInventoryStocktakeSchema(connection)) return;
  // One declaration drives DDL and rerun inspection so the four table shapes cannot drift apart.
  for (const [table, definition] of Object.entries(TABLES)) {
    const columns = Object.entries(definition.columns).map(([name, [type, nullable, collation]]) => {
      const expression = definition.generated?.[name];
      if (expression) return `${name} ${type} GENERATED ALWAYS AS (${expression}) STORED`;
      const value = definition.defaults?.[name];
      return `${name} ${type}${collation ? " CHARACTER SET ascii COLLATE ascii_bin" : ""} ${nullable === "YES" ? "NULL" : "NOT NULL"}` +
        (name === "id" ? " AUTO_INCREMENT" : "") + (value === undefined ? "" : ` DEFAULT ${typeof value === "number" ? value : `'${value}'`}`);
    });
    const indexes = definition.indexes.map(value => {
      const [name, nonUnique, fields] = value.split(":");
      return name === "PRIMARY" ? `PRIMARY KEY (${fields})` : `${nonUnique === "0" ? "UNIQUE " : ""}KEY ${name} (${fields})`;
    });
    const constraints = [...Object.entries(definition.keys).map(([name, rule]) => keySql(name, rule)),
      ...Object.entries(definition.checks ?? {}).map(([name, clause]) => `CONSTRAINT ${name} CHECK (${clause})`)];
    await connection.query(`CREATE TABLE IF NOT EXISTS ${table} (${[...columns, ...indexes, ...constraints].join(",\n")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  const keys = await foreignKeys(connection);
  for (const [name, rule] of Object.entries(MOVEMENT_KEYS)) {
    if (!keys.has(`inventory_movements:${name}`)) await connection.query(`ALTER TABLE inventory_movements ADD ${keySql(name, rule)}`);
  }
  if (!await inspectInventoryStocktakeSchema(connection)) throw new Error("Incomplete Inventory stocktake migration");
}
