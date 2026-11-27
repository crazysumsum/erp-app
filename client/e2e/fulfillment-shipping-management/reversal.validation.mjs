import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { applyLegacyFulfillmentMigrations } from "../../../server/test/fulfillment/applyLegacyFulfillmentMigrations.js";
import { reversalFixture } from "../../../server/test/fulfillment/shipmentReversalFixture.js";
import { installOpeningCost } from "../../../server/test/returns/returnShipmentCostFixture.js";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";
import { ShipmentReversalService } from "../../../server/src/modules/fulfillment/ShipmentReversalService.js";
import { hashPassword } from "../../../server/src/modules/user/passwordHash.js";

async function withShipment(page, verify, { withoutReverse = false } = {}) {
  const cleanup = [];
  const fixture = { after: callback => cleanup.push(callback) };
  const errors = [];
  const pageErrors = [], failed = [], consoleErrors = [], unexpectedResponses = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("requestfailed", request => failed.push(new URL(request.url()).pathname));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type()) && !/^Failed to load resource:.*\b(?:400|403|409)\b/u.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", response => {
    const path = new URL(response.url()).pathname, status = response.status();
    if (status < 400 || path === "/api/v1/user/login" && status === 403 ||
        /^\/api\/v1\/shipments\/[^/]+\/reverse$/u.test(path) && [400, 403, 409].includes(status)) return;
    unexpectedResponses.push({ path, status });
  });
  try {
    const f = await reversalFixture(fixture, { archives: true, beforeConfirm: installOpeningCost });
    await applyLegacyFulfillmentMigrations(f.db, [92, 93, 95, 96, 97, 98]);
    await f.db.query(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN ('returns.view','returns.customer.mgmt') WHERE r.name=?`,
      [f.claims.roles[0]]);
    if (withoutReverse) {
      await f.db.query(`DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
        JOIN roles r ON r.id=rp.role_id WHERE r.name=? AND p.name='fulfillment.reverse'`, [f.claims.roles[0]]);
    }
    const password = "Synthetic-" + randomUUID() + "-Aa1!";
    await f.db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(password), f.userId]);
    const [[user]] = await f.db.query("SELECT username FROM users WHERE id=?", [f.userId]);
    const source = defaultConfigurationSource();
    const apiPort = Number(process.env.FULFILLMENT_TEST_API_PORT);
    const origin = `http://127.0.0.1:${process.env.FULFILLMENT_TEST_CLIENT_PORT}`;
    const configurationSource = {
      ...source,
      application: { ...source.application, host: "127.0.0.1", port: apiPort },
      security: { ...source.security, cors: { ...source.security.cors, allowedOrigins: origin } },
      database: { ...source.database, ...f.f.connectionOptions, database: f.f.name, multipleStatements: false },
      scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs,
        "sales.backorderAllocate": { enabled: false }, "sales.importWorker": { enabled: false },
        "sales.quotationExpire": { enabled: false }, "sales.confirmationRecovery": { enabled: false },
        "fulfillment.confirmationRecovery": { enabled: false } } }
    };
    const app = await createApplication({ configurationSource });
    cleanup.push(() => app.shutdown("private_reversal_browser_complete"));
    await app.start();
    const login = async () => {
      await page.goto("/login");
      await page.getByLabel("帳號").fill(user.username);
      await page.getByLabel("密碼", { exact: true }).fill(password);
      await page.getByRole("button", { name: "登入", exact: true }).click();
    };
    await login();
    await expect(page).toHaveURL(/\/device\/pending/u);
    await f.db.execute("UPDATE user_devices SET status='approved',reviewed_at=?,review_note=? WHERE user_id=?",
      [Date.now(), "Synthetic owned reversal browser", f.userId]);
    await login();
    await expect(page).toHaveURL(/\/$/u);
    await page.goto(`/shipments/${f.shipmentId}`);
    await expect(page.getByText("已出貨", { exact: true })).toBeVisible();
    await verify(f, app, password);
    expect({ pageErrors, failed, consoleErrors, unexpectedResponses }).toEqual({
      pageErrors: [], failed: [], consoleErrors: [], unexpectedResponses: []
    });
  } catch (error) {
    errors.push(error);
  }
  for (const close of cleanup.reverse()) {
    try { await close(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Reversal browser validation or cleanup failed");
}

async function post(page, path, body, key = body.eventId, signed = false) {
  const response = page.waitForResponse(reply => new URL(reply.url()).pathname === path && reply.request().method() === "POST");
  await page.evaluate(async ({ path, body, key, signed }) => {
    const { httpClient } = await import("/src/framework/http/HttpClient.js");
    try { await httpClient.post(path, { body, idempotent: true, idempotencyKey: key, signed }); }
    catch { /* The test asserts the actual HTTP response below. */ }
  }, { path, body, key, signed });
  return response;
}

function reverse(page, f, body = f.command, key = body.eventId) {
  return post(page, `/api/v1/shipments/${f.shipmentId}/reverse`, body, key, true);
}

function reversalResponse(page, f) {
  const path = `/api/v1/shipments/${f.shipmentId}/reverse`;
  return page.waitForResponse(reply => new URL(reply.url()).pathname === path && reply.request().method() === "POST");
}

async function confirmInDialog(page, f, password, beforeSubmit) {
  const dialog = page.getByRole("dialog", { name: /沖銷出貨/u });
  if (!await dialog.isVisible()) {
    await page.getByRole("button", { name: "沖銷出貨", exact: true }).click();
    await expect(dialog.getByText("原庫位明細", { exact: true })).toBeVisible();
    const submit = dialog.getByRole("button", { name: "確認沖銷整張出貨單", exact: true });
    await dialog.getByLabel("沖銷原因").fill(f.command.reason);
    await expect(submit).toBeDisabled();
    await dialog.getByRole("checkbox", { name: "確認貨物仍由公司控制" }).click();
    await expect(submit).toBeDisabled();
    await dialog.getByRole("checkbox", { name: "確認所有貨物已放回原庫位" }).click();
    await expect(submit).toBeDisabled();
  }
  await dialog.getByLabel("你的密碼").fill(password);
  const submit = dialog.getByRole("button", { name: "確認沖銷整張出貨單", exact: true });
  await expect(submit).toBeEnabled();
  await beforeSubmit?.();
  const result = reversalResponse(page, f);
  await submit.click();
  return result;
}

async function assertReversed(page, f) {
  await expect(page.getByRole("alert")).toContainText("已沖銷，只供歷史參考");
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("已沖銷，只供歷史參考");
  const [costs] = await f.db.query("SELECT entry_kind, quantity_delta, value_delta_hkd FROM inventory_cost_entries ORDER BY id");
  expect(costs.map(row => [row.entry_kind, String(row.quantity_delta), row.value_delta_hkd])).toEqual([
    ["ENABLEMENT", "5", "6.2500"], ["ISSUE", "-3", "-3.7500"], ["ISSUE_REVERSAL", "3", "3.7500"]
  ]);
}

test("native reversal dialog handles stale versions, real return occupancy and the final shipment and print status", async ({ page }) => {
  await withShipment(page, async (f, _app, password) => {
    expect((await reverse(page, f, { ...f.command, password }, randomUUID())).status()).toBe(400);
    const missing = await reverse(page, f);
    expect(missing.status()).toBe(400);
    expect((await missing.json()).error.code).toBe("PASSWORD_REQUIRED");
    const open = page.getByRole("button", { name: "沖銷出貨", exact: true });
    await page.setViewportSize({ width: 375, height: 850 });
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /沖銷出貨/u });
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await expect(dialog.getByText("原庫位明細", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(open).toBeFocused();
    const incorrect = await confirmInDialog(page, f, "wrong-synthetic-confirmation");
    expect(incorrect.status()).toBe(403);
    expect((await incorrect.json()).error.code).toBe("PASSWORD_INVALID");
    await expect(dialog.getByRole("alert")).toContainText("請確認你目前的密碼");
    await expect(dialog.getByLabel("你的密碼")).toHaveValue("");
    const rejected = [f.command.eventId, incorrect.request().postDataJSON().eventId];
    const [[operationCount]] = await f.db.query("SELECT COUNT(*) AS count FROM fulfillment_operation_requests WHERE event_id IN (?,?)", rejected);
    expect(Number(operationCount.count)).toBe(0);
    const stale = await confirmInDialog(page, f, password, () => f.db.execute(
      "UPDATE shipments SET version=version+1 WHERE id=? AND version=?", [f.shipmentId, f.command.version]));
    expect(stale.status()).toBe(409);
    expect((await stale.json()).error.code).toBe("VERSION_CONFLICT");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("alert")).toContainText("資料已被修改，請重新載入後再試");
    await expect(open).toBeEnabled();

    const [[issue]] = await f.db.query("SELECT id,bin_id FROM shipment_issue_details WHERE shipment_id=?", [f.shipmentId]);
    const draft = await post(page, "/api/v1/customer-returns", {
      eventId: randomUUID(), sourceId: f.shipmentId, returnDate: f.options.time.fileDate(), reason: "Synthetic return occupancy",
      lines: [{ sourceDetailId: String(issue.id), baseQuantity: "1", binId: String(issue.bin_id) }]
    });
    expect(draft.status()).toBe(200);
    const returnId = (await draft.json()).data.id;
    const blocked = await confirmInDialog(page, f, password);
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error.code).toBe("DOWNSTREAM_MATTER_BLOCKS_REVERSAL");
    await expect(dialog.getByRole("alert")).toContainText("已有下游事項");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByText("已出貨", { exact: true })).toBeVisible();
    expect((await post(page, `/api/v1/customer-returns/${returnId}/cancel`, { eventId: randomUUID(), version: 1 })).status()).toBe(200);
    const response = await confirmInDialog(page, f, password);
    expect(response.status()).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ outcome: "REVERSED", shipment: { id: f.shipmentId, status: "REVERSED" } });
    const replay = await reverse(page, f, response.request().postDataJSON());
    expect(replay.status()).toBe(200);
    expect((await replay.json()).data).toEqual(data);
    await assertReversed(page, f);
    await expect(open).toHaveCount(0);
    await page.getByRole("link", { name: "送貨單列印", exact: true }).click();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("alert")).toContainText("已沖銷");
    await expect(page.locator(".reversed-watermark")).toBeVisible();
    expect((await page.pdf({ format: "A4" })).toString("latin1").startsWith("%PDF-")).toBe(true);
  });
});

