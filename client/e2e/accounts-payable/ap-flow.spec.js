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
    [role, ["ap.view", "ap.invoice.mgmt", "ap.invoice.price.override", "ap.payment.mgmt", "ap.credit.mgmt", "purchasing.view"]]);
  await db.query("INSERT INTO user_roles (user_id, role_id) SELECT id, ? FROM users WHERE username IN (?, ?)", [role, actor.username, peer.username]);
  const supplierRole = await insert("roles", { name: `ap-supplier-browser-${tag}`, created_at: now });
  await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = 'supplier.view'", [supplierRole]);
  await db.query("INSERT INTO user_roles (user_id, role_id) SELECT id, ? FROM users WHERE username = ?", [supplierRole, peer.username]);
  const [actors] = await db.query("SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?", [user]);
  expect(actors.map(({ name }) => name)).toEqual([`ap-browser-${tag}`]);

  const code = `AP-${tag}`;
  const vendor = { supplier_code_snapshot: code, supplier_name_snapshot: "Browser Test Supplier" };
  supplierId = await insert("suppliers", { supplier_code: code, supplier_code_key: code.toLowerCase(), supplier_name: vendor.supplier_name_snapshot,
    supplier_name_key: vendor.supplier_name_snapshot.toLowerCase(), default_currency_code: "HKD", status: "active", ...dates });
  await insert("currencies", { code: "XAP", name: "AP test currency", decimal_places: 2, status: "ACTIVE", version: 1, ...dates });
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

