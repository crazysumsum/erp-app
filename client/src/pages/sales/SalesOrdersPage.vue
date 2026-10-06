<script>
export const page={name:"sales-orders",path:"/sales/orders",title:"銷售訂單",requires:{permissions:["sales.view"]},menu:{group:"salesOrderManagement",icon:"receipt_long",order:20}};
</script>
<script setup>
import { computed,onBeforeUnmount,reactive,ref,watch } from "vue";
import { useRoute,useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { statusLabels,statusColors,sourceLabels } from "@/components/sales/salesOrderPresentation.js";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import sales from "@/services/sales.js";
const route=useRoute(),router=useRouter(),session=useSessionStore(),manage=computed(()=>can(session,{permissions:["sales.mgmt"]}));
const filters=reactive({q:"",number:"",status:null,sourceType:null,channelCode:"",externalOrderId:"",customerId:null,warehouseId:null,hasBackorder:null,orderDateFrom:"",orderDateTo:""}),rows=ref([]);
const statusOptions=Object.entries(statusLabels).map(([value,label])=>({value,label})),sourceOptions=Object.entries(sourceLabels).map(([value,label])=>({value,label}));
const customers=computed(()=>[...new Map(rows.value.map(row=>[String(row.customerId),{value:String(row.customerId),label:`${row.customerCode} — ${row.customerName}`}])).values()]);
const warehouses=computed(()=>[...new Map(rows.value.map(row=>[String(row.fulfillmentWarehouseId),{value:String(row.fulfillmentWarehouseId),label:`${row.warehouseCode} — ${row.warehouseName}`}])).values()]);
const filterQuery=computed(()=>Object.fromEntries(Object.entries(route.query).filter(([key,value])=>key in filters&&value!==""))),tableKey=computed(()=>JSON.stringify(filterQuery.value));
watch(tableKey,()=>{for(const key of Object.keys(filters))filters[key]=route.query[key]??(["status","sourceType","customerId","warehouseId","hasBackorder"].includes(key)?null:"");},{immediate:true});
const columns=[{name:"number",label:"訂單編號",field:"number",align:"left",sortable:true},{name:"customerName",label:"客戶",field:"customerName",align:"left",sortable:true},
 {name:"sourceType",label:"來源",field:"sourceType",sortable:true},{name:"orderDate",label:"訂單日期",field:"orderDate",sortable:true},{name:"warehouseName",label:"倉庫",field:"warehouseName",align:"left"},{name:"status",label:"狀態",field:"status",sortable:true},
 {name:"totalAmount",label:"總額",field:"totalAmount",align:"right",sortable:true},{name:"hasBackorder",label:"Backorder",field:"hasBackorder"},{name:"updatedAt",label:"更新時間",field:"updatedAt",sortable:true},{name:"actions",label:"操作",align:"right"}];
const controller=new AbortController();onBeforeUnmount(()=>controller.abort());
const pagination=()=>({page:Number.isSafeInteger(Number(route.query.page))&&Number(route.query.page)>0?Number(route.query.page):1,rowsPerPage:appConfig.defaultPageSize,rowsNumber:0,sortBy:columns.some(c=>c.name===route.query.sortBy&&c.sortable)?route.query.sortBy:"orderDate",descending:route.query.descending!=="false"});
async function fetchRows(params){const key=tableKey.value,query={...filterQuery.value},result=await sales.listOrders({...params,...query,filter:query.q??"",signal:controller.signal});
 if(key===tableKey.value&&!controller.signal.aborted){rows.value=result.rows;await router.replace({query:{...query,page:String(params.page),sortBy:params.sortBy??"orderDate",descending:String(params.descending)}});}return result;}
function apply(){router.replace({query:Object.fromEntries(Object.entries(filters).filter(([,value])=>value!==null&&value!==""))});}
function reset(){router.replace({query:{}});}
function acceptId(value,done){if(/^[1-9]\d*$/u.test(value)&&Number.isSafeInteger(Number(value)))done(value,"add-unique");}
function timestamp(value){return new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",dateStyle:"short",timeStyle:"short"}).format(new Date(value));}
</script>
<template><div><PageHeader subtitle="Active 訂單；查詢不會自動搜尋 Archive。"><template #actions><q-btn v-if="manage" color="primary" label="新增銷售訂單" to="/sales/orders/new" /></template></PageHeader>
 <div class="q-px-md q-pb-md"><div class="row q-col-gutter-md">
  <div class="col-12 col-md-4"><q-input v-model="filters.q" label="客戶代碼／名稱／PO" aria-label="客戶代碼／名稱／PO" maxlength="190" outlined dense @keyup.enter="apply" /></div>
  <div class="col-12 col-md-4"><q-input v-model="filters.number" label="訂單編號（精確）" aria-label="訂單編號（精確）" maxlength="20" outlined dense @keyup.enter="apply" /></div>
  <div class="col-12 col-md-2"><q-select v-model="filters.status" label="狀態" :options="statusOptions" clearable emit-value map-options outlined dense /></div>
  <div class="col-12 col-md-2"><q-select v-model="filters.sourceType" label="來源" :options="sourceOptions" clearable emit-value map-options outlined dense /></div>
  <div class="col-12 col-md-3"><q-input v-model="filters.channelCode" label="Channel Code" maxlength="50" outlined dense /></div>
  <div class="col-12 col-md-3"><q-input v-model="filters.externalOrderId" label="External Order ID（精確）" maxlength="190" outlined dense /></div>
  <div class="col-12 col-md-3"><q-select v-model="filters.customerId" label="客戶 ID" aria-label="客戶 ID" :options="customers" hint="輸入正整數 ID 後按 Enter，或選擇目前頁的客戶" use-input clearable emit-value map-options outlined dense @new-value="acceptId" /></div>
  <div class="col-12 col-md-3"><q-select v-model="filters.warehouseId" label="倉庫 ID" aria-label="倉庫 ID" :options="warehouses" hint="輸入正整數 ID 後按 Enter，或選擇目前頁的倉庫" use-input clearable emit-value map-options outlined dense @new-value="acceptId" /></div>
  <div class="col-12 col-md-3"><q-select v-model="filters.hasBackorder" label="Backorder" :options="[{value:'true',label:'有 Backorder'},{value:'false',label:'沒有 Backorder'}]" clearable emit-value map-options outlined dense /></div>
  <div class="col-12 col-md-3"><q-input v-model="filters.orderDateFrom" label="訂單日期由" type="date" outlined dense /></div><div class="col-12 col-md-3"><q-input v-model="filters.orderDateTo" label="訂單日期至" type="date" outlined dense /></div>
 </div><div class="row q-gutter-sm q-mt-md"><q-btn label="搜尋" color="primary" @click="apply" /><q-btn flat label="清除篩選" @click="reset" /></div></div>
 <div class="q-px-md q-pb-md" aria-live="polite"><DataTable :key="tableKey" :fetch="fetchRows" :columns="columns" sticky-actions :initial-pagination="pagination()">
  <template #body-cell-customerName="{row}"><EllipsisCell :text="`${row.customerCode} — ${row.customerName}`" /></template>
  <template #body-cell-warehouseName="{row}"><EllipsisCell :text="`${row.warehouseCode} — ${row.warehouseName}`" /></template>
  <template #body-cell-sourceType="{row}"><q-td>{{ sourceLabels[row.sourceType] }}</q-td></template>
  <template #body-cell-status="{row}"><q-td><q-badge :color="statusColors[row.status]" :label="statusLabels[row.status]" /></q-td></template>
  <template #body-cell-totalAmount="{row}"><q-td class="text-right">{{ row.currencyCode }} {{ row.totalAmount }}</q-td></template>
  <template #body-cell-hasBackorder="{row}"><q-td><q-badge v-if="row.hasBackorder" color="warning" text-color="dark" :label="`有 Backorder（${row.backorderLineCount} 行）`" /><span v-else>沒有</span></q-td></template>
  <template #body-cell-updatedAt="{row}"><q-td>{{ timestamp(row.updatedAt) }}</q-td></template>
  <template #body-cell-actions="{row}"><q-td class="text-right"><q-btn flat :label="`查看 ${row.number}`" :to="`/sales/orders/${row.id}`" /></q-td></template>
  <template #no-data><p role="status">沒有符合條件的 Active 銷售訂單；請調整搜尋條件。Archive 查詢將由後續階段提供。</p></template>
 </DataTable></div></div></template>
