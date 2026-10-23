import { expect } from "@playwright/test";
import { activateViaApi, api, auditRow, createDraft, db, moduleCall, serviceCall, setStatus, statusAction, statusBadge, test, unique, watchProblems } from "./uatSupport.js";

/**
 * Supplier UAT PHASE-001（07_uat_test_cases.md §4；HD-124 A）。真 server、真 MySQL scratch database，冇 mock。
 * 每個 test 標題只帶一個 UAT ID；證據係畫面、Audit 頁同 Correlation ID（request ID），截圖掛喺 test 報告。
 */
const evidence = async (page, testInfo, name) => testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

test("@uat UAT-001 a CLERK creates a Draft from code, name and currency, finds it, opens it and traces the create in Audit", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
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

test("@uat UAT-002 a CLERK cannot create a second Supplier whose Code differs only in case", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
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

test("@uat UAT-006 a CLERK corrects an unreferenced Draft's Code after re-authentication, and Audit keeps before, after and reason", async ({ as }, testInfo) => {
  const { page, account: clerk } = await as("CLERK");
  const draft = await createDraft(page);
  const problems = watchProblems(page, { allow: [{ status: 403, path: "/code/change" }] });
  const next = unique("UAT006");

  await page.goto(`/suppliers/${draft.id}`);
  await page.getByRole("button", { name: "受控修正 Supplier Code" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("新 Supplier Code *").fill(next);
  await dialog.getByLabel("修正原因 *").fill("UAT-006 typo in the code");
  // 重新認證係真嘅：錯密碼唔改（REV-115 L-4）。
  await dialog.getByLabel("目前密碼 *").fill(`${clerk.password}-wrong`);
  await dialog.getByRole("button", { name: "確認修正" }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "請確認你目前的密碼" })).toBeVisible();
  await expect(dialog).toBeVisible();
  expect((await api(page, "GET", `/api/v1/suppliers/${draft.id}`)).supplierCode).toBe(draft.supplierCode);
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

test("@uat UAT-009 with approval off a CLERK activates a complete Draft directly and Audit records it", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
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

test("@uat UAT-017 a CLERK without approval cannot unblock a Blocked Supplier, in the UI or by request", async ({ as }, testInfo) => {
  const { page, account: clerk } = await as("CLERK");
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

test("@uat UAT-018 an APPROVER unblocks with a reason and the Supplier becomes Suspended, not Active", async ({ as }, testInfo) => {
  const { page: clerkPage } = await as("CLERK");
  const supplier = await createDraft(clerkPage);
  await activateViaApi(clerkPage, supplier.id);
  await setStatus(supplier.id, "blocked");
  const { page, account: approver } = await as("APPROVER-A");
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${supplier.id}`);
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

test("@uat UAT-019 a CLERK restores an Archived Supplier to Suspended, and only a second, explicit step makes it Active", async ({ as }, testInfo) => {
  const { page, account: clerk } = await as("CLERK");
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

test("@uat UAT-020 a CLERK permanently deletes a never-activated Draft after re-authentication, and the delete stays traceable", async ({ as }, testInfo) => {
  const { page, account: clerk } = await as("CLERK");
  const draft = await createDraft(page);
  const problems = watchProblems(page, { allow: [{ status: 404, path: `/api/v1/suppliers/${draft.id}` }, { status: 404, path: `/api/v1/suppliers/${draft.id}/completeness` }] });

  await page.goto(`/suppliers/${draft.id}`);
  await statusAction(page, "永久刪除", { reason: "UAT-020 created by mistake", password: clerk.password });
  await expect(page.getByText(`供應商 ${draft.supplierCode} 已永久刪除`)).toBeVisible();
  await evidence(page, testInfo, "deleted");

  // 真係刪咗，唔係封存咗：詳情搵唔到，連「包括已封存」都冇（REV-115 M-1）。
  await page.goto(`/suppliers/${draft.id}`);
  await expect(page.getByText("找不到這個供應商")).toBeVisible();
  await expect(page.getByRole("link", { name: "返回供應商列表" }).or(page.getByRole("button", { name: "返回供應商列表" }))).toBeVisible();
  await page.goto("/suppliers");
  await page.getByRole("checkbox", { name: "包括已封存" }).click();
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(draft.supplierCode);
  await expect(page.getByText("冇資料")).toBeVisible();

  await page.goto(`/suppliers/audit?target=${draft.supplierCode}`);
  const row = page.locator("tbody tr", { hasText: "永久刪除" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("UAT-020 created by mistake");
  await evidence(page, testInfo, "audit");
  expect(problems).toEqual([]);
});

test("@uat UAT-021 a Supplier that was ever activated cannot be permanently deleted; suspend and archive remain the options", async ({ as }, testInfo) => {
  const { page, account: clerk } = await as("CLERK");
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

test("@uat UAT-022 a Supplier with only the three minimum fields shows completeness hints and still activates", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
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

test("@uat UAT-003 a same-name Supplier with another Code is warned about first, can be confirmed, and is not merged", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
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
  const created = page.locator("tbody tr", { hasText: "新增供應商" });
  await expect(created).toHaveCount(1);
  expect(problems).toEqual([]);
  // AC-003：Audit 記低使用者確認咗嘅相似名稱候選（DEF-039；HD-132 B 當 AC-003 係純確認，唔使填原因）。
  await expect(created).toContainText(first.supplierCode);
});

test("@uat UAT-004 the same identifier in another format is refused without revealing the other Supplier", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
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

test("@uat UAT-007 a VIEWER searches, filters, sorts and pages accurately, without Archived by default and without bank plaintext", async ({ as }, testInfo) => {
  const tag = unique("U7");
  const { page: clerkPage } = await as("CLERK");
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
  const { page: bankPage, account: officer } = await as("BANK-OFFICER");
  const account = `88${String(Date.now()).slice(-10)}`;
  expect(await moduleCall(bankPage, "/src/services/supplierBank.js", "create", suppliers[5].id,
    { accountHolderName: "UAT Holder", bankName: "UAT Bank", accountNumber: account, isDefault: true, reason: "UAT-007 fixture", password: officer.password }))
    .toMatch(/^ok/u);

  const { page } = await as("VIEWER");
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

test("@uat UAT-008 two browsers save the same version: the second gets a conflict, keeps its input and overwrites nothing", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  const { page: other } = await as("CLERK", { session: 2 });
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

/** 聯絡人／地址清單入面某一項（以名稱或標籤搵）。 */
const listItem = (page, text) => page.locator(".q-item", { hasText: text });

test("@uat UAT-023 setting another contact as primary for a purpose leaves exactly one primary", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  await api(page, "POST", `/api/v1/suppliers/${supplier.id}/contacts/create`, { name: "UAT-023 Old Primary", purposes: [{ purposeCode: "orders", isPrimary: true }] });
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${supplier.id}`);
  await page.getByRole("tab", { name: /^聯絡人/u }).click();
  await expect(listItem(page, "UAT-023 Old Primary")).toContainText("訂單聯絡（主要）");
  await page.getByRole("button", { name: "新增聯絡人" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("姓名 *").fill("UAT-023 New Primary");
  await dialog.getByRole("checkbox", { name: "訂單聯絡" }).click();
  await dialog.locator(".row", { hasText: "訂單聯絡" }).getByRole("switch", { name: "主要" }).click();
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toBeHidden();

  await expect(listItem(page, "UAT-023 New Primary")).toContainText("訂單聯絡（主要）");
  await expect(listItem(page, "UAT-023 Old Primary")).toContainText("訂單聯絡");
  await expect(listItem(page, "UAT-023 Old Primary")).not.toContainText("（主要）");
  await expect(page.getByText("訂單聯絡（主要）")).toHaveCount(1);
  await evidence(page, testInfo, "contacts");
  await expect(await auditRow(page, "新增聯絡人")).toHaveCount(2);
  expect(problems).toEqual([]);
});

test("@uat UAT-049 a purpose holds several contacts, primary switches cleanly, and a deactivated contact stays as history", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  await api(page, "POST", `/api/v1/suppliers/${supplier.id}/contacts/create`, { name: "UAT-049 Buyer One", purposes: [{ purposeCode: "orders", isPrimary: true }] });
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${supplier.id}`);
  await page.getByRole("tab", { name: /^聯絡人/u }).click();
  await page.getByRole("button", { name: "新增聯絡人" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("姓名 *").fill("UAT-049 Buyer Two");
  await dialog.getByRole("checkbox", { name: "訂單聯絡" }).click();
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toBeHidden();
  await expect(listItem(page, "UAT-049 Buyer Two")).toContainText("訂單聯絡");
  await expect(listItem(page, "UAT-049 Buyer One")).toContainText("訂單聯絡（主要）");

  await page.getByRole("button", { name: "編輯聯絡人 UAT-049 Buyer Two" }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator(".row", { hasText: "訂單聯絡" }).getByRole("switch", { name: "主要" }).click();
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toBeHidden();
  await expect(listItem(page, "UAT-049 Buyer Two")).toContainText("訂單聯絡（主要）");
  await expect(page.getByText("訂單聯絡（主要）")).toHaveCount(1);

  await page.getByRole("button", { name: "停用聯絡人 UAT-049 Buyer One" }).click();
  const confirm = page.getByRole("dialog");
  if (await confirm.isVisible()) await confirm.getByRole("button", { name: /確認|停用/u }).last().click();
  await expect(listItem(page, "UAT-049 Buyer One")).toContainText("已停用");
  await expect(page.getByRole("button", { name: "編輯聯絡人 UAT-049 Buyer One" })).toHaveCount(0);
  await evidence(page, testInfo, "contacts");
  await expect(await auditRow(page, "停用聯絡人")).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("@uat UAT-042 a VIEWER cannot write from the UI, by URL or by request, and a user without Supplier access learns nothing", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  const { page: viewerPage, account: viewer } = await as("VIEWER");
  const problems = watchProblems(viewerPage, { allow: [{ status: 403, path: "/update" }, { status: 403, path: "/create" }] });

  await viewerPage.goto("/suppliers");
  await expect(viewerPage.getByRole("button", { name: "新增供應商" }).or(viewerPage.getByRole("link", { name: "新增供應商" }))).toHaveCount(0);
  await viewerPage.goto(`/suppliers/${supplier.id}`);
  await expect(viewerPage.getByText(supplier.supplierCode).first()).toBeVisible();
  for (const label of ["編輯一般資料", "受控修正 Supplier Code", "啟用", "永久刪除", "封存"]) {
    await expect(viewerPage.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  }
  await evidence(viewerPage, testInfo, "viewer-detail");
  await viewerPage.goto("/suppliers/new");
  await expect(viewerPage).toHaveURL(/\/403$/u);

  const before = await api(page, "GET", `/api/v1/suppliers/${supplier.id}`);
  expect(await serviceCall(viewerPage, "update", supplier.id, { version: before.version, supplierName: "UAT-042 hijack", displayName: "", defaultCurrencyCode: "HKD",
    defaultPaymentTermId: null, website: "", generalPhone: "", generalEmail: "", notes: "" })).toBe("403 Forbidden");
  expect(await serviceCall(viewerPage, "create", { supplierCode: unique("UAT042"), supplierName: "UAT-042 forbidden", defaultCurrencyCode: "HKD" })).toBe("403 Forbidden");
  const after = await api(page, "GET", `/api/v1/suppliers/${supplier.id}`);
  expect(after.version).toBe(before.version);
  expect(after.supplierName).toBe(before.supplierName);
  const [[{ writes }]] = await (await db()).query("SELECT COUNT(*) AS writes FROM supplier_audit_logs WHERE actor_user_id = ?", [viewer.id]);
  expect(writes).toBe(0);
  expect(problems).toEqual([]);

  const { page: outsider } = await as("NOACCESS");
  for (const path of [`/suppliers/${supplier.id}`, "/suppliers/999999999", "/suppliers"]) {
    await outsider.goto(path);
    await expect(outsider).toHaveURL(/\/403$/u);
  }
  await evidence(outsider, testInfo, "no-access");
  const existing = await moduleCall(outsider, "/src/services/supplier.js", "getById", supplier.id);
  const missing = await moduleCall(outsider, "/src/services/supplier.js", "getById", 999999999);
  expect(existing).toBe("403 Forbidden");
  expect(missing).toBe(existing);
});

test("@uat UAT-054 the Supplier list tells loading, empty, failed and no-permission apart, and a failed load can be retried", async ({ as }, testInfo) => {
  const { page } = await as("VIEWER");
  // 慢回應同依賴錯誤喺真環境無法安全觸發：只有呢個 case 喺瀏覽器攔截列表請求，延遲或者回 503，其餘照行真 server。
  let mode = "slow";
  await page.route("**/api/v1/suppliers?**", async (route) => {
    if (mode === "slow") { await new Promise((resolve) => { setTimeout(resolve, 2_500); }); return route.continue(); }
    if (mode === "fail") return route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "供應商資料暫時無法載入" }, meta: { requestId: "uat-054" } }) });
    return route.continue();
  });
  const problems = watchProblems(page, { allow: [{ status: 503, path: "/api/v1/suppliers" }] });
  await page.goto("/suppliers");
  await expect(page.getByText("載入中…")).toBeVisible();
  await evidence(page, testInfo, "loading");
  await expect(page.getByText("載入中…")).toBeHidden({ timeout: 15_000 });

  mode = "live";
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(`no-such-supplier-${Date.now()}`);
  await expect(page.getByText("冇資料")).toBeVisible();
  await evidence(page, testInfo, "empty");

  mode = "fail";
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill("UAT");
  await expect(page.getByRole("alert").filter({ hasText: "服務暫時無法使用，請稍後再試" })).toBeVisible();
  await expect(page.getByText("冇資料")).toHaveCount(0);
  await evidence(page, testInfo, "error");
  mode = "live";
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "服務暫時無法使用，請稍後再試" })).toBeHidden();
  expect(problems).toEqual([]);

  const { page: outsider } = await as("NOACCESS");
  const outsiderProblems = watchProblems(outsider);
  await outsider.goto("/suppliers");
  await expect(outsider).toHaveURL(/\/403$/u);
  await expect(outsider.getByText("你冇權限查看呢一頁。")).toBeVisible();
  await evidence(outsider, testInfo, "no-permission");
  expect(outsiderProblems).toEqual([]);
});

test("@uat UAT-031 forms offer only Active currencies and terms, an old inactive value still shows, and Supplier Settings cannot write the catalogue", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  const tag = unique("T31");
  const inactiveCurrency = `Q${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
  const now = Date.now();
  const database = await db();
  await database.execute("INSERT INTO currencies (code, name, decimal_places, status, version, created_at, updated_at) VALUES (?, 'UAT-031 Retired Currency', 2, 'INACTIVE', 1, ?, ?)",
    [inactiveCurrency, now, now]);
  for (const [code, status] of [[`${tag}-ACT`, "ACTIVE"], [`${tag}-OLD`, "INACTIVE"]]) {
    await database.execute(`INSERT INTO payment_terms (code, code_key, name, calculation_type, due_days, status, version, created_at, updated_at)
      VALUES (?, ?, ?, 'NET_DAYS', 30, ?, 1, ?, ?)`, [code, code, `UAT-031 ${code}`, status, now, now]);
  }
  const [[oldTerm]] = await database.query("SELECT id FROM payment_terms WHERE code = ?", [`${tag}-OLD`]);
  // 前置：呢個 Supplier 當日揀嘅幣別同付款條件，後來喺 Business Master 停用咗。
  await database.execute("UPDATE suppliers SET default_currency_code = ?, default_payment_term_id = ?, version = version + 1 WHERE id = ?",
    [inactiveCurrency, oldTerm.id, supplier.id]);
  const problems = watchProblems(page);

  await page.goto("/suppliers/new");
  await page.getByRole("combobox", { name: "Default Currency *" }).click();
  await expect(page.getByRole("option", { name: /^HKD/u })).toBeVisible();
  await expect(page.getByRole("option", { name: new RegExp(`^${inactiveCurrency}`, "u") })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "預設付款條件（選填）" }).click();
  await expect(page.getByRole("option", { name: new RegExp(`^${tag}-ACT`, "u") })).toBeVisible();
  await expect(page.getByRole("option", { name: new RegExp(`^${tag}-OLD`, "u") })).toHaveCount(0);
  await evidence(page, testInfo, "create-options");
  await page.keyboard.press("Escape");

  await page.goto(`/suppliers/${supplier.id}`);
  await expect(page.getByText(inactiveCurrency).first()).toBeVisible();
  await page.getByRole("button", { name: "編輯一般資料" }).click();
  await expect(page.locator(".q-field", { hasText: "Default Currency *" })).toContainText(inactiveCurrency);
  await page.getByRole("combobox", { name: "Default Currency *" }).click();
  await expect(page.getByRole("option", { name: new RegExp(`^${inactiveCurrency}`, "u") })).toHaveCount(0);
  await evidence(page, testInfo, "edit-keeps-old-value");
  await page.keyboard.press("Escape");
  expect(problems).toEqual([]);

  const { page: admin } = await as("SETTINGS-ADMIN");
  const adminProblems = watchProblems(admin);
  const writes = [];
  admin.on("request", (request) => { if (request.method() !== "GET" && request.url().includes("/api/v1/business-master")) writes.push(request.url()); });
  await admin.goto("/suppliers/settings");
  await expect(admin.getByRole("heading", { name: "貨幣與付款條款" })).toBeVisible();
  const catalogue = admin.locator(".q-card", { has: admin.getByRole("heading", { name: "貨幣與付款條款" }) });
  await expect(catalogue.locator("input, textarea, [role='switch'], [role='checkbox']")).toHaveCount(0);
  await expect(catalogue.getByRole("button", { name: /新增|停用|啟用|儲存|刪除/u })).toHaveCount(0);
  await evidence(admin, testInfo, "settings");
  expect(writes).toEqual([]);
  expect(adminProblems).toEqual([]);

  // 舊嘅 inactive 付款條件要以使用者睇得明嘅方式顯示（DEF-038：而家詳情同編輯表單都只顯示內部 ID）。
  await page.goto(`/suppliers/${supplier.id}`);
  await expect(page.locator(".q-item", { hasText: "付款條件" })).toContainText(`${tag}-OLD — UAT-031 ${tag}-OLD（已停用）`);
  await page.getByRole("button", { name: "編輯一般資料" }).click();
  await expect(page.locator(".q-field", { hasText: "預設付款條件（選填）" })).toContainText(`${tag}-OLD — UAT-031 ${tag}-OLD（已停用）`);
});

/** 下游模組（Purchasing／Receiving／AP）未上線：而家冇任何引用檢查或者 open-flow provider，呢啲步驟做唔到（HD-124 A、HD-131 A）。 */
const DOWNSTREAM = "needs downstream references (Purchasing / Receiving / AP), which are not installed yet: HD-124 A, HD-131 A";

test("@uat UAT-005 a Supplier already referenced by a transaction keeps its Code", () => {
  // 冇一個步驟可以喺 Supplier 單獨完成：「已被交易引用」嘅前置條件本身要下游交易。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-016 a CLERK suspends with a reason; the Supplier is Suspended and no longer offered for new purchasing", async ({ as }, testInfo) => {
  const { page, account: clerk } = await as("CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${supplier.id}`);
  await statusAction(page, "暫停", { reason: "UAT-016 quality issue", password: clerk.password });
  await expect(statusBadge(page)).toHaveText("已暫停");
  await expect(page.getByText("不可用於新採購")).toBeVisible();
  await evidence(page, testInfo, "suspended");
  const audit = await auditRow(page, "暫停");
  await expect(audit).toHaveCount(1);
  await expect(audit).toContainText("UAT-016 quality issue");
  expect(problems).toEqual([]);
  // Buyer 喺 Purchasing 搜尋唔再見到佢、歷史照查得到：要 Purchasing 畫面。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-024 a Supplier without a payment term activates, and says 未設定 rather than a made-up default", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${supplier.id}`);
  await statusAction(page, "啟用");
  await expect(statusBadge(page)).toHaveText("啟用");
  await expect(page.locator(".q-item", { hasText: "付款條件" })).toContainText("未設定");
  await evidence(page, testInfo, "active-without-term");
  expect(problems).toEqual([]);
  // Buyer 揀呢個 Supplier 時收到「未設定」：要 Purchasing 畫面。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-048 several addresses per purpose with exactly one primary, saved order, and deactivation that keeps history", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  await api(page, "POST", `/api/v1/suppliers/${supplier.id}/addresses/create`, { label: "UAT-048 Warehouse A", countryCode: "HK", addressLine1: "1 Harbour Road",
    purposes: [{ purposeCode: "ordering", isPrimary: true }] });
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${supplier.id}`);
  await page.getByRole("tab", { name: /^地址/u }).click();
  for (const [label, purpose, primary] of [["UAT-048 Office B", "辦公地址", false], ["UAT-048 Warehouse C", "採購地址", true]]) {
    await page.getByRole("button", { name: "新增地址" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("地址標籤 *").fill(label);
    await dialog.getByLabel("地址行 1").fill(`${label} street`);
    await dialog.getByRole("checkbox", { name: purpose }).click();
    if (primary) await dialog.locator(".row", { hasText: purpose }).getByRole("switch", { name: "主要" }).click();
    await dialog.getByRole("button", { name: "儲存" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(listItem(page, "UAT-048 Warehouse C")).toContainText("採購地址（主要）");
  await expect(listItem(page, "UAT-048 Warehouse A")).toContainText("採購地址");
  await expect(listItem(page, "UAT-048 Warehouse A")).not.toContainText("（主要）");
  await expect(page.getByText("採購地址（主要）")).toHaveCount(1);

  await page.getByRole("button", { name: "停用地址 UAT-048 Office B" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "停用" }).click();
  await expect(listItem(page, "UAT-048 Office B")).toContainText("已停用");
  await expect(page.getByRole("button", { name: "編輯地址 UAT-048 Office B" })).toHaveCount(0);
  await evidence(page, testInfo, "addresses");
  await expect(await auditRow(page, "停用地址")).toHaveCount(1);
  expect(problems).toEqual([]);

  // 調整順序並保存（FR-PARTY-001）：DEF-037，而家冇排序功能，修正獲批（HD-129 A）。
  await page.getByRole("tab", { name: /^地址/u }).click();
  await expect(page.getByRole("button", { name: /上移|下移/u }).first()).toBeVisible();
});

test("@uat UAT-050 an unreferenced identifier is created, corrected and deleted under control, and a normalised duplicate is refused", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  const other = await createDraft(page);
  const value = String(Date.now()).slice(-8);
  await api(page, "POST", `/api/v1/suppliers/${other.id}/identifiers/create`, { identifierType: "tax", issuerCountryCode: "HK", identifierValue: `T${value}` });
  const problems = watchProblems(page, { allow: [{ status: 409, path: "/identifiers/create" }] });

  await page.goto(`/suppliers/${supplier.id}`);
  await page.getByRole("tab", { name: /^識別資料/u }).click();
  const add = async (type, entered) => {
    await page.getByRole("button", { name: "新增識別資料" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "識別類型 *" }).click();
    await page.getByRole("option", { name: type }).click();
    await dialog.getByLabel("發證國家／地區 *").fill("HK");
    await dialog.getByLabel("識別值 *").fill(entered);
    await dialog.getByRole("button", { name: "儲存" }).click();
    return dialog;
  };
  await expect(await add("商業登記", `BR${value}`)).toBeHidden();
  await expect(page.getByText(`HK — BR${value}`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `編輯識別資料 BR${value}` }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("識別值 *").fill(`BR${value}9`);
  await dialog.getByLabel("修改原因 *").fill("UAT-050 corrected digit");
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`HK — BR${value}9`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `刪除識別資料 BR${value}9` }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("刪除原因 *").fill("UAT-050 entered on the wrong Supplier");
  await dialog.getByRole("button", { name: "確認刪除" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`HK — BR${value}9`, { exact: true })).toHaveCount(0);
  await evidence(page, testInfo, "deleted");

  dialog = await add("稅務識別", ` t-${value} `);
  const error = dialog.locator(".q-banner.bg-negative");
  await expect(error).toBeVisible();
  await expect(error).not.toContainText(other.supplierCode);
  await evidence(page, testInfo, "duplicate-refused");
  await dialog.getByRole("button", { name: "取消" }).click();

  for (const action of ["新增識別資料", "編輯識別資料", "刪除識別資料"]) {
    await expect(await auditRow(page, action)).toHaveCount(1);
  }
  expect(problems).toEqual([]);
  // 已被交易引用嘅識別資料拒絕刪除並保留歷史：要下游引用。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-051 an APPROVER blocks with a reason and the Supplier is immediately unavailable for new purchasing", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  const { page: approverPage, account: approver } = await as("APPROVER-A");
  const problems = watchProblems(approverPage);

  await approverPage.goto(`/suppliers/${supplier.id}`);
  await statusAction(approverPage, "封鎖", { reason: "UAT-051 suspected fraud", password: approver.password });
  await expect(statusBadge(approverPage)).toHaveText("已封鎖");
  await expect(approverPage.getByText("不可用於新採購")).toBeVisible();
  await evidence(approverPage, testInfo, "blocked");
  const audit = await auditRow(approverPage, "封鎖");
  await expect(audit).toHaveCount(1);
  await expect(audit).toContainText("UAT-051 suspected fraud");
  expect(problems).toEqual([]);
  // 有未完成採購時 Archive 列出具名阻擋、清除後重試成功，同埋下游提示：要下游 open matter。
  test.fixme(true, DOWNSTREAM);
});