test("AP credit note browser flow applies and reverses invoice credits", async ({ page }) => {
  page.setDefaultTimeout(10_000);
  const problems = [];
  const isApApi = (url) => /^\/api\/v1\/ap-/u.test(new URL(url).pathname);
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()) && !message.text().startsWith("Failed to load resource")) problems.push(message.text());
  });
  page.on("response", (response) => {
    if (isApApi(response.url()) && response.status() >= 400) problems.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("requestfailed", (request) => {
    if (isApApi(request.url()) && request.failure()?.errorText !== "net::ERR_ABORTED") problems.push(request.failure()?.errorText);
  });
  const code = `APC-${tag}`, now = Date.now();
  const [party] = await db.query("INSERT INTO suppliers SET ?", [{
    supplier_code: code, supplier_code_key: code.toLowerCase(), supplier_name: "Credit Browser Supplier", supplier_name_key: "credit browser supplier",
    default_currency_code: "HKD", status: "active", created_at: now, updated_at: now
  }]);
  const makeInvoice = async (name, total, allocated, outstanding) => {
    const number = `${name}-${tag}`, now = Date.now();
    const [inserted] = await db.query("INSERT INTO ap_invoices SET ?", [{
      invoice_number: number, status: "CONFIRMED", supplier_id: party.insertId,
      supplier_code_snapshot: code, supplier_name_snapshot: "Credit Browser Supplier", currency_code: "HKD",
      currency_decimal_places: 2, supplier_invoice_number: number, invoice_date: today, due_date: today,
      total_amount: total, allocated_amount: allocated, outstanding_amount: outstanding, created_by_label: actor.name, created_at: now, updated_at: now
    }]);
    return { id: inserted.insertId, number };
  };
  const origin = await makeInvoice("APC-ORIGIN", "0.0300", "0.0200", "0.0100");
  const target = await makeInvoice("APC-TARGET", "8.0000", "0.0000", "8.0000");
  const [first] = await db.execute(`INSERT INTO ap_invoice_lines (invoice_id, line_no, line_type, line_amount, description)
    VALUES (?, 1, 'EXPENSE', 0.0149, '第一筆費用'), (?, 2, 'EXPENSE', 0.0149, '第二筆費用')`, [origin.id, origin.id]);
  await login(page, actor, true);
  await page.goto(`/ap/invoices/${origin.id}`);
  await page.getByRole("link", { name: "建立貸項單" }).click();
  await expect(page.getByRole("heading", { name: "建立應付貸項單" })).toBeVisible();
  await page.getByLabel("貸項原因", { exact: true }).fill("供應商修正原發票");
  await page.getByLabel("原發票行", { exact: true }).selectOption(String(first.insertId));
  await page.getByLabel("貸項金額", { exact: true }).fill("0.021");
  await page.getByRole("button", { name: "建立貸項草稿", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "請選擇每行的原發票行並輸入有效金額" })).toBeFocused();
  await page.getByLabel("貸項金額", { exact: true }).fill("0.02");
  await page.getByRole("button", { name: "建立貸項草稿", exact: true }).click();
  await page.waitForURL(/\/ap\/credit-notes\/\d+$/u);
  const creditPath = new URL(page.url()).pathname;
  await page.reload();
  await page.getByRole("button", { name: "編輯草稿" }).click();
  await page.getByLabel("備註（選填）", { exact: true }).fill("核對供應商貸項");
  await page.getByRole("button", { name: "儲存草稿" }).click();
  await expect(page.getByText("核對供應商貸項", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "確認貸項單", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "確認貸項單" });
  await expect(confirm.getByRole("button", { name: "返回" })).toBeFocused();
  await confirm.getByRole("button", { name: "確認貸項單" }).click();
  await expect(page.getByRole("heading", { name: /^SCN-\d{4}-\d{6}$/u })).toBeVisible();
  await expect(page.getByText("原發票核銷", { exact: true })).toBeVisible();
  await page.getByLabel("被核銷發票", { exact: true }).selectOption(String(target.id));
  await page.getByLabel("核銷金額", { exact: true }).fill("0.01");
  await page.getByRole("button", { name: "核銷貸項", exact: true }).click();
  await expect(page.getByText("其他發票核銷", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "解除核銷", exact: true }).click();
  await page.getByRole("dialog", { name: "解除核銷" }).getByRole("button", { name: "解除核銷" }).click();
  await expect(page.getByRole("button", { name: "解除核銷", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "作廢貸項單", exact: true }).click();
  const voidDialog = page.getByRole("dialog", { name: "作廢貸項單" });
  await voidDialog.getByLabel("作廢原因（最少 5 字）").fill("供應商更正貸項原因");
  await voidDialog.getByRole("button", { name: "作廢貸項單" }).click();
  await expect(page.getByText("供應商更正貸項原因", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "返回貸項列表" }).click();
  const link = page.getByRole("link", { name: /^SCN-\d{4}-\d{6}$/u }).first();
  await expect(link).toHaveAttribute("href", creditPath);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(link).toHaveAttribute("href", creditPath);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(problems).toEqual([]);
});

