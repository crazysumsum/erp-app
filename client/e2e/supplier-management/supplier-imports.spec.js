import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

/**
 * TASK-046 嘅瀏覽器驗證：真 Quasar dialog、真檔案上載、真下載、重新整理、console 同 network。
 * API 喺 network 層 mock（同本模組其他 spec 一樣，CI 冇後端）；真後端嘅端對端流程另外用真 MySQL 驗過，
 * 見 implementation 嘅 T46 紀錄。
 */

const MANAGER = { id: 1, username: "import-manager", displayName: "Import Manager", roles: ["buyer"], permissions: ["supplier.mgmt"] };
const PASSWORD = "browser-test-password";

function baseJob(overrides = {}) {
  return {
    id: 7, templateVersion: "v1", mode: "create_only", activationMode: null, status: "uploaded", totalCount: 0, validCount: 0,
    warningCount: 0, invalidCount: 0, appliedCount: 0, failedCount: 0, skippedCount: 0, lastErrorCode: "", errorSummary: "",
    filesPurged: false, createdAt: 1_757_808_000_000, updatedAt: 1_757_808_000_000, confirmedAt: null, completedAt: null, version: 1,
    ...overrides
  };
}

const PRECHECK_ROWS = [
  { rowNumber: 1, operation: "create", status: "valid", matchSupplierId: null, appliedSupplierId: null, normalizedPayload: {}, errors: [], warnings: [] },
  { rowNumber: 2, operation: "create", status: "invalid", matchSupplierId: null, appliedSupplierId: null, normalizedPayload: {},
    errors: [{ field: "defaultCurrencyCode", code: "SUPPLIER_IMPORT_REQUIRED_FIELD", message: "新增供應商必須填寫 defaultCurrencyCode" }], warnings: [] }
];

async function installApi(page, options = {}) {
  const state = {
    job: options.job ?? null,
    rows: options.rows ?? [],
    polls: 0,
    approvalOn: options.approvalOn ?? false,
    resultExpired: options.resultExpired ?? false,
    calls: []
  };

  await page.addInitScript(() => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
  });

  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const isJson = (request.headers()["content-type"] ?? "").includes("application/json");
    const body = isJson ? request.postDataJSON() : null;
    state.calls.push({ method, path, query: Object.fromEntries(url.searchParams), body, headers: request.headers() });
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5203",
      "access-control-expose-headers": "content-disposition" };
    const ok = (data, status = 200) => route.fulfill({ status, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "pw" } }) });
    const fail = (status, code, message) => route.fulfill({ status, headers,
      body: JSON.stringify({ success: false, error: { code, message }, meta: { requestId: "pw" } }) });

    if (path === "/api/v1/user/me") return ok(MANAGER);
    if (path === "/api/v1/supplier-lookups/activation-policy") return ok({ requireActivationApproval: state.approvalOn });
    if (path === "/api/v1/supplier-approvers") return ok({ items: [{ id: 5, username: "approver", displayName: "Approver Five" }] });
    if (method === "GET" && path === "/api/v1/supplier-imports/template") {
      return route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=\"supplier-import-template-v1.csv\"" }, body: "﻿supplierCode\r\n" });
    }
    if (method === "POST" && path === "/api/v1/supplier-imports/upload") {
      state.job = baseJob();
      state.rows = [];
      return ok(state.job, 201);
    }
    if (method === "GET" && path === "/api/v1/supplier-imports") {
      return ok({ items: state.job ? [state.job] : [], total: state.job ? 1 : 0, page: 1, pageSize: 20 });
    }
    if (method === "GET" && path === "/api/v1/supplier-imports/7") {
      state.polls += 1;
      // 背景做緊嘢：每次 poll 行一步。
      if (state.job.status === "uploaded" && state.polls >= 2) {
        state.job = { ...state.job, status: "ready_with_errors", totalCount: 2, validCount: 1, invalidCount: 1, version: 3 };
        state.rows = PRECHECK_ROWS;
      } else if (state.job.status === "queued") {
        state.job = { ...state.job, status: "running" };
      } else if (state.job.status === "running") {
        state.job = { ...state.job, status: "completed", appliedCount: 1, skippedCount: 1, completedAt: Date.now(), version: state.job.version + 2 };
        state.rows = [{ ...PRECHECK_ROWS[0], status: "applied", appliedSupplierId: 41 }, { ...PRECHECK_ROWS[1], status: "skipped" }];
      }
      const rowStatus = url.searchParams.get("rowStatus");
      const rowNumber = url.searchParams.get("rowNumber");
      const rows = ["uploaded", "validating"].includes(state.job.status) ? [] : state.rows
        .filter((row) => !rowStatus || row.status === rowStatus)
        .filter((row) => !rowNumber || row.rowNumber === Number(rowNumber));
      return ok({ job: state.job, rows, total: rows.length, page: 1, pageSize: 20 });
    }
    if (method === "POST" && path === "/api/v1/supplier-imports/7/confirm") {
      if (body.password !== PASSWORD) return fail(403, "PASSWORD_INVALID", "Please confirm your current password");
      if (state.approvalOn && body.activationMode === "activate" && !body.approverUserId) return fail(400, "APPROVER_REQUIRED", "目前設定需要指定審批人");
      state.job = { ...state.job, status: "queued", activationMode: body.activationMode, confirmedAt: Date.now(), version: state.job.version + 1 };
      return ok(state.job);
    }
    if (method === "GET" && path === "/api/v1/supplier-imports/7/result") {
      if (state.resultExpired) return fail(410, "IMPORT_FILE_EXPIRED", "匯入結果已過保留期限；工作摘要及逐列結果仍可查閱");
      return route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=\"supplier-import-7-result.csv\"", "cache-control": "private, no-store" },
      body: "﻿rowNumber,operation,outcome\r\n1,create,applied\r\n2,create,skipped\r\n" });
    }
    return fail(404, "NOT_FOUND", `unrouted ${method} ${path}`);
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
  await dialog.getByRole("button", { name: "確認匯入" }).click();
}

