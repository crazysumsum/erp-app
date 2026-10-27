import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import process from "node:process";
import { expect } from "@playwright/test";
import { parse } from "csv-parse/sync";
import { activateViaApi, api, createDraft, db, evidence, moduleCall, statusBadge, test, uatFixture, unique, watchProblems } from "./uatSupport.js";

/**
 * Supplier UAT 跨 phase 案例（07_uat_test_cases.md §4.6：UAT-047、UAT-055；HD-124 A）。真 server、真 MySQL scratch database。
 * 只有 UAT-047 嘅 loading／error 狀態喺瀏覽器攔截列表請求（同 UAT-054：真 server 上冇安全方法令佢慢或者失敗）。
 *
 * 呢個檔有虛構銀行帳號（UAT-047 嘅 reveal、UAT-055 嘅 reveal audit）：trace、失敗截圖同失敗時嘅 aria snapshot 都關咗，
 * 明文只用 boolean 比較，截圖之前確認畫面冇明文（07 §2；同 PHASE-003）。
 */
test.use({ trace: "off", screenshot: "off" });
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const PLAINTEXT = '[data-test="bank-plaintext"]';
const fakeAccount = () => `8${randomInt(100_000_000, 999_999_999)}${randomInt(10, 99)}`;
const VIEWPORTS = [["375", { width: 375, height: 812 }], ["768", { width: 768, height: 1024 }], ["1440", { width: 1440, height: 900 }]];

async function setApprovalPolicy(on) {
  await (await db()).execute("UPDATE supplier_settings SET require_activation_approval = ?, version = version + 1 WHERE id = 1", [on ? 1 : 0]);
}
test.afterEach(async () => { await setApprovalPolicy(false); });

/** BANK-OFFICER 經 client service（簽名＋密碼）開一個虛構帳戶。 */
async function addAccount(as, supplierId, bankName) {
  const { page, account: officer } = await as("BANK-OFFICER");
  const account = fakeAccount();
  const created = await moduleCall(page, "/src/services/supplierBank.js", "create", supplierId, {
    accountHolderName: `${bankName} Holder`, bankName, accountNumber: account, isDefault: true, reason: "UAT bank setup", password: officer.password
  });
  expect(created.startsWith("ok:"), "bank setup").toBe(true);
  return account;
}

// ---- 鍵盤 helpers ----------------------------------------------------------------------------------------------

/** 撳 Tab 直至 target（或者佢入面嘅元素）有 focus：證明鍵盤去得到。去唔到就 fail，唔會改用滑鼠。 */
async function tabTo(page, target, { max = 120 } = {}) {
  await target.waitFor();
  const handle = await target.elementHandle();
  for (let presses = 0; presses < max; presses += 1) {
    if (await handle.evaluate((element) => element === document.activeElement || element.contains(document.activeElement))) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`not reachable by keyboard within ${max} Tab presses`);
}

/** Focus 睇得見：有 focus 同冇 focus 嘅截圖唔同。之後 Tab 返去，繼續淨係用鍵盤。 */
async function expectFocusVisible(page, target, label) {
  const focused = await target.screenshot();
  await page.evaluate(() => document.activeElement?.blur());
  const blurred = await target.screenshot();
  expect(Buffer.compare(focused, blurred) !== 0, `${label}: the keyboard focus is visible`).toBe(true);
  await tabTo(page, target);
}

