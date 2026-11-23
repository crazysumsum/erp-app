// Purchase-order approval flow through the real UI (the former C3 scenario as an ordinary spec):
// U3 turns approval on, U1 creates/submits two POs and withdraws + resubmits one, U2 approves A through a lost
// response and an idempotent replay, then rejects B. U1 receives A and confirms the stock increase.
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../server");
const run = Date.now().toString(36);
const PASSWORD_INVALID = "請確認你目前的密碼";
const orderDate = "2098-10-01";
const supplierCode = `PW-SUP-${run}`.toUpperCase();
const skuCode = `PW-SKU-${run}`.toUpperCase();
const warehouseCode = `PW-WH-${run}`.toUpperCase();
const binCode = "PW-01";
const lotNumber = `PW-LOT-${run}`;
const users = Object.fromEntries(["U1", "U2", "U3"].map((k) => [k, {
  username: `pw-${k.toLowerCase()}-${run}`, name: `PW ${k} ${run}`, password: `Pw-${k}-${run}-Aa1!`, wrongPassword: `Wrong-${k}-${run}-Aa1!`
}]));
const R = { R1: "E2E 開啟採購審批", R5: "E2E 撤回重交", R11: "E2E 拒絕測試" };

let db, app, skuId;
const po = {};

const createUser = (username, name, password) =>
  execFileSync(process.execPath, ["scripts/createUser.js", username, "--name", name], { cwd: serverDir, input: `${password}\n`, stdio: ["pipe", "ignore", "inherit"] });

test.beforeAll(async () => {
  db = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || "erp_user",
    password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "erp_dev", socketPath: process.env.DB_SOCKET_PATH || undefined
  });
  const now = Date.now();
  // The first account on an empty database becomes system-admin; keep that away from the three actors.
  createUser(`pw-boot-${run}`, `PW Boot ${run}`, `Pw-boot-${run}-Aa1!`);
  await db.execute("UPDATE users SET status = 'disabled' WHERE username = ?", [`pw-boot-${run}`]);
  for (const u of Object.values(users)) createUser(u.username, u.name, u.password);
  for (const [key, perms] of [["U1", ["purchasing.view", "purchasing.mgmt", "receiving.operation", "inventory.view"]], ["U2", ["purchasing.view", "purchasing.approval"]], ["U3", ["purchasing.settings"]]]) {
    const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`pw-${key.toLowerCase()}-${run}`, now]);
    await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?)", [role.insertId, perms]);
    await db.execute("INSERT INTO user_roles (user_id, role_id) SELECT id, ? FROM users WHERE username = ?", [role.insertId, users[key].username]);
  }
  // Approval starts off, so U3's switch turns it on (also on a reused database). Deliberate set-up write to the shared
  // settings row: in CI this step runs after coverage and the shard identity record, on a per-job throwaway erp_dev.
  await db.execute("UPDATE purchasing_settings SET require_po_approval = 0 WHERE id = 1");
  const ins = async (table, row) => (await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId;
  await ins("suppliers", { supplier_code: supplierCode, supplier_code_key: supplierCode.toLowerCase(), supplier_name: `PW Supplier ${run}`,
    display_name: `PW Supplier ${run}`, supplier_name_key: `pw supplier ${run}`, default_currency_code: "HKD", default_payment_term_id: null, status: "active", created_at: now, updated_at: now });
  const itemId = await ins("items", { name: `PW Item ${run}`, status: "active", created_at: now, updated_at: now });
  const uomId = await ins("item_uoms", { code: `PW${run}`.toUpperCase().slice(0, 20), name: "EA", status: "active", created_at: now, updated_at: now });
  skuId = await ins("item_skus", { item_id: itemId, sku_code: skuCode, sku_name: `PW SKU ${run}`, status: "active", tracking_policy: "batch",
    purchasable: 1, inventory_tracked: 1, min_receipt_life_days: null, created_at: now, updated_at: now });
  await ins("item_sku_uoms", { sku_id: skuId, uom_id: uomId, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
  const warehouseId = await ins("inventory_warehouses", { warehouse_code: warehouseCode, normalized_code: warehouseCode.toLowerCase(), warehouse_name: `PW Warehouse ${run}`, created_at: now, updated_at: now });
  await ins("inventory_bins", { warehouse_id: warehouseId, bin_code: binCode, normalized_code: binCode.toLowerCase(), created_at: now, updated_at: now });

  // The real API in-process (fulfillment p1 style); its database settings come from DB_* through the default source.
  const source = defaultConfigurationSource();
  app = await createApplication({ configurationSource: { ...source,
    application: { ...source.application, host: "127.0.0.1", port: Number(process.env.PURCHASING_TEST_API_PORT) },
    security: { ...source.security, cors: { ...source.security.cors, allowedOrigins: `http://127.0.0.1:${process.env.PURCHASING_TEST_CLIENT_PORT}` } },
    scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs, "sales.backorderAllocate": { enabled: false }, "sales.importWorker": { enabled: false },
      "sales.quotationExpire": { enabled: false }, "sales.confirmationRecovery": { enabled: false } } } } });
  await app.start();
});

