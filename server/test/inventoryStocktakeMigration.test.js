import assert from "node:assert/strict";
import test from "node:test";
import { inspectInventoryStocktakeSchema, up } from "../database/migrations/0065_create_inventory_stocktakes.js";

const headers = {
  id: "bigint unsigned", stocktake_number: "varchar(50)", warehouse_id: "bigint unsigned", status: "varchar(30)",
  create_operation_id: "bigint unsigned", start_operation_id: "bigint unsigned", ready_operation_id: "bigint unsigned",
  post_operation_id: "bigint unsigned", cancel_operation_id: "bigint unsigned", reason: "varchar(500)", version: "int unsigned",
  created_at: "bigint unsigned", updated_at: "bigint unsigned", started_at: "bigint unsigned", ready_at: "bigint unsigned",
  posted_at: "bigint unsigned", cancelled_at: "bigint unsigned", created_by: "bigint unsigned", updated_by: "bigint unsigned",
  started_by: "bigint unsigned", ready_by: "bigint unsigned", posted_by: "bigint unsigned", cancelled_by: "bigint unsigned"
};
const columns = {
  inventory_stocktakes: headers,
  inventory_stocktake_bins: { id: "bigint unsigned", stocktake_id: "bigint unsigned", bin_id: "bigint unsigned", bin_code_snapshot: "varchar(50)", created_at: "bigint unsigned" },
  inventory_bin_locks: { id: "bigint unsigned", bin_id: "bigint unsigned", lock_type: "varchar(20)", stocktake_id: "bigint unsigned",
    stocktake_bin_id: "bigint unsigned", locked_at: "bigint unsigned", locked_by: "bigint unsigned", released_at: "bigint unsigned",
    released_by: "bigint unsigned", release_reason: "varchar(100)", active_scope: "tinyint" },
  inventory_stocktake_lines: { id: "bigint unsigned", stocktake_id: "bigint unsigned", stocktake_bin_id: "bigint unsigned",
    stock_balance_id: "bigint unsigned", bin_id: "bigint unsigned", sku_id: "bigint unsigned", lot_id: "bigint unsigned",
    stock_status: "varchar(20)", lot_scope: "bigint unsigned", snapshot_quantity: "bigint unsigned", snapshot_balance_version: "int unsigned",
    counted_quantity: "bigint unsigned", is_not_found: "tinyint(1)", variance_quantity: "bigint", movement_id: "bigint unsigned",
    version: "int unsigned", counted_at: "bigint unsigned", counted_by: "bigint unsigned" }
};
const optional = new Set(["start_operation_id", "ready_operation_id", "post_operation_id", "cancel_operation_id", "started_at", "ready_at",
  "posted_at", "cancelled_at", "stock_balance_id", "lot_id", "lot_scope", "counted_quantity", "variance_quantity", "movement_id",
  "counted_at", "locked_by", "released_at", "released_by", "active_scope"]);
