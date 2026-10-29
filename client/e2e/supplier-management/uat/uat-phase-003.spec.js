import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { expect } from "@playwright/test";
import { serverRoot } from "./uatEnvironment.mjs";
import { activateViaApi, auditRow, createDraft, db, evidence as captureEvidence, moduleCall, statusAction, statusBadge, test, watchProblems } from "./uatSupport.js";

/**
 * Supplier UAT PHASE-003：銀行資料（07_uat_test_cases.md §4.3；HD-124 A）。真 server、真 MySQL scratch database，冇 mock。
 * 每個 test 標題只帶一個 UAT ID。帳號係每個 test 新整嘅虛構數字。
 *
 * 07 §2：完整銀行帳號唔可以入截圖或者附件，連 test 失敗都唔可以（REV-123 R4）。所以：
 * - trace、失敗截圖同失敗時嘅 page aria snapshot（error-context.md）都關咗；
 * - 比較明文一律用 boolean，失敗訊息唔會印個帳號出嚟；
 * - 明文喺畫面（或者輸入框）嗰段時間只用 `expect.poll`，因為 locator matcher 失敗會附上成頁 aria snapshot；
 * - `evidence()` 截圖之前先確認畫面冇任何一個帳號。
 * 每個 case 最後查 Audit 同呢個 test 新寫嘅 server log 冇明文（SEC-010、SEC-011）。
 */
test.use({ trace: "off", screenshot: "off" });
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const PLAINTEXT = '[data-test="bank-plaintext"]';
const DOWNSTREAM = "needs downstream references (Purchasing / AP payment flows), which are not installed yet: HD-124 A, HD-131 A";

const fakeAccount = () => `8${randomInt(100_000_000, 999_999_999)}${randomInt(10, 99)}`;
const masked = (account) => `**** ${account.slice(-4)}`;
const bankCall = (page, method, ...args) => moduleCall(page, "/src/services/supplierBank.js", method, ...args);

const domHas = async (page, account) => (await page.content()).includes(account);
const revealedCount = (page) => page.locator(PLAINTEXT).count();
const revealedIs = async (page, account) => (await page.locator(PLAINTEXT).allTextContents()).join("") === account;
// 有明文嗰段時間唔用 locator matcher：失敗會附 aria snapshot。
const until = (probe, message) => expect.poll(probe, { message }).toBe(true);

const evidence = async (page, testInfo, name, accounts) => {
  await until(async () => (await revealedCount(page)) === 0, "nothing is revealed before the screenshot");
  for (const account of accounts) expect(await domHas(page, account), "no full account number on the page before the screenshot").toBe(false);
  await captureEvidence(page, testInfo, name);
};

/** 前置：BANK-OFFICER 經 client service（簽名＋密碼，同 UI 一樣）開一個虛構帳戶。 */
async function addAccount(officerPage, officer, supplierId, { bankName, account = fakeAccount(), isDefault = false }) {
  const result = await bankCall(officerPage, "create", supplierId, {
    accountHolderName: `${bankName} Holder`, bankName, accountNumber: account, isDefault, reason: "UAT bank setup", password: officer.password
  });
  expect(result.startsWith("ok:"), `create ${bankName}`).toBe(true);
  return { ...JSON.parse(result.slice(3)), account };
}

/** 一個 Active Supplier（CLERK 開）連一個虛構帳戶。 */
async function supplierWithAccount(as, options = {}) {
  const { page: clerkPage } = await as("CLERK");
  const supplier = await createDraft(clerkPage);
  await activateViaApi(clerkPage, supplier.id);
  const { page: officerPage, account: officer } = await as("BANK-OFFICER");
  const bank = await addAccount(officerPage, officer, supplier.id, { bankName: `UAT Bank ${supplier.supplierCode}`, isDefault: true, ...options });
  return { supplier, bank };
}

