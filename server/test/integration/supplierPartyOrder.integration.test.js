import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { up as addSortOrder } from "../../database/migrations/0103_add_supplier_party_sort_order.js";
import { createSupplierHarness } from "./supplierHttpHarness.js";
import { scratchDatabase } from "./supplierScratchDatabase.js";

/**
 * DEF-037（HD-129 A、HD-136）：地址同聯絡人嘅顯示次序，喺真 app、真 MySQL。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = createSupplierHarness("d037");

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  await h.start();
  h.users = { mgmt: await h.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]) };
});

after(async () => {
  if (process.env.DB_INTEGRATION_TESTS === "1") await h.stop();
});

const tag = () => randomUUID().slice(0, 8).toUpperCase();

async function supplierWith(kind, names) {
  const created = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/create"),
    { body: { supplierCode: `ORD-${tag()}`, supplierName: `Order ${tag()}`, defaultCurrencyCode: "HKD" } });
  assert.equal(created.status, 201, created.text);
  const supplierId = created.json.data.id;
  h.supplierIds.push(supplierId);
  const rows = [];
  for (const name of names) {
    const body = kind === "addresses" ? { label: name, purposes: [] } : { name, purposes: [] };
    const response = await h.send(h.users.mgmt, h.route(`POST /api/v1/suppliers/:supplierId/${kind}/create`), { ids: { supplierId }, body });
    assert.equal(response.status, 201, response.text);
    rows.push(response.json.data);
  }
  return { supplierId, rows };
}

const label = (kind, row) => (kind === "addresses" ? row.label : row.name);
const listed = async (kind, supplierId) => (await h.send(h.users.mgmt, h.route(`GET /api/v1/suppliers/:id/${kind}`), { ids: { id: supplierId } })).json.data.items;
const idKey = (kind) => (kind === "addresses" ? "addressId" : "contactId");
const move = (kind, supplierId, row, direction, version = row.version) => h.send(h.users.mgmt,
  h.route(`POST /api/v1/suppliers/:supplierId/${kind}/:${idKey(kind)}/move`),
  { ids: { supplierId, [idKey(kind)]: row.id }, body: { direction, version } });

for (const kind of ["addresses", "contacts"]) {
  integrationTest(`${kind}: new rows go last, move up and down swap with the adjacent active row, and the list keeps the order (DEF-037)`, async () => {
    const { supplierId, rows } = await supplierWith(kind, ["Alpha", "Bravo", "Charlie", "Delta"]);
    assert.deepEqual(rows.map((row) => row.sortOrder), [1, 2, 3, 4]);

    const moved = await move(kind, supplierId, rows[3], "up");
    assert.equal(moved.status, 200, moved.text);
    assert.deepEqual((await listed(kind, supplierId)).map((row) => label(kind, row)), ["Alpha", "Bravo", "Delta", "Charlie"]);

    // 停用咗嘅行唔算鄰居：Bravo 停用之後，Delta 再上移就同 Alpha 換。
    const bravo = (await listed(kind, supplierId)).find((row) => label(kind, row) === "Bravo");
    const deactivated = await h.send(h.users.mgmt, h.route(`POST /api/v1/suppliers/:supplierId/${kind}/:${idKey(kind)}/deactivate`),
      { ids: { supplierId, [idKey(kind)]: bravo.id }, body: { version: bravo.version } });
    assert.equal(deactivated.status, 200, deactivated.text);
    const delta = (await listed(kind, supplierId)).find((row) => label(kind, row) === "Delta");
    assert.equal((await move(kind, supplierId, delta, "up")).status, 200);
    const active = (await listed(kind, supplierId)).filter((row) => row.status === "active").map((row) => label(kind, row));
    assert.deepEqual(active, ["Delta", "Alpha", "Charlie"]);

    const first = (await listed(kind, supplierId)).find((row) => label(kind, row) === "Delta");
    const top = await move(kind, supplierId, first, "up");
    assert.deepEqual([top.status, top.code], [409, "SUPPLIER_PARTY_MOVE_NOT_POSSIBLE"]);
    const last = (await listed(kind, supplierId)).find((row) => label(kind, row) === "Charlie");
    assert.deepEqual([(await move(kind, supplierId, last, "down")).code], ["SUPPLIER_PARTY_MOVE_NOT_POSSIBLE"]);
    assert.deepEqual([(await move(kind, supplierId, first, "down", first.version + 5)).code], ["VERSION_CONFLICT"]);
    const stillInactive = (await listed(kind, supplierId)).find((row) => label(kind, row) === "Bravo");
    assert.equal((await move(kind, supplierId, stillInactive, "up")).status, 409, "an inactive row cannot be moved");
  });

  integrationTest(`${kind}: a move never touches another Supplier's rows (DEF-037)`, async () => {
    const one = await supplierWith(kind, ["One", "Two"]);
    const other = await supplierWith(kind, ["Other A", "Other B"]);
    assert.equal((await move(kind, one.supplierId, one.rows[1], "up")).status, 200);
    assert.deepEqual((await listed(kind, other.supplierId)).map((row) => [label(kind, row), row.sortOrder]), [["Other A", 1], ["Other B", 2]]);
    const foreign = await move(kind, one.supplierId, other.rows[1], "up");
    assert.equal(foreign.status, 404, "a row of another Supplier is not found under this one");
  });
}

integrationTest("0103 fills the order each Supplier showed before: addresses by status then id, contacts by status, name then id (DEF-037)", async (t) => {
  const scratch = await scratchDatabase(t);
  const db = scratch.connection;
  await db.query("CREATE TABLE supplier_addresses (id INT PRIMARY KEY, supplier_id INT NOT NULL, status VARCHAR(20) NOT NULL)");
  await db.query("CREATE TABLE supplier_contacts (id INT PRIMARY KEY, supplier_id INT NOT NULL, name VARCHAR(190) NOT NULL, status VARCHAR(20) NOT NULL)");
  await db.query("INSERT INTO supplier_addresses VALUES (5, 1, 'inactive'), (3, 1, 'active'), (9, 1, 'active'), (4, 2, 'active')");
  await db.query("INSERT INTO supplier_contacts VALUES (1, 1, 'Zoe', 'active'), (2, 1, 'Amy', 'active'), (3, 1, 'Ben', 'inactive'), (4, 2, 'Kim', 'active')");
  await addSortOrder(db);
  const [addresses] = await db.query("SELECT id, sort_order FROM supplier_addresses ORDER BY id");
  assert.deepEqual(addresses.map((row) => [row.id, row.sort_order]), [[3, 1], [4, 1], [5, 3], [9, 2]]);
  const [contacts] = await db.query("SELECT id, sort_order FROM supplier_contacts ORDER BY id");
  assert.deepEqual(contacts.map((row) => [row.id, row.sort_order]), [[1, 2], [2, 1], [3, 3], [4, 1]]);
  // 再跑一次：已經有欄位，乜都唔郁。
  await db.query("UPDATE supplier_addresses SET sort_order = 7 WHERE id = 9");
  await addSortOrder(db);
  const [[nine]] = await db.query("SELECT sort_order FROM supplier_addresses WHERE id = 9");
  assert.equal(nine.sort_order, 7);
});
