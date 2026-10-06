import assert from "node:assert/strict";
import test from "node:test";
import { up as sequences, inspectSalesSequenceSchema } from "../../database/migrations/0068_create_sales_document_sequences.js";
import { up as operations, inspectSalesOperationSchema } from "../../database/migrations/0069_create_sales_operation_requests.js";

test("Sales foundation empty schema creates tables and incompatible existing columns fail closed", async () => {
  for (const [up, inspect, table] of [[sequences, inspectSalesSequenceSchema, "sales_document_sequences"], [operations, inspectSalesOperationSchema, "sales_operation_requests"]]) {
    const calls = [];
    const empty = { async query(sql) { calls.push(sql); return [[]]; } };
    await assert.rejects(() => up(empty), /schema/iu);
    assert.ok(calls.some(sql => sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)));
    await assert.rejects(() => inspect({ async query() { return [[{ column_name: "unexpected" }]]; } }), /columns/iu);
    assert.equal(await inspect(empty), false);
  }
});

import { createFakeSalesDatabase } from "../../test-support/fakeSalesDatabase.js";
test("Sales foundation fake commits only complete caller work and preserves rollback/commit-failure state", async () => {
  for (const failCommit of [false, true]) {
    const db = createFakeSalesDatabase({ initialState: { nextValue: 1 }, failCommit,
      query: async ({ state }) => [[{ next_value: state.nextValue }]],
      execute: async ({ state }) => { state.nextValue++; return [{ affectedRows: 1 }]; } });
    const allocate = async tx => { const [[row]] = await tx.query("sequence"); await tx.execute("increment"); return row.next_value; };
    await assert.rejects(() => db.withTransaction(async tx => { await allocate(tx); throw new Error("caller rollback"); }), /caller rollback/u);
    assert.equal(db.state.nextValue, 1);
    if (failCommit) { await assert.rejects(() => db.withTransaction(allocate), /commit failure/u); assert.equal(db.state.nextValue, 1); }
    else { assert.equal(await db.withTransaction(allocate), 1); assert.equal(db.state.nextValue, 2); }
  }
});

import { inspectSalesFoundationTable } from "../../database/migrations/0068_create_sales_document_sequences.js";
test("Sales schema inspection rejects truncated unique identity and cross-schema/cascading actor FK", async () => {
  const contract = { table: "probe", columns: { id: ["bigint unsigned", "NO", null, null, "auto_increment"] }, indexes: { PRIMARY: [0, "id"] }, actor: true };
  const foreignKey = { column_name: "actor_user_id", table_name: "users", referenced_column: "id", delete_rule: "SET NULL", referenced_schema: "erp_test", update_rule: "RESTRICT" };
  const connection = (subPart = null, fk = foreignKey) => ({ async query(sql) {
    if (sql.includes("information_schema.columns")) return [[{ name: "id", type: "bigint unsigned", nullable: "NO", default_value: null, extra: "auto_increment" }]];
    if (sql.includes("information_schema.tables")) return [[{ engine: "InnoDB", collation: "utf8mb4_unicode_ci", schema_name: "erp_test" }]];
    if (sql.includes("information_schema.statistics")) return [[{ name: "PRIMARY", non_unique: 0, column_name: "id", sub_part: subPart }]];
    if (sql.includes("information_schema.key_column_usage")) return [[fk]];
    return [[]];
  } });
  assert.equal(await inspectSalesFoundationTable(connection(), contract), true);
  await assert.rejects(() => inspectSalesFoundationTable(connection(8), contract), /index prefix/u);
  for (const fk of [{ ...foreignKey, referenced_schema: "another_schema" }, { ...foreignKey, update_rule: "CASCADE" }]) {
    await assert.rejects(() => inspectSalesFoundationTable(connection(null, fk), contract), /foreign keys/u);
  }
});