const defaults = { status: "DRAFT", reason: "", release_reason: "", version: "1", snapshot_quantity: "0", snapshot_balance_version: "0", is_not_found: "0" };
const expressions = { active_scope: "if((`released_at` is null),1,NULL)", lot_scope: "ifnull(`lot_id`,0)" };
const indexDefinitions = {
  inventory_stocktakes: ["PRIMARY:0:id", "uq_inventory_stocktakes_number:0:stocktake_number", ...["create", "start", "ready", "post", "cancel"].map(name => `uq_inventory_stocktakes_${name}_operation:0:${name}_operation_id`),
    "idx_inventory_stocktakes_list:1:warehouse_id,status,updated_at,id", "idx_inventory_stocktakes_status:1:status,updated_at,id"],
  inventory_stocktake_bins: ["PRIMARY:0:id", "uq_inventory_stocktake_bin:0:stocktake_id,bin_id", "uq_inventory_stocktake_bin_owner:0:id,stocktake_id,bin_id"],
  inventory_bin_locks: ["PRIMARY:0:id", "uq_inventory_bin_active_lock:0:bin_id,active_scope", "idx_inventory_bin_locks_owner:1:stocktake_id,released_at,id"],
  inventory_stocktake_lines: ["PRIMARY:0:id", "uq_inventory_stocktake_dimension:0:stocktake_id,bin_id,sku_id,lot_scope,stock_status",
    "idx_inventory_stocktake_lines_progress:1:stocktake_id,counted_quantity,is_not_found,id"]
};
const foreignDefinitions = {
  inventory_stocktakes: {
    fk_inventory_stocktakes_warehouse: "warehouse_id:inventory_warehouses:id:RESTRICT",
    ...Object.fromEntries(["create", "start", "ready", "post", "cancel"].map(name => [`fk_inventory_stocktakes_${name}_operation`, `${name}_operation_id:inventory_operation_requests:id:RESTRICT`])),
    ...Object.fromEntries(["created", "updated", "started", "ready", "posted", "cancelled"].map(name => [`fk_inventory_stocktakes_${name}_by`, `${name}_by:users:id:SET NULL`]))
  },
  inventory_stocktake_bins: { fk_inventory_stocktake_bins_header: "stocktake_id:inventory_stocktakes:id:RESTRICT", fk_inventory_stocktake_bins_bin: "bin_id:inventory_bins:id:RESTRICT" },
  inventory_bin_locks: { fk_inventory_bin_locks_owner: "stocktake_bin_id,stocktake_id,bin_id:inventory_stocktake_bins:id,stocktake_id,bin_id:RESTRICT",
    fk_inventory_bin_locks_locked_by: "locked_by:users:id:SET NULL", fk_inventory_bin_locks_released_by: "released_by:users:id:SET NULL" },
  inventory_stocktake_lines: { fk_inventory_stocktake_lines_owner: "stocktake_bin_id,stocktake_id,bin_id:inventory_stocktake_bins:id,stocktake_id,bin_id:RESTRICT",
    fk_inventory_stocktake_lines_balance: "stock_balance_id:inventory_stock_balances:id:RESTRICT", fk_inventory_stocktake_lines_sku: "sku_id:item_skus:id:RESTRICT",
    fk_inventory_stocktake_lines_lot: "lot_id,sku_id:inventory_lots:id,sku_id:RESTRICT", fk_inventory_stocktake_lines_movement: "movement_id:inventory_movements:id:RESTRICT",
    fk_inventory_stocktake_lines_counted_by: "counted_by:users:id:SET NULL" },
  inventory_movements: { fk_inventory_movements_stocktake: "stocktake_id:inventory_stocktakes:id:RESTRICT", fk_inventory_movements_stocktake_line: "stocktake_line_id:inventory_stocktake_lines:id:RESTRICT" }
};
const checkDefinitions = {
  inventory_stocktakes: { chk_inventory_stocktakes_status: "status IN ('DRAFT', 'COUNTING', 'READY_TO_POST', 'POSTED', 'CANCELLED')", chk_inventory_stocktakes_version: "version > 0" },
  inventory_bin_locks: { chk_inventory_bin_locks_type: "lock_type = 'STOCKTAKE'" },
  inventory_stocktake_lines: { chk_inventory_stocktake_lines_status: "stock_status IN ('AVAILABLE', 'QUARANTINED', 'DAMAGED')",
    chk_inventory_stocktake_lines_not_found: "is_not_found IN (0, 1)", chk_inventory_stocktake_lines_version: "version > 0" }
};

function metadata() {
  return {
    columns: Object.entries(columns).flatMap(([table_name, fields]) => Object.entries(fields).map(([column_name, column_type]) => ({
      table_name, column_name, column_type, is_nullable: optional.has(column_name) || column_name.endsWith("_by") ? "YES" : "NO",
      collation_name: ["status", "stock_status", "lock_type"].includes(column_name) ? "ascii_bin" : null,
      extra: column_name === "id" ? "auto_increment" : expressions[column_name] ? "STORED GENERATED" : "",
      column_default: defaults[column_name] ?? null, generation_expression: expressions[column_name] ?? ""
    }))),
    indexes: Object.entries(indexDefinitions).flatMap(([table_name, definitions]) => definitions.flatMap(value => {
      const [index_name, non_unique, names] = value.split(":");
      return names.split(",").map(column_name => ({ table_name, index_name, non_unique: Number(non_unique), column_name, sub_part: null }));
    })),
    keys: Object.entries(foreignDefinitions).flatMap(([table_name, definitions]) => Object.entries(definitions).flatMap(([constraint_name, value]) => {
      const [names, referenced_table_name, parents, delete_rule] = value.split(":");
      return names.split(",").map((column_name, index) => ({ table_name, constraint_name, column_name, referenced_table_name,
        referenced_column_name: parents.split(",")[index], table_schema: "owned", referenced_table_schema: "owned", delete_rule, update_rule: "NO ACTION" }));
    })),
    checks: Object.entries(checkDefinitions).flatMap(([table_name, definitions]) => Object.entries(definitions).map(([constraint_name, check_clause]) => ({ table_name, constraint_name, check_clause, enforced: "YES" })))
  };
}
function connection(rows) {
  const statements = [];
  return { statements, query: async sql => {
    statements.push(sql);
    if (sql.includes("information_schema.columns")) return [rows.columns];
    if (sql.includes("information_schema.statistics")) return [rows.indexes];
    if (sql.includes("information_schema.key_column_usage")) return [rows.keys];
    if (sql.includes("information_schema.check_constraints")) return [rows.checks];
    return [[]];
  } };
}
async function rejectsBeforeDdl(mutator, pattern) {
  const rows = metadata(); mutator(rows); const db = connection(rows);
  await assert.rejects(up(db), pattern);
  assert.equal(db.statements.some(sql => /^\s*(CREATE|ALTER)/u.test(sql)), false);
}