test.afterAll(async () => {
  await app?.shutdown("purchasing_approval_browser_complete");
  await db?.end();
});

/** A fresh context per actor; uncaught errors and console errors are collected. The expected 403s and the deliberately
 * aborted approve log only "Failed to load resource", which is excluded. */
const browserErrors = [];
async function actorPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) browserErrors.push(`console: ${m.text()}`); });
  return { context, page };
}

/** Each actor uses its own context; the first login lands on the device-pending page, approveDevice.js approves it. */
async function login(page, u) {
  await page.goto("/login");
  for (const pending of [true, false]) {
    await page.getByLabel("帳號", { exact: true }).fill(u.username);
    await page.getByLabel("密碼", { exact: true }).fill(u.password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    if (!pending) break;
    await page.waitForURL("**/device/pending");
    const [rows] = await db.execute("SELECT d.id FROM user_devices d JOIN users u ON u.id = d.user_id WHERE u.username = ? AND d.status = 'pending'", [u.username]);
    expect(rows).toHaveLength(1);
    execFileSync(process.execPath, ["scripts/approveDevice.js", String(rows[0].id)], { cwd: serverDir, stdio: ["ignore", "ignore", "inherit"] });
    await page.getByRole("button", { name: "返回登入", exact: true }).click();
    await page.waitForURL("**/login");
  }
  await page.waitForURL((url) => url.pathname === "/");
}

const menu = (page, title) => page.getByRole("link", { name: title, exact: true });
const response = (page, method, pathname) => page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === pathname);
const lookupFilled = (page, kind, q) => page.waitForResponse((r) => {
  const u = new URL(r.url());
  return u.pathname === `/api/v1/purchasing-lookups/${kind}` && u.searchParams.get("q") === q;
});
/** The field carrying this aria-label shows no loading spinner (QSelect has applied its latest result). */
const fieldSettled = (page, label) => page.waitForFunction((l) => {
  const field = document.querySelector(`[aria-label="${CSS.escape(l)}"]`)?.closest(".q-field");
  return !!field && !field.querySelector(".q-spinner");
}, label);

