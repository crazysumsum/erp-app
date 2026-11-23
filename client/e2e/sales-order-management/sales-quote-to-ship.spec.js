import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";
import { formatDateForFile } from "../../../server/src/services/time/timeFormat.js";
import { nativeDatabase } from "../../../server/test/fulfillment/nativeDatabase.js";
import { createTestCurrency } from "../../../server/test/sales/phase1/fixtures.js";

const cleanup = [];
let app, vite, db, origin, token, fixture;

async function seed() {
  const now = Date.now();
  const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, row))[0].insertId);
  const stamps = { created_at: now, updated_at: now };
  const customerCode = "FLOW-CUSTOMER", skuCode = "FLOW-SKU", warehouseCode = "FLOW-WH";
  const currency = await createTestCurrency(db, [], now);
  await db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?", [currency]);
  const customerId = await insert("customers", {
    customer_code: customerCode, customer_code_key: customerCode.toLowerCase(), legal_name: "Synthetic Flow Customer",
    legal_name_key: "synthetic flow customer", default_currency_code: currency, status: "active", ...stamps
  });
  const addressId = await insert("customer_addresses", {
    customer_id: customerId, label: "Synthetic shipping", address_line1: "Synthetic only", ...stamps
  });
  await insert("customer_address_purposes", {
    address_id: addressId, customer_id: customerId, purpose_code: "shipping", is_default: 1, ...stamps
  });
  const uomId = await insert("item_uoms", { code: "FLOW-EA", name: "Each", status: "active", ...stamps });
  const itemId = await insert("items", { name: "Synthetic Flow Item", status: "active", ...stamps });
  const skuId = await insert("item_skus", {
    item_id: itemId, sku_code: skuCode, sku_name: "Synthetic Flow SKU", status: "active", inventory_tracked: 1, sellable: 1, ...stamps
  });
  await insert("item_sku_uoms", { sku_id: skuId, uom_id: uomId, to_base_factor: 1, is_base: 1, is_default_sale: 1, ...stamps });
  const warehouseId = await insert("inventory_warehouses", {
    warehouse_code: warehouseCode, normalized_code: warehouseCode.toLowerCase(), warehouse_name: "Synthetic Flow Warehouse", status: "ACTIVE", ...stamps
  });
  const binId = await insert("inventory_bins", {
    warehouse_id: warehouseId, bin_code: "FLOW-BIN", normalized_code: "flow-bin", status: "ACTIVE", ...stamps
  });
  const date = formatDateForFile(new Date(now), "Asia/Hong_Kong");
  await insert("inventory_stock_balances", {
    warehouse_id: warehouseId, bin_id: binId, sku_id: skuId, stock_status: "AVAILABLE", on_hand_quantity: 5, fifo_anchor_date: date, ...stamps
  });
  const role = "synthetic-sales-flow";
  const roleId = await insert("roles", { name: role, created_at: now });
  const userId = await insert("users", { username: role, password_hash: "synthetic-only", display_name: "Synthetic Sales Flow", ...stamps });
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [userId, roleId]);
  const permissions = ["sales.view", "sales.mgmt", "fulfillment.view", "fulfillment.operation"];
  await db.execute(`INSERT INTO role_permissions (role_id,permission_id)
    SELECT ?,id FROM permissions WHERE name IN (?,?,?,?)`, [roleId, ...permissions]);
  return { customerCode, skuCode, warehouseCode, warehouseId, skuId, currency, role, userId, permissions, now };
}

test.beforeAll(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") throw new Error("Sales quote-to-ship requires isolated MySQL");
  const native = await nativeDatabase({ after: close => cleanup.push(close) }, {
    async beforeClose() { try { await vite?.close(); } finally { await app?.shutdown("sales_quote_to_ship_browser_complete"); } }
  });
  db = native.db;
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../../../server/scripts/migrate.js", import.meta.url))], {
    env: { ...process.env, DB_NAME: native.name }, timeout: 45000
  });
  fixture = await seed();
  const source = defaultConfigurationSource(), port = randomInt(32000, 59000);
  origin = `http://127.0.0.1:${port}`;
  app = await createApplication({ configurationSource: {
    ...source, application: { ...source.application, host: "127.0.0.1", port: 0 },
    database: { ...source.database, ...native.options, database: native.name },
    sales: { ...source.sales, manualConfirmationWaitMs: 2500 },
    scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs,
      "sales.confirmationRecovery": { enabled: false }, "sales.backorderAllocate": { enabled: false }, "sales.importWorker": { enabled: false }
    } },
    security: { ...source.security, cors: { ...source.security.cors, allowedOrigins: origin } }
  } });
  const subject = String(fixture.userId);
  token = await app.services.require("jwt").issue({ roles: [fixture.role], permissions: fixture.permissions }, {
    subject, version: await app.services.require("tokenRevocation").currentVersion(subject), authTime: Math.floor(fixture.now / 1000)
  });
  const { url } = await app.start();
  process.env.VITE_API_BASE_URL = url;
  vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)),
    configFile: fileURLToPath(new URL("../../vite.config.js", import.meta.url)),
    server: { host: "127.0.0.1", port, strictPort: true }
  });
  await vite.listen();
});

