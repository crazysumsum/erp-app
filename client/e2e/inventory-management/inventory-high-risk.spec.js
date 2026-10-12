import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../../server/src/modules/user/passwordHash.js";

const enabled = process.env.INVENTORY_P3_BROWSER_TESTS === "1";
test.skip(!enabled, "Requires the approved owned MySQL/API browser runtime");
test.use({ trace: "off", video: "off", screenshot: "off" });
let app, db, origin, fixture, password, interval, nextRequestAt = 0;
let failures, expectedFailures, errors, networkFailures, expectedNetworkFailures, attempts;
async function pace() {
  const wait = nextRequestAt - performance.now(); nextRequestAt = Math.max(nextRequestAt, performance.now()) + interval;
  if (wait > 0) await setTimeout(wait);
}
async function token(actor) {
  return app.services.require("jwt").issue({ roles: [actor.role], permissions: actor.permissions, ...(actor.did ? { did: actor.did } : {}) }, {
    subject: String(actor.id), version: await app.services.require("tokenRevocation").currentVersion(String(actor.id)), authTime: Math.floor(Date.now() / 1000) });
}
test.beforeAll(async () => {
  if (!enabled) return;
  expect(process.env.DB_NAME).toMatch(/^erp_inventory_p3_[a-z0-9]+$/u);
  expect(process.env.DB_SOCKET_PATH).toMatch(/^\/private\/tmp\/erp-inventory-p3-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  origin = process.env.INVENTORY_P3_API_ORIGIN; expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  const config = defaultConfigurationSource(); interval = Math.ceil(config.requestLimiter.ipWindowMs / config.requestLimiter.maxRequestsPerIpPerWindow) + 1;
  app = await createApplication({ configurationSource: { ...config, application: { ...config.application, host: "127.0.0.1", port: Number(new URL(origin).port) },
    jwt: { ...config.jwt, secret: randomBytes(32).toString("hex") } }, handlerRegistryOptions: { moduleUrls: [
      ...["warehouseHandlers", "binHandlers", "inquiryHandlers", "postingHandlers", "skuLookupHandlers"].map(name => new URL(`../../../server/src/handlers/inventory/${name}.js`, import.meta.url).href),
      new URL("../../../server/src/handlers/user/meHandler.js", import.meta.url).href
    ] } });
  db = app.services.require("mysqldatabase");
  const [[observed]] = await db.query("SELECT VERSION() AS version, @@skip_networking AS isolated, DATABASE() AS schema_name");
  expect(observed).toEqual({ version: "26.7.0", isolated: 1, schema_name: process.env.DB_NAME });
  expect((await app.start()).url).toBe(origin);
});
test.afterAll(async () => { if (app) await app.shutdown("task033_live_browser_complete"); });
test.beforeEach(async ({ page }) => {
  failures = []; expectedFailures = []; errors = []; networkFailures = []; expectedNetworkFailures = []; attempts = [];
  const now = Date.now(), suffix = randomUUID().slice(0, 8);
  password = randomBytes(32).toString("hex");
  async function actor(permissions, strong = false) {
    const name = `ui033-${randomUUID()}`;
    const [role] = await db.execute("INSERT INTO roles(name,created_at) VALUES (?,?)", [name, now]);
    for (const permission of permissions) await db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [role.insertId, permission]);
    const [user] = await db.execute("INSERT INTO users(username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)", [name, strong ? await hashPassword(password) : "synthetic-disabled-login", "High-risk browser", now, now]);
    await db.execute("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)", [user.insertId, role.insertId]);
    return { id: user.insertId, role: name, roleId: role.insertId, permissions };
  }
  const adjuster = await actor(["inventory.view", "inventory.adjust"], true), viewer = await actor(["inventory.view"]), operator = await actor(["inventory.view", "inventory.operation", "inventory.fefo.override"]);
  const code = `UI033-WH-${suffix}`;
  const [warehouse] = await db.execute("INSERT INTO inventory_warehouses(warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (?,?,?,?,?)", [code, code.toLowerCase(), code, now, now]);
  const [bin] = await db.execute("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (?,'SAME','same',?,?)", [warehouse.insertId, now, now]);
  const [uom] = await db.execute("INSERT INTO item_uoms(code,name,status,created_at,updated_at) VALUES (?,'Each','active',?,?)", [`HR${suffix}`, now, now]);
  async function sku(kind, policy = "none", stocked = true) {
    const skuCode = `UI033-${kind}-${suffix}`;
    const [item] = await db.execute("INSERT INTO items(name,product_type,status,created_at,updated_at) VALUES ('High-risk item','standard','active',?,?)", [now, now]);
    const [row] = await db.execute("INSERT INTO item_skus(item_id,sku_code,sku_name,tracking_policy,purchasable,sellable,inventory_tracked,status,created_at,updated_at) VALUES (?,?,?, ?,1,1,1,'active',?,?)", [item.insertId, skuCode, "Widget <img src=x onerror=alert(1)>", policy, now, now]);
    await db.execute("INSERT INTO item_sku_uoms(sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES (?,?,1,1,?,?)", [row.insertId, uom.insertId, now, now]);
    let lotId = null;
    if (policy !== "none") {
      const [lot] = await db.execute("INSERT INTO inventory_lots(sku_id,lot_number,normalized_lot_number,expiry_date,first_receipt_date,sku_code_snapshot,created_at) VALUES (?,'HR-LOT','HR-LOT','2030-12-31','2026-10-06',?,?)", [row.insertId, skuCode, now]); lotId = lot.insertId;
    }
    let balanceId = null;
    if (stocked) {
      const [stock] = await db.execute("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (?,?,?,?,'AVAILABLE',100,'2026-10-06',?,?)", [warehouse.insertId, bin.insertId, row.insertId, lotId, now, now]); balanceId = stock.insertId;
    }
    return { id: row.insertId, code: skuCode, lotId, balanceId };
  }
  fixture = { adjuster, viewer, operator, warehouse: { id: warehouse.insertId, code, binId: bin.insertId }, uomId: uom.insertId,
    plain: await sku("PLAIN"), batch: await sku("BATCH", "batch_expiry"), empty: await sku("EMPTY", "none", false) };
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) errors.push(message.text()); });
  page.on("requestfailed", request => { if (request.url().startsWith(origin)) networkFailures.push(new URL(request.url()).pathname); });
  page.on("response", response => { if (response.url().startsWith(origin) && response.status() >= 400) failures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.route(`${origin}/api/**`, async route => { await pace(); await route.continue(); });
  await page.goto("/login");
  const device = await page.evaluate(async () => {
    const { ensureDeviceKey, exportPublicKey, deviceIdFor } = await import("/src/framework/auth/deviceKey.js");
    const pair = await ensureDeviceKey(), publicKey = await exportPublicKey(pair);
    return { publicKey: [...publicKey], did: await deviceIdFor(publicKey), privateExtractable: pair.privateKey.extractable };
  });
  expect(device.privateExtractable).toBe(false);
  fixture.adjuster.did = device.did;
  await db.execute("INSERT INTO user_devices(user_id,device_id,public_key,status,requested_at) VALUES (?,?,?,'approved',?)", [adjuster.id, device.did, Buffer.from(device.publicKey), now]);
  await switchActor(page, adjuster);
  page.on("request", request => {
    if (request.url().startsWith(origin) && request.method() === "POST" && /\/(adjustments|status-transfers|reverse)$/u.test(new URL(request.url()).pathname)) {
      const body = request.postDataJSON(), headers = request.headers(); delete body.password;
      attempts.push({ body, key: headers["idempotency-key"], nonce: headers["x-device-nonce"], signature: headers["x-device-signature"] });
    }
  });
});
test.afterEach(async ({ page }) => {
  // Clear even on failure before Playwright collects any error-context snapshot.
  await page.evaluate(() => document.querySelectorAll('input[type="password"]').forEach(input => { input.value = ""; })).catch(() => {});
  password = null;
  expect(failures).toEqual(expectedFailures); expect(networkFailures).toEqual(expectedNetworkFailures);
  expect(errors.filter(error => !/^Failed to load resource: (the server responded with a status of (400|401|403|404|409|500) \(|net::ERR_FAILED)/u.test(error))).toEqual([]);
  expect(errors.filter(error => /^Failed to load resource:/u.test(error))).toHaveLength(expectedFailures.length + expectedNetworkFailures.length);
});
async function switchActor(page, actor) {
  await page.evaluate(value => {
    localStorage.setItem("erp.token", value); localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
  }, await token(actor));
}
async function pick(page, label, option) {
  const field = page.getByLabel(label, { exact: true }); await field.click(); await expect(field).toHaveAttribute("aria-expanded", "true");
  const listbox = page.locator(`[id="${await field.getAttribute('aria-controls')}"]`);
  await listbox.getByRole("option", { name: option, exact: true }).click(); await expect(listbox).toBeHidden();
}
async function form(page, action = "IN", sku = fixture.plain, quantity = "3") {
  await page.goto(`/inventory/adjustments?action=${action}`);
  if (page.viewportSize().width <= 1023) {
    await expect.poll(() => page.locator(".q-page-container").evaluate(element => Math.round(element.getBoundingClientRect().left))).toBe(0);
    const drawer = page.locator(".q-drawer");
    if ((await drawer.boundingBox()).x >= 0) await page.keyboard.press("Escape");
    await expect.poll(() => drawer.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  }
  await page.getByLabel("SKU Code", { exact: true }).fill(sku.code); await page.getByRole("button", { name: "查找 SKU", exact: true }).click();
  await expect(page.getByText(`${sku.code} · Widget`, { exact: false })).toBeVisible();
  await pick(page, "倉庫", fixture.warehouse.code); await pick(page, "庫位", "SAME");
  if (action !== "IN") {
    await page.getByRole("button", { name: "載入來源庫存", exact: true }).click();
    await pick(page, "來源庫存 bucket", `${fixture.warehouse.code}/SAME · ${sku.lotId ? "HR-LOT" : "無批次"} · AVAILABLE · On Hand 100 · v1`);
  } else if (sku.lotId) await pick(page, "既有批次", "HR-LOT · 2030-12-31");
  await page.getByLabel("數量（Base UOM）", { exact: true }).fill(quantity);
  await page.getByLabel("原因說明", { exact: true }).fill("瀏覽器合成庫存資料校正");
}
async function review(page) {
  await page.getByRole("button", { name: "準備確認", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("目前密碼（必填）", { exact: true })).toBeFocused();
}
async function confirm(page, value = password) {
  await page.getByLabel("目前密碼（必填）", { exact: true }).fill(value);
  await page.getByRole("button", { name: "確認過帳", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.locator('input[type="password"]').evaluateAll(inputs => inputs.every(input => input.value === ""))).toBe(true);
}
async function resolved(page) {
  await expect(page.getByRole("heading", { name: /已確認過帳/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /查看已過帳 Movement/u }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "重載已確認結果", exact: true })).toHaveCount(0);
}
async function stock(sku = fixture.plain) {
  const [rows] = await db.query("SELECT id,stock_status,on_hand_quantity,version FROM inventory_stock_balances WHERE sku_id=? ORDER BY id", [sku.id]); return rows;
}
async function operationCount() {
  const [[row]] = await db.query("SELECT COUNT(*) AS count FROM inventory_operation_requests WHERE actor_user_id=? AND result_id IS NOT NULL", [fixture.adjuster.id]); return Number(row.count);
}
const recordKey = () => `inventory-high-risk:v1:${fixture.adjuster.id}`;
async function recovery(page) { return page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), recordKey()); }
test("TASK-033 @technical Base-only IN, three statuses and immutable/new Lot validate real facts", async ({ page }) => {
  await form(page, "IN", fixture.empty, "0"); await page.getByRole("button", { name: "準備確認", exact: true }).click();
  await expect(page.getByRole("form", { name: "高風險庫存操作表單" }).getByRole("alert").first()).toContainText("安全正整數"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("數量（Base UOM）", { exact: true }).fill("3"); await pick(page, "原因分類", "OTHER");
  await page.getByLabel("原因說明", { exact: true }).fill("短原因"); await page.getByRole("button", { name: "準備確認", exact: true }).click();
  await expect(page.getByRole("form", { name: "高風險庫存操作表單" }).getByRole("alert").first()).toContainText("OTHER"); await page.getByLabel("原因說明", { exact: true }).fill("一二三四五六七八九十");
  for (const status of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    if (status !== "AVAILABLE") { await page.getByRole("button", { name: "開始新操作", exact: true }).click(); await form(page, "IN", fixture.empty); }
    await pick(page, "庫存狀態", status); await review(page); await expect(page.getByRole("dialog")).toContainText("目前 v不存在");
    await confirm(page); await resolved(page);
  }
  expect((await stock(fixture.empty)).map(row => Number(row.on_hand_quantity))).toEqual([3, 3, 3]);
  await page.getByRole("button", { name: "開始新操作", exact: true }).click(); await form(page, "IN", fixture.batch);
  await expect(page.getByText(/既有日期不可修改/u)).toContainText("2030-12-31"); await review(page); await confirm(page); await resolved(page);
  const [[lot]] = await db.query("SELECT DATE_FORMAT(expiry_date,'%Y-%m-%d') AS expiry, manufacture_date FROM inventory_lots WHERE id=?", [fixture.batch.lotId]);
  expect(lot).toEqual({ expiry: "2030-12-31", manufacture_date: null });
  expect((await stock(fixture.batch)).map(row => Number(row.on_hand_quantity))).toEqual([103]);
  expect((await db.query("SELECT id FROM inventory_lots WHERE sku_id=?", [fixture.batch.id]))[0]).toHaveLength(1);
  await page.getByRole("button", { name: "開始新操作", exact: true }).click(); await form(page, "IN", fixture.batch);
  await pick(page, "批次模式", "新批次"); await page.getByLabel("批次編號", { exact: true }).fill("NEW-LOT");
  await page.getByRole("button", { name: "準備確認", exact: true }).click(); await expect(page.getByRole("form", { name: "高風險庫存操作表單" }).getByRole("alert").first()).toContainText("效期日期");
  await page.getByLabel("效期", { exact: true }).fill("2031-01-01"); await review(page); await confirm(page); await resolved(page);
  expect(await operationCount()).toBe(5);
});
test("TASK-033 @technical OUT reads current guards and retains safe input after a real version rejection", async ({ page }) => {
  await form(page, "OUT"); await review(page);
  await db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=99,version=version+1 WHERE id=?", [fixture.plain.balanceId]);
  expectedFailures.push({ path: "/api/v1/inventory/adjustments", status: 409 }); await confirm(page);
  await expect(page.getByRole("heading", { name: "本次過帳遭拒", exact: true })).toBeVisible();
  await expect(page.getByLabel("數量（Base UOM）", { exact: true })).toHaveValue("3"); expect(await operationCount()).toBe(0);
  await page.getByRole("button", { name: "核對結果並重新準備", exact: true }).click(); await review(page);
  await expect(page.getByRole("dialog")).toContainText("目前 v2"); await confirm(page); await resolved(page);
  expect(Number((await stock())[0].on_hand_quantity)).toBe(96); expect(await operationCount()).toBe(1);
});
test("TASK-033 @technical Status paired effects and whole-group Reversal preserve actual history and stock", async ({ page }) => {
  await form(page, "STATUS_TRANSFER", fixture.batch); await review(page);
  await expect(page.getByRole("dialog")).toContainText("QUARANTINED"); await expect(page.getByRole("dialog")).toContainText("銷售資格");
  await confirm(page); await resolved(page);
  const movementLink = page.getByRole("link", { name: /查看已過帳 Movement/u }).first();
  const selected = Number(new URL(await movementLink.getAttribute("href"), page.url()).searchParams.get("movementId"));
  expect((await stock(fixture.batch)).map(row => Number(row.on_hand_quantity))).toEqual([97, 3]);
  await movementLink.click(); await page.getByRole("link", { name: `整組沖銷 Movement ${selected}`, exact: true }).click();
  await page.getByLabel("原因說明", { exact: true }).fill("合成資料整組沖銷確認"); await review(page);
  await expect(page.getByRole("dialog").locator("li")).toHaveCount(2); await confirm(page); await resolved(page);
  expect((await stock(fixture.batch)).map(row => Number(row.on_hand_quantity))).toEqual([100, 0]);
  await page.getByRole("link", { name: /查看已過帳 Movement/u }).first().click();
  await expect(page.getByRole("button", { name: /原 Movement/u })).toBeVisible();
  await page.getByRole("button", { name: /原 Movement/u }).click(); await expect(page.getByRole("button", { name: /沖銷 Movement/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /整組沖銷 Movement/u })).toHaveCount(0);
  expect(await operationCount()).toBe(2);
});
test("TASK-033 @technical actual permission, password and device gates cannot be replaced by operation or FEFO", async ({ page }) => {
  for (const actor of [fixture.viewer, fixture.operator]) {
    await switchActor(page, actor); await page.goto("/inventory/movements");
    await expect(page.getByRole("link", { name: "庫存調整", exact: true })).toHaveCount(0);
    await page.goto("/inventory/adjustments"); await expect(page.getByRole("form", { name: "高風險庫存操作表單" })).toHaveCount(0);
  }
  await switchActor(page, fixture.adjuster); await form(page); await review(page);
  expectedFailures.push({ path: "/api/v1/inventory/adjustments", status: 403 });
  await confirm(page, "invalid-synthetic-entry"); await expect(page.getByRole("heading", { name: "本次過帳遭拒", exact: true })).toBeVisible(); expect(await operationCount()).toBe(0);
  await page.getByRole("button", { name: "核對結果並重新準備", exact: true }).click(); await review(page);
  await db.execute("UPDATE user_devices SET status='revoked' WHERE user_id=? AND device_id=?", [fixture.adjuster.id, fixture.adjuster.did]);
  expectedFailures.push({ path: "/api/v1/inventory/adjustments", status: 403 }); await confirm(page);
  await expect(page.getByRole("heading", { name: "本次過帳遭拒", exact: true })).toBeVisible(); expect(await operationCount()).toBe(0);
  await db.execute("UPDATE user_devices SET status='approved' WHERE user_id=? AND device_id=?", [fixture.adjuster.id, fixture.adjuster.did]);
  await page.getByRole("button", { name: "核對結果並重新準備", exact: true }).click(); await review(page);
  await db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.adjust'", [fixture.adjuster.roleId]);
  expectedFailures.push({ path: "/api/v1/inventory/adjustments", status: 403 }); await confirm(page); expect(await operationCount()).toBe(0);
  await page.reload(); await expect(page.getByRole("form", { name: "高風險庫存操作表單" })).toHaveCount(0);
  expect(attempts).toHaveLength(3);
});
test("TASK-033 @technical pre-forward abort retries only original intent with fresh password/signature and one effect", async ({ page }) => {
  let abort = true;
  await page.route(`${origin}/api/v1/inventory/adjustments`, async route => { if (abort && route.request().method() === "POST") { abort = false; await route.abort("failed"); } else { await pace(); await route.continue(); } });
  await form(page); await review(page); expectedNetworkFailures.push("/api/v1/inventory/adjustments"); await confirm(page);
  await expect(page.getByRole("heading", { name: "結果未知／等待核對", exact: true })).toBeVisible(); expect(await operationCount()).toBe(0);
  const saved = await recovery(page); expect(Object.keys(saved).sort()).toEqual(["action", "source"]);
  expect(Object.keys(saved.source).sort()).toEqual(["documentId", "documentType", "eventId", "lineId", "module"]);
  await page.getByRole("button", { name: "查詢原結果", exact: true }).click(); expect(attempts).toHaveLength(1);
  await page.getByRole("button", { name: "重試原意圖", exact: true }).click(); await expect(page.getByLabel("目前密碼（必填）", { exact: true })).toHaveValue("");
  await confirm(page); await resolved(page); expect(attempts).toHaveLength(2);
  expect(attempts[0].body).toEqual(attempts[1].body); expect(attempts[0].key === attempts[1].key).toBe(true);
  expect(!!attempts[0].nonce && attempts[0].nonce !== attempts[1].nonce).toBe(true);
  expect(!!attempts[0].signature && attempts[0].signature !== attempts[1].signature).toBe(true);
  expect(Number((await stock())[0].on_hand_quantity)).toBe(103); expect(await operationCount()).toBe(1);
});
test("TASK-033 @technical real committed-response loss resolves original source without a second POST", async ({ page }) => {
  await page.route(`${origin}/api/v1/inventory/adjustments`, async route => {
    await pace(); const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed");
  });
  await form(page); await review(page); expectedNetworkFailures.push("/api/v1/inventory/adjustments"); await confirm(page); await resolved(page);
  expect(attempts).toHaveLength(1); expect(await operationCount()).toBe(1); expect(Number((await stock())[0].on_hand_quantity)).toBe(103);
  expect(await recovery(page)).toBeNull();
  await expect(page.getByText("結果未可確定；保留原意圖", { exact: false })).toHaveCount(0);
  const [[audit]] = await db.query("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE actor_user_id=?", [fixture.adjuster.id]); expect(Number(audit.count)).toBe(1);
  await page.screenshot({ path: `${process.env.HARNESS_RUN_DIR}/high-risk-resolved-cleared.png`, fullPage: true });
});
test("TASK-033 @technical refresh/navigation is query-only, actor-isolated and storage corruption blocks new effects", async ({ page }) => {
  await page.route(`${origin}/api/v1/inventory/adjustments`, route => route.abort("failed"));
  await form(page); await review(page); expectedNetworkFailures.push("/api/v1/inventory/adjustments"); await confirm(page);
  await expect(page.getByRole("heading", { name: "結果未知／等待核對", exact: true })).toBeVisible(); const saved = await recovery(page);
  await page.reload(); await expect(page.getByText("重新載入後只可查詢", { exact: false })).toBeVisible();
  for (const name of ["重試原意圖", "準備確認", "開始新操作"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查詢原結果", exact: true }).click(); expect(attempts).toHaveLength(1);
  await page.goto("/inventory/movements"); await page.goto("/inventory/adjustments"); await expect(page.getByText("重新載入後只可查詢", { exact: false })).toBeVisible();
  await switchActor(page, fixture.operator); await page.goto("/inventory/movements"); await expect(page.getByText(saved.source.documentId, { exact: false })).toHaveCount(0);
  await switchActor(page, fixture.adjuster); await page.goto("/inventory/adjustments"); expect((await recovery(page)).source).toEqual(saved.source);
  // Corrupt only this synthetic tab's reference to verify the trust boundary; never a product abandonment action.
  await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({ action: "REVERSAL", source: {} })), recordKey()); await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("復原識別格式無效"); await expect(page.getByRole("button", { name: "準備確認", exact: true })).toBeDisabled();
  expect(attempts).toHaveLength(1); expect(await operationCount()).toBe(0);
});
test("TASK-033 @technical keyboard, cleared cancellation, XSS escaping, responsive and delayed real SKU lookup", async ({ page }) => {
  await form(page); await review(page); await page.getByLabel("目前密碼（必填）", { exact: true }).fill(password);
  await page.getByRole("button", { name: "取消", exact: true }).click(); await expect(page.getByRole("dialog")).toBeHidden(); expect(attempts).toHaveLength(0);
  await review(page); await expect(page.getByLabel("目前密碼（必填）", { exact: true })).toHaveValue("");
  for (const width of [320, 768, 1024, 1440]) {
    await page.getByRole("button", { name: "取消", exact: true }).click(); await expect(page.getByRole("dialog")).toBeHidden();
    await page.setViewportSize({ width, height: 850 }); await form(page); await review(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const dialogCard = page.getByRole("dialog").locator(".q-card");
    await expect.poll(async () => (await dialogCard.boundingBox()).width).toBeGreaterThanOrEqual(Math.min(400, width - 48));
    const card = await dialogCard.boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0); expect(card.x + card.width).toBeLessThanOrEqual(width);
    expect(await dialogCard.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `${process.env.HARNESS_RUN_DIR}/high-risk-cleared-${width}.png`, fullPage: true });
  }
  expect(await page.getByRole("dialog").locator("img").count()).toBe(0);
  await page.getByLabel("目前密碼（必填）", { exact: true }).focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.getByRole("dialog")).toBeHidden(); await expect(page.getByRole("button", { name: "準備確認", exact: true })).toBeFocused();
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  await page.route(url => url.origin === origin && url.pathname.endsWith("/sku-lookup") && url.searchParams.get("code") === fixture.plain.code,
    async route => { entered(); await gate; await pace(); await route.continue(); });
  await page.getByLabel("SKU Code", { exact: true }).focus(); await page.keyboard.press("Enter"); await started;
  await page.getByLabel("SKU Code", { exact: true }).fill(fixture.empty.code); await page.getByRole("button", { name: "查找 SKU", exact: true }).click();
  await expect(page.getByText(`${fixture.empty.code} · Widget`, { exact: false })).toBeVisible();
  const old = page.waitForResponse(response => new URL(response.url()).searchParams.get("code") === fixture.plain.code); release(); await old;
  await expect(page.getByText(`${fixture.plain.code} · Widget`, { exact: false })).toHaveCount(0);
  expect(await operationCount()).toBe(0);
});
