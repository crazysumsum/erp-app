import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/inventory.js", () => ({ default: { listMovements: vi.fn(), getMovement: vi.fn() } }));
import inventory from "@/services/inventory.js";
import MovementsPage, { page } from "@/pages/inventory/MovementsPage.vue";
import { useSessionStore } from "@/stores/session.js";
const movement = (id = 21, type = "RECEIPT") => ({
  movementId: id, groupId: "group-1", operationId: 31, movementType: type, locationKind: "BIN",
  warehouse: { warehouseId: 1, code: "WH-A" }, bin: { binId: 2, code: "A-01" },
  sku: { skuId: 3, code: "SKU-3", name: "Widget" }, lot: null, stockStatus: "AVAILABLE",
  direction: "IN", quantity: 8, balanceBefore: 2, balanceAfter: 10, balanceVersionAfter: 5,
  postedAt: 1_700_000_000_000, postedBy: { userId: 7, label: "Sam" },
  source: { module: "RECEIVING", documentType: "GOODS_RECEIPT", documentId: `GR-${id}`, lineId: "1", eventId: "posted-1" }
});
const detail = (id = 21, type = "RECEIPT", reversal = {}) => ({ movement: movement(id, type),
  groupLegs: [movement(21, type), { ...movement(22, type), direction: "OUT" }],
  reversal: { reversalOfMovementId: null, reversedByMovementId: null, ...reversal } });
const wrappers = [];
async function open(permissions = ["inventory.view", "inventory.adjust"], query = "") {
  const pinia = createPinia(), session = useSessionStore(pinia);
  session.user = { id: 7, permissions, roles: [] };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: page.path, component: MovementsPage, meta: { title: page.title } },
    ...["stocks", "lots", "adjustments"].map(name => ({ path: `/inventory/${name}`, component: { template: "<div />" } }))
  ] });
  await router.push(page.path + query); await router.isReady();
  const wrapper = mount(MovementsPage, { global: { plugins: [Quasar, router, pinia] }, attachTo: document.body });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body), session, router };
}
const click = async (body, id = 21) => { await body.find(`button[aria-label="查看 Movement ${id}"]`).trigger("click"); await flushPromises(); };
describe("TASK033 Movement high-risk entry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    inventory.listMovements.mockResolvedValue({ rows: [movement(21), movement(22)], rowsNumber: 2 });
    inventory.getMovement.mockImplementation(async id => detail(id));
  });
  afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; });
  it("UI033-AUTH keeps history view-only and hides write actions for read-only and operation/FEFO actors", async () => {
    expect(page.requires).toEqual({ permissions: ["inventory.view"] });
    const { wrapper, body } = await open(["inventory.view", "inventory.operation", "inventory.fefo.override"]);
    await click(body);
    expect(wrapper.text()).toContain("GR-21");
    expect(wrapper.find('[aria-label="整組沖銷 Movement 21"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="庫存調整"]').exists()).toBe(false);
  });
  it("UI033-AUTH exposes exact local entry only with view+adjust and removes it on permission loss", async () => {
    const { wrapper, body, session } = await open(); await click(body);
    expect(wrapper.find('[aria-label="庫存調整"]').attributes("href")).toBe("/inventory/adjustments?action=IN");
    expect(wrapper.find('[aria-label="整組沖銷 Movement 21"]').attributes("href")).toBe("/inventory/adjustments?action=REVERSAL&movementId=21");
    session.user.permissions = ["inventory.adjust"]; await flushPromises();
    expect(wrapper.find('[aria-label="整組沖銷 Movement 21"]').exists()).toBe(false);
  });
  it("UI033-RECONCILE shows the full original group and bidirectional reversal links without write entry on reversed legs", async () => {
    inventory.getMovement.mockResolvedValue(detail(21, "RECEIPT", { reversedByMovementId: 25 }));
    const { wrapper, body } = await open(); await click(body);
    expect(wrapper.text()).toContain("沖銷 Movement 25");
    expect(wrapper.text()).toContain("同組 Movement legs");
    expect(wrapper.find('[aria-label="整組沖銷 Movement 21"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="查看同組 Movement 22"]').exists()).toBe(true);
  });
  it("UI033-RECONCILE allows only whole BIN groups of the five reversible types", async () => {
    const { wrapper, body } = await open();
    for (const type of ["RECEIPT", "ISSUE", "BIN_MOVE", "STATUS_TRANSFER", "ADJUSTMENT"]) {
      inventory.getMovement.mockResolvedValue(detail(21, type)); await click(body);
      expect(wrapper.find('[aria-label="整組沖銷 Movement 21"]').exists()).toBe(true);
    }
    for (const type of ["TRANSFER_DISPATCH", "TRANSFER_RECEIVE", "STOCKTAKE", "OPENING", "REVERSAL"]) {
      inventory.getMovement.mockResolvedValue(detail(21, type)); await click(body);
      expect(wrapper.find('[aria-label="整組沖銷 Movement 21"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("此異動組不提供沖銷入口");
    }
    const mixed = detail(); mixed.groupLegs[1].locationKind = "IN_TRANSIT";
    inventory.getMovement.mockResolvedValue(mixed); await click(body);
    expect(wrapper.find('[aria-label="整組沖銷 Movement 21"]').exists()).toBe(false);
  });
  it("UI033-UI-REGRESSION ignores late detail success after a newer selection", async () => {
    let finish;
    inventory.getMovement.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(detail(22));
    const { wrapper, body } = await open(); await click(body, 21); await click(body, 22);
    finish(detail(21)); await flushPromises();
    const selected = wrapper.find('section[aria-labelledby="movement-detail-heading"]');
    expect(selected.text()).toContain("GR-22"); expect(selected.text()).not.toContain("GR-21 / 行");
    expect(wrapper.find('[aria-label="整組沖銷 Movement 22"]').exists()).toBe(true);
  });
  it("UI033-UI-REGRESSION ignores late detail failure after newer success and rejects wrong server identity", async () => {
    let reject;
    inventory.getMovement.mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail; })).mockResolvedValueOnce(detail(22));
    const { wrapper, body } = await open(); await click(body, 21); await click(body, 22);
    reject(new Error("old response")); await flushPromises();
    expect(wrapper.text()).not.toContain("old response");
    inventory.getMovement.mockResolvedValue(detail(22)); await click(body, 21);
    expect(wrapper.text()).toContain("異動詳情與選取項目不一致");
    expect(wrapper.find('[aria-label="整組沖銷 Movement 21"]').exists()).toBe(false);
  });
  it("UI033-UI-REGRESSION closes a pending detail without letting it reopen or show stale errors", async () => {
    let finish;
    inventory.getMovement.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { wrapper, body } = await open(); await click(body);
    await body.find('button[aria-label="關閉 Movement 詳情"]').trigger("click");
    finish(detail()); await flushPromises();
    expect(wrapper.find("#movement-detail-heading").exists()).toBe(false);
  });
});
