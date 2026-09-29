import { expect, test } from "@playwright/test";

const SUMMARY = {
  sku: { skuId: 3, code: "SKU-3", name: "Widget" }, baseUom: { uomId: 5, uomCode: "EA" },
  totalOnHand: 30, availableOnHand: 20, eligibleOnHand: 8, reserved: 12, atp: 0,
  uncoveredReserved: 4, quarantined: 6, damaged: 4, inTransit: 0
};
const BUCKET = {
  balanceId: 12, warehouse: { warehouseId: 1, code: "WH-A", name: "Main" },
  bin: { binId: 2, code: "A-01", name: "Primary" }, sku: SUMMARY.sku,
  lot: { lotId: 4, number: "LOT-4", expiryDate: "2026-09-27", manufactureDate: "2026-01-01" },
  stockStatus: "AVAILABLE", isExpired: true, onHand: 10, allocated: 3, bucketFree: 7,
  baseUom: SUMMARY.baseUom, version: 6
};
const LOT = {
  lotId: 4, sku: SUMMARY.sku, lotNumber: "LOT-4", expiryDate: "2026-09-27",
  manufactureDate: "2026-01-01", firstReceiptDate: "2026-02-01", isExpired: true,
  remainingLifeDays: -1, totalOnHand: 10, availableOnHand: 7, quarantined: 2, damaged: 1,
  baseUom: SUMMARY.baseUom
};
const MOVEMENT = {
  movementId: 21, groupId: "group-1", movementType: "RECEIPT", locationKind: "BIN",
  warehouse: { warehouseId: 1, code: "WH-A" }, bin: { binId: 2, code: "A-01" },
  sku: SUMMARY.sku, lot: { lotId: 4, number: "LOT-4", expiryDate: "2026-09-27" },
  stockStatus: "AVAILABLE", direction: "IN", quantity: 8, balanceBefore: 2, balanceAfter: 10,
  balanceVersionAfter: 5, postedAt: 1_700_000_000_000, postedBy: { userId: 7, label: "Sam" },
  operationId: 31,
  source: { module: "RECEIVING", documentType: "GOODS_RECEIPT", documentId: "GR-42", lineId: "1", eventId: "posted-1" }
};

async function installApi(page, options = {}) {
  const state = { calls: [], unexpected: [], aggregateFailure: options.aggregateFailure ?? false, aggregateEmpty: false };
  const permissions = options.permissions ?? ["inventory.view"];
  await page.addInitScript((userPermissions) => {
    localStorage.setItem("erp.token", "inventory-inquiry-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
    window.__inventoryPermissions = userPermissions;
  }, permissions);
  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    state.calls.push({ path, query: Object.fromEntries(url.searchParams), method: request.method() });
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5205" };
    const ok = (data) => route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "pw-inquiries" } }) });
    const fail = (status, code, message) => route.fulfill({ status, headers, body: JSON.stringify({ success: false, error: { code, message }, meta: { requestId: "pw-inquiries" } }) });

    if (path === "/api/v1/user/me") return ok({ id: 1, username: "sam", displayName: "Sam", roles: [], permissions });
    if (path === "/api/v1/inventory/stocks/aggregates") {
      if (state.aggregateFailure) { state.aggregateFailure = false; return fail(503, "SERVICE_UNAVAILABLE", "Service unavailable"); }
      const items = state.aggregateEmpty ? [] : [SUMMARY];
      return ok({ items, total: items.length, page: Number(url.searchParams.get("page") || 1), pageSize: 20 });
    }
    if (path === "/api/v1/inventory/stocks/summary") return ok(SUMMARY);
    if (path === "/api/v1/inventory/stocks") return ok({ items: [BUCKET], total: 1, page: 1, pageSize: 20 });
    if (path === "/api/v1/inventory/lots") return ok({ items: [LOT], total: 1, page: 1, pageSize: 20 });
    if (path === "/api/v1/inventory/movements/21") return ok({
      movement: MOVEMENT, groupLegs: [MOVEMENT, { ...MOVEMENT, movementId: 22, direction: "OUT" }],
      reversal: { reversalOfMovementId: null, reversedByMovementId: 25 }
    });
    if (path === "/api/v1/inventory/movements/25") return ok({
      movement: { ...MOVEMENT, movementId: 25, movementType: "REVERSAL", direction: "OUT" },
      groupLegs: [{ ...MOVEMENT, movementId: 25, movementType: "REVERSAL", direction: "OUT" }],
      reversal: { reversalOfMovementId: 21, reversedByMovementId: null }
    });
    if (path === "/api/v1/inventory/movements") return ok({ items: [MOVEMENT], total: 1, page: 1, pageSize: 20 });
    state.unexpected.push(`${request.method()} ${path}`);
    return fail(404, "NOT_FOUND", `Unhandled fixture: ${request.method()} ${path}`);
  });
  return state;
}

