import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/inventory.js", () => ({
  default: {
    listWarehouses: vi.fn(), getWarehouse: vi.fn(), createWarehouse: vi.fn(), updateWarehouse: vi.fn(),
    deactivateWarehouse: vi.fn(), reactivateWarehouse: vi.fn(), deleteWarehouse: vi.fn(),
    listBins: vi.fn(), getBin: vi.fn(), createBin: vi.fn(), updateBin: vi.fn(),
    deactivateBin: vi.fn(), reactivateBin: vi.fn(), deleteBin: vi.fn()
  },
  service: { name: "inventory" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({ promptPassword: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import inventoryService from "@/services/inventory.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import WarehousesPage, { page as pageDefinition } from "@/pages/inventory/WarehousesPage.vue";
import { useSessionStore } from "@/stores/session.js";

const WAREHOUSE = { id: 1, code: "MAIN", name: "主倉", address: "香港", description: "", status: "ACTIVE", version: 2, createdAt: 1, updatedAt: 1 };
const WAREHOUSE_DETAIL = {
  ...WAREHOUSE,
  binSummary: { total: 1, active: 1, inactive: 0 },
  blockers: { currentOnHand: 12, activeReservations: 2, activeAllocations: 1, openTransfers: 0, activeStocktakes: 0, activeBinLocks: 1 }
};
const BIN = { id: 3, warehouseId: 1, code: "A-01", name: "A 區 01", description: "", status: "ACTIVE", version: 4, createdAt: 1, updatedAt: 1, locked: true };
const BIN_DETAIL = { ...BIN, blockers: { currentOnHand: 12, activeAllocations: 1, openTransfers: 0, activeStocktakeLocks: 1 }, currentLock: { type: "STOCKTAKE", stocktakeId: 7, stocktakeNumber: "ST-7", lockedAt: 1 } };

async function mountPage(permissions = ["inventory.view", "inventory.mgmt"]) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: pageDefinition.path, component: WarehousesPage, meta: { title: pageDefinition.title, menuGroup: "inventory" } }] });
  await router.push(pageDefinition.path);
  await router.isReady();
  useSessionStore().user = { id: 1, username: "sam", permissions, roles: [] };
  const wrapper = mount(WarehousesPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("TASK-011 Warehouse / Bin 管理頁", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
    inventoryService.listWarehouses.mockResolvedValue({ rows: [WAREHOUSE], rowsNumber: 1 });
    inventoryService.getWarehouse.mockResolvedValue(WAREHOUSE_DETAIL);
    inventoryService.listBins.mockResolvedValue({ rows: [BIN], rowsNumber: 1 });
    inventoryService.getBin.mockResolvedValue(BIN_DETAIL);
  });

  it("掛在獨立 Inventory menu 並以 view permission 保護", () => {
    expect(pageDefinition).toMatchObject({
      path: "/inventory/warehouses",
      requires: { permissions: ["inventory.view"] },
      menu: { group: "inventory" }
    });
  });

  it("view-only 可選 Warehouse、查看 Bin 與 owner-safe blocker，但沒有管理動作", async () => {
    const { wrapper, body } = await mountPage(["inventory.view"]);
    expect(wrapper.text()).toContain("MAIN");
    await body.find('button[aria-label="查看倉庫 MAIN 的庫位"]').trigger("click");
    await flushPromises();
    expect(inventoryService.getWarehouse).toHaveBeenCalledWith(1);
    expect(inventoryService.listBins).toHaveBeenCalledWith(1, expect.objectContaining({ page: 1 }));
    expect(wrapper.text()).toContain("A-01");
    expect(wrapper.text()).toContain("現有庫存：12");
    expect(wrapper.text()).not.toContain("新增倉庫");
    expect(wrapper.text()).not.toContain("新增庫位");
  });

  it("409 保留編輯內容並提示重新核對", async () => {
    inventoryService.updateWarehouse.mockRejectedValue(Object.assign(new Error("資料版本衝突"), { code: "VERSION_CONFLICT" }));
    const { body } = await mountPage();
    await body.find('button[aria-label="編輯倉庫 MAIN"]').trigger("click");
    await flushPromises();
    const name = body.findAll(".q-field").find((field) => field.text().includes("倉庫名稱")).find("input");
    await name.setValue("新主倉名稱");
    await body.findAll("button").find((button) => button.text() === "儲存").trigger("click");
    await flushPromises();
    expect(body.text()).toContain("輸入內容仍保留");
    expect(name.element.value).toBe("新主倉名稱");
  });

  it("停用前顯示 blocker 摘要並以 password + reason + version 提交", async () => {
    promptPassword.mockResolvedValue({ password: "secret", reason: "倉庫已停止使用" });
    inventoryService.deactivateWarehouse.mockResolvedValue({ ...WAREHOUSE, status: "INACTIVE", version: 3 });
    const { body } = await mountPage();
    await body.find('button[aria-label="停用倉庫 MAIN"]').trigger("click");
    await flushPromises();
    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("現有庫存：12") }));
    expect(inventoryService.deactivateWarehouse).toHaveBeenCalledWith(1, {
      password: "secret", reason: "倉庫已停止使用", version: 2
    });
  });
});
