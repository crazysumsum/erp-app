import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { QInput, QSelect, Quasar } from "quasar";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { h, nextTick } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { useSessionStore } from "@/stores/session.js";
vi.mock("@/framework/http/HttpClient.js", () => ({ httpClient: { get: vi.fn(), post: vi.fn(), getBlob: vi.fn() } }));
import { httpClient } from "@/framework/http/HttpClient.js";
import inventory from "@/services/inventory.js";
const helpers = () => import("@/components/inventory/stocktakeIntent.js");
const result = { id: 7, operationId: 22, status: "COUNTING", version: 2, rowCount: 1 };
const body = { lines: [{ lineId: 3, expectedVersion: 7, countedQuantity: 0 }] };
const actor = 17, key = `inventory-stocktake-recovery:v1:${actor}`;
let active;
beforeEach(() => {
  const tokens = new Map();
  vi.stubGlobal("localStorage", { getItem: key => tokens.get(key) ?? null, setItem: (key, value) => tokens.set(key, value), removeItem: key => tokens.delete(key) });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function owner() {
  const { createStocktakeIntent } = await helpers();
  return createStocktakeIntent({ actorId: actor, storage: sessionStorage, active: () => active,
    lookup: source => inventory.findOperationBySource(source) });
}
describe("TASK040 Stocktake client foundation", () => {
  beforeEach(() => { active = true; vi.resetAllMocks(); sessionStorage.clear(); });
  it("ST040-C19 freezes a single original body/source/key, records only minimal identity and refuses superseding", async () => {
    const intent = await owner(); intent.prepare("count", 7, body); body.lines[0].countedQuantity = 0;
    expect(() => intent.prepare("ready", 7, {})).toThrow();
    const send = vi.fn(async payload => { expect(Object.isFrozen(payload.lines[0])).toBe(true); return result; });
    await intent.send(send);
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0].lines[0].expectedVersion).toBe(7);
    expect(send.mock.calls[0][0].source.documentId).toBe("7"); expect(intent.state.receipt).toEqual(result);
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("ST040-C20 never treats timeout/null then403 as rollback; retries only original intent after successful lookup", async () => {
    const intent = await owner(); intent.prepare("count", 7, body);
    const send = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockRejectedValueOnce(Object.assign(new Error("denied"), { status: 403 }));
    await expect(intent.send(send)).rejects.toThrow(); expect(intent.state.status).toBe("UNKNOWN");
    httpClient.get.mockRejectedValueOnce(new Error("lookup lost"));
    await expect(intent.retry(send)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
    httpClient.get.mockResolvedValueOnce(null);
    await expect(intent.retry(send)).rejects.toThrow(); expect(intent.state.status).toBe("UNKNOWN");
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]); expect(sessionStorage.getItem(key)).not.toBeNull();
  });
  it.each([
    { label: "failed current refresh", action: "count", parent: 7, payload: body, refreshResult: false },
    { label: "absent Create refresh", action: "create", parent: null, payload: { warehouseId: 1, binIds: [2], reason: "" }, refreshResult: undefined }
  ])("ST040-C20 $label retains a definitive rejection and the exact original retry", async ({ action, parent, payload, refreshResult }) => {
    const intent = await owner(); intent.prepare(action, parent, payload);
    const record = intent.state.record, reference = sessionStorage.getItem(key);
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("version changed"), { status: 409, code: "VERSION_CONFLICT" }));
    await expect(intent.send(send)).rejects.toThrow(); expect(intent.state.status).toBe("REJECTED");
    const original = send.mock.calls[0][0], refresh = vi.fn(async () => refreshResult);
    httpClient.get.mockResolvedValueOnce(null);
    await expect(intent.reprepare(refresh)).rejects.toThrow();
    expect(refresh).toHaveBeenCalledTimes(1); expect(intent.state.status).toBe("REJECTED");
    expect(intent.state.record).toBe(record); expect(sessionStorage.getItem(key)).toBe(reference);
    httpClient.get.mockResolvedValueOnce(null);
    await expect(intent.retry(send)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0]).toBe(original);
    expect(send.mock.calls[1][0].idempotencyKey).toBe(original.idempotencyKey);
    expect(sessionStorage.getItem(key)).toBe(reference);
  });
  it("ST040-C20 reprepare holds exclusivity through deferred current refresh", async () => {
    const intent = await owner(); intent.prepare("count", 7, body);
    const rejected = Object.assign(new Error("version changed"), { status: 409 });
    await expect(intent.send(async () => { throw rejected; })).rejects.toThrow();
    httpClient.get.mockResolvedValue(null);
    let release;
    const refresh = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const preparing = intent.reprepare(refresh); await flushPromises();
    let finish;
    const retry = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const duringRefresh = intent.retry(retry).catch(() => null);
    await flushPromises(); const sendsDuringRefresh = retry.mock.calls.length;
    release(true); await preparing;
    finish?.(result); await duringRefresh;
    expect(sendsDuringRefresh).toBe(0);
    expect(intent.state.status).toBe("IDLE");
    expect(intent.state.record).toBeNull();
  });
  it.each([{ label: "array", value: [7] }, { label: "number", value: 7 }, { label: "object", value: {} }])("ST040-C22 rejects $label by-source parent resultId without clearing the original reference", async ({ value }) => {
    const intent = await owner(); intent.prepare("count", 7, body);
    await expect(intent.send(async () => { throw new Error("unknown"); })).rejects.toThrow();
    const reference = sessionStorage.getItem(key);
    httpClient.get.mockResolvedValue({ operationId: 22, completedAt: 1, resultType: "STOCKTAKE", resultId: value, resultSummary: result });
    await expect(intent.query()).rejects.toThrow();
    expect(intent.state.status).toBe("UNKNOWN"); expect(intent.state.receipt).toBeNull();
    expect(sessionStorage.getItem(key)).toBe(reference);
  });
  it("ST040-C21 corrupt/quota/refresh/disposal blocks writes and old callbacks cannot clear a recovery reference", async () => {
    sessionStorage.setItem(key, '{"password":"not allowed"}');
    expect((await owner()).state.status).toBe("BLOCKED");
    sessionStorage.removeItem(key);
    const intent = await owner(); intent.prepare("count", 7, body);
    const stored = JSON.parse(sessionStorage.getItem(key));
    expect(Object.keys(stored).sort()).toEqual(["action", "parentStocktakeId", "source"]);
    expect(JSON.stringify(stored)).not.toMatch(/quantity|idempotencyKey|reason|password/);
    let finish; const pending = intent.send(() => new Promise(resolve => { finish = resolve; }));
    active = false; intent.dispose(); finish(result); await pending;
    expect(sessionStorage.getItem(key)).not.toBeNull(); expect(intent.state.receipt).toBeNull();
    active = true; const restored = await owner(); expect(restored.state.status).toBe("QUERY_ONLY");
    await expect(restored.send(vi.fn())).rejects.toThrow();
    const { createStocktakeIntent } = await helpers();
    const unavailable = createStocktakeIntent({ actorId: 18, active: () => true, lookup: vi.fn(),
      storage: { getItem: () => null, setItem: () => { throw new Error("quota"); } } });
    expect(() => unavailable.prepare("count", 7, body)).toThrow();
    apiFixture();
    const opened = await openPage(); expect(opened.wrapper.text()).toContain("QUERY_ONLY");
    const reference = sessionStorage.getItem(key);
    opened.session.clear(); await nextTick(); expect(opened.wrapper.text()).not.toContain("ST-7"); expect(sessionStorage.getItem(key)).toBe(reference);
    opened.wrapper.unmount(); mounted.pop();
    sessionStorage.removeItem(key); apiFixture();
    const sending = await openPage(); await button(sending.wrapper, "點算此行").trigger("click"); await flushPromises();
    const { default: Counter } = await component("StocktakeCounter"); const editor = sending.wrapper.findComponent(Counter);
    await field(editor, "實數（Base UOM）").find("input").setValue("2");
    let release; httpClient.post.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await editor.find("form").trigger("submit"); await flushPromises(); const sentReference = sessionStorage.getItem(key); expect(sentReference).not.toBeNull();
    sending.session.user = { id: actor + 1, roles: [], permissions: ["inventory.view"] }; await nextTick();
    expect(document.body.querySelector('[aria-label="實數（Base UOM）"]')).toBeNull();
    release(result); await flushPromises(); expect(sessionStorage.getItem(key)).toBe(sentReference); expect(sessionStorage.getItem(`inventory-stocktake-recovery:v1:${actor + 1}`)).toBeNull();
    sending.wrapper.unmount(); mounted.pop(); document.body.innerHTML = "";
  });
  it("ST040-C22 rejects malformed/foreign/Add-child receipts and resolves only exact original by-source scalar", async () => {
    const intent = await owner(); intent.prepare("add_line", 7, { binId: 2, skuId: 3, lotId: null, stockStatus: "AVAILABLE" });
    await expect(intent.send(async () => result)).rejects.toThrow(); expect(intent.state.status).toBe("UNKNOWN");
    httpClient.get.mockResolvedValueOnce({ operationId: 22, resultType: "STOCKTAKE", resultId: "8", resultSummary: { ...result, id: 30, stocktakeId: 7, version: 1 } });
    await expect(intent.query()).rejects.toThrow(); expect(sessionStorage.getItem(key)).not.toBeNull();
    const child = { ...result, id: 30, stocktakeId: 7, version: 1 };
    httpClient.get.mockResolvedValueOnce({ operationId: 22, completedAt: 1, resultType: "STOCKTAKE", resultId: "7", resultSummary: child });
    await intent.query(); expect(intent.state.receipt).toEqual(child); expect(intent.state.receipt.id).not.toBe(7);
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("ST040-C22 rejects an array movementGroupId in direct and by-source receipts without clearing recovery", async () => {
    const intent = await owner(); intent.prepare("post", 7, { expectedVersion: 2, reason: "實物對帳" });
    const record = intent.state.record, reference = sessionStorage.getItem(key);
    const malformed = { ...result, status: "POSTED", version: 3, movementGroupId: ["12345678-1234-1234-1234-123456789abc"] };
    await expect(intent.send(async () => malformed, "unit-entry")).rejects.toThrow();
    expect(intent.state.status).toBe("UNKNOWN"); expect(intent.state.receipt).toBeNull();
    expect(intent.state.record).toBe(record); expect(sessionStorage.getItem(key)).toBe(reference);
    httpClient.get.mockResolvedValueOnce({ operationId: 22, completedAt: 1, resultType: "STOCKTAKE", resultId: "7", resultSummary: malformed });
    await expect(intent.query()).rejects.toThrow();
    expect(intent.state.status).toBe("UNKNOWN"); expect(intent.state.receipt).toBeNull();
    expect(intent.state.record).toBe(record); expect(sessionStorage.getItem(key)).toBe(reference);
  });
  it.each([{ version: 99, rowCount: 1 }, { version: 1, rowCount: 0 }])(
    "ST040-C22 rejects Create receipt version $version / rowCount $rowCount for the original single-Bin request", async ({ version, rowCount }) => {
      const intent = await owner(); intent.prepare("create", null, { warehouseId: 1, binIds: [2], reason: "" });
      const record = intent.state.record, reference = sessionStorage.getItem(key);
      const malformed = { ...result, status: "DRAFT", version, rowCount };
      await expect(intent.send(async () => malformed)).rejects.toThrow();
      expect(intent.state.status).toBe("UNKNOWN"); expect(intent.state.receipt).toBeNull();
      expect(intent.state.record).toBe(record); expect(sessionStorage.getItem(key)).toBe(reference);
      httpClient.get.mockResolvedValueOnce({ operationId: 22, completedAt: 1, resultType: "STOCKTAKE", resultId: "7", resultSummary: malformed });
      await expect(intent.query()).rejects.toThrow();
      expect(intent.state.status).toBe("UNKNOWN"); expect(intent.state.receipt).toBeNull();
      expect(intent.state.record).toBe(record); expect(sessionStorage.getItem(key)).toBe(reference);
    });
  it("ST040-C12 explicit Barcode adapter preserves raw input and old Code signature", async () => {
    httpClient.get.mockResolvedValue({ skuId: 3 }); const signal = new AbortController().signal;
    await inventory.lookupSkuByBarcode("  123-45  ", { signal });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/inventory/sku-lookup", { params: { barcode: "  123-45  " }, signal });
    await inventory.lookupSku("123-45", { signal });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/inventory/sku-lookup", { params: { code: "123-45" }, signal });
    apiFixture(); const opened = await openPage();
    const { default: Wizard } = await component("StocktakeWizard"); const wizard = opened.wrapper.findComponent(Wizard);
    const input = field(wizard, "定位 Code／Barcode"); await input.find("input").setValue("collision");
    wizard.findAllComponents(QSelect).find(item => item.props("label") === "定位模式").vm.$emit("update:modelValue", "Barcode"); await flushPromises();
    let release; httpClient.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await button(wizard, "定位現有 SKU 行").trigger("click"); await flushPromises();
    expect(httpClient.get.mock.calls.at(-1)[1].params).toEqual({ barcode: "collision" });
    await input.find("input").setValue("changed"); release({ skuId: 99, skuCode: "OLD-SCAN" }); await flushPromises();
    expect(wizard.text()).not.toContain("OLD-SCAN"); expect(httpClient.post).not.toHaveBeenCalled();
    opened.wrapper.unmount(); mounted.pop(); document.body.innerHTML = "";
  });
  it("ST040-C23 export includes literal q and whitelist only, preserves Blob envelope and signal", async () => {
    const signal = new AbortController().signal, envelope = { blob: new Blob(["csv"]), contentType: "text/csv", fileName: "stocktake.csv" };
    httpClient.getBlob.mockResolvedValue(envelope);
    expect(await inventory.exportStocktake(7, { q: "中文%_!", variance: "GAIN", token: "excluded", signal })).toBe(envelope);
    const [url, options] = httpClient.getBlob.mock.calls[0]; expect(new URL(url, "https://example.test").searchParams.get("q")).toBe("中文%_!");
    expect(url).not.toContain("token"); expect(options.signal).toBe(signal);
    apiFixture(); const opened = await openPage(undefined, "?id=7&q=%E4%B8%AD%E6%96%87%25_%21");
    const originalURL = URL, created = vi.fn(() => "blob:owned-unit"), revoked = vi.fn();
    vi.stubGlobal("URL", class extends originalURL { static createObjectURL = created; static revokeObjectURL = revoked; });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await button(opened.wrapper, "下載盤點 CSV").trigger("click"); await flushPromises();
    expect(created).toHaveBeenCalledWith(envelope.blob); expect(revoked).toHaveBeenCalledWith("blob:owned-unit");
    expect(opened.wrapper.text()).toContain("不代表完整"); expect(document.body.querySelector('a[download]')).toBeNull();
    opened.wrapper.unmount(); mounted.pop(); document.body.innerHTML = "";
  });
  it("ST040-C24 localized allowlisted errors discard object/English details instead of leaking or crashing FormPanel", async () => {
    const { stocktakeError } = await helpers();
    for (const details of [{ field: "quantity" }, [{ location: "body", path: "/quantity", message: "SELECT secret" }]]) {
      const safe = stocktakeError({ code: "UOM_CONVERSION_INVALID", message: "SELECT secret", details });
      expect(safe.message).toContain("單位"); expect(safe.details).toBeUndefined(); expect(safe.message).not.toContain("SELECT");
    }
    expect(stocktakeError({ code: "BARCODE_LOOKUP_INCONSISTENT" }).message).toContain("條碼");
    expect(stocktakeError({ message: "中文 SELECT secret" }).message).not.toContain("SELECT");
    for (const code of ["constructor", "toString", "__proto__"]) {
      const safe = stocktakeError({ code, message: "SELECT secret" });
      expect(safe.message).toBe("無法完成操作；請核對原結果，未自動重送。");
      expect(safe.code).toBeUndefined();
    }
  });
});

