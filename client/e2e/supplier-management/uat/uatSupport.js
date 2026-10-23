import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { API_URL, connect, readFixture } from "./uatEnvironment.mjs";

/**
 * UAT 測試共用：登入、前置資料、讀 scratch database 嘅結果。
 *
 * 使用者步驟同證據一律經畫面；database 只用嚟（一）核准登入設備，同 Item UAT 一樣係環境準備，
 * 唔係驗收步驟；（二）準備 07 §2 講嘅各狀態 Supplier 前置資料。
 */
let fixture;
let database;

export function uatFixture() {
  fixture ??= readFixture();
  return fixture;
}

export async function db() {
  database ??= await connect(uatFixture().database);
  return database;
}

export async function closeDb() {
  await database?.end();
  database = undefined;
}

export const unique = (prefix) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;

async function submitLogin(page, account) {
  await page.goto("/login");
  await page.getByLabel("帳號").fill(account.username);
  await page.getByLabel("密碼").fill(account.password);
  await page.getByRole("button", { name: "登入" }).click();
}

/** UI 登入；新設備要先核准（用 database，同 Item UAT 一樣），再登入一次。 */
export async function loginAs(page, role) {
  const account = uatFixture().users[role];
  if (!account) throw new Error(`no UAT account for ${role}`);
  await submitLogin(page, account);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  if (new URL(page.url()).pathname.startsWith("/device/pending")) {
    await (await db()).execute("UPDATE user_devices SET status = 'approved', reviewed_at = ?, review_note = ? WHERE user_id = ? AND status = 'pending'",
      [Date.now(), "Supplier UAT environment setup", account.id]);
    await submitLogin(page, account);
    await page.waitForURL((url) => !/^\/(login|device)/u.test(url.pathname));
  }
  return account;
}

/** 用登入咗嗰個人嘅 token 叫 API（只用嚟準備前置資料）。 */
export async function api(page, method, path, body) {
  const token = await page.evaluate(() => localStorage.getItem("erp.token"));
  const response = await page.request.fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID() },
    data: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await response.json().catch(() => null);
  if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${JSON.stringify(json?.error ?? json)}`);
  return json.data;
}

/** 經 API 開一個最低三欄嘅 Draft（07 §2 S-DRAFT），回 `{ id, supplierCode, supplierName }`。 */
export async function createDraft(page, { code = unique("UAT"), name = `UAT Supplier ${code}` } = {}) {
  const created = await api(page, "POST", "/api/v1/suppliers/create", { supplierCode: code, supplierName: name, defaultCurrencyCode: "HKD" });
  return { id: created.id, supplierCode: created.supplierCode, supplierName: name };
}

/** 收集 console error 同 4xx／5xx；`allow` 列出預期會出現嘅拒絕。登入之後先開始收：新設備登入嗰下嘅 403 係環境準備。 */
export function watchProblems(page, { allow = [] } = {}) {
  const problems = [];
  page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (!allow.some((rule) => rule.status === response.status() && url.pathname.endsWith(rule.path))) problems.push(`${response.status()} ${url.pathname}`);
  });
  return problems;
}

/** 喺 Audit 頁用「對象」篩選，回第一行嘅文字。 */
export async function auditRows(page, target) {
  await page.goto(`/suppliers/audit?target=${encodeURIComponent(target)}`);
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  return rows;
}