async function openBankTab(page, supplierId) {
  await page.goto(`/suppliers/${supplierId}`);
  await page.getByRole("tab", { name: "銀行資料" }).click();
  await expect(page.getByText("載入中…")).toHaveCount(0);
}

const bankRow = (page, bankName) => page.locator('section[aria-labelledby="supplier-bank-heading"] .q-item', { hasText: bankName });

// ---- Server log：只讀呢個 test 開始之後新寫嘅部分（REV-123 R1） ---------------------------------------------

const logRoot = path.join(serverRoot, "logs");
const logFiles = () => fs.readdirSync(logRoot, { recursive: true }).map((name) => path.join(logRoot, name)).filter((file) => fs.statSync(file).isFile());

/** 每個 log 檔而家嘅長度；之後只讀新增嘅 bytes。之前 run 留低嘅 log 唔可以當成呢個 test 嘅證據。 */
function logMark() {
  return new Map(logFiles().map((file) => [file, fs.statSync(file).size]));
}

function newLogText(mark, keep = () => true) {
  return logFiles().filter(keep).map((file) => fs.readFileSync(file).subarray(mark.get(file) ?? 0).toString("utf8")).join("\n");
}
// 只係 request log：被拒嘅請求會連 requestId 寫入 system log，所以喺全部 log 搵 requestId 證明唔到 request log 有寫。
const requestLogOnly = (file) => path.basename(file).startsWith("requests-");
const systemLogOnly = (file) => file.startsWith(path.join(logRoot, "system"));

/** 記低呢啲頁面送出嘅 bank 請求嘅 X-Request-Id，用嚟證明 request log 已經寫到呢個 test 最後一個請求。 */
function trackBankRequests(...pages) {
  const ids = [];
  for (const page of pages) {
    page.on("response", (response) => {
      if (response.request().method() === "OPTIONS" || !response.url().includes("/bank-accounts")) return;
      const id = response.headers()["x-request-id"];
      if (id) ids.push(id);
    });
  }
  return ids;
}

/**
 * Audit 同新寫嘅 server log 都唔可以有完整帳號。Log 要先見到呢個 test 最後一個 bank 請求嘅 requestId：
 * log 係串行寫，最後一個到咗即係之前嘅都到咗，所以唔會喺未 flush 之前就掃。
 * Audit 用 database 查（technical 補充）：detail JSON 喺畫面上睇唔晒。
 */
async function expectNoPlaintextStored({ supplierId, accounts, mark, requestIds }) {
  const [rows] = await (await db()).query(
    "SELECT action, reason, target_label, CAST(detail AS CHAR) AS detail FROM supplier_audit_logs WHERE supplier_id = ?", [supplierId]);
  expect(rows.length, "the Supplier has audit rows to search").toBeGreaterThan(0);
  expect(requestIds.length, "this test made bank requests to look for").toBeGreaterThan(0);
  await until(() => newLogText(mark, requestLogOnly).includes(requestIds.at(-1)), "the request log has this test's last bank request");
  const auditText = JSON.stringify(rows);
  const logText = newLogText(mark);
  for (const account of accounts) {
    expect(auditText.includes(account), "no full account number in Audit").toBe(false);
    expect(logText.includes(account), "no full account number in the server logs").toBe(false);
  }
}