test("AP browser flow confirms a receipt-backed invoice, pays it and clears aging", async ({ page }) => {
  const errors = [];
  const paymentEndpoint = "**/api/v1/ap-payments";
  let discardedRequest, rejectedEvent;
  const prepaymentReference = `PREPAY-${tag}`;
  const supplierCalls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning" || (message.type() === "error" && !message.text().startsWith("Failed to load resource"))) {
      errors.push(message.text());
    }
  });
  const isSupplierApi = (url) => /^\/api\/v1\/(?:suppliers|supplier-lookups)(?:\/|$)/u.test(new URL(url).pathname);
  const isApApi = (url) => /^\/api\/v1\/(?:ap-|goods-receipts)/u.test(new URL(url).pathname) || isSupplierApi(url);
  page.on("request", (request) => { if (isSupplierApi(request.url())) supplierCalls.push(request.url()); });
  page.on("response", (response) => {
    if (response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/ap-payments") {
      const body = response.request().postDataJSON();
      if (response.status() === 400 && body?.eventId === rejectedEvent) return;
      if (response.status() === 409 && body?.reference === prepaymentReference) return;
    }
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
  await expect(page.getByText("依供應商篩選需要「查看供應商」權限。")).toBeVisible();
  await page.getByLabel("無採購單發票").check();
  await expect(page.getByText("登記無採購單發票需要「查看供應商」權限。")).toBeVisible();
  await page.getByLabel("由收貨開票").check();
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
  const paymentForm = `/ap/payments/new?supplierId=${supplierId}&currencyCode=HKD`;
  await page.goto(`/ap/invoices?q=${invoiceNumber}`);
  await expect(page.getByRole("row").filter({ hasText: invoiceNumber }).getByRole("link", { name: "登記付款", exact: true })).toHaveAttribute("href", paymentForm);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/ap/aging?supplierId=${supplierId}&currencyCode=HKD`);
  const agingTable = page.getByRole("region", { name: "應付帳齡表" });
  await expect(agingTable.getByRole("rowheader", { name: /Browser Test Supplier/u })).toBeVisible();
  await expect(agingTable.getByTestId("ap-aging-total")).toContainText("325.00");
  await expect(agingTable.getByTestId("ap-aging-row").getByRole("link", { name: "登記付款", exact: true })).toHaveAttribute("href", paymentForm);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/ap/payments/new?supplierId=${supplierId}&currencyCode=XAP`);
  await expect(page.getByRole("status").filter({ hasText: "搜尋供應商需要" })).toBeVisible();
  await expect(page.getByRole("button", { name: "登記付款草稿" })).toHaveCount(0);
  await page.goto(invoicePath);
  await page.getByRole("link", { name: "登記付款", exact: true }).click();
  const partyInput = page.getByLabel("供應商", { exact: true }), currencyInput = page.getByLabel("幣別", { exact: true });
  await expect(partyInput).toHaveValue(`AP-${tag} — Browser Test Supplier`);
  await expect(partyInput).toHaveAttribute("readonly", "");
  await expect(currencyInput).toHaveValue("HKD");
  await expect(currencyInput).toHaveAttribute("readonly", "");
  await page.getByLabel("付款金額", { exact: true }).fill("325.00");
  await page.getByRole("button", { name: "登記付款草稿" }).click();
  await expect(page.getByLabel("轉帳參考", { exact: true })).toBeFocused();
  await page.getByLabel("轉帳參考", { exact: true }).fill(`TEST-${tag}`);
  const retry = page.getByRole("button", { name: "重試原操作", exact: true });
  const countDrafts = async () => Number((await db.query(
    "SELECT COUNT(*) AS total FROM ap_payments WHERE supplier_id = ? AND reference = ?", [supplierId, `TEST-${tag}`]
  ))[0][0].total);
  const loseRejection = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe("AP_INPUT_INVALID");
    discardedRequest = route.request();
    rejectedEvent = discardedRequest.postDataJSON().eventId;
    await route.abort("failed");
  };
  await page.getByLabel("付款金額", { exact: true }).fill("12.345");
  await page.route(paymentEndpoint, loseRejection);
  await page.getByRole("button", { name: "登記付款草稿" }).click();
  await expect(retry).toBeVisible();
  await page.unroute(paymentEndpoint, loseRejection);
  await page.reload();
  const rejectResponse = page.waitForResponse((response) => response.status() === 400 &&
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/ap-payments");
  await retry.click();
  expect((await rejectResponse).request().postDataJSON().eventId).toBe(rejectedEvent);
  await expect(page.getByRole("alert").filter({ hasText: "應付資料不正確" })).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(page.getByLabel("付款金額", { exact: true })).toBeEditable();
  expect(await countDrafts()).toBe(0);
  await page.getByLabel("付款金額", { exact: true }).fill("325.00");
  await db.query("UPDATE suppliers SET status = 'archived' WHERE id = ?", [supplierId]);
  const loseResponse = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    discardedRequest = route.request();
    await route.abort("failed");
  };
  await page.route(paymentEndpoint, loseResponse);
  await page.getByRole("button", { name: "登記付款草稿" }).click();
  await expect(retry).toBeVisible();
  await page.unroute(paymentEndpoint, loseResponse);
  expect(await countDrafts()).toBe(1);
  await page.reload();
  await expect(retry).toBeVisible();
  await expect(page.getByLabel("付款金額", { exact: true })).toHaveValue("325.00");
  const expectedEvent = discardedRequest.postDataJSON().eventId;
  expect(expectedEvent).not.toBe(rejectedEvent);
  expect(supplierCalls).toEqual([]);
  await logout(page, actor);
  await login(page, peer, true);
  await page.goto("/ap/payments/new");
  await expect(page.getByRole("button", { name: "登記付款草稿" })).toBeEnabled();
  await expect(retry).toHaveCount(0);
  await expect(page.getByLabel("付款金額", { exact: true })).toHaveValue("");
  await partyInput.fill(`AP-${tag}`);
  await page.getByRole("option", { name: `AP-${tag} — Browser Test Supplier` }).click();
  await expect(page.getByText(/^HKD —/u)).toBeVisible();
  await page.getByLabel("幣別", { exact: true }).click();
  await page.getByRole("option", { name: "XAP — AP test currency" }).click();
  await expect(page.locator("form").getByText("XAP — AP test currency", { exact: true })).toBeVisible();
  await page.getByLabel("付款金額", { exact: true }).fill("10.00");
  await page.getByLabel("轉帳參考", { exact: true }).fill(prepaymentReference);
  const prepaymentResponse = page.waitForResponse((response) => response.status() === 409 &&
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/ap-payments");
  await page.getByRole("button", { name: "登記付款草稿" }).click();
  expect((await (await prepaymentResponse).json()).error.code).toBe("AP_PREPAYMENT_REQUIRES_ACTIVE_SUPPLIER");
  await expect(page.getByRole("alert").filter({ hasText: "只有啟用中的供應商可登記預付款" })).toBeVisible();
  await expect(page.getByLabel("付款金額", { exact: true })).toBeEditable();
  await page.goto("/ap/invoices/new");
  await page.getByLabel("篩選供應商", { exact: true }).fill(`AP-${tag}`);
  await page.getByRole("option", { name: `AP-${tag} — Browser Test Supplier` }).click();
  const filteredReceipts = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/goods-receipts" &&
    new URL(request.url()).searchParams.get("supplierId") === String(supplierId));
  await page.getByRole("button", { name: "搜尋已確認收貨" }).click();
  await filteredReceipts;
  await db.query("UPDATE suppliers SET status = 'active' WHERE id = ?", [supplierId]);
  await page.getByLabel("無採購單發票").check();
  await partyInput.fill(`AP-${tag}`);
  await page.getByRole("option", { name: `AP-${tag} — Browser Test Supplier` }).click();
  await expect(page.getByText(/^HKD —/u)).toBeVisible();
  await page.getByLabel("無採購單原因", { exact: true }).fill("Browser test expense");
  const expenseInvoice = `EXPENSE-${tag}`;
  await page.getByLabel("供應商發票號碼", { exact: true }).fill(expenseInvoice);
  await page.getByLabel("到期日", { exact: true }).fill(today);
  await page.getByRole("button", { name: "新增費用行" }).click();
  await page.getByLabel("費用 1 說明", { exact: true }).fill("Browser test");
  await page.getByLabel("費用 1 金額", { exact: true }).fill("10.00");
  await page.getByRole("button", { name: "建立應付發票草稿" }).click();
  await expect(page.getByText(expenseInvoice, { exact: true })).toBeVisible();
  await db.query("UPDATE suppliers SET status = 'archived' WHERE id = ?", [supplierId]);
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
  await expect(page.getByText(/搜尋供應商需要/)).toBeVisible();
  await expect(page.getByRole("button", { name: "登記付款草稿" })).toHaveCount(0);
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
