import { expect, test } from "@playwright/test";
import { activateViaApi, api, auditRow, closeDb, createDraft, db, loginAs, serviceCall, setStatus, statusAction, statusBadge, unique, watchProblems } from "./uatSupport.js";

/**
 * Supplier UAT PHASE-001（07_uat_test_cases.md §4；HD-124 A）。真 server、真 MySQL scratch database，冇 mock。
 * 每個 test 標題只帶一個 UAT ID；證據係畫面、Audit 頁同 Correlation ID（request ID），截圖掛喺 test 報告。
 */
test.afterAll(closeDb);

const evidence = async (page, testInfo, name) => testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

test("@uat UAT-001 a CLERK creates a Draft from code, name and currency, finds it, opens it and traces the create in Audit", async ({ page }, testInfo) => {
  await loginAs(page, "CLERK");
  const problems = watchProblems(page);
  const code = unique("UAT001");
  const name = `UAT-001 Evergreen ${code}`;

  await page.goto("/suppliers/new");
  await page.getByLabel("Supplier Code *").fill(code);
  await page.getByLabel("Supplier Name *").fill(name);
  await page.getByRole("combobox", { name: "Default Currency *" }).click();
  await page.getByRole("option", { name: /^HKD/u }).click();
  await page.getByRole("button", { name: "儲存 Draft" }).click();
  await expect(page.getByText(`供應商 ${code} 已建立`)).toBeVisible();
  await expect(page.getByText("狀態：草稿")).toBeVisible();
  await evidence(page, testInfo, "created");

  await page.goto("/suppliers");
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(code);
  const row = page.locator("tbody tr", { hasText: code });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(name);
  await expect(row).toContainText("草稿");
  await row.getByRole("link", { name: `查看 ${code} 詳情` }).click();

  await expect(page.getByText(code).first()).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByText("HKD").first()).toBeVisible();
  await evidence(page, testInfo, "detail");

  await page.getByRole("tab", { name: "變更紀錄" }).click();
  const created = page.locator("tbody tr", { hasText: "新增供應商" });
  await expect(created).toHaveCount(1);
  const [[audit]] = await (await db()).query(
    "SELECT request_id FROM supplier_audit_logs WHERE action = 'supplier.create' AND target_label = ?", [code]);
  await expect(created).toContainText(audit.request_id);
  await expect(created).toContainText("uat-clerk");
  await evidence(page, testInfo, "audit");
  expect(problems).toEqual([]);
});

