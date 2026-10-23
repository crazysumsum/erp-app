import { randomUUID } from "node:crypto";
import path from "node:path";
import { test as base, chromium, devices } from "@playwright/test";
import { API_URL, CLIENT_URL, artifactsDirectory, connect, readFixture } from "./uatEnvironment.mjs";

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
  // 瀏覽器會為每個 4xx 再印一句「Failed to load resource」：預期嘅拒絕唔當問題。
  const expectedLoadFailure = (text) => allow.some((rule) => text.includes(`status of ${rule.status} `));
  page.on("console", (message) => {
    if (message.type() === "error" && !expectedLoadFailure(message.text())) problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (!allow.some((rule) => rule.status === response.status() && url.pathname.endsWith(rule.path))) problems.push(`${response.status()} ${url.pathname}`);
  });
  return problems;
}

/** 經 API 啟用（Approval OFF）：07 §2 嘅 S-ACTIVE 前置，亦令佢「曾啟用」。 */
export async function activateViaApi(page, id) {
  const current = await api(page, "GET", `/api/v1/suppliers/${id}`);
  return api(page, "POST", `/api/v1/suppliers/${id}/activate`, { version: current.version });
}

/** 07 §2 各狀態 Supplier 嘅前置資料：直接改狀態（Supplier 冇其他狀態欄位）。唔經使用者步驟，亦唔寫 Audit。 */
export async function setStatus(id, status) {
  await (await db()).execute("UPDATE suppliers SET status = ?, version = version + 1 WHERE id = ?", [status, id]);
}

export const statusBadge = (page) => page.locator("div.row.items-center", { hasText: "版本" }).locator(".q-badge").first();

/** 詳情頁狀態操作：撳按鈕、填原因／密碼、確認。 */
export async function statusAction(page, label, { reason, password } = {}) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (reason !== undefined) await dialog.getByLabel("原因 *").fill(reason);
  if (password !== undefined) await dialog.getByLabel("目前密碼 *").fill(password);
  await dialog.getByRole("button", { name: `確認${label}` }).click();
  return dialog;
}

/** 詳情頁「變更紀錄」tab 入面某個動作嗰行。 */
export async function auditRow(page, actionLabel) {
  await page.getByRole("tab", { name: "變更紀錄" }).click();
  return page.locator("tbody tr", { hasText: actionLabel });
}

/**
 * 喺頁面入面直接叫 client 嘅 service：同 UI 一樣用登入設備簽名，所以伺服器係以權限或者規則拒絕，
 * 唔係因為冇簽名。回 `ok`、`ok:<JSON>` 或者 `<HTTP status> <error code>`。
 */
export function moduleCall(page, modulePath, method, ...args) {
  return page.evaluate(async ({ modulePath: path, method: name, args: values }) => {
    const { default: service } = await import(path);
    try {
      const result = await service[name](...values);
      return result === undefined ? "ok" : `ok:${JSON.stringify(result)}`;
    } catch (error) {
      return `${error.status} ${error.code}`;
    }
  }, { modulePath, method, args });
}

export const serviceCall = async (page, method, ...args) => (await moduleCall(page, "/src/services/supplier.js", method, ...args)).replace(/^ok:.*/su, "ok");

/**
 * 登入有每 IP 每 10 分鐘 20 次嘅限流（loginHandler LOGIN_IP_LIMIT），而設備 key 係唔可匯出、擺喺 IndexedDB 嘅 CryptoKey，
 * 存唔到落 storageState。所以每個角色用一個 persistent browser profile：test 失敗令 worker 重開，profile 照樣保留
 * token 同設備 key，唔使再登入（REV-115 跑出嚟嘅 429）。Profile 放喺 evidence 目錄以外。
 * `as(role)` 回 `{ page, account }`；`{ session: 2 }` 係同一個人嘅第二個 browser（UAT-008）。
 */
export const test = base.extend({
  // Playwright 靠第一個參數嘅解構認 fixture 依賴；呢個 fixture 冇依賴。
  // eslint-disable-next-line no-empty-pattern
  sessions: [async ({}, use) => {
    const sessions = { byRole: new Map() };
    await use(sessions);
    for (const session of sessions.byRole.values()) await (await session).context.close();
    await closeDb();
  }, { scope: "worker" }],
  as: async ({ sessions }, use) => {
    const pages = [];
    await use(async (role, { session = 1 } = {}) => {
      const key = `${role}#${session}`;
      if (!sessions.byRole.has(key)) {
        sessions.byRole.set(key, (async () => {
          const { defaultBrowserType: _ignored, ...desktop } = devices["Desktop Chrome"];
          const context = await chromium.launchPersistentContext(path.join(artifactsDirectory, "profiles", key), { ...desktop, baseURL: CLIENT_URL });
          const page = await context.newPage();
          await page.goto("/");
          if (new URL(page.url()).pathname.startsWith("/login")) await loginAs(page, role);
          await page.close();
          return { context, account: uatFixture().users[role] };
        })());
      }
      const { context, account } = await sessions.byRole.get(key);
      const page = await context.newPage();
      pages.push(page);
      // 新分頁係 about:blank，讀唔到 app 嘅 localStorage（token）：先開 app。
      await page.goto("/");
      return { page, account };
    });
    for (const page of pages) await page.close();
  }
});
