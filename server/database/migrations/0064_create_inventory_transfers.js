const TABLES = {
  inventory_transfers: {
    defaults: { status: "DRAFT", reason: "", version: "1" },
    columns: {
      id: ["bigint unsigned", "NO"], transfer_number: ["varchar(50)", "NO"],
      source_warehouse_id: ["bigint unsigned", "NO"], destination_warehouse_id: ["bigint unsigned", "NO"],
      status: ["varchar(20)", "NO", "ascii_bin"], create_operation_id: ["bigint unsigned", "NO"],
      dispatch_operation_id: ["bigint unsigned", "YES"], receive_operation_id: ["bigint unsigned", "YES"],
      cancel_operation_id: ["bigint unsigned", "YES"], reason: ["varchar(500)", "NO"], version: ["int unsigned", "NO"],
      created_at: ["bigint unsigned", "NO"], updated_at: ["bigint unsigned", "NO"],
      dispatched_at: ["bigint unsigned", "YES"], received_at: ["bigint unsigned", "YES"], cancelled_at: ["bigint unsigned", "YES"],
      created_by: ["bigint unsigned", "YES"], updated_by: ["bigint unsigned", "YES"],
      dispatched_by: ["bigint unsigned", "YES"], received_by: ["bigint unsigned", "YES"], cancelled_by: ["bigint unsigned", "YES"]
    },
    indexes: ["PRIMARY:0:id", "uq_inventory_transfers_number:0:transfer_number",
      "uq_inventory_transfers_create_operation:0:create_operation_id", "uq_inventory_transfers_dispatch_operation:0:dispatch_operation_id",
      "uq_inventory_transfers_receive_operation:0:receive_operation_id", "uq_inventory_transfers_cancel_operation:0:cancel_operation_id",
      "idx_inventory_transfers_status:1:status,updated_at,id", "idx_inventory_transfers_source:1:source_warehouse_id,status,id",
      "idx_inventory_transfers_destination:1:destination_warehouse_id,status,id"],
    foreignKeys: {
      fk_inventory_transfers_source: "source_warehouse_id:inventory_warehouses:id:RESTRICT",
      fk_inventory_transfers_destination: "destination_warehouse_id:inventory_warehouses:id:RESTRICT",
      fk_inventory_transfers_create_operation: "create_operation_id:inventory_operation_requests:id:RESTRICT",
      fk_inventory_transfers_dispatch_operation: "dispatch_operation_id:inventory_operation_requests:id:RESTRICT",
      fk_inventory_transfers_receive_operation: "receive_operation_id:inventory_operation_requests:id:RESTRICT",
      fk_inventory_transfers_cancel_operation: "cancel_operation_id:inventory_operation_requests:id:RESTRICT",
      fk_inventory_transfers_created_by: "created_by:users:id:SET NULL", fk_inventory_transfers_updated_by: "updated_by:users:id:SET NULL",
      fk_inventory_transfers_dispatched_by: "dispatched_by:users:id:SET NULL", fk_inventory_transfers_received_by: "received_by:users:id:SET NULL",
      fk_inventory_transfers_cancelled_by: "cancelled_by:users:id:SET NULL"
    },
    checks: {
      chk_inventory_transfers_warehouses: "source_warehouse_id <> destination_warehouse_id",
      chk_inventory_transfers_status: "status IN ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED')",
      chk_inventory_transfers_version: "version > 0"
    }
  },
  inventory_transfer_lines: {
    defaults: { in_transit_quantity: "0", lot_number_snapshot: "", version: "1" },
    columns: {
      id: ["bigint unsigned", "NO"], transfer_id: ["bigint unsigned", "NO"], line_number: ["int unsigned", "NO"],
      sku_id: ["bigint unsigned", "NO"], lot_id: ["bigint unsigned", "YES"], source_bin_id: ["bigint unsigned", "NO"],
      destination_bin_id: ["bigint unsigned", "YES"], dispatch_stock_status: ["varchar(20)", "NO", "ascii_bin"],
      receive_stock_status: ["varchar(20)", "YES", "ascii_bin"], quantity: ["bigint unsigned", "NO"],
      in_transit_quantity: ["bigint unsigned", "NO"], dispatch_movement_group_id: ["char(36)", "YES", "ascii_bin"],
      receive_movement_group_id: ["char(36)", "YES", "ascii_bin"], sku_code_snapshot: ["varchar(190)", "NO"],
      lot_number_snapshot: ["varchar(100)", "NO"], expiry_date_snapshot: ["date", "YES"], version: ["int unsigned", "NO"]
    },
    indexes: ["PRIMARY:0:id", "uq_inventory_transfer_line_number:0:transfer_id,line_number",
      "idx_inventory_transfer_lines_in_transit:1:transfer_id,in_transit_quantity,id"],
    foreignKeys: {
      fk_inventory_transfer_lines_transfer: "transfer_id:inventory_transfers:id:RESTRICT",
      fk_inventory_transfer_lines_sku: "sku_id:item_skus:id:RESTRICT",
      fk_inventory_transfer_lines_lot: "lot_id,sku_id:inventory_lots:id,sku_id:RESTRICT",
      fk_inventory_transfer_lines_source_bin: "source_bin_id:inventory_bins:id:RESTRICT",
      fk_inventory_transfer_lines_destination_bin: "destination_bin_id:inventory_bins:id:RESTRICT"
    },
    checks: {
      chk_inventory_transfer_lines_quantity: "quantity > 0",
      chk_inventory_transfer_lines_in_transit: "in_transit_quantity IN (0, quantity)",
      chk_inventory_transfer_lines_dispatch_status: "dispatch_stock_status IN ('AVAILABLE', 'QUARANTINED', 'DAMAGED')",
      chk_inventory_transfer_lines_receive_status: "receive_stock_status IS NULL OR receive_stock_status = dispatch_stock_status OR receive_stock_status = 'QUARANTINED'",
      chk_inventory_transfer_lines_number: "line_number > 0", chk_inventory_transfer_lines_version: "version > 0"
    }
  }
};
const MOVEMENT_KEYS = {
  fk_inventory_movements_transfer: "transfer_id:inventory_transfers:id:RESTRICT",
  fk_inventory_movements_transfer_line: "transfer_line_id:inventory_transfer_lines:id:RESTRICT"
};