const SUMMARY = { totalLines: 1, countedLines: 0, notFoundLines: 0, uncountedLines: 1, gainLines: 0, lossLines: 0, zeroLines: 0 };
const HEADER = { id: 7, number: "ST-7", warehouseId: 1, status: "COUNTING", version: 2, scope: { items: [{ id: 1, binId: 2, binCodeCurrent: "BIN", statusCurrent: "ACTIVE" }], total: 1, page: 1, pageSize: 20 },
  progress: SUMMARY, varianceSummary: SUMMARY, varianceStage: "PREVIEW", reason: "" };
function apiFixture(header = HEADER) {
  httpClient.get.mockImplementation(async path => {
    if (path.endsWith("/stocktakes/7")) return header;
    if (path.endsWith("/lines")) return { id: 7, status: header.status, version: header.version, items: [LINE], total: 1,
      globalSummary: header.progress, filteredSummary: SUMMARY, varianceStage: header.varianceStage };
    if (path.endsWith("/stocktakes")) return { items: [header], total: 1 };
    return { items: [], total: 0 };
  });
}
async function openPage(permissions = ["inventory.view", "inventory.operation"], query = "?id=7") {
  const name = "StocktakesPage";
  const { default: Page, page } = await import(`../../../src/pages/inventory/${name}.vue`);
  const pinia = createPinia(), session = useSessionStore(pinia); session.user = { id: actor, roles: [], permissions };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, name: page.name, component: Page },
    { path: "/other", component: { template: "<div>其他頁</div>" } }, { path: "/login", name: "login", component: { template: "<div>登入</div>" } }] });
  await router.push(`${page.path}${query}`); await router.isReady();
  const wrapper = mount({ template: "<router-view />" }, { global: { plugins: [Quasar, router, pinia] }, attachTo: document.body }); mounted.push(wrapper);
  await flushPromises(); return { wrapper, router, session, page };
}
describe("TASK040 actual page and table ownership", () => {
  beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); apiFixture(); });
  afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });
  it("ST040-C01 automatic Inventory view menu separates VIEW/operation/adjust/Item roles", async () => {
    const { wrapper, page, session } = await openPage(["inventory.view"]);
    expect(page.path).toBe("/inventory/stocktakes"); expect(page.menu.order).toBe(70); expect(page.requires.permissions).toEqual(["inventory.view"]);
    expect(wrapper.text()).toContain("ST-7"); expect(button(wrapper, "新增盤點草稿")).toBeUndefined();
    session.user = { id: actor, roles: [], permissions: ["inventory.view", "inventory.adjust"] }; await flushPromises();
    expect(button(wrapper, "新增盤點草稿")).toBeUndefined(); expect(button(wrapper, "點算此行")).toBeUndefined();
    session.user = { id: actor, roles: [], permissions: ["inventory.view", "inventory.operation"] }; await flushPromises();
    expect(button(wrapper, "新增盤點草稿")).toBeDefined();
    session.user = { id: actor, roles: [], permissions: ["item.view"] }; await nextTick(); expect(wrapper.text()).not.toContain("ST-7");
  });
  it("ST040-C02 restores only allowlisted read URLs, rejects secret/tampered query without any write", async () => {
    const { wrapper } = await openPage(undefined, "?id=7&password=secret&sourceEventId=event");
    expect(wrapper.text()).toContain("網址"); expect(wrapper.text()).not.toContain("secret"); expect(httpClient.post).not.toHaveBeenCalled();
    expect(httpClient.get.mock.calls.filter(([path]) => path.includes("stocktakes"))).toHaveLength(0);
  });
  it("ST040-C03 mounts unchanged DataTable; retired success/rejection/events never replace live rows or issue extra HTTP", async () => {
    const { createStocktakeTable } = await helpers(); const reads = [], commits = [];
    const table = createStocktakeTable({ active: () => true, onCommit: (_, page) => commits.push(page),
      read: params => new Promise((resolve, reject) => { reads.push({ params, resolve, reject }); }) });
    table.refresh(); const old = table.instance.value;
    const host = mount({ setup: () => () => table.instance.value ? h(DataTable, { key: table.instance.value.key, fetch: table.instance.value.fetch,
      initialPagination: table.instance.value.pagination, columns: [{ name: "name", label: "名稱", field: "name" }] }) : h("div") }, { global: { plugins: [Quasar] } }); mounted.push(host);
    await flushPromises(); table.refresh({ page: 2, rowsPerPage: 20 }); await flushPromises();
    reads[1].resolve({ rows: [{ id: 2, name: "CURRENT-B" }], rowsNumber: 40 }); await flushPromises();
    reads[0].resolve({ rows: [{ id: 1, name: "STALE-A" }], rowsNumber: 1 }); await flushPromises();
    expect(host.text()).toContain("CURRENT-B"); expect(host.text()).not.toContain("STALE-A");
    expect(host.find(".q-table__bottom").text()).toContain("21–40 of 40");
    await expect(old.fetch({ page: 9, rowsPerPage: 20 })).rejects.toThrow(); expect(reads).toHaveLength(2);
    const live = table.instance.value; const pagination = live.fetch({ page: 3, rowsPerPage: 20 }); await expect(pagination).rejects.toThrow(); await flushPromises();
    await expect(live.fetch({ page: 4, rowsPerPage: 20 })).rejects.toThrow(); expect(reads).toHaveLength(3);
    table.refresh({ page: 4, rowsPerPage: 20 }); await flushPromises(); reads[3].resolve({ rows: [{ id: 4, name: "CURRENT-D" }], rowsNumber: 80 }); await flushPromises();
    reads[2].reject(new Error("STALE-C")); await flushPromises(); expect(host.text()).toContain("CURRENT-D"); expect(host.text()).not.toContain("STALE-C");
    expect(host.find('[aria-busy="true"]').exists()).toBe(false); expect(commits.at(-1).page).toBe(4); table.dispose();
  });
  it("ST040-C20 a Wizard 503 during reprepare retains the original rejected Count and its retry key", async () => {
    const { wrapper } = await openPage(); await button(wrapper, "點算此行").trigger("click"); await flushPromises();
    const { default: Counter } = await component("StocktakeCounter"), editor = wrapper.findComponent(Counter);
    await field(editor, "實數（Base UOM）").find("input").setValue("6");
    httpClient.post.mockRejectedValue(Object.assign(new Error("version changed"), { status: 409, code: "VERSION_CONFLICT" }));
    await editor.find("form").trigger("submit"); await flushPromises();
    const reference = sessionStorage.getItem(key), original = httpClient.post.mock.calls[0][1];
    expect(reference).not.toBeNull(); expect(wrapper.text()).toContain("REJECTED");
    const fixture = httpClient.get.getMockImplementation();
    httpClient.get.mockImplementation((path, options) => path.endsWith("/by-source") ? Promise.resolve(null) :
      path.endsWith("/stocktakes/7") ? Promise.reject(Object.assign(new Error("unavailable"), { status: 503 })) : fixture(path, options));
    await button(wrapper, "查詢並重新準備被拒意圖").trigger("click"); await flushPromises();
    expect(sessionStorage.getItem(key)).toBe(reference); expect(wrapper.text()).toContain("REJECTED");
    expect(button(wrapper, "新增盤點草稿").attributes("disabled")).toBeDefined();
    expect(httpClient.post).toHaveBeenCalledTimes(1);
    httpClient.get.mockImplementation((path, options) => path.endsWith("/by-source") ? Promise.resolve(null) : fixture(path, options));
    await button(wrapper, "明確重試原提交").trigger("click"); await flushPromises();
    expect(httpClient.post).toHaveBeenCalledTimes(2);
    expect(httpClient.post.mock.calls[1][1].body).toEqual(original.body);
    expect(httpClient.post.mock.calls[1][1].idempotencyKey).toBe(original.idempotencyKey);
    expect(sessionStorage.getItem(key)).toBe(reference);
  });
  it("ST040-C20 Create without a selected Wizard cannot clear its rejected recovery during reprepare", async () => {
    const { wrapper } = await openPage(undefined, "");
    await button(wrapper, "新增盤點草稿").trigger("click"); await flushPromises();
    const { default: Scope } = await component("StocktakeScopeForm");
    httpClient.post.mockRejectedValue(Object.assign(new Error("scope conflict"), { status: 409, code: "VERSION_CONFLICT" }));
    await expect(wrapper.findComponent(Scope).props("submit")({ warehouseId: 1, binIds: [2], reason: "" })).rejects.toThrow();
    await flushPromises(); const reference = sessionStorage.getItem(key), original = httpClient.post.mock.calls[0][1];
    expect(reference).not.toBeNull(); expect(wrapper.text()).toContain("REJECTED");
    const fixture = httpClient.get.getMockImplementation();
    httpClient.get.mockImplementation((path, options) => path.endsWith("/by-source") ? Promise.resolve(null) : fixture(path, options));
    await button(wrapper, "查詢並重新準備被拒意圖").trigger("click"); await flushPromises();
    expect(sessionStorage.getItem(key)).toBe(reference); expect(wrapper.text()).toContain("REJECTED");
    expect(httpClient.post).toHaveBeenCalledTimes(1);
    await button(wrapper, "明確重試原提交").trigger("click"); await flushPromises();
    expect(httpClient.post).toHaveBeenCalledTimes(2);
    expect(httpClient.post.mock.calls[1][1].body).toEqual(original.body);
    expect(httpClient.post.mock.calls[1][1].idempotencyKey).toBe(original.idempotencyKey);
    expect(sessionStorage.getItem(key)).toBe(reference);
  });
  it("ST040-C21 an original-result reload finishing after actor replacement cannot retire the new actor table", async () => {
    active = true; const intent = await owner(); intent.prepare("count", 7, body);
    const { wrapper, session } = await openPage(), fixture = httpClient.get.getMockImplementation();
    let queryCompleted = false, newActor = false, releaseHeader, oldHeaderSignal;
    const newReads = [];
    httpClient.get.mockImplementation((path, options) => {
      if (path.endsWith("/by-source")) {
        queryCompleted = true;
        return Promise.resolve({ operationId: 22, completedAt: 1, resultType: "STOCKTAKE", resultId: "7", resultSummary: result });
      }
      if (queryCompleted && !newActor && path.endsWith("/stocktakes/7") && options.params.scopePage === undefined) {
        oldHeaderSignal = options.signal;
        return new Promise(resolve => { releaseHeader = resolve; });
      }
      if (newActor && path.endsWith("/stocktakes")) return new Promise(resolve => { newReads.push({ signal: options.signal, resolve }); });
      return fixture(path, options);
    });
    await button(wrapper, "查詢原結果").trigger("click"); await flushPromises();
    expect(releaseHeader).toBeTypeOf("function"); expect(oldHeaderSignal.aborted).toBe(false);
    newActor = true; session.user = { id: actor + 1, roles: [], permissions: ["inventory.view", "inventory.operation"] };
    await flushPromises();
    expect(oldHeaderSignal.aborted).toBe(true); expect(newReads.length).toBeGreaterThan(0);
    const currentRead = newReads.at(-1), currentTable = wrapper.findComponent(DataTable).vm.$.uid;
    expect(currentRead.signal.aborted).toBe(false);
    const listCalls = httpClient.get.mock.calls.filter(([path]) => path.endsWith("/stocktakes")).length;
    releaseHeader(HEADER); await flushPromises();
    expect(httpClient.get.mock.calls.filter(([path]) => path.endsWith("/stocktakes"))).toHaveLength(listCalls);
    expect(currentRead.signal.aborted).toBe(false); expect(wrapper.findComponent(DataTable).vm.$.uid).toBe(currentTable);
    newReads.forEach(read => read.resolve({ items: [HEADER], total: 1 })); await flushPromises();
    expect(wrapper.text()).toContain("ST-7"); expect(sessionStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem("inventory-stocktake-recovery:v1:" + (actor + 1))).toBeNull();
  });
  it("ST040-C09 removes Count pager before dirty editor, refuses voluntary URL navigation, auth exit always clears without prompt", async () => {
    const { wrapper, router, session } = await openPage();
    expect(wrapper.find('[aria-label="點算行表格"]').exists()).toBe(true);
    await button(wrapper, "點算此行").trigger("click"); await flushPromises();
    const { default: Counter } = await component("StocktakeCounter"); const editor = wrapper.findComponent(Counter);
    await field(editor, "實數（Base UOM）").find("input").setValue("6");
    expect(wrapper.find('[aria-label="點算行表格"]').exists()).toBe(false);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false); const calls = httpClient.get.mock.calls.length;
    await router.push("/other"); await flushPromises(); expect(router.currentRoute.value.path).toBe("/inventory/stocktakes");
    expect(field(editor, "實數（Base UOM）").find("input").element.value).toBe("6"); expect(httpClient.get).toHaveBeenCalledTimes(calls);
    confirm.mockClear(); session.clear(); await router.push("/login"); await flushPromises();
    expect(confirm).not.toHaveBeenCalled(); expect(document.body.querySelector('input[type="password"]')).toBeNull(); expect(wrapper.text()).not.toContain("ST-7");
  });
});

