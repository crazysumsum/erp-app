import {flushPromises,mount} from "@vue/test-utils";
import {createPinia,setActivePinia} from "pinia";
import {Quasar} from "quasar";
import {h} from "vue";
import {RouterView,createMemoryHistory,createRouter} from "vue-router";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("@/services/sales.js",()=>({default:{getOrder:vi.fn(),confirmOrder:vi.fn(),getOperation:vi.fn(),lookupCustomers:vi.fn()}}));
import sales from "@/services/sales.js";
import Detail,{page} from "@/pages/sales/SalesOrderDetailPage.vue";
import {useSessionStore} from "@/stores/session.js";
const order={id:8,number:"SO-8",status:"DRAFT",sourceType:"MANUAL",version:3,customerId:2,customerCode:"C2",customerName:"客戶",fulfillmentWarehouseId:6,warehouseCode:"W6",warehouseName:"倉庫",currencyCode:"HKD",orderDate:"2026-10-07",totalAmount:"0.0000",lineCount:1,hasBackorder:false,lines:[{id:11,lineNo:1,skuId:3,skuCode:"S3",skuName:"貨品",uomCode:"EA",quantity:"2.000000",unitSellingPrice:"0.0000",orderedBaseQuantity:"2",reservedBaseQuantity:"0",backorderedBaseQuantity:"0",fulfilledBaseQuantity:"0",cancelledBaseQuantity:"0",lineAmount:"0.0000"}],allowedActions:["edit","confirm"],history:[],currentMaster:{customer:{customerCode:"C2",customerName:"目前客戶",status:"active"},skus:[]}};
let wrapper;
async function open(permissions=["sales.view","sales.mgmt"]){const router=createRouter({history:createMemoryHistory(),routes:[{...page,component:Detail}]});await router.push("/sales/orders/8");await router.isReady();useSessionStore().user={id:7,roles:[],permissions};wrapper=mount({render:()=>h(RouterView)},{global:{plugins:[Quasar,router]},attachTo:document.body});await flushPromises();return router;}
async function click(label){const button=[...document.querySelectorAll("button")].find(el=>el.textContent===label);expect(button).toBeTruthy();button.click();await flushPromises();}
beforeEach(()=>{setActivePinia(createPinia());vi.clearAllMocks();sessionStorage.clear();sales.getOrder.mockResolvedValue(order);sales.lookupCustomers.mockResolvedValue({items:[{customerId:2,credit:{configured:true,status:"normal",creditLimit:"1000.0000",currencyCode:"HKD"}}]});sales.confirmOrder.mockResolvedValue({outcome:"CONFIRMED",warnings:[],salesOrder:{...order,status:"CONFIRMED"}});sales.getOperation.mockResolvedValue({status:"IN_PROGRESS"});});
afterEach(()=>{wrapper?.unmount();wrapper=null;vi.restoreAllMocks();document.body.innerHTML="";});
it("TC-022 confirmation dialog shows Customer/Warehouse/lines/total and zero price/credit/master warnings",async()=>{
 await open();await click("確認訂單");expect(document.body.textContent).toContain("確認銷售訂單");expect(document.body.textContent).toContain("W6 — 倉庫");expect(document.body.textContent).toContain("明細：1 行");expect(document.body.textContent).toContain("HKD 0.0000");expect(document.body.textContent).toContain("零售價");expect(document.body.textContent).toContain("1000.0000");expect(document.body.textContent).toContain("主檔");expect(sales.confirmOrder).not.toHaveBeenCalled();
});
it("TC-022 hides confirm when server action or management permission is absent",async()=>{
 sales.getOrder.mockResolvedValue({...order,allowedActions:[]});await open();expect(wrapper.text()).not.toContain("確認訂單");wrapper.unmount();await open(["sales.view"]);expect(wrapper.text()).not.toContain("確認訂單");expect(sales.lookupCustomers).not.toHaveBeenCalled();
});
it("TC-024 live credit ON_HOLD blocks the UI submit and does not manufacture a valid credit profile",async()=>{
 sales.lookupCustomers.mockResolvedValue({items:[{customerId:2,credit:{status:"on_hold"}}]});await open();await click("確認訂單");const submit=[...document.querySelectorAll("button")].find(el=>el.textContent==="提交確認");expect(submit.disabled).toBe(true);expect(document.body.textContent).toContain("ON_HOLD");expect(sales.confirmOrder).not.toHaveBeenCalled();
});
it("TC-022 terminal200 refreshes exact quantities and shows partial Backorder without a second confirm",async()=>{
 sales.confirmOrder.mockImplementation(async()=>{sales.getOrder.mockResolvedValue({...order,status:"CONFIRMED",allowedActions:[],hasBackorder:true,backorderLineCount:1,lines:[{...order.lines[0],reservedBaseQuantity:"1",backorderedBaseQuantity:"1"}]});return {outcome:"CONFIRMED",warnings:["PARTIAL_BACKORDER"]};});await open();await click("確認訂單");await click("提交確認");expect(wrapper.text()).toContain("訂單已確認");expect(wrapper.text()).toContain("有 Backorder");expect(wrapper.text()).toContain("Reserved 1");expect(wrapper.text()).not.toContain("確認訂單");expect(sessionStorage.length).toBe(0);
});
it("TC-022 202 shows live pending status, hides duplicate confirm and preserves actor scoped identity",async()=>{
 sales.confirmOrder.mockResolvedValue({outcome:"CONFIRMING",retryAfterSeconds:2});await open();await click("確認訂單");await click("提交確認");expect(wrapper.find('[role="status"]').text()).toContain("確認結果仍在處理");expect(wrapper.text()).not.toContain("確認訂單");expect(sessionStorage.getItem("sales.confirm:7:8")).not.toBeNull();expect(sales.confirmOrder).toHaveBeenCalledTimes(1);
});
it("TC-024 failed terminal lookup reloads Draft and shows safe failure instead of successful confirmation",async()=>{
 sessionStorage.setItem("sales.confirm:7:8",JSON.stringify({eventId:"11111111-1111-4111-8111-111111111111",version:3}));sales.getOperation.mockResolvedValue({status:"FAILED",errorCode:"CUSTOMER_CREDIT_ON_HOLD"});await open();expect(wrapper.text()).toContain("確認未完成");expect(wrapper.text()).toContain("CUSTOMER_CREDIT_ON_HOLD");expect(wrapper.text()).not.toContain("訂單已確認");expect(sales.confirmOrder).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});

it("TC-022 snapshot404 while Draft is visible preserves intent and offers no abandonment or second confirm",async()=>{
 sessionStorage.setItem("sales.confirm:7:8",JSON.stringify({eventId:"11111111-1111-4111-8111-111111111111",version:3}));sales.getOperation.mockRejectedValue({status:404});await open();expect(wrapper.text()).not.toContain("放棄原操作");expect(wrapper.text()).not.toContain("確認訂單");expect(sessionStorage.getItem("sales.confirm:7:8")).not.toBeNull();expect(sales.confirmOrder).not.toHaveBeenCalled();
});
it("TC-022 definitive stale-version rejection reloads current Draft with safe failure and permits a new confirmation",async()=>{
 sales.confirmOrder.mockRejectedValue({status:409,code:"VERSION_CONFLICT"});await open();await click("確認訂單");await click("提交確認");expect(wrapper.text()).toContain("確認未完成：VERSION_CONFLICT");expect(wrapper.text()).toContain("確認訂單");expect(sessionStorage.length).toBe(0);
});