function incompatible(kind, name) {
  throw new Error(`Incompatible existing Inventory transfer ${kind}: ${name}`);
}

async function foreignKeys(connection) {
  const [rows] = await connection.query(`SELECT k.table_name AS table_name, k.constraint_name AS constraint_name, k.column_name AS column_name,
    k.referenced_table_name AS referenced_table_name, k.referenced_column_name AS referenced_column_name,
    k.table_schema AS table_schema, k.referenced_table_schema AS referenced_table_schema,
    r.delete_rule AS delete_rule, r.update_rule AS update_rule
    FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r
      ON r.constraint_schema = k.constraint_schema AND r.table_name = k.table_name AND r.constraint_name = k.constraint_name
    WHERE k.table_schema = DATABASE() AND k.table_name IN ('inventory_transfers', 'inventory_transfer_lines', 'inventory_movements')
    ORDER BY k.table_name, k.constraint_name, k.ordinal_position`);
  const grouped = new Map();
  for (const row of rows) {
    if (row.table_schema !== row.referenced_table_schema) incompatible("foreign key", row.constraint_name);
    const key = `${row.table_name}:${row.constraint_name}`;
    if (!grouped.has(key)) grouped.set(key, { columns: [], parents: [], row });
    const group = grouped.get(key);
    group.columns.push(row.column_name);
    group.parents.push(row.referenced_column_name);
  }
  return new Map([...grouped].map(([key, { columns, parents, row }]) => [key,
    `${columns.join(",")}:${row.referenced_table_name}:${parents.join(",")}:${row.delete_rule}:${row.update_rule}`]));
}