test("@uat UAT-002 a CLERK cannot create a second Supplier whose Code differs only in case", async ({ page }, testInfo) => {
  await loginAs(page, "CLERK");
  const existing = await createDraft(page, { code: unique("SUP") });
  const problems = watchProblems(page, { allow: [{ status: 409, path: "/api/v1/suppliers/create" }] });

  await page.goto("/suppliers/new");
  await page.getByLabel("Supplier Code *").fill(existing.supplierCode.toLowerCase());
  await page.getByLabel("Supplier Name *").fill("UAT-002 Another Name");
  await page.getByRole("combobox", { name: "Default Currency *" }).click();
  await page.getByRole("option", { name: /^HKD/u }).click();
  await page.getByRole("button", { name: "儲存 Draft" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "這個 Supplier Code 已被使用" }).first()).toBeVisible();
  await expect(page.getByText("已建立")).toHaveCount(0);
  await evidence(page, testInfo, "refused");

  await page.goto("/suppliers");
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(existing.supplierCode);
  await expect(page.locator("tbody tr", { hasText: existing.supplierCode })).toHaveCount(1);
  await expect(page.getByText("UAT-002 Another Name")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("@uat UAT-006 a CLERK corrects an unreferenced Draft's Code after re-authentication, and Audit keeps before, after and reason", async ({ page }, testInfo) => {
  const clerk = await loginAs(page, "CLERK");
  const draft = await createDraft(page);
  const problems = watchProblems(page);
  const next = unique("UAT006");

  await page.goto(`/suppliers/${draft.id}`);
  await page.getByRole("button", { name: "受控修正 Supplier Code" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("新 Supplier Code *").fill(next);
  await dialog.getByLabel("修正原因 *").fill("UAT-006 typo in the code");
  await dialog.getByLabel("目前密碼 *").fill(clerk.password);
  await dialog.getByRole("button", { name: "確認修正" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByText(next).first()).toBeVisible();
  await evidence(page, testInfo, "detail");

  const row = await auditRow(page, "修改供應商編號");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(draft.supplierCode);
  await expect(row).toContainText(next);
  await expect(row).toContainText("UAT-006 typo in the code");
  await evidence(page, testInfo, "audit");
  expect(problems).toEqual([]);
});

test("@uat UAT-009 with approval off a CLERK activates a complete Draft directly and Audit records it", async ({ page }, testInfo) => {
  await loginAs(page, "CLERK");
  const draft = await createDraft(page);
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${draft.id}`);
  await expect(statusBadge(page)).toHaveText("草稿");
  await statusAction(page, "啟用");
  await expect(statusBadge(page)).toHaveText("啟用");
  await page.reload();
  await expect(statusBadge(page)).toHaveText("啟用");
  await evidence(page, testInfo, "active");

  await expect(await auditRow(page, "啟用")).toHaveCount(1);
  await evidence(page, testInfo, "audit");
  expect(problems).toEqual([]);
});

test("@uat UAT-017 a CLERK without approval cannot unblock a Blocked Supplier, in the UI or by request", async ({ page }, testInfo) => {
  const clerk = await loginAs(page, "CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  await setStatus(supplier.id, "blocked");
  const problems = watchProblems(page, { allow: [{ status: 403, path: "/unblock" }] });

  await page.goto(`/suppliers/${supplier.id}`);
  await expect(statusBadge(page)).toHaveText("已封鎖");
  await expect(page.getByRole("button", { name: "解除封鎖" })).toHaveCount(0);
  await evidence(page, testInfo, "no-unblock");

  const current = await api(page, "GET", `/api/v1/suppliers/${supplier.id}`);
  // 同 UI 一樣用已核准設備簽名送出：拒絕係因為冇 supplier.approval，唔係因為冇簽名。
  expect(await serviceCall(page, "unblock", supplier.id, { version: current.version, reason: "UAT-017 attempt", password: clerk.password }))
    .toBe("403 Forbidden");
  await page.reload();
  await expect(statusBadge(page)).toHaveText("已封鎖");
  expect(problems).toEqual([]);
});

test("@uat UAT-018 an APPROVER unblocks with a reason and the Supplier becomes Suspended, not Active", async ({ page }, testInfo) => {
  const approver = await loginAs(page, "APPROVER-A");
  const [[row]] = await (await db()).query("SELECT id FROM users WHERE username = 'uat-clerk'");
  const code = unique("UAT018");
  const now = Date.now();
  const [inserted] = await (await db()).execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code, status, version,
       created_at, updated_at, created_by, updated_by, website, general_phone, general_email, notes)
     VALUES (?, ?, ?, ?, '', 'HKD', 'blocked', 1, ?, ?, ?, ?, '', '', '', '')`, [code, code, `UAT-018 ${code}`, `uat-018 ${code}`.toLowerCase(), now, now, row.id, row.id]);
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${inserted.insertId}`);
  await expect(statusBadge(page)).toHaveText("已封鎖");
  await statusAction(page, "解除封鎖", { reason: "UAT-018 dispute resolved", password: approver.password });
  await expect(statusBadge(page)).toHaveText("已暫停");
  await page.reload();
  await expect(statusBadge(page)).toHaveText("已暫停");
  await evidence(page, testInfo, "suspended");

  const audit = await auditRow(page, "解除封鎖");
  await expect(audit).toHaveCount(1);
  await expect(audit).toContainText("UAT-018 dispute resolved");
  expect(problems).toEqual([]);
});

test("@uat UAT-019 a CLERK restores an Archived Supplier to Suspended, and only a second, explicit step makes it Active", async ({ page }, testInfo) => {
  const clerk = await loginAs(page, "CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  await setStatus(supplier.id, "archived");
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${supplier.id}`);
  await expect(statusBadge(page)).toHaveText("已封存");
  await statusAction(page, "還原", { reason: "UAT-019 needed again", password: clerk.password });
  await expect(statusBadge(page)).toHaveText("已暫停");
  await evidence(page, testInfo, "restored");
  await statusAction(page, "重新啟用", { reason: "UAT-019 back in use", password: clerk.password });
  await expect(statusBadge(page)).toHaveText("啟用");
  await evidence(page, testInfo, "active");

  await expect(await auditRow(page, "還原")).toHaveCount(1);
  await expect(page.locator("tbody tr", { hasText: "重新啟用" })).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("@uat UAT-020 a CLERK permanently deletes a never-activated Draft after re-authentication, and the delete stays traceable", async ({ page }, testInfo) => {
  const clerk = await loginAs(page, "CLERK");
  const draft = await createDraft(page);
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${draft.id}`);
  await statusAction(page, "永久刪除", { reason: "UAT-020 created by mistake", password: clerk.password });
  await expect(page.getByText(`供應商 ${draft.supplierCode} 已永久刪除`)).toBeVisible();
  await evidence(page, testInfo, "deleted");

  await page.goto("/suppliers");
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(draft.supplierCode);
  await expect(page.getByText("冇資料")).toBeVisible();

  await page.goto(`/suppliers/audit?target=${draft.supplierCode}`);
  const row = page.locator("tbody tr", { hasText: "永久刪除" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("UAT-020 created by mistake");
  await evidence(page, testInfo, "audit");
  expect(problems).toEqual([]);
});

test("@uat UAT-021 a Supplier that was ever activated cannot be permanently deleted; suspend and archive remain the options", async ({ page }, testInfo) => {
  const clerk = await loginAs(page, "CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  const problems = watchProblems(page, { allow: [{ status: 409, path: "/delete" }] });

  await page.goto(`/suppliers/${supplier.id}`);
  await expect(statusBadge(page)).toHaveText("啟用");
  await expect(page.getByRole("button", { name: "永久刪除" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "暫停", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "封存", exact: true })).toBeVisible();
  await evidence(page, testInfo, "options");

  const current = await api(page, "GET", `/api/v1/suppliers/${supplier.id}`);
  expect(await serviceCall(page, "deleteSupplier", supplier.id, { version: current.version, reason: "UAT-021 attempt", password: clerk.password }))
    .toBe("409 SUPPLIER_DELETE_NOT_ALLOWED");
  await page.reload();
  await expect(statusBadge(page)).toHaveText("啟用");
  expect(problems).toEqual([]);
});

test("@uat UAT-022 a Supplier with only the three minimum fields shows completeness hints and still activates", async ({ page }, testInfo) => {
  await loginAs(page, "CLERK");
  const draft = await createDraft(page);
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${draft.id}`);
  for (const hint of ["尚未設定預設付款條款", "尚未設定採購用途地址", "尚未設定訂單用途主要聯絡人", "尚未設定供應商識別資料", "尚未設定銀行帳戶"]) {
    await expect(page.getByText(hint)).toBeVisible();
  }
  await evidence(page, testInfo, "hints");
  await statusAction(page, "啟用");
  await expect(statusBadge(page)).toHaveText("啟用");
  await evidence(page, testInfo, "active");
  expect(problems).toEqual([]);
});
