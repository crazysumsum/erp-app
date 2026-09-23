import { expect, test } from "@playwright/test";

/**
 * `/suppliers/:id` 是一條 route record：`/suppliers/7` 去 `/suppliers/8` 由 Vue Router
 * 重用同一個 component instance，`onMounted` 不會再跑。這一份驗的就是那條路。
 *
 * 為什麼一定要在真瀏覽器跑：vitest 那邊用的是 createMemoryHistory 同一條只有 detail
 * 的 route table，證不到真 router、真 history、真 guard 之下同樣重用。
 *
 * 為什麼不用 page.goto("/suppliers/8")：那是整頁重載，component 會重新掛載，
 * watcher 有沒有都一樣綠——即是什麼都沒驗到。這裡改為在頁面裡叫 app 自己那個
 * router.push，並且用一個 window sentinel 釘住「中途沒有重載過」。
 *
 * API 在 network 層 mock，不需要真後端。
 */

const VIEWER = {
  id: 1,
  username: "supplier-detail-viewer",
  displayName: "Supplier Detail Viewer",
  roles: ["supplier-manager"],
  permissions: ["supplier.view", "supplier.mgmt"]
};

function supplier(id, code, name) {
  return {
    id, supplierCode: code, supplierName: name, displayName: name,
    defaultCurrencyCode: "HKD", defaultPaymentTermId: null, status: "active", version: 1,
    website: "", generalPhone: "", generalEmail: "", notes: "",
    createdAt: 100, updatedAt: 200,
    addresses: [], contacts: [], identifiers: [], bankAccounts: [], warnings: []
  };
}

const SUPPLIERS = {
  7: supplier(7, "SUP-007", "Evergreen Trading"),
  8: supplier(8, "SUP-008", "Northwind Supply")
};

async function installApi(page) {
  const calls = [];

  await page.addInitScript((user) => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    window.__supplierDetailUser = user;
  }, VIEWER);

  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path });

    const headers = {
      "content-type": "application/json",
      "access-control-allow-origin": "http://127.0.0.1:5203"
    };
    const ok = (data) => route.fulfill({
      status: 200, headers,
      body: JSON.stringify({ success: true, data, meta: { requestId: "pw-request" } })
    });

    if (path === "/api/v1/user/me") return ok(VIEWER);

    const completeness = path.match(/^\/api\/v1\/suppliers\/(\d+)\/completeness$/);
    if (completeness) return ok({ supplierId: Number(completeness[1]), issues: [], warnings: [] });

    const detail = path.match(/^\/api\/v1\/suppliers\/(\d+)$/);
    if (detail) return ok(SUPPLIERS[detail[1]]);

    // 編輯面板會載貨幣／付款條件；這一份不驗那些選項，給空清單就夠。
    if (path.startsWith("/api/v1/business-master/")) return ok({ items: [], total: 0 });

    return route.fulfill({
      status: 404, headers,
      body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: `unrouted ${path}` }, meta: {} })
    });
  });

  return calls;
}

