import { expect, test } from "@playwright/test";

const RESERVATION = {
  id: 17, warehouse: { warehouseId: 2, code: "WH-A" },
  sku: { skuId: 12, code: "SKU-12", name: "Widget" },
  source: { module: "SALES", documentType: "SALES_ORDER", documentId: "SO-42", lineId: "1", eventId: "reserved-1" },
  purpose: "SALE", minimumRemainingDays: 30,
  originalQuantity: 10, consumedQuantity: 1, releasedQuantity: 2, outstandingQuantity: 7,
  status: "PARTIALLY_CONSUMED", version: 3, createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  availability: { eligibleOnHand: 5, reserved: 7, rawAtp: -2, atp: 0, uncoveredReserved: 2 }
};
const CANDIDATES = {
  reservationId: 17, requestedQuantity: 3, asOf: "2026-09-29", reservationVersion: 3,
  unallocatedQuantity: 7, page: 1, hasMore: false,
  items: [
    { balanceId: 41, binId: 31, lotId: 51, expiryDate: "2026-10-31", firstReceiptDate: "2026-09-01",
      fifoAnchorDate: null, freeQuantity: 2, balanceVersion: 4, selectionStrategy: "FEFO", rank: 1 },
    { balanceId: 42, binId: 32, lotId: 52, expiryDate: "2026-11-30", firstReceiptDate: "2026-09-02",
      fifoAnchorDate: null, freeQuantity: 4, balanceVersion: 5, selectionStrategy: "FEFO", rank: 2 }
  ]
};

