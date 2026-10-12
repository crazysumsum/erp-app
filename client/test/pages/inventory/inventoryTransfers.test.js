import { flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/inventory.js", () => ({ default: {
  lookupSku: vi.fn(), listLots: vi.fn(), listWarehouses: vi.fn(), listBins: vi.fn(), createTransfer: vi.fn(), updateTransfer: vi.fn(), receiveTransfer: vi.fn(),
  listTransfers: vi.fn(), getTransfer: vi.fn(), getStockSummary: vi.fn(), dispatchTransfer: vi.fn(), cancelTransfer: vi.fn()
} }));
import inventory from "@/services/inventory.js";
import TransferSkuField from "@/components/inventory/TransferSkuField.vue";
import TransferEditor from "@/components/inventory/TransferEditor.vue";
import TransferReceive from "@/components/inventory/TransferReceive.vue";
import TransfersPage, { page as definition } from "@/pages/inventory/TransfersPage.vue";
import { useSessionStore } from "@/stores/session.js";
const SKU = { skuId: 12, skuCode: "SKU-%_", skuName: "Widget", trackingPolicy: "none", baseUom: { uomId: 1, uomCode: "EA" } };
const mountField = () => mount(TransferSkuField, { props: { modelValue: { sku: null, lotId: null }, lineNumber: 1 }, global: { plugins: [Quasar] } });
const button = (wrapper, label) => wrapper.findAll("button").find(b => b.text() === label);
describe("TASK-029 exact-Code Draft selector", () => {
  beforeEach(() => { vi.clearAllMocks(); inventory.lookupSku.mockResolvedValue(SKU); inventory.listLots.mockResolvedValue({ rows: [], rowsNumber: 0 }); });
  it("requires explicit selection, uses Inventory lookup and displays only its safe profile", async () => {
    const wrapper = mountField();
    await wrapper.find("input").setValue("SKU-%_");
    await button(wrapper, "查找 SKU").trigger("click"); await flushPromises();
    expect(inventory.lookupSku).toHaveBeenCalledWith("SKU-%_");
    expect(wrapper.text()).toContain("Widget · EA · none");
    expect(wrapper.emitted("update:modelValue").at(-1)[0].sku).toBeNull();
    await button(wrapper, "選擇此 SKU").trigger("click"); await flushPromises();
    expect(wrapper.emitted("update:modelValue").at(-1)[0]).toEqual({ sku: SKU, lotId: null });
    expect(inventory.listLots).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it("ignores an older successful response after Code changes", async () => {
    let release;
    inventory.lookupSku.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce({ ...SKU, skuId: 13, skuCode: "NEW" });
    const wrapper = mountField();
    await wrapper.find("input").setValue("OLD"); await button(wrapper, "查找 SKU").trigger("click");
    expect(wrapper.text()).toContain("正在查找");
    await wrapper.find("input").setValue("NEW"); await button(wrapper, "查找 SKU").trigger("click"); await flushPromises();
    release({ ...SKU, skuCode: "OLD" }); await flushPromises();
    expect(wrapper.text()).toContain("NEW"); expect(wrapper.text()).not.toContain("OLD ·");
    await button(wrapper, "選擇此 SKU").trigger("click");
    expect(wrapper.emitted("update:modelValue").at(-1)[0].sku.skuId).toBe(13); wrapper.unmount();
  });
  it("clears selected SKU and Lot immediately on a Code edit", async () => {
    inventory.lookupSku.mockResolvedValue({ ...SKU, trackingPolicy: "batch" });
    const wrapper = mountField();
    await wrapper.find("input").setValue("SKU-%_"); await button(wrapper, "查找 SKU").trigger("click"); await flushPromises();
    await button(wrapper, "選擇此 SKU").trigger("click"); await flushPromises();
    await wrapper.setProps({ modelValue: { sku: { ...SKU, trackingPolicy: "batch" }, lotId: 9 } });
    await wrapper.find("input").setValue("OTHER");
    expect(wrapper.emitted("update:modelValue").at(-1)[0]).toEqual({ sku: null, lotId: null }); wrapper.unmount();
  });
  it("rejects invalid Code locally and presents lookup failure without ID fallback", async () => {
    const wrapper = mountField();
    for (const code of ["   ", "\u007f", "😀".repeat(191)]) {
      await wrapper.find("input").setValue(code); expect(button(wrapper, "查找 SKU").attributes("disabled")).toBeDefined();
    }
    expect(inventory.lookupSku).not.toHaveBeenCalled();
    inventory.lookupSku.mockRejectedValue(Object.assign(new Error("沒有找到 SKU"), { status: 404 }));
    await wrapper.find("input").setValue("UNKNOWN"); await button(wrapper, "查找 SKU").trigger("click"); await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain("沒有找到 SKU");
    expect(button(wrapper, "選擇此 SKU")).toBeUndefined(); expect(wrapper.find('input[type="number"]').exists()).toBe(false); wrapper.unmount();
  });
});

describe("TASK-029 Transfer page boundaries", () => {
  beforeEach(() => {
    setActivePinia(createPinia()); vi.clearAllMocks();
    inventory.listTransfers.mockResolvedValue({ rows: [], rowsNumber: 0 });
    inventory.getStockSummary.mockResolvedValue({ eligibleOnHand: 100, reserved: 8, atp: 92 });
    inventory.listWarehouses.mockResolvedValue({ rows: [], rowsNumber: 0 });
  });
  async function page(permissions, status = "IN_TRANSIT") {
    inventory.getTransfer.mockResolvedValue({ ...DETAIL, status, inTransitQuantity: 5, movements: [] });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: definition.path, component: TransfersPage, meta: { title: definition.title } }] });
    await router.push(`${definition.path}?id=7`); await router.isReady();
    useSessionStore().user = { id: 1, roles: [], permissions };
    const wrapper = mount(TransfersPage, { global: { plugins: [Quasar, router] }, attachTo: document.body }); await flushPromises(); return wrapper;
  }
  it("uses the existing Inventory menu and view-only read route without exposing writes", async () => {
    expect(definition.requires.permissions).toEqual(["inventory.view"]); expect(definition.menu.group).toBe("inventory");
    const wrapper = await page(["inventory.view"]);
    expect(wrapper.text()).toContain("來源已扣、目的未入");
    for (const label of ["新增調撥", "編輯草稿", "取消草稿", "準備整張收貨"]) expect(button(wrapper, label)).toBeUndefined();
    wrapper.unmount();
  });
  it("In Transit operators can Receive but never edit, cancel or dispatch", async () => {
    const wrapper = await page(["inventory.view", "inventory.operation"]);
    expect(button(wrapper, "準備整張收貨")).toBeDefined();
    for (const label of ["編輯草稿", "取消草稿", "準備整張出庫"]) expect(button(wrapper, label)).toBeUndefined(); wrapper.unmount();
  });
  it("starting a new Draft clears the old detail identity from URL state", async () => {
    const wrapper = await page(["inventory.view", "inventory.operation"], "DRAFT");
    try {
      await button(wrapper, "新增調撥").trigger("click"); await flushPromises();
      expect(wrapper.vm.$router.currentRoute.value.query.id).toBeUndefined();
      expect(wrapper.find('[aria-label="調撥詳情"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it("Dispatch displays source Reservation protection before sending a whole-document versioned command", async () => {
    inventory.dispatchTransfer.mockResolvedValue({ id: 7 });
    const wrapper = await page(["inventory.view", "inventory.operation"], "DRAFT");
    await button(wrapper, "準備整張出庫").trigger("click"); await flushPromises();
    expect(inventory.getStockSummary).toHaveBeenCalledWith({ skuId: 12, warehouseId: 1 });
    expect(document.body.textContent).toContain("Reserved 8"); expect(document.body.textContent).toContain("不支援部分");
    const submit = [...document.body.querySelectorAll("button")].find(b => b.textContent.trim() === "確認整張出庫"); submit.click(); await flushPromises();
    expect(inventory.dispatchTransfer).toHaveBeenCalledWith(7, expect.objectContaining({ version: 2 }));
    expect(inventory.dispatchTransfer.mock.calls[0][1]).not.toHaveProperty("lines"); wrapper.unmount();
  });
});

const DETAIL = { id: 7, number: "TR-7", status: "DRAFT", version: 2, sourceWarehouseId: 1, destinationWarehouseId: 2, reason: "",
  lines: [{ id: 4, version: 3, skuId: 12, skuCode: "SKU-%_", sourceBinId: 3, quantity: 5, dispatchStockStatus: "AVAILABLE", lotId: null }] };
describe("TASK-029 complete Draft and Receive forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inventory.listWarehouses.mockResolvedValue({ rows: [{ id: 1, code: "SOURCE" }, { id: 2, code: "DEST" }], rowsNumber: 2 });
    inventory.listBins.mockImplementation(async id => ({ rows: [{ id: id === 1 ? 3 : 9, code: "SAME" }], rowsNumber: 1 }));
  });
  const editor = async () => {
    const wrapper = mount(TransferEditor, { props: { detail: DETAIL }, global: { plugins: [Quasar] } });
    await flushPromises(); return wrapper;
  };
  it("requires explicit fresh SKU selection before saving retained lines and versions", async () => {
    const wrapper = await editor();
    expect(button(wrapper, "儲存草稿").attributes("disabled")).toBeDefined();
    wrapper.findComponent(TransferSkuField).vm.$emit("update:modelValue", { sku: SKU, lotId: null }); await flushPromises();
    await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(inventory.updateTransfer).toHaveBeenCalledWith(7, expect.objectContaining({ version: 2,
      lines: [{ id: 4, expectedVersion: 3, skuId: 12, lotId: null, sourceBinId: 3, stockStatus: "AVAILABLE", quantity: 5 }] }));
    wrapper.unmount();
  });
  it("keeps input and original versions after 409 without automatic repost", async () => {
    inventory.updateTransfer.mockRejectedValue(Object.assign(new Error("資料版本已變更"), { status: 409, code: "VERSION_CONFLICT" }));
    const wrapper = await editor();
    wrapper.findComponent(TransferSkuField).vm.$emit("update:modelValue", { sku: SKU, lotId: null }); await flushPromises();
    await wrapper.find('input[type="number"]').setValue("6");
    await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(wrapper.text()).toContain("輸入內容仍保留"); expect(wrapper.find('input[type="number"]').element.value).toBe("6");
    expect(inventory.updateTransfer).toHaveBeenCalledTimes(1); wrapper.unmount();
  });
  it("invalid quantity does not write and unsaved close requires confirmation", async () => {
    const wrapper = await editor();
    await wrapper.find('input[type="number"]').setValue("0");
    expect(button(wrapper, "儲存草稿").attributes("disabled")).toBeDefined();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await button(wrapper, "取消編輯").trigger("click"); expect(wrapper.emitted("close")).toBeUndefined();
    expect(confirm).toHaveBeenCalled(); confirm.mockReturnValue(true);
    await button(wrapper, "取消編輯").trigger("click"); expect(wrapper.emitted("close")).toHaveLength(1);
    expect(inventory.createTransfer).not.toHaveBeenCalled(); confirm.mockRestore(); wrapper.unmount();
  });
  it("receives every immutable quantity using destination-owned Bin IDs and quarantine reason", async () => {
    const wrapper = mount(TransferReceive, { props: { detail: { ...DETAIL, status: "IN_TRANSIT" } }, global: { plugins: [Quasar] } });
    await flushPromises();
    expect(inventory.listBins).toHaveBeenCalledWith(2, expect.objectContaining({ status: "ACTIVE" }));
    const selects = wrapper.findAllComponents({ name: "QSelect" });
    selects[0].vm.$emit("update:modelValue", 9); selects[1].vm.$emit("update:modelValue", "QUARANTINED"); await flushPromises();
    expect(button(wrapper, "整張收貨").attributes("disabled")).toBeDefined();
    await wrapper.find("textarea").setValue("檢查後待驗"); await flushPromises();
    await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(inventory.receiveTransfer).toHaveBeenCalledWith(7, expect.objectContaining({ version: 2, reason: "檢查後待驗",
      lines: [{ id: 4, quantity: 5, destinationBinId: 9, stockStatus: "QUARANTINED" }] }));
    expect(wrapper.find('input[type="number"]').exists()).toBe(false); wrapper.unmount();
  });
  it("guards status-only Receive changes on close and refresh, and removes its unload listener", async () => {
    const wrapper = mount(TransferReceive, { props: { detail: { ...DETAIL, status: "IN_TRANSIT" } }, global: { plugins: [Quasar] } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await flushPromises();
      const untouched = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(untouched);
      expect(untouched.defaultPrevented).toBe(false);
      wrapper.findAllComponents({ name: "QSelect" })[1].vm.$emit("update:modelValue", "QUARANTINED"); await flushPromises();
      await button(wrapper, "取消收貨").trigger("click");
      expect(wrapper.emitted("close")).toBeUndefined(); expect(confirm).toHaveBeenCalled();
      const refresh = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(refresh);
      expect(refresh.defaultPrevented).toBe(true);
    } finally { confirm.mockRestore(); wrapper.unmount(); }
    const afterClose = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(afterClose);
    expect(afterClose.defaultPrevented).toBe(false);
  });
});