/** 用鍵盤揀 q-select 嘅選項：Enter 打開，方向鍵揀，Enter 確認。 */
async function chooseByKeyboard(page, combobox, optionName) {
  await tabTo(page, combobox);
  await page.keyboard.press("Enter");
  const option = page.getByRole("option", { name: optionName });
  await option.waitFor();
  for (let presses = 0; presses < 30; presses += 1) {
    if (await option.evaluate((element) => element.classList.contains("q-manual-focusable--focused"))) break;
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

const press = (page, key) => page.keyboard.press(key);
const typeText = (page, text) => page.keyboard.type(text);

test("@uat UAT-047 a keyboard user completes each phase's happy path at 375, 768 and 1440 px; focus is visible, labels and errors are clear, states are not colour-only", async ({ as }, testInfo) => {
  test.setTimeout(300_000);
  for (const [width, viewport] of VIEWPORTS) {
    // ---- PHASE-001：新增並直接啟用；未填必填欄先試一次儲存，錯誤要講得明。 ----
    const { page: clerk } = await as("CLERK");
    await clerk.setViewportSize(viewport);
    const problems = watchProblems(clerk, { allow: [{ status: 503, path: "/api/v1/suppliers" }] });
    await clerk.goto("/suppliers/new");
    const code = clerk.getByLabel("Supplier Code *");
    await tabTo(clerk, code);
    await expectFocusVisible(clerk, code, `${width}px Supplier Code`);
    await tabTo(clerk, clerk.getByRole("button", { name: "儲存 Draft" }));
    await press(clerk, "Enter");
    await expect(code).toHaveAttribute("aria-invalid", "true");
    const codeError = clerk.locator(".q-field", { has: code }).locator(".q-field__messages");
    expect((await codeError.textContent()).trim().length, `${width}px: the error says what is wrong`).toBeGreaterThan(0);
    await evidence(clerk, testInfo, `${width}-p1-validation`);

    const supplierCode = unique(`K${width}`);
    await tabTo(clerk, code);
    await typeText(clerk, supplierCode);
    await tabTo(clerk, clerk.getByLabel("Supplier Name *"));
    await typeText(clerk, `UAT-047 Keyboard ${supplierCode}`);
    await chooseByKeyboard(clerk, clerk.getByRole("combobox", { name: "Default Currency *" }), /^HKD/u);
    await tabTo(clerk, clerk.getByRole("button", { name: "直接啟用" }));
    await press(clerk, "Enter");
    await expect(statusBadge(clerk)).toHaveText("啟用");
    // 狀態唔只靠顏色：badge 有字。
    expect((await statusBadge(clerk).textContent()).trim()).toBe("啟用");
    await evidence(clerk, testInfo, `${width}-p1-active`);

    // ---- 列表：loading、empty、error，「重試」用鍵盤撳。 ----
    let mode = "slow";
    await clerk.route("**/api/v1/suppliers?**", async (route) => {
      if (mode === "slow") { await new Promise((resolve) => { setTimeout(resolve, 2_000); }); return route.continue(); }
      if (mode === "fail") return route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "供應商資料暫時無法載入" }, meta: { requestId: "uat-047" } }) });
      return route.continue();
    });
    await clerk.goto("/suppliers");
    await expect(clerk.getByText("載入中…")).toBeVisible();
    await expect(clerk.getByText("載入中…")).toBeHidden({ timeout: 15_000 });
    mode = "live";
    const search = clerk.getByPlaceholder("搜尋 Code、名稱、電話或電郵");
    await tabTo(clerk, search);
    await typeText(clerk, `no-such-supplier-${Date.now()}`);
    await expect(clerk.getByText("冇資料")).toBeVisible();
    mode = "fail";
    await clerk.keyboard.press("ControlOrMeta+a");
    await typeText(clerk, supplierCode);
    await expect(clerk.getByRole("alert").filter({ hasText: "服務暫時無法使用，請稍後再試" })).toBeVisible();
    await evidence(clerk, testInfo, `${width}-list-error`);
    mode = "live";
    const retry = clerk.getByRole("button", { name: "重試" });
    await tabTo(clerk, retry);
    await expectFocusVisible(clerk, retry, `${width}px 重試`);
    await press(clerk, "Enter");
    await expect(clerk.locator("tbody tr", { hasText: supplierCode })).toHaveCount(1);
    await clerk.unroute("**/api/v1/suppliers?**");
    expect(problems).toEqual([]);

    // ---- PHASE-002：審批開；CLERK 用鍵盤揀審批人提交，APPROVER-A 用鍵盤批准。 ----
    await setApprovalPolicy(true);
    const draft = await createDraft(clerk);
    await clerk.goto(`/suppliers/${draft.id}`);
    await tabTo(clerk, clerk.getByRole("button", { name: "啟用", exact: true }));
    await press(clerk, "Enter");
    const submitDialog = clerk.getByRole("dialog");
    await chooseByKeyboard(clerk, submitDialog.getByRole("combobox", { name: "審批人" }), /uat-approver-a/u);
    await tabTo(clerk, submitDialog.getByRole("button", { name: "確認提交審批" }));
    await press(clerk, "Enter");
    await expect(statusBadge(clerk)).toHaveText("待審批");

    const { page: approver, account: approverAccount } = await as("APPROVER-A");
    await approver.setViewportSize(viewport);
    const approverProblems = watchProblems(approver);
    await approver.goto("/suppliers/approvals");
    await tabTo(approver, approver.getByRole("button", { name: `查看 ${draft.supplierCode} 的審批詳情` }));
    await press(approver, "Enter");
    await tabTo(approver, approver.getByRole("button", { name: "批准" }));
    await press(approver, "Enter");
    const approveDialog = approver.getByRole("dialog").last();
    await tabTo(approver, approveDialog.locator("input[type=password]"));
    await typeText(approver, approverAccount.password);
    await tabTo(approver, approveDialog.getByRole("button", { name: "批准" }));
    await press(approver, "Enter");
    await expect(approver.getByText(`${draft.supplierCode}：已批准，供應商已啟用`)).toBeVisible();
    await evidence(approver, testInfo, `${width}-p2-approved`);
    expect(approverProblems).toEqual([]);
    await setApprovalPolicy(false);

    // ---- PHASE-003：BANK-READER 用鍵盤重新認證、查看、收起。 ----
    const account = await addAccount(as, draft.id, `UAT-047 Bank ${width}`);
    const { page: reader, account: readerAccount } = await as("BANK-READER");
    await reader.setViewportSize(viewport);
    const readerProblems = watchProblems(reader);
    await reader.goto(`/suppliers/${draft.id}`);
    await tabTo(reader, reader.getByRole("tab", { name: "銀行資料" }));
    await press(reader, "Enter");
    await tabTo(reader, reader.getByRole("button", { name: `查看完整帳號 UAT-047 Bank ${width}` }));
    await press(reader, "Enter");
    const revealDialog = reader.getByRole("dialog");
    await tabTo(reader, revealDialog.getByLabel("密碼 *"));
    await typeText(reader, readerAccount.password);
    await tabTo(reader, revealDialog.getByLabel("查看原因 *"));
    await typeText(reader, `UAT-047 keyboard check ${width}`);
    await tabTo(reader, revealDialog.getByRole("button", { name: "確認查看" }));
    await press(reader, "Enter");
    await expect.poll(async () => (await reader.locator(PLAINTEXT).allTextContents()).join("") === account, { message: "revealed by keyboard" }).toBe(true);
    await tabTo(reader, reader.getByRole("button", { name: "收起" }));
    await press(reader, "Enter");
    await expect.poll(() => reader.locator(PLAINTEXT).count(), { message: "collapsed by keyboard" }).toBe(0);
    expect((await reader.content()).includes(account), "no full account number left on the page").toBe(false);
    await evidence(reader, testInfo, `${width}-p3-collapsed`);
    expect(readerProblems).toEqual([]);

    // ---- PHASE-004：CLERK 用鍵盤匯出（密碼確認後下載）。 ----
    const exportProblems = watchProblems(clerk);
    await clerk.goto("/suppliers");
    await tabTo(clerk, clerk.getByPlaceholder("搜尋 Code、名稱、電話或電郵"));
    await typeText(clerk, supplierCode);
    await expect(clerk.locator("tbody tr", { hasText: supplierCode })).toHaveCount(1);
    await tabTo(clerk, clerk.getByRole("button", { name: "匯出 CSV" }));
    const [download] = await Promise.all([clerk.waitForEvent("download"), (async () => {
      await press(clerk, "Enter");
      const prompt = clerk.getByRole("dialog").filter({ hasText: "匯出供應商" });
      await tabTo(clerk, prompt.locator("input[type=password]"));
      await typeText(clerk, uatFixture().users.CLERK.password);
      await press(clerk, "Enter");
    })()]);
    expect(await download.suggestedFilename()).toMatch(/\.csv$/u);
    await evidence(clerk, testInfo, `${width}-p4-exported`);
    expect(exportProblems).toEqual([]);
  }
});

