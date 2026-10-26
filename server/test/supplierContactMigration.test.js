import assert from "node:assert/strict";
import test from "node:test";

import { inspectSupplierContactSchema } from "../database/migrations/0033_create_supplier_contacts.js";
import { inspectSupplierAddressSchema } from "../database/migrations/0032_create_supplier_addresses.js";
import { inspectSupplierPartySortOrder } from "../database/migrations/0103_add_supplier_party_sort_order.js";

test("Contact migration inspector accepts absence and rejects partial schemas", async () => {
  assert.equal(await inspectSupplierContactSchema({ async query() { return [[]]; } }), false);
  await assert.rejects(
    () => inspectSupplierContactSchema({ async query() { return [[{ table_name: "supplier_contacts", column_name: "id" }]]; } }),
    /Incompatible existing Supplier contact schema/u
  );
});

const CONTACT_COLUMNS = ["id", "supplier_id", "name", "job_title", "department", "email", "phone", "mobile", "preferred_language", "notes",
  "status", "version", "created_at", "updated_at", "created_by", "updated_by"];
const ADDRESS_COLUMNS = ["id", "supplier_id", "label", "address_line1", "address_line2", "address_line3", "city", "state_region",
  "postal_code", "country_code", "phone", "notes", "status", "version", "created_at", "updated_at", "created_by", "updated_by"];
const columnsQuery = (tableName, columns) => ({ async query() { return [columns.map((column) => ({ table_name: tableName, column_name: column }))]; } });

test("the 0032 and 0033 inspectors accept 0103's sort_order and still refuse any other extra column (DEF-037, REV-118 L-2)", async () => {
  for (const [inspect, tableName, columns] of [[inspectSupplierContactSchema, "supplier_contacts", CONTACT_COLUMNS],
    [inspectSupplierAddressSchema, "supplier_addresses", ADDRESS_COLUMNS]]) {
    // 只得主表：sort_order 唔當陌生欄位，所以唔拋（回 false，因為 purposes 表未有）。
    assert.equal(await inspect(columnsQuery(tableName, [...columns, "sort_order"])), false);
    await assert.rejects(() => inspect(columnsQuery(tableName, [...columns, "rogue"])), /Incompatible existing Supplier/u);
    await assert.rejects(() => inspect(columnsQuery(tableName, columns.slice(1))), /Incompatible existing Supplier/u);
  }
});

test("the 0103 inspector wants both columns as INT NOT NULL DEFAULT 0 (DEF-037, REV-118 L-2)", async () => {
  const rows = (overrides = {}) => ({ async query() {
    return [["supplier_addresses", "supplier_contacts"].map((tableName) => ({ table_name: tableName, data_type: "int", is_nullable: "NO", column_default: "0",
      ...(tableName === "supplier_contacts" ? overrides : {}) }))];
  } });
  assert.equal(await inspectSupplierPartySortOrder(rows()), true);
  assert.equal(await inspectSupplierPartySortOrder({ async query() { return [[{ table_name: "supplier_addresses", data_type: "int", is_nullable: "NO", column_default: "0" }]]; } }), false);
  for (const wrong of [{ is_nullable: "YES" }, { data_type: "bigint" }, { column_default: null }]) {
    await assert.rejects(() => inspectSupplierPartySortOrder(rows(wrong)), /Incompatible existing Supplier sort_order column: supplier_contacts/u, JSON.stringify(wrong));
  }
});
