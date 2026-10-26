import { expect } from "@playwright/test";
import { api, auditRow, createDraft, db, moduleCall, serviceCall, statusAction, statusBadge, test, unique, uatFixture, watchProblems } from "./uatSupport.js";

/**
 * Supplier UAT PHASE-002：啟用審批同 Supplier 設定（07_uat_test_cases.md §4；HD-124 A）。真 server、真 MySQL scratch database，冇 mock。
 * 每個 test 標題只帶一個 UAT ID。審批政策係全域設定：前置用 SQL 開關（07 §2 嘅環境準備），每個 test 之後都還原做 OFF，
 * 唔影響 PHASE-001。UAT-015、040、041 係透過畫面改設定本身，佢哋自己就係驗收步驟。
 */
const evidence = async (page, testInfo, name) => testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

async function setApprovalPolicy(on) {
  await (await db()).execute("UPDATE supplier_settings SET require_activation_approval = ?, version = version + 1 WHERE id = 1", [on ? 1 : 0]);
}

test.afterEach(async () => { await setApprovalPolicy(false); });

const userId = (role) => uatFixture().users[role].id;

/** 前置：一個交咗俾 APPROVER-A 嘅 Pending（經 API，同 UI 用同一個 endpoint）。 */
async function pendingFor(page, approverRole = "APPROVER-A") {
  const draft = await createDraft(page);
  const current = await api(page, "GET", `/api/v1/suppliers/${draft.id}`);
  await api(page, "POST", `/api/v1/suppliers/${draft.id}/activate`, { version: current.version, approverUserId: userId(approverRole) });
  return draft;
}

async function openApproval(page, supplierCode, scope = null) {
  await page.goto("/suppliers/approvals");
  if (scope) await page.getByRole("button", { name: scope }).click();
  await page.getByRole("button", { name: `查看 ${supplierCode} 的審批詳情` }).click();
  await expect(page.getByRole("table", { name: "提交時快照與目前資料比較" })).toBeVisible();
}

/** 只要密碼嘅確認（批准）。 */
async function confirmPassword(page, okLabel, password) {
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=password]").fill(password);
  await dialog.getByRole("button", { name: okLabel }).click();
}

/** 原因＋密碼（拒絕、重新指派、設定）。 */
async function confirmReason(page, okLabel, reason, password) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("原因").fill(reason);
  await dialog.getByLabel("你的密碼").fill(password);
  await dialog.getByRole("button", { name: okLabel }).click();
}

test("@uat UAT-010 with approval on a CLERK submits to APPROVER-A; the Supplier is Pending and the approver sees it in the queue", async ({ as }, testInfo) => {
  await setApprovalPolicy(true);
  const { page } = await as("CLERK");
  const problems = watchProblems(page);
  const code = unique("UAT010");

  await page.goto("/suppliers/new");
  await page.getByLabel("Supplier Code *").fill(code);
  await page.getByLabel("Supplier Name *").fill(`UAT-010 ${code}`);
  await page.getByRole("combobox", { name: "Default Currency *" }).click();
  await page.getByRole("option", { name: /^HKD/u }).click();
  await page.getByRole("combobox", { name: "審批人" }).click();
  await page.getByRole("option", { name: /uat-approver-a/u }).click();
  await page.getByLabel("給審批人的備註（選填）").fill("UAT-010 please review");
  await page.getByRole("button", { name: "提交審批" }).click();
  await expect(page.getByText(`供應商 ${code} 已建立`)).toBeVisible();
  await expect(page.getByText("狀態：待審批")).toBeVisible();
  await evidence(page, testInfo, "submitted");

  const { page: approver } = await as("APPROVER-A");
  await approver.goto("/suppliers/approvals");
  await expect(approver.locator("tbody tr", { hasText: code })).toHaveCount(1);
  await evidence(approver, testInfo, "queue");
  await page.goto(`/suppliers/audit?target=${code}`);
  await expect(page.locator("tbody tr", { hasText: "提交審批" })).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("@uat UAT-011 submitting to oneself, to a user without approval or to a disabled user is refused each time and the Supplier stays Draft", async ({ as }, testInfo) => {
  await setApprovalPolicy(true);
  const { page, account: clerk } = await as("CLERK");
  const draft = await createDraft(page);
  const disabled = userId("APPROVER-B");
  await (await db()).execute("UPDATE users SET status = 'inactive' WHERE id = ?", [disabled]);
  const problems = watchProblems(page, { allow: [{ status: 400, path: "/activate" }] });
  try {
    await page.goto("/suppliers/new");
    await page.getByRole("combobox", { name: "審批人" }).click();
    await expect(page.getByRole("option", { name: /uat-clerk/u })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /uat-viewer/u })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /uat-approver-b/u })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /uat-approver-a/u })).toBeVisible();
    await page.keyboard.press("Escape");
    await evidence(page, testInfo, "options");

    for (const approverUserId of [clerk.id, userId("VIEWER"), disabled]) {
      const current = await api(page, "GET", `/api/v1/suppliers/${draft.id}`);
      expect(await serviceCall(page, "activate", draft.id, { version: current.version, approverUserId })).toMatch(/^400 /u);
    }
    await page.goto(`/suppliers/${draft.id}`);
    await expect(statusBadge(page)).toHaveText("草稿");
    expect(problems).toEqual([]);
  } finally {
    await (await db()).execute("UPDATE users SET status = 'active' WHERE id = ?", [disabled]);
  }
});

