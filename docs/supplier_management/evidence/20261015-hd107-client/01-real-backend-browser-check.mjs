/* global process, console, localStorage, URL */
// 真瀏覽器 + 真後端（erp_t51p 100k）驗 HD-107 G4／G5。結果同 DB 直接數嘅數比較。
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const W = "/Users/sam/Documents/workspace/erp-supplier-hd107c/";
const require = createRequire(W + "package.json");
const pw = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const chromium = pw.chromium ?? pw.default.chromium;
const mysql = (await import(pathToFileURL(createRequire(W + "server/package.json").resolve("mysql2/promise")).href)).default;
const real = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const SHOTS = process.argv[3];
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD, database: process.env.DB_NAME });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "PASS" : "FAIL", name, detail); };

// seed 入面每個 Supplier 都有 active Bank：暫時停用一小撮（USD、2023-10-16..18 建立）；篩 10-17 一日，兩邊日界都要啱先數得啱，最後還原。
const [touched] = await db.query(`SELECT b.id FROM supplier_bank_accounts b JOIN suppliers s ON s.id = b.supplier_id
  WHERE b.status = 'active' AND s.default_currency_code = 'USD' AND s.created_at BETWEEN ? AND ?`,
  [Date.parse("2023-10-16T00:00:00+08:00"), Date.parse("2023-10-18T23:59:59.999+08:00")]);
const touchedIds = touched.map((row) => row.id);
await db.query("UPDATE supplier_bank_accounts SET status = 'inactive' WHERE id IN (?)", [touchedIds]);
process.on("exit", () => {});
const restore = () => db.query("UPDATE supplier_bank_accounts SET status = 'active' WHERE id IN (?)", [touchedIds]);
try {
const from = Date.parse("2023-10-17T00:00:00+08:00");
const to = Date.parse("2023-10-17T23:59:59.999+08:00");
const [[{ expected }]] = await db.query(`SELECT COUNT(*) AS expected FROM suppliers s WHERE s.status <> 'archived'
  AND s.default_currency_code = 'USD' AND s.created_at BETWEEN ? AND ?
  AND NOT EXISTS (SELECT 1 FROM supplier_bank_accounts b WHERE b.supplier_id = s.id AND b.status = 'active')`, [from, to]);
const [[{ contactsTotal }]] = await db.query("SELECT COUNT(*) AS contactsTotal FROM supplier_contacts WHERE supplier_id = ?", [real.supplierId]);

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, timezoneId: "America/New_York" });
await context.addInitScript((token) => {
  localStorage.setItem("erp.token", token);
  localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
  localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
}, real.token);
const page = await context.newPage();
const problems = [];
const lists = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror ${e.message}`));
page.on("response", (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
// 記 request 次序（response 可能亂序返）；total 由對應嘅 response 補上。
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname !== "/api/v1/suppliers" || request.method() !== "GET") return;
  const entry = { query: Object.fromEntries(url.searchParams), total: undefined };
  lists.push(entry);
  request.response().then((r) => r?.json()).then((body) => { entry.total = body?.data?.total; }).catch(() => {});
});
const base = "http://127.0.0.1:5173";
await page.goto(`${base}/suppliers`);
await page.getByText("P50-").first().waitFor();
const wait = async (predicate) => { for (let i = 0; i < 100; i += 1) { if (predicate()) return true; await page.waitForTimeout(100); } return false; };

const pick = async (label, option) => { await page.getByRole("combobox", { name: label }).click(); await page.getByRole("option", { name: option }).click(); };
await pick("貨幣", /^USD/u);
await page.getByRole("checkbox", { name: "缺有效銀行資料" }).click();
await page.getByLabel("建立日期由").fill("2023-10-17");
await page.getByLabel("建立日期至").fill("2023-10-17");
await wait(() => lists.at(-1)?.query.createdTo);
await page.waitForLoadState("networkidle");
await wait(() => lists.at(-1).total !== undefined);
const last = lists.at(-1);
check("list request carries the filters as HK day bounds (browser in New York)", last.query.currencyCode === "USD" && last.query.missingBank === "true"
  && last.query.createdFrom === String(from) && last.query.createdTo === String(to), JSON.stringify(last.query));
check("API total equals a direct DB count", last.total === Number(expected), `api ${last.total} db ${expected}`);
const pager = await page.locator(".q-table__bottom").innerText();
check("pager shows the same total", pager.includes(String(expected)), pager.replace(/\s+/gu, " "));
await page.screenshot({ path: `${SHOTS}/list-filtered.png`, fullPage: true });

const before = lists.length;
await page.reload();
await wait(() => lists.length > before && lists.at(-1).total !== undefined);
check("reload restores the filters and the same result", lists.at(-1).total === Number(expected)
  && (await page.getByRole("checkbox", { name: "缺有效銀行資料" }).getAttribute("aria-checked")) === "true"
  && (await page.getByLabel("建立日期至").inputValue()) === "2023-10-17", page.url());

await page.getByRole("button", { name: "匯出 CSV" }).click();
const dialog = page.locator(".q-dialog").filter({ has: page.locator("input[type=password]") });
await dialog.locator("input[type=password]").fill(real.password);
const downloadPromise = page.waitForEvent("download");
await dialog.getByRole("button", { name: "匯出" }).click();
const download = await downloadPromise;
const csv = fs.readFileSync(await download.path(), "utf8").trim().split(/\r?\n/u);
check("export has the same rows as the filtered list", csv.length - 1 === Number(expected), `csv rows ${csv.length - 1}`);

await page.goto(`${base}/suppliers/${real.supplierId}`);
const tab = page.getByRole("tab", { name: /聯絡人 \(/u });
await tab.waitFor();
check("detail contact tab says 100+", (await tab.innerText()).includes("100+"), await tab.innerText());
await tab.click();
await page.getByText("已顯示 100 個聯絡人，可能還有更多").waitFor();
let clicks = 0;
while (await page.getByRole("button", { name: "載入更多聯絡人" }).count()) {
  await page.getByRole("button", { name: "載入更多聯絡人" }).click();
  clicks += 1;
  await page.waitForLoadState("networkidle");
  if (clicks > 5) break;
}
const status = await page.getByText(/已顯示 \d+ 個聯絡人，共 \d+ 個/u).innerText();
check("load more reaches every contact in the DB", status === `已顯示 ${contactsTotal} 個聯絡人，共 ${contactsTotal} 個`, `${status} after ${clicks} click(s)`);
check("the last contact by sort order is on screen", await page.getByText("HD107C 105").isVisible());
await page.screenshot({ path: `${SHOTS}/detail-contacts.png`, fullPage: true });

check("no console errors or failed responses", problems.length === 0, JSON.stringify(problems));
await browser.close();
} finally {
  await restore();
  const [[{ nonActive }]] = await db.query("SELECT COUNT(*) AS nonActive FROM supplier_bank_accounts WHERE status <> 'active'");
  console.log("restored", touchedIds.length, "bank accounts; non-active left:", Number(nonActive));
}
await db.end();
fs.writeFileSync(`${SHOTS}/realcheck.json`, JSON.stringify({ touchedBanks: touchedIds.length, results }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