test("@uat UAT-025 a VIEWER sees only the masked account and is refused a full view, with no plaintext anywhere", async ({ as }, testInfo) => {
  const mark = logMark();
  const { supplier, bank } = await supplierWithAccount(as);
  const { page, account: viewer } = await as("VIEWER");
  const requestIds = trackBankRequests(page);
  const problems = watchProblems(page, { allow: [{ status: 403, path: "/reveal" }] });

  await openBankTab(page, supplier.id);
  await expect(bankRow(page, bank.bankName)).toContainText(masked(bank.account));
  await expect(page.getByRole("button", { name: `查看完整帳號 ${bank.bankName}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新增銀行帳戶" })).toHaveCount(0);
  expect(await domHas(page, bank.account), "no full account number on the page").toBe(false);
  await evidence(page, testInfo, "masked", [bank.account]);

  // 「嘗試直接完整查看」：VIEWER 冇入口，所以用佢自己正確嘅密碼直接叫 reveal；伺服器以權限拒絕，回應冇明文。
  const refused = await bankCall(page, "reveal", supplier.id, bank.id, { password: viewer.password, reason: "UAT-025 direct full view" });
  expect(refused.startsWith("403 "), `refused: ${refused.split(" ")[0]}`).toBe(true);
  expect(refused.includes(bank.account), "no full account number in the refusal").toBe(false);
  expect(await domHas(page, bank.account), "no full account number on the page").toBe(false);
  await expectNoPlaintextStored({ supplierId: supplier.id, accounts: [bank.account], mark, requestIds });
  expect(problems).toEqual([]);
});

test("@uat UAT-026 a BANK-READER re-authenticates to reveal; the number shows briefly, clears after 30 s or on leaving, and the reveal is audited", async ({ as }, testInfo) => {
  const mark = logMark();
  const { supplier, bank } = await supplierWithAccount(as);
  const { page, account: reader } = await as("BANK-READER");
  const requestIds = trackBankRequests(page);
  await page.clock.install();
  const problems = watchProblems(page);

  await openBankTab(page, supplier.id);
  await expect(bankRow(page, bank.bankName)).toContainText(masked(bank.account));
  await expect(page.getByRole("button", { name: "新增銀行帳戶" })).toHaveCount(0);
  await evidence(page, testInfo, "masked-before", [bank.account]);

  const reveal = async (reason) => {
    await page.getByRole("button", { name: `查看完整帳號 ${bank.bankName}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("30 秒後自動隱藏");
    await dialog.getByLabel("密碼 *").fill(reader.password);
    await dialog.getByLabel("查看原因 *").fill(reason);
    await dialog.getByRole("button", { name: "確認查看" }).click();
    await until(() => revealedIs(page, bank.account), "the full number is shown after re-authentication");
  };

  // 30 秒：29 秒仲喺度，夠 30 秒就清走（REV-123 O2：一秒一步，31 秒先清都會紅）。Reveal 之後即刻停咗個鐘：
  // 唔停嘅話假時間會跟真時間行，poll 等緊嗰幾秒就會行過 deadline。
  await reveal("UAT-026 confirm payee details");
  // +200 ms：pauseAt 只可以向前；+1 ms 喺機器慢嗰陣已經過咗（Cannot fast-forward to the past）。29 秒嗰下仍然有約 800 ms 餘地。
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200));
  await until(async () => (await page.locator('[data-test="bank-reveal-countdown"]').allTextContents()).join("").includes("秒後自動隱藏"),
    "a countdown is shown");
  await page.clock.runFor(29_000);
  expect(await revealedIs(page, bank.account), "still shown at 29 s").toBe(true);
  await page.clock.runFor(1_000);
  await until(async () => (await revealedCount(page)) === 0, "cleared at 30 s");
  await page.clock.resume();
  await expect(bankRow(page, bank.bankName)).toContainText(masked(bank.account));
  await evidence(page, testInfo, "cleared-after-30s", [bank.account]);

  // 離頁：經選單去供應商列表（app 內轉頁）即刻清，返嚟係遮罩。Panel 一 unmount 明文就冇咗，所以呢步分唔出
  // 係邊個清除觸發點做嘅（REV-123 O3），只證明使用者見到嘅結果。
  await reveal("UAT-026 second look before leaving");
  await page.getByRole("link", { name: "供應商", exact: true }).click();
  await until(() => /\/suppliers(\?|$)/u.test(page.url()), "on the Supplier list");
  expect(await domHas(page, bank.account), "no full account number after leaving").toBe(false);
  await openBankTab(page, supplier.id);
  await expect(page.locator(PLAINTEXT)).toHaveCount(0);
  await expect(bankRow(page, bank.bankName)).toContainText(masked(bank.account));

  const audit = await auditRow(page, "查看完整帳號");
  await expect(audit).toHaveCount(2);
  await expect(audit.first()).toContainText("uat-bank-reader");
  await expect(page.locator("tbody")).toContainText("UAT-026 confirm payee details");
  await evidence(page, testInfo, "reveal-audit", [bank.account]);
  await expectNoPlaintextStored({ supplierId: supplier.id, accounts: [bank.account], mark, requestIds });
  expect(problems).toEqual([]);
});

