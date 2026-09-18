import { expect, test } from "@playwright/test";

/**
 * TASK-030 嘅瀏覽器驗證。API 喺 network 層 mock，所以驗嘅係前端行為同佢**實際
 * 發出嘅請求**，唔係伺服器嘅回應。
 *
 * 密碼對話框一律行 Tab 去確認掣再撳，唔係喺輸入欄撳 Enter —— 見 DEF-018：
 * 確認掣喺 <q-form> 外面，所以表單入面冇 submit 掣，Enter 唔會提交。
 */

const APPROVER = { id: 2, username: "checker", displayName: "Checker" };
const REQUESTER = { id: 1, username: "maker", displayName: "Maker" };
const OTHER = { id: 3, username: "other", displayName: "Other" };

function sessionUser(who) {
  return { ...who, roles: ["system-admin"], permissions: ["supplier.view", "supplier.mgmt", "supplier.approval"] };
}

const SNAPSHOT = {
  supplierCode: "SUP-007", supplierName: "Evergreen", displayName: "", defaultCurrencyCode: "HKD",
  defaultPaymentTermId: null, identifierCount: 0, identifiersTruncated: false, identifiers: []
};

function request(overrides = {}) {
  return {
    id: 11, supplierId: 7, supplierCode: "SUP-007", supplierName: "Evergreen",
    supplierStatus: "pending_approval", status: "pending",
    requester: REQUESTER, assignedApprover: APPROVER,
    requestNote: "請覆核", requestedAt: 1_757_808_000_000, decidedAt: null, version: 1,
    ...overrides
  };
}

function detailOf(row, overrides = {}) {
  return {
    ...row, decidedBy: null, decisionReason: "", supplierVersion: 5, currentSupplierVersion: 5,
    stale: false, submitted: SNAPSHOT, current: SNAPSHOT, changedFields: [], ...overrides
  };
}

async function installApi(page, options = {}) {
  const state = {
    user: sessionUser(options.actor ?? APPROVER),
    rows: options.rows ?? [request()],
    detail: options.detail ?? detailOf(request()),
    calls: []
  };

  await page.addInitScript((user) => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    window.__supplierApprovalUser = user;
  }, state.user);

  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname;
    const body = req.postDataJSON?.() ?? null;
    state.calls.push({ method, path, body, query: Object.fromEntries(url.searchParams) });

    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5203" };
    const ok = (data) => route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "pw" } }) });
    const fail = (status, code, message) => route.fulfill({ status, headers, body: JSON.stringify({ success: false, error: { code, message }, meta: { requestId: "pw" } }) });

    if (path === "/api/v1/user/me") return ok(state.user);
    if (path === "/api/v1/supplier-approvers") {
      return ok({ items: [OTHER] });
    }
    if (method === "GET" && path === "/api/v1/supplier-approvals") {
      const scope = url.searchParams.get("scope");
      const rows = scope === "unassigned"
        ? state.rows.filter((row) => row.assignedApprover === null)
        : scope === "mine"
          ? state.rows.filter((row) => row.assignedApprover?.id === state.user.id)
          : state.rows;
      return ok({ items: rows, total: rows.length, page: 1, pageSize: 20 });
    }
    if (method === "GET" && /^\/api\/v1\/supplier-approvals\/\d+$/u.test(path)) return ok(state.detail);
    if (method === "POST" && path.endsWith("/approve")) return ok({ id: 11, status: "approved", supplierId: 7, supplierStatus: "active", version: 2, replayed: false });
    if (method === "POST" && path.endsWith("/reject")) return ok({ id: 11, status: "rejected", supplierId: 7, supplierStatus: "draft", version: 2, replayed: false });
    if (method === "POST" && path.endsWith("/reassign")) return ok({ id: 11, assignedApproverId: body.approverUserId, version: 2, replayed: false });
    if (method === "POST" && path.endsWith("/approval/withdraw")) return ok({ id: 11, status: "withdrawn", supplierId: 7, supplierStatus: "draft", version: 2, replayed: false });
    return fail(404, "NOT_FOUND", `unrouted ${method} ${path}`);
  });

  return state;
}