describe("TASK040 workflow review, field discovery and strong confirmation", () => {
  beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); apiFixture(); });
  afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });
  it("ST040-C05 Draft scope is exclusive but not a stock lock; write retains source and full selected Bin IDs", async () => {
    const draft = { ...HEADER, status: "DRAFT", varianceStage: "NOT_STARTED", scope: { ...HEADER.scope, pageSize: 100 } }; apiFixture(draft);
    const { wrapper } = await openPage(); expect(wrapper.text()).toContain("尚未鎖定庫存");
    await button(wrapper, "編輯草稿範圍").trigger("click"); await flushPromises();
    const { default: Scope } = await component("StocktakeScopeForm");
    httpClient.post.mockResolvedValue({ ...result, status: "DRAFT", version: 3, rowCount: 1 });
    await wrapper.findComponent(Scope).find("form").trigger("submit"); await flushPromises();
    const [path, options] = httpClient.post.mock.calls[0]; expect(path).toContain("/7/update");
    expect(options.body.binIds).toEqual([2]); expect(options.body.expectedVersion).toBe(2);
    expect(options.body.source.documentId).toBe("7"); expect(options.idempotencyKey).toBeTruthy();
  });
  it("ST040-C06 Start warns whole scope and does not optimistically acquire locks before a validated commit", async () => {
    apiFixture({ ...HEADER, status: "DRAFT", varianceStage: "NOT_STARTED" });
    let finish; httpClient.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { wrapper } = await openPage(); await button(wrapper, "準備 Start").trigger("click"); await flushPromises();
    expect(document.body.textContent).toContain("整個範圍"); expect(document.body.textContent).toContain("暫停庫存異動");
    const form = [...document.body.querySelectorAll("form")].find(node => node.getAttribute("aria-label") === "盤點工作流程確認"); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flushPromises();
    expect(httpClient.post.mock.calls[0][1].body.expectedVersion).toBe(2); expect(wrapper.text()).toContain("尚未鎖定庫存");
    apiFixture({ ...HEADER, version: 3 }); finish({ ...result, version: 3, rowCount: 1 }); await flushPromises(); expect(wrapper.text()).toContain("COUNTING");
  });
  it("ST040-C13 field discovery supports NULL/known same-SKU expired Lot only, never creates Lot or stock", async () => {
    const { default: Add } = await component("StocktakeAddLine"); const submit = vi.fn(async () => ({ ...result, id: 30, stocktakeId: 7, version: 1 }));
    httpClient.get.mockImplementation(async path => path.endsWith("sku-lookup") ? { skuId: 3, skuCode: "SKU-3", skuName: "實物", trackingPolicy: "batch_expiry", baseUom: LINE.baseUom } :
      path.endsWith("lots") ? { items: [{ lotId: 4, sku: { skuId: 3 }, lotNumber: "EXPIRED", expiryDate: "2020-01-01" }], total: 1 } : HEADER);
    const wrapper = mount(Add, { props: { detail: HEADER, submit }, global: { plugins: [Quasar] } }); mounted.push(wrapper); await flushPromises();
    await field(wrapper, "精確 Code／Barcode").find("input").setValue("SKU-3"); await button(wrapper, "查找帳外 SKU").trigger("click"); await flushPromises();
    wrapper.findAllComponents(QSelect).find(item => item.props("label") === "所屬盤點庫位").vm.$emit("update:modelValue", 2);
    wrapper.findAllComponents(QSelect).find(item => item.props("label") === "既有合法批次").vm.$emit("update:modelValue", 99); await flushPromises();
    await wrapper.find("form").trigger("submit"); await flushPromises(); expect(submit).not.toHaveBeenCalled();
    wrapper.findAllComponents(QSelect).find(item => item.props("label") === "既有合法批次").vm.$emit("update:modelValue", 4); await flushPromises();
    await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(submit).toHaveBeenCalledWith({ binId: 2, skuId: 3, lotId: 4, stockStatus: "AVAILABLE" });
    expect(wrapper.text()).toContain("不授予銷售或收貨資格"); expect(httpClient.post).not.toHaveBeenCalled();
  });
  it("ST040-C14 Add child receipt cannot replace parent header; current line query uses exact parent and dimensions", async () => {
    const { wrapper } = await openPage(); await button(wrapper, "新增帳外 Bucket").trigger("click"); await flushPromises();
    const { default: Add } = await component("StocktakeAddLine");
    const form = wrapper.findComponent(Add), child = { ...result, id: 30, stocktakeId: 7, version: 1 };
    httpClient.post.mockResolvedValue(child);
    await form.props("submit")({ binId: 2, skuId: 3, lotId: null, stockStatus: "AVAILABLE" }); await flushPromises();
    expect(httpClient.get.mock.calls.some(([path, options]) => path.endsWith("/7/lines") && options.params.binId === 2 && options.params.skuId === 3 && options.params.stockStatus === "AVAILABLE")).toBe(true);
    expect(wrapper.text()).toContain("ST-7"); expect(httpClient.get.mock.calls.some(([path]) => path.includes("stocktakes/30"))).toBe(false);
  });
  it("ST040-C15 renders truthful 0/0 and readonly Ready/Posted/Cancelled history without reopen", async () => {
    const empty = { ...SUMMARY, totalLines: 0, uncountedLines: 0 };
    apiFixture({ ...HEADER, progress: empty, varianceSummary: empty });
    let opened = await openPage(); expect(opened.wrapper.text()).toContain("0/0"); opened.wrapper.unmount(); mounted.pop();
    for (const status of ["READY_TO_POST", "POSTED", "CANCELLED"]) {
      apiFixture({ ...HEADER, status, varianceStage: "FROZEN", cancelled: status === "CANCELLED" }); opened = await openPage();
      expect(button(opened.wrapper, "點算此行")).toBeUndefined(); expect(button(opened.wrapper, "新增帳外 Bucket")).toBeUndefined();
      expect(opened.wrapper.text()).not.toContain("重新開啟"); if (status === "CANCELLED") expect(opened.wrapper.text()).toContain("已取消，不代表已過帳");
      opened.wrapper.unmount(); mounted.pop();
    }
  });
  it("ST040-C16 Ready uses global uncounted, never the filtered subset", async () => {
    const { wrapper } = await openPage(); expect(button(wrapper, "準備 Ready").attributes("disabled")).toBeDefined(); expect(httpClient.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("未點算 1");
  });
  it("ST040-C17 Post requires valid reason and transient raw password, signed:true only and no secrets in recovery", async () => {
    apiFixture({ ...HEADER, status: "READY_TO_POST", varianceStage: "FROZEN" });
    const { wrapper } = await openPage(["inventory.view", "inventory.adjust"]);
    await button(wrapper, "準備 Post").trigger("click"); await flushPromises();
    const { default: Wizard } = await component("StocktakeWizard"); const wizard = wrapper.findComponent(Wizard);
    await field(wizard, "Post／Cancel 原因").find("textarea").setValue("字".repeat(167));
    expect(button(new DOMWrapper(document.body), "確認原因並輸入密碼").attributes("disabled")).toBeDefined();
    await field(wizard, "Post／Cancel 原因").find("textarea").setValue("實物對帳"); await button(new DOMWrapper(document.body), "確認原因並輸入密碼").trigger("click"); await flushPromises();
    const input = document.body.querySelector('input[type="password"]'); input.value = "unit-entry";
    httpClient.post.mockImplementation(async (_, options) => {
      expect(input.value).toBe(""); expect(options.signed).toBe(true); expect(options.body.password).toBe("unit-entry");
      expect(sessionStorage.getItem(key)).not.toMatch(/password|reason|quantity|idempotencyKey/); return { ...result, version: 3, status: "POSTED", movementGroupId: "12345678-1234-1234-1234-123456789abc" };
    });
    input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flushPromises();
    expect(httpClient.post).toHaveBeenCalledTimes(1); expect(document.body.querySelector('input[type="password"]')?.value || "").toBe("");
  });
  it("ST040-C18 Cancel is password-only with 取消盤點 label; existing confirmation default remains 確認過帳", async () => {
    const { wrapper } = await openPage(); await button(wrapper, "準備 Cancel").trigger("click"); await flushPromises();
    const { default: Wizard } = await component("StocktakeWizard"); const wizard = wrapper.findComponent(Wizard);
    await field(wizard, "Post／Cancel 原因").find("textarea").setValue("取消重新規劃"); await button(new DOMWrapper(document.body), "確認原因並輸入密碼").trigger("click"); await flushPromises();
    const input = document.body.querySelector('input[type="password"]'); input.value = "unit-entry";
    httpClient.post.mockResolvedValue({ ...result, version: 3, status: "CANCELLED" }); input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flushPromises();
    expect(httpClient.post.mock.calls[0][0]).toContain("/cancel"); expect(httpClient.post.mock.calls[0][1].signed).toBeUndefined();
    const { default: Dialog } = await component("InventoryHighRiskDialog"); const old = mount(Dialog, { props: { modelValue: true, execute: vi.fn() }, global: { plugins: [Quasar] }, attachTo: document.body }); mounted.push(old);
    await flushPromises(); expect(document.body.textContent).toContain("確認過帳");
  });
});