test.afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

async function choose(page, label, code) {
  await page.getByRole("combobox", { name: label, exact: true }).fill(code);
  const option = page.getByRole("option").filter({ hasText: code });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

async function shipConfirmedOrder(page, { db, orderId, orderNumber, skuId }) {
  const post = (path) => page.waitForResponse(
    response => response.request().method() === "POST" && new URL(response.url()).pathname === path
  );
  const button = (name) => page.getByRole("button", { name, exact: true });
  const [stockBefore] = await db.query(
    `SELECT b.id, b.warehouse_id, b.bin_id, b.on_hand_quantity
     FROM inventory_stock_balances b JOIN sales_orders o ON o.fulfillment_warehouse_id=b.warehouse_id
     WHERE o.id=? AND b.sku_id=? AND b.stock_status='AVAILABLE' AND b.on_hand_quantity>0`, [orderId, skuId]
  );
  expect(stockBefore).toHaveLength(1);
  const [balance] = stockBefore;
  expect(String(balance.on_hand_quantity)).toBe("5");
  async function onHand() {
    const [[row]] = await db.query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE id=?", [balance.id]);
    return String(row.on_hand_quantity);
  }
  async function issueMovements() {
    const [rows] = await db.query(`SELECT id, direction, quantity, balance_before, balance_after
      FROM inventory_movements WHERE warehouse_id=? AND bin_id=? AND sku_id=? AND movement_type='ISSUE'`,
    [balance.warehouse_id, balance.bin_id, skuId]);
    return rows;
  }

  await page.goto(`${origin}/fulfillment/queue?q=${encodeURIComponent(orderNumber)}`);
  const orderRow = page.getByRole("row").filter({ hasText: orderNumber });
  await orderRow.getByRole("button", { name: /^建立履約工作：/u }).click();
  const createDialog = page.getByRole("dialog");
  await createDialog.getByRole("textbox", { name: /^計劃數量：/u }).fill("3");
  const created = post("/api/v1/fulfillments/create");
  await createDialog.getByRole("button", { name: "提交建立履約工作", exact: true }).click();
  const fulfillmentResponse = await created;
  expect(fulfillmentResponse.status()).toBe(201);
  const fulfillmentId = (await fulfillmentResponse.json()).data.outcome.id;
  await expect(createDialog).not.toBeVisible();

  await page.goto(`${origin}/fulfillments/${fulfillmentId}`);
  await button("載入完整分配推薦").click();
  await button("更新候選並檢查全部選擇").click();
  await expect(page.getByText("全部選擇已通過檢查，可確認提交", { exact: true })).toBeVisible();
  const allocated = post(`/api/v1/fulfillments/${fulfillmentId}/allocate`);
  await button("提交分配庫存").click();
  await button("確認分配").click();
  expect((await allocated).status()).toBe(200);
  await expect(page.getByText("版本 2", { exact: true })).toBeVisible();

  await button("載入完整揀貨明細").click();
  await expect(page.getByRole("textbox", { name: /^實揀數量：分配/u })).toHaveValue("3");
  await button("提交確認揀貨").click();
  await button("確認揀貨").click();
  await expect(page.getByText("版本 3", { exact: true })).toBeVisible();
  expect(await onHand()).toBe("5");

  const drafted = post(`/api/v1/fulfillments/${fulfillmentId}/shipments/create`);
  await button("建立出貨草稿").click();
  const draftResponse = await drafted;
  expect(draftResponse.status()).toBe(201);
  const shipmentId = (await draftResponse.json()).data.outcome.id;
  await expect(page).toHaveURL(new RegExp(`/shipments/${shipmentId}$`, "u"));
  expect(await onHand()).toBe("5");
  expect(await issueMovements()).toHaveLength(0);
  await button("載入完整出貨庫位摘要").click();
  const confirmed = post(`/api/v1/shipments/${shipmentId}/confirm`);
  await button("提交確認出貨").click();
  await page.getByRole("dialog").getByRole("button", { name: "確認全部出貨", exact: true }).click();
  expect([200, 202]).toContain((await confirmed).status());
  await expect(page.getByText("已出貨", { exact: true })).toBeVisible();

  const [[saved]] = await db.query(
    `SELECT s.sales_order_id, s.fulfillment_id, s.status AS shipment_status,
            o.status AS sales_status, l.fulfilled_base_quantity, l.reserved_outstanding_base_quantity
     FROM shipments s JOIN sales_orders o ON o.id=s.sales_order_id
     JOIN sales_order_lines l ON l.sales_order_id=o.id AND l.sku_id=?
     WHERE s.id=? AND o.sales_order_number=?`, [skuId, shipmentId, orderNumber]
  );
  expect(String(saved.sales_order_id)).toBe(String(orderId));
  expect(String(saved.fulfillment_id)).toBe(String(fulfillmentId));
  expect(saved.shipment_status).toBe("SHIPPED");
  expect(saved.sales_status).toBe("COMPLETED");
  expect(String(saved.fulfilled_base_quantity)).toBe("3");
  expect(String(saved.reserved_outstanding_base_quantity)).toBe("0");

  const movements = await issueMovements();
  expect(movements).toHaveLength(1);
  const [movement] = movements;
  expect(movement.direction).toBe("OUT");
  expect([movement.quantity, movement.balance_before, movement.balance_after].map(String)).toEqual(["3", "5", "2"]);
  const [issues] = await db.query(`SELECT issued_base_quantity, inventory_balance_id, inventory_movement_id
    FROM shipment_issue_details WHERE shipment_id=?`, [shipmentId]);
  expect(issues).toHaveLength(1);
  const [issue] = issues;
  expect(String(issue.inventory_movement_id)).toBe(String(movement.id));
  expect(String(issue.inventory_balance_id)).toBe(String(balance.id));
  expect(String(issue.issued_base_quantity)).toBe("3");
  expect(await onHand()).toBe("2");
}

test("A quoted order is reserved, picked and shipped through the browser", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || message.text().startsWith("[Vue warn]")) errors.push(message.text());
  });
  page.on("requestfailed", request => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") errors.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  page.on("response", response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page.goto(origin + "/login");
  await page.evaluate(async value => {
    const { setToken } = await import("/src/framework/auth/tokenStorage.js");
    setToken(value, 900, 3600);
  }, token);

  await page.goto(origin + "/sales/quotations");
  await page.getByRole("link", { name: "新增報價", exact: true }).click();
  await choose(page, "客戶 *", fixture.customerCode);
  await choose(page, "搜尋 SKU", fixture.skuCode);
  await page.getByRole("button", { name: "新增明細", exact: true }).click();
  await page.getByLabel("數量 1 *", { exact: true }).fill("3");
  await page.getByLabel("售價 1 *", { exact: true }).fill("12.30");
  await page.getByLabel("有效至 *", { exact: true }).fill(formatDateForFile(new Date(fixture.now + 7 * 86400000), "Asia/Hong_Kong"));
  await page.getByRole("button", { name: "儲存報價 Draft", exact: true }).click();
  const saved = page.getByRole("status").filter({ hasText: /報價 QT-.*已儲存/u });
  await expect(saved).toContainText(`${fixture.currency} 36.9000`);
  const quotationNumber = (await saved.textContent()).match(/QT-\d{6}-\d{6}/u)[0];

  await page.goto(origin + "/sales/quotations");
  await page.getByRole("link", { name: `查看 ${quotationNumber}`, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(quotationNumber);
  await page.getByRole("button", { name: "發出報價", exact: true }).click();
  await page.getByRole("button", { name: "確認發出", exact: true }).click();
  await page.getByRole("link", { name: "轉為銷售訂單", exact: true }).click();
  await choose(page, "履約倉庫 *", fixture.warehouseCode);
  await page.getByRole("button", { name: "建立 Draft 銷售訂單", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已建立 SO-" })).toBeVisible();
  await page.getByRole("link", { name: "查看銷售訂單", exact: true }).click();
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^SO-\d{6}-\d{6}$/u);
  const orderNumber = await heading.textContent();
  await expect(page.getByText("報價轉單", { exact: true })).toBeVisible();
  await expect(page.getByText(`${fixture.currency} 36.9000`, { exact: true })).toBeVisible();
  const [[before]] = await db.query("SELECT COUNT(*) AS n FROM inventory_reservations WHERE warehouse_id=?", [fixture.warehouseId]);
  expect(Number(before.n)).toBe(0);

  await page.getByRole("button", { name: "確認訂單", exact: true }).click();
  await page.getByRole("button", { name: "提交確認", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "訂單已確認" })).toBeVisible();
  await expect(page.getByText("Reserved 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Backorder 0", { exact: true })).toBeVisible();
  const [[reservation]] = await db.query(`SELECT o.id AS order_id, o.status, r.outstanding_quantity
    FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=o.id
    JOIN sales_order_line_reservations m ON m.sales_order_line_id=l.id
    JOIN inventory_reservations r ON r.id=m.inventory_reservation_id WHERE o.sales_order_number=?`, [orderNumber]);
  expect(reservation?.status).toBe("CONFIRMED");
  expect(Number(reservation?.outstanding_quantity)).toBe(3);

  await page.getByRole("link", { name: "返回訂單列表", exact: true }).click();
  await page.getByLabel("訂單編號（精確）", { exact: true }).fill(orderNumber);
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  await expect(page.getByRole("link", { name: `查看 ${orderNumber}`, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "未完成訂單", exact: true }).click();
  await page.getByLabel("訂單編號（精確）", { exact: true }).fill(orderNumber);
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  await expect(page.getByRole("link", { name: `查看 ${orderNumber}`, exact: true })).toBeVisible();
  await shipConfirmedOrder(page, { db, orderId: reservation.order_id, orderNumber, skuId: fixture.skuId });
  await page.goto(`${origin}/sales/orders/outstanding?number=${encodeURIComponent(orderNumber)}`);
  await expect(page.getByRole("status").filter({ hasText: "沒有符合條件的未完成銷售訂單" })).toBeVisible();
  expect(errors).toEqual([]);
});
