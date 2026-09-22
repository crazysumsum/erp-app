import { expect, test } from "@playwright/test";

const user = { id: 1, username: "customer-manager", displayName: "Customer Manager", roles: [], permissions: ["customer.view", "customer.mgmt"] };
const customer = { id: 7, code: "CUS-007", legalName: "Evergreen Customer", displayName: "Evergreen", defaultCurrencyCode: "HKD", status: "draft", updatedAt: "2026-09-22T00:00:00.000Z" };

async function installApi(page, { sessionUser = user, customerStatus = "draft" } = {}) {
  const calls = [];
  const state = { addresses: [], contacts: [], identifiers: [], credit: { configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null } };
  await page.addInitScript((sessionUser) => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    window.__customerUser = sessionUser;
  }, sessionUser);
  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname; const body = request.postDataJSON?.() ?? null;
    calls.push({ method: request.method(), path, body, query: Object.fromEntries(url.searchParams) });
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5204" };
    const ok = (data) => route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "customer-browser" } }) });
    if (path === "/api/v1/user/me") return ok(sessionUser);
    if (request.method() === "GET" && path === "/api/v1/customers") return ok({ items: [{ ...customer, status: customerStatus }], total: 1 });
    if (request.method() === "GET" && path === "/api/v1/customers/7") return ok({ ...customer, status: customerStatus, tradingName: "Evergreen", defaultPaymentTermId: null, accountManagerUserId: null, categoryId: null, industryId: null, territoryId: null, generalPhone: "", generalEmail: "", website: "", notes: "", version: 2, ...state });
    if (request.method() === "GET" && path === "/api/v1/customers/7/completeness") return ok({ customerId: 7, issues: [], warnings: [{ field: "credit", code: "CREDIT_POLICY_MISSING", message: "尚未設定信用政策（不等同 0 額度）" }] });
    if (request.method() === "GET" && path === "/api/v1/business-master/currencies") return ok({ items: [{ code: "HKD", name: "Hong Kong Dollar" }], total: 1 });
    if (request.method() === "POST" && path === "/api/v1/customers/duplicates/check") return ok({ code: [], legalName: [], tradingName: [] });
    if (request.method() === "POST" && path === "/api/v1/customers/create") return ok({ customer: { ...customer, id: 41, code: body.customerCode, legalName: body.legalName, status: body.activate ? "active" : "draft" }, operation: { id: "op-41" } });
    if (request.method() === "POST" && path === "/api/v1/customers/7/addresses/create") { state.addresses.push({ id: 9, customerId: 7, ...body, status: "active", version: 1 }); return ok({ id: 9, customerId: 7, status: "active", version: 1, purposes: body.purposes }); }
    if (request.method() === "POST" && path === "/api/v1/customers/7/suspend") return route.fulfill({ status: 409, headers, body: JSON.stringify({ success: false, error: { code: "VERSION_CONFLICT", message: "客戶已被其他人修改" } }) });
    if (request.method() === "POST" && path === "/api/v1/customers/7/activate") {
      if (!body.approverUserId) return route.fulfill({ status: 400, headers, body: JSON.stringify({ success: false, error: { code: "APPROVER_REQUIRED", message: "目前設定要求指定審批人" } }) });
      return ok({ id: 11, customerId: 7, customerStatus: "pending_approval", status: "pending", version: 1 });
    }
    if (request.method() === "POST" && path === "/api/v1/customers/7/archive") return route.fulfill({ status: 409, headers, body: JSON.stringify({ success: false, error: { code: "CUSTOMER_REFERENCED", message: "客戶已有下游引用", details: { providers: [{ id: "sales", status: "REFERENCE", referenceCount: 3 }] } } }) });
    if (request.method() === "POST" && path === "/api/v1/customers/7/approval/withdraw") return ok({ id: 11, customerId: 7, customerStatus: "draft", status: "withdrawn", version: 2 });
    if (request.method() === "GET" && path === "/api/v1/customer-approvals") return ok({ items: [{ id: 11, customerId: 7, customerCode: "CUS-007", legalName: "Evergreen Customer", customerStatus: "pending_approval", status: "pending", requester: { id: 1, username: "maker", displayName: "Maker" }, assignedApprover: { id: 9, username: "checker", displayName: "Checker" }, requestNote: "請覆核", requestedAt: 1700000000000, decidedAt: null, version: 1 }], total: 1, page: 1, pageSize: 20 });
    if (request.method() === "GET" && path === "/api/v1/customer-approvals/11") return ok({ id: 11, customerId: 7, customerCode: "CUS-007", legalName: "Evergreen Customer", customerStatus: "pending_approval", status: "pending", requester: { id: 1, username: "maker", displayName: "Maker" }, assignedApprover: { id: 9, username: "checker", displayName: "Checker" }, requestNote: "請覆核", requestedAt: 1700000000000, decidedAt: null, version: 1, decidedBy: null, decisionReason: "", customerVersion: 2, currentCustomerVersion: 3, stale: true, submitted: { customerCode: "CUS-007", legalName: "Evergreen Customer", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, identifiers: [], creditStatus: "normal" }, current: { customerCode: "CUS-007", legalName: "Evergreen Trading", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, identifiers: [], creditStatus: "normal" }, changedFields: ["legalName"] });
    if (request.method() === "GET" && path === "/api/v1/customer-approvers") return ok({ items: [{ id: 10, username: "other", displayName: "Other Approver" }] });
    if (request.method() === "POST" && path === "/api/v1/customer-approvals/11/reassign") return ok({ id: 11, assignedApproverId: body.approverUserId, version: 2, replayed: false });
    if (request.method() === "GET" && path === "/api/v1/customer-settings") return ok({ requireActivationApproval: false, version: 4, updatedAt: 1700000000000, updatedBy: 1 });
    if (request.method() === "POST" && path === "/api/v1/customer-settings/update") return ok({ requireActivationApproval: body.requireActivationApproval, version: 5, updatedAt: 1700000001000, updatedBy: 3 });
    if (request.method() === "GET" && path.startsWith("/api/v1/customer-catalog/")) return ok({ items: [] });
    if (request.method() === "POST" && path === "/api/v1/customer-catalog/categories/create") return ok({ id: 21, code: body.code, name: body.name, description: body.description, status: "active", sortOrder: body.sortOrder, version: 1, createdAt: 1, updatedAt: 1 });
    return route.fulfill({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: `${request.method()} ${path}` } }) });
  });
  return calls;
}

