import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { parse } from "csv-parse/sync";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../../server/src/modules/user/passwordHash.js";
import { InventoryStocktakeExportService } from "../../../server/src/modules/inventory/InventoryStocktakeExportService.js";

const enabled = process.env.INVENTORY_STOCKTAKE_UI_BROWSER_TESTS === "1";
test.skip(!enabled, "Requires approved owned native MySQL/browser runtime");
let app, db, origin, fixture, actor, interval, nextAt = 0, expectedFailures, failures, errors, expectedNetworkFailures, observedNetworkFailures;
const ROOT = "/api/v1/inventory/stocktakes", observations = [];
const source = (parent) => ({ module: "INVENTORY", documentType: "STOCKTAKE", documentId: parent === undefined ? randomUUID() : String(parent), lineId: "", eventId: randomUUID() });
async function pace() { const at = Math.max(nextAt, performance.now()); nextAt = at + interval; if (at > performance.now()) await setTimeout(at - performance.now()); }
async function makeActor(permissions = ["inventory.view", "inventory.operation", "inventory.adjust"]) {
  const username = `pw-st040-${randomUUID()}`, password = randomBytes(32).toString("hex"), now = Date.now();
  const [role] = await db.execute("INSERT INTO roles (name,created_at) VALUES (?,?)", [username, now]);
  for (const permission of permissions) await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [role.insertId, permission]);
  const [user] = await db.execute("INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,'Synthetic Stocktake browser',?,?)", [username, await hashPassword(password), now, now]);
  await db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [user.insertId, role.insertId]); return { id: user.insertId, username, password, roleId: role.insertId };
}
async function seed() {
  const now = Date.now(), code = randomUUID().slice(0, 8);
  const [warehouse] = await db.execute("INSERT INTO inventory_warehouses (warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?, ?,?)", [`PW-${code}`, `pw-${code}`, `PW-${code}`, now, now]);
  const bins = [];
  for (const name of ["COUNT", "EMPTY"]) bins.push((await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?, ?,?)", [warehouse.insertId, name, name.toLowerCase(), now, now]))[0].insertId);
  const [uom] = await db.execute("INSERT INTO item_uoms (code,name,status,created_at,updated_at) VALUES (?,'Each','active',?,?)", [`EA${code}`, now, now]);
  const [item] = await db.execute("INSERT INTO items (name,product_type,status,created_at,updated_at) VALUES ('Synthetic browser','standard','active',?,?)", [now, now]);
  const [sku] = await db.execute("INSERT INTO item_skus (item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at) VALUES (?,?,?,'none',1,1,1,'active',?,?)", [item.insertId, `PW-${code}`, "=SUM(1,2) 中文", now, now]);
  await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)", [sku.insertId, uom.insertId, now, now]);
  await db.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (?,?,?,'AVAILABLE',5,'2026-01-01',?,?)", [warehouse.insertId, bins[0], sku.insertId, now, now]);
  return { warehouseId: warehouse.insertId, warehouseCode: `PW-${code}`, bins, skuId: sku.insertId, skuCode: `PW-${code}`, uomId: uom.insertId, uomCode: `EA${code}` };
}
async function startOwnedApplication() {
  if (!enabled) return;
  expect(process.env.DB_NAME).toMatch(/^erp_inventory_task040_[a-z0-9_]+$/u); expect(process.env.DB_SOCKET_PATH).toMatch(/^\/private\/tmp\/erp-inventory-task040-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  origin = process.env.INVENTORY_STOCKTAKE_API_ORIGIN; expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  const config = defaultConfigurationSource(); interval = Math.ceil(config.requestLimiter.ipWindowMs / config.requestLimiter.maxRequestsPerIpPerWindow) + 1;
  app = await createApplication({ configurationSource: { ...config, application: { ...config.application, host: "127.0.0.1", port: Number(new URL(origin).port) }, jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") } } });
  db = app.services.require("mysqldatabase"); const [[actual]] = await db.query("SELECT VERSION() AS version,DATABASE() AS name,@@skip_networking AS isolated"); expect([actual.version, actual.name, Number(actual.isolated)]).toEqual(["26.7.0", process.env.DB_NAME, 1]); expect((await app.start()).url).toBe(origin);
}
test.afterAll(async () => { if (app) await app.shutdown("task040_browser_complete"); if (enabled && process.env.HARNESS_RUN_DIR) await fs.writeFile(path.join(process.env.HARNESS_RUN_DIR, "stocktake-browser-observations.json"), JSON.stringify(observations)); });
function observe(page) {
  page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
  page.on("response", response => { if (response.url().startsWith(origin) && response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on("requestfailed", request => { if (request.url().startsWith(origin) && !request.failure()?.errorText.includes("ERR_ABORTED")) observedNetworkFailures.push({ path: new URL(request.url()).pathname, errorText: request.failure()?.errorText }); });
}
test.beforeEach(async ({ page }) => { await startOwnedApplication(); expectedFailures = []; failures = []; errors = []; expectedNetworkFailures = new Set(); observedNetworkFailures = []; actor = await makeActor(); fixture = await seed(); observe(page); await page.route(`${origin}/api/**`, async route => { await pace(); await route.continue(); }); });
test.afterEach(async () => {
  try {
  expect(failures).toEqual(expectedFailures);
  expect(observedNetworkFailures).toEqual([...expectedNetworkFailures].map(path => ({ path, errorText: "net::ERR_FAILED" })));
  const resourceErrors = errors.filter(value => /^Failed to load resource: the server responded with a status of /u.test(value)); expect(resourceErrors).toHaveLength(expectedFailures.length);
  const controlledDrops = errors.filter(value => value === "Failed to load resource: net::ERR_FAILED"); expect(controlledDrops).toHaveLength(observedNetworkFailures.length);
  expect(errors.filter(value => !resourceErrors.includes(value) && !controlledDrops.includes(value))).toEqual([]);
  } finally { if (app) { await app.shutdown("task040_case_complete"); app = null; } }
});
async function login(page, who = actor) {
  expectedFailures.push({ path: "/api/v1/user/login", status: 403 });
  await page.goto("/login"); await page.getByLabel("帳號", { exact: true }).fill(who.username); await page.getByLabel("密碼", { exact: true }).fill(who.password); await page.getByRole("button", { name: "登入", exact: true }).click(); await expect(page).toHaveURL(/\/device\/pending$/u);
  const [bindings] = await db.query("SELECT id,status FROM user_devices WHERE user_id=?", [who.id]); expect(bindings).toHaveLength(1); expect(bindings[0].status).toBe("pending"); await db.execute("UPDATE user_devices SET status='approved' WHERE id=?", [bindings[0].id]);
  await page.goto("/login"); await page.getByLabel("帳號", { exact: true }).fill(who.username); await page.getByLabel("密碼", { exact: true }).fill(who.password); await page.getByRole("button", { name: "登入", exact: true }).click(); await expect(page).toHaveURL(new URL("/", process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN).href);
}
async function call(page, method, ...args) {
  return page.evaluate(async input => { const { default: inventory } = await import("/src/services/inventory.js"); try { return { ok: true, data: await inventory[input.method](...input.args) }; } catch (error) { return { ok: false, status: error.status, code: error.code, name: error.name }; } }, { method, args });
}
async function success(page, method, ...args) { const result = await call(page, method, ...args); expect(result.ok, JSON.stringify(result)).toBe(true); return result.data; }
async function draft(page, bins = fixture.bins) { return success(page, "createStocktake", { source: source(), warehouseId: fixture.warehouseId, binIds: bins, idempotencyKey: randomUUID() }); }
async function counting(page) { const created = await draft(page), header = await success(page, "startStocktake", created.id, { source: source(created.id), expectedVersion: created.version }); return { header, lines: (await success(page, "listStocktakeLines", created.id)).rows }; }
async function ready(page, quantity = 5) { const f = await counting(page); await success(page, "saveStocktakeCounts", f.header.id, { source: source(f.header.id), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: quantity }] }); f.header = await success(page, "readyStocktake", f.header.id, { source: source(f.header.id), expectedVersion: 2 }); return f; }
const terminal = f => ({ source: source(f.header.id), expectedVersion: f.header.version, reason: "Synthetic browser reconciliation", password: actor.password, idempotencyKey: randomUUID() });


const UI = "/inventory/stocktakes";
async function closeSidebar(page) {
  const drawer = page.locator('.q-drawer');
  const mobile = page.viewportSize().width <= 1023;
  await expect.poll(() => drawer.evaluate(element => element.classList.contains('q-drawer--mobile'))).toBe(mobile);
  if (!await drawer.evaluate(element => element.classList.contains('q-layout--prevent-focus'))) await page.getByRole("button", { name: "開關側邊欄", exact: true }).click();
  await expect(drawer).toHaveClass(/q-layout--prevent-focus/u);
  await expect.poll(() => drawer.evaluate(element => element.getBoundingClientRect().right <= 1)).toBe(true);
  await expect(page.locator('.q-drawer__backdrop')).not.toBeVisible();
}
async function openStocktake(page, id) {
  await page.goto(`${UI}?id=${id}`);
  await expect(page.getByRole("heading", { name: /^ST-[0-9]+ ·/u })).toBeVisible();
  await expect(page.locator('[aria-label="點算行表格"]')).toBeVisible();
  await expect(page.locator('[aria-label="點算行表格"]')).toHaveAttribute("aria-busy", "false");
  await expect(page.locator('.stocktake-page [aria-busy="true"]')).toHaveCount(0);
}
async function choose(page, label, value) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByLabel(label, { exact: true }).press("Home");
  await expect(page.getByRole("option").first()).toBeVisible();
  const option = page.getByRole("option", { name: value, exact: true });
  if (await option.count() === 0) {
    const popup = page.getByRole("listbox"); await popup.hover(); await page.mouse.wheel(0, 100000);
  }
  await option.click();
}
async function editCount(page, { quantity, notFound = false, index = 0 } = {}) {
  await page.getByRole("button", { name: "點算此行", exact: true }).nth(index).click();
  await expect(page.locator('[aria-label="點算行表格"]')).toHaveCount(0);
  const missing = page.getByRole("checkbox", { name: "未發現（實際為 0）" });
  await missing.setChecked(notFound);
  if (!notFound && quantity !== undefined) await page.getByLabel("實數（Base UOM）", { exact: true }).fill(String(quantity));
}
async function saveCount(page) {
  await page.getByRole("button", { name: "儲存此行點算", exact: true }).click();
  await expect(page.getByLabel("實數（Base UOM）", { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-label="點算行表格"]')).toBeVisible();
}
async function strongUi(page, action, password = actor.password) {
  await page.getByRole("button", { name: `準備 ${action}`, exact: true }).click();
  await page.getByLabel("Post／Cancel 原因", { exact: true }).fill("合成資料實物對帳");
  await page.getByRole("button", { name: "確認原因並輸入密碼", exact: true }).click();
  await page.getByLabel("目前密碼（必填）", { exact: true }).fill(password);
  await page.getByRole("button", { name: action === "Cancel" ? "取消盤點" : "確認過帳", exact: true }).click();
}
async function headerRow(id) { return (await db.query("SELECT status,version FROM inventory_stocktakes WHERE id=?", [id]))[0][0]; }
async function lineRow(id) { return (await db.query("SELECT counted_quantity,is_not_found AS not_found,version,variance_quantity FROM inventory_stocktake_lines WHERE id=?", [id]))[0][0]; }
async function locks(id) { return (await db.query("SELECT id FROM inventory_bin_locks WHERE stocktake_id=? AND released_at IS NULL", [id]))[0]; }
async function addSku(code, { tracking = "none", stock = false, name = "合成帳外" } = {}) {
  const now = Date.now(), [[existing]] = await db.query("SELECT item_id FROM item_skus WHERE id=?", [fixture.skuId]);
  const [inserted] = await db.execute("INSERT INTO item_skus (item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at) VALUES (?,?,?, ?,1,1,1,'active',?,?)", [existing.item_id, code, name, tracking, now, now]);
  const [mapping] = await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)", [inserted.insertId, fixture.uomId, now, now]);
  if (stock) await db.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (?,?,?,'AVAILABLE',5,'2026-01-01',?,?)", [fixture.warehouseId, fixture.bins[0], inserted.insertId, now, now]);
  return { id: inserted.insertId, mapping: mapping.insertId, code };
}
async function barcode(sku, value, mapping = sku.mapping) {
  const now = Date.now(); await db.execute("INSERT INTO item_sku_barcodes (sku_id,sku_uom_id,barcode,normalized_barcode,barcode_type,created_at,updated_at) VALUES (?,?,?,?,'internal',?,?)", [sku.id, mapping, value, value, now, now]);
}
async function triggerRefresh(page) {
  return page.evaluate(async () => {
    const { useSessionStore } = await import("/src/stores/session.js");
    const session = useSessionStore(document.querySelector("#app").__vue_app__.config.globalProperties.$pinia);
    await session.refresh();
    return { view: session.permissions.includes("inventory.view"), operation: session.permissions.includes("inventory.operation"), adjust: session.permissions.includes("inventory.adjust") };
  });
}
async function modalLogoutTrigger(page) {
  return page.evaluate(async () => {
    const { useSessionStore } = await import("/src/stores/session.js");
    const properties = document.querySelector("#app").__vue_app__.config.globalProperties, session = useSessionStore(properties.$pinia);
    await session.logout().catch(() => {}); await properties.$router.push({ name: "login" }); return { cleared: !session.isAuthenticated };
  });
}
async function loginExisting(page, who) {
  await page.goto("/login"); await page.getByLabel("帳號", { exact: true }).fill(who.username); await page.getByLabel("密碼", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "登入", exact: true }).click(); await expect(page).toHaveURL(new URL("/", process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN).href);
}

test("ST040-B01 actual menu/login and VIEW OP ADJ Item-only roles separate reads and actions", async ({ page, browser }) => {
  await login(page); await page.getByRole("link", { name: /盤點管理/u }).click(); await expect(page).toHaveURL(new RegExp(UI, "u"));
  await expect(page.getByRole("button", { name: "新增盤點草稿", exact: true })).toBeVisible(); const created = await draft(page);
  for (const permissions of [["inventory.view"], ["inventory.view", "inventory.adjust"], ["item.view"]]) {
    const who = await makeActor(permissions), context = await browser.newContext({ baseURL: process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN }), other = await context.newPage(); observe(other);
    await other.route(`${origin}/api/**`, async route => { await pace(); await route.continue(); });
    try { await login(other, who); await other.goto(`${UI}?id=${created.id}`);
      if (!permissions.includes("inventory.view")) { await expect(other).toHaveURL(/\/403$/u); await expect(other.getByRole("link", { name: /盤點管理/u })).toHaveCount(0); }
      else { await expect(other.getByRole("heading", { name: /^ST-[0-9]+ ·/u })).toBeVisible(); await expect(other.getByRole("button", { name: "新增盤點草稿", exact: true })).toHaveCount(0); await expect(other.getByRole("button", { name: "準備 Start", exact: true })).toHaveCount(0); }
    } finally { await context.close(); }
  }
  expect((await headerRow(created.id)).status).toBe("DRAFT"); expect(await locks(created.id)).toHaveLength(0);
});

test("ST040-B02 incremental owned Bins and full paged Draft replacement preserve unseen scope/exclusivity", async ({ page }) => {
  const now = Date.now(); for (let i = 0; i < 103; i++) await db.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,?,?, ?,?)", [fixture.warehouseId, `X-${String(i).padStart(3, "0")}`, `x-${String(i).padStart(3, "0")}`, now, now]);
  await login(page); await page.goto(UI); await page.getByRole("button", { name: "新增盤點草稿", exact: true }).click();
  await choose(page, "盤點倉庫", fixture.warehouseCode); await choose(page, "盤點庫位", "COUNT"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "載入更多庫位", exact: true }).click(); await expect(page.getByRole("button", { name: "載入更多庫位", exact: true })).toHaveCount(0); await choose(page, "盤點庫位", "X-102"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "儲存完整草稿", exact: true }).click(); await expect(page).toHaveURL(/id=[1-9][0-9]*/u);
  const id = Number(new URL(page.url()).searchParams.get("id")); expect((await headerRow(id)).status).toBe("DRAFT"); expect(await locks(id)).toHaveLength(0);
  const [allBins] = await db.query("SELECT id FROM inventory_bins WHERE warehouse_id=? ORDER BY id", [fixture.warehouseId]); const ids = allBins.slice(0, 101).map(row => Number(row.id));
  const changed = await success(page, "updateStocktake", id, { source: source(id), expectedVersion: 1, binIds: ids }); expect(changed.rowCount).toBe(101);
  await openStocktake(page, id); await page.getByRole("button", { name: "編輯草稿範圍", exact: true }).click(); await expect(page.getByText(/已選 101 個庫位/u)).toBeVisible();
  await page.getByRole("button", { name: "儲存完整草稿", exact: true }).click(); await expect(page.getByText(/workflow version 3/u)).toBeVisible();
  expect((await db.query("SELECT bin_id FROM inventory_stocktake_bins WHERE stocktake_id=? ORDER BY bin_id", [id]))[0].map(row => Number(row.bin_id))).toEqual(ids);
  await page.getByRole("button", { name: "新增盤點草稿", exact: true }).click(); await choose(page, "盤點倉庫", fixture.warehouseCode); await choose(page, "盤點庫位", "COUNT"); await page.keyboard.press("Escape");
  expectedFailures.push({ path: `${ROOT}/create`, status: 409 }); await page.getByRole("button", { name: "儲存完整草稿", exact: true }).click(); await expect(page.getByText("原結果 REJECTED；保留原內容，不自動重送。", { exact: true })).toBeVisible();
  expect((await db.query("SELECT id FROM inventory_stocktakes WHERE warehouse_id=?", [fixture.warehouseId]))[0]).toHaveLength(1); expect(await locks(id)).toHaveLength(0);
});

test("ST040-B03 real whole-scope Start creates snapshot/persistent locks only after commit", async ({ page }) => {
  await login(page); const created = await draft(page); await openStocktake(page, created.id);
  await expect(page.getByText("範圍排他；尚未鎖定庫存。", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "準備 Start", exact: true }).click();
  await expect(page.getByText(/Start 處理整個範圍，暫停庫存異動/u)).toBeVisible(); await page.getByRole("button", { name: "確認整張 Start", exact: true }).click();
  await expect(page.getByRole("heading", { name: /· COUNTING ·/u })).toBeVisible(); expect(await locks(created.id)).toHaveLength(2);
  const [lines] = await db.query("SELECT snapshot_quantity,counted_quantity FROM inventory_stocktake_lines WHERE stocktake_id=?", [created.id]); expect(lines).toHaveLength(1); expect(Number(lines[0].snapshot_quantity)).toBe(5); expect(lines[0].counted_quantity).toBeNull();
});

test("ST040-B04 blank zero notFound and change-back are disjoint real persisted counts and Audit versions", async ({ page }) => {
  await login(page); const f = await counting(page); await openStocktake(page, f.header.id); await editCount(page);
  await page.getByRole("button", { name: "儲存此行點算", exact: true }).click(); await expect(page.locator('[role="alert"][tabindex="-1"]').filter({ hasText: /安全非負整數/u })).toBeVisible(); expect(Number((await lineRow(f.lines[0].id)).version)).toBe(1);
  await page.getByLabel("實數（Base UOM）", { exact: true }).fill("0"); await saveCount(page); let row = await lineRow(f.lines[0].id); expect([Number(row.counted_quantity), Number(row.not_found), Number(row.version)]).toEqual([0, 0, 2]);
  await editCount(page, { notFound: true }); await saveCount(page); row = await lineRow(f.lines[0].id); expect([row.counted_quantity, Number(row.not_found), Number(row.version)]).toEqual([null, 1, 3]);
  await editCount(page, { quantity: 5 }); await saveCount(page); row = await lineRow(f.lines[0].id); expect([Number(row.counted_quantity), Number(row.not_found), Number(row.version)]).toEqual([5, 0, 4]); expect(row.variance_quantity).toBeNull(); expect(Number((await headerRow(f.header.id)).version)).toBe(2);
  expect((await db.query("SELECT id FROM inventory_movements WHERE warehouse_id=?", [fixture.warehouseId]))[0]).toHaveLength(0);
  expect((await db.query("SELECT id FROM inventory_audit_logs WHERE action='stocktake.count' AND target_type='stocktake' AND target_id=? AND outcome='SUCCEEDED'", [f.header.id]))[0]).toHaveLength(3);
});

test("ST040-B05 actual 200-row pager and persistent dirty Count refuse navigation then reload committed page", async ({ page }) => {
  for (let i = 0; i < 199; i++) await addSku(`PAGE-${randomUUID()}`, { stock: true });
  await login(page); const f = await counting(page); await openStocktake(page, f.header.id); const table = page.locator('[aria-label="點算行表格"]');
  await table.getByRole("button", { name: "Next page", exact: true }).click(); await expect(table.getByText(/21–40 of 200/u)).toBeVisible();
  await editCount(page, { quantity: 6 }); await expect(page.locator('[aria-label="點算行表格"]')).toHaveCount(0);
  let dialogs = 0; page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
  const changed = await page.evaluate(async () => { const router = document.querySelector("#app").__vue_app__.config.globalProperties.$router; await router.push({ path: "/inventory/stocktakes", query: { id: "99999999" } }); return router.currentRoute.value.query.id; });
  expect(changed).toBe(String(f.header.id)); expect(dialogs).toBe(1); await expect(page.getByLabel("實數（Base UOM）", { exact: true })).toHaveValue("6");
  page.removeAllListeners("dialog"); page.on("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "明確捨棄點算", exact: true }).click();
  await expect(table.getByText(/21–40 of 200/u)).toBeVisible(); await table.getByRole("button", { name: "Next page", exact: true }).click(); await expect(table.getByText(/41–60 of 200/u)).toBeVisible();
  await editCount(page, { quantity: 6 }); const [[chosen]] = await db.query("SELECT id FROM inventory_stocktake_lines WHERE stocktake_id=? ORDER BY id LIMIT 1 OFFSET 40", [f.header.id]);
  await success(page, "saveStocktakeCounts", f.header.id, { source: source(f.header.id), lines: [{ lineId: Number(chosen.id), expectedVersion: 1, countedQuantity: 4 }] });
  expectedFailures.push({ path: `${ROOT}/${f.header.id}/counts/save`, status: 409 });
  const rejected = page.waitForResponse(response => new URL(response.url()).pathname === `${ROOT}/${f.header.id}/counts/save` && response.status() === 409);
  await page.getByRole("button", { name: "儲存此行點算", exact: true }).click(); await rejected; await expect(page.getByText(/原結果 REJECTED；原輸入及版本保留/u)).toBeVisible(); await expect(page.getByLabel("實數（Base UOM）", { exact: true })).toHaveValue("6");
  await expect(page.locator('.q-dialog [aria-label="原操作復原"]')).toBeVisible(); expect(Number((await lineRow(chosen.id)).counted_quantity)).toBe(4);
});

test("ST040-B06 exact Code versus Barcode/Pack collision and Name q locate only without increment or write", async ({ page }) => {
  const collision = `SCAN-${randomUUID()}`, other = await addSku(collision, { stock: true, name: "定位中文%_!" }), [[mapping]] = await db.query("SELECT id FROM item_sku_uoms WHERE sku_id=? AND is_base=1", [fixture.skuId]);
  await barcode({ id: fixture.skuId, mapping: mapping.id }, collision); const [pack] = await db.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,4,0,?,?)", [fixture.skuId, (await db.execute("INSERT INTO item_uoms (code,name,status,created_at,updated_at) VALUES (?,'Pack','active',?,?)", [`PK${randomUUID().slice(0,8)}`, Date.now(), Date.now()]))[0].insertId, Date.now(), Date.now()]);
  const packCode = `PACK-${randomUUID()}`; await barcode({ id: fixture.skuId, mapping: mapping.id }, packCode, pack.insertId);
  await login(page); const f = await counting(page); await openStocktake(page, f.header.id);
  await page.getByLabel("定位 Code／Barcode", { exact: true }).fill(collision); await page.getByLabel("定位 Code／Barcode", { exact: true }).press("Enter"); await expect(page.getByText(`已定位 ${collision}；請明確選擇 Bucket，不自動增加實數或選 Bin／Lot／Status。`, { exact: true })).toBeVisible();
  await choose(page, "定位模式", "Barcode"); await page.getByLabel("定位 Code／Barcode", { exact: true }).press("Enter"); await expect(page.getByText(`已定位 ${fixture.skuCode}；請明確選擇 Bucket，不自動增加實數或選 Bin／Lot／Status。`, { exact: true })).toBeVisible();
  await page.getByLabel("定位 Code／Barcode", { exact: true }).fill(packCode); await page.getByLabel("定位 Code／Barcode", { exact: true }).press("Enter"); await expect(page.locator('[aria-label="點算行表格"]').getByText(`5 ${fixture.uomCode}`, { exact: true })).toBeVisible();
  await page.goto(`${UI}?id=${f.header.id}&q=${encodeURIComponent("中文%_!")}`); await expect(page.locator('[aria-label="點算行表格"]').getByText(`${other.code} · 定位中文%_!`, { exact: true })).toBeVisible();
  expect((await db.query("SELECT id FROM inventory_operation_requests WHERE command_type='STOCKTAKE_COUNT' AND source_document_id=?", [String(f.header.id)]))[0]).toHaveLength(0);
});

test("ST040-B07 existing expired Lot/no Balance Add creates snapshot0 only, known identity and physical policy", async ({ page }) => {
  const known = await addSku(`FIELD-${randomUUID()}`, { tracking: "batch_expiry" }), now = Date.now();
  const [lot] = await db.execute("INSERT INTO inventory_lots (sku_id,lot_number,normalized_lot_number,expiry_date,first_receipt_date,sku_code_snapshot,created_at) VALUES (?,? ,?,'2020-01-01','2019-01-01',?,?)", [known.id, "EXPIRED-KNOWN", "expired-known", known.code, now]);
  await login(page); const f = await counting(page); await openStocktake(page, f.header.id); await page.getByRole("button", { name: "新增帳外 Bucket", exact: true }).click();
  await page.getByLabel("精確 Code／Barcode", { exact: true }).fill(known.code); await page.getByRole("button", { name: "查找帳外 SKU", exact: true }).click();
  await choose(page, "所屬盤點庫位", "EMPTY"); await choose(page, "既有合法批次", "EXPIRED-KNOWN · 2020-01-01"); await expect(page.getByText(/不授予銷售或收貨資格/u)).toBeVisible();
  await page.getByRole("button", { name: "建立帳外行", exact: true }).click(); await expect(page.getByLabel("精確 Code／Barcode", { exact: true })).toHaveCount(0);
  const [[line]] = await db.query("SELECT id,snapshot_quantity,counted_quantity,lot_id FROM inventory_stocktake_lines WHERE stocktake_id=? AND sku_id=?", [f.header.id, known.id]); expect([Number(line.snapshot_quantity), line.counted_quantity, Number(line.lot_id)]).toEqual([0, null, lot.insertId]);
  expect((await db.query("SELECT id FROM inventory_stock_balances WHERE sku_id=?", [known.id]))[0]).toHaveLength(0); expect((await db.query("SELECT id FROM inventory_lots WHERE sku_id=?", [known.id]))[0]).toHaveLength(1);
  await editCount(page, { quantity: 2 }); await saveCount(page); expect(Number((await lineRow(line.id)).counted_quantity)).toBe(2);
});

test("ST040-B08 Ready uses global completion despite filtered rows and supports explicit empty 0/0", async ({ page }) => {
  await addSku(`HIDDEN-${randomUUID()}`, { stock: true }); await login(page); const f = await counting(page);
  await success(page, "saveStocktakeCounts", f.header.id, { source: source(f.header.id), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: 5 }] });
  await page.goto(`${UI}?id=${f.header.id}&progress=COUNTED`); await expect(page.getByRole("button", { name: "準備 Ready", exact: true })).toBeDisabled(); await expect(page.getByText(/未點算 1/u)).toBeVisible();
  await success(page, "saveStocktakeCounts", f.header.id, { source: source(f.header.id), lines: [{ lineId: f.lines[1].id, expectedVersion: 1, countedQuantity: 5 }] }); await page.getByRole("button", { name: "重讀目前盤點", exact: true }).click();
  await page.getByRole("button", { name: "準備 Ready", exact: true }).click(); await page.getByRole("button", { name: "確認 Ready", exact: true }).click(); await expect(page.getByRole("heading", { name: /READY_TO_POST/u })).toBeVisible();
  expect((await db.query("SELECT variance_quantity FROM inventory_stocktake_lines WHERE stocktake_id=?", [f.header.id]))[0].every(row => Number(row.variance_quantity) === 0)).toBe(true);
  await success(page, "cancelStocktake", f.header.id, { source: source(f.header.id), expectedVersion: 3, reason: "合成空範圍準備", password: actor.password });
  const empty = await draft(page, [fixture.bins[1]]); await success(page, "startStocktake", empty.id, { source: source(empty.id), expectedVersion: 1 }); await openStocktake(page, empty.id);
  await expect(page.getByText(/全局完成 0\/0/u)).toBeVisible(); await page.getByRole("button", { name: "準備 Ready", exact: true }).click(); await page.getByRole("button", { name: "確認 Ready", exact: true }).click(); await expect(page.getByRole("heading", { name: /· READY_TO_POST ·/u })).toBeVisible(); expect((await headerRow(empty.id)).status).toBe("READY_TO_POST");
});

