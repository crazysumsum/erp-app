import { expect, test } from "@playwright/test";

/**
 * HD-107 G4／G5 嘅瀏覽器驗證：真 Quasar select、checkbox、date input、真 router 同 URL、整頁重載後還原，
 * 同埋詳情超過 100 筆聯絡人時逐頁載入。API 喺 network 層 mock（同本模組其他 spec 一樣，CI 冇後端）；
 * 篩選本身喺真 MySQL 嘅結果由 server 嘅 supplierListAcceptance 測試負責。
 */

const MANAGER = {
  id: 1, username: "filter-manager", displayName: "Filter Manager", roles: ["buyer"],
  permissions: ["supplier.view", "supplier.mgmt", "business_master.view"]
};
const VIEWER = { ...MANAGER, username: "filter-viewer", permissions: ["supplier.view"] };
const PASSWORD = "browser-test-password";
const ROW = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen", defaultCurrencyCode: "USD",
  defaultPaymentTermId: 3, primaryContactName: null, status: "active", version: 2, updatedAt: 1_757_808_000_000
};

function contact(id) {
  return {
    id, supplierId: 7, name: `Contact ${id}`, jobTitle: "", department: "", email: "", phone: "", mobile: "",
    preferredLanguage: "", notes: "", status: "active", purposes: [], version: 1, updatedAt: 100
  };
}

const DETAIL = {
  ...ROW, website: "", generalPhone: "", generalEmail: "", notes: "", createdAt: 100,
  addresses: [], contacts: Array.from({ length: 100 }, (_, index) => contact(1000 + index)), identifiers: [], bankAccounts: [],
  warnings: [{ field: "addresses", code: "ORDERING_ADDRESS_MISSING", message: "尚未設定採購用途地址" }]
};

async function installApi(page, { user = MANAGER } = {}) {
  const state = { lists: [], exports: [], contactPages: [] };
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
    const get = request.method() === "GET";

    if (url.pathname === "/api/v1/user/me") return ok(user);
    if (get && url.pathname === "/api/v1/business-master/currencies") {
      return ok({ items: [{ code: "HKD", name: "Hong Kong Dollar", version: 1 }, { code: "USD", name: "US Dollar", version: 1 }], total: 2, page: 1, pageSize: 100 });
    }
    if (get && url.pathname === "/api/v1/business-master/payment-terms") {
      return ok({ items: [{ id: 3, code: "N30", name: "Net 30", version: 1 }], total: 1, page: 1, pageSize: 100 });
    }
    if (get && url.pathname === "/api/v1/suppliers") {
      state.lists.push(Object.fromEntries(url.searchParams));
      return ok({ items: [ROW], total: 1, page: 1, pageSize: 20 });
    }
    if (get && url.pathname === "/api/v1/suppliers/7") return ok(DETAIL);
    if (get && url.pathname === "/api/v1/suppliers/7/completeness") return ok({ supplierId: 7, issues: [], warnings: DETAIL.warnings });
    if (get && url.pathname === "/api/v1/suppliers/7/contacts") {
      state.contactPages.push(Object.fromEntries(url.searchParams));
      return ok({ items: Array.from({ length: 5 }, (_, index) => contact(2000 + index)), total: 105, page: 2, pageSize: 100 });
    }
    if (request.method() === "POST" && url.pathname === "/api/v1/supplier-exports") {
      state.exports.push(request.postDataJSON());
      return route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=\"suppliers.csv\"" }, body: "supplierId\r\n7\r\n" });
    }
    return route.fulfill({ status: 404, headers,
      body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: `unrouted ${request.method()} ${url.pathname}` }, meta: { requestId: "pw" } }) });
  });
  return state;
}

function collectProblems(page) {
  const problems = [];
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") problems.push(message.text()); });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => problems.push(`requestfailed: ${request.url()}`));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
  return problems;
}

async function pick(page, label, option) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
}

