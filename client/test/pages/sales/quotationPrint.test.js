import { flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { h } from "vue";
import { createMemoryHistory,createRouter,RouterView } from "vue-router";
import { afterEach,describe,expect,it,vi } from "vitest";
vi.mock("@/services/sales.js",()=>({default:{getQuotation:vi.fn()}}));
import sales from "@/services/sales.js";
import Print,{page} from "@/pages/sales/SalesQuotationPrintPage.vue";
let wrapper;
async function open(doc){sales.getQuotation.mockResolvedValue(doc);const router=createRouter({history:createMemoryHistory(),routes:[{...page,component:Print}]});await router.push("/sales/quotations/8/print");await router.isReady();wrapper=mount({render:()=>h(RouterView)},{global:{plugins:[Quasar,router]}});await flushPromises();}
afterEach(()=>{wrapper?.unmount();vi.restoreAllMocks();});
describe("TC-019 protected browser print",()=>{
 it("renders every protected line as semantic print rows and escapes user text",async()=>{const lines=Array.from({length:25},(_,i)=>({id:i+1,lineNo:i+1,skuCode:`SKU${i}`,skuName:"合成貨品",quantity:"2.000000",uomCode:"EA",unitSellingPrice:"3.3333",lineAmount:"6.6666"}));await open({number:"QT-202610-000008",allowedActions:["print"],customerCode:"C2",customerName:"客戶",currencyCode:"HKD",quotationDate:"2026-10-06",validUntil:"2026-10-30",totalAmount:"166.6650",lines,notes:"<script>alert(1)</script>"});expect(page.requires.permissions).toEqual(["sales.view"]);expect(wrapper.findAll("tbody tr")).toHaveLength(25);expect(wrapper.find("script").exists()).toBe(false);expect(wrapper.text()).toContain("<script>alert(1)</script>");expect(wrapper.text()).toContain("166.6650");expect(wrapper.text()).not.toContain("已保留庫存");const print=vi.spyOn(window,"print").mockImplementation(()=>{});await wrapper.findAll("button").find(b=>b.text()==="列印 A4").trigger("click");expect(print).toHaveBeenCalledTimes(1);});
 it("never offers print when the server action is absent",async()=>{await open({number:"QT-202610-000008",allowedActions:[],lines:[]});expect(wrapper.find("table").exists()).toBe(false);expect(wrapper.text()).toContain("目前狀態不允許列印");});
});