function normalizeCheck(clause) {
  return String(clause).replace(/_(?:ascii|utf8mb4)/giu, "").replace(/\\'/gu, "'")
    .split(/('[^']*')/u).map((part, index) => index % 2 ? part : part
      .replace(/\b(?:IN|IS|NULL|OR)\b/giu, (keyword) => keyword.toUpperCase()).replace(/[\s`()]/gu, "")).join("");
}

export async function inspectInventoryTransferSchema(connection) {
  const [columns] = await connection.query(`SELECT table_name AS table_name, column_name AS column_name, column_type AS column_type,
    is_nullable AS is_nullable, collation_name AS collation_name, extra AS extra, column_default AS column_default
    FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN ('inventory_transfers', 'inventory_transfer_lines')`);
  const foundTables = new Set(columns.map((row) => row.table_name));
  for (const table of foundTables) {
    const expected = TABLES[table].columns;
    const found = new Map(columns.filter((row) => row.table_name === table).map((row) => [row.column_name, row]));
    if (found.size !== Object.keys(expected).length) incompatible("columns", table);
    for (const [name, [type, nullable, collation]] of Object.entries(expected)) {
      const row = found.get(name);
      if (!row || row.column_type.toLowerCase() !== type || row.is_nullable !== nullable ||
          (collation && row.collation_name !== collation) || (name === "id" && row.extra !== "auto_increment")) {
        incompatible("columns", `${table}.${name}`);
      }
    }
    for (const [name, value] of Object.entries(TABLES[table].defaults)) {
      if (String(found.get(name).column_default) !== value) incompatible("columns", `${table}.${name} default`);
    }
  }
  const [indexRows] = await connection.query(`SELECT table_name AS table_name, index_name AS index_name, non_unique AS non_unique,
    column_name AS column_name, sub_part AS sub_part
    FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name IN ('inventory_transfers', 'inventory_transfer_lines')
    ORDER BY table_name, index_name, seq_in_index`);
  const grouped = new Map();
  for (const row of indexRows) {
    const key = `${row.table_name}:${row.index_name}:${Number(row.non_unique)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row.sub_part === null ? row.column_name : `${row.column_name}(${row.sub_part})`);
  }
  const indexes = new Set([...grouped].map(([key, names]) => `${key}:${names.join(",")}`));
  const keys = await foreignKeys(connection);
  const [checkRows] = await connection.query(`SELECT tc.table_name AS table_name, tc.constraint_name AS constraint_name,
    tc.enforced AS enforced, cc.check_clause AS check_clause
    FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc
      ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE() AND tc.table_name IN ('inventory_transfers', 'inventory_transfer_lines')`);
  const checks = new Map(checkRows.map((row) => [`${row.table_name}:${row.constraint_name}`, row]));
  for (const table of foundTables) {
    const definition = TABLES[table];
    for (const index of definition.indexes) if (!indexes.has(`${table}:${index}`)) incompatible("index", `${table}:${index}`);
    for (const [name, rule] of Object.entries(definition.foreignKeys)) {
      if (keys.get(`${table}:${name}`) !== `${rule}:NO ACTION`) incompatible("foreign key", `${table}:${name}`);
    }
    for (const [name, clause] of Object.entries(definition.checks)) {
      const actual = checks.get(`${table}:${name}`);
      if (!actual || actual.enforced !== "YES" || normalizeCheck(actual.check_clause) !== normalizeCheck(clause)) incompatible("check", `${table}:${name}`);
    }
  }
  let movementsComplete = true;
  for (const [name, rule] of Object.entries(MOVEMENT_KEYS)) {
    const actual = keys.get(`inventory_movements:${name}`);
    if (actual === undefined) movementsComplete = false;
    else if (actual !== `${rule}:NO ACTION`) incompatible("foreign key", name);
  }
  return Object.keys(TABLES).every((table) => foundTables.has(table)) && movementsComplete;
}

export async function up(connection) {
  if (await inspectInventoryTransferSchema(connection)) return;
  await connection.query(`CREATE TABLE IF NOT EXISTS inventory_transfers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transfer_number VARCHAR(50) NOT NULL,
    source_warehouse_id BIGINT UNSIGNED NOT NULL, destination_warehouse_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
    create_operation_id BIGINT UNSIGNED NOT NULL, dispatch_operation_id BIGINT UNSIGNED NULL,
    receive_operation_id BIGINT UNSIGNED NULL, cancel_operation_id BIGINT UNSIGNED NULL,
    reason VARCHAR(500) NOT NULL DEFAULT '', version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at BIGINT UNSIGNED NOT NULL, updated_at BIGINT UNSIGNED NOT NULL,
    dispatched_at BIGINT UNSIGNED NULL, received_at BIGINT UNSIGNED NULL, cancelled_at BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NULL, dispatched_by BIGINT UNSIGNED NULL,
    received_by BIGINT UNSIGNED NULL, cancelled_by BIGINT UNSIGNED NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_inventory_transfers_number (transfer_number),
    UNIQUE KEY uq_inventory_transfers_create_operation (create_operation_id),
    UNIQUE KEY uq_inventory_transfers_dispatch_operation (dispatch_operation_id),
    UNIQUE KEY uq_inventory_transfers_receive_operation (receive_operation_id),
    UNIQUE KEY uq_inventory_transfers_cancel_operation (cancel_operation_id),
    KEY idx_inventory_transfers_status (status, updated_at, id),
    KEY idx_inventory_transfers_source (source_warehouse_id, status, id),
    KEY idx_inventory_transfers_destination (destination_warehouse_id, status, id),
    CONSTRAINT chk_inventory_transfers_warehouses CHECK (source_warehouse_id <> destination_warehouse_id),
    CONSTRAINT chk_inventory_transfers_status CHECK (status IN ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED')),
    CONSTRAINT chk_inventory_transfers_version CHECK (version > 0),
    CONSTRAINT fk_inventory_transfers_source FOREIGN KEY (source_warehouse_id) REFERENCES inventory_warehouses (id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfers_destination FOREIGN KEY (destination_warehouse_id) REFERENCES inventory_warehouses (id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfers_create_operation FOREIGN KEY (create_operation_id) REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfers_dispatch_operation FOREIGN KEY (dispatch_operation_id) REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfers_receive_operation FOREIGN KEY (receive_operation_id) REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfers_cancel_operation FOREIGN KEY (cancel_operation_id) REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfers_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_transfers_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_transfers_dispatched_by FOREIGN KEY (dispatched_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_transfers_received_by FOREIGN KEY (received_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_transfers_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await connection.query(`CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, transfer_id BIGINT UNSIGNED NOT NULL, line_number INT UNSIGNED NOT NULL,
    sku_id BIGINT UNSIGNED NOT NULL, lot_id BIGINT UNSIGNED NULL,
    source_bin_id BIGINT UNSIGNED NOT NULL, destination_bin_id BIGINT UNSIGNED NULL,
    dispatch_stock_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    receive_stock_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    quantity BIGINT UNSIGNED NOT NULL, in_transit_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
    dispatch_movement_group_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    receive_movement_group_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    sku_code_snapshot VARCHAR(190) NOT NULL, lot_number_snapshot VARCHAR(100) NOT NULL DEFAULT '', expiry_date_snapshot DATE NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1, PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_transfer_line_number (transfer_id, line_number),
    KEY idx_inventory_transfer_lines_in_transit (transfer_id, in_transit_quantity, id),
    CONSTRAINT chk_inventory_transfer_lines_quantity CHECK (quantity > 0),
    CONSTRAINT chk_inventory_transfer_lines_in_transit CHECK (in_transit_quantity IN (0, quantity)),
    CONSTRAINT chk_inventory_transfer_lines_dispatch_status CHECK (dispatch_stock_status IN ('AVAILABLE', 'QUARANTINED', 'DAMAGED')),
    CONSTRAINT chk_inventory_transfer_lines_receive_status CHECK (receive_stock_status IS NULL OR receive_stock_status = dispatch_stock_status OR receive_stock_status = 'QUARANTINED'),
    CONSTRAINT chk_inventory_transfer_lines_number CHECK (line_number > 0), CONSTRAINT chk_inventory_transfer_lines_version CHECK (version > 0),
    CONSTRAINT fk_inventory_transfer_lines_transfer FOREIGN KEY (transfer_id) REFERENCES inventory_transfers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfer_lines_sku FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfer_lines_lot FOREIGN KEY (lot_id, sku_id) REFERENCES inventory_lots (id, sku_id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfer_lines_source_bin FOREIGN KEY (source_bin_id) REFERENCES inventory_bins (id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfer_lines_destination_bin FOREIGN KEY (destination_bin_id) REFERENCES inventory_bins (id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const keys = await foreignKeys(connection);
  for (const [name, rule] of Object.entries(MOVEMENT_KEYS)) {
    if (keys.has(`inventory_movements:${name}`)) continue;
    const [column, table] = rule.split(":");
    await connection.query(`ALTER TABLE inventory_movements ADD CONSTRAINT ${name}
      FOREIGN KEY (${column}) REFERENCES ${table} (id) ON DELETE RESTRICT`);
  }
  if (!await inspectInventoryTransferSchema(connection)) throw new Error("Incomplete Inventory transfer migration");
}
