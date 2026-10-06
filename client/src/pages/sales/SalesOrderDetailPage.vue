<script>
export const page={name:"sales-order-detail",path:"/sales/orders/:id",title:"銷售訂單詳情",requires:{permissions:["sales.view"]}};
</script>
<script setup>
import { onBeforeUnmount,ref,watch } from "vue";
import { useRoute } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { statusLabels,statusColors,sourceLabels } from "@/components/sales/salesOrderPresentation.js";
import sales from "@/services/sales.js";
const route=useRoute(),document=ref(null),loading=ref(false),error=ref("");let controller;
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";document.value=null;
 try{const value=await sales.getOrder(Number(route.params.id),{signal});if(!signal.aborted)document.value=value;}catch(e){if(!signal.aborted)error.value=e.message||"載入銷售訂單失敗";}finally{if(!signal.aborted)loading.value=false;}}
watch(()=>route.params.id,load,{immediate:true});onBeforeUnmount(()=>controller?.abort());
const columns=[{name:"lineNo",label:"行",field:"lineNo"},{name:"sku",label:"SKU",field:"skuName",align:"left"},{name:"quantity",label:"Ordered／UOM",field:"quantity",align:"right"},
 {name:"base",label:"數量（Base 單位）",field:"orderedBaseQuantity",align:"left"},{name:"unitSellingPrice",label:"售價",field:"unitSellingPrice",align:"right"},{name:"lineAmount",label:"明細總額",field:"lineAmount",align:"right"},{name:"lineNote",label:"備註",field:"lineNote",align:"left"}];
function timestamp(value){return new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",dateStyle:"short",timeStyle:"short"}).format(new Date(value));}
</script>
<template><div><PageHeader :title="document?.number??'銷售訂單詳情'" subtitle="Active 訂單；歷史快照與目前主檔參考分開顯示。" /><main class="q-px-md q-pb-md">
 <q-skeleton v-if="loading" type="rect" aria-label="載入銷售訂單" />
 <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
 <template v-else-if="document"><div class="row items-center q-gutter-sm q-mb-md"><q-badge color="primary" label="Active" /><q-badge :color="statusColors[document.status]" :label="statusLabels[document.status]" /><span>版本 {{ document.version }}</span><q-btn v-if="document.allowedActions.includes('edit')" label="編輯 Draft" :to="`/sales/orders/${document.id}/edit`" /><q-btn flat label="返回訂單列表" to="/sales/orders" /></div>
  <q-banner v-if="document.hasBackorder" role="status" class="bg-warning text-dark q-mb-md">有 Backorder：{{ document.backorderLineCount }} 行。</q-banner>
  <q-card flat bordered class="q-mb-md"><q-card-section><h2 class="text-h6 q-ma-none q-mb-md">訂單資料與快照</h2><dl class="row q-col-gutter-md break-word">
   <div class="col-12 col-md-6"><dt>客戶快照</dt><dd class="q-ml-none">{{ document.customerCode }} — {{ document.customerName }}</dd></div><div class="col-12 col-md-6"><dt>履約倉庫快照</dt><dd class="q-ml-none">{{ document.warehouseCode }} — {{ document.warehouseName }}</dd></div>
   <div class="col-12 col-md-6"><dt>總額</dt><dd class="q-ml-none">{{ document.currencyCode }} {{ document.totalAmount }}</dd></div><div class="col-12 col-md-6"><dt>訂單日期／要求送貨日期</dt><dd class="q-ml-none">{{ document.orderDate }}／{{ document.requestedDeliveryDate||'未設定' }}</dd></div>
   <div class="col-12 col-md-6"><dt>付款條款</dt><dd class="q-ml-none">{{ document.paymentTermName||'未設定' }}</dd></div><div class="col-12 col-md-6"><dt>客戶 PO</dt><dd class="q-ml-none break-word">{{ document.customerPoReference||'—' }}</dd></div><div class="col-12"><dt>備註</dt><dd class="q-ml-none pre-line break-word">{{ document.notes||'—' }}</dd></div>
  </dl></q-card-section></q-card>
  <h2 class="text-h6 q-ma-none q-mb-md">訂單明細</h2><p v-if="document.status==='DRAFT'" class="text-caption">Draft 尚未承諾或保留庫存；Base 單位數量按儲存快照顯示。</p>
  <DataTable :rows="document.lines" :columns="columns" :initial-pagination="{page:1,rowsPerPage:appConfig.defaultPageSize,sortBy:null,descending:false}">
   <template #body-cell-sku="{row}"><EllipsisCell :text="`${row.skuCode} — ${row.skuName}`" /></template><template #body-cell-quantity="{row}"><q-td class="text-right">{{ row.quantity }} {{ row.uomCode }}</q-td></template>
   <template #body-cell-base="{row}"><q-td><div>Ordered {{ row.orderedBaseQuantity }}</div><div>Reserved {{ row.reservedBaseQuantity }}</div><div>Backorder {{ row.backorderedBaseQuantity }}</div><div>Fulfilled {{ row.fulfilledBaseQuantity }}</div><div>Cancelled {{ row.cancelledBaseQuantity }}</div></q-td></template>
   <template #body-cell-lineNote="{row}"><EllipsisCell :text="row.lineNote" /></template>
  </DataTable>
  <q-card flat bordered class="q-my-md"><q-card-section><h2 class="text-h6 q-ma-none q-mb-md">來源</h2><p>{{ sourceLabels[document.sourceType] }}</p><q-btn v-if="document.sourceQuotationId" flat label="返回來源報價" :to="`/sales/quotations/${document.sourceQuotationId}`" /><p v-if="document.externalOrderId" class="break-word">{{ document.channelCode }}／{{ document.externalOrderId }}</p></q-card-section></q-card>
  <h2 class="text-h6 q-ma-none q-mb-md">狀態歷史</h2><p v-if="document.historyTruncated" role="status">只顯示最近 100 項狀態歷史。</p><ol><li v-for="event in document.history" :key="event.id" class="q-mb-sm break-word">{{ timestamp(event.occurredAt) }} — {{ event.actorLabel }}：{{ event.fromStatus?`${statusLabels[event.fromStatus]} → `:'' }}{{ statusLabels[event.toStatus] }}；{{ event.action }}；版本 {{ event.version }}<span v-if="event.reason">；{{ event.reason }}</span></li></ol>
  <q-card flat bordered class="q-my-md"><q-card-section><h2 class="text-h6 q-ma-none q-mb-md">目前主檔參考</h2><p>目前值只供參考；不改寫上方已儲存的客戶及商品快照。</p><p v-if="document.currentMaster.customer" class="break-word">客戶：{{ document.currentMaster.customer.customerCode }} — {{ document.currentMaster.customer.customerName }}（{{ document.currentMaster.customer.status }}）</p><p v-else>目前客戶參考不可用。</p><ul><li v-for="sku in document.currentMaster.skus" :key="sku.skuId" class="break-word">{{ sku.skuCode }} — {{ sku.skuName }}／{{ sku.itemName }}（SKU {{ sku.skuStatus }}；Item {{ sku.itemStatus }}）</li></ul></q-card-section></q-card>
 </template></main></div></template>
<style scoped>.pre-line { white-space:pre-line; }.break-word { overflow-wrap:anywhere; }</style>