test("@uat UAT-012 the assigned APPROVER checks the difference and approves; the Supplier is Active with the submission and approval recorded", async ({ as }, testInfo) => {
  await setApprovalPolicy(true);
  const { page: clerkPage } = await as("CLERK");
  const supplier = await pendingFor(clerkPage);
  const { page, account: approver } = await as("APPROVER-A");
  const problems = watchProblems(page);

  await openApproval(page, supplier.supplierCode);
  await expect(page.getByRole("table", { name: "提交時快照與目前資料比較" })).toContainText(supplier.supplierName);
  await evidence(page, testInfo, "diff");
  await page.getByRole("button", { name: "批准" }).click();
  await confirmPassword(page, "批准", approver.password);
  await expect(page.getByText(`${supplier.supplierCode}：已批准，供應商已啟用`)).toBeVisible();

  await page.goto(`/suppliers/${supplier.id}`);
  await expect(statusBadge(page)).toHaveText("啟用");
  await expect(await auditRow(page, "提交審批")).toHaveCount(1);
  await expect(page.locator("tbody tr", { hasText: "批准" }).first()).toBeVisible();
  await evidence(page, testInfo, "audit");
  expect(problems).toEqual([]);
});

test("@uat UAT-013 the APPROVER rejects with a reason; the Supplier returns to Draft and the CLERK can read the reason", async ({ as }, testInfo) => {
  await setApprovalPolicy(true);
  const { page: clerkPage } = await as("CLERK");
  const supplier = await pendingFor(clerkPage);
  const { page, account: approver } = await as("APPROVER-A");
  const problems = watchProblems(page);

  await openApproval(page, supplier.supplierCode);
  await page.getByRole("button", { name: "拒絕" }).click();
  await confirmReason(page, "拒絕", "UAT-013 missing business registration", approver.password);
  await expect(page.getByText(`${supplier.supplierCode}：已拒絕，供應商回到草稿`)).toBeVisible();
  expect(problems).toEqual([]);

  await clerkPage.goto(`/suppliers/${supplier.id}`);
  await expect(statusBadge(clerkPage)).toHaveText("草稿");
  const row = await auditRow(clerkPage, "拒絕");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("UAT-013 missing business registration");
  await evidence(clerkPage, testInfo, "clerk-sees-reason");
});

