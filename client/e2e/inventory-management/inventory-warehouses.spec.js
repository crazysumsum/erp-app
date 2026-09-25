import { expect, test } from "@playwright/test";

const WAREHOUSE = { id: 1, code: "MAIN", name: "主倉", address: "香港", description: "", status: "ACTIVE", version: 2, createdAt: 1, updatedAt: 1 };
const BIN = { id: 3, warehouseId: 1, code: "A-01", name: "A 區 01", description: "", status: "ACTIVE", version: 4, createdAt: 1, updatedAt: 1, locked: true };
const WAREHOUSE_BLOCKERS = { currentOnHand: 12, activeReservations: 2, activeAllocations: 1, openTransfers: 0, activeStocktakes: 0, activeBinLocks: 1 };

async function installApi(page, options = {}) {
  const state = { calls: [], conflictOnce: options.conflictOnce ?? false, empty: options.empty ?? false };
  const permissions = options.permissions ?? ["inventory.view", "inventory.mgmt"];
  await page.addInitScript((userPermissions) => {
    localStorage.setItem("erp.token", "inventory-browser-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    window.__inventoryPermissions = userPermissions;
  }, permissions);
  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = request.postDataJSON?.() ?? null;
    state.calls.push({ path, method, body, headers: request.headers() });
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5205" };
    const ok = (data, status = 200) => route.fulfill({ status, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "pw-inventory" } }) });
    const fail = (status, code, message) => route.fulfill({ status, headers, body: JSON.stringify({ success: false, error: { code, message }, meta: { requestId: "pw-inventory" } }) });

    if (path === "/api/v1/user/me") return ok({ id: 1, username: "sam", displayName: "Sam", roles: [], permissions });
    if (method === "GET" && path === "/api/v1/inventory/warehouses") {
      if (options.listFailure && !state.failed) { state.failed = true; return fail(503, "SERVICE_UNAVAILABLE", "Service unavailable"); }
      const items = state.empty ? [] : [WAREHOUSE];
      return ok({ items, total: items.length, page: 1, pageSize: 20 });
    }
    if (method === "GET" && path === "/api/v1/inventory/warehouses/1") return ok({ ...WAREHOUSE, binSummary: { total: 1, active: 1, inactive: 0 }, blockers: WAREHOUSE_BLOCKERS });
    if (method === "GET" && path === "/api/v1/inventory/warehouses/1/bins") return ok({ items: [BIN], total: 1, page: 1, pageSize: 20 });
    if (method === "GET" && path === "/api/v1/inventory/warehouses/1/bins/3") return ok({ ...BIN, blockers: { currentOnHand: 12, activeAllocations: 1, openTransfers: 0, activeStocktakeLocks: 1 }, currentLock: { type: "STOCKTAKE", stocktakeId: 7, stocktakeNumber: "ST-7", lockedAt: 1 } });
    if (method === "POST" && path === "/api/v1/inventory/warehouses/1/update") {
      if (state.conflictOnce) { state.conflictOnce = false; return fail(409, "VERSION_CONFLICT", "資料版本衝突"); }
      return ok({ ...WAREHOUSE, code: body.warehouseCode, name: body.warehouseName, version: 3 });
    }
    if (method === "POST" && path === "/api/v1/inventory/warehouses/1/deactivate") return ok({ ...WAREHOUSE, status: "INACTIVE", version: 3 });
    return fail(404, "NOT_FOUND", `Unhandled fixture: ${method} ${path}`);
  });
  return state;
}

function captureErrors(page) {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("TC-021 @technical 桌面 master-detail 可查閱 blocker 並執行受保護停用", async ({ page }) => {
  const state = await installApi(page);
  const errors = captureErrors(page);
  await page.goto("/inventory/warehouses");
  await expect(page.getByRole("heading", { name: "倉庫與庫位" })).toBeVisible();
  await page.getByRole("button", { name: "查看倉庫 MAIN 的庫位" }).click();
  await expect(page.getByText("A-01", { exact: true })).toBeVisible();
  await expect(page.getByText(/現有庫存：12/)).toBeVisible();
  await page.getByRole("button", { name: "查看庫位 A-01 詳情" }).click();
  await expect(page.getByText("盤點 ST-7 鎖定中")).toBeVisible();
  await page.getByRole("button", { name: "停用倉庫 MAIN" }).click();
  await expect(page.getByText(/提交時系統會再次檢查/)).toBeVisible();
  await page.getByLabel("原因").fill("倉庫已停止使用");
  await page.getByLabel("你的密碼").fill("secret");
  await page.getByRole("button", { name: "停用", exact: true }).click();
  const command = state.calls.find((call) => call.path.endsWith("/deactivate"));
  expect(command.body).toEqual({ password: "secret", reason: "倉庫已停止使用", version: 2 });
  expect(command.headers["idempotency-key"]).toBeTruthy();
  expect(errors).toEqual([]);
});

test("TC-021 @technical 409 保留表單輸入供重新核對", async ({ page }) => {
  await installApi(page, { conflictOnce: true });
  await page.goto("/inventory/warehouses");
  await page.getByRole("button", { name: "編輯倉庫 MAIN" }).click();
  await page.getByLabel("倉庫名稱").fill("新主倉名稱");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByText(/輸入內容仍保留/)).toBeVisible();
  await expect(page.getByLabel("倉庫名稱")).toHaveValue("新主倉名稱");
});

test("TC-021 @technical view-only 與錯誤/空狀態明確", async ({ page }) => {
  const state = await installApi(page, { permissions: ["inventory.view"], listFailure: true });
  await page.goto("/inventory/warehouses");
  await expect(page.getByText("服務暫時無法使用，請稍後再試")).toBeVisible();
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByText("MAIN", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增倉庫" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "編輯倉庫 MAIN" })).toHaveCount(0);
  state.empty = true;
  await page.getByLabel("搜尋倉庫").fill("不存在");
  await expect(page.getByText("冇資料", { exact: true })).toBeVisible();
});

test("TC-021 @technical 375px 以鍵盤順序選倉後進入庫位並可返回", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await installApi(page);
  await page.goto("/inventory/warehouses");
  const select = page.getByRole("button", { name: "查看倉庫 MAIN 的庫位" });
  await select.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /MAIN — 主倉 的庫位/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "倉庫", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "返回倉庫" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "倉庫", exact: true })).toBeVisible();
});
