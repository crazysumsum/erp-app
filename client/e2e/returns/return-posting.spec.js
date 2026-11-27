import process from "node:process";

import { readdir } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import "../../../server/test-support/testEnv.js";
import { reversalFixture } from "../../../server/test/fulfillment/shipmentReversalFixture.js";
import { confirmedSupplierReceipt } from "../../../server/test/returns/supplierReturnFixture.js";
import { installOpeningCost } from "../../../server/test/returns/returnShipmentCostFixture.js";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";

const permissions = ["returns.view", "returns.customer.mgmt", "returns.supplier.mgmt", "purchasing.view", "receiving.operation"];
const cleanup = [];
let token, shipment, receipt;

test.beforeAll(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") throw new Error("Returns Playwright requires an isolated MySQL test server");

  const f = await reversalFixture({ after: close => cleanup.push(close) }, { beforeConfirm: installOpeningCost });
  const [[issue]] = await f.db.query("SELECT * FROM shipment_issue_details WHERE shipment_id = ? ORDER BY id LIMIT 1", [f.shipmentId]);
  const otherWarehouseId = await f.s.insert("inventory_warehouses", {
    warehouse_code: "RT-OTHER", normalized_code: "rt-other", warehouse_name: "Other returns warehouse",
    status: "ACTIVE", created_at: f.s.now, updated_at: f.s.now
  });
  await f.s.insert("inventory_bins", {
    warehouse_id: otherWarehouseId, bin_code: "RT-OTHER-BIN", normalized_code: "rt-other-bin",
    status: "ACTIVE", created_at: f.s.now, updated_at: f.s.now
  });
  const directory = new URL("../../../server/database/migrations/", import.meta.url);
  const installed = new Set([92, 93, 95, 96, 98, 130]);
  for (const filename of (await readdir(directory)).filter(name => /^[0-9]{4}_.*\.js$/u.test(name)).sort()) {
    const version = Number(filename.slice(0, 4));
    if (version > 88 && !installed.has(version)) await (await import(new URL(filename, directory).href)).up(f.db);
  }

  await f.db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (?, ?, ?, ?, ?) WHERE r.name = ?`,
    [...permissions, f.claims.roles[0]]
  );
  const defaults = defaultConfigurationSource();
  const app = await createApplication({
    configurationSource: {
      ...defaults,
      application: { ...defaults.application, host: "127.0.0.1", port: Number(process.env.RETURNS_TEST_API_PORT) },
      security: { ...defaults.security, cors: { ...defaults.security.cors, allowedOrigins: `http://127.0.0.1:${process.env.RETURNS_TEST_CLIENT_PORT}` } },
      database: { ...defaults.database, ...f.f.connectionOptions, database: f.f.name, multipleStatements: false },
      scheduler: { ...defaults.scheduler, jobs: {} }
    }
  });
  cleanup.push(() => app.shutdown("returns_browser_complete"));
  const { url: apiOrigin } = await app.start();
  const subject = String(f.userId);
  const version = await app.services.require("tokenRevocation").currentVersion(subject);
  token = await app.services.require("jwt").issue({
    roles: f.claims.roles, permissions: [...f.claims.permissions, ...permissions]
  }, { subject, version, authTime: Math.floor(Date.now() / 1000) });

  shipment = f.shipment;
  ({ receipt } = await confirmedSupplierReceipt(f, async (method, endpoint, body, { key }) => {
    const response = await fetch(new URL(endpoint, apiOrigin), {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }, issue.bin_id));
});

test.afterAll(async () => {
  const errors = [];
  for (const close of cleanup.reverse()) {
    try { await close(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Returns browser cleanup failed");
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(token => {
    localStorage.setItem("erp.token", token);
    localStorage.setItem("erp.token.deadline", String(Date.now() + 600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 3_600_000));
  }, token);
});

function observeBrowser(page) {
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) failures.push(message.text());
  });
  page.on("requestfailed", request => failures.push([request.method(), new URL(request.url()).pathname, request.failure()?.errorText]));
  page.on("response", response => {
    if (response.status() >= 400) failures.push([response.status(), new URL(response.url()).pathname]);
  });
  return failures;
}

async function createDraft(page, { createLabel, resource, sourceNumber, reason, quantity, numberPattern, validate = false }) {
  await page.getByRole("link", { name: createLabel, exact: true }).click();
  await page.getByLabel(`原${resource}號`, { exact: false }).fill(sourceNumber);
  await page.getByRole("button", { name: "查找原單", exact: true }).click();
  await expect(page.getByText(`${resource} ${sourceNumber}`, { exact: true })).toBeVisible();
  const save = page.getByRole("button", { name: "建立草稿", exact: true });
  if (validate) {
    await save.click();
    await expect(page.getByText("必填", { exact: true }).first()).toBeVisible();
  }

  await page.getByLabel(/退貨原因/u).fill(reason);
  await page.getByLabel(/原批次明細/u).click();
  await page.getByRole("option", { name: /可退/u }).first().click();
  await page.getByLabel(/原倉庫位/u).click();
  const originalBin = page.getByRole("option", { name: /／/u }).first();
  await expect(originalBin).toBeVisible();
  await expect(page.getByRole("option", { name: "RT-OTHER／RT-OTHER-BIN", exact: true })).toHaveCount(0);
  await originalBin.click();
  await page.getByLabel(/基本數量/u).fill(quantity);
  await save.click();
  await expect(page.getByRole("heading", { name: numberPattern })).toBeVisible();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
}

test("customer return persists across refresh, cancels a draft, and posts to quarantine", async ({ page }) => {
  const failures = observeBrowser(page);
  await page.goto("/customer-returns");
  await expect(page.getByRole("heading", { name: "客戶退貨", exact: true })).toBeVisible();
  const customer = {
    createLabel: "新增客戶退貨", resource: "出貨單", sourceNumber: shipment.shipment_number,
    quantity: "1", numberPattern: /^CRT-\d+$/u
  };
  await createDraft(page, { ...customer, reason: "Synthetic return to cancel", validate: true });
  await page.reload();
  await expect(page.getByText("Synthetic return to cancel", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消草稿", exact: true }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "返回列表", exact: true }).click();
  await expect(page.getByRole("link", { name: customer.numberPattern })).toBeVisible();

  await createDraft(page, { ...customer, reason: "Synthetic return to quarantine" });
  await page.getByRole("button", { name: "確認過帳", exact: true }).click();
  await expect(page.getByText("已過帳", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("已過帳", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "退貨明細" }).getByText("隔離", { exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});

test("supplier return starts from the receipt and stays posted after refresh", async ({ page }) => {
  const failures = observeBrowser(page);
  const list = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/supplier-returns" && response.status() === 200);
  await page.goto("/supplier-returns");
  await expect(page.getByRole("heading", { name: "退回供應商", exact: true })).toBeVisible();
  expect((await (await list).json()).data.items).toEqual([]);

  await createDraft(page, {
    createLabel: "新增退回供應商", resource: "收貨單", sourceNumber: receipt.number,
    reason: "Synthetic supplier return", quantity: "2", numberPattern: /^SRT-\d+$/u
  });
  await page.getByRole("button", { name: "確認過帳", exact: true }).click();
  await expect(page.getByText("已過帳", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("已過帳", { exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});
