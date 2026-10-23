import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QSelect, Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

vi.mock("@/services/supplierAudit.js", () => ({ default: { list: vi.fn() }, service: { name: "supplierAudit" } }));

import supplierAuditService from "@/services/supplierAudit.js";
import SupplierAuditPage, { page } from "@/pages/suppliers/SupplierAuditPage.vue";
import SupplierAuditTimeline, { SUPPLIER_AUDIT_ACTIONS, SUPPLIER_AUDIT_TARGET_TYPES } from "@/components/suppliers/SupplierAuditTimeline.vue";

// 香港時間要喺唔係香港嘅時區都啱：固定用 UTC 跑。
process.env.TZ = "UTC";

const ROWS = [
  { id: 2, occurredAt: Date.parse("2026-12-31T16:30:00Z"), actorUserId: 5, actorUsername: "clerk-a", action: "supplier.update",
    targetType: "supplier", targetId: 7, supplierId: 7, targetLabel: "SUP-007", reason: "",
    detail: { before: { supplierName: "Old Name", notes: "" }, after: { supplierName: "New Name", notes: { changed: true, length: 10, sha256: "a".repeat(64) } } },
    requestId: "6f1c2a9e-0d4b-4c1e-9f3a-2b7d5e8c1a00", ip: "127.0.0.1" },
  { id: 1, occurredAt: Date.parse("2026-10-01T02:00:00Z"), actorUserId: 6, actorUsername: "bank-officer", action: "supplier.bank.create",
    targetType: "bank", targetId: 3, supplierId: 7, targetLabel: "Bank A", reason: "新增收款帳戶",
    detail: { after: { maskedAccountNumber: "**** 1234", paymentTermId: null }, before: { paymentTermId: null } }, requestId: "req-bank", ip: "127.0.0.1" }
];

async function router(initial = page.path) {
  const instance = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: SupplierAuditPage, meta: { title: page.title } }] });
  await instance.push(initial);
  await instance.isReady();
  return instance;
}

async function mountPage(initial) {
  supplierAuditService.list.mockResolvedValue({ rows: ROWS, rowsNumber: 2 });
  const instance = await router(initial);
  const wrapper = mount(SupplierAuditPage, { global: { plugins: [Quasar, instance] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body), router: instance };
}

const field = (body, label) => body.findAll(".q-field").find((candidate) => candidate.text().startsWith(label)).find("input");
const settle = async () => { await new Promise((resolve) => { setTimeout(resolve, 350); }); await flushPromises(); };
async function choose(wrapper, label, value) {
  wrapper.findAllComponents(QSelect).find((select) => select.props("label") === label).vm.$emit("update:modelValue", value);
  await flushPromises();
}

describe("pages/suppliers/SupplierAuditPage.vue (DEF-035)", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("TC-121 (UI-001): is the 變更紀錄 entry of the Supplier menu and needs supplier.view", () => {
    expect(page.path).toBe("/suppliers/audit");
    expect(page.title).toBe("變更紀錄");
    expect(page.menu.group).toBe("suppliers");
    expect(page.requires.permissions).toEqual(["supplier.view"]);
  });

  it("lists actions, targets, before and after, reasons and full request IDs, in Hong Kong time", async () => {
    const { body } = await mountPage();
    expect(supplierAuditService.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
    const text = body.text();
    expect(text).toContain("編輯供應商");
    expect(text).toContain("供應商／SUP-007");
    expect(text).toContain("supplierName：Old Name → New Name");
    expect(text).toContain("6f1c2a9e-0d4b-4c1e-9f3a-2b7d5e8c1a00");
    expect(text).toContain("新增銀行帳戶");
    expect(text).toContain("銀行帳戶／Bank A");
    expect(text).toContain("maskedAccountNumber：（空） → **** 1234");
    expect(text).toContain("新增收款帳戶");
    // 2026-12-31T16:30Z 喺香港已經係 2027-01-01 00:30（ICU 喺日期同「上午」之間可能用窄不換行空格）。
    expect(text).toMatch(/1\/1\/2027\s*上午12:30/u);
  });

  it("shows a notes digest as its length, never the hash, and skips fields empty on both sides (REV-113 L-2)", async () => {
    const { body } = await mountPage();
    const text = body.text();
    expect(text).toContain("notes：已修改（10 字）");
    expect(text).not.toContain("a".repeat(64));
    expect(text).not.toContain("paymentTermId");
  });

  it("sends every filter: Hong Kong day bounds, trimmed actor and target, action and target type (REV-113 M-3)", async () => {
    const { body, wrapper } = await mountPage();
    await field(body, "由").setValue("2026-10-01");
    await field(body, "至").setValue("2026-10-02");
    await flushPromises();
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1, from: Date.parse("2026-09-30T16:00:00Z"), to: Date.parse("2026-10-02T15:59:59.999Z")
    }));
    await field(body, "操作者").setValue("  clerk-a ");
    await settle();
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ actor: "clerk-a" }));
    await field(body, "對象").setValue(" SUP-007 ");
    await settle();
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ target: "SUP-007" }));
    await choose(wrapper, "動作", "supplier.bank.reveal");
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ action: "supplier.bank.reveal" }));
    await choose(wrapper, "對象類型", "bank");
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ targetType: "bank" }));
  });

  it("keeps the filters and page in the URL and restores them on load (REV-113 M-2)", async () => {
    const { body, wrapper, router: instance } = await mountPage();
    await choose(wrapper, "動作", "supplier.bank.reveal");
    await field(body, "由").setValue("2026-10-01");
    await flushPromises();
    expect(instance.currentRoute.value.query).toMatchObject({ action: "supplier.bank.reveal", from: "2026-10-01", page: "1", pageSize: "20" });

    document.body.innerHTML = "";
    vi.clearAllMocks();
    await mountPage("/suppliers/audit?action=supplier.bank.reveal&targetType=bank&actor=clerk-a&from=2026-10-01&page=3&pageSize=10");
    expect(supplierAuditService.list).toHaveBeenCalledWith(expect.objectContaining({ action: "supplier.bank.reveal", targetType: "bank",
      actor: "clerk-a", from: Date.parse("2026-09-30T16:00:00Z"), page: 3, rowsPerPage: 10 }));
  });

  it("ignores filter values in the URL that the page would not offer", async () => {
    await mountPage("/suppliers/audit?action=drop.table&targetType=user&from=2026-02-31&page=0&pageSize=999");
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ action: null, targetType: null, from: undefined,
      page: 1, rowsPerPage: 20 }));
  });

  it("goes back to page 1 when a filter changes (REV-113 L-4)", async () => {
    const { wrapper } = await mountPage("/suppliers/audit?page=3&pageSize=10");
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    await choose(wrapper, "對象類型", "bank");
    expect(supplierAuditService.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, targetType: "bank" }));
  });

  it("does not query a half-typed year or a reversed range (REV-113 L-3)", async () => {
    const { body } = await mountPage();
    const calls = supplierAuditService.list.mock.calls.length;
    await field(body, "由").setValue("0002-10-01");
    await flushPromises();
    expect(supplierAuditService.list.mock.calls.length).toBe(calls);
    await field(body, "由").setValue("2026-10-05");
    await flushPromises();
    const valid = supplierAuditService.list.mock.calls.length;
    expect(valid).toBe(calls + 1);
    await field(body, "至").setValue("2026-10-01");
    await flushPromises();
    expect(body.text()).toContain("結束日期不可早於開始日期");
    expect(supplierAuditService.list.mock.calls.length).toBe(valid);
  });

  it("renders markup anywhere in a record as text, never as elements (REV-113 M-3)", async () => {
    supplierAuditService.list.mockResolvedValue({ rows: [{ ...ROWS[0], targetLabel: "<img src=x onerror=\"window.__xss = 1\">", reason: "<b>bold</b>",
      detail: { before: { supplierName: "<i>old</i>" }, after: { supplierName: "<img src=y onerror=\"window.__xss = 2\">" } } }], rowsNumber: 1 });
    const wrapper = mount(SupplierAuditPage, { global: { plugins: [Quasar, await router()] }, attachTo: document.body });
    await flushPromises();
    expect(wrapper.element.querySelector("img, b")).toBeNull();
    // Quasar 嘅 icon 都係 <i>：只要確認冇一個 <i> 係由資料嚟。
    expect([...wrapper.element.querySelectorAll("i")].some((element) => element.textContent === "old")).toBe(false);
    const text = new DOMWrapper(document.body).text();
    expect(text).toContain("<b>bold</b>");
    expect(text).toContain("supplierName：<i>old</i> → <img src=y");
  });
});

