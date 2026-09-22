import { expect, test } from "@playwright/test";

const user = { id: 1, username: "customer-manager", displayName: "Customer Manager", roles: [], permissions: ["customer.view", "customer.mgmt"] };
const customer = { id: 7, code: "CUS-007", legalName: "Evergreen Customer", displayName: "Evergreen", defaultCurrencyCode: "HKD", status: "draft", updatedAt: "2026-09-22T00:00:00.000Z" };

async function installApi(page) {
  const calls = [];
  await page.addInitScript((sessionUser) => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    window.__customerUser = sessionUser;
  }, user);
  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname; const body = request.postDataJSON?.() ?? null;
    calls.push({ method: request.method(), path, body, query: Object.fromEntries(url.searchParams) });
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5204" };
    const ok = (data) => route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "customer-browser" } }) });
    if (path === "/api/v1/user/me") return ok(user);
    if (request.method() === "GET" && path === "/api/v1/customers") return ok({ items: [customer], total: 1 });
    if (request.method() === "GET" && path === "/api/v1/customers/7") return ok({ ...customer, tradingName: "Evergreen", defaultPaymentTermId: null, accountManagerUserId: null, categoryId: null, industryId: null, territoryId: null, generalPhone: "", generalEmail: "", website: "", notes: "", version: 2 });
    if (request.method() === "GET" && path === "/api/v1/business-master/currencies") return ok({ items: [{ code: "HKD", name: "Hong Kong Dollar" }], total: 1 });
    if (request.method() === "POST" && path === "/api/v1/customers/duplicates/check") return ok({ code: [], legalName: [], tradingName: [] });
    if (request.method() === "POST" && path === "/api/v1/customers/create") return ok({ customer: { ...customer, id: 41, code: body.customerCode, legalName: body.legalName, status: body.activate ? "active" : "draft" }, operation: { id: "op-41" } });
    return route.fulfill({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: `${request.method()} ${path}` } }) });
  });
  return calls;
}

function collectConsole(page) {
  const problems = [];
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) problems.push(message.text()); });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

test("@technical list keeps the query in the URL and opens a customer detail", async ({ page }) => {
  const problems = collectConsole(page); const calls = await installApi(page);
  await page.goto("/customers?q=Evergreen");
  await expect(page.getByRole("heading", { name: "客戶" })).toBeVisible();
  await expect(page.getByText("Evergreen Customer")).toBeVisible();
  await expect(page).toHaveURL(/q=Evergreen/);
  await page.getByRole("link", { name: "查看 CUS-007 詳情" }).click();
  await expect(page.getByRole("heading", { name: "CUS-007 — Evergreen Customer" })).toBeVisible();
  expect(calls.some((call) => call.path === "/api/v1/customers" && call.query.q === "Evergreen")).toBe(true);
  expect(problems).toEqual([]);
});

test("@technical a manager creates a Draft through the visible form", async ({ page }) => {
  const problems = collectConsole(page); const calls = await installApi(page);
  await page.goto("/customers/new");
  await page.getByLabel("客戶代碼 *").fill("CUS-041");
  await page.getByLabel("法定名稱 *").fill("New Customer");
  await page.getByRole("button", { name: "儲存 Draft" }).click();
  await expect(page.getByText("客戶 CUS-041 已建立；狀態：草稿")).toBeVisible();
  expect(calls.find((call) => call.path === "/api/v1/customers/create")?.body).toMatchObject({ customerCode: "CUS-041", legalName: "New Customer", activate: false });
  expect(problems).toEqual([]);
});
