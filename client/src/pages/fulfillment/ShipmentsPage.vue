<script>
export const page={name:"shipments",path:"/shipments",title:"出貨單列表",requires:{permissions:["fulfillment.view"]},menu:{group:"fulfillment",icon:"local_shipping",order:30}};
</script>
<script setup>
import {computed,onBeforeUnmount,reactive,ref,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import shipment,{normalizeShipmentQuery,shipmentFailure} from "@/services/shipment.js";
import {timestamp} from "@/components/fulfillment/fulfillmentPresentation.js";
import {useSessionStore} from "@/stores/session.js";
const route=useRoute(),router=useRouter(),session=useSessionStore(),data=ref({items:[],total:0,page:1,hasMore:false}),loading=ref(false),error=ref(""),filters=reactive({});let controller;
const labels={DRAFT:"草稿",SHIPPING:"出貨處理中",SHIPPED:"已出貨",CANCELLED:"已取消",REVERSING:"沖銷處理中",REVERSED:"已沖銷"};
const views=[
 {name:"all",label:"所有出貨",statuses:Object.keys(labels)},
 {name:"active",label:"進行中",statuses:["DRAFT","SHIPPING","REVERSING"]},
 {name:"finalized",label:"已結束",statuses:["SHIPPED","CANCELLED","REVERSED"]}
];
const view=computed(()=>route.query.view??"all");
const statusOptions=computed(()=>(views.find(group=>group.name===view.value)?.statuses??[]).map(value=>({value,label:labels[value]})));
const columns=[{name:"number",label:"出貨單",field:"number",align:"left"},{name:"order",label:"SO",field:row=>row.salesOrder.number,align:"left"},{name:"customer",label:"客戶",field:row=>`${row.customer.code} — ${row.customer.name}`,align:"left"},{name:"warehouse",label:"倉庫",field:row=>row.warehouse.code,align:"left"},{name:"status",label:"狀態",field:row=>labels[row.status],align:"left"},{name:"carrier",label:"物流商",field:"carrierName",align:"left"},{name:"tracking",label:"追蹤號碼",field:"trackingNumber",align:"left"},{name:"date",label:"出貨日期",field:row=>row.shipmentDate??"—",align:"left"},{name:"updated",label:"更新（香港時間）",field:row=>timestamp(row.lastBusinessUpdatedAt),align:"left"},{name:"actions",label:"操作",field:"id",align:"right"}];
function normalizeView(name,statuses){
 const group=views.find(item=>item.name===name);
 if(!group||statuses?.some(status=>!group.statuses.includes(status)))throw new TypeError("出貨視圖與狀態不符");
 return statuses??(name==="all"?undefined:group.statuses);
}
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";data.value={items:[],total:0,page:1,hasMore:false};
 try{
  const {view:name="all",...input}=route.query,query=normalizeShipmentQuery(input);
  const status=normalizeView(name,query.status);
  Object.assign(filters,{q:"",salesOrderId:"",customerId:"",warehouseId:"",carrier:"",trackingNumber:"",shipmentDateFrom:"",shipmentDateTo:"",...query,status:query.status??[]});
  const value=await shipment.listShipments({...query,status,signal});
  if(!signal.aborted)data.value=value;
 }catch(cause){
  if(!signal.aborted){
   const failure=shipmentFailure(cause);
   error.value=cause instanceof TypeError?"篩選條件不正確，請清除後重新搜尋。":failure.action==="recover"?"暫時無法載入出貨單，請重新載入。":failure.message;
  }
 }finally{if(!signal.aborted)loading.value=false;}
}
function apply(values,name=view.value){
 try{
  const query=normalizeShipmentQuery({...values,status:Array.isArray(values.status)&&!values.status.length?undefined:values.status});
  normalizeView(name,query.status);
  return router.push({query:{...query,view:name==="all"?undefined:name,descending:String(query.descending)}});
 }catch{error.value="請檢查識別碼、日期範圍及篩選條件。";}
}
function selectView(name){return apply({...filters,status:null,page:1},name);}
function clearFilters(){return apply({},views.some(item=>item.name===view.value)?view.value:"all");}
function goToPage(page){return router.push({query:{...route.query,page}});}
watch([()=>route.fullPath,()=>session.user?.id,()=>session.permissions.join('|')],load,{immediate:true});onBeforeUnmount(()=>controller?.abort());
</script>
<template><div><PageHeader subtitle="出貨與沖銷狀態以目前後端資料為準。"><template #actions><q-btn flat label="履約工作列表" to="/fulfillments" /></template></PageHeader><section aria-label="出貨單列表內容" :aria-busy="loading" class="q-px-md q-pb-md">
 <q-tabs :model-value="view" align="left" aria-label="出貨視圖" class="q-mb-md" @update:model-value="selectView"><q-tab v-for="item in views" :key="item.name" :name="item.name" :label="item.label" /></q-tabs>
 <div class="row q-col-gutter-md"><div class="col-12 col-md-4"><q-input v-model="filters.q" label="出貨單／銷售訂單編號（精確）" maxlength="190" outlined dense @keyup.enter="apply({...filters,page:1})" /></div><div v-for="[key,label] in [['salesOrderId','銷售訂單 ID'],['customerId','客戶 ID'],['warehouseId','倉庫 ID']]" :key="key" class="col-6 col-md-2"><q-input v-model="filters[key]" :label="label" inputmode="numeric" outlined dense /></div><div class="col-6 col-md-2"><q-select v-model="filters.status" label="出貨狀態" :options="statusOptions" multiple emit-value map-options clearable outlined dense /></div>
 <div v-for="[key,label] in [['carrier','物流商（精確）'],['trackingNumber','追蹤號碼（精確）']]" :key="key" class="col-12 col-md-3"><q-input v-model="filters[key]" :label="label" maxlength="190" outlined dense /></div><div v-for="[key,label] in [['shipmentDateFrom','出貨日期由'],['shipmentDateTo','出貨日期至']]" :key="key" class="col-6 col-md-3"><q-input v-model="filters[key]" :label="label" type="date" outlined dense /></div>
 <div class="col-6 col-md-5"><q-select v-model="filters.sortBy" label="排序" :options="[{value:'lastBusinessUpdatedAt',label:'最後業務更新'},{value:'createdAt',label:'建立時間'},{value:'shippedAt',label:'出貨時間'},{value:'shipmentDate',label:'出貨日期'},{value:'shipmentNumber',label:'出貨單編號'},{value:'id',label:'出貨單 ID'}]" emit-value map-options outlined dense /></div><div class="col-6 col-md-4"><q-select v-model="filters.descending" label="排序方向" :options="[{value:false,label:'升序'},{value:true,label:'降序'}]" emit-value map-options outlined dense /></div><div class="col-6 col-md-3"><q-select v-model="filters.pageSize" label="每頁筆數" :options="[20,50,100]" outlined dense /></div></div>
 <div class="row q-gutter-sm q-my-md"><q-btn color="primary" label="搜尋" @click="apply({...filters,page:1})" /><q-btn flat label="清除篩選" @click="clearFilters" /><q-btn flat label="重新載入" :loading="loading" @click="load" /></div><q-banner v-if="error" role="alert" class="bg-warning text-dark q-mb-md">{{ error }}</q-banner>
 <DataTable :key="route.fullPath" :rows="data.items" :columns="columns" :loading="loading" sticky-actions :initial-pagination="{page:1,rowsPerPage:100}"><template #body-cell-actions="{row}"><q-td><q-btn flat :label="`查看 ${row.number}`" :to="{path:`/shipments/${row.id}`,query:route.query}" /></q-td></template><template #no-data><p v-if="!error" role="status">沒有符合條件的出貨單，請調整篩選。</p></template><template #bottom><div class="row items-center q-gutter-sm q-pa-sm"><span>第 {{ data.page }} 頁，共 {{ data.total }} 筆</span><q-btn flat label="上一頁" :disable="loading||data.page<=1" @click="goToPage(data.page-1)" /><q-btn flat label="下一頁" :disable="loading||!data.hasMore" @click="goToPage(data.page+1)" /></div></template></DataTable>
</section></div></template>
