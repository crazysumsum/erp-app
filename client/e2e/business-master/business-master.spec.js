import { expect, test } from "@playwright/test";

const ACTIVE_USER = {
  id: 1,
  username: "business-master-admin",
  displayName: "Business Master Admin",
  roles: ["system-admin"],
  permissions: ["business_master.view", "business_master.mgmt"]
};

const HKD = {
  code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2,
  status: "ACTIVE", version: 1, createdAt: 1_757_808_000_000, updatedAt: 1_757_808_000_000
};
const NET30 = {
  id: 1, code: "NET30", name: "30 日", description: "發票後 30 日",
  calculationType: "NET_DAYS", dueDays: 30, status: "ACTIVE", version: 1,
  createdAt: 1_757_808_000_000, updatedAt: 1_757_808_000_000
};
const REQUIRED_CHECKERS = ["customer", "supplier", "sales", "purchasing", "ar", "ap"];

async function installApi(page, options = {}) {
  const state = {
    currencies: options.emptyCurrencies ? [] : [{ ...HKD }],
    terms: [{ ...NET30 }],
    impactStatus: options.impactStatus ?? "READY",
    conflictOnce: options.conflictOnce ?? false,
    user: options.user ?? ACTIVE_USER,
    calls: []
  };
  let currencyListFailures = options.currencyListFailures ?? 0;
  let deactivateNetworkFailures = options.deactivateNetworkFailures ?? 0;

  await page.addInitScript(({ user, authenticated }) => {
    if (authenticated) {
      localStorage.setItem("erp.token", "browser-test-token");
      localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
      localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    }
    window.__businessMasterUser = user;
  }, { user: state.user, authenticated: options.authenticated !== false });

  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = request.postDataJSON?.() ?? null;
    state.calls.push({ method, path, body, headers: request.headers() });
    const headers = {
      "content-type": "application/json",
      "access-control-allow-origin": "http://127.0.0.1:5202"
    };
    const ok = (data, status = 200) => route.fulfill({ status, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "pw-request" } }) });
    const fail = (status, code, message) => route.fulfill({ status, headers, body: JSON.stringify({ success: false, error: { code, message }, meta: { requestId: "pw-request" } }) });

    if (path === "/api/v1/user/me") return ok(state.user);
    if (method === "GET" && path === "/api/v1/business-master/currencies") {
      if (currencyListFailures > 0) {
        currencyListFailures -= 1;
        return fail(503, "SERVICE_UNAVAILABLE", "Service unavailable");
      }
      const q = url.searchParams.get("q")?.toLowerCase();
      const status = url.searchParams.get("status");
      const items = state.currencies.filter((row) => (!q || `${row.code} ${row.name}`.toLowerCase().includes(q)) && (!status || row.status === status));
      return ok({ items, total: items.length, page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 20) });
    }
    if (method === "POST" && path === "/api/v1/business-master/currencies") {
      const created = { ...body, status: "ACTIVE", version: 1, createdAt: Date.now(), updatedAt: Date.now() };
      state.currencies.push(created);
      return ok(created, 201);
    }
    if (method === "PATCH" && /^\/api\/v1\/business-master\/currencies\/[^/]+$/.test(path)) {
      if (state.conflictOnce) {
        state.conflictOnce = false;
        return fail(409, "VERSION_CONFLICT", "Data changed");
      }
      const row = state.currencies.find((item) => path.endsWith(`/${item.code}`));
      Object.assign(row, { name: body.name, version: row.version + 1, updatedAt: Date.now() });
      return ok(row);
    }
    if (method === "POST" && path.endsWith("/impact-preview")) {
      const entityType = path.includes("payment-terms") ? "PAYMENT_TERM" : "CURRENCY";
      const entityKey = path.split("/").at(-2);
      return ok({
        actorId: 1, entityType, entityKey, version: body.version, operation: body.operation,
        proposedChange: body.operation === "DEACTIVATE" ? { status: "INACTIVE" } : body.proposedChange,
        issuedAt: Date.now(), expiresAt: Date.now() + 60_000, impactToken: "impact-token-valid",
        results: REQUIRED_CHECKERS.map((checkerId) => ({
          checkerId,
          status: state.impactStatus,
          activeDefaultCount: checkerId === "sales" ? 2 : 0,
          openUseCount: checkerId === "sales" ? 3 : 0,
          historicalCount: checkerId === "sales" ? 4 : 0,
          watermark: "w1"
        }))
      });
    }
    if (method === "POST" && path.endsWith("/deactivate")) {
      if (deactivateNetworkFailures > 0) {
        deactivateNetworkFailures -= 1;
        return route.abort("failed");
      }
      if (options.deactivateDelayMs) {
        await new Promise((resolve) => {
          setTimeout(resolve, options.deactivateDelayMs);
        });
      }
      const collection = path.includes("payment-terms") ? state.terms : state.currencies;
      const key = path.split("/").at(-2);
      const row = collection.find((item) => String(item.id ?? item.code) === key);
      Object.assign(row, { status: "INACTIVE", version: row.version + 1, updatedAt: Date.now() });
      return ok(row);
    }
    if (method === "POST" && path.endsWith("/activate")) {
      const collection = path.includes("payment-terms") ? state.terms : state.currencies;
      const key = path.split("/").at(-2);
      const row = collection.find((item) => String(item.id ?? item.code) === key);
      Object.assign(row, { status: "ACTIVE", version: row.version + 1, updatedAt: Date.now() });
      return ok(row);
    }
    if (method === "POST" && path.endsWith("/change-precision")) {
      const row = state.currencies.find((item) => path.includes(`/${item.code}/`));
      Object.assign(row, { decimalPlaces: body.decimalPlaces, version: row.version + 1, updatedAt: Date.now() });
      return ok(row);
    }
    if (method === "GET" && path === "/api/v1/business-master/payment-terms") {
      const q = url.searchParams.get("q")?.toLowerCase();
      const status = url.searchParams.get("status");
      const items = state.terms.filter((row) => (!q || `${row.code} ${row.name}`.toLowerCase().includes(q)) && (!status || row.status === status));
      return ok({ items, total: items.length, page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 20) });
    }
    if (method === "POST" && path === "/api/v1/business-master/payment-terms") {
      const created = { id: state.terms.length + 1, ...body, status: "ACTIVE", version: 1, createdAt: Date.now(), updatedAt: Date.now() };
      state.terms.push(created);
      return ok(created, 201);
    }
    if (method === "PATCH" && /^\/api\/v1\/business-master\/payment-terms\/\d+$/.test(path)) {
      const row = state.terms.find((item) => path.endsWith(`/${item.id}`));
      Object.assign(row, { name: body.name, description: body.description, version: row.version + 1, updatedAt: Date.now() });
      return ok(row);
    }
    if (method === "POST" && path.endsWith("/change-rule")) {
      const row = state.terms.find((item) => path.includes(`/${item.id}/`));
      Object.assign(row, { calculationType: body.calculationType, dueDays: body.dueDays, version: row.version + 1, updatedAt: Date.now() });
      return ok(row);
    }
    if (method === "GET" && path === "/api/v1/business-master/audit") {
      return ok({ items: [], total: 0, page: 1, pageSize: 20 });
    }
    return fail(404, "NOT_FOUND", `Unhandled browser fixture: ${method} ${path}`);
  });
  return state;
}

