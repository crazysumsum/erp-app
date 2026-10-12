import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";

const enabled = process.env.INVENTORY_P3_BROWSER_TESTS === "1";
test.skip(!enabled, "Requires the approved owned MySQL/API browser runtime");
let app, db, origin, fixture, managerToken, viewerToken, interval, nextRequestAt = 0;
let expectedFailures, failures, errors;
async function pace() {
  const wait = nextRequestAt - performance.now(); nextRequestAt = Math.max(nextRequestAt, performance.now()) + interval;
  if (wait > 0) await setTimeout(wait);
}
async function token(actor) {
  return app.services.require("jwt").issue({ roles: [actor.role], permissions: actor.permissions }, {
    subject: String(actor.id), version: await app.services.require("tokenRevocation").currentVersion(String(actor.id)), authTime: Math.floor(Date.now() / 1000) });
}
test.beforeAll(async () => {
  if (!enabled) return;
  expect(process.env.DB_NAME).toMatch(/^erp_inventory_p3_[a-z0-9]+$/u);
  expect(process.env.DB_SOCKET_PATH).toMatch(/^\/private\/tmp\/erp-inventory-p3-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  origin = process.env.INVENTORY_P3_API_ORIGIN;
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  const config = defaultConfigurationSource(); interval = Math.ceil(config.requestLimiter.ipWindowMs / config.requestLimiter.maxRequestsPerIpPerWindow) + 1;
  app = await createApplication({ configurationSource: { ...config, application: { ...config.application, host: "127.0.0.1", port: Number(new URL(origin).port) },
    jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") } }, handlerRegistryOptions: { moduleUrls: [
      ...["warehouseHandlers", "binHandlers", "inquiryHandlers", "transferHandlers", "skuLookupHandlers"].map(name => new URL(`../../../server/src/handlers/inventory/${name}.js`, import.meta.url).href),
      new URL("../../../server/src/handlers/user/meHandler.js", import.meta.url).href
    ] } });
  db = app.services.require("mysqldatabase");
  const [[observed]] = await db.query("SELECT VERSION() AS version, @@skip_networking AS isolated, DATABASE() AS schema_name");
  expect(observed).toEqual({ version: "26.7.0", isolated: 1, schema_name: process.env.DB_NAME });
  expect((await app.start()).url).toBe(origin);
});
test.afterAll(async () => { if (app) await app.shutdown("task029_live_browser_complete"); });
test.beforeEach(async ({ page }) => {
  expectedFailures = []; failures = []; errors = [];
  const now = Date.now(), suffix = randomUUID().slice(0, 8);
  async function actor(permissions) {
    const name = `pw-${randomUUID()}`;
    const [role] = await db.execute("INSERT INTO roles(name,created_at) VALUES (?,?)", [name, now]);
    for (const permission of permissions) await db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [role.insertId, permission]);
    const [user] = await db.execute("INSERT INTO users(username,password_hash,display_name,created_at,updated_at) VALUES (?,'synthetic-disabled-login','Transfer browser',?,?)", [name, now, now]);
    await db.execute("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)", [user.insertId, role.insertId]);
    return { id: user.insertId, role: name, roleId: role.insertId, permissions };
  }
  const manager = await actor(["inventory.view", "inventory.operation"]), viewer = await actor(["inventory.view"]);
  managerToken = await token(manager); viewerToken = await token(viewer);
  const warehouses = [];
  for (const kind of ["SOURCE", "DEST"]) {
    const code = `PW-${kind}-${suffix}`;
    const [warehouse] = await db.execute("INSERT INTO inventory_warehouses(warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?,?,?)", [code, code.toLowerCase(), code, now, now]);
    const [bin] = await db.execute("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,'SAME','same',?,?)", [warehouse.insertId, now, now]);
    warehouses.push({ id: warehouse.insertId, code, binId: bin.insertId });
  }
  const [uom] = await db.execute("INSERT INTO item_uoms(code,name,status,created_at,updated_at) VALUES (?,'Each','active',?,?)", [`EA${suffix}`, now, now]);
  async function sku(kind, policy = "none", stocked = true) {
    const code = `PW-${kind}-${suffix}`;
    const [item] = await db.execute("INSERT INTO items(name,product_type,status,created_at,updated_at) VALUES ('Browser item','standard','active',?,?)", [now, now]);
    const [row] = await db.execute("INSERT INTO item_skus(item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at) VALUES (?,?,?, ?,1,1,1,'active',?,?)", [item.insertId, code, "Widget <img src=x onerror=alert(1)>", policy, now, now]);
    await db.execute("INSERT INTO item_sku_uoms(sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)", [row.insertId, uom.insertId, now, now]);
    let lotId = null;
    if (policy !== "none") {
      const [lot] = await db.execute("INSERT INTO inventory_lots(sku_id,lot_number,normalized_lot_number,expiry_date,first_receipt_date,sku_code_snapshot,created_at) VALUES (?,'PW-LOT','pw-lot','2030-12-31','2026-10-06',?,?)", [row.insertId, code, now]); lotId = lot.insertId;
    }
    if (stocked) await db.execute("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (?,?,?,?,'AVAILABLE',100,'2026-10-06',?,?)", [warehouses[0].id, warehouses[0].binId, row.insertId, lotId, now, now]);
    return { id: row.insertId, code, lotId };
  }
  fixture = { manager, source: warehouses[0], destination: warehouses[1], plain: await sku("PLAIN"), batch: await sku("BATCH", "batch_expiry"), empty: await sku("EMPTY", "none", false) };
  page.on("pageerror", error => errors.push(error.message));
  page.on("requestfailed", request => { if (request.url().startsWith(origin)) errors.push(`Unexpected API network failure: ${new URL(request.url()).pathname} ${request.failure()?.errorText}`); });
  page.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
  page.on("response", response => { if (response.url().startsWith(origin) && response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.route(`${origin}/api/**`, async route => { await pace(); await route.continue(); });
  await page.addInitScript(value => {
    localStorage.setItem("erp.token", value); localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
  }, managerToken);
});
test.afterEach(async () => {
  expect(failures).toEqual(expectedFailures);
  // Every expected console HTTP error must correspond to an asserted real API rejection.
  expect(errors.filter(error => !/^Failed to load resource: the server responded with a status of (400|401|403|404|409|500) \(/u.test(error))).toEqual([]);
  expect(errors.filter(error => /^Failed to load resource:/u.test(error))).toHaveLength(expectedFailures.length);
});
async function pick(page, label, option) {
  const field = page.getByLabel(label, { exact: true });
  await field.click(); await expect(field).toHaveAttribute("aria-expanded", "true");
  const listbox = page.locator(`[id="${await field.getAttribute('aria-controls')}"]`);
  await listbox.getByRole("option", { name: option, exact: true }).click();
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await expect(listbox).toBeHidden();
  await expect(field.locator("..")).toContainText(option);
}
async function chooseSku(page, index, sku) {
  const line = page.getByTestId(`transfer-line-${index}`);
  await line.getByLabel(`第 ${index} 行 SKU Code`, { exact: true }).fill(sku.code);
  await line.getByRole("button", { name: "查找 SKU", exact: true }).click();
  await line.getByRole("button", { name: "選擇此 SKU", exact: true }).click();
  if (sku.lotId) await pick(page, `第 ${index} 行批次`, "PW-LOT · 2030-12-31");
}
async function newDraft(page, sku = fixture.plain, two = false) {
  await page.goto("/inventory/transfers"); await page.getByRole("button", { name: "新增調撥", exact: true }).click();
  await pick(page, "來源倉庫", `${fixture.source.code} — ${fixture.source.code}`);
  await pick(page, "目的倉庫", `${fixture.destination.code} — ${fixture.destination.code}`);
  await chooseSku(page, 1, sku); await pick(page, "第 1 行來源庫位", "SAME");
  await page.getByLabel("第 1 行數量", { exact: true }).fill("3");
  if (two) { await page.getByRole("button", { name: "新增一行", exact: true }).click(); await chooseSku(page, 2, fixture.batch);
    await pick(page, "第 2 行來源庫位", "SAME"); await page.getByLabel("第 2 行數量", { exact: true }).fill("2"); }
}
async function saveDraft(page) {
  const posted = page.waitForResponse(response => response.url() === `${origin}/api/v1/inventory/transfers/create` && response.request().method() === "POST");
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  const response = await posted; expect(response.status()).toBe(200); const result = (await response.json()).data;
  await expect(page.getByRole("dialog")).toBeHidden(); return result.id;
}
async function api(path, body) {
  await pace(); const response = await fetch(`${origin}/api/v1/inventory/transfers${path}`, { method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) });
  expect(response.status).toBe(200); return (await response.json()).data;
}
const source = () => ({ module: "INVENTORY", documentType: "TRANSFER", documentId: randomUUID(), lineId: "", eventId: randomUUID() });
async function seededDraft() {
  return api("/create", { source: source(), sourceWarehouseId: fixture.source.id, destinationWarehouseId: fixture.destination.id,
    lines: [{ skuId: fixture.plain.id, sourceBinId: fixture.source.binId, lotId: null, stockStatus: "AVAILABLE", quantity: 3 }] });
}
test("TASK-029 @technical Inventory-only two-line Draft Dispatch Receive conserves real stock", async ({ page }) => {
  await newDraft(page, fixture.plain, true); const id = await saveDraft(page);
  await page.getByRole("button", { name: "準備整張出庫", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Reserved 0");
  await page.getByRole("button", { name: "確認整張出庫", exact: true }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("來源已扣、目的未入；在途不可修改／取消。")).toBeVisible();
  await expect(page.getByRole("button", { name: "編輯草稿", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "準備整張收貨", exact: true }).click();
  await pick(page, "第 1 行目的庫位", "SAME"); await pick(page, "第 2 行目的庫位", "SAME");
  await page.getByRole("button", { name: "整張收貨", exact: true }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  const detail = await api(`/${id}`); expect(detail.status).toBe("RECEIVED"); expect(detail.inTransitQuantity).toBe(0);
  expect(detail.movements).toHaveLength(8); expect(detail.lines.every(line => line.destinationBinId === fixture.destination.binId)).toBe(true);
  const [[stock]] = await db.query("SELECT SUM(on_hand_quantity) AS quantity FROM inventory_stock_balances WHERE sku_id=?", [fixture.plain.id]); expect(Number(stock.quantity)).toBe(100);
  await page.reload(); await expect(page.getByRole("heading", { name: new RegExp(`${detail.number}.*RECEIVED`, "u") })).toBeVisible();
  await page.screenshot({ path: `${process.env.HARNESS_RUN_DIR}/transfer-received.png`, fullPage: true });
  await page.getByRole("button", { name: "新增調撥", exact: true }).click();
  expect(new URL(page.url()).searchParams.has("id")).toBe(false);
  await expect(page.getByRole("region", { name: "調撥詳情" })).toHaveCount(0);
  await page.getByRole("button", { name: "取消編輯", exact: true }).click(); await expect(page.getByRole("dialog")).toBeHidden();
});
test("TASK-029 @technical view-only actor sees real In Transit but no write controls", async ({ page }) => {
  const draft = await seededDraft(); await api(`/${draft.id}/dispatch`, { source: source(), version: draft.version });
  await page.addInitScript(value => localStorage.setItem("erp.token", value), viewerToken);
  await page.goto(`/inventory/transfers?id=${draft.id}`);
  await expect(page.getByText("來源已扣、目的未入；在途不可修改／取消。")).toBeVisible();
  for (const label of ["新增調撥", "編輯草稿", "取消草稿", "準備整張收貨"]) await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
});
test("TASK-029 @technical no-Balance SKU remains selectable and insufficient Dispatch keeps Draft", async ({ page }) => {
  await newDraft(page, fixture.empty); const id = await saveDraft(page);
  await page.getByRole("button", { name: "準備整張出庫", exact: true }).click();
  expectedFailures.push({ path: `/api/v1/inventory/transfers/${id}/dispatch`, status: 409 });
  await page.getByRole("button", { name: "確認整張出庫", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("庫存數量不足");
  const detail = await api(`/${id}`); expect(detail.status).toBe("DRAFT"); expect(detail.movements).toHaveLength(0);
  expect((await db.query("SELECT id FROM inventory_stock_balances WHERE sku_id=?", [fixture.empty.id]))[0]).toHaveLength(0);
});
test("TASK-029 @technical unknown SKU, invalid quantity and revoked token fail safely", async ({ page }) => {
  await newDraft(page); await page.getByRole("button", { name: "新增一行", exact: true }).click();
  const line = page.getByTestId("transfer-line-2"); await line.getByLabel("第 2 行 SKU Code").fill("UNKNOWN");
  expectedFailures.push({ path: "/api/v1/inventory/sku-lookup", status: 404 });
  await line.getByRole("button", { name: "查找 SKU", exact: true }).click(); await expect(line.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("第 1 行數量", { exact: true })).toHaveValue("3");
  await expect(page.getByRole("button", { name: "儲存草稿", exact: true })).toBeDisabled();
  await page.getByLabel("第 1 行數量", { exact: true }).fill("0"); await expect(page.getByText("請輸入 Base UOM 正整數")).toBeVisible();
  await app.services.require("tokenRevocation").revoke(String(fixture.manager.id), { reason: "task029_browser_owned_fixture" });
  expectedFailures.push({ path: "/api/v1/inventory/sku-lookup", status: 401 });
  page.once("dialog", dialog => dialog.accept());
  await line.getByRole("button", { name: "查找 SKU", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?redirect=/u);
  expect(await page.evaluate(() => localStorage.getItem("erp.token"))).toBeNull();
  await expect(page.getByRole("button", { name: "儲存草稿", exact: true })).toHaveCount(0);
});
test("TASK-029 @technical delayed real lookup cannot replace a newer explicitly chosen SKU", async ({ page }) => {
  await newDraft(page);
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  await page.route(url => url.origin === origin && url.pathname.endsWith("/sku-lookup") && url.searchParams.get("code") === fixture.plain.code,
    async route => { entered(); await gate; await pace(); await route.continue(); });
  const line = page.getByTestId("transfer-line-1");
  await line.getByLabel("第 1 行 SKU Code").fill(fixture.plain.code); await line.getByRole("button", { name: "查找 SKU", exact: true }).click(); await started;
  await expect(line.getByRole("status")).toHaveText("正在查找 SKU…");
  await chooseSku(page, 1, fixture.empty);
  const old = page.waitForResponse(response => new URL(response.url()).searchParams.get("code") === fixture.plain.code);
  release(); await old;
  await expect(line.getByRole("status")).toContainText(`已選 ${fixture.empty.code}`);
  expect(await line.locator("img").count()).toBe(0);
});
test("TASK-029 @technical stale Draft version returns 409 and retains unsaved quantity", async ({ page }) => {
  const draft = await seededDraft(); await page.goto(`/inventory/transfers?id=${draft.id}`);
  await page.getByRole("button", { name: "編輯草稿", exact: true }).click(); await chooseSku(page, 1, fixture.plain);
  await page.getByLabel("第 1 行數量", { exact: true }).fill("7");
  const current = await api(`/${draft.id}`);
  await api(`/${draft.id}/update`, { source: source(), version: current.version, sourceWarehouseId: fixture.source.id, destinationWarehouseId: fixture.destination.id,
    lines: [{ id: current.lines[0].id, expectedVersion: current.lines[0].version, skuId: fixture.plain.id, sourceBinId: fixture.source.binId, lotId: null, stockStatus: "AVAILABLE", quantity: 4 }] });
  expectedFailures.push({ path: `/api/v1/inventory/transfers/${draft.id}/update`, status: 409 });
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click(); await expect(page.getByRole("dialog").getByText(/輸入內容仍保留/u)).toBeVisible();
  await expect(page.getByLabel("第 1 行數量", { exact: true })).toHaveValue("7"); expect((await api(`/${draft.id}`)).lines[0].quantity).toBe(4);
});
test("TASK-029 @technical Quarantined full receipt requires reason and destination ownership", async ({ page }) => {
  const draft = await seededDraft(); await api(`/${draft.id}/dispatch`, { source: source(), version: draft.version });
  await page.goto(`/inventory/transfers?id=${draft.id}`); await page.getByRole("button", { name: "準備整張收貨", exact: true }).click();
  await pick(page, "第 1 行收貨狀態", "QUARANTINED");
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "取消收貨", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const prompt = page.waitForEvent("dialog"), reload = page.evaluate(() => window.location.reload());
  const dialog = await prompt; expect(dialog.type()).toBe("beforeunload"); await dialog.dismiss();
  await reload;
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("第 1 行收貨狀態", { exact: true })).toHaveValue("QUARANTINED");
  await pick(page, "第 1 行目的庫位", "SAME");
  await expect(page.getByRole("button", { name: "整張收貨", exact: true })).toBeDisabled();
  await page.getByLabel("待驗原因（必填）", { exact: true }).fill("收貨後品質檢查");
  await page.getByRole("button", { name: "整張收貨", exact: true }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  const detail = await api(`/${draft.id}`); expect(detail.lines[0].receiveStockStatus).toBe("QUARANTINED");
  expect(detail.lines[0].destinationBinId).toBe(fixture.destination.binId); expect(detail.lines[0].destinationBinId).not.toBe(fixture.source.binId);
});
test("TASK-029 @technical keyboard lookup, unsaved close, responsive and URL refresh", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 }); await newDraft(page);
  const code = page.getByLabel("第 1 行 SKU Code", { exact: true }); await code.focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "選擇此 SKU", exact: true }).focus(); await page.keyboard.press("Enter");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `${process.env.HARNESS_RUN_DIR}/transfer-draft-${width}.png`, fullPage: true });
  }
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "取消編輯", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "取消編輯", exact: true }).click(); await expect(page.getByRole("dialog")).toBeHidden();
  await pick(page, "調撥狀態", "DRAFT"); await expect(page).toHaveURL(/status=DRAFT/u); await page.reload(); await expect(page.getByLabel("調撥狀態", { exact: true })).toHaveValue("DRAFT");
});