test("@uat UAT-014 an approval-significant edit invalidates the Pending request; the old request cannot be approved and the CLERK must submit again", async ({ as }, testInfo) => {
  await setApprovalPolicy(true);
  const { page: clerkPage } = await as("CLERK");
  const supplier = await pendingFor(clerkPage);

  await clerkPage.goto(`/suppliers/${supplier.id}`);
  await clerkPage.getByRole("button", { name: "編輯一般資料" }).click();
  await clerkPage.getByLabel("Supplier Name *").fill(`${supplier.supplierName} renamed`);
  await clerkPage.getByRole("button", { name: "儲存一般資料" }).click();
  await expect(statusBadge(clerkPage)).toHaveText("草稿");
  await evidence(clerkPage, testInfo, "edited");

  const { page, account: approver } = await as("APPROVER-A");
  await page.goto("/suppliers/approvals");
  await expect(page.locator("tbody tr", { hasText: supplier.supplierCode })).toHaveCount(0);
  const [[request]] = await (await db()).query("SELECT id, version FROM supplier_activation_requests WHERE supplier_id = ? ORDER BY id DESC LIMIT 1", [supplier.id]);
  expect(await moduleCall(page, "/src/services/supplierApproval.js", "approve", request.id, { password: approver.password, version: request.version }))
    .toMatch(/^409 /u);
  await expect(await auditRow(clerkPage, "審批申請失效")).toHaveCount(1);

  // 重新提交：喺詳情頁再按「啟用」揀審批人（設計 §7.4，DEF-042）。
  await clerkPage.goto(`/suppliers/${supplier.id}`);
  await clerkPage.getByRole("button", { name: "啟用", exact: true }).click();
  const dialog = clerkPage.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "審批人" }).click();
  await clerkPage.getByRole("option", { name: /uat-approver-a/u }).click();
  await dialog.getByRole("button", { name: "確認提交審批" }).click();
  await expect(statusBadge(clerkPage)).toHaveText("待審批");
  await page.goto("/suppliers/approvals");
  await expect(page.locator("tbody tr", { hasText: supplier.supplierCode })).toHaveCount(1);
  await evidence(clerkPage, testInfo, "resubmitted");
});

test("@uat UAT-015 turning approval off leaves an existing Pending waiting, while a new Supplier activates directly", async ({ as }, testInfo) => {
  await setApprovalPolicy(true);
  const { page: clerkPage } = await as("CLERK");
  const waiting = await pendingFor(clerkPage);
  const { page, account: admin } = await as("SETTINGS-ADMIN");
  const problems = watchProblems(page);

  await page.goto("/suppliers/settings");
  await page.getByRole("switch", { name: "啟用供應商前需要另一名使用者審批" }).click();
  await confirmReason(page, "確認儲存", "UAT-015 approval no longer required", admin.password);
  await expect(page.getByText("已關閉啟用審批")).toBeVisible();
  await evidence(page, testInfo, "off");
  expect(problems).toEqual([]);

  await clerkPage.goto(`/suppliers/${waiting.id}`);
  await expect(statusBadge(clerkPage)).toHaveText("待審批");
  const fresh = await createDraft(clerkPage);
  await clerkPage.goto(`/suppliers/${fresh.id}`);
  await statusAction(clerkPage, "啟用");
  await expect(statusBadge(clerkPage)).toHaveText("啟用");
  await clerkPage.goto("/suppliers/audit?action=setting.update");
  await expect(clerkPage.locator("tbody tr", { hasText: "UAT-015 approval no longer required" })).toHaveCount(1);
});

test("@uat UAT-040 a CLERK without settings permission is refused by the page and the API, and the value does not change", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const problems = watchProblems(page, { allow: [{ status: 403, path: "/supplier-settings/update" }] });
  const [[before]] = await (await db()).query("SELECT require_activation_approval, version FROM supplier_settings WHERE id = 1");

  await page.goto("/suppliers/settings");
  await expect(page).toHaveURL(/\/403$/u);
  await expect(page.getByText("你冇權限查看呢一頁。")).toBeVisible();
  await evidence(page, testInfo, "forbidden");
  expect(await moduleCall(page, "/src/services/supplierSettings.js", "update",
    { requireActivationApproval: true, version: before.version, reason: "UAT-040 attempt", password: "x" })).toMatch(/^40[03] /u);
  const [[after]] = await (await db()).query("SELECT require_activation_approval, version FROM supplier_settings WHERE id = 1");
  expect(after).toEqual(before);
  expect(problems).toEqual([]);
});

