import { flushPromises, mount } from "@vue/test-utils";
import { QSelect, Quasar } from "quasar";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/sales.js", () => ({ default: { lookupCustomers: vi.fn(), lookupSkus: vi.fn(), lookupWarehouses: vi.fn() } }));
import sales from "@/services/sales.js";
import Form from "@/components/sales/SalesOrderForm.vue";
export const order = { id: 8, number: "SO-202610-000008", version: 2, status: "DRAFT", source: "QUOTATION", sourceQuotationId: 19, customerId: 2, customerCode: "C2", customerName: "合成客戶", currencyCode: "HKD", paymentTermId: 4, paymentTermName: "30 天", fulfillmentWarehouseId: 6, warehouseCode: "W6", warehouseName: "倉庫", orderDate: "2026-10-06", requestedDeliveryDate: null, customerPoReference: "", notes: "", totalAmount: "6.6666", lines: [{ id: 11, skuId: 3, skuUomId: 5, skuCode: "SKU3", skuName: "合成貨品", uomCode: "EA", quantity: "2.000000", unitSellingPrice: "3.3333", orderedBase: "20000", reservedBase: "0", lineNote: "" }] };
const customer = { customerId: 2, customerCode: "C2", displayName: "合成客戶", defaultCurrencyCode: "HKD", defaultPaymentTermId: 4, credit: { status: "on_hold", creditLimit: "10000.0000", currencyCode: "HKD" } };
const sku = { skuId: 3, skuCode: "SKU3", skuName: "合成貨品", suggestedPrice: { amount: "3.3333", currency: "HKD" }, uoms: [{ skuUomId: 5, uomCode: "EA", uomName: "件", isDefaultSale: true }] };
let wrapper;
async function mountForm(props = {}) {
 const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/edit", component: { render: () => h(Form, props) } }, { path: "/other", component: { template: "<div>other</div>" } }] });
 await router.push("/edit");await router.isReady();wrapper=mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router] }, attachTo: window.document.body });await flushPromises();return { form: wrapper.findComponent(Form), router };
}
const input = label => wrapper.findAll(".q-field").find(field => field.text().includes(label)).find("input, textarea");
const select = label => wrapper.findAllComponents(QSelect).find(field => field.props("label") === label);
async function submit(){ await wrapper.find("form").trigger("submit"); await flushPromises(); }
beforeEach(() => { vi.clearAllMocks();sales.lookupCustomers.mockResolvedValue({items:[customer],total:1});sales.lookupSkus.mockResolvedValue({items:[sku],total:1});sales.lookupWarehouses.mockResolvedValue({items:[{id:6,code:"W6",name:"倉庫"}],total:1}); });
afterEach(() => { wrapper?.unmount();wrapper=null;vi.restoreAllMocks();window.document.body.innerHTML=""; });
describe("TC-019 Manual Draft SO form", () => {
 it("sends only editable strings and owned IDs, preserving server source and quantities", async () => {
  const save=vi.fn().mockResolvedValue({salesOrder:order});await mountForm({document:order,onSave:save});await submit();
  expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).toEqual({eventId:expect.any(String),version:2,customerId:2,currencyCode:"HKD",paymentTermId:4,fulfillmentWarehouseId:6,orderDate:"2026-10-06",requestedDeliveryDate:null,customerPoReference:"",notes:"",lines:[{id:11,skuId:3,skuUomId:5,quantity:"2.000000",unitSellingPrice:"3.3333",lineNote:""}]});
  expect(wrapper.text()).toContain("6.6666");expect(wrapper.text()).not.toMatch(/Shipping Address|Discount|Tax/);
 });
 it("takes Customer defaults, shows credit hold and clears prices on currency change", async () => {
  await mountForm({onSave:vi.fn()});select("客戶 *").vm.$emit("update:modelValue",customer);await flushPromises();expect(input("貨幣 *").element.value).toBe("HKD");expect(select("付款條款（選填）").props("modelValue")).toBe(4);expect(wrapper.text()).toContain("Draft 可儲存");
  select("搜尋 SKU").vm.$emit("update:modelValue",sku);await flushPromises();await wrapper.findAll("button").find(b=>b.text()==="新增明細").trigger("click");await flushPromises();expect(input("售價 1").element.value).toBe("3.3333");await input("貨幣 *").setValue("USD");await flushPromises();expect(input("售價 1").element.value).toBe("");expect(wrapper.text()).toContain("不自動換算");
 });
 it("retains immutable intent after uncertainty and blocks changes until retry", async () => {
  const save=vi.fn().mockRejectedValueOnce(Object.assign(new Error("逾時"),{code:"TIMEOUT"})).mockResolvedValue({salesOrder:order});await mountForm({document:order,onSave:save});await submit();expect(wrapper.text()).toContain("結果尚未確認");expect(input("數量 1").element.matches(":disabled")).toBe(true);await submit();expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
 });
 it("maps server line errors safely and retains edits after stale conflict", async () => {
  const save=vi.fn().mockRejectedValueOnce(Object.assign(new Error("售價無效"),{details:{field:"lines[0].unitSellingPrice"}})).mockRejectedValueOnce(Object.assign(new Error("版本已更改"),{code:"VERSION_CONFLICT",details:{currentVersion:3}}));const {form}=await mountForm({document:order,onSave:save});await submit();expect(wrapper.text()).toContain("售價無效");await input("備註").setValue("保留輸入");await submit();expect(wrapper.text()).toContain("你的輸入仍保留");expect(form.emitted("reload")).toBeUndefined();vi.spyOn(window,"confirm").mockReturnValue(true);await wrapper.findAll("button").find(b=>b.text()==="載入最新資料").trigger("click");expect(form.emitted("reload")).toHaveLength(1);expect(input("備註").element.value).toBe("保留輸入");
 });
 it("blocks zero quantity, excess precision and an invalid delivery date", async () => {
  const save=vi.fn();await mountForm({document:order,onSave:save});for(const value of ["0","1.0000001"]){await input("數量 1").setValue(value);await submit();expect(save).not.toHaveBeenCalled();}await input("數量 1").setValue("1");await input("要求送貨日期").setValue("2026-10-05");await submit();expect(save).not.toHaveBeenCalled();
 });
 it("guards dirty navigation, reused routes and browser refresh", async () => {
  const {router}=await mountForm({document:order,onSave:vi.fn()});await input("備註").setValue("未儲存");vi.spyOn(window,"confirm").mockReturnValue(false);await router.push("/other");expect(router.currentRoute.value.path).toBe("/edit");await router.push("/edit?other=1");expect(router.currentRoute.value.query).toEqual({});const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
 });
 it("clears a previously evaluated dirty guard after a successful save",async()=>{
  const save=vi.fn().mockResolvedValue({salesOrder:order});const {router}=await mountForm({document:order,onSave:save,onSaved:()=>router.push("/other")});await input("備註").setValue("changed");const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);await router.push("/other");expect(router.currentRoute.value.path).toBe("/edit");await submit();await flushPromises();expect(router.currentRoute.value.path).toBe("/other");expect(confirm).toHaveBeenCalledTimes(1);
 });
});