function collectConsole(page) {
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function openDetail(page) {
  await page.getByRole("button", { name: /審批詳情/u }).first().click();
  // 要等一個**只有** detail 卡先有嘅嘢。「提交時」唔得：queue 個欄名叫「提交時間」，
  // 所以嗰個等待由頭到尾都即刻過，令後面讀 state.calls 讀喺兩個 await 中間。
  await expect(page.getByRole("table", { name: "提交時快照與目前資料比較" })).toBeVisible();
}

/** DEF-018：Enter 喺輸入欄唔會提交，所以行 Tab 去確認掣。 */
async function confirmByKeyboard(page, okLabel, { reason } = {}) {
  const dialog = page.locator(".q-dialog");
  await expect(dialog).toBeVisible();
  if (reason !== undefined) {
    await dialog.getByLabel("原因").fill(reason);
    await dialog.getByLabel("密碼").fill("browser-test-password");
  } else {
    await dialog.locator("input").first().fill("browser-test-password");
  }
  const confirm = dialog.getByRole("button", { name: okLabel });
  for (let press = 0; press < 12 && !(await confirm.evaluate((node) => node === document.activeElement)); press += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
}

test("@technical the queue opens on mine and switches scope", async ({ page }) => {
  const problems = collectConsole(page);
  const state = await installApi(page, {
    rows: [request(), request({ id: 12, supplierCode: "SUP-008", assignedApprover: null })]
  });
  await page.goto("/suppliers/approvals");

  await expect(page.getByText("SUP-007")).toBeVisible();
  await expect(page.getByText("SUP-008")).toHaveCount(0);
  expect(state.calls.at(-1).query).toMatchObject({ scope: "mine", status: "pending" });

  await page.getByRole("button", { name: "未指派" }).click();
  await expect(page.getByText("SUP-008")).toBeVisible();
  expect(state.calls.at(-1).query).toMatchObject({ scope: "unassigned" });

  await page.getByRole("button", { name: "全部待處理" }).click();
  await expect(page.getByText("SUP-007")).toBeVisible();
  await expect(page.getByText("SUP-008")).toBeVisible();

  expect(state.calls.some((call) => call.path.startsWith("/api/v1/business-master"))).toBe(false);
  expect(problems).toEqual([]);
});

test("@technical a stale request shows the difference and cannot be approved", async ({ page }) => {
  // AC-012：提交之後 Supplier 改過，舊申請唔可以批。
  await installApi(page, {
    detail: detailOf(request(), {
      stale: true, currentSupplierVersion: 6,
      current: { ...SNAPSHOT, supplierName: "Evergreen Trading" },
      changedFields: ["supplierName"]
    })
  });
  await page.goto("/suppliers/approvals");
  await openDetail(page);

  await expect(page.getByText("這個申請已經過時")).toBeVisible();
  await expect(page.getByText("Evergreen Trading")).toBeVisible();
  await expect(page.getByRole("button", { name: "批准" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "拒絕" })).toBeDisabled();
});

test("@technical approving by keyboard sends the password and the request version", async ({ page }) => {
  const problems = collectConsole(page);
  const state = await installApi(page);
  await page.goto("/suppliers/approvals");
  await openDetail(page);

  await page.getByRole("button", { name: "批准" }).click();
  await confirmByKeyboard(page, "批准");

  const approve = state.calls.find((call) => call.path.endsWith("/approve"));
  expect(approve.body).toMatchObject({ password: "browser-test-password", version: 1 });
  // 設計 §7.6：通知要帶 Supplier Code 同結果。
  await expect(page.locator(".q-notification")).toContainText("SUP-007");
  await expect(page.locator(".q-notification")).toContainText("啟用");
  expect(problems).toEqual([]);
});

test("@technical rejecting demands a reason alongside the password", async ({ page }) => {
  const state = await installApi(page);
  await page.goto("/suppliers/approvals");
  await openDetail(page);

  await page.getByRole("button", { name: "拒絕" }).click();
  await confirmByKeyboard(page, "拒絕", { reason: "資料不足以啟用" });

  const reject = state.calls.find((call) => call.path.endsWith("/reject"));
  expect(reject.body).toMatchObject({ reason: "資料不足以啟用", password: "browser-test-password", version: 1 });
  await expect(page.locator(".q-notification")).toContainText("草稿");
});

test("@technical the requester withdraws through the Supplier route, and the approver has no such button", async ({ page }) => {
  const asApprover = await installApi(page);
  await page.goto("/suppliers/approvals");
  await openDetail(page);
  await expect(page.getByRole("button", { name: "撤回" })).toHaveCount(0);
  expect(asApprover.calls.some((call) => call.path.endsWith("/approval/withdraw"))).toBe(false);

  const context = page.context();
  const requesterPage = await context.newPage();
  const state = await installApi(requesterPage, { actor: REQUESTER });
  await requesterPage.goto("/suppliers/approvals");
  await requesterPage.getByRole("button", { name: "全部待處理" }).click();
  await requesterPage.getByRole("button", { name: /審批詳情/u }).first().click();
  await expect(requesterPage.getByRole("table", { name: "提交時快照與目前資料比較" })).toBeVisible();

  await requesterPage.getByRole("button", { name: "撤回" }).click();
  const withdraw = state.calls.find((call) => call.path.endsWith("/approval/withdraw"));
  expect(withdraw.path).toBe("/api/v1/suppliers/7/approval/withdraw");
  expect(withdraw.body).toMatchObject({ requestId: 11, version: 1 });
  expect(withdraw.body.password).toBeUndefined();
  await expect(requesterPage.locator(".q-notification")).toContainText("SUP-007");
  await expect(requesterPage.locator(".q-notification")).toContainText("草稿");
  await requesterPage.close();
});

test("@technical an unassigned request can be reassigned, excluding the requester", async ({ page }) => {
  const state = await installApi(page, {
    rows: [request({ id: 12, assignedApprover: null })],
    detail: detailOf(request({ id: 12, assignedApprover: null }))
  });
  await page.goto("/suppliers/approvals");
  await page.getByRole("button", { name: "未指派" }).click();
  await openDetail(page);

  const lookup = state.calls.find((call) => call.path === "/api/v1/supplier-approvers");
  expect(lookup.query).toMatchObject({ excludeUserId: String(REQUESTER.id) });

  await page.getByLabel("改派給").click();
  await page.getByRole("option", { name: /Other/u }).click();
  await page.getByRole("button", { name: "重新指派" }).click();
  await confirmByKeyboard(page, "重新指派", { reason: "原審批人休假" });

  const reassign = state.calls.find((call) => call.path.endsWith("/reassign"));
  expect(reassign.body).toMatchObject({ approverUserId: OTHER.id, reason: "原審批人休假", version: 1 });
});