test("@technical filters go to the API as Hong Kong day bounds, survive a reload, and drive the export", async ({ page }) => {
  const problems = collectProblems(page);
  const state = await installApi(page);
  await page.goto("/suppliers");
  await expect(page.getByText("SUP-007")).toBeVisible();

  await pick(page, "貨幣", "USD — US Dollar");
  await pick(page, "付款條件", "N30 — Net 30");
  await page.getByRole("checkbox", { name: "缺有效銀行資料" }).click();
  await page.getByRole("checkbox", { name: "包括已封存" }).click();
  await page.getByLabel("建立日期由").fill("2026-10-01");
  await page.getByLabel("建立日期至").fill("2026-10-02");

  const expected = {
    currencyCode: "USD", paymentTermId: "3", missingBank: "true", includeArchived: "true",
    createdFrom: String(Date.parse("2026-09-30T16:00:00Z")), createdTo: String(Date.parse("2026-10-02T15:59:59.999Z"))
  };
  await expect.poll(() => state.lists.at(-1)).toMatchObject(expected);
  expect(state.lists.at(-1)).not.toHaveProperty("missingAddress");
  expect(state.lists.at(-1)).not.toHaveProperty("updatedFrom");
  await expect(page).toHaveURL(/currencyCode=USD/u);
  await expect(page).toHaveURL(/createdFrom=2026-10-01/u);

  const before = state.lists.length;
  await page.reload();
  await expect(page.getByText("SUP-007")).toBeVisible();
  await expect.poll(() => state.lists.length).toBeGreaterThan(before);
  expect(state.lists.at(-1)).toMatchObject(expected);
  await expect(page.getByRole("checkbox", { name: "缺有效銀行資料" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("checkbox", { name: "缺採購地址" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("建立日期由")).toHaveValue("2026-10-01");
  await expect(page.getByRole("combobox", { name: "貨幣" })).toHaveValue("USD — US Dollar");

  await page.getByRole("button", { name: "匯出 CSV" }).click();
  const dialog = page.locator(".q-dialog").filter({ has: page.locator("input[type=password]") });
  await dialog.locator("input[type=password]").fill(PASSWORD);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "匯出" }).click();
  await download;
  expect(state.exports.at(-1).filters).toEqual({
    currencyCode: "USD", paymentTermId: 3, missingBank: true, includeArchived: true,
    createdFrom: Date.parse("2026-09-30T16:00:00Z"), createdTo: Date.parse("2026-10-02T15:59:59.999Z"),
    sortBy: "updatedAt", descending: true
  });
  expect(problems).toEqual([]);
});

test("@technical a reversed date range is flagged, and unticking a filter removes it from the request and the URL", async ({ page }) => {
  const problems = collectProblems(page);
  const state = await installApi(page);
  await page.goto("/suppliers?updatedFrom=2026-10-15&updatedTo=2026-10-01&missingAddress=true");
  await expect(page.getByText("結束日期不可早於開始日期")).toBeVisible();

  await page.getByRole("checkbox", { name: "缺採購地址" }).click();
  await expect.poll(() => state.lists.at(-1)).not.toHaveProperty("missingAddress");
  await expect(page).not.toHaveURL(/missingAddress/u);
  await page.getByLabel("更新日期至").fill("2026-10-20");
  await expect(page.getByText("結束日期不可早於開始日期")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("@technical without business_master.view there are no currency or payment-term filters and no master lookups", async ({ page }) => {
  const problems = collectProblems(page);
  await installApi(page, { user: VIEWER });
  const masterCalls = [];
  page.on("request", (request) => { if (request.url().includes("/api/v1/business-master/")) masterCalls.push(request.url()); });
  await page.goto("/suppliers");
  await expect(page.getByText("SUP-007")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "缺主要訂單聯絡人" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "貨幣" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "付款條件" })).toHaveCount(0);
  expect(masterCalls).toEqual([]);
  expect(problems).toEqual([]);
});

test("@technical a detail with 100 contacts says so and loads the rest a page at a time", async ({ page }) => {
  const problems = collectProblems(page);
  const state = await installApi(page);
  await page.goto("/suppliers/7");
  // PARTY-007：缺選填資料係非阻擋提示，以 status 宣告，唔係 alert（REV-097 L-2）。
  await expect(page.getByRole("status", { name: "非阻擋完整度提示" })).toContainText("不影響啟用");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("tab", { name: "聯絡人 (100+)" }).click();
  await expect(page.getByText("已顯示 100 個聯絡人，可能還有更多")).toBeVisible();

  await page.getByRole("button", { name: "載入更多聯絡人" }).click();
  await expect(page.getByText("已顯示 105 個聯絡人，共 105 個")).toBeVisible();
  await expect(page.getByText("Contact 2004")).toBeVisible();
  await expect(page.getByRole("button", { name: "載入更多聯絡人" })).toHaveCount(0);
  expect(state.contactPages).toEqual([{ page: "2", pageSize: "100" }]);

  // REV-095 L-2：轉去概覽再返嚟，已載入嘅唔使再攞。
  await page.getByRole("tab", { name: "概覽" }).click();
  await page.getByRole("tab", { name: "聯絡人 (100+)" }).click();
  await expect(page.getByText("已顯示 105 個聯絡人，共 105 個")).toBeVisible();
  expect(state.contactPages).toHaveLength(1);
  expect(problems).toEqual([]);
});

test("@technical ticking a filter on a later page goes back to page 1 (REV-095 M-1)", async ({ page }) => {
  const problems = collectProblems(page);
  const state = await installApi(page);
  await page.goto("/suppliers?page=3");
  await expect(page.getByText("SUP-007")).toBeVisible();
  expect(state.lists.at(-1)).toMatchObject({ page: "3" });
  await page.getByRole("checkbox", { name: "缺主要訂單聯絡人" }).click();
  await expect.poll(() => state.lists.at(-1)).toMatchObject({ page: "1", missingPrimaryContact: "true" });
  await expect(page).toHaveURL(/[?&]page=1(&|$)/u);
  expect(problems).toEqual([]);
});

test("@technical the list tells loading, empty and failed apart by its text (DEF-032)", async ({ page }) => {
  const problems = collectProblems(page);
  await installApi(page);
  let release;
  const held = new Promise((done) => { release = done; });
  const replies = [];
  // 後註冊嘅 route 先食：淨係接管列表本身，其他照用 installApi。
  await page.route((url) => url.pathname === "/api/v1/suppliers", async (route) => {
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5203" };
    const next = replies.shift() ?? "row";
    if (next === "held") await held;
    if (next === "fail") {
      return route.fulfill({ status: 500, headers,
        body: JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "伺服器暫時出錯" }, meta: { requestId: "pw" } }) });
    }
    const items = next === "row" ? [ROW] : [];
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data: { items, total: items.length, page: 1, pageSize: 20 }, meta: { requestId: "pw" } }) });
  });

  replies.push("held");
  await page.goto("/suppliers");
  await expect(page.getByText("載入中…")).toBeVisible();
  await expect(page.getByText("冇資料")).toHaveCount(0);
  release();
  await expect(page.getByText("冇資料")).toBeVisible();
  await expect(page.getByText("載入中…")).toHaveCount(0);

  replies.push("fail");
  await page.reload();
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
  await expect(page.getByText("冇資料")).toHaveCount(0);
  await expect(page.getByText("載入中…")).toHaveCount(0);

  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByText("SUP-007")).toBeVisible();
  await expect(page.getByRole("button", { name: "重試" })).toHaveCount(0);
  expect(problems.filter((problem) => !/500 http:\/\/localhost:3000\/api\/v1\/suppliers\b/u.test(problem)
    && !/Failed to load resource: the server responded with a status of 500/u.test(problem))).toEqual([]);
});
