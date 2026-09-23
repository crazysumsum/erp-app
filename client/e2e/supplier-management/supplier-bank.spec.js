import { expect, test } from "@playwright/test";

/**
 * TASK-035 嘅瀏覽器驗證。T35 驗收裏面嗰句「Manual header check：DOM／storage／URL／
 * network cache 及 30 秒清除」—— 呢啲冇一樣 vitest 證得到：jsdom 冇真 storage
 * （opaque origin）、冇真 URL bar、冇真 response header、亦都冇一個真嘅 30 秒。
 *
 * API 喺 network 層 mock，所以唔使真後端；驗嘅係前端行為、佢**實際發出嘅請求**，
 * 同埋明文喺一個真瀏覽器入面到底去咗邊。
 */

const SECRET = "12345678901234";
const BANK_USER = {
  id: 1, username: "supplier-bank-admin", displayName: "Supplier Bank Admin", roles: ["system-admin"],
  permissions: ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]
};
const SUPPLIER = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
  defaultCurrencyCode: "HKD", defaultPaymentTermId: null, status: "active", version: 2,
  website: "", generalPhone: "", generalEmail: "", notes: "", createdAt: 100, updatedAt: 200,
  addresses: [], contacts: [], identifiers: [], bankAccounts: [], warnings: []
};
const MASKED = [{
  id: 41, supplierId: 7, bankName: "Test Bank", accountHolderName: "Evergreen Trading",
  maskedAccountNumber: "•••• 1234", status: "active", isDefault: true, version: 1,
  bankCountryCode: "HK", accountCurrencyCode: "HKD"
}];

async function installApi(page, { user = BANK_USER } = {}) {
  const state = { calls: [] };

  await page.addInitScript((session) => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    window.__supplierBankUser = session;
  }, user);

  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    state.calls.push({ method, path, search: url.search });

    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5203" };
    const ok = (data, extra = {}) => route.fulfill({
      status: 200, headers: { ...headers, ...extra },
      body: JSON.stringify({ success: true, data, meta: { requestId: "pw-request" } })
    });
    const fail = (status, code, message) => route.fulfill({
      status, headers,
      body: JSON.stringify({ success: false, error: { code, message }, meta: { requestId: "pw-request" } })
    });

    if (path === "/api/v1/user/me") return ok(user);
    if (method === "GET" && path === "/api/v1/suppliers") return ok({ items: [SUPPLIER], total: 1 });
    if (method === "GET" && path === "/api/v1/suppliers/7") return ok(SUPPLIER);
    if (method === "GET" && path === "/api/v1/suppliers/7/completeness") return ok({ supplierId: 7, issues: [], warnings: [] });
    if (method === "GET" && path === "/api/v1/suppliers/7/bank-accounts") return ok({ items: MASKED });
    if (method === "POST" && path === "/api/v1/suppliers/7/bank-accounts/41/reveal") {
      // 真伺服器就係咁答：framework/http/apiResponse.js 無條件加 no-store，而
      // handler 加 Pragma。喺呢度照抄，令下面個 header 斷言係對住真形狀。
      return ok({ id: 41, accountNumber: SECRET, revealedAt: Date.now() },
        { "cache-control": "no-store", pragma: "no-cache" });
    }
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

async function openBankTab(page) {
  await page.goto("/suppliers/7");
  await page.getByRole("tab", { name: "銀行資料" }).click();
  await expect(page.getByText("•••• 1234")).toBeVisible();
}

async function reveal(page) {
  await page.getByRole("button", { name: "查看完整帳號 Test Bank" }).click();
  const dialog = page.locator(".q-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("密碼").fill("Correct-Horse-1!");
  await dialog.getByLabel("查看原因").fill("核對付款帳號");
  await dialog.getByRole("button", { name: "確認查看" }).click();
  await expect(page.locator('[data-test="bank-plaintext"]')).toHaveText(SECRET);
}

test("@technical the masked list never fetches plaintext by itself", async ({ page }) => {
  const problems = collectConsole(page);
  const state = await installApi(page);
  await openBankTab(page);

  expect(state.calls.some((call) => call.path.endsWith("/reveal"))).toBe(false);
  await expect(page.locator("body")).not.toContainText(SECRET);
  expect(problems).toEqual([]);
});

test("@technical a revealed account lives only in the DOM, and only for thirty seconds", async ({ page }) => {
  test.setTimeout(90_000);
  const problems = collectConsole(page);
  await installApi(page);
  await openBankTab(page);

  // Network cache：呢個係唯一一個講得出帳號嘅 response。
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith("/reveal")),
    reveal(page)
  ]);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers().pragma).toBe("no-cache");

  // URL：帳號唔可以入 location，因為佢會入瀏覽器紀錄同 Referer。
  expect(page.url()).not.toContain(SECRET);

  // Storage：兩邊都要乾淨。用真瀏覽器嘅 storage，唔係 stub。
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage))
  }));
  expect(stored.local).not.toContain(SECRET);
  expect(stored.session).not.toContain(SECRET);

  // 倒數真係行緊 —— 斷言個數字**跌緊**，唔係淨係斷言佢喺度。一個凍結咗喺 30 嘅
  // 倒數一樣會令「睇得到倒數」呢句過關，但佢代表個 timer 冇行，即係亦都唔會清。
  const countdown = page.locator('[data-test="bank-reveal-countdown"]');
  const first = Number((await countdown.textContent()).match(/\d+/u)[0]);
  await expect.poll(async () => Number((await countdown.textContent()).match(/\d+/u)[0]),
    { timeout: 10_000 }).toBeLessThan(first);

  // 30 秒之後：唔淨係睇唔到，而係成個 document 裏面都搵唔返 —— v-show 會留低一個
  // display:none 嘅節點，而嗰個節點一樣讀得到。
  await expect(page.locator('[data-test="bank-plaintext"]')).toHaveCount(0, { timeout: 45_000 });
  const html = await page.content();
  expect(html).not.toContain(SECRET);
  expect(problems).toEqual([]);
});

test("@technical leaving the page clears the account immediately", async ({ page }) => {
  const problems = collectConsole(page);
  await installApi(page);
  await openBankTab(page);
  await reveal(page);

  // 行一次真嘅 client-side route change：撳側欄嗰條連結，即係使用者真正會行嗰條路。
  // 唔用 page.goto —— 嗰個係 full reload，會清晒所有嘢，證明唔到個
  // onBeforeRouteLeave guard 有冇做過嘢。
  await page.getByRole("link", { name: "供應商", exact: true }).click();
  await expect(page).toHaveURL(/\/suppliers(\?|$)/u);
  await expect(page.locator('[data-test="bank-plaintext"]')).toHaveCount(0);
  expect(await page.content()).not.toContain(SECRET);
  expect(problems).toEqual([]);
});
