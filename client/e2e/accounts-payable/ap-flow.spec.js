import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";

const serverDir = fileURLToPath(new URL("../../../server/", import.meta.url));
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const actor = { username: `ap-browser-${tag}`, password: `Ap-test-${tag}-1!`, name: "AP Browser Test" };
const peer = { username: `ap-peer-${tag}`, password: `Ap-peer-${tag}-1!`, name: "AP Browser Peer" };
const invoiceNumber = `BROWSER-${tag}`;
let db, app, supplierId, receiptId, receiptNumber, today;

test.beforeAll(async () => {
  const source = defaultConfigurationSource();
  const port = Number(process.env.AP_TEST_API_PORT);
  app = await createApplication({ configurationSource: { ...source,
    application: { ...source.application, host: "127.0.0.1", port },
    security: { ...source.security, cors: { ...source.security.cors, allowedOrigins: `http://127.0.0.1:${process.env.AP_TEST_CLIENT_PORT}` } },
    requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 160 },
    scheduler: { ...source.scheduler, jobs: Object.fromEntries(Object.entries(source.scheduler.jobs).map(([id, job]) => [id, { ...job, enabled: false }])) }
  } });
  db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, socketPath: process.env.DB_SOCKET_PATH });
  function createUser({ username, password, name }) {
    execFileSync(process.execPath, ["scripts/createUser.js", username, "--name", name], {
      cwd: serverDir, input: `${password}\n`, stdio: ["pipe", "ignore", "inherit"]
    });
  }
  const bootstrap = `ap-bootstrap-${tag}`;
  createUser({ username: bootstrap, password: `Ap-boot-${tag}-1!`, name: "AP Bootstrap" });
  await db.query("UPDATE users SET status = 'disabled' WHERE username = ?", [bootstrap]);
  createUser(actor);
  createUser(peer);
  const [[{ id: user }]] = await db.query("SELECT id FROM users WHERE username = ?", [actor.username]);
  const time = app.services.require("time"), now = time.nowMs();
  today = time.fileDate(time.at(now));
  const dates = { created_at: now, updated_at: now };
  const insert = async (table, row) => (await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId;
  const role = await insert("roles", { name: `ap-browser-${tag}`, created_at: now });
  await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?)",
    [role, ["ap.view", "ap.invoice.mgmt", "ap.invoice.price.override", "ap.payment.mgmt", "purchasing.view"]]);
  await db.query("INSERT INTO user_roles (user_id, role_id) SELECT id, ? FROM users WHERE username IN (?, ?)", [role, actor.username, peer.username]);
  const [actors] = await db.query("SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?", [user]);
  expect(actors.map(({ name }) => name)).toEqual([`ap-browser-${tag}`]);

  const code = `AP-${tag}`;
  const vendor = { supplier_code_snapshot: code, supplier_name_snapshot: "Browser Test Supplier" };
  supplierId = await insert("suppliers", { supplier_code: code, supplier_code_key: code.toLowerCase(), supplier_name: vendor.supplier_name_snapshot,
    supplier_name_key: vendor.supplier_name_snapshot.toLowerCase(), default_currency_code: "HKD", status: "active", ...dates });
  const item = await insert("items", { name: `Browser item ${tag}`, status: "active", ...dates });
  const sku = await insert("item_skus", { item_id: item, sku_code: `APSKU-${tag}`, sku_name: "Browser test SKU",
    status: "active", tracking_policy: "none", purchasable: 1, inventory_tracked: 1, ...dates });
  const unitCode = `EA-${tag}`;
  const uom = await insert("item_uoms", { code: unitCode, name: "Each", status: "active", ...dates });
  const skuUom = await insert("item_sku_uoms", { sku_id: sku, uom_id: uom, to_base_factor: 1, is_base: 1, ...dates });
  const month = "209502";
  const [[{ number }]] = await db.query("SELECT GREATEST(COALESCE((SELECT MAX(sequence_no) FROM purchase_orders WHERE document_year_month = ?), 0), COALESCE((SELECT MAX(sequence_no) FROM goods_receipts WHERE document_year_month = ?), 0)) + 1 AS number", [month, month]);
  const suffix = String(number).padStart(6, "0");
  const po = await insert("purchase_orders", {
    ...vendor, po_number: `PO-${month}-${suffix}`, document_year_month: month, sequence_no: number, supplier_id: supplierId,
    currency_code: "HKD", currency_name_snapshot: "Hong Kong Dollar", currency_decimal_places_snapshot: 2,
    order_date: today, buyer_id: user, buyer_label: "AP Browser Test", total_amount: "325.0000", subtotal_amount: "325.0000",
    has_outstanding: 1, created_by_label: "AP Browser Test", updated_by_label: "AP Browser Test", ...dates
  });
  const line = await insert("purchase_order_lines", {
    purchase_order_id: po, line_number: 1, sku_id: sku, sku_code_snapshot: `APSKU-${tag}`, sku_name_snapshot: "Browser test SKU",
    inventory_tracked_snapshot: 1, tracking_policy_snapshot: "none", base_uom_id: uom, base_uom_code_snapshot: unitCode,
    purchase_sku_uom_id: skuUom, purchase_uom_code_snapshot: unitCode, uom_to_base_factor_snapshot: 1,
    ordered_quantity: "1", ordered_base_quantity: 1, unit_price: "325.0000", line_amount: "325.0000", has_outstanding: 1, ...dates
  });
  await db.query("UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = ? WHERE id = ?", [now, po]);
  receiptNumber = `GR-${month}-${suffix}`;
  receiptId = await insert("goods_receipts", { ...vendor, gr_number: receiptNumber, document_year_month: month,
    sequence_no: number, purchase_order_id: po, supplier_id: supplierId, business_receipt_date: today,
    total_received_base_quantity: 1, created_by_label: "AP Browser Test", updated_by_label: "AP Browser Test", ...dates });
  await insert("goods_receipt_lines", { goods_receipt_id: receiptId, purchase_order_id: po, purchase_order_line_id: line,
    line_number: 1, sku_id: sku, sku_code_snapshot: `APSKU-${tag}`, sku_name_snapshot: "Browser test SKU", received_base_quantity: 1, ...dates });
  await db.query("UPDATE goods_receipts SET status = 'CONFIRMED', confirmed_at = ?, confirmed_by = ?, confirm_event_id = ? WHERE id = ?",
    [now, user, randomUUID(), receiptId]);
  await app.start();
});

