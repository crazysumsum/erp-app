import assert from "node:assert/strict";
import test from "node:test";
import { up } from "../database/migrations/0082_add_customer_search_indexes.js";

const indexes = [
  ["customers", "idx_customers_search_phone", ["general_phone", "id"]],
  ["customers", "idx_customers_search_email", ["general_email", "id"]],
  ["customer_identifiers", "idx_customer_identifiers_search_value", ["status", "identifier_value_key", "customer_id"]],
  ...["name", "phone", "mobile"].map((field) => ["customer_contacts", `idx_customer_contacts_search_${field}`, ["status", field, "customer_id"]]),
  ...["label", "address_line1", "city", "postal_code"].map((field) => ["customer_addresses", `idx_customer_addresses_search_${field}`, ["status", field, "customer_id"]])
];
const metadata = indexes.flatMap(([table_name, index_name, columns]) => columns.map((column_name, index) => ({
  table_name, index_name, column_name, seq_in_index: index + 1, non_unique: 1,
  index_type: "BTREE", sub_part: null, collation: "A", is_visible: "YES"
})));

function connection(rows = [], failure = null) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("information_schema.statistics")) return [rows];
    if (sql.includes("SELECT @@SESSION")) return [[{ previous: 37 }]];
    if (sql.startsWith("ALTER") && failure) throw failure;
    return [[]];
  } };
}

test("Customer search migration adds exactly ten forward indexes with bounded online DDL and restores the session", async () => {
  const db = connection();
  await up(db);
  const alters = db.calls.filter(({ sql }) => sql.startsWith("ALTER"));
  assert.equal(alters.length, 4);
  for (const [table, name, columns] of indexes) {
    assert.ok(alters.some(({ sql }) => sql.includes(`ALTER TABLE ${table} `) && sql.includes(`ADD INDEX ${name} (${columns.join(", ")})`)));
  }
  assert.ok(alters.every(({ sql }) => sql.includes("ALGORITHM=INPLACE, LOCK=NONE")));
  assert.doesNotMatch(alters.map(({ sql }) => sql).join("\n"), /DROP|DELETE|UPDATE|INSERT/);
  assert.deepEqual(db.calls.filter(({ sql }) => sql.startsWith("SET")).map(({ params }) => params), [[10], [37]]);
});

test("Customer search migration rerun validates existing indexes without DDL or changing lock settings", async () => {
  const db = connection(metadata);
  await up(db);
  assert.equal(db.calls.length, 1);
});

for (const [name, change] of [
  ["wrong column", { column_name: "legal_name_key" }], ["unique", { non_unique: 0 }],
  ["prefix", { sub_part: 8 }], ["descending", { collation: "D" }],
  ["invisible", { is_visible: "NO" }], ["wrong type", { index_type: "HASH" }]
]) {
  test(`Customer search migration refuses a same-named ${name} index before any ALTER`, async () => {
    const db = connection(metadata.map((row, index) => index === metadata.length - 1 ? { ...row, ...change } : row));
    await assert.rejects(() => up(db), /Incompatible existing Customer search index/);
    assert.equal(db.calls.length, 1);
  });
}

test("Customer search migration restores lock settings after a bounded metadata-lock failure", async () => {
  const db = connection([], Object.assign(new Error("locked"), { code: "ER_LOCK_WAIT_TIMEOUT" }));
  await assert.rejects(() => up(db, { lockWaitSeconds: 1 }), /metadata lock/);
  assert.deepEqual(db.calls.at(-1).params, [37]);
});

test("Customer search migration rejects an unbounded lock wait before querying", async () => {
  const db = connection();
  await assert.rejects(() => up(db, { lockWaitSeconds: 0 }), /lockWaitSeconds/);
  assert.equal(db.calls.length, 0);
});