async function openCurrencyPage(page) {
  await page.goto("/system/business-master/currencies");
  await expect(page.getByRole("heading", { name: "貨幣" })).toBeVisible();
  await expect(page.getByText("Hong Kong Dollar", { exact: true })).toBeVisible();
}

test("TC-017 @technical 管理員可查看目錄並完成具 impact token 的停用", async ({ page }) => {
  const state = await installApi(page);
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await openCurrencyPage(page);

  await page.getByRole("button", { name: "「HKD」的操作" }).click();
  await page.getByText("停用", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "停用貨幣" })).toBeVisible();
  await expect(page.getByText("sales", { exact: true })).toBeVisible();
  await page.getByLabel("變更原因").fill("停止新交易使用");
  await page.getByRole("button", { name: "確認執行停用貨幣" }).click();
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();

  const command = state.calls.find((call) => call.path.endsWith("/deactivate"));
  expect(command.body).toMatchObject({ reason: "停止新交易使用", impactToken: "impact-token-valid", version: 1 });
  expect(command.headers["idempotency-key"]).toBeTruthy();
  expect(errors).toEqual([]);
});

test("TC-017 @technical 未知網路結果以相同 idempotency key 安全重試", async ({ page }) => {
  const state = await installApi(page, { deactivateNetworkFailures: 1 });
  await openCurrencyPage(page);
  await page.getByRole("button", { name: "「HKD」的操作" }).click();
  await page.getByText("停用", { exact: true }).click();
  await page.getByLabel("變更原因").fill("驗證未知結果安全重試");

  const confirm = page.getByRole("button", { name: "確認執行停用貨幣" });
  await confirm.click();
  await expect(page.getByText(/操作結果尚未確認/)).toBeVisible();
  await confirm.click();
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();

  const commands = state.calls.filter((call) => call.path.endsWith("/deactivate"));
  expect(commands).toHaveLength(2);
  expect(commands[0].headers["idempotency-key"]).toBeTruthy();
  expect(commands[1].headers["idempotency-key"]).toBe(commands[0].headers["idempotency-key"]);
});

