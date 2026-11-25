import process from "node:process";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import "../../../server/test-support/testEnv.js";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";
import { customerCredit, supplierCredit } from "../../../server/test/refunds/refundCreditFixture.js";

let app, token, viewerToken, customer, supplier, newSupplierCredit, post, today;
const permissions = ["ar.view", "ap.view", "ar.credit.mgmt", "ap.credit.mgmt", "ar.refund.mgmt", "ap.refund.mgmt"];

async function issueUser(db, granted) {
  const now = Date.now(), name = `refund-ui-${randomUUID().slice(0, 12)}`;
  const [{ insertId: user }] = await db.query("INSERT INTO users SET ?", [{
    username: name, display_name: "Refund browser test", password_hash: "synthetic", created_at: now, updated_at: now
  }]);
  const [{ insertId: role }] = await db.query("INSERT INTO roles (name, created_at) VALUES (?, ?)", [name, now]);
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [user, role]);
  await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?)", [role, granted]);
  const subject = String(user), version = await app.services.require("tokenRevocation").currentVersion(subject);
  return app.services.require("jwt").issue({ roles: [name], permissions: granted }, { subject, version, authTime: Math.floor(now / 1000) });
}

test.beforeAll(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") throw new Error("Refund Playwright requires a migrated, isolated MySQL test database");
  const defaults = defaultConfigurationSource();
  app = await createApplication({ configurationSource: {
    ...defaults, application: { ...defaults.application, host: "127.0.0.1", port: Number(process.env.REFUNDS_TEST_API_PORT) },
    security: { ...defaults.security, cors: { ...defaults.security.cors, allowedOrigins: `http://127.0.0.1:${process.env.REFUNDS_TEST_CLIENT_PORT}` } },
    scheduler: { ...defaults.scheduler, jobs: {} }
  } });
  const { url } = await app.start();
  const time = app.services.require("time"), db = app.services.require("mysqldatabase");
  token = await issueUser(db, permissions);
  viewerToken = await issueUser(db, ["ar.view", "ap.view"]);

  async function request(endpoint, body) {
    const response = await fetch(new URL(endpoint, url), {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json", "Idempotency-Key": body.eventId } : {}) },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }
  today = time.fileDate(time.at(time.nowMs()));
  const f = { db, today, other: "HKD",
    ok(result) { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.data; } };
  post = (endpoint, data) => request(endpoint, { eventId: randomUUID(), ...data });
  newSupplierCredit = () => supplierCredit(f, post, request);
  customer = await customerCredit(f, post, request);
  supplier = await newSupplierCredit();
});

test.afterAll(async () => app?.shutdown("refund_browser_complete"));

async function signIn(page, jwt) {
  await page.addInitScript(jwt => {
    localStorage.setItem("erp.token", jwt);
    localStorage.setItem("erp.token.deadline", String(Date.now() + 600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 3_600_000));
  }, jwt);
}

function observe(page) {
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) failures.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) failures.push([response.status(), new URL(response.url()).pathname]); });
  page.on("requestfailed", request => failures.push([new URL(request.url()).pathname, request.failure()?.errorText]));
  return failures;
}