test("@uat UAT-055 a VIEWER filters Audit by date, actor, action and target, pages through it, reads each entry's detail with sensitive values redacted and a request id", async ({ as }, testInfo) => {
  test.setTimeout(150_000);
  // 前置：一個 Supplier 有 create、狀態、Bank reveal、審批同 import 嘅 Audit（07 §2 前置，用 API／service，同 UI 送一樣嘅請求）。
  const { page: clerk, account: clerkAccount } = await as("CLERK");
  const tag = unique("U55");
  const supplier = await createDraft(clerk, { code: tag, name: `UAT-055 ${tag}` });
  await activateViaApi(clerk, supplier.id);
  const current = await api(clerk, "GET", `/api/v1/suppliers/${supplier.id}`);
  await api(clerk, "POST", `/api/v1/suppliers/${supplier.id}/suspend`, { version: current.version, reason: "UAT-055 status change", password: clerkAccount.password });
  const account = await addAccount(as, supplier.id, `UAT-055 Bank ${tag}`);
  const { page: reader, account: readerAccount } = await as("BANK-READER");
  const banks = await moduleCall(reader, "/src/services/supplierBank.js", "list", supplier.id);
  const bankId = JSON.parse(banks.slice(3))[0].id;
  expect((await moduleCall(reader, "/src/services/supplierBank.js", "reveal", supplier.id, bankId, { password: readerAccount.password, reason: "UAT-055 reveal" })).startsWith("ok:")).toBe(true);
  // 一般資料改幾次，令呢個 Supplier 嘅紀錄多過一頁（每頁最少 10 筆）。
  for (let n = 1; n <= 6; n += 1) {
    const latest = await api(clerk, "GET", `/api/v1/suppliers/${supplier.id}`);
    await api(clerk, "POST", `/api/v1/suppliers/${supplier.id}/update`, { supplierName: latest.supplierName, displayName: latest.displayName,
      defaultCurrencyCode: latest.defaultCurrencyCode, defaultPaymentTermId: latest.defaultPaymentTermId, website: "", generalPhone: "",
      generalEmail: "", notes: `UAT-055 note ${n}`, version: latest.version });
  }
  // 匯入：CLERK 喺畫面上載一個細檔（只要上載嘅 Audit）。
  await clerk.goto("/suppliers/imports");
  const [template] = await Promise.all([clerk.waitForEvent("download"), clerk.getByRole("button", { name: "下載範本" }).click()]);
  const columns = parse(fs.readFileSync(await template.path(), "utf8"), { bom: true })[0];
  const values = { supplierCode: `${tag}-I`, supplierName: `UAT-055 import ${tag}`, defaultCurrencyCode: "HKD" };
  const csv = `${columns.join(",")}\r\n${columns.map((name) => values[name] ?? "").join(",")}\r\n`;
  await clerk.getByRole("button", { name: "上載 CSV" }).click();
  await clerk.getByRole("dialog").locator("input[type=file]").setInputFiles({ name: "uat-055.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await clerk.getByRole("dialog").getByRole("button", { name: "上載" }).click();
  await expect(clerk.getByRole("heading", { name: /匯入工作 #\d+/u })).toBeVisible();
  await setApprovalPolicy(true);
  const pending = await createDraft(clerk, { code: `${tag}-P`, name: `UAT-055 pending ${tag}` });
  const draft = await api(clerk, "GET", `/api/v1/suppliers/${pending.id}`);
  await api(clerk, "POST", `/api/v1/suppliers/${pending.id}/activate`, { version: draft.version, approverUserId: uatFixture().users["APPROVER-A"].id });

  const { page } = await as("VIEWER");
  const problems = watchProblems(page);
  const rows = page.locator("tbody tr");

  // 對象：呢個 Supplier 嘅 Code；最少有 create、啟用、暫停、新增銀行帳戶、查看完整帳號。
  await page.goto("/suppliers/audit");
  await page.getByLabel("對象", { exact: true }).fill(tag);
  await expect(rows.filter({ hasText: "查看完整帳號" })).toHaveCount(1);
  for (const label of ["新增供應商", "啟用", "暫停", "新增銀行帳戶", "提交審批"]) {
    await expect(rows.filter({ hasText: label }).first(), label).toBeVisible();
  }
  await expect(page).toHaveURL(new RegExp(`target=${tag}`, "u"));
  await evidence(page, testInfo, "by-target");

  // 動作＋對象：只得嗰一筆 reveal；內容遮罩、冇明文，有 Request ID。
  await page.getByRole("combobox", { name: "動作" }).click();
  await page.getByRole("option", { name: "查看完整帳號", exact: true }).click();
  await expect(rows).toHaveCount(1);
  const reveal = rows.first();
  await expect(reveal).toContainText("uat-bank-reader");
  await expect(reveal).toContainText("UAT-055 reveal");
  const requestId = (await reveal.locator(".audit-request-id").textContent()).trim();
  expect(requestId.length, "every entry carries a request id").toBeGreaterThan(8);
  expect((await page.content()).includes(account), "no full account number in Audit").toBe(false);
  await expect(page).toHaveURL(/action=supplier\.bank\.reveal/u);
  await evidence(page, testInfo, "reveal-entry");

  // Filter URL：重新載入，同一組條件、同一個結果。
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator(".audit-request-id")).toHaveText(requestId);

  // 操作者：清走動作，淨係睇 BANK-READER 嘅紀錄。
  await page.goto(`/suppliers/audit?actor=uat-bank-reader&target=${tag}`);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("查看完整帳號");

  // 日期：今日包含；聽日之後冇資料。
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 32 * 3_600_000).toISOString().slice(0, 10);
  await page.goto(`/suppliers/audit?from=${today}&to=${today}&target=${tag}`);
  await expect(rows.filter({ hasText: "查看完整帳號" })).toHaveCount(1);
  await page.goto(`/suppliers/audit?from=${tomorrow}&target=${tag}`);
  await expect(page.getByText("冇資料")).toBeVisible();

  // 分頁追溯：每頁 10 筆，翻到第 2 頁仲見到呢個 Supplier 較早嘅紀錄，URL 帶住頁數。
  await page.goto(`/suppliers/audit?target=${tag}&pageSize=10`);
  await expect(rows).toHaveCount(10);
  const firstPage = await rows.allTextContents();
  await page.getByRole("button", { name: /下一頁|next/iu }).click();
  await expect(page).toHaveURL(/page=2/u);
  await expect.poll(async () => (await rows.allTextContents()).some((text) => firstPage.includes(text)),
    { message: "page 2 holds different entries" }).toBe(false);
  await expect(rows.first()).toBeVisible();
  await evidence(page, testInfo, "page-2");

  // 審批同匯入嘅紀錄都追溯得到，每筆都有 Request ID。
  for (const query of [`target=${tag}-P&action=approval.submit`, "actor=uat-clerk&action=import.upload"]) {
    await page.goto(`/suppliers/audit?${query}`);
    await expect(rows.first()).toBeVisible();
    expect((await rows.first().locator(".audit-request-id").textContent()).trim().length, query).toBeGreaterThan(8);
  }

  // 開啟詳情：由紀錄去返 Supplier 詳情嘅變更紀錄，同一筆 reveal 有同一個 Request ID。
  await page.goto(`/suppliers/${supplier.id}`);
  await page.getByRole("tab", { name: "變更紀錄" }).click();
  await expect(page.locator("tbody tr", { hasText: "查看完整帳號" })).toContainText(requestId);
  expect((await page.content()).includes(account), "no full account number in the Supplier's Audit tab").toBe(false);
  await evidence(page, testInfo, "supplier-audit-tab");
  expect(problems).toEqual([]);
});
