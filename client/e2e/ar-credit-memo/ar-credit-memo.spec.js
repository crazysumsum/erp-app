import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { expect, test } from "@playwright/test";
import "../../../server/test-support/testEnv.js";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";
import { migrateArShipmentFixture } from "../../../server/test/ar/arShipmentFixture.js";
import { shipmentTwoLineFixture } from "../../../server/test/fulfillment/p1CancellationFixture.js";

const clientOrigin = `http://127.0.0.1:${process.env.AR_TEST_CLIENT_PORT}`;
const creditsPath = "/ar/credit-notes";
const apiPath = "/api/v1/ar-credit-notes";
const cleanup = [];
let data;

async function insert(db, table, row) {
  const [{ insertId }] = await db.query(`INSERT INTO ${table} SET ?`, [row]);
  return Number(insertId);
}

async function issueActor(app, db, granted, now) {
  const name = `arc-browser-${randomUUID()}`;
  const roleId = await insert(db, "roles", { name, created_at: now });
  const actorId = await insert(db, "users", {
    username: name, display_name: name, password_hash: "synthetic-only", created_at: now, updated_at: now
  });
  await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [actorId, roleId]);
  const [{ affectedRows }] = await db.query(
    "INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?)", [roleId, granted]);
  assert.equal(affectedRows, granted.length);
  const subject = String(actorId), version = await app.services.require("tokenRevocation").currentVersion(subject);
  return app.services.require("jwt").issue({ roles: [name], permissions: granted },
    { subject, version, authTime: Math.floor(now / 1000) });
}

async function postSetup(url, token, path, fields) {
  const eventId = randomUUID();
  const response = await fetch(new URL(path, url), { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": eventId },
    body: JSON.stringify({ ...fields, eventId })
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.data;
}

test.beforeAll(async () => {
  const fixture = await shipmentTwoLineFixture({ after: (callback) => cleanup.push(callback) });
  const { db, connectionOptions, name } = fixture.f;
  await migrateArShipmentFixture(db);
  await fixture.s.insert("customer_address_purposes", {
    address_id: fixture.s.addressId, customer_id: fixture.s.customerId, purpose_code: "billing",
    is_default: 1, created_at: fixture.s.now, updated_at: fixture.s.now
  });

  // The first line ships 3 of 5 units, the second ships 2 of 2. Both invoice
  // lines are 0.0149 and the invoice total rounds to 0.03 at two decimal places.
  const [first, second] = fixture.sources;
  await db.query("UPDATE sales_order_lines SET line_amount = 0.0248 WHERE id = ?", [first.salesOrderLineId]);
  await db.query("UPDATE sales_order_lines SET line_amount = 0.0149 WHERE id = ?", [second.salesOrderLineId]);
  assert.equal((await fixture.confirm()).outcome, "SHIPPED");

  const defaults = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: {
    ...defaults,
    application: { ...defaults.application, host: "127.0.0.1", port: Number(process.env.AR_TEST_API_PORT) },
    database: { ...defaults.database, ...connectionOptions, database: name, multipleStatements: false },
    security: { ...defaults.security, cors: { ...defaults.security.cors, allowedOrigins: clientOrigin } },
    scheduler: { ...defaults.scheduler, jobs: {} }
  } });
  cleanup.push(() => app.shutdown("ar_credit_memo_browser_complete"));
  const { url } = await app.start();
  const time = app.services.require("time"), now = time.nowMs();
  const operator = await issueActor(app, db, ["ar.view", "ar.credit.mgmt", "ar.invoice.mgmt"], now);
  const viewer = await issueActor(app, db, ["ar.view"], now);
  const today = time.fileDate(time.at(now));
  const regularDraft = await postSetup(url, operator, "/api/v1/ar-invoices", { shipmentIds: [Number(fixture.draft.outcome.id)], dueDate: today });
  const regularInvoice = await postSetup(url, operator, `/api/v1/ar-invoices/${regularDraft.id}/confirm`, { version: regularDraft.version });
  const [regularLines] = await db.query("SELECT line_no, line_amount FROM ar_invoice_lines WHERE invoice_id = ? ORDER BY line_no", [regularInvoice.id]);
  const [[{ currency_code: regularCurrency }]] = await db.query("SELECT currency_code FROM ar_invoices WHERE id = ?", [regularInvoice.id]);
  assert.deepEqual(regularLines.map(({ line_no, line_amount }) => [line_no, line_amount]), [[1, "0.0149"], [2, "0.0149"]]);
  assert.equal(regularDraft.totalAmount, "0.0300");

  const tag = randomUUID().slice(0, 8), code = `ARC-${tag}`, customerName = `Credit memo browser ${tag}`;
  const customerId = await insert(db, "customers", {
    customer_code: code, customer_code_key: code.toLowerCase(), legal_name: customerName, legal_name_key: customerName.toLowerCase(),
    default_currency_code: "HKD", status: "active", version: 1, created_at: now, updated_at: now
  });
  async function openingInvoice(kind, total, allocated, outstanding) {
    const number = `T${tag}-${kind}`;
    const id = await insert(db, "ar_invoices", {
      invoice_number: number, opening_reference: number, active_opening_reference: number, status: "CONFIRMED", customer_id: customerId,
      customer_code_snapshot: code, customer_name_snapshot: customerName, currency_code: "HKD", currency_decimal_places: 2,
      invoice_date: today, due_date: today, total_amount: total, allocated_amount: allocated, outstanding_amount: outstanding,
      created_by_label: "fixture", created_at: now, updated_at: now
    });
    return { id, number };
  }
  data = { operator, viewer, regularInvoice, regularCurrency,
    origin: await openingInvoice("ORIGIN", "100.0000", "65.0000", "35.0000"),
    target: await openingInvoice("TARGET", "60.0000", "0.0000", "60.0000"),
    cancelSource: await openingInvoice("CANCEL", "30.0000", "0.0000", "30.0000") };
});