test("TC-017 @technical 雙擊確認只送出一個高影響命令", async ({ page }) => {
  const state = await installApi(page, { deactivateDelayMs: 100 });
  await openCurrencyPage(page);
  await page.getByRole("button", { name: "「HKD」的操作" }).click();
  await page.getByText("停用", { exact: true }).click();
  await page.getByLabel("變更原因").fill("驗證雙擊只執行一次");

  const confirm = page.getByRole("button", { name: "確認執行停用貨幣" });
  await confirm.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();

  expect(state.calls.filter((call) => call.path.endsWith("/deactivate"))).toHaveLength(1);
});

test("TC-017 @technical 清單 503 顯示中文錯誤並可重試", async ({ page }) => {
  await installApi(page, { currencyListFailures: 1 });
  await page.goto("/system/business-master/currencies");
  await expect(page.getByText("服務暫時無法使用，請稍後再試")).toBeVisible();
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByText("Hong Kong Dollar", { exact: true })).toBeVisible();
});

test("TC-017 @technical 空清單有明確狀態", async ({ page }) => {
  await installApi(page, { emptyCurrencies: true });
  await page.goto("/system/business-master/currencies");
  await expect(page.getByText("冇資料", { exact: true })).toBeVisible();
});

test("TC-017 @technical 未登入使用者會導向登入頁", async ({ page }) => {
  await installApi(page, { authenticated: false });
  await page.goto("/system/business-master/currencies");
  await expect(page).toHaveURL(/\/login\?redirect=/);
});

test("UAT-001 @uat 可按 URL-backed search 查閱 Currency", async ({ page }) => {
  await installApi(page);
  await page.goto("/system/business-master/currencies?q=Hong&page=1&sort=code&descending=false");
  await expect(page.getByText("Hong Kong Dollar", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/q=Hong/);
});

test("UAT-002 @uat 管理員可建立 ISO Currency，代碼建立後編輯時唯讀", async ({ page }) => {
  await installApi(page);
  await openCurrencyPage(page);
  await page.getByRole("button", { name: "新增貨幣" }).click();
  await page.getByLabel("ISO 4217 代碼").fill("USD");
  await page.getByLabel("名稱", { exact: true }).fill("US Dollar");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByText("US Dollar", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "「USD」的操作" }).click();
  await page.getByText("編輯名稱", { exact: true }).click();
  await expect(page.getByLabel("ISO 4217 代碼")).toHaveAttribute("readonly");
});