function collectConsole(page, { ignore = [] } = {}) {
  const problems = [];
  page.on("console", (message) => { if (["error", "warning"].includes(message.type()) && !ignore.some((text) => message.text().includes(text))) problems.push(message.text()); });
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

test("@technical core customer actions remain reachable at approved viewport widths", async ({ page }) => {
  const problems = collectConsole(page);
  await installApi(page);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/customers");
    await expect(page.getByRole("heading", { name: "客戶" })).toBeInViewport();
    await expect(page.getByRole("link", { name: "新增客戶" })).toBeInViewport();
    const detailLink = page.getByRole("link", { name: "查看 CUS-007 詳情" });
    await expect(detailLink).toBeInViewport();
    if (width === 375) {
      await detailLink.click();
      await expect(page.getByRole("heading", { name: "CUS-007 — Evergreen Customer" })).toBeInViewport();
    }
  }
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

test("@technical a manager adds an address from the customer detail", async ({ page }) => {
  const problems = collectConsole(page); const calls = await installApi(page);
  await page.goto("/customers/7");
  await page.getByRole("tab", { name: "地址 (0)" }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "新增地址" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByLabel("地址標籤 *")).toBeFocused();
  await page.getByLabel("地址標籤 *").fill("總部");
  await page.getByLabel("地址行 1 *").fill("皇后大道中 1 號");
  await page.getByRole("button", { name: "儲存地址" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("皇后大道中 1 號")).toBeVisible();
  expect(calls.find((call) => call.path.endsWith("/addresses/create"))?.body).toMatchObject({ label: "總部", addressLine1: "皇后大道中 1 號", purposes: [] });
  expect(problems).toEqual([]);
});

test("@technical lifecycle actions follow role boundaries and keep conflicts actionable", async ({ page }) => {
  const problems = collectConsole(page, { ignore: ["status of 409"] });
  const manager = { ...user, permissions: ["customer.view", "customer.mgmt"] };
  await installApi(page, { sessionUser: manager, customerStatus: "active" });
  await page.goto("/customers/7");
  await expect(page.getByRole("button", { name: "暫停" })).toBeVisible();
  await expect(page.getByRole("button", { name: "封鎖" })).toHaveCount(0);
  await page.getByRole("button", { name: "暫停" }).click();
  await page.getByLabel("原因 *").fill("暫停進行客戶覆核");
  await page.getByLabel("目前密碼 *").fill("browser-secret");
  await page.getByRole("button", { name: "確認暫停" }).click();
  await expect(page.getByRole("button", { name: "載入最新資料" })).toBeVisible();
  await expect(page.getByLabel("目前密碼 *")).toHaveValue("");
  expect(problems).toEqual([]);
});

test("@technical stale approval shows the diff and cannot be approved", async ({ page }) => {
  const problems = collectConsole(page);
  const checker = { id: 9, username: "checker", displayName: "Checker", roles: [], permissions: ["customer.view", "customer.approval"] };
  await installApi(page, { sessionUser: checker });
  await page.goto("/customer-approvals");
  await page.getByRole("button", { name: "查看 CUS-007 的審批詳情" }).click();
  await expect(page.getByText("這份申請不能批准")).toBeVisible();
  await expect(page.locator('[data-field="legalName"]')).toContainText("Evergreen Trading");
  await expect(page.getByRole("button", { name: "批准" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "拒絕" })).toBeEnabled();
  expect(problems).toEqual([]);
});

test("@technical activation collects an eligible approver when policy requires approval", async ({ page }) => {
  const problems = collectConsole(page, { ignore: ["status of 400"] }); const calls = await installApi(page);
  await page.goto("/customers/7");
  await page.getByRole("button", { name: "啟用" }).click();
  await page.getByRole("button", { name: "確認啟用" }).click();
  await expect(page.getByLabel("審批人 *")).toBeVisible();
  await page.getByLabel("審批人 *").click();
  await page.getByRole("option", { name: /Other Approver/ }).click();
  await page.getByLabel("提交備註（選填）").fill("請覆核客戶啟用");
  await page.getByRole("button", { name: "確認提交審批" }).click();
  await expect(page.getByRole("button", { name: "啟用" })).toBeVisible();
  expect(calls.filter((call) => call.path.endsWith("/activate")).at(-1)?.body).toMatchObject({ version: 2, approverUserId: 10, requestNote: "請覆核客戶啟用" });
  expect(problems).toEqual([]);
});

test("@technical archive shows named reference blockers", async ({ page }) => {
  const problems = collectConsole(page, { ignore: ["status of 409"] });
  await installApi(page, { customerStatus: "active" });
  await page.goto("/customers/7");
  await page.getByRole("button", { name: "封存" }).click();
  await page.getByLabel("原因 *").fill("封存進行客戶覆核");
  await page.getByLabel("目前密碼 *").fill("browser-secret");
  await page.getByRole("button", { name: "確認封存" }).click();
  await expect(page.getByText("sales：3")).toBeVisible();
  expect(problems).toEqual([]);
});

test("@technical approvers can reassign and authorized requesters can withdraw", async ({ page }) => {
  const problems = collectConsole(page); const requesterWithBothRoles = { id: 1, username: "maker", displayName: "Maker", roles: [], permissions: ["customer.view", "customer.mgmt", "customer.approval"] }; const calls = await installApi(page, { sessionUser: requesterWithBothRoles });
  await page.goto("/customer-approvals");
  await page.getByRole("button", { name: "查看 CUS-007 的審批詳情" }).click();
  await page.getByLabel("改派給").click();
  await page.getByRole("option", { name: /Other Approver/ }).click();
  await page.getByRole("button", { name: "重新指派" }).click();
  await page.getByLabel("原因").fill("原審批人目前休假");
  await page.getByLabel("你的密碼").fill("browser-secret");
  await page.getByRole("button", { name: "重新指派", exact: true }).last().click();
  await expect.poll(() => calls.some((call) => call.path.endsWith("/reassign"))).toBe(true);
  await page.getByRole("button", { name: "撤回" }).click();
  await expect.poll(() => calls.some((call) => call.path.endsWith("/approval/withdraw"))).toBe(true);
  expect(problems).toEqual([]);
});

test("@technical settings explains prospective scope and saves with re-auth", async ({ page }) => {
  const problems = collectConsole(page); const calls = await installApi(page, { sessionUser: { id: 3, username: "settings-admin", displayName: "Settings Admin", roles: [], permissions: ["customer.view", "customer.settings"] } });
  await page.goto("/customer-settings");
  await expect(page.getByText("只影響之後提交")).toBeVisible();
  await page.getByRole("switch", { name: "啟用客戶前需要另一名使用者審批" }).click();
  await page.getByLabel("原因").fill("公司政策要求覆核");
  await page.getByLabel("你的密碼").fill("browser-secret");
  await page.getByRole("button", { name: "確認儲存" }).click();
  await expect(page.getByText("目前為")).toContainText("開啟");
  expect(calls.find((call) => call.path === "/api/v1/customer-settings/update")?.body).toMatchObject({ requireActivationApproval: true, version: 4, reason: "公司政策要求覆核", password: "browser-secret" });
  await page.getByRole("button", { name: "新增客戶分類" }).click();
  await page.getByLabel("代碼 *").fill("retail"); await page.getByLabel("名稱 *").fill("零售"); await page.getByRole("button", { name: "儲存", exact: true }).click();
  await page.getByLabel("原因").fill("新增客戶分類"); await page.getByLabel("你的密碼").fill("browser-secret"); await page.getByRole("button", { name: "確認儲存" }).click();
  await expect.poll(() => calls.some((call) => call.path.endsWith("/categories/create"))).toBe(true);
  expect(problems).toEqual([]);
});
