import assert from "node:assert/strict";
import test from "node:test";
import { fixture, document } from "../fulfillment/aggregateFixture.js";
import { FulfillmentQueueService, fulfillmentQueuePageQuery } from "../../src/modules/fulfillment/FulfillmentQueueService.js";
import { SystemLogger } from "../../src/services/logging/systemLogger.js";
import { normalizeFulfillmentQueueQuery } from "../../src/modules/fulfillment/fulfillmentQueueQuery.js";
const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const read = (f, input = {}, logger = {}) => f.context.storage.run({ databaseTransaction: null, signal: null, auth: { claims: f.claims }, startedAt: f.time.nowMs() }, () => new FulfillmentQueueService({ database: f.database, logger }).list(input));
const claim = async (f, doc) => f.s.insert("fulfillment_line_reservation_claims", { fulfillment_id: doc.id, fulfillment_line_id: doc.line, sales_order_line_reservation_id: f.mappingId, inventory_reservation_id: f.reservationId, original_claimed_quantity: 1, active_claimed_quantity: 1, status: "ACTIVE", inventory_version: 1, created_at: f.s.now, updated_at: f.s.now });
nativeTest("P1 Queue native projection is bounded, safe and read-only with an executable EXPLAIN", async t => {
  const f = await fixture(t), before = (await f.db.query("SELECT * FROM sales_orders"))[0];
  const result = await read(f);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].id, String(f.s.orderId));
  assert.equal(result.items[0].lines[0].fulfillableBaseQuantity, "1");
  assert.equal(result.items[0].lines[0].fulfilledBaseQuantity, "0");
  assert.equal(result.items[0].orderDate, "2023-11-14"); assert.equal(result.hasMore, false);
  assert.equal(JSON.stringify(result).includes("totalAmount"), false);
  assert.deepEqual((await f.db.query("SELECT * FROM sales_orders"))[0], before);
  const { sql, values } = fulfillmentQueuePageQuery(normalizeFulfillmentQueueQuery({ warehouseId: f.s.warehouseId }));
  const [plan] = await f.db.query("EXPLAIN FORMAT=JSON " + sql, values);
  // A one-row fixture may legitimately use PK lookups; scale/index budgets are measured separately.
  assert.match(JSON.stringify(plan), /index_name/u);
  assert.match(JSON.stringify(plan), /sales_order_line_reservations/u);
});
nativeTest("P1 Queue excludes fully claimed work and returns released capacity with correct active-work filters", async t => {
  const f = await fixture(t), doc = await document(f), id = await claim(f, doc);
  assert.deepEqual((await read(f)).items, []);
  await f.db.execute("UPDATE fulfillment_line_reservation_claims SET active_claimed_quantity=0,released_quantity=1,status='RELEASED' WHERE id=?", [id]);
  assert.equal((await read(f, { hasActiveWork: true })).items.length, 1);
  assert.deepEqual((await read(f, { hasActiveWork: false })).items, []);
  assert.deepEqual((await read(f, { hasBackorder: true })).items, []);
  assert.equal((await read(f, { q: f.before.order.sales_order_number, warehouseId: f.s.warehouseId, customerId: f.s.customerId })).items.length, 1);
});
nativeTest("P1 Queue excludes all ineligible SO states", async t => {
  const f = await fixture(t);
  for (const status of ["DRAFT", "CONFIRMING", "COMPLETED", "CANCELLED", "CLOSED"]) {
    await f.db.execute("UPDATE sales_orders SET status=? WHERE id=?", [status, f.s.orderId]);
    assert.deepEqual((await read(f)).items, [], status);
  }
});
nativeTest("P1 Queue actual source mismatch fails closed and records only safe diagnostic fields", async t => {
  const f = await fixture(t), logs = [];
  await f.db.execute("UPDATE inventory_reservations SET outstanding_quantity=0,released_quantity=1,version=version+1 WHERE id=?", [f.reservationId]);
  await assert.rejects(() => read(f, {}, new SystemLogger({ logger: { enabled: true, async write(entry) { logs.push(entry); } } })), { code: "FULFILLMENT_SOURCE_CONFLICT" });
  assert.deepEqual(logs, [{ level: "error", event: "fulfillment.queue.source_mismatch", message: "Fulfillment Queue source projection mismatch", context: { severity: "critical", code: "FULFILLMENT_SOURCE_CONFLICT" } }]);
});
nativeTest("P1 Queue revalidates fresh permission and refuses nested snapshots", async t => {
  const f = await fixture(t);
  await f.run({ claims: f.claims }, async () => { await assert.rejects(() => new FulfillmentQueueService({ database: f.database }).list(), /fresh read transaction/u); });
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.view'", [f.roleId]);
  await assert.rejects(() => read(f), { code: "PERMISSION_STALE" });
});
nativeTest("P1 Queue keeps one coherent RR snapshot when a Claim commits between bounded IDs and child reads", async t => {
  const f = await fixture(t), doc = await document(f), original = f.database.withTransaction.bind(f.database);
  let committed = false;
  f.database.withTransaction = (work, options) => original(async tx => {
    const query = tx.query.bind(tx);
    tx.query = async (sql, values) => {
      const result = await query(sql, values);
      if (!committed && sql.startsWith("SELECT o.id FROM sales_orders")) { committed = true; await claim(f, doc); }
      return result;
    };
    return work(tx);
  }, options);
  assert.equal((await read(f)).items[0].lines[0].fulfillableBaseQuantity, "1");
  assert.equal(committed, true);
  assert.deepEqual((await read(f)).items, []);
});
async function anotherOrder(f, number, deliveryDate) {
  const withoutId = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id"));
  const orderId = await f.s.insert("sales_orders", { ...withoutId(f.before.order), sales_order_number: number, requested_delivery_date: deliveryDate });
  const lineId = await f.s.insert("sales_order_lines", { ...withoutId(f.before.line), sales_order_id: orderId });
  const eventId = crypto.randomUUID();
  const root = await f.s.insert("inventory_operation_requests", { command_type: "SALES_BATCH_RESERVE", source_module: "SALES", source_document_type: "SALES_ORDER", source_document_id: String(orderId), source_event_id: eventId, request_hash: "a".repeat(64), actor_label: f.label, created_at: f.s.now });
  const child = await f.s.insert("inventory_operation_requests", { command_type: "SALES_LINE_RESERVE", source_module: "SALES", source_document_type: "SALES_ORDER", source_document_id: String(orderId), source_line_id: String(lineId), source_event_id: eventId, request_hash: "a".repeat(64), actor_label: f.label, created_at: f.s.now });
  const reservation = await f.s.insert("inventory_reservations", { create_operation_id: child, warehouse_id: f.s.warehouseId, sku_id: f.s.skuId, original_quantity: 1, outstanding_quantity: 1, purpose: "SALE", status: "ACTIVE", created_at: f.s.now, updated_at: f.s.now });
  await f.s.insert("sales_order_line_reservations", { sales_order_line_id: lineId, inventory_reservation_id: reservation, inventory_operation_id: root, source_event_id: eventId, original_base_quantity: 1, outstanding_base_quantity: 1, status: "ACTIVE", inventory_version: 1, created_at: f.s.now, updated_at: f.s.now });
  return orderId;
}
nativeTest("P1 Queue actual keyset pages have no duplicates or gaps across NULL/ties and all supported sorts", async t => {
  const f = await fixture(t), doc = await document(f); await claim(f, doc); // First original SO is ineligible; later work must still be found.
  const expected = [];
  for (const [number, delivery] of [["SO-Q-001", null], ["SO-Q-002", null], ["SO-Q-003", "2023-11-15"], ["SO-Q-004", "2023-11-15"], ["SO-Q-005", "2023-11-16"]]) expected.push(String(await anotherOrder(f, number, delivery)));
  let domainQueries = 0;
  const original = f.database.withTransaction.bind(f.database);
  f.database.withTransaction = (work, options) => original(async tx => {
    const query = tx.query.bind(tx);
    tx.query = (sql, values) => { if (/FROM sales_orders o|FROM sales_order_lines l/u.test(sql)) domainQueries++; return query(sql, values); };
    return work(tx);
  }, options);
  for (const sortBy of ["requestedDeliveryDate", "orderDate", "salesOrderNumber"]) for (const descending of [false, true]) {
    const actual = []; let cursor, page = 1, more;
    do {
      const before = domainQueries, result = await read(f, { sortBy, descending, pageSize: 2, page, ...(cursor ? { cursor } : {}) });
      assert.equal(domainQueries - before, 3, "one bounded ID query and two batch reads regardless of result count");
      assert.ok(result.items.length <= 2); actual.push(...result.items.map(row => row.id));
      cursor = result.nextCursor; more = result.hasMore; page++;
    } while (more && page < 5);
    assert.equal(more, false); assert.deepEqual(actual, descending ? [...expected].reverse() : expected);
  }
});

