import { expect, test } from "@playwright/test";

/**
 * DEF-035（HD-125 A）嘅瀏覽器驗證：真 Quasar、真 router、真 date input。API 喺 network 層 mock（同本模組其他 spec 一樣，
 * CI 冇後端）；記錄係咪真係寫入、遮罩係咪由後端做，由 server 嘅 audit 測試同 UAT 負責。
 */
const VIEWER = {
  id: 1, username: "audit-viewer", displayName: "Audit Viewer", roles: ["viewer"], permissions: ["supplier.view"]
};
const ROWS = [
  { id: 2, occurredAt: Date.parse("2026-12-31T16:30:00Z"), actorUserId: 5, actorUsername: "clerk-a", action: "supplier.update",
    targetType: "supplier", targetId: 7, supplierId: 7, targetLabel: "SUP-007", reason: "",
    detail: { before: { supplierName: "Old Name", notes: { changed: true, length: 0, sha256: "b".repeat(64) } }, after: { supplierName: "New Name", notes: { changed: true, length: 10, sha256: "a".repeat(64) },
      website: `https://example.com/${"long-path-segment-".repeat(12)}` } }, requestId: "6f1c2a9e-0d4b-4c1e-9f3a-2b7d5e8c1a00", ip: "127.0.0.1" },
  { id: 1, occurredAt: Date.parse("2026-10-01T02:00:00Z"), actorUserId: 6, actorUsername: "bank-officer", action: "supplier.bank.create",
    targetType: "bank", targetId: 3, supplierId: 7, targetLabel: "Bank A", reason: "新增收款帳戶",
    detail: { after: { maskedAccountNumber: "**** 1234" } }, requestId: "req-bank", ip: "127.0.0.1" }
];
const DETAIL = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null,
  website: "", generalPhone: "", generalEmail: "", notes: "", status: "active", version: 2, createdAt: 100, updatedAt: 100,
  addresses: [], contacts: [], identifiers: [], bankAccounts: [], warnings: []
};

async function installApi(page) {
  const audits = [];
  await page.addInitScript(() => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
  });
  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5203" };
    const ok = (data) => route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "pw" } }) });
    if (url.pathname === "/api/v1/user/me") return ok(VIEWER);
    if (url.pathname === "/api/v1/supplier-audit/logs") {
      audits.push(Object.fromEntries(url.searchParams));
      return ok({ items: ROWS, total: ROWS.length, page: 1, pageSize: 20 });
    }
    if (url.pathname === "/api/v1/suppliers/7") return ok(DETAIL);
    if (url.pathname === "/api/v1/suppliers/7/completeness") return ok({ supplierId: 7, issues: [], warnings: [] });
    if (url.pathname === "/api/v1/suppliers/7/bank-accounts") return ok({ items: [], total: 0, page: 1, pageSize: 20 });
    return route.fulfill({ status: 404, headers,
      body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: `unrouted ${request.method()} ${url.pathname}` }, meta: { requestId: "pw" } }) });
  });
  return audits;
}

function collectProblems(page) {
  const problems = [];
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") problems.push(message.text()); });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
  return problems;
}

test("@technical the 變更紀錄 page lists Supplier audit records in Hong Kong time and sends its filters (DEF-035)", async ({ page }) => {
  const problems = collectProblems(page);
  const audits = await installApi(page);
  await page.goto("/suppliers/audit");
  await expect(page.getByText("supplierName：Old Name → New Name")).toBeVisible();
  await expect(page.getByText("maskedAccountNumber：（空） → **** 1234")).toBeVisible();
  // UAT-055：每行嘅 Request ID 要完整、喺畫面入面睇到，唔使橫向捲動（REV-113 M-1）。
  const requestId = page.getByText("6f1c2a9e-0d4b-4c1e-9f3a-2b7d5e8c1a00", { exact: true });
  await expect(requestId).toBeVisible();
  const box = await requestId.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  await expect(page.getByText("notes：0 字 → 10 字")).toBeVisible();
  await expect(page.getByText("編輯供應商")).toBeVisible();
  await expect(page.getByText(/1\/1\/2027\s*上午12:30/u)).toBeVisible();

  await page.getByLabel("由").fill("2026-10-01");
  await page.getByLabel("至").fill("2026-10-02");
  await expect.poll(() => audits.at(-1)).toMatchObject({ from: String(Date.parse("2026-09-30T16:00:00Z")), to: String(Date.parse("2026-10-02T15:59:59.999Z")) });
  await page.getByLabel("操作者").fill("clerk-a");
  await expect.poll(() => audits.at(-1)).toMatchObject({ actor: "clerk-a" });
  // 篩選喺 URL：重新整理之後照樣還原同照樣查（REV-113 M-2）。
  await expect(page).toHaveURL(/actor=clerk-a/u);
  await expect(page).toHaveURL(/from=2026-10-01/u);
  const before = audits.length;
  await page.reload();
  await expect(page.getByLabel("操作者")).toHaveValue("clerk-a");
  await expect.poll(() => audits.length).toBeGreaterThan(before);
  expect(audits.at(-1)).toMatchObject({ actor: "clerk-a", from: String(Date.parse("2026-09-30T16:00:00Z")) });

  await page.getByLabel("由").fill("2026-10-05");
  await expect(page.getByText("結束日期不可早於開始日期")).toBeVisible();
  expect(problems).toEqual([]);
});

test("@technical the Supplier detail has a 變更紀錄 tab that asks only for that Supplier (DEF-035)", async ({ page }) => {
  const problems = collectProblems(page);
  const audits = await installApi(page);
  await page.goto("/suppliers/7");
  await page.getByRole("tab", { name: "變更紀錄" }).click();
  await expect(page.getByText("req-bank")).toBeVisible();
  expect(audits.at(-1)).toMatchObject({ supplierId: "7" });
  expect(problems).toEqual([]);
});
