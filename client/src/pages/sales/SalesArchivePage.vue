<script>
export const page={name:"sales-archive",path:"/sales/archive",title:"封存銷售訂單",requires:{permissions:["sales.view"]},menu:{group:"salesOrderManagement",icon:"archive",order:50}};
</script>
<script setup>
import {computed,onBeforeUnmount,reactive,ref,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import SalesExportButton from "@/components/sales/SalesExportButton.vue";
import {statusLabels,statusColors} from "@/components/sales/salesOrderPresentation.js";
import {useSessionStore} from "@/stores/session.js";
import sales from "@/services/sales.js";
const route=useRoute(),router=useRouter(),session=useSessionStore(),fields=reactive({number:"",externalOrderId:"",channelCode:"",customerId:"",orderDateFrom:"",orderDateTo:""}),errorRegion=ref(null);
const filters=computed(()=>Object.fromEntries(Object.entries(fields).filter(([,value])=>value!==""))),applied=computed(()=>Object.fromEntries(Object.keys(fields).filter(k=>route.query[k]!==undefined).map(k=>[k,route.query[k]])));
function validDate(value){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function isBounded(value){const {number,externalOrderId,customerId,orderDateFrom:from,orderDateTo:to}=value;if(Object.values(value).some(v=>typeof v!=="string"))return false;if(customerId&&(!/^[1-9]\d*$/u.test(customerId)||!Number.isSafeInteger(Number(customerId))))return false;if(Boolean(from)!==Boolean(to))return false;if(from&&(!validDate(from)||!validDate(to)||Date.parse(to)<Date.parse(from)||(Date.parse(to)-Date.parse(from))/86400000+1>366))return false;return Boolean(number?.trim()||externalOrderId||customerId||from);}
const bounded=computed(()=>isBounded(fields)),appliedBounded=computed(()=>isBounded(applied.value)),tableKey=computed(()=>JSON.stringify([session.user?.id,applied.value]));let controller,generation=0;
watch(tableKey,()=>{generation++;controller?.abort();controller=new AbortController();for(const key of Object.keys(fields))fields[key]=typeof route.query[key]==="string"?route.query[key]:"";},{immediate:true});onBeforeUnmount(()=>{generation++;controller?.abort();});
const columns=[{name:"number",label:"訂單編號",field:"number",sortable:true},{name:"customerName",label:"客戶快照",field:"customerName",sortable:true},{name:"orderDate",label:"訂單日期",field:"orderDate",sortable:true},{name:"status",label:"最終狀態",field:"status",sortable:true},{name:"totalAmount",label:"總額",field:"totalAmount",align:"right",sortable:true},{name:"archivedAt",label:"封存時間",field:"archivedAt"},{name:"actions",label:"操作",align:"right"}];
const pagination=()=>({page:Number.isSafeInteger(Number(route.query.page))&&Number(route.query.page)>0?Number(route.query.page):1,rowsPerPage:appConfig.defaultPageSize,rowsNumber:0,sortBy:columns.some(c=>c.sortable&&c.name===route.query.sortBy)?route.query.sortBy:"orderDate",descending:route.query.descending!=="false"});
async function fetchRows(params){const current=generation;controller?.abort();controller=new AbortController();const signal=controller.signal;const result=await sales.listArchivedOrders({...params,...applied.value,signal});if(signal.aborted||current!==generation)throw new DOMException("Aborted","AbortError");await router.replace({query:{...applied.value,page:String(params.page),sortBy:params.sortBy??"orderDate",descending:String(params.descending)}});return result;}
let focusedError;
function focusTableError(){const summary=errorRegion.value?.querySelector('[role="alert"]');if(summary&&summary!==focusedError){summary.tabIndex=-1;summary.focus();}focusedError=summary;}
function apply(){if(bounded.value)router.replace({query:{...filters.value,page:"1"}});}
function clear(){for(const key of Object.keys(fields))fields[key]="";router.replace({query:{}});}
function timestamp(value){return new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",dateStyle:"short",timeStyle:"short"}).format(new Date(value));}
</script>
<template><div><PageHeader title="封存銷售訂單" subtitle="歷史唯讀；查詢只讀取已完成封存的訂單快照。"><template #actions><q-btn flat label="Active 訂單" to="/sales/orders" /><q-btn flat label="我的匯出工作" to="/sales/exports" /></template></PageHeader>
 <div class="q-pa-md"><p>請指定精確訂單編號、精確 External ID、客戶 ID，或最多 366 天的完整日期範圍。</p><form @submit.prevent="apply"><div class="row q-col-gutter-md">
  <div class="col-12 col-md-4"><q-input v-model="fields.number" label="訂單編號（精確）" aria-label="訂單編號（精確）" maxlength="20" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="fields.externalOrderId" label="External Order ID（精確）" aria-label="External Order ID（精確）" maxlength="190" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="fields.channelCode" label="Channel Code（可選）" maxlength="50" outlined dense /></div>
  <div class="col-12 col-md-4"><q-input v-model="fields.customerId" label="客戶 ID" aria-label="客戶 ID" inputmode="numeric" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="fields.orderDateFrom" label="訂單日期由" aria-label="訂單日期由" type="date" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="fields.orderDateTo" label="訂單日期至" aria-label="訂單日期至" type="date" outlined dense /></div>
 </div><p v-if="!bounded" role="status">請提供有效的封存篩選；日期須成對且不超過 366 天。</p><div class="row q-gutter-sm q-mt-md"><q-btn type="submit" color="primary" label="搜尋" :disable="!bounded" /><q-btn flat label="清除篩選" @click="clear" /><SalesExportButton scope="ARCHIVE" :filters="filters" :disabled="!bounded" /></div></form>
 <div v-if="appliedBounded" ref="errorRegion" class="q-mt-md" aria-live="polite"><DataTable :key="tableKey" :fetch="fetchRows" @vue:updated="focusTableError" :columns="columns" sticky-actions :initial-pagination="pagination()">
  <template #body-cell-customerName="{row}"><EllipsisCell :text="`${row.customerCode} — ${row.customerName}`" /></template><template #body-cell-status="{row}"><q-td><q-badge :color="statusColors[row.status]" :label="statusLabels[row.status]" /></q-td></template><template #body-cell-totalAmount="{row}"><q-td class="text-right">{{ row.currencyCode }} {{ row.totalAmount }}</q-td></template><template #body-cell-archivedAt="{row}"><q-td>{{ timestamp(row.archivedAt) }}</q-td></template><template #body-cell-actions="{row}"><q-td class="text-right"><q-btn flat :label="`查看 ${row.number}`" :to="`/sales/archive/${row.id}`" /></q-td></template><template #no-data><p role="status">沒有符合條件的歷史訂單；請調整篩選。</p></template>
 </DataTable></div></div></div></template>