test("MIG035-U01 absent schema creates parents before children and attaches Movement FKs last", async () => {
  const db = connection({ columns: [], indexes: [], keys: [], checks: [] });
  assert.equal(await inspectInventoryStocktakeSchema(db), false);
  await assert.rejects(up(db), /Incomplete Inventory stocktake migration/u);
  assert.deepEqual(db.statements.filter(sql => /^CREATE/u.test(sql)).map(sql => /CREATE TABLE IF NOT EXISTS (\w+)/u.exec(sql)[1]),
    ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_bin_locks", "inventory_stocktake_lines"]);
  assert.equal(db.statements.filter(sql => /^ALTER/u.test(sql)).length, 2);
});
test("MIG035-U02 complete compatible schema is a no-op preserving all history", async () => {
  const db = connection(metadata());
  assert.equal(await inspectInventoryStocktakeSchema(db), true);
  await up(db); await up(db);
  assert.equal(db.statements.some(sql => /^\s*(CREATE|ALTER|UPDATE|DELETE)/u.test(sql)), false);
});
test("MIG035-U03 column type, nullability and actor drift reject before DDL", async () => {
  for (const change of [row => { row.column_type = "bigint"; }, row => { row.is_nullable = "NO"; }]) {
    await rejectsBeforeDdl(rows => change(rows.columns.find(row => row.column_name === "counted_by")), /Incompatible.*columns/u);
  }
  await rejectsBeforeDdl(rows => rows.columns.pop(), /Incompatible.*columns/u);
});
test("MIG035-U04 default and generated expression drift reject before DDL", async () => {
  await rejectsBeforeDdl(rows => { rows.columns.find(row => row.column_name === "counted_quantity").column_default = "0"; }, /Incompatible.*default/u);
  for (const name of ["lot_scope", "active_scope"]) {
    await rejectsBeforeDdl(rows => { rows.columns.find(row => row.column_name === name).generation_expression = "0"; }, /Incompatible.*generated/u);
    await rejectsBeforeDdl(rows => { rows.columns.find(row => row.column_name === name).extra = "VIRTUAL GENERATED"; }, /Incompatible.*generated/u);
  }
});
test("MIG035-U05 indexes and enforced checks reject drift before DDL", async () => {
  await rejectsBeforeDdl(rows => { rows.indexes = rows.indexes.filter(row => row.index_name !== "uq_inventory_bin_active_lock"); }, /Incompatible.*index/u);
  await rejectsBeforeDdl(rows => { rows.checks[0].enforced = "NO"; }, /Incompatible.*check/u);
  await rejectsBeforeDdl(rows => { rows.checks[0].check_clause = "status IS NOT NULL"; }, /Incompatible.*check/u);
  for (const prefix of ["_ascii", "_utf8mb4"]) {
    await rejectsBeforeDdl(rows => { rows.checks[0].check_clause = rows.checks[0].check_clause.replace("'DRAFT'", `'${prefix}DRAFT'`); }, /Incompatible.*check/u);
  }
});
test("MIG035-U06 FK parent, composite order, schema and delete rules reject before DDL", async () => {
  for (const [name, value] of [["referenced_table_name", "inventory_bins"], ["delete_rule", "CASCADE"], ["referenced_table_schema", "foreign"]]) {
    await rejectsBeforeDdl(rows => { rows.keys.find(row => row.constraint_name === "fk_inventory_bin_locks_owner")[name] = value; }, /Incompatible.*foreign key/u);
  }
  await rejectsBeforeDdl(rows => { rows.keys.find(row => row.constraint_name === "fk_inventory_bin_locks_owner").referenced_column_name = "bin_id"; }, /Incompatible.*foreign key/u);
});
