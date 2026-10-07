import { randomUUID } from "node:crypto";
import { migrationFixture } from "../phase1/fixtures.js";
import { createApplication } from "../../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../src/framework/configuration/applicationConfiguration.js";
import { SalesOrderService } from "../../../src/modules/sales/SalesOrderService.js";
import { SalesOrderConfirmationService } from "../../../src/modules/sales/SalesOrderConfirmationService.js";
import { formatDateForFile } from "../../../src/services/time/timeFormat.js";

export function waitForWorkerEntry(started, execution) {
  return Promise.race([started, execution.then(() => { throw new Error("Recovery job did not enter its worker"); })]);
}

export async function setup(t, { waitMs = 2500, backorderEnabled = false } = {}) {
  const f = await migrationFixture(t, []), source = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...source, application: { ...source.application,port: 0 },sales: { ...source.sales,manualConfirmationWaitMs: waitMs },scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs,
    "sales.confirmationRecovery": { enabled: false }, "sales.backorderAllocate": { enabled: backorderEnabled } } } } });
  t.after(() => app.shutdown("sales_phase2_confirmation_complete"));
  const database = app.services.require("mysqldatabase"), time = app.services.require("time"), logger = app.services.require("logging").logger;
  const label = `sales-p2-${randomUUID().slice(0, 8)}`;
  const roleId = await f.insert("roles", { name: label, created_at: f.now });
  const userId = await f.insert("users", { username: label, password_hash: "synthetic", display_name: "Synthetic", created_at: f.now, updated_at: f.now });
  await f.db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [userId,roleId]);
  for (const permission of ["sales.view","sales.mgmt"]) await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [roleId,permission]);
  f.beforeParents.push(async () => {
    await f.db.execute("DELETE FROM sales_orders WHERE customer_id=?", [f.customerId]);
    await f.db.execute("DELETE FROM sales_audit_logs WHERE actor_user_id=?", [userId]);
    await f.db.execute("DELETE FROM sales_operation_requests WHERE actor_user_id=?", [userId]);
    await f.db.execute("DELETE FROM user_roles WHERE user_id=?", [userId]);
    await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [roleId]);
  });
  await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?", [f.currency]);
  await f.db.execute("UPDATE item_skus SET sellable=1 WHERE id=?", [f.skuId]);
  const claims = { actorId: userId, claimedRoles: [label], claimedPermissions: ["sales.mgmt","sales.view"] };
  const created = await new SalesOrderService({ database,time,logger }).create({ claims,input: { eventId: randomUUID(), customerId: f.customerId,
    currencyCode: f.currency, fulfillmentWarehouseId: f.warehouseId, orderDate: formatDateForFile(new Date(f.now), "Asia/Hong_Kong"),
    lines: [{ skuId: f.skuId,skuUomId: f.skuUomId,quantity: "10.000000",unitSellingPrice: "1.0000" }] } });
  const service = options => new SalesOrderConfirmationService({ database,time,logger,...options });
  const request = { claims,id: created.salesOrder.id,input: { eventId: randomUUID(),version: 1 } };
  return { ...f,app,database,time,logger,claims,userId,roleId,service,request };
}

export async function stock(f, quantity, skuId = f.skuId) {
  await f.db.execute("UPDATE item_skus SET inventory_tracked=1 WHERE id=?", [skuId]);
  const bin = await f.insert("inventory_bins", { warehouse_id: f.warehouseId,bin_code: String(skuId),normalized_code: String(skuId),created_at: f.now,updated_at: f.now });
  if (quantity) await f.db.execute(`INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,created_at,updated_at)
    VALUES (?,?,?,'AVAILABLE',?,?,?)`, [f.warehouseId,bin,skuId,quantity,f.now,f.now]);
  f.beforeParents.push(async () => {
    await f.db.execute("DELETE FROM sales_orders WHERE customer_id=?", [f.customerId]);
    await f.db.execute("DELETE FROM inventory_reservations WHERE warehouse_id=?", [f.warehouseId]);
    await f.db.execute("DELETE FROM inventory_stock_balances WHERE warehouse_id=?", [f.warehouseId]);
    await f.db.execute("DELETE FROM inventory_stock_controls WHERE warehouse_id=?", [f.warehouseId]);
  });
}
