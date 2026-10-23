import { expect, test } from "@playwright/test";
import { activateViaApi, api, auditRow, closeDb, createDraft, db, loginAs, moduleCall, serviceCall, setStatus, statusAction, statusBadge, unique, watchProblems } from "./uatSupport.js";

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

test("@uat UAT-003 a same-name Supplier with another Code is warned about first, can be confirmed, and is not merged", async ({ page }, testInfo) => {
  await loginAs(page, "CLERK");
  const name = `UAT-003 Harbour Trading ${unique("N")}`;
  const first = await createDraft(page, { name });
  const problems = watchProblems(page);
  const code = unique("UAT003");

  await page.goto("/suppliers/new");
  await page.getByLabel("Supplier Code *").fill(code);
  await page.getByLabel("Supplier Name *").fill(name);
  await page.getByRole("combobox", { name: "Default Currency *" }).click();
  await page.getByRole("option", { name: /^HKD/u }).click();
  await page.getByRole("button", { name: "儲存 Draft" }).click();
  await expect(page.getByText("找到名稱近似的供應商，請確認這不是重複建檔")).toBeVisible();
  await expect(page.getByText(`${first.supplierCode} — ${name}`)).toBeVisible();
  await expect(page.getByText("已建立")).toHaveCount(0);
  await evidence(page, testInfo, "warning");

  await page.getByRole("button", { name: "確認重複提示並繼續" }).click();
  await expect(page.getByText(`供應商 ${code} 已建立`)).toBeVisible();
  await evidence(page, testInfo, "created");

  await page.goto("/suppliers");
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(name);
  await expect(page.locator("tbody tr", { hasText: name })).toHaveCount(2);
  await page.goto(`/suppliers/audit?target=${code}`);
  await expect(page.locator("tbody tr", { hasText: "新增供應商" })).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("@uat UAT-004 the same identifier in another format is refused without revealing the other Supplier", async ({ page }, testInfo) => {
  await loginAs(page, "CLERK");
  const owner = await createDraft(page);
  const value = String(Date.now()).slice(-8);
  await api(page, "POST", `/api/v1/suppliers/${owner.id}/identifiers/create`, { identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: value });
  const other = await createDraft(page);
  const problems = watchProblems(page, { allow: [{ status: 409, path: "/identifiers/create" }] });

  await page.goto(`/suppliers/${other.id}`);
  await page.getByRole("tab", { name: /^識別資料/u }).click();
  await page.getByRole("button", { name: "新增識別資料" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "識別類型 *" }).click();
  await page.getByRole("option", { name: "商業登記" }).click();
  await dialog.getByLabel("發證國家／地區 *").fill("hk");
  await dialog.getByLabel("識別值 *").fill(` ${value.slice(0, 4)}-${value.slice(4)} `);
  await dialog.getByRole("button", { name: "儲存" }).click();
  const error = dialog.locator(".q-banner.bg-negative");
  await expect(error).toBeVisible();
  await expect(error).not.toContainText(owner.supplierCode);
  await expect(error).not.toContainText(owner.supplierName);
  await evidence(page, testInfo, "refused");

  await page.goto(`/suppliers/${owner.id}`);
  await page.getByRole("tab", { name: /^識別資料/u }).click();
  await expect(page.getByText(value)).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("@uat UAT-007 a VIEWER searches, filters, sorts and pages accurately, without Archived by default and without bank plaintext", async ({ browser, page }, testInfo) => {
  const tag = unique("U7");
  const clerkPage = await (await browser.newContext()).newPage();
  await loginAs(clerkPage, "CLERK");
  const suppliers = [];
  for (let index = 0; index < 23; index += 1) {
    // 伺服器每個 IP 每秒 20 個請求（config/requestLimiter.js）：前置資料慢慢開。
    await clerkPage.waitForTimeout(60);
    suppliers.push(await createDraft(clerkPage, { code: `${tag}-${String(index).padStart(2, "0")}`, name: `UAT-007 ${tag} Supplier ${index}` }));
  }
  const phone = `+852 ${String(Date.now()).slice(-8)}`;
  // 列表搜嘅聯絡資料係 Supplier 嘅一般電話同電郵（FR-LIST-002、HD-094 4A），唔係個別聯絡人。
  const target = await api(clerkPage, "GET", `/api/v1/suppliers/${suppliers[5].id}`);
  await api(clerkPage, "POST", `/api/v1/suppliers/${target.id}/update`, { version: target.version, supplierName: target.supplierName, displayName: "",
    defaultCurrencyCode: "HKD", defaultPaymentTermId: null, website: "", generalPhone: phone, generalEmail: "", notes: "" });
  await setStatus(suppliers[22].id, "archived");
  const bankPage = await (await browser.newContext()).newPage();
  const officer = await loginAs(bankPage, "BANK-OFFICER");
  const account = `88${String(Date.now()).slice(-10)}`;
  expect(await moduleCall(bankPage, "/src/services/supplierBank.js", "create", suppliers[5].id,
    { accountHolderName: "UAT Holder", bankName: "UAT Bank", accountNumber: account, isDefault: true, reason: "UAT-007 fixture", password: officer.password }))
    .toMatch(/^ok/u);

  await loginAs(page, "VIEWER");
  const problems = watchProblems(page);
  await page.goto("/suppliers");
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(tag);
  await expect(page).toHaveURL(new RegExp(`q=${tag}`, "u"));
  await expect(page.getByText(/of 22/u)).toBeVisible();
  await expect(page.getByText(`${tag}-22`)).toHaveCount(0);
  await evidence(page, testInfo, "search");

  await page.getByRole("checkbox", { name: "包括已封存" }).click();
  await expect(page.getByText(/of 23/u)).toBeVisible();
  await page.getByRole("checkbox", { name: "包括已封存" }).click();

  await page.getByRole("columnheader", { name: /Code/u }).first().click();
  await page.getByRole("columnheader", { name: /Code/u }).first().click();
  await expect(page.locator("tbody tr").first()).toContainText(`${tag}-21`);
  await page.getByRole("button", { name: /next page|下一頁/iu }).or(page.locator("button[aria-label*='next' i]")).first().click();
  await expect(page.locator("tbody tr").first()).toContainText(`${tag}-01`);
  await evidence(page, testInfo, "sorted-page-2");

  await page.goto("/suppliers");
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(phone);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText(`${tag}-05`);
  await page.getByRole("link", { name: `查看 ${tag}-05 詳情` }).click();
  await expect(page.getByText(`UAT-007 ${tag} Supplier 5`).first()).toBeVisible();
  expect(await page.content()).not.toContain(account);
  await page.getByRole("tab", { name: "銀行資料" }).click();
  await page.waitForLoadState("networkidle");
  expect(await page.content()).not.toContain(account);
  expect(await page.content()).not.toContain(account.slice(0, -4));
  await evidence(page, testInfo, "detail");
  expect(problems).toEqual([]);
});

test("@uat UAT-008 two browsers save the same version: the second gets a conflict, keeps its input and overwrites nothing", async ({ browser, page }, testInfo) => {
  await loginAs(page, "CLERK");
  const supplier = await createDraft(page);
  const other = await (await browser.newContext()).newPage();
  await loginAs(other, "CLERK");
  const problems = watchProblems(other, { allow: [{ status: 409, path: "/update" }] });

  for (const tab of [page, other]) {
    await tab.goto(`/suppliers/${supplier.id}`);
    await tab.getByRole("button", { name: "編輯一般資料" }).click();
  }
  await page.getByLabel("Supplier Name *").fill("UAT-008 saved by A");
  await page.getByRole("button", { name: "儲存一般資料" }).click();
  await expect(page.getByText("版本 2")).toBeVisible();

  await other.getByLabel("Supplier Name *").fill("UAT-008 typed by B");
  await other.getByRole("button", { name: "儲存一般資料" }).click();
  await expect(other.getByText(/供應商已被其他人修改（最新版本 2）/u)).toBeVisible();
  await expect(other.getByLabel("Supplier Name *")).toHaveValue("UAT-008 typed by B");
  await evidence(other, testInfo, "conflict-b");

  await other.reload();
  await expect(other.getByText("UAT-008 saved by A").first()).toBeVisible();
  await expect(other.getByText("UAT-008 typed by B")).toHaveCount(0);
  await expect(await auditRow(other, "編輯供應商")).toHaveCount(1);
  await evidence(other, testInfo, "final");
  expect(problems).toEqual([]);
});