const mounted = [];
describe("TASK040 independent-review boundary regressions", () => {
  beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); apiFixture(); });
  afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });
  it("ST040-C03 retired list-row actions cannot select an old document for a replacement actor", async () => {
    const { wrapper, session, router } = await openPage(undefined, "");
    const old = wrapper.findAllComponents({ name: "QBtn" }).find(item => item.props("label") === "開啟盤點"), clicked = old.vm.$.vnode.props.onClick;
    session.user = { id: actor + 1, roles: [], permissions: ["inventory.view"] }; await flushPromises();
    await clicked(); await flushPromises(); expect(router.currentRoute.value.query.id).toBeUndefined();
  });
  it("ST040-C20 rejected Count recovery controls remain reachable inside the persistent editor", async () => {
    const { wrapper } = await openPage(); await button(wrapper, "點算此行").trigger("click"); await flushPromises();
    const { default: Counter } = await component("StocktakeCounter"); const editor = wrapper.findComponent(Counter);
    await field(editor, "實數（Base UOM）").find("input").setValue("6");
    httpClient.post.mockRejectedValue(Object.assign(new Error("stale"), { status: 409, code: "VERSION_CONFLICT" }));
    await editor.find("form").trigger("submit"); await flushPromises();
    const card = new DOMWrapper(editor.element.closest(".q-card")); expect(button(card, "查詢原結果")).toBeDefined();
    expect(field(editor, "實數（Base UOM）").find("input").element.value).toBe("6"); expect(httpClient.post).toHaveBeenCalledTimes(1);
  });
  it("ST040-C03 retired row actions cannot open Count during the next page's pending read", async () => {
    const { wrapper } = await openPage(), { default: Wizard } = await component("StocktakeWizard"); const wizard = wrapper.findComponent(Wizard);
    const old = wizard.findAllComponents({ name: "QBtn" }).find(item => item.props("label") === "點算此行"); const clicked = old.vm.$.vnode.props.onClick;
    const table = wizard.findAllComponents(DataTable).find(item => item.props("columns").some(column => column.name === "actual"));
    let release; httpClient.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    table.findComponent({ name: "QTable" }).vm.$emit("request", { pagination: { page: 2, rowsPerPage: 20 } }); await flushPromises();
    clicked(); await flushPromises(); const { default: Counter } = await component("StocktakeCounter"); expect(wrapper.findComponent(Counter).exists()).toBe(false);
    release({ id: 7, status: "COUNTING", version: 2, items: [LINE], total: 40, globalSummary: SUMMARY, filteredSummary: SUMMARY }); await flushPromises();
  });
  it("ST040-C23 invalid pending filters never replace the committed displayed/CSV identity", async () => {
    const { wrapper } = await openPage(), { default: Wizard } = await component("StocktakeWizard"); const wizard = wrapper.findComponent(Wizard);
    const calls = httpClient.get.mock.calls.length;
    await field(wizard, "盤點行 Code／名稱 q（不搜尋帳外目錄）").find("input").setValue("x".repeat(191));
    wizard.findAllComponents(QSelect).find(item => item.props("label") === "點算篩選").vm.$emit("update:modelValue", "COUNTED"); await flushPromises();
    expect(httpClient.get).toHaveBeenCalledTimes(calls);
    httpClient.getBlob.mockRejectedValue(new Error("inspect only")); await button(wrapper, "下載盤點 CSV").trigger("click"); await flushPromises();
    const url = new URL(httpClient.getBlob.mock.calls[0][0], "https://example.test"); expect(url.searchParams.get("progress")).toBeNull(); expect(url.searchParams.get("q")).toBeNull();
  });
  it("ST040-C02 accepted same-document URL changes rebind line q/page and scope reads", async () => {
    const { router } = await openPage(); httpClient.get.mockClear();
    await router.push("/inventory/stocktakes?id=7&linePage=2&scopePage=2&q=OTHER"); await flushPromises();
    expect(httpClient.get.mock.calls.some(([path, options]) => path.endsWith("/7/lines") && options.params.page === 2 && options.params.q === "OTHER")).toBe(true);
    expect(httpClient.get.mock.calls.some(([path, options]) => path.endsWith("/stocktakes/7") && options.params.scopePage === 2)).toBe(true);
  });
  it.each(["count", "flow"])("ST040-C02 accepted %s same-document navigation resumes scope and Count reads", async mode => {
    const { wrapper, router } = await openPage();
    const { default: Counter } = await component("StocktakeCounter");
    if (mode === "count") {
      await button(wrapper, "點算此行").trigger("click"); await flushPromises();
      await field(wrapper.findComponent(Counter), "實數（Base UOM）").find("input").setValue("6");
    } else { await button(wrapper, "準備 Cancel").trigger("click"); await flushPromises(); }
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    httpClient.get.mockClear();
    await router.push("/inventory/stocktakes?id=7&linePage=2&scopePage=2&q=OTHER"); await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(1); expect(wrapper.findComponent(Counter).exists()).toBe(false);
    expect(httpClient.get.mock.calls.some(([path, options]) => path.endsWith("/7/lines") && options.params.page === 2 && options.params.q === "OTHER")).toBe(true);
    expect(httpClient.get.mock.calls.some(([path, options]) => path.endsWith("/stocktakes/7") && options.params.scopePage === 2)).toBe(true);
    expect(wrapper.findAllComponents(DataTable)).toHaveLength(3);
  });
  it("ST040-C14 a failed current-line query cannot turn confirmed Add into an apparent failed submit", async () => {
    const { wrapper } = await openPage(); await button(wrapper, "新增帳外 Bucket").trigger("click"); await flushPromises();
    const { default: Add } = await component("StocktakeAddLine"), add = wrapper.findComponent(Add); const child = { ...result, id: 30, stocktakeId: 7, version: 1 };
    httpClient.post.mockResolvedValue(child); const fixture = httpClient.get.getMockImplementation();
    httpClient.get.mockImplementation((path, options) => path.endsWith("/7/lines") && options.params.skuId === 3 ? Promise.reject(new Error("current read unavailable")) : fixture(path, options));
    await expect(add.props("submit")({ binId: 2, skuId: 3, lotId: null, stockStatus: "AVAILABLE" })).resolves.toEqual(child);
    expect(httpClient.post).toHaveBeenCalledTimes(1); expect(wrapper.text()).toContain("原回執已確認"); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("ST040-C09 filtered Count waits for current read then returns focus to stable filter", async () => {
    const { wrapper } = await openPage(undefined, "?id=7&progress=UNCOUNTED");
    await button(wrapper, "點算此行").trigger("click"); await flushPromises();
    const { default: Counter } = await component("StocktakeCounter"), editor = wrapper.findComponent(Counter);
    await field(editor, "實數（Base UOM）").find("input").setValue("6");
    httpClient.post.mockResolvedValue(result); const fixture = httpClient.get.getMockImplementation(); let release;
    httpClient.get.mockImplementation((path, options) => path.endsWith("/7/lines") ? new Promise(resolve => { release = resolve; }) : fixture(path, options));
    await editor.find("form").trigger("submit"); await flushPromises();
    const { default: Wizard } = await component("StocktakeWizard"), wizard = wrapper.findComponent(Wizard);
    const fallback = field(wizard, "盤點行 Code／名稱 q（不搜尋帳外目錄）").find("input").element;
    expect(document.activeElement).not.toBe(fallback);
    expect(release).toBeTypeOf("function");
    release({ id: 7, status: "COUNTING", version: 2, items: [], total: 0, globalSummary: { ...SUMMARY, countedLines: 1, uncountedLines: 0 }, filteredSummary: { ...SUMMARY, totalLines: 0, uncountedLines: 0 } }); await flushPromises();
    expect(button(wrapper, "點算此行")).toBeUndefined();
    expect(document.activeElement).toBe(fallback);
    expect(httpClient.post).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("ST040-C09 explicit discard has one confirmation owner and reloads the committed Count page", async () => {
    const { wrapper } = await openPage(); await button(wrapper, "點算此行").trigger("click"); await flushPromises();
    const { default: Counter } = await component("StocktakeCounter"), editor = wrapper.findComponent(Counter);
    await field(editor, "實數（Base UOM）").find("input").setValue("6"); const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await button(new DOMWrapper(document.body), "明確捨棄點算").trigger("click"); await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(1); expect(wrapper.findComponent(Counter).exists()).toBe(false);
    expect(httpClient.get.mock.calls.filter(([path]) => path.endsWith("/7/lines")).at(-1)[1].params.page).toBe(1);
    expect(document.activeElement).toBe(button(wrapper, "點算此行").element);
  });
});
const component = name => import(`../../../src/components/inventory/${name}.vue`);
const field = (wrapper, label) => wrapper.findAllComponents(QInput).find(item => item.props("label") === label);
const button = (wrapper, label) => wrapper.findAll("button").find(item => item.text() === label);
const LINE = { id: 3, version: 7, binId: 2, skuId: 3, lotId: null, stockStatus: "AVAILABLE", skuCodeCurrent: "SKU-3", skuNameCurrent: "實物",
  baseUom: { uomId: 5, uomCode: "EA" }, snapshotQuantity: 5, countedQuantity: null, countState: "UNCOUNTED", notFound: false };
async function counter(line = LINE, submit = vi.fn(async () => result)) {
  const { default: Counter } = await component("StocktakeCounter");
  const wrapper = mount(Counter, { props: { line, submit }, global: { plugins: [Quasar] }, attachTo: document.body });
  mounted.push(wrapper); await flushPromises(); return wrapper;
}
describe("TASK040 scope and Count forms", () => {
  beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); });
  afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });
  it("ST040-C07 distinguishes blank, zero and explicit notFound with exactly one row per save", async () => {
    const submit = vi.fn(async () => result), wrapper = await counter(LINE, submit);
    await wrapper.find("form").trigger("submit"); await flushPromises(); expect(submit).not.toHaveBeenCalled();
    await field(wrapper, "實數（Base UOM）").find("input").setValue("0");
    await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(submit).toHaveBeenCalledWith({ lines: [{ lineId: 3, expectedVersion: 7, countedQuantity: 0 }] });
    wrapper.findComponent({ name: "QCheckbox" }).vm.$emit("update:modelValue", true); await flushPromises();
    await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(submit).toHaveBeenLastCalledWith({ lines: [{ lineId: 3, expectedVersion: 7, notFound: true }] });
  });
  it("ST040-C08 rejects signed/fractional/unsafe/Pack quantity locally, always uses Base UOM", async () => {
    const submit = vi.fn(), wrapper = await counter(LINE, submit);
    for (const value of ["-1", "1.5", "9007199254740992", "+2", "1e2"]) {
      await field(wrapper, "實數（Base UOM）").find("input").setValue(value);
      await wrapper.find("form").trigger("submit"); await flushPromises(); expect(submit).not.toHaveBeenCalled();
    }
    expect(wrapper.text()).toContain("EA"); expect(wrapper.text()).toContain("安全非負整數");
  });
  it("ST040-C10 uses frozen line version7, never parent workflow version2", async () => {
    const submit = vi.fn(async () => result), wrapper = await counter({ ...LINE, countState: "COUNTED", countedQuantity: 2 }, submit);
    await field(wrapper, "實數（Base UOM）").find("input").setValue("4"); await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(submit.mock.calls[0][0]).toEqual({ lines: [{ lineId: 3, expectedVersion: 7, countedQuantity: 4 }] });
    expect(wrapper.emitted("saved")[0][0]).toEqual(result);
  });
  it("ST040-C11 retains original input/version on409 and performs no automatic retry or merge", async () => {
    const submit = vi.fn().mockRejectedValue(Object.assign(new Error("SQL private"), { status: 409, code: "VERSION_CONFLICT", details: { field: "version" } }));
    const wrapper = await counter(LINE, submit); await field(wrapper, "實數（Base UOM）").find("input").setValue("6");
    await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(wrapper.text()).toContain("資料已被修改"); expect(wrapper.text()).not.toContain("SQL private");
    expect(field(wrapper, "實數（Base UOM）").find("input").element.value).toBe("6"); expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].lines[0].expectedVersion).toBe(7); expect(wrapper.emitted("saved")).toBeUndefined();
    expect(document.activeElement.getAttribute("role")).toBe("alert");
  });
  it("ST040-C04 reads every Draft scope page before replace and blocks partial/duplicate/drifting scope", async () => {
    const { default: Scope } = await component("StocktakeScopeForm");
    const scopes = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, binId: index + 2, statusCurrent: "ACTIVE", binCodeCurrent: `BIN-${index}` }));
    httpClient.get.mockImplementation(async (path, options) => {
      if (path.endsWith("/7")) { const page = options.params.scopePage; return { id: 7, version: 2, warehouseId: 1, status: "DRAFT",
        scope: { items: scopes.slice((page - 1) * 100, page * 100), total: 101, page, pageSize: 100 } }; }
      return { items: path.includes("/bins") ? scopes.map(row => ({ id: row.binId, code: row.binCodeCurrent, warehouseId: 1, status: "ACTIVE" })) : [{ id: 1, code: "WH", status: "ACTIVE" }], total: 101 };
    });
    const submit = vi.fn(async () => ({ ...result, status: "DRAFT" }));
    const wrapper = mount(Scope, { props: { detail: { id: 7, version: 2, warehouseId: 1, status: "DRAFT" }, submit }, global: { plugins: [Quasar] } }); mounted.push(wrapper);
    await flushPromises(); await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(submit.mock.calls[0][0].binIds).toHaveLength(101); expect(submit.mock.calls[0][0].expectedVersion).toBe(2);
    expect(httpClient.get.mock.calls.filter(([path]) => path.endsWith("/7"))).toHaveLength(2);
    wrapper.unmount(); mounted.pop(); submit.mockClear();
    httpClient.get.mockImplementation(async path => path.endsWith("/7") ? { id: 7, version: 3, status: "DRAFT", scope: { items: [], total: 101, page: 1, pageSize: 100 } } : { items: [], total: 0 });
    const bad = mount(Scope, { props: { detail: { id: 7, version: 2, warehouseId: 1 }, submit }, global: { plugins: [Quasar] } }); mounted.push(bad);
    await flushPromises(); await bad.find("form").trigger("submit"); await flushPromises(); expect(submit).not.toHaveBeenCalled(); expect(bad.text()).toContain("範圍");
  });
});
