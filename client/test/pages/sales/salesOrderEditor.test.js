import { flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/sales.js",()=>({default:{getOrder:vi.fn(),createOrder:vi.fn(),updateOrder:vi.fn(),lookupSkus:vi.fn(),lookupCustomers:vi.fn(),lookupWarehouses:vi.fn()}}));
import sales from "@/services/sales.js";
import Form from "@/components/sales/SalesOrderForm.vue";
import CreatePage, {page as createPage} from "@/pages/sales/SalesOrderCreatePage.vue";
import EditPage, {page as editPage} from "@/pages/sales/SalesOrderEditPage.vue";
const order={id:8,number:"SO-202610-000008",version:2,status:"DRAFT",sourceType:"MANUAL",customerId:2,customerCode:"C2",customerName:"合成客戶",currencyCode:"HKD",paymentTermId:null,paymentTermName:"",fulfillmentWarehouseId:6,warehouseCode:"W6",warehouseName:"倉庫",orderDate:"2026-10-06",requestedDeliveryDate:null,customerPoReference:"",notes:"",totalAmount:"6.6666",allowedActions:["edit"],lines:[{id:11,skuId:3,skuUomId:5,skuCode:"SKU3",skuName:"貨品",uomCode:"EA",quantity:"2.000000",unitSellingPrice:"3.3333",lineNote:""}]};
let wrapper;
async function page(Component,definition,url){const router=createRouter({history:createMemoryHistory(),routes:[{path:definition.path,component:Component},{path:"/sales/orders/:id",component:{template:"<div>已儲存訂單詳情</div>"}}]});await router.push(url);await router.isReady();wrapper=mount({render:()=>h(RouterView)},{global:{plugins:[Quasar,router]},attachTo:window.document.body});await flushPromises();return router;}
afterEach(()=>{wrapper?.unmount();wrapper=null;vi.clearAllMocks();window.document.body.innerHTML="";});
describe("TC-019 Manual SO create/edit pages",()=>{
 it("requires both Sales view and management permissions for direct routes",()=>{expect(createPage.requires.permissions).toEqual(["sales.view","sales.mgmt"]);expect(editPage.requires.permissions).toEqual(["sales.view","sales.mgmt"]);});
 it("redirects creation to the persisted SO detail",async()=>{sales.createOrder.mockResolvedValue({salesOrder:order,warnings:[]});const router=await page(CreatePage,createPage,"/sales/orders/new");const form=wrapper.findComponent(Form);await form.props("onSave")({eventId:"intent"});form.vm.$emit("saved",{salesOrder:order});await flushPromises();expect(router.currentRoute.value.path).toBe("/sales/orders/8");expect(sales.createOrder).toHaveBeenCalledWith({eventId:"intent"});});
 it("blocks editing a server read-only record and retries load errors",async()=>{sales.getOrder.mockRejectedValueOnce(new Error("載入失敗")).mockResolvedValueOnce({...order,status:"CONFIRMED",allowedActions:[]});await page(EditPage,editPage,"/sales/orders/8/edit");expect(wrapper.text()).toContain("載入失敗");await wrapper.findAll("button").find(b=>b.text()==="重試").trigger("click");await flushPromises();expect(wrapper.find("form").exists()).toBe(false);expect(wrapper.text()).toContain("目前狀態或權限不允許此操作");});
 it("saves the loaded version then reloads the server result",async()=>{sales.getOrder.mockResolvedValueOnce(order).mockResolvedValueOnce({...order,version:3});sales.updateOrder.mockResolvedValue({salesOrder:{...order,version:3}});await page(EditPage,editPage,"/sales/orders/8/edit");await wrapper.find("form").trigger("submit");await flushPromises();expect(sales.updateOrder).toHaveBeenCalledWith(8,expect.objectContaining({version:2,lines:[{id:11,skuId:3,skuUomId:5,quantity:"2.000000",unitSellingPrice:"3.3333",lineNote:""}]}));expect(sales.getOrder).toHaveBeenCalledTimes(2);expect(wrapper.text()).toContain("最新版本 3");});
});
