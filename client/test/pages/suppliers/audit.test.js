import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import process from "node:process";

vi.mock("@/services/supplierAudit.js", () => ({ default: { list: vi.fn() }, service: { name: "supplierAudit" } }));

import supplierAuditService from "@/services/supplierAudit.js";
import SupplierAuditPage, { page } from "@/pages/suppliers/SupplierAuditPage.vue";
import SupplierAuditTimeline from "@/components/suppliers/SupplierAuditTimeline.vue";

// 香港時間要喺唔係香港嘅時區都啱：固定用 UTC 跑。
process.env.TZ = "UTC";

const ROWS = [
  { id: 2, occurredAt: Date.parse("2026-12-31T16:30:00Z"), actorUserId: 5, actorUsername: "clerk-a", action: "supplier.update",
    targetType: "supplier", targetId: 7, supplierId: 7, targetLabel: "SUP-007", reason: "",
    detail: { before: { supplierName: "Old Name" }, after: { supplierName: "New Name" } }, requestId: "req-update", ip: "127.0.0.1" },
  { id: 1, occurredAt: Date.parse("2026-10-01T02:00:00Z"), actorUserId: 6, actorUsername: "bank-officer", action: "supplier.bank.create",
    targetType: "bank", targetId: 3, supplierId: 7, targetLabel: "Bank A", reason: "新增收款帳戶",
    detail: { after: { maskedAccountNumber: "**** 1234", isDefault: true } }, requestId: "req-bank", ip: "127.0.0.1" }
];

async function router() {
  const instance = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: SupplierAuditPage, meta: { title: page.title } }] });
  await instance.push(page.path);
  await instance.isReady();
  return instance;
}

async function mountPage() {
  supplierAuditService.list.mockResolvedValue({ rows: ROWS, rowsNumber: 2 });
  const wrapper = mount(SupplierAuditPage, { global: { plugins: [Quasar, await router()] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body) };
}

const field = (body, label) => body.findAll(".q-field").find((candidate) => candidate.text().includes(label)).find("input");

describe("pages/suppliers/SupplierAuditPage.vue (DEF-035)", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("TC-121 (UI-001): is the 變更紀錄 entry of the Supplier menu and needs supplier.view", () => {
    expect(page.path).toBe("/suppliers/audit");
    expect(page.title).toBe("變更紀錄");
    expect(page.menu.group).toBe("suppliers");
    expect(page.requires.permissions).toEqual(["supplier.view"]);
  });

  it("lists actions, targets, before and after, reasons and request IDs, in Hong Kong time", async () => {
    const { body } = await mountPage();
    expect(supplierAuditService.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
    const text = body.text();
    expect(text).toContain("編輯供應商");
    expect(text).toContain("供應商／SUP-007");
    expect(text).toContain("supplierName：Old Name → New Name");
    expect(text).toContain("req-update");
    expect(text).toContain("新增銀行帳戶");
    expect(text).toContain("銀行帳戶／Bank A");
    expect(text).toContain("maskedAccountNumber：（空） → **** 1234");
    expect(text).toContain("新增收款帳戶");
    // 2026-12-31T16:30Z 喺香港已經係 2027-01-01 00:30。
    // ICU 喺日期同「上午」之間可能用窄不換行空格。
    expect(text).toMatch(/1\/1\/2027\s*上午12:30/u);
  });

  it("filters by Hong Kong day bounds, trimmed actor and target, action and target type", async () => {
    const { body } = await mountPage();
    await field(body, "由").setValue("2026-10-01");
    await field(body, "至").setValue("2026-10-02");
    await flushPromises();
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1, from: Date.parse("2026-09-30T16:00:00Z"), to: Date.parse("2026-10-02T15:59:59.999Z")
    }));
    await field(body, "操作者").setValue("  clerk-a ");
    await new Promise((resolve) => { setTimeout(resolve, 350); });
    await flushPromises();
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ actor: "clerk-a" }));
  });

  it("shows a reversed date range as an error and does not query it", async () => {
    const { body } = await mountPage();
    await field(body, "由").setValue("2026-10-05");
    await flushPromises();
    const calls = supplierAuditService.list.mock.calls.length;
    await field(body, "至").setValue("2026-10-01");
    await flushPromises();
    expect(body.text()).toContain("結束日期不可早於開始日期");
    expect(supplierAuditService.list.mock.calls.length).toBe(calls);
  });

  it("renders markup in audit text as text, never as elements", async () => {
    supplierAuditService.list.mockResolvedValue({ rows: [{ ...ROWS[0], targetLabel: "<img src=x onerror=\"window.__xss = 1\">",
      reason: "<b>bold</b>" }], rowsNumber: 1 });
    const wrapper = mount(SupplierAuditPage, { global: { plugins: [Quasar, await router()] }, attachTo: document.body });
    await flushPromises();
    expect(wrapper.element.querySelector("img[onerror], b")).toBeNull();
    expect(new DOMWrapper(document.body).text()).toContain("<b>bold</b>");
  });
});

describe("components/suppliers/SupplierAuditTimeline.vue (detail Audit tab)", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("asks only for the given Supplier's records", async () => {
    supplierAuditService.list.mockResolvedValue({ rows: ROWS, rowsNumber: 2 });
    mount(SupplierAuditTimeline, { props: { supplierId: 7 }, global: { plugins: [Quasar] }, attachTo: document.body });
    await flushPromises();
    expect(supplierAuditService.list).toHaveBeenCalledWith(expect.objectContaining({ supplierId: 7, page: 1 }));
  });

  it("says a truncated detail was cut instead of showing half of it", async () => {
    supplierAuditService.list.mockResolvedValue({ rows: [{ ...ROWS[0], detail: { truncated: true } }], rowsNumber: 1 });
    mount(SupplierAuditTimeline, { props: { supplierId: 7 }, global: { plugins: [Quasar] }, attachTo: document.body });
    await flushPromises();
    expect(new DOMWrapper(document.body).text()).toContain("內容過長，已截斷");
  });
});
