<script>
export const page={name:"shipment-delivery-note-print",path:"/shipments/:id/delivery-note/print",title:"送貨文件列印",requires:{permissions:["fulfillment.view"]}};
</script>
<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from "vue";
import {useRoute} from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import appConfig from "@config/app.js";
import shipment,{shipmentDocumentId,shipmentFailure} from "@/services/shipment.js";
import {timestamp} from "@/components/fulfillment/fulfillmentPresentation.js";
import {useSessionStore} from "@/stores/session.js";
const route=useRoute(),session=useSessionStore(),document=ref(null),loading=ref(false),printing=ref(false),error=ref(""),summary=ref(null);let controller;
const packing=computed(()=>route.query.view==='packing'),title=computed(()=>packing.value?'裝箱單':'送貨單');
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;document.value=null;error.value="";
 try{if(route.query.view!==undefined&&route.query.view!=='packing')throw new TypeError();const value=await shipment.getDeliveryNote(shipmentDocumentId(route.params.id),{signal});if(!signal.aborted){document.value=value;return true;}}
 catch(cause){if(!signal.aborted)error.value=cause instanceof TypeError?"文件識別碼或類型不正確，請返回出貨單重新選取。":shipmentFailure(cause).message;}
 finally{if(!signal.aborted){loading.value=false;if(error.value){await nextTick();summary.value?.focus();}}}return false;}
watch([()=>route.params.id,()=>route.query.view,()=>session.user?.id,()=>session.permissions.join('|')],load,{immediate:true});onBeforeUnmount(()=>controller?.abort());
async function print(){if(printing.value)return;const id=String(route.params.id),view=route.query.view,actor=session.user?.id;printing.value=true;try{if(await load()){await nextTick();if(String(route.params.id)===id&&route.query.view===view&&session.user?.id===actor&&document.value?.id===id)window.print();}}finally{printing.value=false;}}
</script>
<template><div class="shipment-document-print"><div class="print-actions"><PageHeader :subtitle="`${title}使用確認出貨時保存的快照。`"><template #actions><q-btn flat label="返回出貨單" :to="`/shipments/${route.params.id}`" /></template></PageHeader><div class="q-px-md q-pb-md"><q-btn v-if="document" color="primary" label="列印 A4" :loading="printing" :disable="loading" @click="print" /></div></div>
 <section :aria-label="`${title}預覽`" :aria-busy="loading" class="q-px-md q-pb-md"><q-skeleton v-if="loading" type="rect" aria-label="載入送貨文件" /><div v-else-if="error" ref="summary" role="alert" tabindex="-1"><q-banner class="bg-warning text-dark">{{ error }}<template #action><q-btn flat label="重新載入" @click="load" /></template></q-banner></div>
 <article v-else-if="document" class="shipment-document-sheet"><header><p class="text-h6 q-ma-none">{{ appConfig.title }}</p><h2 class="text-h5">{{ title }} {{ document.number }}</h2><p v-if="!document.isEffective" role="alert" class="print-warning">{{ document.historicalWarning||'此文件已失效，只供歷史參考' }}</p><p>SO：{{ document.salesOrder.number }}／履約單：{{ document.fulfillment.number }}</p><p>客戶：{{ document.customer.code }} — {{ document.customer.name }}</p><p>出貨日期：{{ document.shipmentDate }}／版本：{{ document.version }}</p><p>物流商：{{ document.carrierName||'未填寫' }}／追蹤號碼：{{ document.trackingNumber||'未填寫' }}</p><p>包裹數：{{ document.packageCount??'未填寫' }}／重量：{{ document.totalWeight===null?'未填寫':`${document.totalWeight} ${document.weightUom}` }}</p><p>預覽時間：{{ timestamp(document.generatedAt) }}</p></header>
 <h3 class="text-h6">收貨資料</h3><address>{{ [document.address.name,document.address.recipientCompany,document.address.recipientName,document.address.line1,document.address.line2,document.address.line3,document.address.city,document.address.region,document.address.postalCode,document.address.countryCode].filter(Boolean).join(' · ') }}<br />{{ [document.contact.name,document.contact.phone,document.contact.email].filter(Boolean).join(' · ') }}</address>
 <h3 class="text-h6">出貨數量（Base 單位）</h3><div class="shipment-table-scroll" tabindex="0" aria-label="出貨數量，可水平捲動"><table class="shipment-document-lines"><thead><tr><th scope="col">行</th><th scope="col">SKU／品名</th><th scope="col">出貨數量</th></tr></thead><tbody><tr v-for="line in document.lines" :key="line.id"><td>{{ line.lineNo }}</td><td>{{ line.skuCode }} — {{ line.skuName }}</td><td>{{ line.shippedBaseQuantity }} {{ line.baseUomCode }}</td></tr></tbody></table></div>
 <template v-if="packing"><h3 class="text-h6">庫位／批次裝箱明細</h3><div class="shipment-table-scroll" tabindex="0" aria-label="裝箱明細，可水平捲動"><table class="shipment-document-rows"><thead><tr><th scope="col">順序／行</th><th scope="col">SKU</th><th scope="col">庫位</th><th scope="col">批次／到期日</th><th scope="col">數量</th></tr></thead><tbody><tr v-for="row in document.rows" :key="row.id"><td>{{ row.sequence }}／{{ row.lineNo }}</td><td>{{ row.skuCode }}</td><td>{{ row.binCode }}</td><td>{{ row.lotNumber||'—' }}<div>{{ row.expiryDate||'無到期日' }}</div></td><td>{{ row.issuedBaseQuantity }} {{ row.baseUomCode }}</td></tr></tbody></table></div></template>
 <h3 v-if="document.notes" class="text-h6">出貨備註</h3><p v-if="document.notes" class="shipment-notes">{{ document.notes }}</p>
 </article></section></div></template>
<style scoped>
.shipment-document-sheet { max-width: 210mm; margin: auto; overflow-wrap: anywhere; }
.shipment-table-scroll { max-width: 100%; overflow: auto; }
.shipment-table-scroll:focus-visible { outline: 2px solid var(--q-primary); }
table { width: 100%; border-collapse: collapse; } th, td { padding: 8px; border-bottom: 1px solid var(--app-border); text-align: left; }
address { font-style: normal; } .shipment-notes { white-space: pre-wrap; }
.print-warning { border: 2px solid currentColor; padding: 8px; font-weight: 700; }
@media print {
 .print-actions { display: none; }
 .shipment-document-sheet { page: shipment-document; max-width: none; margin: 0; background: white; color: black; font-size: 9pt; }
 .shipment-table-scroll { overflow: visible; } table { table-layout: fixed; } th, td { padding: 2mm; }
 thead { display: table-header-group; } tr { break-inside: avoid; }
}
</style>
<style>
@page shipment-document { size: A4; margin: 14mm; }
@media print {
 html:has(.shipment-document-print), body:has(.shipment-document-print) { overflow: visible !important; height: auto !important; }
 html:has(.shipment-document-print) body { position: static !important; page: shipment-document; }
 body:has(.shipment-document-print) .q-header, body:has(.shipment-document-print) .q-drawer, body:has(.shipment-document-print) .q-drawer__backdrop { display: none !important; }
 body:has(.shipment-document-print) .q-page-container { padding: 0 !important; }
 body:has(.shipment-document-print) .q-page { min-height: 0 !important; background: white; }
}
</style>