function captureErrors(page) {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("TC-022 @technical Stock URL state, keyboard drill-down and distinct quantities", async ({ page }) => {
  const state = await installApi(page);
  const errors = captureErrors(page);
  await page.goto("/inventory/stocks?page=2&sortBy=totalOnHand&descending=true&q=SKU-3&warehouseId=1&availability=ZERO_ATP");
  await expect(page.getByRole("heading", { name: "庫存總覽" })).toBeVisible();
  await expect(page.getByText("未覆蓋 4")).toBeVisible();
  const aggregateCall = state.calls.find((call) => call.path.endsWith("/aggregates"));
  expect(aggregateCall.query).toMatchObject({ page: "2", sortBy: "totalOnHand", descending: "true", q: "SKU-3", warehouseId: "1", availability: "ZERO_ATP" });

  const drillDown = page.getByRole("button", { name: "查看 SKU-3 庫存明細" });
  await drillDown.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "SKU-3 Widget 的庫存 bucket" })).toBeVisible();
  await expect(page.getByText("已過期 2026-09-27")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "On Hand", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Allocated" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Bucket Free" })).toBeVisible();
  await expect(page).toHaveURL(/skuId=3/);
  expect(state.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test("TC-022 @technical loading failure retries, empty permissions fail closed", async ({ page }) => {
  const state = await installApi(page, { aggregateFailure: true });
  await page.goto("/inventory/stocks");
  await expect(page.getByText("服務暫時無法使用，請稍後再試")).toBeVisible();
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByText("SKU-3", { exact: true })).toBeVisible();
  state.aggregateEmpty = true;
  await page.getByLabel("搜尋 SKU Code、名稱或條碼").fill("不存在");
  await expect(page.getByText("冇資料", { exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]);

  const denied = await page.context().newPage();
  await installApi(denied, { permissions: [] });
  await denied.goto("/inventory/stocks");
  await expect(denied.getByRole("heading", { name: "冇權限" })).toBeVisible();
  await denied.close();
});

test("TC-022 @technical Lot expiry and Movement source/group/reversal are explicit", async ({ page }) => {
  const state = await installApi(page);
  const errors = captureErrors(page);
  await page.goto("/inventory/lots?expiryState=EXPIRED&warehouseId=1");
  await expect(page.getByText("已過期（-1 日）")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Available On Hand" })).toBeVisible();
  await page.goto("/inventory/movements?sourceModule=RECEIVING");
  await page.getByRole("button", { name: "查看 Movement 21" }).click();
  await expect(page.getByText("RECEIVING / GOODS_RECEIPT / GR-42 / 行 1 / 事件 posted-1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "同組 Movement legs" })).toBeVisible();
  const reversal = page.getByRole("button", { name: "沖銷 Movement 25" });
  await reversal.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Movement 25 詳情" })).toBeVisible();
  await expect(page.getByRole("button", { name: "原 Movement 21" })).toBeVisible();
  expect(state.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [375, 768, 1024, 1440]) {
  test(`TC-022 @technical ${width}px inquiry pages remain usable without body overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installApi(page);
    for (const [path, heading] of [["/inventory/stocks", "庫存總覽"], ["/inventory/lots", "批次與效期"], ["/inventory/movements", "庫存異動"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });
}
