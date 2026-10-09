<script>
export const page = { name: "sales-quotation-edit", path: "/sales/quotations/:id/edit", title: "編輯報價", requires: { permissions: ["sales.view", "sales.mgmt"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SalesQuotationForm from "@/components/sales/SalesQuotationForm.vue";
import QuotationDifferencePanel from "@/components/sales/QuotationDifferencePanel.vue";
import sales from "@/services/sales.js";
const route=useRoute(),document=ref(null),loading=ref(false),error=ref(""),result=ref(null);
const conversion=computed(()=>route.query.convert==="1");let controller;
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";result.value=null;
 try{const value=await sales.getQuotation(Number(route.params.id),{signal});if(!signal.aborted)document.value=value;}
 catch(e){if(!signal.aborted)error.value=e.message || "載入報價失敗";}finally{if(!signal.aborted)loading.value=false;}}
watch(()=>[route.params.id,conversion.value],load,{immediate:true});onBeforeUnmount(()=>controller?.abort());
async function save(payload){return conversion.value?sales.convertQuotation(document.value.id,payload):sales.updateQuotation(document.value.id,payload);}
async function saved(value){if(conversion.value)result.value=value;else { await load();result.value={saved:true}; }}
</script>
<template><div><PageHeader :title="conversion?'轉為銷售訂單':'編輯報價'" /><main class="q-px-md q-pb-md">
 <q-skeleton v-if="loading" type="rect" aria-label="載入報價" />
 <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
 <template v-else-if="result?.salesOrder"><p role="status">已建立 {{ result.salesOrder.number }}；狀態：Draft</p><q-btn :to="`/sales/orders/${result.salesOrder.id}`" label="查看銷售訂單" /><QuotationDifferencePanel :difference="result.differenceSummary" /></template>
 <q-banner v-if="result?.saved" role="status" class="bg-positive text-dark q-mb-md">報價已儲存；已重新讀取最新版本 {{ document.version }}。</q-banner>
 <SalesQuotationForm v-if="!loading && !error && !result?.salesOrder && document?.allowedActions.includes(conversion?'convert':'edit')" :document="document" :conversion="conversion" :on-save="save" @saved="saved" @reload="load" />
 <q-banner v-else-if="!loading && !error && !result?.salesOrder && document" role="status">目前狀態或權限不允許此操作。<q-btn flat label="返回報價詳情" :to="`/sales/quotations/${document.id}`" /></q-banner>
 </main></div></template>
