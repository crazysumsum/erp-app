import { expect, test } from "@playwright/test";

/**
 * TASK-039：供應商詳情嘅「供貨關係」tab。API 喺 network 層 mock（有狀態），驗真瀏覽器入面嘅
 * Quasar 選擇器、DataTable 伺服器分頁同對話框流程；後端規則由 server 整合測試負責。
 */

const MANAGER = { id: 1, username: "sku-manager", displayName: "SKU Manager", roles: ["supplier-manager"],
  permissions: ["supplier.view", "supplier.mgmt"] };
const VIEWER = { ...MANAGER, id: 2, username: "sku-viewer", permissions: ["supplier.view"] };

const SKUS = [
  { skuId: 51, skuCode: "TEA-001", skuName: "Jasmine Tea 250g", itemName: "Jasmine Tea", uoms: [
    { skuUomId: 501, uomCode: "EA", uomName: "Each", status: "active", toBaseFactor: 1, isBase: true, isDefaultPurchase: false },
    { skuUomId: 502, uomCode: "CTN", uomName: "Carton", status: "active", toBaseFactor: 24, isBase: false, isDefaultPurchase: true },
    { skuUomId: 503, uomCode: "PLT", uomName: "Pallet", status: "inactive", toBaseFactor: 960, isBase: false, isDefaultPurchase: false }
  ] },
  { skuId: 52, skuCode: "TEA-002", skuName: "Oolong Tea 250g", itemName: "Oolong Tea", uoms: [
    { skuUomId: 511, uomCode: "BTL", uomName: "Bottle", status: "active", toBaseFactor: 1, isBase: true, isDefaultPurchase: true }
  ] }
];

function supplier(status = "active") {
  return { id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen", defaultCurrencyCode: "HKD",
    defaultPaymentTermId: null, status, version: 1, website: "", generalPhone: "", generalEmail: "", notes: "", createdAt: 100, updatedAt: 200,
    addresses: [], contacts: [], identifiers: [], bankAccounts: [], warnings: [] };
}

function relation(overrides = {}) {
  return { id: 91, supplierId: 7, skuId: 52, skuCode: "TEA-002", skuName: "Oolong Tea 250g", skuStatus: "active", itemStatus: "active",
    supplierItemCode: "OO-9", supplierItemName: "Oolong (old pack)", purchaseSkuUomId: 511, purchaseUomCode: "BTL", purchaseUomName: "Bottle",
    purchaseUomStatus: "active", minimumOrderQty: 12, standardLeadTimeDays: 7, relationshipStatus: "alternative", firstSuppliedAt: null,
    lastSuppliedAt: null, source: "manual", version: 3, updatedAt: 300, ...overrides };
}

