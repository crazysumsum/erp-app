<script>
export const page = { name: "sales-quotation-print", path: "/sales/quotations/:id/print", title: "報價列印", requires: { permissions: ["sales.view"] } };
</script>
<script setup>
import { onBeforeUnmount,ref,watch } from "vue";
import { useRoute } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import sales from "@/services/sales.js";
const route=useRoute(),document=ref(null),loading=ref(false),error=ref("");let controller;
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";document.value=null;
 try{const value=await sales.getQuotation(Number(route.params.id),{signal});if(!signal.aborted)document.value=value;}catch(e){if(!signal.aborted)error.value=e.message || "載入列印資料失敗";}finally{if(!signal.aborted)loading.value=false;}}
watch(()=>route.params.id,load,{immediate:true});onBeforeUnmount(()=>controller?.abort());
function print(){window.print();}
</script>
<template><div class="quotation-print"><div class="print-actions"><PageHeader /><div class="q-px-md q-pb-md"><q-btn v-if="document?.allowedActions.includes('print')" color="primary" label="列印 A4" @click="print" /></div></div>
 <main class="q-px-md q-pb-md"><q-skeleton v-if="loading" type="rect" aria-label="載入列印資料" />
  <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
  <article v-else-if="document?.allowedActions.includes('print')" class="quotation-sheet">
   <h1 class="text-h5">{{ appConfig.title }}</h1><h2 class="text-h6">報價單 {{ document.number }}</h2><p>客戶：{{ document.customerCode }} — {{ document.customerName }}</p><p>報價日期：{{ document.quotationDate }} 有效至：{{ document.validUntil }}</p><p v-if="document.externalReference">參考編號：{{ document.externalReference }}</p>
   <table><caption class="text-left">報價明細（{{ document.currencyCode }}）</caption><thead><tr><th scope="col">行</th><th scope="col">SKU／名稱</th><th scope="col">數量／單位</th><th scope="col">售價</th><th scope="col">金額</th></tr></thead><tbody><tr v-for="line in document.lines" :key="line.id"><td>{{ line.lineNo }}</td><td>{{ line.skuCode }} — {{ line.skuName }}<div v-if="line.lineNote">{{ line.lineNote }}</div></td><td><span class="print-number">{{ line.quantity }}</span> {{ line.uomCode }}</td><td class="print-number">{{ line.unitSellingPrice }}</td><td class="print-number">{{ line.lineAmount }}</td></tr></tbody></table>
   <p class="text-right">總額：{{ document.currencyCode }} {{ document.totalAmount }}</p><p v-if="document.paymentTermName">付款條款：{{ document.paymentTermName }}</p><p v-if="document.notes" class="print-notes">{{ document.notes }}</p>
  </article>
  <q-banner v-else-if="document" role="status">目前狀態不允許列印。</q-banner>
 </main></div></template>
<style scoped>
.quotation-sheet { max-width: 210mm; margin: auto; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 1px solid var(--app-border); padding: 8px; text-align: left; }
.print-notes { white-space: pre-line; }
.print-number { white-space: nowrap; }
@media print { .quotation-print, main { background: white; } .quotation-sheet { max-width: none; background: white; color: black; } .print-actions { display: none; } thead { display: table-header-group; } tr { break-inside: avoid; } }
</style>
<style>
@media print { @page { size: A4; margin: 14mm; } body:has(.quotation-print) .q-header, body:has(.quotation-print) .q-drawer, body:has(.quotation-print) .q-drawer__backdrop { display: none !important; } body:has(.quotation-print) .q-page-container { padding: 0 !important; } }
</style>
