import {flushPromises,mount} from "@vue/test-utils";
import {createPinia,setActivePinia} from "pinia";
import {Quasar} from "quasar";
import {h} from "vue";
import {RouterView,createMemoryHistory,createRouter} from "vue-router";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("@/services/sales.js",()=>({default:{getQuotation:vi.fn(),lookupCustomers:vi.fn(),lookupSkus:vi.fn(),lookupWarehouses:vi.fn()}}));
import sales from "@/services/sales.js";
import Detail,{page as detailPage} from "@/pages/sales/SalesQuotationDetailPage.vue";
import Edit,{page as editPage} from "@/pages/sales/SalesQuotationEditPage.vue";
import Form from "@/components/sales/SalesQuotationForm.vue";
import {useSessionStore} from "@/stores/session.js";
const difference={added:[],removed:[],quantityChanged:[],priceChanged:[]},document={id:8,number:"QT-202311-000008",version:2,status:"CONVERTED",customerId:2,customerCode:"C2",customerName:"合成客戶",currencyCode:"HKD",quotationDate:"2023-11-14",validUntil:"2023-11-30",totalAmount:"1.0000",allowedActions:["print"],lines:[],conversion:{salesOrderId:9,salesOrderNumber:"SO-202311-000009",isArchived:true,differenceSummary:difference}};
let wrapper;async function open(path){const router=createRouter({history:createMemoryHistory(),routes:[{...detailPage,component:Detail},{...editPage,component:Edit}]});await router.push(path);await router.isReady();useSessionStore().user={id:1,permissions:["sales.view","sales.mgmt"],roles:[]};wrapper=mount({render:()=>h(RouterView)},{global:{plugins:[Quasar,router]},attachTo:window.document.body});await flushPromises();}
beforeEach(()=>{setActivePinia(createPinia());vi.clearAllMocks();sales.getQuotation.mockResolvedValue(document);for(const name of ["lookupCustomers","lookupSkus","lookupWarehouses"])sales[name].mockResolvedValue({items:[],total:0});});afterEach(()=>{wrapper?.unmount();wrapper=null;window.document.body.innerHTML="";});
it("TC-050 archived Quotation conversion links only to Archive",async()=>{await open("/sales/quotations/8");expect(wrapper.find('a[href="/sales/archive/9"]').exists()).toBe(true);expect(wrapper.find('a[href="/sales/orders/9"]').exists()).toBe(false);expect(wrapper.text()).toContain("歷史唯讀");});
it("TC-050 Active Quotation conversion keeps its Active target",async()=>{sales.getQuotation.mockResolvedValue({...document,conversion:{...document.conversion,isArchived:false}});await open("/sales/quotations/8");expect(wrapper.find('a[href="/sales/orders/9"]').exists()).toBe(true);expect(wrapper.text()).not.toContain("歷史唯讀");});
it("TC-050 conversion result replay shows terminal Archive status and target",async()=>{sales.getQuotation.mockResolvedValue({...document,status:"ISSUED",allowedActions:["convert"],conversion:null});await open("/sales/quotations/8/edit?convert=1");wrapper.findComponent(Form).vm.$emit("saved",{salesOrder:{id:9,number:"SO-202311-000009",status:"CANCELLED",version:3,isArchived:true},differenceSummary:difference});await flushPromises();expect(wrapper.find('a[href="/sales/archive/9"]').exists()).toBe(true);expect(wrapper.text()).toContain("歷史唯讀");expect(wrapper.text()).not.toContain("狀態：Draft");});
