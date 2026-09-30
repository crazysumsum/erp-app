import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" &&
  process.env.INVENTORY_TASK025_API_TESTS === "1";
const integrationTest = enabled ? test : test.skip;

function assertPrivateDatabase() {
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task025_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "",
    /^\/private\/tmp\/erp-inventory-task025-mysql-2670\.[^/]+\/mysql\.sock$/u);
}

function command(user, permission, eventId, payload) {
  return {
    actor: { userId: user.id, serviceName: "", claimedRoles: [user.role],
      claimedPermissions: [permission] },
    source: { documentId: `DOC-${eventId}`, lineId: "1", eventId },
    correlationId: eventId, payload
  };
}

async function request(url, token, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(),
      Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

integrationTest("DEV-025-API-01 real HTTP and provider permission boundaries", async (t) => {
  assertPrivateDatabase();
  const source = defaultConfigurationSource();
  const moduleUrls = ["reservationHandlers.js", "allocationHandlers.js", "postingHandlers.js"]
    .map((name) => new URL(`../../src/handlers/inventory/${name}`, import.meta.url).href);
  const application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      jwt: { ...source.jwt, secret: randomBytes(32).toString("hex") } },
    handlerRegistryOptions: { moduleUrls }
  });
  t.after(() => application.shutdown("task025_api_test_complete"));
  const db = application.services.require("mysqldatabase");
  const [[server]] = await db.query("SELECT VERSION() AS version, @@skip_networking AS skip_networking, DATABASE() AS db_name");
  assert.equal(server.version, "26.7.0");
  assert.equal(Number(server.skip_networking), 1);
  assert.equal(server.db_name, process.env.DB_NAME);
  const [[migrations]] = await db.query("SELECT COUNT(*) AS count FROM fr_schema_migrations");
  assert.equal(Number(migrations.count), 66);

  const now = Date.now();
  const suffix = randomUUID().slice(0, 8);
  async function actor(permission) {
    const roleName = `it-${permission}-${suffix}`;
    const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, now]);
    const [[permissionRow]] = await db.query("SELECT id FROM permissions WHERE name = ?", [permission]);
    assert.ok(permissionRow, permission);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
      [role.insertId, permissionRow.id]);
    const [user] = await db.execute(
      "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [`it-${permission}-${suffix}`, "synthetic-disabled-login", "TASK-025 actor", now, now]);
    await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
      [user.insertId, role.insertId]);
    return { id: user.insertId, role: roleName, roleId: role.insertId, permissionId: permissionRow.id };
  }
  const manager = await actor("inventory.operation");
  const sales = await actor("sales.operation");
  const fulfillment = await actor("fulfillment.operation");
  const [[view]] = await db.query("SELECT id FROM permissions WHERE name = 'inventory.view'");
  await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
    [manager.roleId, view.id]);

  const [uom] = await db.execute(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, 'Each', 'active', ?, ?)",
    [`EA${suffix}`, now, now]);
  const [item] = await db.execute(
    "INSERT INTO items (name, product_type, status, created_at, updated_at) VALUES (?, 'standard', 'active', ?, ?)",
    [`TASK-025 item ${suffix}`, now, now]);
  const [sku] = await db.execute(
    `INSERT INTO item_skus (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable,
       inventory_tracked, suggested_price_amount, status, created_at, updated_at)
     VALUES (?, ?, 'TASK-025 SKU', 'batch_expiry', 1, 1, 1, '10.0000', 'active', ?, ?)`,
    [item.insertId, `TASK025-${suffix}`, now, now]);
  await db.execute(
    `INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, is_default_sale, created_at, updated_at)
     VALUES (?, ?, 1, 1, 1, ?, ?)`, [sku.insertId, uom.insertId, now, now]);
  const [warehouse] = await db.execute(
    `INSERT INTO inventory_warehouses (warehouse_code, normalized_code, warehouse_name, created_at, updated_at)
     VALUES (?, ?, 'TASK-025 Warehouse', ?, ?)`, [`WH-${suffix}`, `wh-${suffix}`, now, now]);
  const [bin] = await db.execute(
    `INSERT INTO inventory_bins (warehouse_id, bin_code, normalized_code, created_at, updated_at)
     VALUES (?, 'A-01', 'a-01', ?, ?)`, [warehouse.insertId, now, now]);
  const [lot] = await db.execute(
    `INSERT INTO inventory_lots (sku_id, lot_number, normalized_lot_number, expiry_date,
       first_receipt_date, sku_code_snapshot, created_at)
     VALUES (?, ?, ?, '2027-12-31', '2026-09-01', ?, ?)`,
    [sku.insertId, `LOT-${suffix}`, `lot-${suffix}`, `TASK025-${suffix}`, now]);
  await db.execute(
    `INSERT INTO inventory_stock_balances (warehouse_id, bin_id, sku_id, lot_id, stock_status,
       on_hand_quantity, fifo_anchor_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'AVAILABLE', 10, '2026-09-01', ?, ?)`,
    [warehouse.insertId, bin.insertId, sku.insertId, lot.insertId, now, now]);

  const jwt = application.services.require("jwt");
  const tokenRevocation = application.services.require("tokenRevocation");
  const authTime = Math.floor(Date.now() / 1000);
  async function token(user, permissions) {
    const version = await tokenRevocation.currentVersion(String(user.id));
    return jwt.issue({ roles: [user.role], permissions },
      { subject: String(user.id), version, authTime });
  }
  const managerToken = await token(manager, ["inventory.view", "inventory.operation"]);
  const salesToken = await token(sales, ["sales.operation"]);
  const fulfillmentToken = await token(fulfillment, ["fulfillment.operation"]);
  const { url } = await application.start();
  const sourceEvent = (module, eventId) => ({ module, documentType: "ORDER",
    documentId: `DOC-${suffix}`, lineId: "1", eventId });
  const reservationBody = (eventId) => ({ source: sourceEvent("INVENTORY", eventId),
    skuId: sku.insertId, warehouseId: warehouse.insertId, quantity: 2,
    purpose: "SALE", minimumRemainingDays: 0 });
  const endpoint = `${url}/api/v1/inventory/reservations/create`;
  const deniedSales = await request(endpoint, salesToken, reservationBody(`sales-http-${suffix}`));
  assert.equal(deniedSales.status, 403, JSON.stringify(deniedSales));
  const created = await request(endpoint, managerToken, reservationBody(`manager-${suffix}`));
  assert.equal(created.status, 200, JSON.stringify(created));
  const reservationId = created.body.data.id;
  const second = await request(endpoint, managerToken, reservationBody(`manager-2-${suffix}`));
  assert.equal(second.status, 200, JSON.stringify(second));

  const inventory = new InventoryReservationService({ database: db,
    logger: application.services.require("logging").logger,
    time: application.services.require("time") });
  const provider = await db.withTransaction((transaction) =>
    inventory.createSalesReservationInTransaction(transaction,
      command(sales, "sales.operation", `sales-provider-${suffix}`,
        { skuId: sku.insertId, warehouseId: warehouse.insertId, quantity: 2,
          purpose: "SALE", minimumRemainingDays: 0 })));
  assert.ok(provider.id);
  const [[salesOperation]] = await db.query(
    "SELECT source_module, source_document_type FROM inventory_operation_requests WHERE id = ?",
    [provider.operationId]);
  assert.deepEqual([salesOperation.source_module, salesOperation.source_document_type],
    ["SALES", "SALES_ORDER"]);

  const [[balance]] = await db.query(
    "SELECT id, version FROM inventory_stock_balances WHERE sku_id = ?", [sku.insertId]);
  const allocated = await db.withTransaction((transaction) =>
    inventory.allocateForFulfillmentInTransaction(transaction,
      command(fulfillment, "fulfillment.operation", `fulfill-provider-${suffix}`,
        { reservationId: provider.id, expectedVersion: provider.version,
          allocations: [{ balanceId: balance.id, expectedVersion: balance.version, quantity: 1 }] })));
  assert.equal(allocated.allocations.length, 1);
  const directFulfillment = await request(
    `${url}/api/v1/inventory/reservations/${reservationId}/allocations/create`,
    fulfillmentToken, { source: sourceEvent("FULFILLMENT", `fulfill-http-${suffix}`),
      version: created.body.data.version,
      allocations: [{ balanceId: balance.id, expectedVersion: balance.version, quantity: 1 }] });
  assert.equal(directFulfillment.status, 403, JSON.stringify(directFulfillment));
  const directIssue = await request(`${url}/api/v1/inventory/issues`, fulfillmentToken, {
    source: sourceEvent("FULFILLMENT", `issue-http-${suffix}`),
    reservationId: provider.id, version: allocated.version,
    lines: [{ allocationId: allocated.allocations[0].id,
      expectedVersion: allocated.allocations[0].version, balanceId: balance.id,
      expectedBalanceVersion: allocated.allocations[0].balanceVersion, quantity: 1 }]
  });
  assert.equal(directIssue.status, 403, JSON.stringify(directIssue));

  await t.test("DEV-025-API-02 Sales Reservation to FEFO Allocation to Fulfillment Issue", async () => {
    const sale = await db.withTransaction((transaction) =>
      inventory.createSalesReservationInTransaction(transaction,
        command(sales, "sales.operation", `sale-issue-${suffix}`,
          { skuId: sku.insertId, warehouseId: warehouse.insertId, quantity: 1,
            purpose: "SALE", minimumRemainingDays: 0 })));
    const candidateResponse = await fetch(
      `${url}/api/v1/inventory/reservations/${sale.id}/allocation-candidates?requestedQuantity=1`,
      { headers: { Authorization: `Bearer ${managerToken}` } });
    assert.equal(candidateResponse.status, 200);
    const candidates = (await candidateResponse.json()).data;
    const candidate = candidates.items[0];
    assert.equal(candidates.reservationVersion, sale.version);
    assert.equal(candidate.selectionStrategy, "FEFO");
    assert.equal(candidate.rank, 1);
    assert.equal(candidate.balanceId, balance.id);
    const hold = await db.withTransaction((transaction) =>
      inventory.allocateForFulfillmentInTransaction(transaction,
        command(fulfillment, "fulfillment.operation", `allocate-issue-${suffix}`,
          { reservationId: sale.id, expectedVersion: candidates.reservationVersion,
            allocations: [{ balanceId: candidate.balanceId,
              expectedVersion: candidate.balanceVersion, quantity: 1 }] })));
    const [[beforeIssue]] = await db.query(
      `SELECT b.on_hand_quantity AS on_hand, b.allocated_quantity AS allocated,
              c.reserved_quantity AS reserved
         FROM inventory_stock_balances b JOIN inventory_stock_controls c
           ON c.warehouse_id = b.warehouse_id AND c.sku_id = b.sku_id
        WHERE b.id = ?`, [balance.id]);
    const posting = new InventoryPostingService({ database: db,
      logger: application.services.require("logging").logger,
      time: application.services.require("time") });
    const issue = await db.withTransaction((transaction) =>
      posting.postFulfillmentIssueInTransaction(transaction,
        command(fulfillment, "fulfillment.operation", `post-issue-${suffix}`,
          { reservationId: sale.id, expectedVersion: hold.version,
            lines: [{ allocationId: hold.allocations[0].id,
              expectedVersion: hold.allocations[0].version, balanceId: balance.id,
              expectedBalanceVersion: hold.allocations[0].balanceVersion, quantity: 1 }] })));
    assert.equal(issue.status, "POSTED");
    assert.equal(issue.quantity, 1);
    const [[state]] = await db.query(
      `SELECT r.consumed_quantity AS consumed, r.outstanding_quantity AS outstanding,
              a.consumed_quantity AS allocation_consumed,
              a.outstanding_quantity AS allocation_outstanding,
              b.on_hand_quantity AS on_hand, b.allocated_quantity AS allocated,
              c.reserved_quantity AS reserved
         FROM inventory_reservations r
         JOIN inventory_allocations a ON a.reservation_id = r.id
         JOIN inventory_stock_balances b ON b.id = a.stock_balance_id
         JOIN inventory_stock_controls c ON c.warehouse_id = r.warehouse_id AND c.sku_id = r.sku_id
        WHERE r.id = ?`, [sale.id]);
    assert.deepEqual([Number(state.consumed), Number(state.outstanding),
      Number(state.allocation_consumed), Number(state.allocation_outstanding)], [1, 0, 1, 0]);
    assert.deepEqual([Number(state.on_hand), Number(state.allocated), Number(state.reserved)],
      [Number(beforeIssue.on_hand) - 1, Number(beforeIssue.allocated) - 1,
        Number(beforeIssue.reserved) - 1]);
    const [[movement]] = await db.query(
      `SELECT movement_type, direction, quantity, operation_request_id
         FROM inventory_movements WHERE id = ?`, [issue.lines[0].movementId]);
    assert.deepEqual([movement.movement_type, movement.direction, Number(movement.quantity),
      Number(movement.operation_request_id)], ["ISSUE", "OUT", 1, issue.operationId]);
    const [[audit]] = await db.query(
      "SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE operation_request_id = ? AND action = 'issue.post'",
      [issue.operationId]);
    assert.equal(Number(audit.count), 1);
  });

  const [[before]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,
            (SELECT COUNT(*) FROM inventory_audit_logs) AS audits`);
  await assert.rejects(() => db.withTransaction((transaction) =>
    inventory.releaseFulfillmentAllocationInTransaction(transaction,
      command(fulfillment, "fulfillment.operation", `cross-owner-${suffix}`,
        { reservationId, expectedVersion: created.body.data.version,
          releases: [{ allocationId: allocated.allocations[0].id,
            expectedVersion: allocated.allocations[0].version, quantity: 1 }] }))),
  (error) => error.code === "ALLOCATION_STATE_CONFLICT");
  await db.execute("DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?",
    [sales.roleId, sales.permissionId]);
  await assert.rejects(() => db.withTransaction((transaction) =>
    inventory.createSalesReservationInTransaction(transaction,
      command(sales, "sales.operation", `revoked-${suffix}`,
        { skuId: sku.insertId, warehouseId: warehouse.insertId, quantity: 1,
          purpose: "SALE", minimumRemainingDays: 0 }))),
  (error) => error.code === "PERMISSION_STALE");
  await db.execute("DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?",
    [manager.roleId, manager.permissionId]);
  const revoked = await request(endpoint, managerToken, reservationBody(`revoked-http-${suffix}`));
  assert.equal(revoked.status, 403, JSON.stringify(revoked));
  for (const denial of [deniedSales, directFulfillment, directIssue, revoked]) {
    assert.doesNotMatch(JSON.stringify(denial.body), /inventory_stock|SELECT |INSERT |stack/i);
  }
  const [[after]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,
            (SELECT COUNT(*) FROM inventory_audit_logs) AS audits`);
  assert.equal(Number(after.operations), Number(before.operations));
  assert.equal(Number(after.audits), Number(before.audits));
  const [[held]] = await db.query(
    "SELECT outstanding_quantity FROM inventory_allocations WHERE id = ?",
    [allocated.allocations[0].id]);
  assert.equal(Number(held.outstanding_quantity), 1);
  const [[control]] = await db.query(
    "SELECT reserved_quantity FROM inventory_stock_controls WHERE warehouse_id = ? AND sku_id = ?",
    [warehouse.insertId, sku.insertId]);
  assert.equal(Number(control.reserved_quantity), 6);
  assert.ok(Number(after.audits) >= 4);
});