async function createDraft(page, source, title, { validate = false } = {}) {
  await page.getByRole("link", { name: `新增${title}`, exact: true }).click();
  const credit = page.getByLabel(/來源貸項單/u);
  const save = page.getByRole("button", { name: "建立草稿", exact: true });
  await credit.click();
  await page.getByRole("option", { name: new RegExp(source.number, "u") }).click();
  await expect(page.getByText("可退款金額 HKD 10.00", { exact: true })).toBeVisible();
  const amount = page.getByLabel(/退款金額/u);
  await amount.fill(validate ? "12" : "7.50");
  await page.getByLabel(/退款方式/u).click();
  await page.getByRole("option", { name: "支票", exact: true }).click();
  if (validate) {
    await save.click();
    await expect(page.getByText("退款金額超過貸項可用額", { exact: true })).toBeVisible();
    await expect(amount).toBeFocused();
    await amount.fill("7.50");
  }
  await page.getByLabel("參考號", { exact: true }).fill("Synthetic refund browser reference");
  await save.click();
  await expect(page.getByRole("heading", { name: /^草稿 #\d+$/u })).toBeVisible();
}

async function confirmDraft(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
}

test("customer can create, confirm, refresh, and void a refund", async ({ page, browser }) => {
  const failures = observe(page);
  await signIn(page, token);
  await page.goto("/ar/refunds");
  await expect(page.getByRole("heading", { name: "客戶退款", exact: true })).toBeVisible();
  await createDraft(page, customer, "客戶退款", { validate: true });
  await confirmDraft(page, "確認退款記錄");
  const number = page.getByRole("heading", { name: /^RFD-\d{4}-\d{6}$/u });
  await expect(number).toBeVisible();
  await page.reload();
  await expect(number).toBeVisible();
  await expect(page.getByText("已確認", { exact: true })).toBeVisible();
  expect((await customer.credit()).body.data.availableAmount).toBe("2.5000");

  const viewer = await browser.newPage();
  try {
    const viewerFailures = observe(viewer);
    await signIn(viewer, viewerToken);
    await viewer.goto(page.url());
    await expect(viewer.getByRole("heading", { name: /^RFD-\d{4}-\d{6}$/u })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "作廢退款記錄", exact: true })).toHaveCount(0);
    expect(viewerFailures).toEqual([]);
  } finally {
    await viewer.close();
  }

  await page.getByRole("button", { name: "作廢退款記錄", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Synthetic void reason");
  await dialog.getByRole("button", { name: "作廢退款記錄", exact: true }).click();
  await expect(page.getByText("已作廢", { exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic void reason", { exact: true })).toBeVisible();
  expect((await customer.credit()).body.data.availableAmount).toBe("10.0000");
  await page.getByRole("link", { name: customer.number, exact: true }).click();
  await expect(page).toHaveURL(/\/ar\/credit-notes\/\d+$/u);
  await expect(page.getByRole("heading", { name: customer.number, exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});

test("supplier can cancel a draft and confirm another refund", async ({ page }) => {
  const failures = observe(page);
  await signIn(page, token);
  await page.goto("/ap/refunds");
  await createDraft(page, supplier, "供應商退款");
  const draftLabel = await page.getByRole("heading", { name: /^草稿 #\d+$/u }).textContent();
  await confirmDraft(page, "取消草稿");
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "返回列表", exact: true }).click();
  const draftRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: draftLabel, exact: true }) });
  await expect(draftRow.getByRole("cell", { name: "已取消", exact: true })).toBeVisible();
  await createDraft(page, supplier, "供應商退款");
  await confirmDraft(page, "確認退款記錄");
  await expect(page.getByRole("heading", { name: /^SRF-\d{4}-\d{6}$/u })).toBeVisible();
  await page.reload();
  await expect(page.getByText("已確認", { exact: true })).toBeVisible();
  expect((await supplier.credit()).body.data.availableAmount).toBe("2.5000");
  await page.getByRole("link", { name: supplier.number, exact: true }).click();
  await expect(page).toHaveURL(/\/ap\/credit-notes\/\d+$/u);
  await expect(page.getByRole("heading", { name: supplier.number, exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});

test("a lost rejection can be resolved by replay, then the amount can be corrected", async ({ page }) => {
  const source = await newSupplierCredit(), creditNoteId = (await source.credit()).body.data.id;
  const endpoint = "/api/v1/ap-supplier-refunds";
  const eventIds = [];
  const routePattern = "**" + endpoint;
  const path = request => new URL(request.url()).pathname;

  await signIn(page, token);
  await page.goto("/ap/refunds/new");
  await page.getByLabel(/來源貸項單/u).click();
  await page.getByRole("option", { name: new RegExp(source.number, "u") }).click();
  const amount = page.getByLabel(/退款金額/u);
  await amount.fill("7.50");
  await page.getByLabel(/退款方式/u).click();
  await page.getByRole("option", { name: "支票", exact: true }).click();

  // Another operator spends credit after this browser loaded the source balance.
  const competing = await post(endpoint, { creditNoteId, refundDate: today, amount: "5", paymentMethod: "CHEQUE" });
  expect(competing.status).toBe(200);
  expect((await post(`${endpoint}/${competing.body.data.id}/confirm`, { version: 1 })).status).toBe(200);
  const assertDefinitive = async (response) => {
    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe("REFUND_EXCEEDS_CREDIT");
  };
  page.on("request", request => {
    if (request.method() === "POST" && path(request) === endpoint) eventIds.push(request.postDataJSON().eventId);
  });
  await page.route(routePattern, async route => {
    await assertDefinitive(await route.fetch());
    await route.abort("failed");
  }, { times: 1 });

  await page.getByRole("button", { name: "建立草稿", exact: true }).click();
  await expect(page.getByText("建立結果尚未確認。", { exact: true })).toBeVisible();
  await expect(amount).toBeDisabled();
  const replay = page.waitForResponse(response => response.request().method() === "POST" && path(response) === endpoint);
  await page.getByRole("button", { name: "重試原操作", exact: true }).click();
  await assertDefinitive(await replay);

  await expect(page.getByText("建立結果尚未確認。", { exact: true })).toHaveCount(0);
  await expect(amount).toBeEditable();
  await expect(page.getByText("可退款金額 HKD 5.00", { exact: true })).toBeVisible();
  await amount.fill("5.00");
  await page.getByRole("button", { name: "建立草稿", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^草稿 #\d+$/u })).toBeVisible();
  expect(eventIds).toHaveLength(3);
  expect(eventIds[0]).toBe(eventIds[1]);
  expect(eventIds[2]).not.toBe(eventIds[1]);
  expect((await source.credit()).body.data.availableAmount).toBe("5.0000");
});
