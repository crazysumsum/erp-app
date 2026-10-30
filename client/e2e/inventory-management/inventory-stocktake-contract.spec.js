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

const enabled = process.env.INVENTORY_STOCKTAKE_BROWSER_TESTS === "1";
test.skip(!enabled, "Requires approved owned native MySQL/browser runtime");
let app, db, origin, fixture, actor, interval, nextAt = 0, expectedFailures, failures, errors;
const ROOT = "/api/v1/inventory/stocktakes", observations = [];
const source = () => ({ module: "INVENTORY", documentType: "STOCKTAKE", documentId: randomUUID(), lineId: "", eventId: randomUUID() });
async function pace() { const at = Math.max(nextAt, performance.now()); nextAt = at + interval; if (at > performance.now()) await setTimeout(at - performance.now()); }
async function makeActor(permissions = ["inventory.view", "inventory.operation", "inventory.adjust"]) {
  const username = `pw-st039-${randomUUID()}`, password = randomBytes(32).toString("hex"), now = Date.now();
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
  return { warehouseId: warehouse.insertId, bins, skuId: sku.insertId };
}
test.beforeAll(async () => {
  if (!enabled) return;
  expect(process.env.DB_NAME).toMatch(/^erp_inventory_task039_[a-z0-9_]+$/u); expect(process.env.DB_SOCKET_PATH).toMatch(/^\/private\/tmp\/erp-inventory-task039-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  origin = process.env.INVENTORY_STOCKTAKE_API_ORIGIN; expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  const config = defaultConfigurationSource(); interval = Math.ceil(config.requestLimiter.ipWindowMs / config.requestLimiter.maxRequestsPerIpPerWindow) + 1;
  app = await createApplication({ configurationSource: { ...config, application: { ...config.application, host: "127.0.0.1", port: Number(new URL(origin).port) }, jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") } } });
  db = app.services.require("mysqldatabase"); const [[actual]] = await db.query("SELECT VERSION() AS version,DATABASE() AS name,@@skip_networking AS isolated"); expect([actual.version, actual.name, Number(actual.isolated)]).toEqual(["26.7.0", process.env.DB_NAME, 1]); expect((await app.start()).url).toBe(origin);
});
test.afterAll(async () => { if (app) await app.shutdown("task039_browser_complete"); if (enabled && process.env.HARNESS_RUN_DIR) await fs.writeFile(path.join(process.env.HARNESS_RUN_DIR, "stocktake-browser-observations.json"), JSON.stringify(observations)); });
function observe(page) {
  page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
  page.on("response", response => { if (response.url().startsWith(origin) && response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on("requestfailed", request => { if (request.url().startsWith(origin) && !request.failure()?.errorText.includes("ERR_ABORTED")) errors.push(`API network failure ${new URL(request.url()).pathname}`); });
}
test.beforeEach(async ({ page }) => { expectedFailures = []; failures = []; errors = []; actor = await makeActor(); fixture = await seed(); observe(page); await page.route(`${origin}/api/**`, async route => { await pace(); await route.continue(); }); });
test.afterEach(async () => {
  expect(failures).toEqual(expectedFailures);
  const resourceErrors = errors.filter(value => /^Failed to load resource: the server responded with a status of /u.test(value)); expect(resourceErrors).toHaveLength(expectedFailures.length);
  expect(errors.filter(value => !resourceErrors.includes(value))).toEqual([]);
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
async function counting(page) { const created = await draft(page), header = await success(page, "startStocktake", created.id, { source: source(), expectedVersion: created.version }); return { header, lines: (await success(page, "listStocktakeLines", created.id)).rows }; }
async function ready(page, quantity = 5) { const f = await counting(page); await success(page, "saveStocktakeCounts", f.header.id, { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 1, countedQuantity: quantity }] }); f.header = await success(page, "readyStocktake", f.header.id, { source: source(), expectedVersion: 2 }); return f; }
const terminal = f => ({ source: source(), expectedVersion: f.header.version, reason: "Synthetic browser reconciliation", password: actor.password, idempotencyKey: randomUUID() });

test("ST039-B01 real UI login and client Draft Start Count Ready show PREVIEW then FROZEN", async ({ page }) => {
  await login(page); const created = await draft(page), updated = await success(page, "updateStocktake", created.id, { source: source(), expectedVersion: 1, binIds: fixture.bins }); expect(updated.version).toBe(2);
  const started = await success(page, "startStocktake", created.id, { source: source(), expectedVersion: 2 }), lines = await success(page, "listStocktakeLines", created.id); expect(lines.rows[0].actualQuantity).toBeNull();
  await success(page, "saveStocktakeCounts", created.id, { source: source(), lines: [{ lineId: lines.rows[0].id, expectedVersion: 1, countedQuantity: 0 }] });
  const preview = await success(page, "listStocktakeLines", created.id); expect(preview.varianceStage).toBe("PREVIEW"); expect(preview.rows[0].varianceQuantity).toBe(-5);
  await success(page, "readyStocktake", created.id, { source: source(), expectedVersion: started.version }); expect((await success(page, "getStocktake", created.id)).varianceStage).toBe("FROZEN");
});
test("ST039-B02 actual browser nonextractable P-256 signer and password Post commit SQL changes", async ({ page }) => {
  await login(page); const f = await ready(page, 8), posted = await success(page, "postStocktake", f.header.id, terminal(f)); expect(posted.status).toBe("POSTED");
  expect(Number((await db.query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE warehouse_id=?", [fixture.warehouseId]))[0][0].on_hand_quantity)).toBe(8);
  expect((await db.query("SELECT id FROM inventory_movements WHERE operation_request_id=?", [posted.operationId]))[0]).toHaveLength(1);
  expect((await db.query("SELECT id FROM inventory_bin_locks WHERE stocktake_id=? AND released_at IS NULL", [f.header.id]))[0]).toHaveLength(0);
});
test("ST039-B03 password-only Cancel works without an approved device and rejects wrong password", async ({ page }) => {
  await login(page); const f = await counting(page); await db.execute("UPDATE user_devices SET status='revoked' WHERE user_id=?", [actor.id]); expect((await db.query("SELECT id FROM user_devices WHERE user_id=? AND status='approved'", [actor.id]))[0]).toHaveLength(0);
  expectedFailures.push({ path: `${ROOT}/${f.header.id}/cancel`, status: 403 }); const denied = await call(page, "cancelStocktake", f.header.id, { ...terminal(f), password: "wrong-synthetic" }); expect(denied.status).toBe(403);
  expect((await success(page, "cancelStocktake", f.header.id, terminal(f))).status).toBe("CANCELLED"); expect((await success(page, "getStocktake", f.header.id)).cancelled).toBe(true);
});
test("ST039-B04 actual viewer denial, stale versions and incomplete Ready are safe errors", async ({ page, browser }) => {
  await login(page); const f = await counting(page);
  expectedFailures.push({ path: `${ROOT}/${f.header.id}/ready`, status: 409 }); expect((await call(page, "readyStocktake", f.header.id, { source: source(), expectedVersion: 2 })).code).toBe("STOCKTAKE_STATE_CONFLICT"); expect((await success(page, "getStocktake", f.header.id)).progress.uncountedLines).toBe(1);
  expectedFailures.push({ path: `${ROOT}/${f.header.id}/counts/save`, status: 409 }); expect((await call(page, "saveStocktakeCounts", f.header.id, { source: source(), lines: [{ lineId: f.lines[0].id, expectedVersion: 2, countedQuantity: 0 }] })).code).toBe("VERSION_CONFLICT");
  const other = await browser.newContext({ baseURL: process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN }), viewer = await makeActor(["inventory.view"]), viewerPage = await other.newPage(); observe(viewerPage); await viewerPage.route(`${origin}/api/**`, async route => { await pace(); await route.continue(); });
  try { await login(viewerPage, viewer); expectedFailures.push({ path: `${ROOT}/create`, status: 403 }); expect((await call(viewerPage, "createStocktake", { source: source(), warehouseId: fixture.warehouseId, binIds: fixture.bins })).status).toBe(403); } finally { await other.close(); }
});
test("ST039-B05 client getBlob uses real filters, safe CSV cells and truthful truncation footer", async ({ page }) => {
  await login(page); const f = await ready(page, 3);
  const csv = await page.evaluate(async id => { const { default: inventory } = await import("/src/services/inventory.js"); return (await inventory.exportStocktake(id, { variance: "LOSS" })).blob.text(); }, f.header.id);
  const rows = parse(csv, { columns: true }); expect(rows.find(row => row.recordType === "LINE").skuNameCurrent).toMatch(/^'=/u); expect(rows.at(-1).exportedRows).toBe("3"); expect(rows.at(-1).truncated).toBe("false");
  const original = InventoryStocktakeExportService.prototype.prepare;
  InventoryStocktakeExportService.prototype.prepare = async function(input) { const previous = this.config; this.config = { ...previous, exportMaxRows: 1 }; try { return await original.call(this, input); } finally { this.config = previous; } };
  try { const limited = await page.evaluate(async id => { const { default: inventory } = await import("/src/services/inventory.js"); return (await inventory.exportStocktake(id)).blob.text(); }, f.header.id); const rows = parse(limited, { columns: true }); expect(rows.at(-1).truncated).toBe("true"); expect(rows.at(-1).truncationReason).toBe("ROW_LIMIT"); expect(rows.at(-1).exportedRows).toBe("1"); } finally { InventoryStocktakeExportService.prototype.prepare = original; }
});
test("ST039-B06 stable key/source with a fresh browser signature replays exact original receipt", async ({ page }) => {
  await login(page); const f = await ready(page, 8), body = terminal(f), first = await success(page, "postStocktake", f.header.id, body); expect(await success(page, "postStocktake", f.header.id, body)).toEqual(first);
  expectedFailures.push({ path: `${ROOT}/${f.header.id}/post`, status: 409 }); expect((await call(page, "postStocktake", f.header.id, { ...body, reason: "Changed intent" })).status).toBe(409);
  expect((await db.query("SELECT id FROM inventory_movements WHERE operation_request_id=?", [first.operationId]))[0]).toHaveLength(1);
});
test("ST039-B07 refresh restores actual session and current device/JWT revocation denies retries", async ({ page }) => {
  await login(page); const f = await ready(page); await page.reload(); await expect(page).toHaveURL(new URL("/", process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN).href); expect((await success(page, "getStocktake", f.header.id)).status).toBe("READY_TO_POST");
  await db.execute("UPDATE user_devices SET status='revoked' WHERE user_id=?", [actor.id]); expectedFailures.push({ path: `${ROOT}/${f.header.id}/post`, status: 403 }); expect((await call(page, "postStocktake", f.header.id, terminal(f))).status).toBe(403);
  await app.services.require("tokenRevocation").revoke(String(actor.id), { reason: "Synthetic browser test" }); expectedFailures.push({ path: `${ROOT}/${f.header.id}`, status: 401 }); expect((await call(page, "getStocktake", f.header.id)).status).toBe(401); await expect(page).toHaveURL(/\/login/u);
  expect((await db.query("SELECT id FROM inventory_movements WHERE stocktake_line_id IN (SELECT id FROM inventory_stocktake_lines WHERE stocktake_id=?)", [f.header.id]))[0]).toHaveLength(0);
});
test("ST039-B08 actual abort/empty query diagnostics and named Playwright CLI exercise live application", async ({ page }) => {
  await login(page); expect((await success(page, "listStocktakes", { warehouseId: 99999999 })).rows).toEqual([]);
  const f = await counting(page), abort = await page.evaluate(async id => { const { default: inventory } = await import("/src/services/inventory.js"); const controller = new AbortController(); controller.abort(); try { await inventory.exportStocktake(id, { signal: controller.signal }); return false; } catch { return true; } }, f.header.id); expect(abort).toBe(true);
  const cliActor = await makeActor(["inventory.view"]), session = `st039-${randomUUID().slice(0, 8)}`, runDirectory = process.env.HARNESS_RUN_DIR, execute = promisify(execFile);
  const cli = async (...args) => { let result; try { result = await execute("playwright-cli", [`-s=${session}`, ...args], { cwd: runDirectory, timeout: 45000, maxBuffer: 1024 * 1024 }); } catch { throw new Error(`Owned Playwright CLI ${args[0]} failed; credentials and raw output omitted`); } if (/### Error/u.test(result.stdout)) throw new Error("Playwright CLI reported a command error; local sanitized diagnostics required"); return result.stdout; };
  const script = path.join(runDirectory, `cli-login-${session}.js`), queryScript = path.join(runDirectory, `cli-query-${session}.js`);
  await fs.writeFile(script, `async page => { await page.getByLabel('帳號',{exact:true}).fill(${JSON.stringify(cliActor.username)}); await page.getByLabel('密碼',{exact:true}).fill(${JSON.stringify(cliActor.password)}); await page.getByRole('button',{name:'登入',exact:true}).click(); await page.waitForURL('**/device/pending'); return {pending:true}; }`, { mode: 0o600 });
  try {
    await cli("open", process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN + "/login"); await cli("run-code", `--filename=${script}`);
    const [devices] = await db.query("SELECT id,status FROM user_devices WHERE user_id=?", [cliActor.id]); expect(devices).toHaveLength(1); expect(devices[0].status).toBe("pending"); await db.execute("UPDATE user_devices SET status='approved' WHERE id=?", [devices[0].id]);
    await fs.writeFile(script, `async page => { await page.goto(${JSON.stringify(process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN + "/login")}); await page.getByLabel('帳號',{exact:true}).fill(${JSON.stringify(cliActor.username)}); await page.getByLabel('密碼',{exact:true}).fill(${JSON.stringify(cliActor.password)}); await page.getByRole('button',{name:'登入',exact:true}).click(); await page.waitForURL(${JSON.stringify(process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN + "/")}); return {loggedIn:true}; }`, { mode: 0o600 });
    await cli("run-code", `--filename=${script}`);
    await fs.writeFile(queryScript, `async page => { const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const result=await page.evaluate(async id=>{const {default:inventory}=await import('/src/services/inventory.js'); const detail=await inventory.getStocktake(id); const {blob}=await inventory.exportStocktake(id); return {id:detail.id,status:detail.status,hasSummary:(await blob.text()).includes('SUMMARY')};},${f.header.id}); if(result.id!==${f.header.id}||!result.hasSummary||errors.length) throw new Error('CLI contract assertion failed'); return {checked:true,status:result.status,consoleErrors:errors.length}; }`, { mode: 0o600 });
    const output = await cli("run-code", `--filename=${queryScript}`); expect(output).toMatch(/"checked":\s*true/u); await cli("console"); await cli("requests");
    observations.push({ kind: "actualNamedPlaywrightCLI", session, login: "real password/device", query: true, csv: true, consoleAndNetworkCommands: true, noTokenStorageAccess: true });
  } finally { try { await cli("close"); } finally { await fs.unlink(script); await fs.unlink(queryScript).catch(error => { if (error.code !== "ENOENT") throw error; }); } }
});
