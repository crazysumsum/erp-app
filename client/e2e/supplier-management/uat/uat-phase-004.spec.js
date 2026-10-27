import { Buffer } from "node:buffer";
import { randomInt, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { parse } from "csv-parse/sync";
import { API_URL, importRoot, serverRoot } from "./uatEnvironment.mjs";
import { activateViaApi, api, auditRow, createDraft, db, evidence, moduleCall, statusAction, statusBadge, test, unique, watchProblems } from "./uatSupport.js";

/**
 * Supplier UAT PHASE-004：Supplier–SKU、匯入、匯出、運作同營運（07_uat_test_cases.md §4.4、§4.5；HD-124 A）。
 * 真 server、真 MySQL scratch database，冇 mock；只有 UAT-046 嘅「依賴不可用」喺瀏覽器攔截請求（同 UAT-054 一樣，
 * 真 server 上冇安全方法令依賴失效）。
 *
 * - UAT-032～036 要 Buyer 用 Purchasing 畫面或者採購單：先做 Supplier 呢邊睇得到嘅步驟，再 test.fixme（HD-124 A）。
 * - UAT-044、045 要代表性數據量、營運代表同隔離還原環境：test.fixme（HD-144 B）。技術證據係
 *   performance_report.md（T50）同 supplierBankRestore.integration.test.js。
 * - SKU 用 SQL 準備（07 §2 前置資料）：Item 唔係呢個 module 嘅畫面，UAT 角色亦冇 Item 權限。
 */
// UAT-038、043 有完整（虛構）帳號：trace 同失敗截圖會記低請求內容，Playwright 只准成個檔一齊關（07 §2；REV-126 R1，同 PHASE-003）。
test.use({ trace: "off", screenshot: "off" });

const DOWNSTREAM = "needs downstream references (Purchasing / Receiving / AP), which are not installed yet: HD-124 A, HD-131 A";
const OPERATIONS = "needs a representative environment and the named operations role (HD-144 B); technical evidence: performance_report.md (T50) and supplierBankRestore.integration.test.js";

/** 前置：一個可採購嘅 SKU（Item、SKU、基本單位），同 Supplier integration tests 一樣直接寫。 */
async function purchasableSku() {
  const code = unique("UATSKU");
  const now = Date.now();
  const connection = await db();
  const [item] = await connection.execute("INSERT INTO items (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)", [`Item ${code}`, now, now]);
  const [sku] = await connection.execute(
    "INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
    [item.insertId, code, `SKU ${code}`, now, now]);
  const [uom] = await connection.execute("INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, 'Each', ?, ?)", [code, now, now]);
  await connection.execute("INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)",
    [sku.insertId, uom.insertId, now, now]);
  return { skuId: Number(sku.insertId), skuCode: code };
}

/** 前置：Business Master 有第二個啟用中嘅幣別（07 §2 環境準備；migration 只種 HKD）。 */
async function ensureCurrency(code, name) {
  const now = Date.now();
  await (await db()).execute(
    `INSERT INTO currencies (code, name, decimal_places, status, version, created_at, updated_at) VALUES (?, ?, 2, 'ACTIVE', 1, ?, ?)
     ON DUPLICATE KEY UPDATE status = 'ACTIVE'`, [code, name, now, now]);
}

/** 前置：一個啟用中嘅付款條款（Business Master；migration 冇種）。 */
async function ensurePaymentTerm(code, name) {
  const now = Date.now();
  await (await db()).execute(
    `INSERT INTO payment_terms (code, code_key, name, description, calculation_type, due_days, status, version, created_at, updated_at)
     VALUES (?, ?, ?, '', 'NET_DAYS', 30, 'ACTIVE', 1, ?, ?) ON DUPLICATE KEY UPDATE status = 'ACTIVE'`, [code, code, name, now, now]);
}

/** CLERK 喺 Supplier 詳情嘅「供貨關係」tab 為一個 SKU 加首選關係（使用者步驟）。 */
async function addPreferredRelation(page, supplierId, sku) {
  await page.goto(`/suppliers/${supplierId}`);
  await page.getByRole("tab", { name: "供貨關係" }).click();
  await page.getByRole("button", { name: "新增供貨關係" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("SKU *").fill(sku.skuCode);
  await page.getByRole("option", { name: new RegExp(sku.skuCode, "u") }).click();
  await dialog.getByLabel("關係 *").click();
  await page.getByRole("option", { name: "首選" }).click();
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("tbody tr", { hasText: sku.skuCode })).toContainText("首選");
}

/** 用目前登入嘅 token 送一個請求，可以指定 Idempotency-Key（UAT-039、046 要重送同一個請求）。 */
async function rawCall(page, method, urlPath, body, { key = randomUUID() } = {}) {
  const token = await page.evaluate(() => localStorage.getItem("erp.token"));
  const response = await page.request.fetch(`${API_URL}${urlPath}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": key },
    data: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status(), replayed: response.headers()["idempotency-replayed"] === "true", body: await response.json().catch(() => null) };
}

// ---- 匯入 helpers -------------------------------------------------------------------------------------------

async function downloadText(page, click) {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]);
  return fs.readFileSync(await download.path(), "utf8");
}

/** 第一步：喺畫面下載範本，用佢嘅欄位名砌 CSV。 */
async function templateColumns(page) {
  await page.goto("/suppliers/imports");
  const text = await downloadText(page, () => page.getByRole("button", { name: "下載範本" }).click());
  return parse(text, { bom: true })[0];
}

const toCsv = (columns, records) => [columns, ...records.map((record) => columns.map((name) => record[name] ?? ""))]
  .map((cells) => cells.map((cell) => (/[",\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(",")).join("\r\n");

/** 第二步：上載。`beforeUpload` 喺撳「上載」之前行（截上載畫面）。 */
async function uploadCsv(page, { name, csv, mode = "只新增", beforeUpload }) {
  await page.goto("/suppliers/imports");
  await page.getByRole("button", { name: "上載 CSV" }).click();
  const dialog = page.getByRole("dialog");
  if (mode !== "只新增") {
    await dialog.getByLabel("匯入模式").click();
    await page.getByRole("option", { name: mode }).click();
  }
  await dialog.locator("input[type=file]").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await beforeUpload?.();
  await dialog.getByRole("button", { name: "上載" }).click();
}

const jobDialog = (page) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /匯入工作 #/u }) });
const titledDialog = (page, title) => page.getByRole("dialog").filter({ hasText: title });
async function jobId(page) {
  return Number((await page.getByRole("heading", { name: /匯入工作 #\d+/u }).textContent()).match(/#(\d+)/u)[1]);
}

async function confirmImport(page, password) {
  const detail = page.getByTestId("confirm-step");
  await detail.getByRole("button", { name: "確認匯入" }).click();
  const prompt = titledDialog(page, "確認供應商匯入");
  await prompt.locator("input[type=password]").fill(password);
  await prompt.getByRole("button", { name: "確認匯入" }).click();
}

async function searchCount(page, code) {
  const result = await api(page, "GET", `/api/v1/suppliers?q=${encodeURIComponent(code)}&page=1&pageSize=20`);
  return result.items.filter((item) => item.supplierCode === code).length;
}

/** 新寫嘅 server log（呢個 test 開始之後）；之前 run 留低嘅唔算（REV-123 R1）。 */
const logFiles = () => fs.readdirSync(path.join(serverRoot, "logs"), { recursive: true }).map((name) => path.join(serverRoot, "logs", name))
  .filter((file) => fs.statSync(file).isFile());
const logMark = () => new Map(logFiles().map((file) => [file, fs.statSync(file).size]));
const newLogText = (mark) => logFiles().map((file) => fs.readFileSync(file).subarray(mark.get(file) ?? 0).toString("utf8")).join("\n");
/** 匯入目錄入面所有檔（來源檔、結果檔）嘅內容。 */
const importRootText = () => (fs.existsSync(importRoot) ? fs.readdirSync(importRoot, { recursive: true }).map((name) => path.join(importRoot, name))
  .filter((file) => fs.statSync(file).isFile()).map((file) => fs.readFileSync(file).toString("latin1")).join("\n") : "");
const fakeAccount = () => `8${randomInt(100_000_000, 999_999_999)}${randomInt(10, 99)}`;

// ---- PHASE-004 cases ----------------------------------------------------------------------------------------

test("@uat UAT-032 a Supplier with no relation to the SKU is still offered to the Buyer; there is no whitelist", () => {
  // 冇一個步驟喺 Supplier 單獨完成：「冇關係」只係前置條件，結果要喺 Purchasing 嘅 Supplier 選擇器先睇得到。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-033 a Supplier with a preferred relation is ranked first with its reason; other Active Suppliers stay selectable", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  const sku = await purchasableSku();
  const problems = watchProblems(page);

  await addPreferredRelation(page, supplier.id, sku);
  await evidence(page, testInfo, "preferred-relation");
  await expect(await auditRow(page, "新增供貨關係")).toHaveCount(1);
  expect(problems).toEqual([]);
  // 排序同理由喺 Buyer 嘅 Supplier 選擇器先睇得到：要 Purchasing 畫面。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-034 a preferred Supplier that is Suspended cannot be selected; preference does not bypass the status", async ({ as }, testInfo) => {
  const { page, account: clerk } = await as("CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  const sku = await purchasableSku();
  const problems = watchProblems(page);

  await addPreferredRelation(page, supplier.id, sku);
  await page.goto(`/suppliers/${supplier.id}`);
  await statusAction(page, "暫停", { reason: "UAT-034 quality hold", password: clerk.password });
  await expect(statusBadge(page)).toHaveText("已暫停");
  await expect(page.getByText("不可用於新採購")).toBeVisible();
  await evidence(page, testInfo, "suspended-preferred");
  expect(problems).toEqual([]);
  // Buyer 開新採購搜尋時唔可以揀、見到拒絕提示：要 Purchasing 畫面。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-035 a completed purchase creates a soft relation and last-supplied information without changing the Supplier's status", () => {
  // 前置同步驟都係採購單：冇 Purchasing／Receiving 就冇一步做得到。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-036 an old purchase order keeps its Currency and Term snapshot after the Supplier's defaults change", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  await activateViaApi(page, supplier.id);
  await ensureCurrency("USD", "US Dollar");
  await ensurePaymentTerm("UAT NET30", "UAT Net 30");
  const problems = watchProblems(page);

  // Supplier 呢邊嘅步驟：改預設幣別（要原因）同付款條件，詳情即刻係新值。
  await page.goto(`/suppliers/${supplier.id}`);
  await page.getByRole("button", { name: "編輯一般資料" }).click();
  await page.getByRole("combobox", { name: "Default Currency *" }).click();
  await page.getByRole("option", { name: /^USD/u }).click();
  await page.getByRole("combobox", { name: "預設付款條件（選填）" }).click();
  await page.getByRole("option", { name: /^UAT NET30/u }).click();
  await page.getByLabel("修改預設幣別原因 *").fill("UAT-036 contract now in USD");
  await page.getByRole("button", { name: "儲存一般資料" }).click();
  await expect(page.locator(".q-item", { hasText: "預設貨幣" })).toContainText("USD");
  await expect(page.locator(".q-item", { hasText: "付款條件" })).toContainText("UAT NET30 — UAT Net 30");
  await evidence(page, testInfo, "defaults-changed");
  expect(problems).toEqual([]);
  // 舊採購單保留原 Currency／Term、新選擇帶新預設：要 Purchasing 嘅採購單。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-037 a CLERK uploads a mixed CSV, prechecks, confirms and downloads the result; valid rows are written, error rows are not, and the counts agree", async ({ as }, testInfo) => {
  // 預檢同執行各要幾個 5 秒嘅 worker 週期（REV-126 O6）。
  test.setTimeout(150_000);
  const { page, account: clerk } = await as("CLERK");
  const existing = await createDraft(page);
  await ensureCurrency("USD", "US Dollar");
  const problems = watchProblems(page);
  const tag = unique("U37");
  const code = (n) => `${tag}-${n}`;

  // 07 §2 CSV-MIXED：合法、警告、錯誤、重複。銀行欄位會令成個檔喺上載就被拒（HD-053 A、HD-054 A），所以喺 UAT-038 獨立驗。
  // 第一步：下載範本。
  const columns = await templateColumns(page);
  await evidence(page, testInfo, "1-template");
  const records = [
    { supplierCode: code(1), supplierName: `UAT-037 One ${tag}`, defaultCurrencyCode: "HKD" },                      // 合法
    { supplierCode: code(2), supplierName: `UAT-037 Two ${tag}`, defaultCurrencyCode: "USD", generalEmail: "two@example.test" }, // 合法
    { supplierCode: code(3), supplierName: existing.supplierName, defaultCurrencyCode: "HKD" },                    // 警告：名稱相同
    { supplierCode: code(4), supplierName: `UAT-037 Four ${tag}` },                                                // 錯誤：缺幣別
    { supplierCode: code(5), supplierName: `UAT-037 Five ${tag}`, defaultCurrencyCode: "HKD", generalEmail: "not-an-email" }, // 錯誤：電郵
    { supplierCode: code(6), supplierName: `UAT-037 Six ${tag}`, defaultCurrencyCode: "HKD" },                      // 合法
    { supplierCode: code(6), supplierName: `UAT-037 Six again ${tag}`, defaultCurrencyCode: "HKD" },                // 錯誤：檔內重複
    { supplierCode: code(8), supplierName: `UAT-037 Eight ${tag}`, defaultCurrencyCode: "ZZZ" },                    // 錯誤：幣別不存在
    { supplierCode: existing.supplierCode, notes: "UAT-037 updated" },                                             // 更新（upsert）
    { supplierCode: code(10), supplierName: `=UAT-037 Ten ${tag}`, defaultCurrencyCode: "HKD" }                     // 合法：公式字首照存
  ];
  // 第二步：上載。
  await uploadCsv(page, { name: "uat-037-mixed.csv", csv: toCsv(columns, records), mode: "新增或更新",
    beforeUpload: () => evidence(page, testInfo, "2-upload") });
  const detail = jobDialog(page);
  await expect(detail.locator(".q-badge").first()).toHaveText("待確認（有錯誤列）", { timeout: 45_000 });
  await expect(detail.getByTestId("job-counts")).toContainText("共 10 列；有效 5、警告 1、無效 4");
  // 逐列預檢原因（FR-IMPORT-003；REV-126 O4）。
  const rowIssue = (rowNumber) => detail.locator("tbody tr").nth(rowNumber - 1);
  await expect(rowIssue(3)).toContainText("SUPPLIER_IMPORT_NAME_EXISTS");
  await expect(rowIssue(4)).toContainText("SUPPLIER_IMPORT_REQUIRED_FIELD");
  await expect(rowIssue(5)).toContainText("generalEmail");
  await expect(rowIssue(7)).toContainText("SUPPLIER_IMPORT_CODE_DUPLICATED_IN_FILE");
  await expect(rowIssue(8)).toContainText("CURRENCY_NOT_ACTIVE");
  await evidence(page, testInfo, "3-prechecked");

  // 第三步：確認。
  await confirmImport(page, clerk.password);
  await expect(detail.locator(".q-badge").first()).toHaveText("已完成（有錯誤列）", { timeout: 60_000 });
  await expect(detail.getByTestId("job-counts")).toContainText("已寫入 6、失敗 0、略過 4");
  await evidence(page, testInfo, "4-completed");

  // 第四步：逐列結果檔，每一列嘅結果都對（REV-126 R2），同 Supplier 搜尋對得上。
  const result = parse(await downloadText(page, () => detail.getByRole("button", { name: "下載結果" }).click()), { bom: true, columns: true });
  expect(result.map((row) => [row.supplierCode, row.outcome])).toEqual([
    [code(1), "applied"], [code(2), "applied"], [code(3), "applied"], [code(4), "skipped"], [code(5), "skipped"],
    [code(6), "applied"], [code(6), "skipped"], [code(8), "skipped"], [existing.supplierCode, "applied"], [code(10), "applied"]]);
  for (const [n, count] of [[1, 1], [2, 1], [3, 1], [4, 0], [5, 0], [6, 1], [8, 0], [10, 1]]) {
    expect(await searchCount(page, code(n)), `${code(n)} written ${count} time(s)`).toBe(count);
  }
  const updated = await api(page, "GET", `/api/v1/suppliers/${existing.id}`);
  expect([updated.notes, updated.status]).toEqual(["UAT-037 updated", "draft"]);
  expect(problems).toEqual([]);
});

test("@uat UAT-038 a CSV with a Bank column is refused outright, and no Bank data is written anywhere", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const target = await createDraft(page);
  const problems = watchProblems(page, { allow: [{ status: 400, path: "/api/v1/supplier-imports/upload" }] });
  const account = fakeAccount();
  const mark = logMark();
  const [[{ jobs: jobsBefore }]] = await (await db()).query("SELECT COUNT(*) AS jobs FROM supplier_import_jobs");

  // 一個更新現有 Supplier 嘅列，加一個 Bank 欄位：預檢之前、上載嗰下就被拒。
  const columns = [...(await templateColumns(page)), "bankAccountNumber"];
  const csv = toCsv(columns, [{ supplierCode: target.supplierCode, notes: "UAT-038 should not land", bankAccountNumber: account }]);
  await uploadCsv(page, { name: "uat-038-bank.csv", csv, mode: "新增或更新" });
  await expect(page.getByRole("alert").filter({ hasText: /銀行/u })).toBeVisible();
  await expect(jobDialog(page)).toHaveCount(0);
  await evidence(page, testInfo, "refused");

  // Bank 遮罩列表：個 Supplier 仍然冇銀行資料，一般資料亦冇改。
  const { page: readerPage } = await as("BANK-READER");
  await readerPage.goto(`/suppliers/${target.id}`);
  await readerPage.getByRole("tab", { name: "銀行資料" }).click();
  await expect(readerPage.getByText("尚未設定銀行資料")).toBeVisible();
  await evidence(readerPage, testInfo, "bank-list-empty");
  expect((await api(page, "GET", `/api/v1/suppliers/${target.id}`)).notes).toBe("");

  // 冇 job；帳號冇入匯入目錄、亦冇入呢個 test 寫嘅 log（technical 補充：畫面睇唔到檔案同 log）。
  const [[{ jobs: jobsAfter }]] = await (await db()).query("SELECT COUNT(*) AS jobs FROM supplier_import_jobs");
  expect(jobsAfter).toBe(jobsBefore);
  expect(importRootText().includes(account), "no account number in the import root").toBe(false);
  const written = newLogText(mark);
  expect(written.includes("/api/v1/supplier-imports/upload"), "the request log has the refused upload").toBe(true);
  expect(written.includes(account), "no account number in the server logs").toBe(false);
  expect(problems).toEqual([]);
});

test("@uat UAT-043 an export holds no full Bank data or ciphertext, guards formula cells, and is audited", async ({ as }, testInfo) => {
  const tag = unique("U43");
  const { page, account: clerk } = await as("CLERK");
  const supplier = await createDraft(page, { code: tag, name: `=UAT-043 formula ${tag}` });
  const { page: officerPage, account: officer } = await as("BANK-OFFICER");
  const account = fakeAccount();
  const created = await moduleCall(officerPage, "/src/services/supplierBank.js", "create", supplier.id, {
    accountHolderName: "UAT-043 Holder", bankName: `UAT-043 Bank ${tag}`, accountNumber: account, isDefault: true, reason: "UAT-043 bank setup", password: officer.password
  });
  expect(created.startsWith("ok:"), "bank setup").toBe(true);
  const columns = await templateColumns(page);

  // 07 寫 VIEWER，但設計 §6.9 嘅匯出要 supplier.mgmt：VIEWER 冇入口、直接叫亦以權限被拒。
  const { page: viewerPage, account: viewer } = await as("VIEWER");
  await viewerPage.goto("/suppliers");
  await expect(viewerPage.getByPlaceholder("搜尋 Code、名稱、電話或電郵")).toBeVisible();
  await expect(viewerPage.getByRole("button", { name: "匯出 CSV" })).toHaveCount(0);
  const refused = await moduleCall(viewerPage, "/src/services/supplier.js", "exportCsv", { filter: tag, password: viewer.password });
  // Route 嘅權限拒絕喺 client 係 `403 Forbidden`（同 UAT-040）；VIEWER 嘅正確密碼已經過咗重新認證。
  expect(refused, "VIEWER export refused by permission").toBe("403 Forbidden");

  // CLERK（冇 bank.view）同 SYSTEM-ADMIN（有齊銀行權限）都匯出：兩個檔一樣冇銀行資料（AC-040；REV-126 O2）。
  for (const [role, exporter] of [["CLERK", { page, account: clerk }], ["SYSTEM-ADMIN", await as("SYSTEM-ADMIN")]]) {
    const problems = watchProblems(exporter.page);
    await exporter.page.goto("/suppliers");
    // 篩選到得一個；scratch database 入面有其他 test 嘅 Supplier，冇篩選嘅話匯出會多過一行。
    await exporter.page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(tag);
    await expect(exporter.page.locator("tbody tr")).toHaveCount(1);
    const csvText = await downloadText(exporter.page, async () => {
      await exporter.page.getByRole("button", { name: "匯出 CSV" }).click();
      const prompt = titledDialog(exporter.page, "匯出供應商");
      await prompt.locator("input[type=password]").fill(exporter.account.password);
      await prompt.getByRole("button", { name: "匯出" }).click();
    });
    // 以文字讀（安全 viewer：唔執行公式）。欄位正正係範本 v1（HD-067 2A）：多一欄密文都會紅（REV-126 R5）。
    expect(csvText.includes(account), `${role}: no full account number in the export`).toBe(false);
    const rows = parse(csvText, { bom: true, columns: true });
    expect(Object.keys(rows[0]), `${role}: exactly the template columns`).toEqual(columns);
    expect(rows.map((row) => row.supplierCode), `${role}: only the filtered Supplier (FR-IMPORT-009)`).toEqual([supplier.supplierCode]);
    expect(rows[0].supplierName, `${role}: the formula cell is guarded`).toBe(`'=UAT-043 formula ${tag}`);
    await evidence(exporter.page, testInfo, `exported-${role.toLowerCase()}`);
    expect(problems).toEqual([]);
  }

  await page.goto("/suppliers/audit?action=supplier.export");
  for (const actor of ["uat-clerk", "uat-system-admin"]) {
    await expect(page.locator("tbody tr", { hasText: "匯出供應商" }).filter({ hasText: actor }).first()).toBeVisible();
  }
  await evidence(page, testInfo, "export-audit");
});

test("@uat UAT-044 search, SKU selection and a 10k import stay usable at representative volume", () => {
  test.fixme(true, OPERATIONS);
});

test("@uat UAT-045 an isolated restore matches the source, keeps Bank masked and Audit, and is not declared a success without the keys", () => {
  test.fixme(true, OPERATIONS);
});

test("@uat UAT-039 confirming twice, by double click or by resending the same confirmation, writes the rows once and answers with the same outcome", async ({ as }, testInfo) => {
  test.setTimeout(150_000);
  const { page, account: clerk } = await as("CLERK");
  // 冇 allow：畫面送多一次確認（409）都要紅（REV-126 R3）。下面 page.request 嘅請求唔經 page 嘅 response 事件。
  const problems = watchProblems(page);
  const tag = unique("U39");
  const columns = await templateColumns(page);

  // 雙擊：喺工作詳情雙擊「確認匯入」，只應該得一個密碼確認；密碼確認嗰個掣亦撳兩下，只確認一次。
  await uploadCsv(page, { name: "uat-039-a.csv", csv: toCsv(columns, [{ supplierCode: `${tag}-A`, supplierName: `UAT-039 A ${tag}`, defaultCurrencyCode: "HKD" }]) });
  const detail = jobDialog(page);
  await expect(detail.locator(".q-badge").first()).toHaveText("待確認", { timeout: 45_000 });
  await page.getByTestId("confirm-step").getByRole("button", { name: "確認匯入" }).dblclick();
  const prompt = titledDialog(page, "確認供應商匯入");
  await expect(prompt).toHaveCount(1);
  await prompt.locator("input[type=password]").fill(clerk.password);
  await prompt.getByRole("button", { name: "確認匯入" }).dblclick();
  await expect(detail.locator(".q-badge").first()).toHaveText("已完成", { timeout: 60_000 });
  await expect(detail.getByTestId("job-counts")).toContainText("已寫入 1、失敗 0、略過 0");
  expect(await searchCount(page, `${tag}-A`)).toBe(1);
  await evidence(page, testInfo, "double-click");

  // 重送同一個確認：同一個 Idempotency-Key 送兩次，第二次係重播，結果一樣。
  await detail.getByRole("button", { name: "關閉" }).click();
  await uploadCsv(page, { name: "uat-039-b.csv", csv: toCsv(columns, [{ supplierCode: `${tag}-B`, supplierName: `UAT-039 B ${tag}`, defaultCurrencyCode: "HKD" }]) });
  await expect(detail.locator(".q-badge").first()).toHaveText("待確認", { timeout: 45_000 });
  const id = await jobId(page);
  const { job } = await api(page, "GET", `/api/v1/supplier-imports/${id}?page=1&pageSize=20`);
  const confirmation = { version: job.version, activationMode: "draft", approverUserId: null, password: clerk.password };
  const key = randomUUID();
  const first = await rawCall(page, "POST", `/api/v1/supplier-imports/${id}/confirm`, confirmation, { key });
  const second = await rawCall(page, "POST", `/api/v1/supplier-imports/${id}/confirm`, confirmation, { key });
  expect(first.status).toBeLessThan(300);
  expect([second.status, second.replayed]).toEqual([first.status, true]);
  expect(second.body).toEqual(first.body);
  // 新 key 再確認：version 已經變，伺服器拒絕，唔會確認兩次。
  expect((await rawCall(page, "POST", `/api/v1/supplier-imports/${id}/confirm`, confirmation)).status).toBe(409);
  // 確認唔係經畫面送：重新載入，`?job=` 會再開返個詳情並且輪詢到完成。
  await page.reload();
  await expect(detail.locator(".q-badge").first()).toHaveText("已完成", { timeout: 60_000 });
  await expect(detail.getByTestId("job-counts")).toContainText("已寫入 1、失敗 0、略過 0");
  expect(await searchCount(page, `${tag}-B`)).toBe(1);
  await evidence(page, testInfo, "resent");
  expect(problems).toEqual([]);
});

test("@uat UAT-046 replayed operations do not duplicate, an unavailable dependency opens nothing it should not, and work continues after recovery", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const tag = unique("U46");

  // 重送：同一個 Idempotency-Key 建立兩次，只得一個 Supplier，第二次係重播。
  const body = { supplierCode: tag, supplierName: `UAT-046 ${tag}`, defaultCurrencyCode: "HKD" };
  const key = randomUUID();
  const first = await rawCall(page, "POST", "/api/v1/suppliers/create", body, { key });
  const second = await rawCall(page, "POST", "/api/v1/suppliers/create", body, { key });
  expect(first.status).toBeLessThan(300);
  expect([second.status, second.replayed, second.body?.data?.id]).toEqual([first.status, true, first.body?.data?.id]);
  expect(await searchCount(page, tag)).toBe(1);
  const supplierId = first.body.data.id;

  // 依賴不可用（真後端，REV-126 O5）：Supplier 嘅幣別喺 Business Master 停用咗。伺服器拒絕啟用，Supplier 仍然係草稿；
  // 幣別恢復之後再啟用就成功。
  await ensureCurrency("XTS", "UAT Testing Currency");
  const xts = unique("U46X");
  const dependent = (await rawCall(page, "POST", "/api/v1/suppliers/create", { supplierCode: xts, supplierName: `UAT-046 ${xts}`, defaultCurrencyCode: "XTS" })).body.data;
  await (await db()).execute("UPDATE currencies SET status = 'INACTIVE', version = version + 1 WHERE code = 'XTS'");
  const serverProblems = watchProblems(page, { allow: [{ status: 409, path: "/activate" }, { status: 422, path: "/activate" }] });
  await page.goto(`/suppliers/${dependent.id}`);
  await statusAction(page, "啟用");
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(statusBadge(page)).toHaveText("草稿");
  await page.reload();
  await expect(statusBadge(page)).toHaveText("草稿");
  await evidence(page, testInfo, "dependency-inactive");
  await ensureCurrency("XTS", "UAT Testing Currency");
  await page.reload();
  await statusAction(page, "啟用");
  await expect(statusBadge(page)).toHaveText("啟用");
  expect(serverProblems).toEqual([]);

  // 依賴喺路上失敗：啟用請求回 503（喺瀏覽器攔截，同 UAT-054）。重新載入之前畫面都唔可以話已啟用（REV-126 R4）。
  const problems = watchProblems(page, { allow: [{ status: 503, path: "/activate" }] });
  await page.route("**/api/v1/suppliers/*/activate", (route) => route.fulfill({ status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "服務暫時無法使用" } }) }));
  await page.goto(`/suppliers/${supplierId}`);
  await statusAction(page, "啟用");
  await expect(page.getByRole("alert").filter({ hasText: /暫時無法使用|失敗/u }).first()).toBeVisible();
  await expect(statusBadge(page)).toHaveText("草稿");
  await page.reload();
  await expect(statusBadge(page)).toHaveText("草稿");
  await expect(page.getByRole("button", { name: "啟用", exact: true })).toBeVisible();
  await evidence(page, testInfo, "still-draft");
  await page.unroute("**/api/v1/suppliers/*/activate");
  await statusAction(page, "啟用");
  await expect(statusBadge(page)).toHaveText("啟用");
  await expect(await auditRow(page, "啟用")).toHaveCount(1);
  await evidence(page, testInfo, "recovered");
  expect(problems).toEqual([]);
});