test("@uat UAT-027 a CLERK and a BANK-READER cannot add or change bank accounts; the server refuses and nothing changes", async ({ as }, testInfo) => {
  const mark = logMark();
  const { supplier, bank } = await supplierWithAccount(as);
  // 資料冇變：畫面睇到遮罩同一行；version 同名稱用 database 對（technical 補充）。
  const snapshot = async () => (await (await db()).query(
    "SELECT COUNT(*) AS count, MAX(version) AS version, MAX(bank_name) AS bankName FROM supplier_bank_accounts WHERE supplier_id = ?", [supplier.id]))[0][0];
  const before = await snapshot();
  const newAccounts = [];

  for (const role of ["CLERK", "BANK-READER"]) {
    const { page, account } = await as(role);
    const requestIds = trackBankRequests(page);
    const problems = watchProblems(page, { allow: [{ status: 403, path: "/create" }, { status: 403, path: "/update" }] });
    await openBankTab(page, supplier.id);
    await expect(bankRow(page, bank.bankName)).toContainText(masked(bank.account));
    await expect(page.getByRole("button", { name: "新增銀行帳戶" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `編輯 ${bank.bankName}` })).toHaveCount(0);
    await evidence(page, testInfo, `${role.toLowerCase()}-no-write-controls`, [bank.account]);

    // 直接叫寫入：自己正確嘅密碼、已核准嘅設備，伺服器照樣以權限拒絕。
    const newAccount = fakeAccount();
    newAccounts.push(newAccount);
    const created = await bankCall(page, "create", supplier.id, {
      accountHolderName: "UAT-027 Holder", bankName: `UAT-027 ${role}`, accountNumber: newAccount, reason: "UAT-027 unauthorized add", password: account.password
    });
    expect(created.startsWith("403 "), `create refused: ${created.split(" ")[0]}`).toBe(true);
    const updated = await bankCall(page, "update", supplier.id, bank.id, {
      accountHolderName: "UAT-027 Holder", bankName: `UAT-027 renamed by ${role}`, version: bank.version, reason: "UAT-027 unauthorized edit", password: account.password
    });
    expect(updated.startsWith("403 "), `update refused: ${updated.split(" ")[0]}`).toBe(true);
    await page.reload();
    await page.getByRole("tab", { name: "銀行資料" }).click();
    await expect(bankRow(page, bank.bankName)).toContainText(masked(bank.account));
    await expect(page.locator('section[aria-labelledby="supplier-bank-heading"] .q-item')).toHaveCount(1);
    await expectNoPlaintextStored({ supplierId: supplier.id, accounts: [bank.account, ...newAccounts], mark, requestIds });
    expect(problems).toEqual([]);
  }

  expect(await snapshot()).toEqual(before);
});