async function installApi(page, { permissions = ["inventory.view", "inventory.operation", "inventory.fefo.override"], candidateMode = "normal" } = {}) {
  const state = { calls: [], unexpected: [], errors: [], conflictOnce: true, candidateReads: 0 };
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") state.errors.push(message.text()); });
  page.on("requestfailed", (request) => state.errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
  await page.addInitScript((claims) => {
    localStorage.setItem("erp.token", "inventory-reservations-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    window.__inventoryPermissions = claims;
  }, permissions);
  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    state.calls.push({ path, method: request.method(), body: request.postDataJSON?.() });
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5205" };
    const ok = (data) => route.fulfill({ status: 200, headers,
      body: JSON.stringify({ success: true, data, meta: { requestId: "pw-reservations" } }) });
    const fail = (status, code, message) => route.fulfill({ status, headers,
      body: JSON.stringify({ success: false, error: { code, message }, meta: { requestId: "pw-reservations" } }) });
    if (path === "/api/v1/user/me") return ok({ id: 7, username: "sam", roles: [], permissions });
    if (path === "/api/v1/inventory/reservations" && request.method() === "GET") {
      return ok({ items: [RESERVATION], total: 1, page: 1, pageSize: 20 });
    }
    if (path === "/api/v1/inventory/reservations/17" && request.method() === "GET") {
      return ok({ ...RESERVATION, allocations: [] });
    }
    if (path === "/api/v1/inventory/reservations/17/allocation-candidates") {
      state.candidateReads += 1;
      if (candidateMode === "error") return fail(503, "INVENTORY_DEPENDENCY_UNAVAILABLE", "候選服務暫時無法使用");
      if (candidateMode === "empty") return ok({ ...CANDIDATES, items: [], hasMore: false });
      if (candidateMode === "paged") {
        const pageNumber = Number(url.searchParams.get("page"));
        return ok({ ...CANDIDATES, page: pageNumber, hasMore: pageNumber === 1,
          items: pageNumber === 1 ? CANDIDATES.items.slice(0, 1) : CANDIDATES.items.slice(1) });
      }
      return ok({ ...CANDIDATES, requestedQuantity: Number(url.searchParams.get("requestedQuantity")) });
    }
    if (path === "/api/v1/inventory/reservations/17/allocations/create" && request.method() === "POST") {
      if (state.conflictOnce) {
        state.conflictOnce = false;
        return fail(409, "VERSION_CONFLICT", "資料已變更");
      }
      return ok({ reservationId: 17, operationId: 91, version: 4, quantity: 3, allocations: [] });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return fail(404, "NOT_FOUND", "Unhandled fixture");
  });
  return state;
}

test("TASK-024 @technical Reservation detail shows quantities, uncovered next step and copyable source", async ({ page }) => {
  const state = await installApi(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/inventory/reservations");
  await expect(page.getByRole("heading", { name: "預留與分配" })).toBeVisible();
  const detail = page.getByRole("button", { name: "查看預留 17 詳情" });
  await detail.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "預留 17 詳情" })).toBeVisible();
  await expect(page.getByText("原始 10")).toBeVisible();
  await expect(page.getByText("已耗用 1")).toBeVisible();
  await expect(page.getByText("已釋放 2")).toBeVisible();
  await expect(page.getByText("未完成 7")).toBeVisible();
  await expect(page.getByText(/未覆蓋 2.*請檢查可用庫存/)).toBeVisible();
  await expect(page.getByText("SALES / SALES_ORDER / SO-42 / 行 1 / 事件 reserved-1")).toBeVisible();
  await page.getByRole("button", { name: "複製來源識別" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SALES / SALES_ORDER / SO-42 / 行 1 / 事件 reserved-1");
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("TASK-024 @technical Allocation conflict retains input and reloads server candidates", async ({ page }) => {
  const state = await installApi(page);
  await page.goto("/inventory/reservations");
  await page.getByRole("button", { name: "查看預留 17 詳情" }).click();
  await page.getByRole("button", { name: "分配庫存" }).click();
  await page.getByLabel("分配數量").fill("3");
  await page.getByRole("button", { name: "載入候選" }).click();
  await expect(page.getByText("庫位 #31")).toBeVisible();
  await expect(page.getByText("2026-10-31")).toBeVisible();
  await page.getByLabel("庫位 31 分配數量").fill("2");
  await page.getByLabel("庫位 32 分配數量").fill("1");
  await page.getByRole("button", { name: "建立分配" }).click();
  await expect(page.getByText(/候選已重新載入.*請核對/)).toBeVisible();
  await expect(page.getByLabel("庫位 31 分配數量")).toHaveValue("2");
  await expect(page.getByLabel("庫位 32 分配數量")).toHaveValue("1");
  expect(state.candidateReads).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "建立分配" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const command = state.calls.find((call) => call.path.endsWith("/allocations/create"));
  expect(command.body.allocations.map(({ quantity }) => quantity)).toEqual([2, 1]);
  expect(command.body.source.module).toBe("INVENTORY");
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual(["Failed to load resource: the server responded with a status of 409 (Conflict)"]);
});

test("TASK-024 @technical no FEFO override permission blocks sequence deviation on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  const state = await installApi(page, { permissions: ["inventory.view", "inventory.operation"] });
  await page.goto("/inventory/reservations");
  await page.getByRole("button", { name: "查看預留 17 詳情" }).click();
  await page.getByRole("button", { name: "分配庫存" }).click();
  await page.getByLabel("分配數量").fill("1");
  await page.getByRole("button", { name: "載入候選" }).click();
  await page.getByLabel("庫位 32 分配數量").fill("1");
  await expect(page.getByText(/需要 FEFO 偏離權限/)).toBeVisible();
  await expect(page.getByRole("button", { name: "建立分配" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

test("TASK-024 @technical invalid quantity and empty candidates do not permit allocation", async ({ page }) => {
  const state = await installApi(page, { candidateMode: "empty" });
  await page.goto("/inventory/reservations?id=17");
  await expect(page.getByRole("heading", { name: "預留 17 詳情" })).toBeVisible();
  await page.getByRole("button", { name: "分配庫存" }).click();
  await page.getByLabel("分配數量").fill("0");
  await expect(page.getByRole("button", { name: "載入候選" })).toBeDisabled();
  await page.getByLabel("分配數量").fill("1");
  await page.getByRole("button", { name: "載入候選" }).click();
  await expect(page.getByText("沒有符合條件的可用庫存。")).toBeVisible();
  await expect(page.getByRole("button", { name: "建立分配" })).toBeDisabled();
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("TASK-024 @technical candidate service error is visible and does not submit", async ({ page }) => {
  const state = await installApi(page, { candidateMode: "error" });
  await page.goto("/inventory/reservations");
  await page.getByRole("button", { name: "查看預留 17 詳情" }).click();
  await page.getByRole("button", { name: "分配庫存" }).click();
  await page.getByRole("button", { name: "載入候選" }).click();
  await expect(page.getByRole("alert")).toContainText("庫存服務所需資料暫時無法使用");
  await expect(page.getByRole("button", { name: "建立分配" })).toBeDisabled();
  expect(state.calls.some((call) => call.path.endsWith("/allocations/create"))).toBe(false);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual(["Failed to load resource: the server responded with a status of 503 (Service Unavailable)"]);
});

test("TASK-024 @technical can load a later candidate page", async ({ page }) => {
  const state = await installApi(page, { candidateMode: "paged" });
  await page.goto("/inventory/reservations");
  await page.getByRole("button", { name: "查看預留 17 詳情" }).click();
  await page.getByRole("button", { name: "分配庫存" }).click();
  await page.getByLabel("分配數量").fill("3");
  await page.getByRole("button", { name: "載入候選" }).click();
  await expect(page.getByLabel("庫位 32 分配數量")).toHaveCount(0);
  await page.getByRole("button", { name: "載入更多候選" }).click();
  await expect(page.getByLabel("庫位 32 分配數量")).toBeVisible();
  expect(state.candidateReads).toBe(2);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});
