import { expect, test } from "@playwright/test";

/**
 * TASK-047 嘅瀏覽器驗證：真 Quasar 密碼 dialog、真下載、伺服器定嘅檔名、console 同 network。
 * API 喺 network 層 mock（同本模組其他 spec 一樣，CI 冇後端）；真後端嘅流程另外用真 MySQL 驗過，見 T47 紀錄。
 */

const MANAGER = { id: 1, username: "export-manager", displayName: "Export Manager", roles: ["buyer"], permissions: ["supplier.view", "supplier.mgmt"] };
const VIEWER = { ...MANAGER, username: "export-viewer", permissions: ["supplier.view"] };
const PASSWORD = "browser-test-password";
const SUPPLIER = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen", defaultCurrencyCode: "HKD",
  defaultPaymentTermId: null, primaryContactName: "Amy Chan", status: "active", version: 2, updatedAt: 1_757_808_000_000
};
const FILE_NAME = "suppliers-20261006T070809Z.csv";

async function installApi(page, { user = MANAGER, tooLarge = false } = {}) {
  const state = { exports: [] };
  await page.addInitScript(() => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
  });
  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5203",
      "access-control-expose-headers": "Content-Disposition" };
    const ok = (data) => route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "pw" } }) });
    const fail = (status, code, message) => route.fulfill({ status, headers,
      body: JSON.stringify({ success: false, error: { code, message }, meta: { requestId: "pw" } }) });

    if (url.pathname === "/api/v1/user/me") return ok(user);
    if (request.method() === "GET" && url.pathname === "/api/v1/suppliers") return ok({ items: [SUPPLIER], total: 1, page: 1, pageSize: 20 });
    if (request.method() === "POST" && url.pathname === "/api/v1/supplier-exports") {
      const body = request.postDataJSON();
      state.exports.push({ body, authorization: request.headers().authorization });
      if (body.password !== PASSWORD) return fail(403, "PASSWORD_INVALID", "Please confirm your current password");
      if (tooLarge) return fail(422, "SUPPLIER_EXPORT_TOO_LARGE", "一次最多匯出 10000 個供應商，請收窄篩選條件");
      return route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${FILE_NAME}"; filename*=UTF-8''${FILE_NAME}`, "cache-control": "private, no-store" },
      body: "﻿supplierId,supplierCode\r\n7,SUP-007\r\n" });
    }
    return fail(404, "NOT_FOUND", `unrouted ${request.method()} ${url.pathname}`);
  });
  return state;
}

function collectProblems(page) {
  const problems = [];
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") problems.push(message.text()); });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => problems.push(`requestfailed: ${request.url()}`));
  return problems;
}

async function enterPassword(page, password) {
  const dialog = page.locator(".q-dialog").filter({ has: page.locator("input[type=password]") });
  await expect(dialog).toBeVisible();
  await dialog.locator("input[type=password]").fill(password);
  await dialog.getByRole("button", { name: "匯出" }).click();
}

test("@technical export the current search, status and sort after the password, under the server's file name", async ({ page }) => {
  const problems = collectProblems(page);
  const state = await installApi(page);
  await page.goto("/suppliers?q=ever&status=active&sortBy=supplierName&descending=false");
  await expect(page.getByText("SUP-007")).toBeVisible();

  await page.getByRole("button", { name: "匯出 CSV" }).click();
  await enterPassword(page, "wrong-password");
  await expect(page.getByText("請確認你目前的密碼")).toBeVisible();
  await expect(page).toHaveURL(/\/suppliers\?/u);
  await expect(page.getByText("SUP-007")).toBeVisible();

  await page.getByRole("button", { name: "匯出 CSV" }).click();
  const download = page.waitForEvent("download");
  await enterPassword(page, PASSWORD);
  expect((await download).suggestedFilename()).toBe(FILE_NAME);

  expect(state.exports.map((call) => call.body)).toEqual([
    { password: "wrong-password", filters: { q: "ever", status: "active", sortBy: "supplierName", descending: false } },
    { password: PASSWORD, filters: { q: "ever", status: "active", sortBy: "supplierName", descending: false } }
  ]);
  expect(state.exports.every((call) => call.authorization === "Bearer browser-test-token")).toBe(true);
  expect(problems.filter((problem) => !/403/u.test(problem))).toEqual([]);
});

test("@technical too many rows explains how to narrow the export; cancelling sends nothing", async ({ page }) => {
  const problems = collectProblems(page);
  const state = await installApi(page, { tooLarge: true });
  await page.goto("/suppliers");
  await expect(page.getByText("SUP-007")).toBeVisible();

  await page.getByRole("button", { name: "匯出 CSV" }).click();
  await page.locator(".q-dialog").getByRole("button", { name: "取消" }).click();
  expect(state.exports).toEqual([]);

  await page.getByRole("button", { name: "匯出 CSV" }).click();
  await enterPassword(page, PASSWORD);
  await expect(page.getByText("一次最多匯出 10000 個供應商，請收窄篩選條件")).toBeVisible();
  expect(problems.filter((problem) => !/422/u.test(problem))).toEqual([]);
});

test("@technical a supplier.view user has no export button", async ({ page }) => {
  await installApi(page, { user: VIEWER });
  await page.goto("/suppliers");
  await expect(page.getByText("SUP-007")).toBeVisible();
  await expect(page.getByRole("button", { name: "匯出 CSV" })).toHaveCount(0);
});
