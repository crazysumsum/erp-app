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


test("@technical REV-029 probe: retry that fails again, and a double retry", async ({ page }) => {
  const problems = collectConsole(page);
  const state = await installApi(page, { settingsFails: true });
  await page.goto("/suppliers/settings");
  await expect(page.getByRole("button", { name: "重新載入" })).toBeVisible();

  await page.getByRole("button", { name: "重新載入" }).click();   // still failing
  await page.waitForTimeout(600);
  console.log("P2_BANNER_AFTER_FAILED_RETRY:", await page.getByRole("button", { name: "重新載入" }).count());
  console.log("P2_TOGGLE:", await page.locator(".q-toggle").count());

  const btn = page.getByRole("button", { name: "重新載入" });
  await Promise.all([btn.click(), btn.click()]);                  // double click, still failing
  await page.waitForTimeout(600);
  console.log("P2_AFTER_DOUBLE:", await page.getByRole("button", { name: "重新載入" }).count());

  state.settingsFails = false;
  await Promise.all([btn.click(), btn.click()]);                  // double click, now succeeding
  await page.waitForTimeout(800);
  console.log("P2_TOGGLE_AFTER_RECOVER:", await page.locator(".q-toggle").count());
  console.log("P2_GETS:", state.calls.filter((c) => c.path === "/api/v1/supplier-settings").length);
  console.log("P2_BODY_OK:", !(await page.locator("body").innerText()).includes("呢一頁出咗問題"));
  console.log("P2_CONSOLE:", JSON.stringify(problems.filter((p) => !p.includes("500"))).slice(0, 400));
});