test("UAT-003 @uat 可建立 NET_DAYS Payment Term 並看到 deterministic preview", async ({ page }) => {
  await installApi(page);
  await page.goto("/system/business-master/payment-terms");
  await page.getByRole("button", { name: "新增付款條款" }).click();
  await page.getByLabel("條款代碼").fill("NET1");
  await page.getByLabel("名稱", { exact: true }).fill("翌日付款");
  await page.getByLabel("到期規則").click();
  await page.getByText("淨日數", { exact: true }).last().click();
  await page.getByLabel("到期日數").fill("1");
  await page.getByLabel("基準日期").fill("2024-02-28");
  await expect(page.getByText("到期日：2024-02-29")).toBeVisible();
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByText("NET1", { exact: true })).toBeVisible();
});

test("UAT-004 @uat END_OF_MONTH 與 MANUAL preview 顯示正確語意", async ({ page }) => {
  await installApi(page);
  await page.goto("/system/business-master/payment-terms");
  await page.getByRole("button", { name: "新增付款條款" }).click();
  await page.getByLabel("到期規則").click();
  await page.getByText("月底到期", { exact: true }).last().click();
  await page.getByLabel("基準日期").fill("2025-02-10");
  await expect(page.getByText("到期日：2025-02-28")).toBeVisible();
  await page.getByLabel("到期規則").click();
  await page.getByText("手動指定", { exact: true }).last().click();
  await expect(page.getByText("需手動指定到期日")).toBeVisible();
});

test("UAT-005 @uat 停用前顯示 entity、語意差異及 consumer 計數", async ({ page }) => {
  await installApi(page);
  await openCurrencyPage(page);
  await page.getByRole("button", { name: "「HKD」的操作" }).click();
  await page.getByText("停用", { exact: true }).click();
  await expect(page.getByText("HKD — Hong Kong Dollar", { exact: true })).toBeVisible();
  await expect(page.getByText("啟用 → 已停用", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "sales" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "3", exact: true })).toBeVisible();
});

test("UAT-006 @uat consumer impact 未知時 fail closed", async ({ page }) => {
  await installApi(page, { impactStatus: "UNKNOWN" });
  await openCurrencyPage(page);
  await page.getByRole("button", { name: "「HKD」的操作" }).click();
  await page.getByText("停用", { exact: true }).click();
  await expect(page.getByText(/影響尚未能確定/)).toBeVisible();
  await expect(page.getByRole("button", { name: "確認執行停用貨幣" })).toBeDisabled();
});

test("UAT-007 @uat view-only 使用者可看頁面但沒有管理操作", async ({ page }) => {
  await installApi(page, { user: { ...ACTIVE_USER, permissions: ["business_master.view"] } });
  await openCurrencyPage(page);
  await expect(page.getByRole("button", { name: "新增貨幣" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "「HKD」的操作" })).toHaveCount(0);
});

test("UAT-008 @uat 409 重新載入列表並保留未提交文字", async ({ page }) => {
  await installApi(page, { conflictOnce: true });
  await openCurrencyPage(page);
  await page.getByRole("button", { name: "「HKD」的操作" }).click();
  await page.getByText("編輯名稱", { exact: true }).click();
  await page.getByLabel("名稱", { exact: true }).fill("使用者尚未提交的名稱");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByText(/你輸入的名稱仍保留/)).toBeVisible();
  await expect(page.getByLabel("名稱", { exact: true })).toHaveValue("使用者尚未提交的名稱");
});

test("UAT-009 @uat 375px 回應式流程無 console 或 request failure", async ({ page }) => {
  const errors = [];
  const requestFailures = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()}`));
  await installApi(page);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 812 });
    await openCurrencyPage(page);
    await expect(page.locator(".q-table--sticky-actions")).toBeVisible();
    const pageBox = await page.locator(".q-page").boundingBox();
    expect(pageBox.width).toBeLessThanOrEqual(width);
  }
  await page.getByLabel("搜尋代碼或名稱").fill("HKD");
  await expect(page.getByText("Hong Kong Dollar", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(requestFailures).toEqual([]);
});