test.afterAll(async () => {
  const failures = [];
  for (const close of cleanup.reverse()) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "AR browser fixture cleanup failed");
});

function observe(page) {
  const observed = { errors: [], console: [], responses: [], failed: [] };
  page.on("pageerror", (error) => observed.errors.push(error.message));
  page.on("console", (entry) => {
    if (["error", "warning"].includes(entry.type())) observed.console.push(entry.text());
  });
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/api/v1/") && response.status() >= 400) observed.responses.push([response.status(), pathname]);
  });
  page.on("requestfailed", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/v1/") && request.failure()?.errorText !== "net::ERR_ABORTED") {
      observed.failed.push([request.failure()?.errorText, pathname]);
    }
  });
  return observed;
}

function expectBrowserClean(observed, expectedResponses = []) {
  expect(observed.errors).toEqual([]);
  expect(observed.failed).toEqual([]);
  expect(observed.responses).toEqual(expectedResponses);
  const unexpected = expectedResponses.length
    ? observed.console.filter((message) => !/^Failed to load resource: .*\b409\b/u.test(message))
    : observed.console;
  expect(unexpected).toEqual([]);
}

async function signIn(page, token) {
  await page.goto(`${clientOrigin}/login`);
  await page.evaluate(async (value) => {
    const { setToken } = await import("/src/framework/auth/tokenStorage.js");
    setToken(value, 900, 3600);
  }, token);
}

const heading = (page, name) => page.getByRole("heading", { level: 1, name, exact: true });
const amountField = (page, currency = "HKD") => page.getByLabel(`貸項金額（${currency}，必填）`, { exact: true });
const saveDraft = (page) => page.getByRole("button", { name: "儲存草稿", exact: true }).click();
const availableAmount = (page) => page.locator("dl > div").filter({ has: page.getByText("可用額", { exact: true }) });
const waitForCommand = (page, path) => page.waitForResponse((response) =>
  new URL(response.url()).pathname === apiPath + path && response.request().method() === "POST");
async function clickAndConfirm(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
}