async function pickLookup(page, { label, kind, text, optionPrefix, defaults }) {
  const select = page.getByLabel(label, { exact: true });
  const opened = lookupFilled(page, kind, "");
  await select.click();
  await opened;
  await fieldSettled(page, label);
  const filled = lookupFilled(page, kind, text);
  await select.fill(text);
  const body = await (await filled).json();
  expect(body?.data?.items?.length ?? body?.data?.length).toBe(1);
  await fieldSettled(page, label);
  const option = page.getByRole("option", { name: new RegExp(`^${optionPrefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u") });
  await expect(option).toHaveCount(1);
  await option.click();
  if (defaults) await expect(page.getByText(/^HKD — /u).first()).toBeVisible();   // supplier defaults applied
}

async function createPo(page, key) {
  await menu(page, "採購單").click();
  const add = page.getByRole("link", { name: "新增採購單" }).or(page.getByRole("button", { name: "新增採購單" }));
  await add.click();
  await page.waitForURL("**/purchasing/purchase-orders/new");
  await pickLookup(page, { label: "供應商 *", kind: "suppliers", text: supplierCode, optionPrefix: `${supplierCode} — `, defaults: true });
  const date = page.getByLabel("訂單日期 *", { exact: true });
  await date.fill(orderDate);
  await expect(date).toHaveValue(orderDate);
  await pickLookup(page, { label: "搜尋貨品", kind: "skus", text: skuCode, optionPrefix: `${skuCode} — ` });
  await page.getByRole("button", { name: "新增明細", exact: true }).click();
  await page.getByLabel("數量 1 *", { exact: true }).fill(key === "A" ? "2" : "1");
  await page.getByLabel("單價 1 *", { exact: true }).fill("2.50");
  const created = response(page, "POST", "/api/v1/purchase-orders/create");
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const { data } = await res.json();
  expect(data).toMatchObject({ status: "DRAFT", version: 1, replayed: false });
  po[key] = { id: data.id, number: data.number };
  await page.waitForURL(`**/purchasing/purchase-orders/${data.id}/edit`);
}

async function submitPo(page, key) {
  const { id } = po[key];
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await page.getByLabel("審批人 *", { exact: true }).click();
  await page.getByRole("option", { name: users.U2.name, exact: true }).click();
  const submitted = response(page, "POST", `/api/v1/purchase-orders/${id}/submit`);
  await page.getByRole("button", { name: "提交審批", exact: true }).click();
  const res = await submitted;
  expect(res.status()).toBe(200);
  expect((await res.json()).data).toMatchObject({ status: "PENDING_APPROVAL", outcome: "PENDING_APPROVAL", replayed: false });
  await page.waitForURL(`**/purchasing/purchase-orders/${id}`);
}

/** A rejected command renders the server's message and the button is usable again. */
async function failedSettled(page, alertText, button) {
  await expect(page.getByRole("alert").filter({ hasText: alertText }).first()).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button.locator(".q-spinner")).toHaveCount(0);
}

test("PO approval and receipt: settings, submit, withdraw/resubmit, approve through a lost response, reject, post stock", async ({ browser }) => {
  // U3: a wrong password is rejected and the reason is kept; the right password turns approval on.
  let { context, page } = await actorPage(browser);
  await login(page, users.U3);
  await menu(page, "採購設定").click();
  await expect(page.getByRole("heading", { level: 2, name: "採購單審批", exact: true })).toBeVisible();
  const save = page.getByRole("button", { name: "儲存設定" });
  await page.getByRole("switch", { name: "提交採購單時需要審批" }).click();
  await page.getByLabel("變更原因 *", { exact: true }).fill(R.R1);
  await page.getByLabel("密碼 *", { exact: true }).fill(users.U3.wrongPassword);
  let pending = response(page, "POST", "/api/v1/purchasing-settings/update");
  await save.click();
  expect((await pending).status()).toBe(403);
  await failedSettled(page, PASSWORD_INVALID, save);
  await expect(page.getByLabel("變更原因 *", { exact: true })).toHaveValue(R.R1);
  await page.getByLabel("密碼 *", { exact: true }).fill(users.U3.password);
  pending = response(page, "POST", "/api/v1/purchasing-settings/update");
  await save.click();
  let res = await pending;
  expect(res.status()).toBe(200);
  expect((await res.json()).data).toMatchObject({ requirePoApproval: true, replayed: false });
  await context.close();

  // U1: create and submit A and B, withdraw B back to draft, resubmit B.
  ({ context, page } = await actorPage(browser));
  await login(page, users.U1);
  await createPo(page, "A");
  await submitPo(page, "A");
  await createPo(page, "B");
  await submitPo(page, "B");
  await page.getByRole("button", { name: "撤回審批", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(R.R5);
  pending = response(page, "POST", `/api/v1/purchase-orders/${po.B.id}/approval/withdraw`);
  await dialog.getByRole("button", { name: "撤回", exact: true }).click();
  res = await pending;
  expect(res.status()).toBe(200);
  expect((await res.json()).data).toMatchObject({ status: "DRAFT", replayed: false });
  await page.getByRole("button", { name: "編輯草稿" }).or(page.getByRole("link", { name: "編輯草稿" })).click();
  await page.waitForURL(`**/purchasing/purchase-orders/${po.B.id}/edit`);
  await submitPo(page, "B");
  const buyer = { context, page };

  // U2: approve A. #7 wrong password; #8 the server commits but the response is lost; #9 wrong password while
  // uncertain; #10 the same request replays the committed decision. Then reject B.
  ({ context, page } = await actorPage(browser));
  await login(page, users.U2);
  await menu(page, "待我審批").click();
  await page.getByRole("link", { name: `處理 ${po.A.number}`, exact: true }).or(page.getByRole("button", { name: `處理 ${po.A.number}`, exact: true })).click();
  await expect(page.getByRole("heading", { level: 2, name: "審批快照", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "審批決定", exact: true })).toBeVisible();

  // Focus order through the decision form: reason, password, 批准, 拒絕.
  const reason = page.getByLabel("原因（批准選填，拒絕必填）", { exact: true });
  await reason.focus();
  const focused = [];
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Tab");
    focused.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim() || ""));
  }
  expect(focused[0]).toMatch(/密碼/u);
  expect(focused[1]).toMatch(/批准/u);
  expect(focused[2]).toMatch(/拒絕/u);

  const approveButton = page.getByRole("button", { name: "批准", exact: true });
  const rejectButton = page.getByRole("button", { name: "拒絕", exact: true });
  const approvePath = `/api/v1/purchase-orders/${po.A.id}/approval/approve`;
  const password = page.getByLabel("密碼 *", { exact: true });

  await password.fill(users.U2.wrongPassword);                                         // #7
  pending = response(page, "POST", approvePath);
  await approveButton.click();
  expect((await pending).status()).toBe(403);
  await failedSettled(page, PASSWORD_INVALID, approveButton);

  let committed;                                                                       // #8
  await page.route((url) => url.pathname === approvePath, async (route) => {
    const real = await route.fetch();
    committed = { status: real.status(), body: await real.json() };
    await route.abort("failed");
  }, { times: 1 });
  await password.fill(users.U2.password);
  const lost = page.waitForEvent("requestfailed", (r) => new URL(r.url()).pathname === approvePath);
  await approveButton.click();
  await lost;
  expect(committed.status).toBe(200);
  expect(committed.body.data).toMatchObject({ id: po.A.id, status: "CONFIRMED", replayed: false });
  await expect(page.getByRole("alert").first()).toBeVisible();                       // rendered as uncertain
  await expect(rejectButton).toBeDisabled();                                           // reject locked to the uncertain approve

  await password.fill(users.U2.wrongPassword);                                         // #9
  pending = response(page, "POST", approvePath);
  await approveButton.click();
  expect((await pending).status()).toBe(403);
  await failedSettled(page, PASSWORD_INVALID, approveButton);

  await password.fill(users.U2.password);                                              // #10
  pending = response(page, "POST", approvePath);
  await approveButton.click();
  res = await pending;
  expect(res.status()).toBe(200);
  // The HTTP idempotency layer resends the stored response unchanged (body replayed:false included) and marks the
  // replay with a header (IdempotencyService.sendReplay); the service-level replayed:true never reaches HTTP here.
  expect(res.headers()["idempotency-replayed"]).toBe("true");
  expect((await res.json()).data).toEqual(committed.body.data);
  // Uncertainty resolved. On success the page reloads; the PO is now CONFIRMED, so the approval panel (and its reject
  // button) is removed by design. Waiting for that button to become enabled raced the reload, so assert the settled result.
  await expect(page.getByText("已確認", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "審批決定", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("po-detached-decision")).toHaveCount(0);

  await menu(page, "待我審批").click();                                               // #11
  await page.getByRole("link", { name: `處理 ${po.B.number}`, exact: true }).or(page.getByRole("button", { name: `處理 ${po.B.number}`, exact: true })).click();
  await expect(page.getByRole("heading", { level: 2, name: "審批決定", exact: true })).toBeVisible();
  await reason.fill(R.R11);
  await password.fill(users.U2.password);
  pending = response(page, "POST", `/api/v1/purchase-orders/${po.B.id}/approval/reject`);
  await rejectButton.click();
  res = await pending;
  expect(res.status()).toBe(200);
  expect((await res.json()).data).toMatchObject({ status: "DRAFT", replayed: false });
  await context.close();

  // U1: receipt of the approved PO must post the base quantity exactly once.
  ({ context, page } = buyer);
  const unexpectedResponses = [];
  page.on("response", (result) => {
    const route = new URL(result.url()).pathname;
    if (route.startsWith("/api/") && result.status() >= 400) unexpectedResponses.push(`${result.status()} ${route}`);
  });
  const onHand = async () => {
    const [[{ quantity }]] = await db.execute("SELECT COALESCE(SUM(on_hand_quantity), 0) AS quantity FROM inventory_stock_balances WHERE sku_id = ?", [skuId]);
    return Number(quantity);
  };
  const movementCount = async () => {
    const [[{ count }]] = await db.execute("SELECT COUNT(*) AS count FROM inventory_movements WHERE sku_id = ?", [skuId]);
    return Number(count);
  };
  expect(await onHand()).toBe(0);
  const orderPath = `/purchasing/purchase-orders/${po.A.id}`;
  await page.goto(orderPath);
  const orderReceipts = page.getByTestId("po-receipts");
  await expect(orderReceipts.getByText(/^批准：/u)).toBeVisible();
  await orderReceipts.getByRole("link", { name: "建立收貨單" }).click();
  await expect(page.getByLabel("採購單 *", { exact: true })).toHaveValue(`${po.A.number} — PW Supplier ${run}`);
  pending = response(page, "POST", "/api/v1/goods-receipts/create");
  await page.getByRole("button", { name: "建立收貨單", exact: true }).click();
  res = await pending;
  expect(res.status()).toBe(201);
  const { data: receipt } = await res.json();
  const receiptPath = `/purchasing/goods-receipts/${receipt.id}`;
  await page.waitForURL(`**${receiptPath}/edit`);
  await page.getByLabel("加入採購單行").click();
  await page.getByRole("option", { name: /第 1 行/u }).click();
  const quantity = page.getByLabel("數量 *", { exact: true });
  await quantity.fill("3");
  await page.getByLabel("倉庫 *", { exact: true }).click();
  await page.getByRole("option", { name: `${warehouseCode} — PW Warehouse ${run}`, exact: true }).click();
  await page.getByLabel("庫位 *", { exact: true }).click();
  await page.getByRole("option", { name: binCode, exact: true }).click();
  await page.getByLabel("批號 *", { exact: true }).fill(lotNumber);
  const confirmPath = `/api/v1/goods-receipts/${receipt.id}/confirm`;
  const confirmReceipt = async () => {
    await page.getByRole("button", { name: "確認收貨並入庫", exact: true }).click();
    await expect(page.getByText("首期不能在系統內撤回或沖銷")).toBeVisible();
    const confirmation = response(page, "POST", confirmPath);
    await page.getByRole("button", { name: "確認入庫", exact: true }).click();
    return confirmation;
  };
  await expect(page.getByText(/預計超收 1/u)).toBeVisible();
  res = await confirmReceipt();
  expect(res.status()).toBe(409);
  expect((await res.json()).error.code).toBe("OVER_RECEIPT_REASON_REQUIRED");
  await expect(page.getByLabel("超收原因（超收時必填）")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(new RegExp(`${receiptPath}/edit$`, "u"));
  expect([await onHand(), await movementCount()]).toEqual([0, 0]);

  await quantity.fill("1");
  res = await confirmReceipt();
  expect(res.status()).toBe(200);
  await page.waitForURL(`**${receiptPath}`);
  await expect(page.getByText("已確認", { exact: true }).first()).toBeVisible();
  const movementLabel = page.getByText(/^庫存異動 #\d+$/u);
  await expect(movementLabel).toBeVisible();
  const movementId = (await movementLabel.innerText()).split("#")[1];
  expect([await onHand(), await movementCount()]).toEqual([1, 1]);
  await page.goBack();
  await page.waitForURL(`**${orderPath}`);
  await expect(orderReceipts.getByRole("link", { name: new RegExp(receipt.number, "u") })).toHaveAttribute("href", receiptPath);
  await expect(orderReceipts.getByText(/^收貨：.*部分收貨/u)).toBeVisible();

  await page.goto(`/inventory/stocks?q=${encodeURIComponent(skuCode)}&skuId=${skuId}`);
  const stockSummary = page.locator('[aria-label="SKU 數量摘要"]');
  await expect(stockSummary).toContainText(/總 On Hand\s*1/u);
  await expect(page.getByRole("row").filter({ hasText: lotNumber })).toBeVisible();
  await page.goto(`/inventory/movements?skuId=${skuId}&movementId=${movementId}`);
  await expect(page.getByRole("heading", { name: `Movement ${movementId} 詳情` })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: skuCode }).getByText("入 1", { exact: true })).toBeVisible();
  expect(unexpectedResponses).toEqual([`409 ${confirmPath}`]);
  await context.close();
  expect(browserErrors).toEqual([]);
});
