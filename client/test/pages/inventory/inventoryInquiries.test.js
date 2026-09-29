import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/inventory.js", () => ({
  default: {
    listStockAggregates: vi.fn(), listStocks: vi.fn(), getStockSummary: vi.fn(),
    listLots: vi.fn(), listMovements: vi.fn(), getMovement: vi.fn()
  },
  service: { name: "inventory" }
}));

import inventoryService from "@/services/inventory.js";
import LotsPage, { page as lotsDefinition } from "@/pages/inventory/LotsPage.vue";
import MovementsPage, { page as movementsDefinition } from "@/pages/inventory/MovementsPage.vue";
import StocksPage, { page as stocksDefinition } from "@/pages/inventory/StocksPage.vue";

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

async function mountPage(component, definition, query = "") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: definition.path, component, meta: { title: definition.title } }]
  });
  await router.push(`${definition.path}${query}`);
  await router.isReady();
  const wrapper = mount(component, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router, body: new DOMWrapper(document.body) };
}

describe("TASK-017 Stock / Lot / Movement UI", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    inventoryService.listStockAggregates.mockResolvedValue({ rows: [SUMMARY], rowsNumber: 1 });
    inventoryService.listStocks.mockResolvedValue({ rows: [BUCKET], rowsNumber: 1 });
    inventoryService.getStockSummary.mockResolvedValue(SUMMARY);
    inventoryService.listLots.mockResolvedValue({ rows: [LOT], rowsNumber: 1 });
    inventoryService.listMovements.mockResolvedValue({ rows: [MOVEMENT], rowsNumber: 1 });
    inventoryService.getMovement.mockResolvedValue({
      movement: MOVEMENT, groupLegs: [MOVEMENT, { ...MOVEMENT, movementId: 22, direction: "OUT" }],
      reversal: { reversalOfMovementId: null, reversedByMovementId: 25 }
    });
  });

  it("registers all inquiry pages under inventory.view", () => {
    for (const definition of [stocksDefinition, lotsDefinition, movementsDefinition]) {
      expect(definition.requires).toEqual({ permissions: ["inventory.view"] });
      expect(definition.menu.group).toBe("inventory");
    }
  });

  it("restores Stock URL filters and drills from a complete SKU aggregate into buckets", async () => {
    const { wrapper, body } = await mountPage(
      StocksPage,
      stocksDefinition,
      "?page=2&sortBy=totalOnHand&descending=true&q=SKU-3&warehouseId=1&availability=ZERO_ATP"
    );
    expect(inventoryService.listStockAggregates).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, sortBy: "totalOnHand", descending: true, filter: "SKU-3", warehouseId: 1,
      availability: "ZERO_ATP", signal: expect.any(AbortSignal)
    }));
    expect(wrapper.text()).toContain("未覆蓋 4");

    await body.find('button[aria-label="查看 SKU-3 庫存明細"]').trigger("click");
    await flushPromises();
    expect(inventoryService.listStocks).toHaveBeenCalledWith(expect.objectContaining({ skuId: 3, warehouseId: 1 }));
    expect(wrapper.text()).toContain("SKU-3 Widget 的庫存 bucket");
    expect(wrapper.text()).toContain("已過期 2026-09-27");
  });

  it("aborts a stale Stock aggregate request when filters change", async () => {
    let finishFirst;
    const signals = [];
    inventoryService.listStockAggregates
      .mockImplementationOnce(({ signal }) => {
        signals.push(signal);
        return new Promise((resolve) => { finishFirst = resolve; });
      })
      .mockImplementation(({ signal }) => {
        signals.push(signal);
        return Promise.resolve({ rows: [SUMMARY], rowsNumber: 1 });
      });
    const { body } = await mountPage(StocksPage, stocksDefinition);
    await body.findAll(".q-field").find((field) => field.text().includes("倉庫 ID")).find("input").setValue("1");
    await flushPromises();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    finishFirst({ rows: [], rowsNumber: 0 });
  });

  it("shows Lot expiry state with icon text and keeps distinct quantities", async () => {
    const { wrapper } = await mountPage(LotsPage, lotsDefinition, "?expiryState=EXPIRED&warehouseId=1&page=2");
    expect(inventoryService.listLots).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, expiryState: "EXPIRED", warehouseId: 1, signal: expect.any(AbortSignal)
    }));
    expect(wrapper.text()).toContain("已過期（-1 日）");
    for (const label of ["總 On Hand", "Available On Hand", "Quarantined", "Damaged"]) {
      expect(wrapper.text()).toContain(label);
    }
  });

  it("opens Movement source, group legs and reversal links from restorable URL state", async () => {
    const { wrapper, body, router } = await mountPage(MovementsPage, movementsDefinition, "?sourceModule=RECEIVING&page=2");
    expect(inventoryService.listMovements).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, sourceModule: "RECEIVING", signal: expect.any(AbortSignal)
    }));
    await body.find('button[aria-label="查看 Movement 21"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("RECEIVING / GOODS_RECEIPT / GR-42 / 行 1 / 事件 posted-1");
    expect(wrapper.text()).toContain("同組 Movement legs");
    expect(wrapper.text()).toContain("沖銷 Movement 25");
    expect(router.currentRoute.value.query.movementId).toBe("21");
  });
});
