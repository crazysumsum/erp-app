import {flushPromises,mount} from "@vue/test-utils";
import {createPinia,setActivePinia} from "pinia";
import {Quasar} from "quasar";
import {h} from "vue";
import {RouterView,createMemoryHistory,createRouter} from "vue-router";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("@/services/sales.js",()=>({default:{getImport:vi.fn(),listImportOrders:vi.fn(),listImports:vi.fn(),listImportErrors:vi.fn()}}));
import sales from "@/services/sales.js";
import Detail,{page as detailPage} from "@/pages/sales/SalesImportDetailPage.vue";
import Exceptions,{page as exceptionsPage} from "@/pages/sales/SalesImportExceptionsPage.vue";
import {useSessionStore} from "@/stores/session.js";
const job={id:8,batchNumber:"SI-202311-000008",status:"COMPLETED",version:2,filesPurgedAt:1,allowedActions:[]},row={id:3,sourceOrderKey:"synthetic-csv",firstRowNo:1,status:"SUCCEEDED",salesOrderId:9,salesOrderNumber:"SO-202311-000009",isArchived:true};let wrapper;
async function open(path){const router=createRouter({history:createMemoryHistory(),routes:[{...detailPage,component:Detail},{...exceptionsPage,component:Exceptions},{path:"/sales/archive/:id",component:{template:"<div>Archive</div>"}},{path:"/sales/orders/:id",component:{template:"<div>Active</div>"}}]});await router.push(path);await router.isReady();useSessionStore().user={id:1,permissions:["sales.view"],roles:[]};wrapper=mount({render:()=>h(RouterView)},{global:{plugins:[Quasar,router]},attachTo:document.body});await flushPromises();}
beforeEach(()=>{setActivePinia(createPinia());vi.clearAllMocks();sales.getImport.mockResolvedValue(job);sales.listImports.mockResolvedValue({rows:[job],rowsNumber:1});sales.listImportOrders.mockResolvedValue({rows:[row],rowsNumber:1});sales.listImportErrors.mockResolvedValue({rows:[],rowsNumber:0});});afterEach(()=>{wrapper?.unmount();wrapper=null;document.body.innerHTML="";});
for(const path of ["/sales/imports/8","/sales/imports/exceptions?jobId=8&status=SUCCEEDED"]){
 it(`TC-050 CSV ${path} links archived result to its historical target`,async()=>{await open(path);const target=wrapper.find('a[href="/sales/archive/9"]');expect(target.exists()).toBe(true);expect(target.text()).toContain("已封存");expect(wrapper.find('a[href="/sales/orders/9"]').exists()).toBe(false);});
 it(`TC-050 CSV ${path} preserves Active target routing`,async()=>{sales.listImportOrders.mockResolvedValue({rows:[{...row,isArchived:false}],rowsNumber:1});await open(path);expect(wrapper.find('a[href="/sales/orders/9"]').exists()).toBe(true);expect(wrapper.find('a[href="/sales/archive/9"]').exists()).toBe(false);});
 it(`TC-050 CSV ${path} never invents a link for missing target identity`,async()=>{sales.listImportOrders.mockResolvedValue({rows:[{...row,salesOrderId:null,salesOrderNumber:"",isArchived:false}],rowsNumber:1});await open(path);expect(wrapper.find('a[href="/sales/orders/null"]').exists()).toBe(false);expect(wrapper.find('a[href="/sales/archive/null"]').exists()).toBe(false);});
}