test("@uat UAT-041 SETTINGS-ADMIN turns approval on with a reason; the next submission needs an approver and the change is in Audit", async ({ as }, testInfo) => {
  const { page, account: admin } = await as("SETTINGS-ADMIN");
  const problems = watchProblems(page);

  await page.goto("/suppliers/settings");
  await page.getByRole("switch", { name: "啟用供應商前需要另一名使用者審批" }).click();
  await confirmReason(page, "確認儲存", "UAT-041 dual control from today", admin.password);
  await expect(page.getByText("已開啟啟用審批")).toBeVisible();
  await evidence(page, testInfo, "on");
  expect(problems).toEqual([]);

  const { page: clerkPage } = await as("CLERK");
  await clerkPage.goto("/suppliers/new");
  await expect(clerkPage.getByRole("combobox", { name: "審批人" })).toBeVisible();
  await expect(clerkPage.getByRole("button", { name: "提交審批" })).toBeVisible();
  await clerkPage.goto("/suppliers/audit?action=setting.update");
  const row = clerkPage.locator("tbody tr", { hasText: "UAT-041 dual control from today" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("requireActivationApproval");
  await evidence(clerkPage, testInfo, "audit");
});

test("@uat UAT-052 the requester withdraws, resubmits, an approver reassigns with a reason, and only the new assignee can decide", async ({ as }, testInfo) => {
  await setApprovalPolicy(true);
  const { page: clerkPage } = await as("CLERK");
  const supplier = await pendingFor(clerkPage);
  const problems = watchProblems(clerkPage);

  // 撤回係提交人（CLERK）喺詳情做（DEF-043）。
  await clerkPage.goto(`/suppliers/${supplier.id}`);
  await expect(clerkPage.getByTestId("pending-approval")).toContainText("待 UAT APPROVER-A 審批（UAT CLERK 提交）");
  await clerkPage.getByRole("button", { name: "撤回審批" }).click();
  await clerkPage.getByRole("dialog").getByRole("button", { name: "撤回" }).click();
  await expect(statusBadge(clerkPage)).toHaveText("草稿");
  await evidence(clerkPage, testInfo, "withdrawn");

  // 重新提交：詳情頁嘅啟用揀審批人（DEF-042）。
  await clerkPage.getByRole("button", { name: "啟用", exact: true }).click();
  const dialog = clerkPage.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "審批人" }).click();
  await clerkPage.getByRole("option", { name: /uat-approver-a/u }).click();
  await dialog.getByRole("button", { name: "確認提交審批" }).click();
  await expect(statusBadge(clerkPage)).toHaveText("待審批");
  expect(problems).toEqual([]);

  // APPROVER-A 填原因改派俾 APPROVER-B。
  const { page: oldPage, account: oldApprover } = await as("APPROVER-A");
  await openApproval(oldPage, supplier.supplierCode);
  await oldPage.getByRole("combobox", { name: "改派給" }).click();
  await oldPage.getByRole("option", { name: /uat-approver-b/u }).click();
  await oldPage.getByRole("button", { name: "重新指派" }).click();
  await confirmReason(oldPage, "重新指派", "UAT-052 on leave this week", oldApprover.password);
  await expect(oldPage.getByText(new RegExp(`${supplier.supplierCode}：`, "u")).first()).toBeVisible();
  await evidence(oldPage, testInfo, "reassigned");

  // 舊審批人唔可以再決定。
  await openApproval(oldPage, supplier.supplierCode, "全部待處理");
  await expect(oldPage.getByRole("button", { name: "批准" })).toBeDisabled();
  await expect(oldPage.getByRole("button", { name: "拒絕" })).toBeDisabled();

  // 新審批人批准。
  const { page: newPage, account: newApprover } = await as("APPROVER-B");
  await openApproval(newPage, supplier.supplierCode);
  await newPage.getByRole("button", { name: "批准" }).click();
  await confirmPassword(newPage, "批准", newApprover.password);
  await expect(newPage.getByText(`${supplier.supplierCode}：已批准，供應商已啟用`)).toBeVisible();

  await clerkPage.goto(`/suppliers/${supplier.id}`);
  await expect(statusBadge(clerkPage)).toHaveText("啟用");
  for (const action of ["撤回審批", "改派審批人"]) await expect(await auditRow(clerkPage, action)).toHaveCount(1);
  await expect(clerkPage.locator("tbody tr", { hasText: "UAT-052 on leave this week" })).toHaveCount(1);
  await evidence(clerkPage, testInfo, "audit");
});
