<script>
export const page={name:"fulfillment-pick-list-print",path:"/fulfillments/:id/pick-list/print",title:"揀貨單列印",requires:{permissions:["fulfillment.view"]}};
</script>
<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from "vue";
import {useRoute} from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import fulfillment,{fulfillmentDocumentId,fulfillmentFailure} from "@/services/fulfillment.js";
import {useSessionStore} from "@/stores/session.js";
import {statusLabels,timestamp} from "@/components/fulfillment/fulfillmentPresentation.js";
const route=useRoute(),session=useSessionStore(),document=ref(null),loading=ref(false),printing=ref(false),error=ref(""),summary=ref(null);let controller;
const warning=computed(()=>document.value?.status==="REVERSED"?"已沖銷 — 僅供歷史參考，不可作揀貨指示":document.value?.status==="CANCELLED"?"已取消 — 沒有當前揀貨工作，不可作揀貨指示":document.value&&!document.value.isPickingInstruction?"作業已完成 — 僅供歷史參考，請勿重複揀貨":"");
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";document.value=null;
 try{const id=fulfillmentDocumentId(route.params.id),value=await fulfillment.getPickList(id,{signal});if(!signal.aborted){document.value=value;return true;}}
 catch(e){if(!signal.aborted){const failure=fulfillmentFailure(e);error.value=e instanceof TypeError?"履約單識別碼不正確，請返回列表重新選取":failure.action==="recover"?"暫時無法載入揀貨單，請重新載入":failure.message;}}
 finally{if(!signal.aborted){loading.value=false;if(error.value){await nextTick();summary.value?.focus();}}}return false;
}
watch([()=>route.params.id,()=>session.user?.id,()=>session.permissions.join('|')],load,{immediate:true});onBeforeUnmount(()=>controller?.abort());
async function print(){if(printing.value)return;const id=String(route.params.id);printing.value=true;try{if(await load()){await nextTick();if(String(route.params.id)===id&&document.value?.id===id)window.print();}}finally{printing.value=false;}}
</script>
<template><div class="fulfillment-pick-print"><div class="print-actions"><PageHeader subtitle="目前分配快照的內部作業文件。"><template #actions><q-btn flat label="返回履約單" :to="`/fulfillments/${route.params.id}`" /></template></PageHeader><div class="q-px-md q-pb-md"><q-btn v-if="document" color="primary" label="列印 A4" :loading="printing" :disable="loading" @click="print" /></div></div>
 <section aria-label="揀貨單預覽" class="q-px-md q-pb-md" :aria-busy="loading"><q-skeleton v-if="loading" type="rect" aria-label="載入揀貨單" /><div v-else-if="error" ref="summary" role="alert" tabindex="-1"><q-banner class="bg-warning text-dark">{{ error }}<template #action><q-btn flat label="重新載入" @click="load" /></template></q-banner></div>
  <article v-else-if="document" class="pick-list-sheet"><header><p class="text-h6 q-ma-none">{{ appConfig.title }}</p><h2 class="text-h5 q-mb-sm">揀貨單 {{ document.number }}</h2><p v-if="warning" role="alert" class="print-warning">{{ warning }}</p><p>狀態：{{ statusLabels[document.status] }}・版本 {{ document.version }}</p><p>SO：{{ document.salesOrder.number }}</p><p>客戶：{{ document.customer.code }} — {{ document.customer.name }}</p><p>倉庫：{{ document.warehouse.code }} — {{ document.warehouse.name }}</p><p>預覽時間：{{ timestamp(document.generatedAt) }}</p></header>
   <h3 class="text-h6">本次工作數量（Base 單位）</h3><div class="pick-table-scroll" tabindex="0" aria-label="工作數量，可水平捲動"><table class="pick-list-lines"><thead><tr><th scope="col">行</th><th scope="col">SKU／名稱</th><th scope="col">計劃</th><th scope="col">已揀</th><th scope="col">短揀</th></tr></thead><tbody><tr v-for="line in document.lines" :key="line.id"><td>{{ line.lineNo }}</td><td>{{ line.skuCode }} — {{ line.skuName }}<div>{{ line.baseUomCode }}</div></td><td>{{ line.plannedBaseQuantity }}</td><td>{{ line.pickedBaseQuantity }}</td><td>{{ line.shortBaseQuantity }}<div v-if="line.shortPickReason">{{ line.shortPickReason }}</div></td></tr></tbody></table></div>
   <h3 class="text-h6">庫位／批次明細</h3><p v-if="!document.rows.length">沒有當前揀貨庫位；已保存數量歷史見上表。</p><div v-else class="pick-table-scroll" tabindex="0" aria-label="庫位批次明細，可水平捲動"><table class="pick-list-allocations"><caption>依庫位、批次、SKU 的固定順序</caption><thead><tr><th scope="col">順序</th><th scope="col">庫位</th><th scope="col">批次／到期日</th><th scope="col">SKU／名稱</th><th scope="col">本單計劃</th><th scope="col">此分配數量</th><th scope="col">原推薦</th></tr></thead><tbody><tr v-for="row in document.rows" :key="row.allocationId"><td>{{ row.sequence }}</td><td>{{ row.binCode }}</td><td>{{ row.lotNumber||'—' }}<div>{{ row.expiryDate||'無到期日' }}</div></td><td>{{ row.skuCode }} — {{ row.skuName }}</td><td>{{ row.plannedBaseQuantity }} {{ row.baseUomCode }}</td><td>{{ row.baseQuantity }} {{ row.baseUomCode }}</td><td>{{ row.selectionStrategy }} #{{ row.recommendedRank }}</td></tr></tbody></table></div>
   <h3 v-if="document.notes" class="text-h6">履約備註</h3><p v-if="document.notes" class="pick-notes">{{ document.notes }}</p>
  </article>
 </section></div></template>
<style scoped>
.pick-list-sheet { max-width: 210mm; margin: auto; overflow-wrap: anywhere; }
.pick-table-scroll { max-width: 100%; overflow: auto; }
.pick-table-scroll:focus-visible { outline: 2px solid var(--q-primary); }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px; border-bottom: 1px solid var(--app-border); text-align: left; }
caption { text-align: left; }
.print-warning { border: 2px solid currentColor; padding: 8px; font-weight: 700; }
.pick-notes { white-space: pre-wrap; }
@media print {
 .print-actions { display: none; }
 .pick-list-sheet { page: fulfillment-pick-list; max-width: none; margin: 0; background: white; color: black; font-size: 9pt; }
 .pick-table-scroll { overflow: visible; }
 table { table-layout: fixed; }
 th, td { padding: 2mm; }
 thead { display: table-header-group; }
 tr { break-inside: avoid; }
}
</style>
<style>
@page fulfillment-pick-list { size: A4; margin: 14mm; }
@media print {
 html:has(.fulfillment-pick-print), body:has(.fulfillment-pick-print) { overflow: visible !important; height: auto !important; }
 html:has(.fulfillment-pick-print) body { position: static !important; page: fulfillment-pick-list; }
 body:has(.fulfillment-pick-print) .q-header, body:has(.fulfillment-pick-print) .q-drawer, body:has(.fulfillment-pick-print) .q-drawer__backdrop { display: none !important; }
 body:has(.fulfillment-pick-print) .q-page-container { padding: 0 !important; }
 body:has(.fulfillment-pick-print) .q-page { min-height: 0 !important; background: white; }
}
</style>