function collectConsole(page) {
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

// 由頁面裡叫 app 自己那個 router，模擬一個「下一個供應商」連結會做的事。
// history.pushState 做不到這件事：它不會驅動 Vue Router，push 完什麼都不會發生。
//
// 一定要 await 那個 promise：唔 await 嘅話 evaluate 會喺導航仲未完成就返，而 test
// 就去 assert DOM——冷 dev server 慢少少就會間歇性紅。呢個 flake 真係咬過我一次。
//
// 順便回傳 NavigationFailure：vue-router 嘅 push 被 guard 擋住係 *resolve* 一個
// failure object，唔係 reject。回傳出嚟，「行到／被擋」就變成明確斷言，唔使靠
// 畫面反推。
async function pushInApp(page, path) {
  return page.evaluate(async (target) => {
    const router = document.getElementById("app").__vue_app__.config.globalProperties.$router;
    const failure = await router.push(target);
    return { aborted: Boolean(failure), type: failure?.type ?? null };
  }, path);
}

test("@technical a router.push between two supplier ids refetches on the reused instance", async ({ page }) => {
  const problems = collectConsole(page);
  const calls = await installApi(page);

  await page.goto("/suppliers/7");
  await expect(page.getByRole("heading", { name: /SUP-007/ })).toBeVisible();

  // sentinel：只要整頁重載過，這個變數就會消失，而測試綠的原因就會變成重新掛載。
  await page.evaluate(() => { window.__sameDocument = true; });

  expect(await pushInApp(page, "/suppliers/8")).toMatchObject({ aborted: false });

  await expect(page.getByRole("heading", { name: /SUP-008/ })).toBeVisible();
  await expect(page.getByText("Northwind Supply", { exact: true })).toBeVisible();
  await expect(page.getByText("Evergreen Trading")).toHaveCount(0);
  expect(page.url()).toContain("/suppliers/8");
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  expect(calls.filter((call) => call.path === "/api/v1/suppliers/8")).toHaveLength(1);
  expect(calls.filter((call) => call.path === "/api/v1/suppliers/8/completeness")).toHaveLength(1);
  expect(problems).toEqual([]);
});

// 真瀏覽器嘅 confirm() 返真 boolean，所以呢度先驗得到個 guard 真係擋唔擋到。
// jsdom 嗰邊返 undefined，而 vue-router 只當 false 算取消——即係 vitest 入面
// 唔 stub 就永遠係放行，個 guard 守唔守到根本冇驗過。
async function answerConfirm(page, answer) {
  const seen = [];
  page.on("dialog", async (dialog) => {
    seen.push({ type: dialog.type(), message: dialog.message() });
    await (answer ? dialog.accept() : dialog.dismiss());
  });
  return seen;
}

async function startEditWithDraft(page) {
  await page.getByRole("button", { name: "編輯一般資料" }).click();
  const name = page.getByLabel("Supplier Name");
  await expect(name).toHaveValue("Evergreen Trading");
  await name.fill("Evergreen Trading (draft)");
}

test("@technical a half-edited form does not survive the move to another supplier", async ({ page }) => {
  const problems = collectConsole(page);
  await installApi(page);
  const dialogs = await answerConfirm(page, true);

  await page.goto("/suppliers/7");
  await startEditWithDraft(page);

  await page.evaluate(() => { window.__sameDocument = true; });
  expect(await pushInApp(page, "/suppliers/8")).toMatchObject({ aborted: false });

  await expect(page.getByRole("heading", { name: /SUP-008/ })).toBeVisible();
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  expect(dialogs).toEqual([{ type: "confirm", message: "有未儲存的變更，確定要離開這一頁嗎？" }]);
  // 編輯面板收起來了：沒有東西可以把 7 號的輸入用 8 號的 id 提交出去。
  await expect(page.getByRole("button", { name: "儲存一般資料" })).toHaveCount(0);
  await page.getByRole("button", { name: "編輯一般資料" }).click();
  await expect(page.getByLabel("Supplier Name")).toHaveValue("Northwind Supply");
  expect(problems).toEqual([]);
});

test("@technical refusing the prompt keeps both the supplier and the draft", async ({ page }) => {
  const problems = collectConsole(page);
  const calls = await installApi(page);
  const dialogs = await answerConfirm(page, false);

  await page.goto("/suppliers/7");
  await startEditWithDraft(page);

  // 撳「取消」之後，push 要回報導航被中止——唔係靜靜地當冇事發生。
  expect(await pushInApp(page, "/suppliers/8")).toMatchObject({ aborted: true });

  expect(dialogs).toHaveLength(1);
  await expect(page.getByRole("heading", { name: /SUP-007/ })).toBeVisible();
  expect(page.url()).toContain("/suppliers/7");
  expect(calls.some((call) => call.path === "/api/v1/suppliers/8")).toBe(false);
  // 問完之後照食咗人哋啲輸入，比唔問更差。
  await expect(page.getByLabel("Supplier Name")).toHaveValue("Evergreen Trading (draft)");
  expect(problems).toEqual([]);
});

// `/suppliers/:id` 收得任何字串，打錯網址或者跟住條舊 link 就到得呢度。coerce 成
// NaN 之後 `NaN !== NaN` 令 supersede 判斷次次答「已經過時」：`loading` 清唔到、
// `error` 又寫唔入，頁面就永遠吊喺骨架——冇資料、冇錯誤、冇得撳。
//
// 要喺真瀏覽器釘埋 network 嗰半邊：短路咗之後連一個 NaN id 嘅請求都唔應該發出。
// 淨係睇畫面嘅話，一個「照發請求、等後端 404」嘅寫法一樣會綠。
test("@technical a non-numeric id lands on not-found instead of an endless skeleton", async ({ page }) => {
  const problems = collectConsole(page);
  const calls = await installApi(page);

  await page.goto("/suppliers/abc");

  await expect(page.getByRole("alert")).toContainText("找不到這個供應商");
  await expect(page.getByRole("link", { name: "返回供應商列表" })).toBeVisible();
  await expect(page.getByLabel("載入供應商詳情")).toHaveCount(0);
  expect(calls.filter((call) => call.path.startsWith("/api/v1/suppliers"))).toEqual([]);
  expect(problems).toEqual([]);
});