async function installApi(page, { user = MANAGER, status = "active", relations = [], conflictOnUpdate = false, delaySkuId = null } = {}) {
  const state = { calls: [], relations: [...relations] };
  await page.addInitScript(() => {
    localStorage.setItem("erp.token", "browser-test-token");
    localStorage.setItem("erp.token.deadline", String(Date.now() + 3_600_000));
    localStorage.setItem("erp.session.deadline", String(Date.now() + 7_200_000));
  });
  await page.route("http://localhost:3000/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.postDataJSON?.() ?? null;
    state.calls.push({ method: request.method(), path, body, query: Object.fromEntries(url.searchParams) });
    const headers = { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5203" };
    const ok = (data, code = 200) => route.fulfill({ status: code, headers, body: JSON.stringify({ success: true, data, meta: { requestId: "pw" } }) });
    const fail = (code, errorCode, message) => route.fulfill({ status: code, headers,
      body: JSON.stringify({ success: false, error: { code: errorCode, message }, meta: { requestId: "pw" } }) });

    if (path === "/api/v1/user/me") return ok(user);
    if (path === "/api/v1/suppliers/7") return ok(supplier(status));
    if (path === "/api/v1/suppliers/7/completeness") return ok({ supplierId: 7, issues: [], warnings: [] });
    if (path.startsWith("/api/v1/business-master/")) return ok({ items: [], total: 0 });
    if (path === "/api/v1/supplier-lookups/skus") {
      const skuId = url.searchParams.get("skuId");
      if (skuId) {
        if (Number(skuId) === delaySkuId) await new Promise((resolve) => { setTimeout(resolve, 1_500); });
        const items = SKUS.filter((sku) => sku.skuId === Number(skuId));
        return ok({ items, total: items.length, page: 1, pageSize: 20 });
      }
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const items = SKUS.filter((sku) => sku.skuCode.toLowerCase().startsWith(q) || sku.skuName.toLowerCase().startsWith(q));
      return ok({ items, total: items.length, page: 1, pageSize: 20 });
    }
    if (path === "/api/v1/suppliers/7/sku-relations") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const items = state.relations.filter((row) => !q || row.skuCode.toLowerCase().startsWith(q) || row.supplierItemCode.toLowerCase().startsWith(q));
      return ok({ items, total: items.length, page: 1, pageSize: 20 });
    }
    if (path === "/api/v1/suppliers/7/sku-relations/create") {
      const sku = SKUS.find((candidate) => candidate.skuId === body.skuId);
      const uom = sku.uoms.find((candidate) => candidate.skuUomId === body.purchaseSkuUomId);
      const created = relation({ id: 92, skuId: sku.skuId, skuCode: sku.skuCode, skuName: sku.skuName, ...body, version: 1,
        purchaseUomCode: uom?.uomCode ?? null, purchaseUomName: uom?.uomName ?? null, purchaseUomStatus: uom?.status ?? null });
      state.relations.push(created);
      return ok(created, 201);
    }
    const update = path.match(/^\/api\/v1\/suppliers\/7\/sku-relations\/(\d+)\/update$/u);
    if (update) {
      const index = state.relations.findIndex((row) => row.id === Number(update[1]));
      if (body.version !== state.relations[index].version) return fail(409, "VERSION_CONFLICT", "供貨關係已被其他人修改，請重新載入");
      if (conflictOnUpdate) {
        // 第一次儲存之前，有人改咗 MOQ：版本加一，回衝突。
        conflictOnUpdate = false;
        state.relations[index] = { ...state.relations[index], minimumOrderQty: 99, version: state.relations[index].version + 1 };
        return fail(409, "VERSION_CONFLICT", "供貨關係已被其他人修改，請重新載入");
      }
      state.relations[index] = { ...state.relations[index], ...body, version: body.version + 1 };
      return ok(state.relations[index]);
    }
    return fail(404, "NOT_FOUND", `unrouted ${path}`);
  });
  return state;
}

function collectConsole(page) {
  const problems = [];
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) problems.push(message.text()); });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function openTab(page) {
  await page.goto("/suppliers/7");
  await page.getByRole("tab", { name: "供貨關係" }).click();
  await expect(page.getByRole("heading", { name: "供貨關係" })).toBeVisible();
}

test("@technical TASK-039: an empty tab explains the relation is advisory, and a manager adds one with a purchasable SKU and an active UOM", async ({ page }) => {
  const problems = collectConsole(page);
  const state = await installApi(page);
  await openTab(page);
  await expect(page.getByText("尚未設定供貨關係")).toBeVisible();
  await expect(page.getByText("其他有效供應商仍然可以選擇")).toBeVisible();
  await expect(page.getByText(/唯一|只可向/u)).toHaveCount(0);

  await page.getByRole("button", { name: "新增供貨關係" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("採購單位")).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "儲存" })).toBeDisabled();
  await dialog.getByLabel("SKU *").fill("tea-001");
  await page.getByRole("option", { name: /TEA-001 — Jasmine Tea 250g/u }).click();
  await expect(dialog.getByLabel("SKU *")).toHaveValue("TEA-001 — Jasmine Tea 250g");

  await dialog.getByLabel("採購單位").click();
  await expect(page.getByRole("option", { name: /CTN — Carton × 24/u })).toBeVisible();
  await expect(page.getByRole("option", { name: /PLT/u }), "an inactive UOM is not offered").toHaveCount(0);
  await page.getByRole("option", { name: /CTN — Carton × 24/u }).click();
  await dialog.getByLabel("關係 *").click();
  await page.getByRole("option", { name: "首選" }).click();
  await dialog.getByLabel("供應商商品代碼").fill(" JT-250 ");
  await dialog.getByLabel("最低訂購量").fill("0");
  await expect(dialog.getByText("請輸入 1 或以上的整數，或留空")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "儲存" })).toBeDisabled();
  await dialog.getByLabel("最低訂購量").fill("2");
  await dialog.getByLabel("一般交貨期（日）").fill("14");
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toBeHidden();

  const create = state.calls.find((call) => call.path.endsWith("/sku-relations/create"));
  expect(create.body).toEqual({ skuId: 51, supplierItemCode: "JT-250", supplierItemName: "", purchaseSkuUomId: 502, minimumOrderQty: 2,
    standardLeadTimeDays: 14, relationshipStatus: "preferred" });
  const row = page.getByRole("row", { name: /TEA-001/u });
  await expect(row).toContainText("CTN — Carton");
  await expect(row).toContainText("首選");
  await expect(row).toContainText("JT-250");
  expect(problems).toEqual([]);
});