test("@technical upload, precheck, confirm with the password, follow progress and download the result", async ({ page }) => {
  const problems = collectProblems(page);
  const state = await installApi(page);
  await page.goto("/suppliers/imports");

  const template = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載範本" }).click();
  expect((await template).suggestedFilename()).toBe("supplier-import-template-v1.csv");

  await page.getByRole("button", { name: "上載 CSV" }).click();
  await page.locator(".q-dialog input[type=file]").setInputFiles({ name: "suppliers.csv", mimeType: "text/csv", buffer: Buffer.from("supplierCode\r\nS-1\r\n") });
  await page.locator(".q-dialog").getByRole("button", { name: "上載", exact: true }).click();

  await expect(page.getByRole("heading", { name: "匯入工作 #7" })).toBeVisible();
  await expect(page).toHaveURL(/job=7/u);
  await expect(page.locator(".q-dialog").getByText("待確認（有錯誤列）")).toBeVisible();
  await expect(page.getByText("新增供應商必須填寫 defaultCurrencyCode")).toBeVisible();
  await expect(page.getByText("審批設定以確認當刻為準")).toBeVisible();
  const upload = state.calls.find((call) => call.path === "/api/v1/supplier-imports/upload");
  expect(upload.headers["idempotency-key"]).toBeTruthy();

  await page.getByRole("button", { name: "確認匯入" }).click();
  await enterPassword(page, PASSWORD);
  await expect(page.locator(".q-dialog").getByText("已完成", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("job-counts")).toContainText("已寫入 1");

  const confirm = state.calls.find((call) => call.path === "/api/v1/supplier-imports/7/confirm");
  expect(confirm.body).toEqual({ version: 3, activationMode: "draft", approverUserId: null, password: PASSWORD });
  expect(confirm.headers["idempotency-key"]).toBeTruthy();

  const result = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載結果" }).click();
  const file = await result;
  expect(file.suggestedFilename()).toBe("supplier-import-7-result.csv");
  // 密碼只喺確認請求入面出現。
  expect(state.calls.filter((call) => JSON.stringify([call.query, call.body]).includes(PASSWORD)).map((call) => call.path))
    .toEqual(["/api/v1/supplier-imports/7/confirm"]);
  expect(problems).toEqual([]);
});

test("@technical a wrong password leaves the job ready, and a refresh reopens the job without resending confirm", async ({ page }) => {
  const problems = collectProblems(page);
  const state = await installApi(page, { job: baseJob({ status: "ready_with_errors", totalCount: 2, validCount: 1, invalidCount: 1, version: 3 }),
    rows: PRECHECK_ROWS });
  await page.goto("/suppliers/imports?job=7");
  await expect(page.getByRole("heading", { name: "匯入工作 #7" })).toBeVisible();

  await page.getByRole("button", { name: "確認匯入" }).click();
  await enterPassword(page, "not-the-password");
  await expect(page.locator(".q-notification")).toBeVisible();
  await expect(page.locator(".q-dialog").getByText("待確認（有錯誤列）")).toBeVisible();

  const confirmsBefore = state.calls.filter((call) => call.path.endsWith("/confirm")).length;
  await page.reload();
  await expect(page.getByRole("heading", { name: "匯入工作 #7" })).toBeVisible();
  await expect(page.getByText("新增供應商必須填寫 defaultCurrencyCode")).toBeVisible();
  expect(state.calls.filter((call) => call.path.endsWith("/confirm")).length).toBe(confirmsBefore);

  await page.getByLabel("行號").fill("2");
  await expect.poll(() => state.calls.filter((call) => call.query.rowNumber === "2").length).toBeGreaterThan(0);
  // 錯密碼嗰個 403 係預期嘅；其餘唔可以有 console 錯誤。
  expect(problems.filter((problem) => !problem.includes("403"))).toEqual([]);
});

test("@technical with approval on, activating asks for an approver and sends the chosen one", async ({ page }) => {
  const state = await installApi(page, { approvalOn: true,
    job: baseJob({ status: "ready", totalCount: 1, validCount: 1, version: 3 }), rows: [PRECHECK_ROWS[0]] });
  await page.goto("/suppliers/imports?job=7");
  await page.getByLabel("新增供應商狀態").click();
  await page.getByRole("option", { name: "啟用" }).click();
  await expect(page.getByText("會以待審批狀態送交所選審批人")).toBeVisible();
  await page.getByRole("button", { name: "確認匯入" }).click();
  await expect(page.getByText("目前設定要求審批，請選擇審批人")).toBeVisible();
  await page.getByLabel("審批人").click();
  await page.getByRole("option", { name: "Approver Five（approver）" }).click();
  await page.getByRole("button", { name: "確認匯入" }).click();
  await enterPassword(page, PASSWORD);
  await expect.poll(() => state.calls.find((call) => call.path.endsWith("/confirm"))?.body).toMatchObject({ activationMode: "activate", approverUserId: 5 });
  const lookup = state.calls.find((call) => call.path === "/api/v1/supplier-approvers");
  expect(lookup.query.excludeUserId).toBe("1");
});

test("@technical an expired result says the summary stays, and the 410 is explained", async ({ page }) => {
  const state = await installApi(page, { resultExpired: true,
    job: baseJob({ status: "completed", totalCount: 1, validCount: 1, appliedCount: 1, confirmedAt: 1, version: 6 }),
    rows: [{ ...PRECHECK_ROWS[0], status: "applied", appliedSupplierId: 41 }] });
  await page.goto("/suppliers/imports?job=7");
  await page.getByRole("button", { name: "下載結果" }).click();
  await expect(page.getByText("結果已過保留期限；工作摘要及逐列結果仍可在此查閱")).toBeVisible();
  await expect(page.getByText("已寫入", { exact: true })).toBeVisible();
  state.job = { ...state.job, filesPurged: true };
  await page.reload();
  await expect(page.getByText("結果已過保留期限（摘要仍可查閱）")).toBeVisible();
  await expect(page.getByRole("button", { name: "下載結果" })).toHaveCount(0);
});

test("@technical the details button opens the job and keeps it in the URL; closing removes it", async ({ page }) => {
  const problems = collectProblems(page);
  await installApi(page, { job: baseJob({ status: "ready", totalCount: 1, validCount: 1, version: 3 }), rows: [PRECHECK_ROWS[0]] });
  await page.goto("/suppliers/imports");
  await page.getByRole("button", { name: "工作 #7 的詳情" }).click();
  // Quasar 預設一轉 route 就收埋 dialog；開詳情會寫 ?job=，所以要 no-route-dismiss。
  await expect(page.getByRole("heading", { name: "匯入工作 #7" })).toBeVisible();
  await expect(page).toHaveURL(/job=7/u);
  await page.locator(".q-dialog").getByRole("button", { name: "關閉" }).click();
  await expect(page.getByRole("heading", { name: "匯入工作 #7" })).toBeHidden();
  await expect(page).not.toHaveURL(/job=/u);
  expect(problems).toEqual([]);
});