test("native browser receives 202 and the registered cluster job recovers the cost-bound event", async ({ page }) => {
  await withShipment(page, async (f, app, password) => {
    const complete = ShipmentReversalService.prototype.completeReversalPhaseB;
    let interrupted = 0, eventId;
    const commands = [];
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/reverse")) {
        eventId = request.postDataJSON().eventId;
        commands.push(eventId);
      }
    });
    ShipmentReversalService.prototype.completeReversalPhaseB = function(started, ...args) {
      if (started.eventId === eventId && interrupted++ === 0) throw new Error("Synthetic interruption before Phase B");
      return complete.call(this, started, ...args);
    };
    let pending;
    try {
      const response = await confirmInDialog(page, f, password);
      expect(response.status()).toBe(202);
      expect(response.headers()["retry-after"]).toBe("2");
      pending = (await response.json()).data;
      expect(pending).toMatchObject({ outcome: "REVERSING", eventId });
      expect(interrupted).toBe(1);
    } finally {
      ShipmentReversalService.prototype.completeReversalPhaseB = complete;
    }
    await expect(page.getByRole("status", { name: "沖銷處理中" })).toBeVisible();
    const saved = await page.evaluate(shipmentId => Object.keys(sessionStorage)
      .filter(key => key.startsWith("shipment.reverse:") && key.endsWith(`:${shipmentId}`))
      .map(key => JSON.parse(sessionStorage.getItem(key))), f.shipmentId);
    expect(saved).toEqual([{ eventId: pending.eventId, correlationId: pending.correlationId, statusUrl: pending.statusUrl }]);
    await page.reload();
    await expect(page.getByRole("status", { name: "沖銷處理中" })).toBeVisible();
    await expect(page.getByText("操作處理中，所有編輯及重複提交已停用；請查詢原事件結果。", { exact: true })).toBeVisible();
    await expect(page.getByText(`原沖銷事件：${pending.eventId}`, { exact: true })).toBeVisible();
    await f.db.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=1 WHERE event_id=?", [pending.eventId]);
    const scheduler = app.services.require("scheduler");
    const job = scheduler.jobs.get("fulfillment.reversalRecovery");
    expect(job?.enabled).toBe(true);
    await scheduler.execute(job);
    expect(scheduler.stats.get(job.name).lastOutcome).toBe("succeeded");
    const operation = await page.evaluate(async statusUrl => {
      const { httpClient } = await import("/src/framework/http/HttpClient.js");
      return httpClient.get(statusUrl);
    }, pending.statusUrl);
    expect(operation).toMatchObject({ eventId: pending.eventId, status: "SUCCEEDED" });
    await assertReversed(page, f);
    expect(commands).toEqual([pending.eventId]);
  });
});

test("view-only operator sees no reversal action and the public API refuses the command", async ({ page }) => {
  await withShipment(page, async (f, _app, password) => {
    await expect(page.getByRole("button", { name: "沖銷出貨", exact: true })).toHaveCount(0);
    const response = await reverse(page, f, { ...f.command, password });
    expect(response.status()).toBe(403);
  }, { withoutReverse: true });
});