describe("components/suppliers/SupplierAuditTimeline.vue (detail Audit tab)", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });

  const mountTimeline = async (rows) => {
    supplierAuditService.list.mockResolvedValue({ rows, rowsNumber: rows.length });
    mount(SupplierAuditTimeline, { props: { supplierId: 7 }, global: { plugins: [Quasar] }, attachTo: document.body });
    await flushPromises();
    return new DOMWrapper(document.body).text();
  };

  it("asks only for the given Supplier's records", async () => {
    await mountTimeline(ROWS);
    expect(supplierAuditService.list).toHaveBeenCalledWith(expect.objectContaining({ supplierId: 7, page: 1 }));
  });

  it("lists the other detail keys a record carries, such as changes and metadata (REV-113 M-3)", async () => {
    const text = await mountTimeline([{ ...ROWS[1], action: "supplier.bank.update", detail: { after: { maskedAccountNumber: "**** 1234" },
      changes: { accountNumberChanged: false }, metadata: { source: "ui" } } }]);
    expect(text).toContain("changes：{\"accountNumberChanged\":false}");
    expect(text).toContain("metadata：{\"source\":\"ui\"}");
  });

  it("explains a list the server summarised as a count and a sample (REV-113 L-1)", async () => {
    const text = await mountTimeline([{ ...ROWS[0], detail: { changes: { count: 40, sample: ["a", "b", "c"], truncated: true } } }]);
    expect(text).toContain("changes：共 40 項，只列頭 3 項：[\"a\",\"b\",\"c\"]");
  });
});

describe("Supplier audit labels (REV-113 I-2)", () => {
  it("name every action and target type the Supplier server writes", () => {
    const server = path.resolve(__dirname, "../../../../server/src");
    const sources = [path.join(server, "modules/supplier"), path.join(server, "services/supplierImport")]
      .flatMap((directory) => fs.readdirSync(directory, { recursive: true }).map((name) => path.join(directory, String(name))))
      .filter((file) => file.endsWith(".js")).map((file) => fs.readFileSync(file, "utf8")).join("\n");
    const actions = new Set([...sources.matchAll(/action: "([a-z_.]+)"/gu)].map((match) => match[1]));
    const targetTypes = new Set([...sources.matchAll(/targetType: "([a-z_]+)"/gu)].map((match) => match[1]));
    expect(actions.size).toBeGreaterThanOrEqual(40);
    expect([...actions].filter((action) => !SUPPLIER_AUDIT_ACTIONS[action])).toEqual([]);
    expect([...targetTypes].filter((type) => !SUPPLIER_AUDIT_TARGET_TYPES[type])).toEqual([]);
  });
});