test("@technical TASK-039: an inactive SKU and UOM stay visible as history, and editing keeps the old UOM and sends the version", async ({ page }) => {
  const problems = collectConsole(page);
  const state = await installApi(page, { relations: [relation({ skuStatus: "inactive", purchaseSkuUomId: 503, skuId: 51, skuCode: "TEA-001",
    purchaseUomCode: "PLT", purchaseUomName: "Pallet", purchaseUomStatus: "inactive", relationshipStatus: "stopped" })] });
  await openTab(page);
  const row = page.getByRole("row", { name: /TEA-001/u });
  await expect(row).toContainText("SKU 已停用（歷史）");
  await expect(row).toContainText("單位已停用");
  await expect(row).toContainText("已停止");

  await page.getByRole("button", { name: "編輯供貨關係 TEA-001" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("採購單位")).toHaveValue("PLT — Pallet（已停用） × 960");
  await dialog.getByLabel("最低訂購量").fill("48");
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toBeHidden();
  const update = state.calls.find((call) => call.path.endsWith("/91/update"));
  expect(update.body).toMatchObject({ purchaseSkuUomId: 503, minimumOrderQty: 48, relationshipStatus: "stopped", version: 3 });
  await expect(row).toContainText("48");
  expect(problems).toEqual([]);
});

test("@technical TASK-039 (REV-088 M-2): a version conflict keeps the draft, re-reads the list, and the next edit saves", async ({ page }) => {
  const state = await installApi(page, { relations: [relation()], conflictOnUpdate: true });
  await openTab(page);
  await page.getByRole("button", { name: "編輯供貨關係 TEA-002" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("最低訂購量").fill("30");
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog.getByRole("alert")).toContainText("已被其他人修改");
  await expect(dialog.getByLabel("最低訂購量"), "the draft stays").toHaveValue("30");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("row", { name: /TEA-002/u }), "the list was re-read").toContainText("99");

  await page.getByRole("button", { name: "編輯供貨關係 TEA-002" }).click();
  await expect(dialog.getByLabel("最低訂購量")).toHaveValue("99");
  await dialog.getByLabel("最低訂購量").fill("30");
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toBeHidden();
  expect(state.calls.filter((call) => call.path.endsWith("/91/update")).map((call) => call.body.version)).toEqual([3, 4]);
});

test("@technical TASK-039 (REV-088 M-1): a slow unit lookup from an earlier edit does not overwrite the dialog that is open now", async ({ page }) => {
  await installApi(page, { relations: [relation({ id: 93, skuId: 51, skuCode: "TEA-001", purchaseSkuUomId: 501, purchaseUomCode: "EA" }), relation()],
    delaySkuId: 51 });
  await openTab(page);
  const slow = page.waitForRequest((request) => request.url().includes("skuId=51"));
  await page.getByRole("button", { name: "編輯供貨關係 TEA-001" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "編輯供貨關係 TEA-002" }).click();
  await expect(dialog.getByLabel("採購單位")).toHaveValue("BTL — Bottle，基本單位");
  // 等嗰個慢請求完結（被取消就冇 response）：完成或者失敗都算，之後先睇選項有冇被蓋。
  const request = await slow;
  const response = await Promise.race([request.response(), page.waitForEvent("requestfailed", (failed) => failed === request).then(() => null)]);
  await response?.finished();
  // 回應到咗瀏覽器之後，app 仲要 parse JSON 同等 Vue 更新先會（錯誤咁）覆蓋選項：喺頁面入面等一個 timer，
  // 令嗰條 promise chain 行完先檢查。冇呢一步，斷言會喺覆蓋之前就通過（negative control 試過）。
  await page.evaluate(() => new Promise((resolve) => { setTimeout(resolve, 200); }));
  // 用正面斷言：B 嘅單位（BTL，A 冇）一定要仲喺選單。唔好用「選單冇某個選項」或者顯示值：Quasar 逐個 render 選項，
  // 否定式斷言會喺第二個選項出現之前通過；揀咗嘅值會保留舊標籤，清單被換走都睇唔出（兩個 negative control 都試過）。
  await dialog.getByLabel("採購單位").click();
  await expect(page.getByRole("option", { name: "BTL — Bottle，基本單位" })).toBeVisible();
  await expect(dialog.getByText("SKU 目前不可採購")).toHaveCount(0);
});

test("@technical TASK-039 (REV-088 M-3): the SKU picker never sends control characters or more than 190 characters", async ({ page }) => {
  const problems = collectConsole(page);
  const state = await installApi(page);
  await openTab(page);
  await page.getByRole("button", { name: "新增供貨關係" }).click();
  const dialog = page.getByRole("dialog");
  const searches = () => state.calls.filter((call) => call.path === "/api/v1/supplier-lookups/skus").map((call) => call.query.q ?? "");
  // 每次輸入之後等請求真係出咗去先打下一次，唔係 debounce 會將兩次併做一次。
  await dialog.getByLabel("SKU *").fill("TEA\t001");
  await expect.poll(() => searches().length).toBe(1);
  await dialog.getByLabel("SKU *").fill("a".repeat(200));
  await expect.poll(() => searches().length).toBe(2);
  const sent = searches();
  expect(sent[0], "a pasted tab becomes a space").toBe("TEA 001");
  expect(sent.every((q) => q.length <= 190 && !/\p{Cc}/u.test(q)), JSON.stringify(sent)).toBe(true);
  await expect(dialog.getByText(/Request validation failed/u)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("@technical TASK-039 (REV-088 M-4 A): reactivating a stopped relation asks for an active purchase UOM", async ({ page }) => {
  const state = await installApi(page, { relations: [relation({ skuId: 51, skuCode: "TEA-001", relationshipStatus: "stopped", purchaseSkuUomId: 503,
    purchaseUomCode: "PLT", purchaseUomName: "Pallet", purchaseUomStatus: "inactive" })] });
  await openTab(page);
  await page.getByRole("button", { name: "編輯供貨關係 TEA-001" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("採購單位")).toHaveValue("PLT — Pallet（已停用） × 960");
  await dialog.getByLabel("關係 *").click();
  await page.getByRole("option", { name: "首選" }).click();
  await expect(dialog.getByText("重新啟用關係需要有效的採購單位：請改選其他單位，或清除單位")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "儲存" })).toBeDisabled();
  await dialog.getByLabel("採購單位").click();
  await page.getByRole("option", { name: /CTN — Carton × 24/u }).click();
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect(dialog).toBeHidden();
  expect(state.calls.find((call) => call.path.endsWith("/91/update")).body).toMatchObject({ relationshipStatus: "preferred", purchaseSkuUomId: 502 });
});

test("@technical TASK-039: search goes to the server; viewers and archived Suppliers get no write actions", async ({ page, browser }) => {
  const state = await installApi(page, { relations: [relation(), relation({ id: 93, skuId: 51, skuCode: "TEA-001", supplierItemCode: "JT-1" })] });
  await openTab(page);
  await page.getByLabel("搜尋 SKU 代碼或供應商商品代碼／名稱").fill("TEA-001");
  await expect(page.getByRole("row", { name: /TEA-002/u })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /TEA-001/u })).toBeVisible();
  expect(state.calls.some((call) => call.path.endsWith("/sku-relations") && call.query.q === "TEA-001")).toBe(true);

  for (const [options, note] of [[{ user: VIEWER }, false], [{ status: "archived" }, true]]) {
    const other = await browser.newPage();
    await installApi(other, { ...options, relations: [relation()] });
    await openTab(other);
    await expect(other.getByRole("row", { name: /TEA-002/u })).toBeVisible();
    await expect(other.getByRole("button", { name: "新增供貨關係" })).toHaveCount(0);
    await expect(other.getByRole("button", { name: /編輯供貨關係/u })).toHaveCount(0);
    await expect(other.getByText("已封存的供應商不可新增或修改供貨關係。")).toHaveCount(note ? 1 : 0);
    await other.close();
  }
});

test("@technical TASK-039: editing a relation whose SKU is no longer purchasable keeps its UOM without inventing a conversion", async ({ page }) => {
  const problems = collectConsole(page);
  await installApi(page, { relations: [relation({ skuId: 99, skuCode: "TEA-099", skuStatus: "discontinued", purchaseSkuUomId: 990,
    purchaseUomCode: "BOX", purchaseUomName: "Box", purchaseUomStatus: "active" })] });
  await openTab(page);
  await expect(page.getByRole("row", { name: /TEA-099/u })).toContainText("SKU 已停產（歷史）");
  await page.getByRole("button", { name: "編輯供貨關係 TEA-099" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("SKU 目前不可採購，只可保留或清除現有單位")).toBeVisible();
  await expect(dialog.getByLabel("採購單位")).toHaveValue("BOX — Box");
  expect(problems).toEqual([]);
});
