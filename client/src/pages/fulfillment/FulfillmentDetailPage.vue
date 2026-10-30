<script>
export const page={name:"fulfillment-detail",path:"/fulfillments/:id",title:"履約單詳情",requires:{permissions:["fulfillment.view"]}};
</script>
<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from "vue";
import {useRoute} from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import FulfillmentQuantitySummary from "@/components/fulfillment/FulfillmentQuantitySummary.vue";
import PickConfirmationPanel from "@/components/fulfillment/PickConfirmationPanel.vue";
import FulfillmentAllocationPanel from "@/components/fulfillment/FulfillmentAllocationPanel.vue";
import FulfillmentCancelPanel from "@/components/fulfillment/FulfillmentCancelPanel.vue";
import {statusLabels,statusColors,timestamp} from "@/components/fulfillment/fulfillmentPresentation.js";
import fulfillment,{fulfillmentDocumentId,fulfillmentFailure} from "@/services/fulfillment.js";
import {useSessionStore} from "@/stores/session.js";
const route=useRoute(),session=useSessionStore(),data=ref(null),loading=ref(false),error=ref(""),summary=ref(null),tab=ref("lines"),query=ref({});let controller;
const document=computed(()=>data.value?.fulfillment),allocationStatus={ACTIVE:"有效",PARTIALLY_RELEASED:"部分釋放",RELEASED:"已釋放",CONSUMED:"已使用"};
const allocationColumns=[{name:"id",label:"分配 ID",field:"id",align:"left"},{name:"line",label:"履約行 ID",field:"fulfillmentLineId",align:"left"},{name:"bin",label:"庫位",field:"binCode",align:"left"},{name:"lot",label:"批次",field:"lotNumber",align:"left"},{name:"expiry",label:"到期日",field:row=>row.expiryDate??"無到期日",align:"left"},{name:"status",label:"狀態",field:row=>allocationStatus[row.status],align:"left"},...[["allocatedBaseQuantity","原分配"],["releasedBaseQuantity","已釋放"],["pickedBaseQuantity","已揀"]].map(([field,label])=>({name:field,label,field,align:"right"}))];
const historyColumns=[{name:"sequence",label:"順序",field:"sequence",align:"left"},{name:"action",label:"操作",field:"action",align:"left"},{name:"from",label:"原狀態",field:row=>statusLabels[row.fromStatus]??"建立",align:"left"},{name:"to",label:"結果狀態",field:row=>statusLabels[row.toStatus],align:"left"},{name:"version",label:"結果版本",field:"versionAfter",align:"right"},{name:"reason",label:"原因",field:"reason",align:"left"},{name:"actor",label:"操作人",field:"actorLabel",align:"left"},{name:"time",label:"時間",field:row=>timestamp(row.occurredAt),align:"left"}];
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";data.value=null;
 try{const id=fulfillmentDocumentId(route.params.id),value=await fulfillment.getFulfillment(id,{...query.value,signal});if(!signal.aborted)data.value=value;}
 catch(e){if(!signal.aborted)error.value=e instanceof TypeError?"履約單識別碼不正確，請返回列表重新選取":fulfillmentFailure(e).message;}
 finally{if(!signal.aborted){loading.value=false;if(error.value){await nextTick();summary.value?.focus();}}}
}
function first(){query.value={};return load();}
function childPage(key,value){const next={...query.value};if(value===null)delete next[key];else next[key]=value;query.value=next;return load();}
watch([()=>route.params.id,()=>session.user?.id,()=>session.permissions.join('|')],()=>{tab.value="lines";first();},{immediate:true});onBeforeUnmount(()=>controller?.abort());
</script>
<template><div><PageHeader :title="document?`履約單 ${document.number}`:undefined" subtitle="數量、狀態及可用操作以目前後端資料為準。"><template #actions><q-btn flat label="返回工作列表" to="/fulfillments" /><q-btn v-if="document?.allowedActions.includes('printPickList')" flat label="揀貨單列印" :to="`/fulfillments/${document.id}/pick-list/print`" /></template></PageHeader>
 <section aria-label="履約單內容" :aria-busy="loading" class="q-px-md q-pb-md"><q-skeleton v-if="loading" type="rect" height="160px" aria-label="載入履約單" /><div v-else-if="error" ref="summary" role="alert" tabindex="-1"><q-banner class="bg-warning text-dark">{{ error }}<template #action><q-btn flat label="重新載入" @click="load" /></template></q-banner></div>
  <template v-else-if="document"><div class="row items-center q-gutter-sm q-mb-md"><q-badge :color="statusColors[document.status]" :label="statusLabels[document.status]" /><span>版本 {{ document.version }}</span><q-badge v-if="document.hasShortPick" color="warning" label="有短揀" /><q-btn flat label="重新載入目前資料" @click="first" /></div>
   <dl class="fulfillment-detail-facts"><div><dt>Sales Order</dt><dd>{{ document.salesOrderNumber }}</dd></div><div><dt>客戶</dt><dd>{{ document.customer.code }} — {{ document.customer.name }}</dd></div><div><dt>倉庫</dt><dd>{{ document.warehouse.code }} — {{ document.warehouse.name }}</dd></div><div><dt>最後更新（香港時間）</dt><dd>{{ timestamp(document.updatedAt) }}</dd></div></dl><p v-if="document.notes" class="fulfillment-detail-notes">{{ document.notes }}</p>
   <q-tabs v-model="tab" align="left" class="q-mb-md"><q-tab name="lines" label="行與數量" /><q-tab name="allocations" label="庫位／批次" /><q-tab name="history" label="狀態歷史" /></q-tabs>
   <section v-if="tab==='lines'" aria-label="履約行與數量"><h2 class="text-h6">履約行與數量</h2><FulfillmentQuantitySummary :key="`${document.id}:${document.version}`" :lines="document.lines" /></section>
   <section v-else-if="tab==='allocations'" aria-label="分配明細"><h2 class="text-h6">庫位／批次分配</h2><p>包括已釋放及已使用的歷史分配；每次讀取最多 100 筆。</p><DataTable :key="`${document.id}:${document.version}:${query.allocationAfterId??'0'}`" :rows="document.allocations.items" :columns="allocationColumns" :initial-pagination="{page:1,rowsPerPage:100}"><template #no-data><p role="status">沒有此頁的分配記錄。</p></template><template #bottom><div class="row q-gutter-sm q-pa-sm items-center"><span>本頁 {{ document.allocations.items.length }} 筆</span><q-btn v-if="query.allocationAfterId" flat label="第一頁分配" @click="childPage('allocationAfterId',null)" /><q-btn flat label="下一頁分配" :disable="!document.allocations.hasMore" @click="childPage('allocationAfterId',document.allocations.nextCursor)" /></div></template></DataTable></section>
   <section v-else aria-label="狀態歷史"><h2 class="text-h6">狀態歷史</h2><DataTable :key="`${document.id}:${document.version}:${query.historyBeforeSequence??'latest'}`" :rows="document.history.items" :columns="historyColumns" row-key="sequence" :initial-pagination="{page:1,rowsPerPage:100}"><template #no-data><p role="status">沒有此頁的歷史記錄。</p></template><template #bottom><div class="row q-gutter-sm q-pa-sm items-center"><span>本頁 {{ document.history.items.length }} 筆</span><q-btn v-if="query.historyBeforeSequence" flat label="最新歷史" @click="childPage('historyBeforeSequence',null)" /><q-btn flat label="更早歷史" :disable="!document.history.hasMore" @click="childPage('historyBeforeSequence',document.history.nextCursor)" /></div></template></DataTable></section>
   <FulfillmentAllocationPanel :document="document" @saved="first" @reload="first" />
   <PickConfirmationPanel :document="document" @saved="first" @reload="first" />
   <FulfillmentCancelPanel :document="document" @saved="first" @reload="first" />
  </template>
 </section></div></template>
<style scoped>
.fulfillment-detail-facts { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,240px),1fr)); gap: 16px; }
dt { font-weight: 600; }
dd { margin: 0; overflow-wrap: anywhere; }
.fulfillment-detail-notes { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
