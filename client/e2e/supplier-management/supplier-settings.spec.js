import { expect, test } from "@playwright/test";

/**
 * TASK-027 嘅瀏覽器驗證。靜態檢查同 vitest 證明唔到嘅嘢：真正嘅 Quasar dialog、
 * 真鍵盤操作、真 console 同真 network。
 *
 * API 喺 network 層 mock，所以唔使真後端；驗嘅係前端行為同佢**實際發出嘅請求**。
 */

const SETTINGS_ADMIN = {
  id: 1,
  username: "supplier-settings-admin",
  displayName: "Supplier Settings Admin",
  roles: ["system-admin"],
  permissions: ["supplier.settings", "business_master.view"]
};

const READY = {
  status: "READY",
  providerContract: "business-master-currency-payment-term-provider/v1",
  schemaReady: true,
  hkdReady: true,
  permissionsReady: true,
  activeCurrencyCount: 3,
  activePaymentTermCount: 2
};

async function installApi(page, options = {}) {
  const state = {
    settings: {
      requireActivationApproval: options.approvalOn ?? false,
      version: 4,
      updatedAt: 1_757_808_000_000,
      updatedBy: 1
    },
    readiness: options.readiness ?? READY,
    readinessFails: options.readinessFails ?? false,
    settingsFails: options.settingsFails ?? false,
    user: options.user ?? SETTINGS_ADMIN,
    calls: []
  };

  await page.addInitScript((user) => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    window.__supplierSettingsUser = user;
  }, state.user);

  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = request.postDataJSON?.() ?? null;
    state.calls.push({ method, path, body, headers: request.headers() });

    const headers = {
      "content-type": "application/json",
      "access-control-allow-origin": "http://127.0.0.1:5203"
    };
    const ok = (data, status = 200) => route.fulfill({
      status, headers,
      body: JSON.stringify({ success: true, data, meta: { requestId: "pw-request" } })
    });
    const fail = (status, code, message) => route.fulfill({
      status, headers,
      body: JSON.stringify({ success: false, error: { code, message }, meta: { requestId: "pw-request" } })
    });

    if (path === "/api/v1/user/me") return ok(state.user);

    if (method === "GET" && path === "/api/v1/supplier-lookups/business-master") {
      if (state.readinessFails) return fail(503, "BUSINESS_MASTER_NOT_READY", "Business Master is not ready");
      return ok(state.readiness);
    }

    if (method === "GET" && path === "/api/v1/supplier-settings") {
      if (state.settingsFails) return fail(500, "INTERNAL_SERVER_ERROR", "Internal server error");
      return ok(state.settings);
    }

    if (method === "POST" && path === "/api/v1/supplier-settings/update") {
      if (options.conflictOnce && !state.conflicted) {
        state.conflicted = true;
        // 服務器揸住 ON，而呢個請求要求 OFF。重載之後個開關要跟服務器，即係 ON。
        state.settings = { ...state.settings, requireActivationApproval: true, version: 9 };
        return fail(409, "VERSION_CONFLICT", "設定已被其他人修改，請重新載入");
      }
      state.settings = {
        ...state.settings,
        requireActivationApproval: Boolean(body.requireActivationApproval),
        version: state.settings.version + 1
      };
      return ok(state.settings);
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

async function confirmDialog(page, reason, password) {
  const dialog = page.locator(".q-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("原因").fill(reason);
  await dialog.getByLabel("密碼").fill(password);
  await dialog.getByRole("button", { name: "確認儲存" }).click();
}

test("@technical the settings page turns approval on, then off, and says it is not retroactive", async ({ page }) => {
  const problems = collectConsole(page);
  const state = await installApi(page);

  await page.goto("/suppliers/settings");
  await expect(page.getByRole("heading", { name: "啟用審批" })).toBeVisible();
  await expect(page.getByText("不追溯處理已在審批中的申請")).toBeVisible();

  const toggle = page.locator(".q-toggle");
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await confirmDialog(page, "公司開始要求供應商建檔覆核", "browser-test-password");
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  const on = state.calls.find((call) => call.path === "/api/v1/supplier-settings/update");
  expect(on.body).toMatchObject({ requireActivationApproval: true, version: 4, reason: "公司開始要求供應商建檔覆核" });
  // 設計 §6.7：呢個寫入要已核准裝置。冇 device header 就代表 signed: true 甩咗。
  expect(Object.keys(on.headers).some((name) => name.toLowerCase().startsWith("x-device-"))).toBe(true);

  await toggle.click();
  await confirmDialog(page, "改回由建檔人直接啟用", "browser-test-password");
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  const off = state.calls.filter((call) => call.path === "/api/v1/supplier-settings/update").at(-1);
  expect(off.body).toMatchObject({ requireActivationApproval: false, version: 5 });

  // 整頁由頭到尾唔可以直接叫 Business Master 嘅 endpoint（HD-022）。
  expect(state.calls.some((call) => call.path.startsWith("/api/v1/business-master"))).toBe(false);
  expect(problems).toEqual([]);
});

test("@technical cancelling the confirmation leaves the setting untouched", async ({ page }) => {
  const state = await installApi(page);
  await page.goto("/suppliers/settings");

  const toggle = page.locator(".q-toggle");
  await toggle.click();
  await expect(page.locator(".q-dialog")).toBeVisible();
  await page.locator(".q-dialog").getByRole("button", { name: "取消" }).click();

  await expect(page.locator(".q-dialog")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(state.calls.some((call) => call.path === "/api/v1/supplier-settings/update")).toBe(false);
});

test("@technical the toggle is reachable and operable by keyboard alone", async ({ page }) => {
  const state = await installApi(page);
  await page.goto("/suppliers/settings");
  await expect(page.locator(".q-toggle")).toBeVisible();

  // 唔假設開關喺 tab order 第幾個——版面本身有 header 同側欄。要驗嘅係佢**到達
  // 得到**，所以行到佢 focus 為止，行唔到就係鍵盤到唔到，測試自然紅。
  const toggle = page.locator(".q-toggle");
  for (let press = 0; press < 20 && !(await toggle.evaluate((node) => node === document.activeElement)); press += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");

  const dialog = page.locator(".q-dialog");
  await expect(dialog).toBeVisible();
  // 對話框開咗之後焦點要落喺第一個輸入欄，唔係留喺後面嗰個開關。
  await expect(dialog.getByLabel("原因")).toBeFocused();
  await page.keyboard.type("鍵盤操作驗證原因");
  await page.keyboard.press("Tab");
  await page.keyboard.type("browser-test-password");
  // 確認掣喺 q-card-actions 入面，即係 <q-form> **外面**，所以表單入面冇 submit
  // 掣——喺多過一個輸入欄嘅表單度撳 Enter 唔會提交（見 DEF-018）。所以呢度行
  // 真正行得通嗰條鍵盤路徑：Tab 去確認掣再撳。
  const confirmButton = page.locator(".q-dialog").getByRole("button", { name: "確認儲存" });
  for (let press = 0; press < 10 && !(await confirmButton.evaluate((node) => node === document.activeElement)); press += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(confirmButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator(".q-toggle")).toHaveAttribute("aria-checked", "true");
  expect(state.calls.some((call) => call.path === "/api/v1/supplier-settings/update")).toBe(true);
});

test("@technical a version conflict shows the server's value, not the user's click", async ({ page }) => {
  // REV-028 H-2：起手一定要係 ON。由 OFF 開始嘅話，使用者㩒去 ON、服務器又係 ON，
  // 三個值一樣，個斷言分唔開「顯示服務器」同「顯示使用者㩒嗰個」——實測嗰個
  // mutant（reload 完再覆蓋返 target）喺舊 fixture 之下 6/6 全綠。
  const state = await installApi(page, { conflictOnce: true, approvalOn: true });
  await page.goto("/suppliers/settings");
  await expect(page.locator(".q-toggle")).toHaveAttribute("aria-checked", "true");

  // 使用者㩒去 OFF，服務器同時揸住 ON。
  await page.locator(".q-toggle").click();
  await confirmDialog(page, "與其他管理員同時修改", "browser-test-password");

  await expect(page.getByText("已重新載入目前值")).toBeVisible();
  await expect(page.locator(".q-toggle")).toHaveAttribute("aria-checked", "true");
  expect(state.calls.filter((call) => call.path === "/api/v1/supplier-settings/update")).toHaveLength(1);
  expect(state.calls.filter((call) => call.path === "/api/v1/supplier-settings")).toHaveLength(2);
});

test("@technical the dependency panel is read-only and names what is missing", async ({ page }) => {
  const problems = collectConsole(page);
  await installApi(page, {
    readiness: { ...READY, status: "NOT_READY", hkdReady: false, activeCurrencyCount: 0 }
  });
  await page.goto("/suppliers/settings");

  // chip 嗰個狀態字，唔係下面「HKD 基準貨幣尚未就緒」嗰句——兩句都含「未就緒」。
  await expect(page.locator(".q-chip")).toHaveText("未就緒");
  await expect(page.getByText("HKD 基準貨幣尚未就緒")).toBeVisible();
  await expect(page.getByRole("link", { name: /前往管理貨幣/u })).toHaveAttribute("href", "/system/business-master/currencies");
  await expect(page.getByRole("link", { name: /前往管理付款條款/u })).toHaveAttribute("href", "/system/business-master/payment-terms");

  // REV-028 M-1：本來只禁 input／textarea／select，所以一個冇 href 嘅 q-btn
  //（例如「新增貨幣」）行得過。vitest 嗰邊有呢個 loop，瀏覽器嗰邊冇——而 §9 話
  // 瀏覽器結果先算數。
  const card = page.locator(".q-card").nth(1);
  const controls = await card.locator("button, a").all();
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    await expect(control).toHaveAttribute("href", /^\/system\/business-master\//u);
  }
  await expect(card.locator("input, textarea, select")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("@technical a failed readiness read does not disable the toggle", async ({ page }) => {
  const state = await installApi(page, { readinessFails: true });
  await page.goto("/suppliers/settings");

  await expect(page.getByText("啟用供應商前需要另一名使用者審批")).toBeVisible();
  await page.locator(".q-toggle").click();
  await confirmDialog(page, "依賴狀態讀唔到都要改得到設定", "browser-test-password");
  await expect(page.locator(".q-toggle")).toHaveAttribute("aria-checked", "true");
  expect(state.calls.some((call) => call.path === "/api/v1/supplier-settings/update")).toBe(true);
});

test("@technical a failed settings read shows an error and recovers, instead of crashing", async ({ page }) => {
  // REV-028 H-1：settings 留喺 null 而 template 照 dereference，使用者會見到一句
  // raw TypeError。真瀏覽器先至睇得出——錯誤邊界接住之後成頁都冇埋。
  const state = await installApi(page, { settingsFails: true });
  await page.goto("/suppliers/settings");

  await expect(page.getByText("重新載入")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Cannot read propert");
  await expect(page.locator(".q-toggle")).toHaveCount(0);

  state.settingsFails = false;
  await page.getByRole("button", { name: "重新載入" }).click();
  await expect(page.locator(".q-toggle")).toHaveCount(1);
});

test("@technical a user without supplier.settings gets neither the menu entry nor the page", async ({ page }) => {
  // AC 第一條：直接 URL 同 API 分別由 guard 同 server 拒絕。C1／C2 守住 metadata，
  // 但之前冇任何瀏覽器 case 真係行過一個冇權限嘅使用者（REV-028 L-2）。
  const state = await installApi(page, {
    user: { ...SETTINGS_ADMIN, permissions: ["supplier.view", "business_master.view"] }
  });
  await page.goto("/suppliers/settings");

  await expect(page).not.toHaveURL(/\/suppliers\/settings$/u);
  await expect(page.locator(".q-toggle")).toHaveCount(0);
  expect(state.calls.some((call) => call.path.startsWith("/api/v1/supplier-settings"))).toBe(false);
  expect(state.calls.some((call) => call.path === "/api/v1/supplier-lookups/business-master")).toBe(false);
});