test("creates, edits, confirms, applies, unapplies and voids an opening invoice credit", async ({ page, browser }) => {
  const observed = observe(page);
  await signIn(page, data.operator);
  await page.goto(`/ar/invoices/${data.origin.id}`);
  await expect(heading(page, data.origin.number)).toBeVisible();
  await page.getByRole("link", { name: "開立貸項單", exact: true }).click();
  await expect(heading(page, "新增應收貸項單")).toBeVisible();
  await expect(page.getByText("期初發票貸項", { exact: true })).toBeVisible();
  await page.getByLabel("原因（必填）", { exact: true }).fill("Synthetic opening credit");
  await amountField(page).fill("49.001");
  await saveDraft(page);
  await expect(page.getByRole("alert")).toContainText("核對第 1 行");
  const created = waitForCommand(page, "");
  await amountField(page).fill("49.00");
  await saveDraft(page);
  const response = await created;
  expect(response.status()).toBe(200);
  const { id } = (await response.json()).data;
  await expect(page).toHaveURL(new RegExp(`/ar/credit-notes/${id}$`, "u"));
  await expect(page.getByText("版本 1", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "編輯草稿", exact: true }).click();
  await expect(heading(page, "編輯貸項草稿")).toBeVisible();
  await expect(amountField(page)).toHaveValue("49.00");
  await amountField(page).fill("50.00");
  await saveDraft(page);
  await expect(page.getByText("版本 2", { exact: true })).toBeVisible();
  const confirmation = waitForCommand(page, `/${id}/confirm`);
  await clickAndConfirm(page, "確認貸項單");
  const confirmed = await confirmation;
  expect(confirmed.status()).toBe(200);
  const { number } = (await confirmed.json()).data;
  await expect(heading(page, number)).toBeVisible();
  const available = availableAmount(page);
  await expect(available).toContainText("HKD 15.00");

  await page.goto(`/ar/invoices/${data.origin.id}`);
  await expect(page.getByRole("heading", { name: "貸項核銷記錄" })).toBeVisible();
  await page.getByRole("link", { name: number, exact: true }).click();
  const gate = Promise.withResolvers();
  await page.route(`**${apiPath}/${id}`, async (route) => {
    await gate.promise;
    await route.continue();
  }, { times: 1 });
  try {
    await page.reload();
    await expect(page.getByLabel("載入貸項單", { exact: true })).toBeVisible();
  } finally { gate.resolve(); }
  await expect(heading(page, number)).toBeVisible();
  const picker = page.getByLabel("核銷發票（同客戶及幣別）", { exact: true });
  await picker.fill(data.target.number);
  await page.getByRole("option", { name: new RegExp(`^${data.target.number} — `, "u") }).click();
  const appliedAmount = page.getByLabel("核銷金額（必填）", { exact: true });
  await appliedAmount.fill("16");
  await page.getByRole("button", { name: "執行核銷", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("核銷金額不可超過");
  await appliedAmount.fill("10");
  await page.getByRole("button", { name: "執行核銷", exact: true }).click();
  await expect(available).toContainText("HKD 5.00");
  await expect(page.getByRole("button", { name: "作廢貸項單" })).toHaveCount(0);
  await page.getByRole("button", { name: `解除核銷 ${data.target.number}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "解除核銷", exact: true }).click();
  await expect(available).toContainText("HKD 15.00");
  await expect(page.getByText("已解除", { exact: true })).toBeVisible();

  const viewer = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const view = await viewer.newPage(), viewerObserved = observe(view);
    await signIn(view, data.viewer);
    await view.goto(`${clientOrigin}${creditsPath}/${id}`);
    await expect(heading(view, number)).toBeVisible();
    await expect(view.getByRole("button", { name: "作廢貸項單" })).toHaveCount(0);
    await expect(view.getByRole("region", { name: "貸項明細" })).toHaveAttribute("tabindex", "0");
    await expect.poll(() => view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expectBrowserClean(viewerObserved);
  } finally { await viewer.close(); }

  await page.getByRole("button", { name: "作廢貸項單", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Synthetic void reason");
  await page.getByRole("dialog").getByRole("button", { name: "作廢", exact: true }).click();
  await expect(page.getByText("已作廢", { exact: true })).toBeVisible();
  await expect(available).toContainText("HKD 0.00");
  await page.getByRole("link", { name: "返回貸項單列表", exact: true }).click();
  await expect(heading(page, "應收貸項單")).toBeVisible();
  const search = page.getByLabel("貸項單編號或客戶", { exact: true });
  await search.fill(number);
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  await expect(page.getByRole("link", { name: number, exact: true })).toBeVisible();
  await search.fill("DOES-NOT-EXIST-ARC");
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  await expect(page.getByText("沒有符合條件的貸項單。", { exact: true })).toBeVisible();
  expectBrowserClean(observed);
});

test("creates a draft from the list with the invoice picker, then cancels it", async ({ page }) => {
  const observed = observe(page);
  await signIn(page, data.operator);
  await page.goto(creditsPath);
  await page.getByRole("link", { name: "新增貸項單", exact: true }).click();
  const picker = page.getByLabel("原發票（可按編號或客戶搜尋）", { exact: true });
  await picker.fill(data.cancelSource.number);
  await page.getByRole("option", { name: new RegExp(`^${data.cancelSource.number} — `, "u") }).click();
  await expect(page.getByText("期初發票貸項", { exact: true })).toBeVisible();
  await page.getByLabel("原因（必填）", { exact: true }).fill("Synthetic cancelled draft");
  await amountField(page).fill("5");
  await saveDraft(page);
  await expect(page).toHaveURL(/\/ar\/credit-notes\/\d+$/u);
  await clickAndConfirm(page, "取消草稿");
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "確認貸項單", exact: true })).toHaveCount(0);
  expectBrowserClean(observed);
});

test("a read-only user has no credit-note create actions", async ({ page }) => {
  const observed = observe(page);
  await signIn(page, data.viewer);
  await page.goto(creditsPath);
  await expect(heading(page, "應收貸項單")).toBeVisible();
  await expect(page.getByRole("link", { name: "新增貸項單", exact: true })).toHaveCount(0);
  await page.goto(`/ar/invoices/${data.origin.id}`);
  await expect(heading(page, data.origin.number)).toBeVisible();
  await expect(page.getByRole("link", { name: "開立貸項單", exact: true })).toHaveCount(0);
  expectBrowserClean(observed);
});

test("selects a regular invoice line, rejects the rounded-up excess and confirms the corrected credit", async ({ page }) => {
  const observed = observe(page);
  await signIn(page, data.operator);
  await page.goto(`/ar/invoices/${data.regularInvoice.id}`);
  await expect(heading(page, data.regularInvoice.number)).toBeVisible();
  await page.getByRole("link", { name: "開立貸項單", exact: true }).click();
  await page.getByLabel("原因（必填）", { exact: true }).fill("Synthetic second invoice line credit");
  const line = page.getByLabel("發票行（必填）", { exact: true });
  await line.click();
  const second = page.getByRole("option", { name: /^2\. /u });
  const secondLabel = await second.textContent();
  await second.click();
  const amount = amountField(page, data.regularCurrency);
  await amount.fill("0.02");
  const rejected = waitForCommand(page, "");
  await saveDraft(page);
  const conflict = await rejected;
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).error.code).toBe("AR_CREDIT_LIMIT_EXCEEDED");
  await expect(page.getByRole("alert")).toContainText("剩餘可貸金額");
  await expect(amount).toHaveValue("0.02");

  await amount.fill("0.01");
  const accepted = waitForCommand(page, "");
  await saveDraft(page);
  const saved = await accepted;
  expect(saved.status()).toBe(200);
  const { id } = (await saved.json()).data;
  await expect(page).toHaveURL(new RegExp(`/ar/credit-notes/${id}$`, "u"));
  await expect(page.getByRole("region", { name: "貸項明細" })).toContainText(secondLabel.replace(/^2\. /u, "").split("（")[0]);
  await clickAndConfirm(page, "確認貸項單");
  await expect(page.getByRole("heading", { level: 1, name: /^CRN-\d{4}-\d{6}$/u })).toBeVisible();
  const applications = page.getByRole("region", { name: "貸項核銷" });
  await expect(applications.getByRole("cell", { name: "原發票沖減", exact: true })).toBeVisible();
  await expect(applications.getByRole("cell", { name: `${data.regularCurrency} 0.01`, exact: true })).toBeVisible();
  expectBrowserClean(observed, [[409, apiPath]]);
});