test("ST040-B09 real signed Post positive negative zero and wrong-password rollback retain whole effects", async ({ page }) => {
  await login(page);
  for (const quantity of [8, 3, 5]) {
    if (quantity !== 8) fixture = await seed();
    const f = await ready(page, quantity); await openStocktake(page, f.header.id);
    if (quantity === 8) {
      expectedFailures.push({ path: `${ROOT}/${f.header.id}/post`, status: 403 }); await strongUi(page, "Post", "wrong-synthetic");
      await expect(page.getByLabel("目前密碼（必填）", { exact: true })).toHaveCount(0); expect((await headerRow(f.header.id)).status).toBe("READY_TO_POST"); expect(await locks(f.header.id)).toHaveLength(2);
      await page.getByRole("button", { name: "確認原因並輸入密碼", exact: true }).click(); await page.getByLabel("目前密碼（必填）", { exact: true }).fill(actor.password); await page.getByRole("button", { name: "確認過帳", exact: true }).click();
    } else await strongUi(page, "Post");
    await expect(page.getByRole("heading", { name: /· POSTED ·/u })).toBeVisible(); expect(await locks(f.header.id)).toHaveLength(0);
    const [[balance]] = await db.query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE sku_id=?", [fixture.skuId]); expect(Number(balance.on_hand_quantity)).toBe(quantity);
    const [movements] = await db.query("SELECT id FROM inventory_movements WHERE stocktake_line_id=?", [f.lines[0].id]); expect(movements).toHaveLength(quantity === 5 ? 0 : 1);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
});

test("ST040-B10 real password-only Cancel supports Draft Counting Ready and revoked device/inactive scope history", async ({ page }) => {
  await login(page);
  for (const status of ["DRAFT", "COUNTING", "READY_TO_POST"]) {
    if (status !== "DRAFT") fixture = await seed();
    const f = status === "DRAFT" ? { header: await draft(page) } : status === "COUNTING" ? await counting(page) : await ready(page);
    await openStocktake(page, f.header.id);
    if (status === "READY_TO_POST") {
      await db.execute("UPDATE user_devices SET status='revoked' WHERE user_id=?", [actor.id]);
      await db.execute("UPDATE inventory_warehouses SET status='INACTIVE' WHERE id=?", [fixture.warehouseId]); await db.execute("UPDATE inventory_bins SET status='INACTIVE' WHERE warehouse_id=?", [fixture.warehouseId]);
    }
    await strongUi(page, "Cancel"); await expect(page.getByRole("heading", { name: /· CANCELLED ·/u })).toBeVisible(); await expect(page.getByText(/已取消，不代表已過帳/u)).toBeVisible();
    expect(await locks(f.header.id)).toHaveLength(0); expect((await db.query("SELECT id FROM inventory_movements WHERE warehouse_id=?", [fixture.warehouseId]))[0]).toHaveLength(0);
    expect((await db.query("SELECT id FROM inventory_stocktake_bins WHERE stocktake_id=?", [f.header.id]))[0]).toHaveLength(2);
  }
});

async function downloadCsv(page) {
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "下載盤點 CSV", exact: true }).click(); const downloaded = await pending;
  const content = await fs.readFile(await downloaded.path(), "utf8"); await expect(page.getByText(/CSV 已交付下載，不代表完整/u)).toBeVisible(); return parse(content, { columns: true });
}
test("ST040-B11 actual filtered CSV download preserves empty SCOPE escaped cells/footer and truncation/history", async ({ page }) => {
  await login(page); const f = await ready(page, 3); await page.goto(`${UI}?id=${f.header.id}&q=${encodeURIComponent("中文")}&variance=LOSS`);
  let rows = await downloadCsv(page); expect(rows.filter(row => row.recordType === "SCOPE")).toHaveLength(2); expect(rows.filter(row => row.recordType === "LINE")).toHaveLength(1); expect(rows.find(row => row.recordType === "LINE").skuNameCurrent).toMatch(/^'=/u); expect(rows.at(-1).truncated).toBe("false");
  const original = InventoryStocktakeExportService.prototype.prepare;
  InventoryStocktakeExportService.prototype.prepare = async function(input) { const previous = this.config; this.config = { ...previous, exportMaxRows: 1 }; try { return await original.call(this, input); } finally { this.config = previous; } };
  try { rows = await downloadCsv(page); expect(rows.at(-1).truncated).toBe("true"); expect(rows.at(-1).truncationReason).toBe("ROW_LIMIT"); } finally { InventoryStocktakeExportService.prototype.prepare = original; }
  await success(page, "cancelStocktake", f.header.id, terminal(f)); await openStocktake(page, f.header.id); await expect(page.getByText(/已取消，不代表已過帳/u)).toBeVisible();
});

test("ST040-B12 dropped real Post response after verified commit resolves original without a duplicate Movement", async ({ page }) => {
  await login(page); const f = await ready(page, 8); await openStocktake(page, f.header.id); const routePath = `${ROOT}/${f.header.id}/post`; expectedNetworkFailures.add(routePath);
  let originalSource, committed = false;
  await page.route(origin + routePath, async route => {
    await pace(); originalSource = route.request().postDataJSON().source; const response = await route.fetch(); expect(response.status()).toBe(200);
    expect((await headerRow(f.header.id)).status).toBe("POSTED"); expect((await db.query("SELECT id FROM inventory_movements WHERE stocktake_line_id=?", [f.lines[0].id]))[0]).toHaveLength(1); committed = true; await route.abort("failed");
  });
  await strongUi(page, "Post"); await expect(page.getByText("原結果 UNKNOWN；不自動重送。", { exact: true })).toBeVisible(); expect(committed).toBe(true);
  await page.locator('.q-dialog [aria-label="原工作流程復原"]').getByRole("button", { name: "查詢原結果", exact: true }).click();
  await expect(page.getByRole("heading", { name: /· POSTED ·/u })).toBeVisible(); await expect(page.getByText(/原操作歷史回執/u)).toBeVisible();
  expect((await db.query("SELECT id FROM inventory_operation_requests WHERE source_event_id=?", [originalSource.eventId]))[0]).toHaveLength(1);
  expect((await db.query("SELECT id FROM inventory_movements WHERE stocktake_line_id=?", [f.lines[0].id]))[0]).toHaveLength(1); expect(await locks(f.header.id)).toHaveLength(0);
  observations.push({ case: "ST040-B12", realCommitBeforeDrop: true, originalResultQuery: true, operationCount: 1, movementCount: 1 });
});

test("ST040-B13 refresh unknown Count restores minimal QUERY_ONLY and never reconstructs a write", async ({ page }) => {
  await login(page); const f = await counting(page); await openStocktake(page, f.header.id); const routePath = `${ROOT}/${f.header.id}/counts/save`; expectedNetworkFailures.add(routePath);
  let originalSource, writes = 0;
  await page.route(origin + routePath, async route => { await pace(); writes++; originalSource = route.request().postDataJSON().source; const response = await route.fetch(); expect(response.status()).toBe(200); expect(Number((await lineRow(f.lines[0].id)).counted_quantity)).toBe(2); await route.abort("failed"); });
  await editCount(page, { quantity: 2 }); await page.getByRole("button", { name: "儲存此行點算", exact: true }).click(); await expect(page.locator('.q-dialog [aria-label="原操作復原"]').getByText(/UNKNOWN/u)).toBeVisible();
  page.on("dialog", dialog => dialog.accept()); await page.reload(); await expect(page.getByRole("heading", { name: /原操作 QUERY_ONLY/u })).toBeVisible();
  const record = JSON.parse(await page.locator("pre.safe-reference").textContent()); expect(Object.keys(record).sort()).toEqual(["action", "parentStocktakeId", "source"]); expect(record.source).toEqual(originalSource);
  await expect(page.getByRole("button", { name: "明確重試原提交", exact: true })).toHaveCount(0); await page.getByRole("button", { name: "查詢原結果", exact: true }).click(); await expect(page.getByText(/原操作歷史回執/u)).toBeVisible(); expect(writes).toBe(1);
});

test("ST040-B14 real signed authority refresh and real logout actions exit dirty sending QUERY_ONLY without prompt", async ({ page, browser }) => {
  test.setTimeout(240000); await login(page); let f = await counting(page); await openStocktake(page, f.header.id); await editCount(page, { quantity: 6 });
  await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.operation'", [actor.roleId]);
  const changed = await triggerRefresh(page); expect(changed).toEqual({ view: true, operation: false, adjust: true }); await expect(page.getByLabel("實數（Base UOM）", { exact: true })).toHaveCount(0); await expect(page).toHaveURL(new RegExp(UI, "u")); await expect(page.getByRole("button", { name: "點算此行", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /· COUNTING ·/u })).toBeVisible(); await expect(page.locator('.stocktake-page [aria-busy="true"]')).toHaveCount(0);
  await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.view'", [actor.roleId]);
  expect((await triggerRefresh(page)).view).toBe(false); await expect(page).toHaveURL(/\/403$/u); await expect(page.getByText(new RegExp(`ST-${f.header.operationId} ·`, "u"))).toHaveCount(0);
  for (const variant of ["dirty-view-and-logout", "sending-adjust-query-only-401", "sending-logout", "device-only-failed-refresh"]) {
    const context = await browser.newContext({ baseURL: process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN }), other = await context.newPage(), who = await makeActor(); observe(other);
    await other.route(`${origin}/api/**`, async route => { await pace(); await route.continue(); });
    let release, held;
    try {
      actor = who; fixture = await seed(); await login(other, who); f = variant.includes("adjust") || variant.includes("device") ? await ready(other, 8) : await counting(other); await openStocktake(other, f.header.id);
      let prompts = 0; other.on("dialog", dialog => { prompts++; return dialog.dismiss(); });
      if (variant === "dirty-view-and-logout") {
        await editCount(other, { quantity: 6 }); await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.view'", [who.roleId]);
        expect((await triggerRefresh(other)).view).toBe(false); await expect(other).toHaveURL(/\/403$/u); await expect(other.getByLabel("實數（Base UOM）", { exact: true })).toHaveCount(0); expect(prompts).toBe(0);
        await db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.view'", [who.roleId]); expect((await triggerRefresh(other)).view).toBe(true);
        await openStocktake(other, f.header.id); await editCount(other, { quantity: 6 }); expect(await modalLogoutTrigger(other)).toEqual({ cleared: true }); await expect(other).toHaveURL(/\/login$/u); expect(prompts).toBe(0);
      } else if (variant === "device-only-failed-refresh") {
        await db.execute("UPDATE user_devices SET status='revoked' WHERE user_id=?", [who.id]); expectedFailures.push({ path: `${ROOT}/${f.header.id}/post`, status: 403 }); await strongUi(other, "Post", who.password);
        await expect(other.getByText("原結果 REJECTED；不自動重送。", { exact: true })).toBeVisible(); await expect(other).toHaveURL(new RegExp(UI, "u")); expect(await locks(f.header.id)).toHaveLength(2);
        expectedFailures.push({ path: "/api/v1/user/token/refresh", status: 403 }); let failed = false; try { await triggerRefresh(other); } catch { failed = true; } expect(failed).toBe(true);
        await expect(other).toHaveURL(new RegExp(UI, "u")); await expect(other.getByText("原結果 REJECTED；不自動重送。", { exact: true })).toBeVisible(); expect(prompts).toBe(0);
      } else {
        const post = variant.includes("adjust"), commandPath = `${ROOT}/${f.header.id}/${post ? 'post' : 'counts/save'}`;
        const gate = new Promise(resolve => { release = resolve; }); let reached; const committed = new Promise(resolve => { reached = resolve; });
        await other.route(origin + commandPath, async route => { await pace(); const response = await route.fetch(); expect(response.status()).toBe(200);
          expect(post ? (await headerRow(f.header.id)).status === "POSTED" : Number((await lineRow(f.lines[0].id)).counted_quantity) === 6).toBe(true);
          reached(); await gate; await route.fulfill({ response }); });
        if (post) await strongUi(other, "Post", who.password);
        else { await editCount(other, { quantity: 6 }); await other.getByRole("button", { name: "儲存此行點算", exact: true }).click(); }
        await committed; held = JSON.parse(await other.locator("pre.safe-reference").textContent()); expect(Object.keys(held).sort()).toEqual(["action", "parentStocktakeId", "source"]);
        if (post) {
          await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.adjust'", [who.roleId]);
          expect(await triggerRefresh(other)).toEqual({ view: true, operation: true, adjust: false }); await expect(other.locator('input[type="password"]')).toHaveCount(0); await expect(other.getByRole("heading", { name: /原操作 QUERY_ONLY/u })).toBeVisible();
          release(); other.removeAllListeners("dialog"); other.on("dialog", dialog => { expect(dialog.type()).toBe("beforeunload"); return dialog.accept(); });
          await other.reload(); other.removeAllListeners("dialog"); other.on("dialog", dialog => { prompts++; return dialog.dismiss(); });
          await expect(other.getByRole("heading", { name: /原操作 QUERY_ONLY/u })).toBeVisible(); expect(JSON.parse(await other.locator("pre.safe-reference").textContent())).toEqual(held);
          await expect(other.locator('[aria-label="點算行表格"]')).toHaveAttribute("aria-busy", "false"); await app.services.require("tokenRevocation").revoke(String(who.id), { reason: "Synthetic Task040 session expiry/revocation" });
          expectedFailures.push({ path: `${ROOT}/${f.header.id}`, status: 401 }); expect((await call(other, "getStocktake", f.header.id)).status).toBe(401); await expect(other).toHaveURL(/\/login/u); expect(prompts).toBe(0);
          await loginExisting(other, who); await openStocktake(other, f.header.id); await expect(other.getByRole("heading", { name: /原操作 QUERY_ONLY/u })).toBeVisible(); expect(JSON.parse(await other.locator("pre.safe-reference").textContent())).toEqual(held);
        } else {
          expect(await modalLogoutTrigger(other)).toEqual({ cleared: true }); await expect(other).toHaveURL(/\/login$/u); await expect(other.getByLabel("實數（Base UOM）", { exact: true })).toHaveCount(0); expect(prompts).toBe(0);
          release(); await loginExisting(other, who); await openStocktake(other, f.header.id); await expect(other.getByRole("heading", { name: /原操作 QUERY_ONLY/u })).toBeVisible(); expect(JSON.parse(await other.locator("pre.safe-reference").textContent())).toEqual(held);
        }
      }
    } finally { release?.(); await context.close(); }
  }
  observations.push({ case: "ST040-B14", authorityTrigger: "existing real signed session.refresh; actual server claims observed", modalLogoutTrigger: "existing real session.logout finally-clear then same existing router.push(login), not topbar gesture", noForcedClickOrMockClear: true });
});

test("ST040-B15 real topbar/name/keyboard/navigation/logout and cleared responsive screens stay bounded", async ({ page, browser }) => {
  await login(page); const f = await counting(page); await openStocktake(page, f.header.id);
  const layouts = [], names = ["Synthetic Stocktake browser", "陳大文倉庫盤點操作員中文名稱保持完整可讀", "Sam"];
  for (const name of names) {
    await db.execute("UPDATE users SET display_name=?,updated_at=? WHERE id=?", [name, Date.now(), actor.id]);
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/");
    await expect(page.locator(".q-header .q-btn-dropdown .block")).toHaveText(name);
    for (const location of ["home", "stocktake"]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      if (location === "home") await page.goto("/"); else await openStocktake(page, f.header.id);
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await closeSidebar(page);
        await expect(page.locator('.q-drawer__backdrop')).not.toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.getByRole("button", { name: "開關側邊欄", exact: true }).focus(); await page.keyboard.press("Tab");
        await expect(page.locator('.q-header .q-btn-dropdown')).toBeFocused();
        if (name === names[0] && location === "home") await page.screenshot({ path: path.join(process.env.HARNESS_RUN_DIR, `stocktake-topbar-focus-${width}.png`) });
        const geometry = await page.evaluate(() => {
          const toolbar = document.querySelector('.q-header .q-toolbar'), trigger = toolbar.querySelector('.q-btn-dropdown'), label = trigger.querySelector('.block');
          const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height }; };
          const css = getComputedStyle(toolbar), labelCss = getComputedStyle(label);
          return { path: location.pathname, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, toolbarInner: toolbar.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight), trigger: box(trigger), parts: [document.querySelector('.q-header'), toolbar.querySelector('.app-topbar__brand-mark'), trigger.querySelector('.q-focus-helper'), toolbar.querySelector('[aria-label="開關側邊欄"]'), ...trigger.querySelectorAll('.q-icon')].map(box), label: { text: label.textContent, width: label.clientWidth, scrollWidth: label.scrollWidth, overflow: labelCss.overflowX, ellipsis: labelCss.textOverflow }, color: labelCss.color, background: getComputedStyle(document.querySelector('.q-header')).backgroundColor };
        });
        layouts.push({ name, location, ...geometry });
        expect(geometry.trigger.width).toBeLessThanOrEqual(geometry.toolbarInner / 2 + 1);
        for (const part of [geometry.trigger, ...geometry.parts]) { expect(part.x).toBeGreaterThanOrEqual(0); expect(part.right).toBeLessThanOrEqual(width + 1); expect(part.width).toBeGreaterThan(0); expect(part.height).toBeGreaterThan(0); }
        expect(geometry.label.text).toBe(name);
        const luminance = color => { const channels = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/u); expect(channels).not.toBeNull(); return channels.slice(1).map(value => { const c = Number(value) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0); };
        const foreground = luminance(geometry.color), background = luminance(geometry.background);
        expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)).toBeGreaterThanOrEqual(4.5);
        if (name === "Sam") expect(geometry.label.scrollWidth).toBeLessThanOrEqual(geometry.label.width + 1);
        else if (width <= 375) { expect(geometry.label.scrollWidth).toBeGreaterThan(geometry.label.width); expect(geometry.label.overflow).toBe("hidden"); expect(geometry.label.ellipsis).toBe("ellipsis"); }
        const trigger = page.locator('.q-header .q-btn-dropdown');
        await expect(trigger).toHaveAccessibleName(new RegExp(name, "u"));
        await trigger.click(); await expect(page.getByText("個人資料", { exact: true })).toBeVisible();
        const popup = await page.locator('.q-menu').boundingBox(); expect(popup.x).toBeGreaterThanOrEqual(0); expect(popup.x + popup.width).toBeLessThanOrEqual(width + 1);
        await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
      }
    }
  }
  await fs.writeFile(path.join(process.env.HARNESS_RUN_DIR, "stocktake-ui-topbar-layouts.json"), JSON.stringify(layouts), { mode: 0o600 });
  await db.execute("UPDATE users SET display_name=?,updated_at=? WHERE id=?", [names[0], Date.now(), actor.id]);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/"); await page.setViewportSize({ width: 375, height: 900 });
  const drawer = page.getByRole("button", { name: "開關側邊欄", exact: true });
  await drawer.click(); await expect(page.locator('.q-drawer__backdrop')).toBeVisible();
  await page.locator('.q-drawer__backdrop').click({ position: { x: 370, y: 300 } }); await expect(page.locator('.q-drawer__backdrop')).not.toBeVisible();
  await drawer.focus(); await page.keyboard.press("Tab"); await expect(page.locator('.q-header .q-btn-dropdown')).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.getByText("個人資料", { exact: true })).toBeVisible();
  await page.getByText("個人資料", { exact: true }).click(); await expect(page).toHaveURL(/\/account\/profile$/u);
  await page.locator('.q-header .q-btn-dropdown').click(); await page.getByText("修改密碼", { exact: true }).click(); await expect(page).toHaveURL(/\/password\/change$/u);
  await page.setViewportSize({ width: 1440, height: 900 }); await openStocktake(page, f.header.id);
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await expect(page.getByRole("heading", { name: /· COUNTING ·/u })).toBeVisible();
    await closeSidebar(page);
    await expect(page.locator('.q-drawer__backdrop')).not.toBeVisible();
    const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll("body *")].map(element => { const rect = element.getBoundingClientRect(); return { tag: element.tagName, className: element.className, x: rect.x, width: rect.width, right: rect.right }; }).filter(rect => rect.right > innerWidth + 1).slice(0, 60) }));
    await fs.writeFile(path.join(process.env.HARNESS_RUN_DIR, `stocktake-ui-geometry-${width}.json`), JSON.stringify(geometry), { mode: 0o600 });
    await test.info().attach(`geometry-${width}`, { body: JSON.stringify(geometry), contentType: "application/json" });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await editCount(page); await page.getByRole("button", { name: "儲存此行點算", exact: true }).click();
    await expect(page.locator('[role="alert"][tabindex="-1"]').filter({ hasText: /安全非負整數/u })).toBeFocused();
    const card = page.locator('.q-dialog .q-card').last(), box = await card.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Tab"); await expect(page.getByRole("checkbox", { name: "未發現（實際為 0）" })).toBeFocused();
    await page.getByRole("button", { name: "明確捨棄點算", exact: true }).click();
    await expect(page.getByLabel("實數（Base UOM）", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "點算此行", exact: true }).first()).toBeFocused();
    await page.screenshot({ path: path.join(process.env.HARNESS_RUN_DIR, `stocktake-ui-cleared-${width}.png`) });
  }
  await choose(page, "點算篩選", "UNCOUNTED");
  await expect(page.locator('[aria-label="點算行表格"]')).toHaveAttribute("aria-busy", "false");
  await editCount(page, { quantity: 5 }); await saveCount(page);
  await expect(page.getByRole("button", { name: "點算此行", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("盤點行 Code／名稱 q（不搜尋帳外目錄）", { exact: true })).toBeFocused();
  for (const failure of [false, true]) {
    const context = await browser.newContext({ baseURL: process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN }), other = await context.newPage(), who = await makeActor(); observe(other);
    await other.route(`${origin}/api/**`, async route => { await pace(); await route.continue(); });
    try {
      await login(other, who); await other.setViewportSize({ width: 375, height: 900 });
      if (failure) { expectedNetworkFailures.add("/api/v1/user/logout"); await other.route(`${origin}/api/v1/user/logout`, route => route.abort("failed")); }
      await other.locator('.q-header .q-btn-dropdown').click(); await other.getByText("登出", { exact: true }).click(); await expect(other).toHaveURL(/\/login$/u);
      await expect(other.locator('.q-header')).toHaveCount(0); await other.goto(UI); await expect(other).toHaveURL(/\/login(?:\?|$)/u);
    } finally { await context.close(); }
  }
  observations.push({ case: "ST040-B15", realNames: names, homeAndStocktakeWidths: [320,375,768,1024,1440], nativeFullAccessibleName: true, keyboardMenuFocus: true, realProfilePasswordNavigation: true, realLogoutSuccessAndFailure: true, bodyAndDialogBounds: true, fiveClearedScreens: true });
});