test("@uat UAT-028 a BANK-OFFICER makes another account the default; the old default is cleared in the same operation", async ({ as }, testInfo) => {
  const mark = logMark();
  const { supplier, bank: first } = await supplierWithAccount(as);
  const { page, account: officer } = await as("BANK-OFFICER");
  const requestIds = trackBankRequests(page);
  const second = await addAccount(page, officer, supplier.id, { bankName: `UAT Bank B ${supplier.supplierCode}` });
  const accounts = [first.account, second.account];
  const problems = watchProblems(page);

  await openBankTab(page, supplier.id);
  await expect(bankRow(page, first.bankName)).toContainText("預設");
  await expect(bankRow(page, second.bankName)).not.toContainText("預設");
  await evidence(page, testInfo, "before", accounts);

  await page.getByRole("button", { name: `設為預設 ${second.bankName}` }).click();
  const dialog = page.getByRole("dialog");
  // 設計 §7.5：要明講舊 default 會同時被取消。
  await expect(dialog).toContainText("原本嘅預設銀行帳戶會同時被取消");
  await dialog.getByLabel("密碼 *").fill(officer.password);
  await dialog.getByLabel("原因 *").fill("UAT-028 switch payee account");
  await dialog.getByRole("button", { name: "確認" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(bankRow(page, second.bankName)).toContainText("預設");
  await expect(bankRow(page, first.bankName)).not.toContainText("預設");
  // 「只剩一個有效 default」連冇顯示嘅行都要計（technical 補充）。
  const [defaults] = await (await db()).query(
    "SELECT id FROM supplier_bank_accounts WHERE supplier_id = ? AND status = 'active' AND is_default = 1", [supplier.id]);
  expect(defaults.map((row) => Number(row.id))).toEqual([second.id]);
  await evidence(page, testInfo, "after", accounts);

  const audit = await auditRow(page, "設為預設銀行帳戶");
  await expect(audit).toHaveCount(1);
  await expect(audit).toContainText("UAT-028 switch payee account");
  await expectNoPlaintextStored({ supplierId: supplier.id, accounts, mark, requestIds });
  expect(problems).toEqual([]);
});

test("@uat UAT-029 a Supplier without any bank account activates; missing payment data is not the Supplier module's to block", async ({ as }, testInfo) => {
  const { page } = await as("CLERK");
  const supplier = await createDraft(page);
  const problems = watchProblems(page);

  await page.goto(`/suppliers/${supplier.id}`);
  await statusAction(page, "啟用");
  await expect(statusBadge(page)).toHaveText("啟用");
  await page.getByRole("tab", { name: "銀行資料" }).click();
  await expect(page.getByText("尚未設定銀行資料")).toBeVisible();
  await evidence(page, testInfo, "active-without-bank", []);
  expect(problems).toEqual([]);
  // Buyer 喺 Purchasing 揀呢個 Supplier、付款資料缺少只由下游提示：要 Purchasing 畫面。
  test.fixme(true, DOWNSTREAM);
});

test("@uat UAT-030 SYSTEM-ADMIN has every bank permission, yet still sees the masked list and re-authenticates to reveal and to change, with Audit and an alert", async ({ as }, testInfo) => {
  const mark = logMark();
  const { supplier, bank } = await supplierWithAccount(as);
  const { page, account: admin } = await as("SYSTEM-ADMIN");
  const requestIds = trackBankRequests(page);
  // 密碼錯係 403 PASSWORD_INVALID（passwordReauth.js：401 會令前端當 session 失效登出）。
  const problems = watchProblems(page, { allow: [{ status: 403, path: "/reveal" }, { status: 403, path: "/update" }] });

  await openBankTab(page, supplier.id);
  await expect(bankRow(page, bank.bankName)).toContainText(masked(bank.account));
  await expect(page.getByRole("button", { name: "新增銀行帳戶" })).toBeVisible();
  expect(await domHas(page, bank.account), "no full account number on the page").toBe(false);
  await evidence(page, testInfo, "masked-for-admin", [bank.account]);

  // Reveal 要密碼：錯嘅密碼唔得，啱嘅先顯示。
  await page.getByRole("button", { name: `查看完整帳號 ${bank.bankName}` }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "確認查看" })).toBeDisabled();
  await dialog.getByLabel("密碼 *").fill(`${admin.password}-wrong`);
  await dialog.getByLabel("查看原因 *").fill("UAT-030 break-glass check");
  await dialog.getByRole("button", { name: "確認查看" }).click();
  await expect(dialog.getByRole("alert")).toContainText("密碼不正確");
  await expect(page.locator(PLAINTEXT)).toHaveCount(0);
  await dialog.getByLabel("密碼 *").fill(admin.password);
  await dialog.getByRole("button", { name: "確認查看" }).click();
  await until(() => revealedIs(page, bank.account), "the full number is shown after re-authentication");
  await page.getByRole("button", { name: "收起" }).click();
  await until(async () => (await revealedCount(page)) === 0, "hidden again");

  // 改銀行資料要重新認證：錯嘅密碼伺服器拒絕、資料冇變（REV-123 R3），啱嘅先成功。
  const renamed = `${bank.bankName} (admin)`;
  const edit = async (password) => {
    await page.getByRole("button", { name: `編輯 ${bank.bankName}` }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("銀行名稱 *").fill(renamed);
    await dialog.getByLabel("修改原因 *").fill("UAT-030 break-glass correction");
    await expect(dialog.getByRole("button", { name: "儲存" })).toBeDisabled();
    await dialog.getByLabel("密碼 *").fill(password);
    await dialog.getByRole("button", { name: "儲存" }).click();
  };
  await edit(`${admin.password}-wrong`);
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await page.reload();
  await page.getByRole("tab", { name: "銀行資料" }).click();
  await expect(bankRow(page, bank.bankName)).toContainText(masked(bank.account));
  await expect(bankRow(page, renamed)).toHaveCount(0);
  await edit(admin.password);
  await expect(dialog).toHaveCount(0);
  await expect(bankRow(page, renamed)).toContainText(masked(bank.account));

  await page.getByRole("tab", { name: "變更紀錄" }).click();
  for (const [label, reason] of [["查看完整帳號", "UAT-030 break-glass check"], ["編輯銀行帳戶", "UAT-030 break-glass correction"]]) {
    const row = page.locator("tbody tr", { hasText: label });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("uat-system-admin");
    await expect(row).toContainText(reason);
  }
  await evidence(page, testInfo, "admin-audit", [bank.account]);
  await expectNoPlaintextStored({ supplierId: supplier.id, accounts: [bank.account], mark, requestIds });
  expect(problems).toEqual([]);

  // 告警（SEC-014、設計 §4 system-admin、§12.4）：break-glass 嘅 reveal 同修改要有告警，即係 system log 有一條提到呢個
  // Supplier 嘅 warn 級以上事件。DEF-047：而家冇，所以呢步會紅，等 HD-142 決定（REV-123 R2）。
  const alerted = () => newLogText(mark, systemLogOnly).split("\n").filter(Boolean).some((line) => {
    try {
      const entry = JSON.parse(line);
      return ["warn", "error"].includes(entry.level) && Number(entry.context?.supplierId) === supplier.id;
    } catch {
      return false;
    }
  });
  await until(alerted, "DEF-047: a warn-level system log event for this system-admin bank use");
});

test("@uat UAT-053 a BANK-OFFICER adds, edits, sets the default and deactivates an account; plaintext appears only while typed or revealed, and every step is audited", async ({ as }, testInfo) => {
  const mark = logMark();
  const { page: clerkPage } = await as("CLERK");
  const supplier = await createDraft(clerkPage);
  await activateViaApi(clerkPage, supplier.id);
  const { page, account: officer } = await as("BANK-OFFICER");
  const requestIds = trackBankRequests(page);
  const problems = watchProblems(page);
  const firstAccount = fakeAccount();
  const secondAccount = fakeAccount();
  const changedAccount = fakeAccount();
  const accounts = [firstAccount, secondAccount, changedAccount];
  const first = `UAT-053 Main ${supplier.supplierCode}`;
  const second = `UAT-053 Spare ${supplier.supplierCode}`;
  // 輸入框入面有明文嗰陣唔用 locator matcher（見檔頭）。
  const dialogClosed = () => until(async () => (await page.getByRole("dialog").count()) === 0, "the dialog closed after saving");

  await openBankTab(page, supplier.id);
  for (const [bankName, account, isDefault] of [[first, firstAccount, true], [second, secondAccount, false]]) {
    await page.getByRole("button", { name: "新增銀行帳戶" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("帳戶名稱 *").fill(`${bankName} Holder`);
    await dialog.getByLabel("銀行名稱 *").fill(bankName);
    await dialog.getByLabel("帳號 *").fill(account);
    if (isDefault) await dialog.getByRole("switch", { name: "設為預設銀行帳戶" }).click();
    await dialog.getByLabel("新增原因 *").fill("UAT-053 onboarding payee");
    await dialog.getByLabel("密碼 *").fill(officer.password);
    await dialog.getByRole("button", { name: "儲存" }).click();
    await dialogClosed();
    await expect(bankRow(page, bankName)).toContainText(masked(account));
  }
  await evidence(page, testInfo, "added", accounts);

  // 改帳號：輸入框以外冇明文，列表即刻係新嘅遮罩。
  await page.getByRole("button", { name: `編輯 ${second}` }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("帳號（留空即不修改）")).toHaveValue("");
  await dialog.getByLabel("帳號（留空即不修改）").fill(changedAccount);
  await dialog.getByLabel("修改原因 *").fill("UAT-053 corrected account");
  await dialog.getByLabel("密碼 *").fill(officer.password);
  await dialog.getByRole("button", { name: "儲存" }).click();
  await dialogClosed();
  await expect(bankRow(page, second)).toContainText(masked(changedAccount));
  expect(await domHas(page, changedAccount), "no full account number on the page after saving").toBe(false);

  // 設 default，再停用原本嗰個（未被引用）。
  for (const [action, bankName, reason] of [["設為預設", second, "UAT-053 new default"], ["停用", first, "UAT-053 retire old account"]]) {
    await page.getByRole("button", { name: `${action} ${bankName}` }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("密碼 *").fill(officer.password);
    await dialog.getByLabel("原因 *").fill(reason);
    await dialog.getByRole("button", { name: "確認" }).click();
    await expect(dialog).toHaveCount(0);
  }
  // 遮罩列表只列有效帳戶（設計 §6.6 GET 冇 includeInactive）：停用嗰個唔再列出、唔再揀得到。保留同 default 用
  // database 對（technical 補充）；使用者睇得到嘅證據係下面 Audit 嘅「停用銀行帳戶」。
  await expect(bankRow(page, second)).toContainText("預設");
  await expect(bankRow(page, first)).toHaveCount(0);
  const [kept] = await (await db()).query("SELECT bank_name, status, is_default FROM supplier_bank_accounts WHERE supplier_id = ? ORDER BY id", [supplier.id]);
  expect(kept.map((row) => [row.bank_name, row.status, Number(row.is_default)])).toEqual([[first, "inactive", 0], [second, "active", 1]]);
  // 冇刪除：停用係唯一退役方式。
  await expect(page.getByRole("button", { name: /刪除/u })).toHaveCount(0);
  await evidence(page, testInfo, "after-changes", accounts);

  await page.getByRole("tab", { name: "變更紀錄" }).click();
  for (const [label, count] of [["新增銀行帳戶", 2], ["編輯銀行帳戶", 1], ["設為預設銀行帳戶", 1], ["停用銀行帳戶", 1]]) {
    await expect(page.locator("tbody tr", { hasText: label })).toHaveCount(count);
  }
  await evidence(page, testInfo, "audit", accounts);
  await expectNoPlaintextStored({ supplierId: supplier.id, accounts, mark, requestIds });
  expect(problems).toEqual([]);
  // 被付款流程引用嘅帳戶唔可以停用／刪除、歷史完整：要下游付款流程引用。
  test.fixme(true, DOWNSTREAM);
});