nativeTest("P1 Queue discovery cannot hide negative actual availability behind fully claimed Sales projection", async t => {
  const f = await fixture(t), doc = await document(f); await claim(f, doc);
  await f.db.execute("UPDATE inventory_reservations SET outstanding_quantity=0,released_quantity=1,version=version+1 WHERE id=?", [f.reservationId]);
  await assert.rejects(() => read(f), { code: "FULFILLMENT_SOURCE_CONFLICT" });
});
nativeTest("P1 Queue refuses terminal-positive Reservation and drifted original Sales root identity", async t => {
  const f = await fixture(t);
  await f.db.execute("UPDATE inventory_reservations SET status='CANCELLED' WHERE id=?", [f.reservationId]);
  await assert.rejects(() => read(f), { code: "FULFILLMENT_SOURCE_CONFLICT" });
  await f.db.execute("UPDATE inventory_reservations SET status='ACTIVE' WHERE id=?", [f.reservationId]);
  await f.db.execute("UPDATE inventory_operation_requests SET source_document_id='999999' WHERE id=?", [f.root]);
  await assert.rejects(() => read(f), { code: "FULFILLMENT_SOURCE_CONFLICT" });
});
nativeTest("P1 Queue actual discovered HTTP endpoint enforces authentication, view, strict query and safe response", async t => {
  const f = await fixture(t);
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  // The focused aggregate fixture stops at Sales foundation; real application startup uses the complete current migration catalogue.
  const { readdir } = await import("node:fs/promises");
  const directory = new URL("../../database/migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter(name => /^[0-9]{4}_.*\.js$/u.test(name) && Number(name.slice(0, 4)) > 88).sort()) await (await import(new URL(name, directory).href)).up(f.db);
  const source = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 }, scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs, "sales.backorderAllocate": { enabled: false }, "sales.importWorker": { enabled: false }, "sales.quotationExpire": { enabled: false } } }, database: { ...source.database, database: f.f.name } } });
  t.after(() => app.shutdown("fulfillment_p1_queue_http_complete"));
  const { url } = await app.start(), subject = String(f.userId), version = await app.services.require("tokenRevocation").currentVersion(subject);
  const token = await app.services.require("jwt").issue({ roles: f.claims.roles, permissions: f.claims.permissions }, { subject, version, authTime: Math.floor(Date.now() / 1000) });
  const denied = await app.services.require("jwt").issue({ roles: f.claims.roles, permissions: [] }, { subject, version, authTime: Math.floor(Date.now() / 1000) });
  const get = async (suffix = "", bearer = token) => {
    const response = await fetch(new URL("/api/v1/fulfillment-queue" + suffix, url), { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
    return { status: response.status, body: await response.json() };
  };
  const result = await get("?pageSize=1&hasBackorder=false");
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.items[0].id, String(f.s.orderId));
  assert.equal((await get("", null)).status, 401);
  assert.equal((await get("", denied)).status, 403);
  for (const suffix of ["?unknown=x", "?page=2", "?pageSize=101", "?hasBackorder=maybe", "?requestedDateFrom=2026-02-30"]) assert.equal((await get(suffix)).status, 400, suffix);
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.view'", [f.roleId]);
  const stale = await get(); assert.equal(stale.status, 403); assert.equal(stale.body.error.code, "PERMISSION_STALE");
});
nativeTest("P1 Queue exact SO number precedes colliding Customer prefix matches across keyset pages", async t => {
  const f = await fixture(t), other = String(await anotherOrder(f, "AAQ-COLLISION", null));
  const q = f.before.order.sales_order_number;
  const first = await read(f, { q, pageSize: 1 });
  assert.equal(first.items[0].id, String(f.s.orderId)); assert.equal(first.hasMore, true);
  const second = await read(f, { q, pageSize: 1, page: 2, cursor: first.nextCursor });
  assert.equal(second.items[0].id, other); assert.equal(second.hasMore, false);
  assert.equal((await read(f, { q, pageSize: 1, descending: true })).items[0].id, String(f.s.orderId));
});