test("ST040-B16 actual named Playwright CLI uses wizard Count Ready export plus real topbar logout and diagnostics", async ({ page }) => {
  await login(page); const f = await counting(page); await openStocktake(page, f.header.id);
  await page.getByRole("button", { name: /Synthetic Stocktake browser/u }).click(); await page.getByText("登出", { exact: true }).click(); await expect(page).toHaveURL(/\/login$/u);
  const who = await makeActor(), session = `st040-${randomUUID().slice(0,8)}`, runDirectory = process.env.HARNESS_RUN_DIR, execute = promisify(execFile);
  const cli = async (...args) => { let result; try { result = await execute("playwright-cli", [`-s=${session}`, ...args], { cwd: runDirectory, timeout: 45000, maxBuffer: 1024*1024 }); } catch { throw new Error(`Owned CLI ${args[0]} failed; raw credentials/output withheld`); } if (/### Error/u.test(result.stdout)) throw new Error("Owned CLI command error; inspect minimized diagnostic"); return result.stdout; };
  const script = path.join(runDirectory, `cli-owned-${session}.js`);
  const monitor = `const errors=[],network=[]; const apiOrigin=${JSON.stringify(origin)};
    const pageError=()=>errors.push('pageerror'), consoleError=m=>{if(['warning','error'].includes(m.type())) errors.push(m.type());};
    const pathFor=url=>url.slice(apiOrigin.length).split('?')[0];
    const response=r=>{if(r.url().startsWith(apiOrigin+'/')&&r.status()>=400) network.push({kind:'HTTP',path:pathFor(r.url()),status:r.status()});};
    const failed=r=>{if(r.url().startsWith(apiOrigin+'/')) network.push({kind:'FAILED',path:pathFor(r.url()),error:r.failure()?.errorText});};
    page.on('pageerror',pageError); page.on('console',consoleError); page.on('response',response); page.on('requestfailed',failed);
    const assertClean=()=>{if(errors.length||network.length) throw new Error('Unexpected CLI diagnostic event');};
    const dispose=()=>{page.off('pageerror',pageError);page.off('console',consoleError);page.off('response',response);page.off('requestfailed',failed);};`;
  try {
    await fs.writeFile(script, `async page => { await page.getByLabel('帳號',{exact:true}).fill(${JSON.stringify(who.username)}); await page.getByLabel('密碼',{exact:true}).fill(${JSON.stringify(who.password)}); await page.getByRole('button',{name:'登入',exact:true}).click(); await page.waitForURL('**/device/pending'); return {pending:true}; }`, { mode: 0o600 });
    await cli("open", process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN + "/login"); await cli("run-code", `--filename=${script}`);
    const [bindings] = await db.query("SELECT id,status FROM user_devices WHERE user_id=?", [who.id]); expect(bindings).toHaveLength(1); expect(bindings[0].status).toBe("pending"); await db.execute("UPDATE user_devices SET status='approved' WHERE id=?", [bindings[0].id]);
    await fs.writeFile(script, `async page => { await page.goto(${JSON.stringify(process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN + "/login")}); await page.getByLabel('帳號',{exact:true}).fill(${JSON.stringify(who.username)}); await page.getByLabel('密碼',{exact:true}).fill(${JSON.stringify(who.password)}); await page.getByRole('button',{name:'登入',exact:true}).click(); await page.waitForURL(${JSON.stringify(process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN + "/")}); return {loggedIn:true}; }`, { mode: 0o600 }); await cli("run-code", `--filename=${script}`);
    const probePath = `/api/v1/inventory/__stocktake_cli_guard_${randomUUID()}`, abortPath = `/api/v1/inventory/__stocktake_cli_abort_${randomUUID()}`;
    await fs.writeFile(script, `async page => { ${monitor} const caught=()=>{try{assertClean();return false;}catch{return true;}}; try {
      const logged=page.waitForEvent('console',{predicate:m=>m.text()==='ST040 controlled CLI console guard probe'});
      await page.evaluate(()=>console.error('ST040 controlled CLI console guard probe'));await logged;
      const consoleCaught=errors.length===1&&caught();errors.length=0;
      const probe=apiOrigin+${JSON.stringify(probePath)}, observed=page.waitForResponse(r=>r.url()===probe);
      const status=await page.evaluate(async url=>(await fetch(url)).status,probe);await observed;errors.length=0;
      const httpCaught=status===401&&network.length===1&&network[0].kind==='HTTP'&&network[0].path===${JSON.stringify(probePath)}&&caught();network.length=0;
      const aborted=apiOrigin+${JSON.stringify(abortPath)};await page.route(aborted,route=>route.abort('failed'));
      const terminal=page.waitForEvent('requestfailed',{predicate:r=>r.url()===aborted});await page.evaluate(url=>fetch(url).catch(()=>null),aborted);await terminal;await page.unroute(aborted);errors.length=0;
      const failedCaught=network.length===1&&network[0].kind==='FAILED'&&network[0].path===${JSON.stringify(abortPath)}&&network[0].error==='net::ERR_FAILED'&&caught();
      return {guardCaught:consoleCaught&&httpCaught&&failedCaught,consoleCaught,httpCaught,failedCaught,diagnosticOnly:true};
    } finally {dispose();} }`, { mode: 0o600 });
    expect(await cli("run-code", `--filename=${script}`)).toMatch(/"guardCaught":\s*true/u);
    await fs.writeFile(script, `async page => { ${monitor} try { await page.goto(${JSON.stringify(process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN + UI + "?id=" + f.header.id)}); await page.getByRole('button',{name:'點算此行',exact:true}).first().click(); await page.getByLabel('實數（Base UOM）',{exact:true}).fill('5'); await page.getByRole('button',{name:'儲存此行點算',exact:true}).click(); await page.getByRole('button',{name:'準備 Ready',exact:true}).click(); await page.getByRole('button',{name:'確認 Ready',exact:true}).click(); await page.getByRole('heading',{name:/READY_TO_POST/}).waitFor(); const downloading=page.waitForEvent('download'); await page.getByRole('button',{name:'下載盤點 CSV',exact:true}).click(); const download=await downloading; if(await download.failure()!==null) throw new Error('CLI download failed'); assertClean(); return {checked:true,wizardCountReady:true,download:true,consoleErrors:errors.length,networkErrors:network.length}; } finally {dispose();} }`, { mode: 0o600 });
    expect(await cli("run-code", `--filename=${script}`)).toMatch(/"checked":\s*true/u); await cli("console"); await cli("requests");
    expect((await headerRow(f.header.id)).status).toBe("READY_TO_POST"); expect(Number((await lineRow(f.lines[0].id)).counted_quantity)).toBe(5);
    observations.push({ case: "ST040-B16", actualNamedCLI: session, actualWizardCountReady: true, download: true, completedDownload: true, consoleNetworkCommands: true, actualSeparateBrowserDiagnosticsAsserted: true, controlledConsoleUnauthenticated401AbortGuardProbes: true, noPrivateStorageInspection: true });
  } finally { try { await cli("close"); } finally { await fs.unlink(script).catch(error => { if (error.code !== "ENOENT") throw error; }); } }
});
