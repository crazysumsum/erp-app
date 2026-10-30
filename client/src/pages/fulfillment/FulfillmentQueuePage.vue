<script>
export const page={name:"fulfillment-queue",path:"/fulfillment/queue",title:"履約工作佇列",requires:{permissions:["fulfillment.view"]},menu:{group:"fulfillment",icon:"playlist_add_check",order:10}};
</script>
<script setup>
import {computed,reactive,ref,toRaw,watch} from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import {can} from "@/framework/authorization/can.js";
import {useSessionStore} from "@/stores/session.js";
import fulfillment,{fulfillmentFailure} from "@/services/fulfillment.js";
import {useFulfillmentPage} from "@/components/fulfillment/useFulfillmentPage.js";
import {statusLabels,statusColors} from "@/components/fulfillment/fulfillmentPresentation.js";
import FulfillmentCreatePanel from "@/components/fulfillment/FulfillmentCreatePanel.vue";
import {isDefinitiveCreateRejection} from "@/components/fulfillment/fulfillmentCreateRejection.js";
const {route,data,loading,error,load,apply,next,first}=useFulfillmentPage("queue"),session=useSessionStore(),selected=ref(null),notice=ref(""),pending=ref(null),rejectedDraft=ref(null),journalUnreadable=ref(false),recoveryError=ref(""),recovering=ref(false),writing=ref(false);
const filters=reactive({q:"",customerId:"",warehouseId:"",salesOrderStatus:null,hasBackorder:null,hasActiveWork:null,requestedDateFrom:"",requestedDateTo:"",sortBy:"requestedDeliveryDate",descending:false,pageSize:20});
watch(()=>route.fullPath,()=>{for(const key of Object.keys(filters))filters[key]=route.query[key]??({sortBy:"requestedDeliveryDate",descending:false,pageSize:20}[key]??null);if(["true","false"].includes(filters.descending))filters.descending=filters.descending==="true";filters.pageSize=Number(filters.pageSize);},{immediate:true});
const operate=computed(()=>can(session,{permissions:["fulfillment.operation"]})),key=()=>`fulfillment.create:${session.user?.id}`;
function restore(){pending.value=null;rejectedDraft.value=null;journalUnreadable.value=false;recoveryError.value="";try{const value=sessionStorage.getItem(key());if(value){const body=JSON.parse(value);if(!body||!Array.isArray(body.lines)||!body.lines.length||!Number.isSafeInteger(body.salesOrderId)||!Number.isSafeInteger(body.salesOrderVersion)||typeof body.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.eventId))throw new Error();pending.value=body;}}catch{journalUnreadable.value=true;recoveryError.value="無法讀取已保存的原操作，請保留此頁並聯絡管理員";}}
restore();watch(()=>`${session.user?.id}:${session.permissions.join('|')}`,()=>{selected.value=null;restore();load();});
async function save(input){if(!operate.value)throw {status:403,code:"FULFILLMENT_PERMISSION_DENIED"};const actor=session.user.id,storageKey=key(),wasPending=!!pending.value,body=structuredClone(toRaw(pending.value??input));writing.value=true;
 try{sessionStorage.setItem(storageKey,JSON.stringify(body));pending.value=body;const result=await fulfillment.createFulfillment(body),outcome=result?.outcome;if(!outcome||outcome.status!=="DRAFT"||outcome.version!==1||!/^[1-9][0-9]{0,15}$/u.test(outcome.id)||String(result.fulfillment?.id)!==String(outcome.id)||String(result.fulfillment?.salesOrderId)!==String(body.salesOrderId)||String(result.salesOrder?.id)!==String(body.salesOrderId))throw {status:503,code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"};sessionStorage.removeItem(storageKey);if(session.user?.id!==actor)throw {status:403,code:"PERMISSION_STALE"};pending.value=null;return result;}
 catch(e){if(session.user?.id===actor&&isDefinitiveCreateRejection(e,wasPending)){sessionStorage.removeItem(storageKey);pending.value=null;rejectedDraft.value=body;}throw e;}finally{writing.value=false;}
}
async function saved(result){selected.value=null;rejectedDraft.value=null;notice.value=`已建立履約工作 ${result.outcome.number}`;await load();}
async function recover(){recovering.value=true;recoveryError.value="";try{await saved(await save(pending.value));}catch(e){recoveryError.value=fulfillmentFailure(e).message;}finally{recovering.value=false;}}
async function reloadSource(){const id=selected.value?.id;await load();const current=data.value.items.find(row=>row.id===id);if(current)selected.value=current;else recoveryError.value="目前來源不在此篩選結果，輸入仍保留；請關閉視窗後調整篩選再查詢";}
const columns=[{name:"number",label:"SO",field:"salesOrderNumber",align:"left"},{name:"customer",label:"客戶",field:row=>`${row.customerCode} — ${row.customerName}`,align:"left"},{name:"warehouse",label:"倉庫",field:row=>`${row.warehouseCode} — ${row.warehouseName}`,align:"left"},{name:"date",label:"訂單日期",field:"orderDate"},{name:"requested",label:"要求送貨日期",field:row=>row.requestedDeliveryDate??"未設定"},{name:"status",label:"狀態",field:"salesOrderStatus"},{name:"summary",label:"數量／工作",field:"id",align:"left"},{name:"actions",label:"操作",field:"id",align:"right"}];
</script>
<template><div><PageHeader subtitle="按 SO 建立履約工作；建立工作不會再次預留或扣減庫存。"><template #actions><q-btn flat label="履約工作列表" to="/fulfillments" /></template></PageHeader>
 <section aria-label="履約工作內容" class="q-px-md q-pb-md" :aria-busy="loading">
  <q-banner v-if="notice" role="status" class="q-mb-md">{{ notice }}</q-banner>
  <q-banner v-if="pending" role="status" class="bg-warning text-dark q-mb-md">建立結果尚未確認；請先恢復原操作，勿重新建立。<template #action><q-btn flat label="恢復原建立操作" :disable="!operate||writing" :loading="recovering" @click="recover" /></template></q-banner>
  <q-banner v-if="recoveryError" role="alert" class="bg-warning text-dark q-mb-md">{{ recoveryError }}<template #action><q-btn v-if="!pending&&!journalUnreadable" flat label="重新載入來源" @click="reloadSource" /></template></q-banner>
  <div class="row q-col-gutter-md"><div class="col-12 col-md-4"><q-input v-model="filters.q" label="SO 編號／客戶代碼" aria-label="SO 編號／客戶代碼" maxlength="190" outlined dense @keyup.enter="apply(filters)" /></div>
   <div class="col-6 col-md-2"><q-input v-model="filters.customerId" label="客戶 ID" inputmode="numeric" outlined dense /></div><div class="col-6 col-md-2"><q-input v-model="filters.warehouseId" label="倉庫 ID" inputmode="numeric" outlined dense /></div>
   <div class="col-12 col-md-4"><q-select v-model="filters.salesOrderStatus" label="SO 狀態" :options="['CONFIRMED','PARTIALLY_FULFILLED'].map(value=>({value,label:statusLabels[value]}))" emit-value map-options clearable outlined dense /></div>
   <div class="col-6 col-md-3"><q-input v-model="filters.requestedDateFrom" type="date" label="要求送貨日期由" outlined dense /></div><div class="col-6 col-md-3"><q-input v-model="filters.requestedDateTo" type="date" label="要求送貨日期至" outlined dense /></div>
   <div class="col-6 col-md-3"><q-select v-model="filters.hasBackorder" label="Backorder" :options="[{value:'true',label:'有 Backorder'},{value:'false',label:'沒有 Backorder'}]" emit-value map-options clearable outlined dense /></div><div class="col-6 col-md-3"><q-select v-model="filters.hasActiveWork" label="已有進行中工作" :options="[{value:'true',label:'有'},{value:'false',label:'沒有'}]" emit-value map-options clearable outlined dense /></div>
   <div class="col-6 col-md-4"><q-select v-model="filters.sortBy" label="排序" :options="[{value:'requestedDeliveryDate',label:'要求送貨日期'},{value:'orderDate',label:'訂單日期'},{value:'salesOrderNumber',label:'SO 編號'}]" emit-value map-options outlined dense /></div><div class="col-6 col-md-3"><q-select v-model="filters.descending" label="排序方向" :options="[{value:false,label:'升序'},{value:true,label:'降序'}]" emit-value map-options outlined dense /></div><div class="col-6 col-md-2"><q-select v-model="filters.pageSize" label="每頁筆數" :options="[20,50,100]" outlined dense /></div>
  </div><div class="row q-gutter-sm q-my-md"><q-btn color="primary" label="搜尋" @click="apply(filters)" /><q-btn flat label="清除篩選" @click="apply({})" /></div>
  <q-banner v-if="error" role="alert" class="bg-warning text-dark q-mb-md">{{ error }}<template #action><q-btn flat label="重新載入" @click="load" /></template></q-banner>
  <DataTable :key="route.fullPath" :rows="data.items" :columns="columns" :loading="loading" sticky-actions :initial-pagination="{page:1,rowsPerPage:100}">
   <template #body-cell-status="{row}"><q-td><q-badge :color="statusColors[row.salesOrderStatus]" :label="statusLabels[row.salesOrderStatus]" /></q-td></template>
   <template #body-cell-summary="{row}"><q-td><q-expansion-item :label="`查看 ${row.lines.length} 行數量`"><div v-for="line in row.lines" :key="line.id" class="q-pa-sm">{{ line.skuCode }}：Ordered {{ line.orderedBaseQuantity }}／Reserved {{ line.reservedOutstandingBaseQuantity }}／Backorder {{ line.backorderedBaseQuantity }}／Fulfilled {{ line.fulfilledBaseQuantity }}／已計劃 {{ line.activeClaimedBaseQuantity }}／可履約 {{ line.fulfillableBaseQuantity }}</div></q-expansion-item><span>{{ row.hasActiveWork?'有進行中工作':'沒有進行中工作' }}</span></q-td></template>
   <template #body-cell-actions="{row}"><q-td><q-btn v-if="operate" flat label="建立履約工作" :aria-label="`建立履約工作：${row.salesOrderNumber}`" :disable="loading||!!pending||journalUnreadable" @click="selected=row" /><span v-else>僅供查詢</span></q-td></template>
   <template #no-data><p v-if="!error" role="status">{{ Object.keys(route.query).length?'沒有符合篩選條件的可履約訂單':'目前沒有可履約訂單' }}</p></template>
   <template #bottom><div class="row items-center q-gutter-sm q-pa-sm"><span>第 {{ data.page }} 頁・本頁 {{ data.items.length }} 筆</span><q-btn v-if="data.page>1" flat label="返回第一頁" :disable="loading" @click="first" /><q-btn flat label="下一頁" :disable="loading||!data.hasMore" @click="next" /></div></template>
  </DataTable>
 </section><q-dialog :model-value="!!selected" persistent @update:model-value="value=>{if(!value)selected=null}"><q-card style="width: 1200px; max-width: 96vw"><q-card-section><FulfillmentCreatePanel v-if="selected" :source="selected" :on-save="save" :draft="rejectedDraft" :uncertain="!!pending" @saved="saved" @reload="reloadSource" /></q-card-section><q-card-actions align="right"><q-btn flat label="關閉建立視窗" @click="selected=null" /></q-card-actions></q-card></q-dialog>
</div></template>