test.afterAll(async () => {
  await app?.shutdown("ap_browser_complete");
  await db?.end();
});

async function login(page, account, freshDevice) {
  await page.goto("/login");
  async function signIn() {
    await page.getByLabel("帳號", { exact: true }).fill(account.username);
    await page.getByLabel("密碼", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
  }
  await signIn();
  if (freshDevice) {
    await page.waitForURL("**/device/pending");
    const [[{ id }]] = await db.query("SELECT d.id FROM user_devices d JOIN users u ON u.id = d.user_id WHERE u.username = ? AND d.status = 'pending'", [account.username]);
    execFileSync(process.execPath, ["scripts/approveDevice.js", String(id)], { cwd: serverDir, stdio: ["ignore", "ignore", "inherit"] });
    await page.getByRole("button", { name: "返回登入", exact: true }).click();
    await page.waitForURL("**/login");
    await signIn();
  }
  await page.waitForURL((url) => url.pathname === "/");
}

async function logout(page, account) {
  await page.getByRole("button", { name: account.name }).click();
  await page.getByText("登出", { exact: true }).click();
  await page.waitForURL("**/login");
}

test("AP browser flow confirms a receipt-backed invoice, pays it and clears aging", async ({ page }) => {
  const errors = [];
  const paymentEndpoint = "**/api/v1/ap-payments";
  let discardedRequest;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning" || (message.type() === "error" && !message.text().startsWith("Failed to load resource"))) {
      errors.push(message.text());
    }
  });
  const isApApi = (url) => /^\/api\/v1\/(?:ap-|goods-receipts)/u.test(new URL(url).pathname);
  page.on("response", (response) => {
    if (isApApi(response.url()) && response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("requestfailed", (request) => {
    if (request !== discardedRequest && isApApi(request.url()) && request.failure()?.errorText !== "net::ERR_ABORTED") {
      errors.push(`request failed: ${new URL(request.url()).pathname}`);
    }
  });
  await login(page, actor, true);
  await page.goto(`/purchasing/goods-receipts/${receiptId}`);
  await expect(page.getByRole("heading", { name: receiptNumber })).toBeVisible();
  await page.goto("/ap/invoices");
  await page.getByRole("link", { name: "登記應付發票", exact: true }).click();
  await page.getByLabel("篩選供應商 ID", { exact: true }).fill(String(supplierId));
  await page.getByRole("button", { name: "搜尋已確認收貨" }).click();
  await page.getByRole("checkbox", { name: `選擇 ${receiptNumber}` }).click();
  await page.getByLabel("供應商發票號碼", { exact: true }).fill(invoiceNumber);
  await page.getByLabel("供應商發票總額", { exact: true }).fill("325.00");
  await page.getByLabel("到期日", { exact: true }).fill(today);
  await page.getByRole("button", { name: "建立應付發票草稿" }).click();
  await expect(page.getByText(invoiceNumber, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "確認發票", exact: true }).click();
  const invoiceDialog = page.getByRole("dialog", { name: "確認發票" });
  await expect(invoiceDialog.getByRole("button", { name: "返回" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(invoiceDialog).toBeHidden();
  await page.getByRole("button", { name: "確認發票", exact: true }).click();
  await invoiceDialog.getByRole("button", { name: "確認發票" }).click();
  const invoiceHeading = page.getByRole("heading", { name: /^APV-\d{4}-\d{6}$/u });
  await expect(invoiceHeading).toBeVisible();
  const confirmedInvoice = await invoiceHeading.textContent();
  const invoicePath = new URL(page.url()).pathname;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/ap/aging?supplierId=${supplierId}&currencyCode=HKD`);
  const agingTable = page.getByRole("region", { name: "應付帳齡表" });
  await expect(agingTable.getByRole("rowheader", { name: /Browser Test Supplier/u })).toBeVisible();
  await expect(agingTable.getByTestId("ap-aging-total")).toContainText("325.00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(invoicePath);
  await page.getByRole("link", { name: "登記付款", exact: true }).click();
  await expect(page.getByLabel("供應商 ID", { exact: true })).toHaveValue(String(supplierId));
  await expect(page.getByLabel("貨幣代碼", { exact: true })).toHaveValue("HKD");
  await page.getByLabel("付款金額", { exact: true }).fill("325.00");
  await page.getByRole("button", { name: "登記付款草稿" }).click();
  await expect(page.getByLabel("轉帳參考", { exact: true })).toBeFocused();
  await page.getByLabel("轉帳參考", { exact: true }).fill(`TEST-${tag}`);
  const loseResponse = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    discardedRequest = route.request();
    await route.abort("failed");
  };
  await page.route(paymentEndpoint, loseResponse);
  await page.getByRole("button", { name: "登記付款草稿" }).click();
  const retry = page.getByRole("button", { name: "重試原操作", exact: true });
  await expect(retry).toBeVisible();
  await page.unroute(paymentEndpoint, loseResponse);
  const countDrafts = async () => Number((await db.query(
    "SELECT COUNT(*) AS total FROM ap_payments WHERE supplier_id = ? AND reference = ?", [supplierId, `TEST-${tag}`]
  ))[0][0].total);
  expect(await countDrafts()).toBe(1);
  await page.reload();
  await expect(retry).toBeVisible();
  await expect(page.getByLabel("付款金額", { exact: true })).toHaveValue("325.00");
  const expectedEvent = discardedRequest.postDataJSON().eventId;
  await logout(page, actor);
  await login(page, peer, true);
  await page.goto("/ap/payments/new");
  await expect(page.getByRole("button", { name: "登記付款草稿" })).toBeEnabled();
  await expect(retry).toHaveCount(0);
  await expect(page.getByLabel("付款金額", { exact: true })).toHaveValue("");
  await logout(page, peer);
  await login(page, actor, false);
  await page.goto("/ap/payments/new");
  await expect(retry).toBeVisible();
  const resent = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/ap-payments");
  await retry.click();
  expect((await resent).postDataJSON().eventId).toBe(expectedEvent);
  await page.getByRole("button", { name: "確認付款", exact: true }).waitFor();
  expect(await countDrafts()).toBe(1);
  const paymentPath = new URL(page.url()).pathname;
  await page.goto("/ap/payments/new");
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登記付款草稿" })).toBeEnabled();
  await page.goto(paymentPath);
  await page.getByRole("button", { name: "確認付款", exact: true }).click();
  await page.getByRole("dialog", { name: "確認付款" }).getByRole("button", { name: "確認付款", exact: true }).click();
  const paymentHeading = page.getByRole("heading", { name: /^PMT-\d{4}-\d{6}$/u });
  await expect(paymentHeading).toBeVisible();
  const paymentNumber = await paymentHeading.textContent();
  await page.getByRole("button", { name: `填入 ${confirmedInvoice}` }).click();
  await page.getByRole("button", { name: "核銷", exact: true }).click();
  await expect(page.getByRole("link", { name: confirmedInvoice, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: confirmedInvoice, exact: true })).toBeVisible();
  await page.goto("/ap/payments");
  await expect(page.getByText(paymentNumber, { exact: true })).toBeVisible();
  await page.goto(`/ap/aging?supplierId=${supplierId}&currencyCode=HKD`);
  await expect(page.getByText("沒有未付的應付發票。", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
