<script>
export const page = { name: "sales-quotation-detail", path: "/sales/quotations/:id", title: "報價詳情", requires: { permissions: ["sales.view"] } };
</script>
<script setup>
import { onBeforeUnmount, ref, toRaw, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import QuotationDifferencePanel from "@/components/sales/QuotationDifferencePanel.vue";
import sales from "@/services/sales.js";
const route=useRoute(),document=ref(null),loading=ref(false),error=ref(""),dialog=ref(false),action=ref(null),reason=ref(""),intent=ref(null),uncertain=ref(false),busy=ref(false),stale=ref(false);
const labels={DRAFT:"草稿",ISSUED:"已發出",EXPIRED:"已過期",CANCELLED:"已取消",CONVERTED:"已轉單"};
const colors={DRAFT:"grey",ISSUED:"positive",EXPIRED:"warning",CANCELLED:"negative",CONVERTED:"primary"};
const columns=[{name:"lineNo",label:"行",field:"lineNo"},{name:"sku",label:"SKU",field:"skuName",align:"left"},{name:"quantity",label:"數量／單位",field:"quantity",align:"right"},
 {name:"unitSellingPrice",label:"售價",field:"unitSellingPrice",align:"right"},{name:"lineAmount",label:"明細總額",field:"lineAmount",align:"right"},{name:"lineNote",label:"備註",field:"lineNote",align:"left"}];
let controller;
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";document.value=null;dialog.value=false;intent.value=null;uncertain.value=false;stale.value=false;
 try{const value=await sales.getQuotation(Number(route.params.id),{signal});if(!signal.aborted)document.value=value;}catch(e){if(!signal.aborted)error.value=e.message || "載入報價失敗";}finally{if(!signal.aborted)loading.value=false;}}
watch(()=>route.params.id,load,{immediate:true});
function canLeave(){if(busy.value)return false;return !uncertain.value || window.confirm("操作結果尚未確認，確定離開並重新讀取資料？");}
onBeforeRouteLeave(canLeave);onBeforeRouteUpdate((to,from)=>to.params.id===from.params.id || canLeave());
function beforeUnload(event){if(busy.value || uncertain.value){event.preventDefault();event.returnValue="";}}
window.addEventListener("beforeunload",beforeUnload);
onBeforeUnmount(()=>{controller?.abort();window.removeEventListener("beforeunload",beforeUnload);});
function openAction(kind){action.value=kind;reason.value="";intent.value=null;uncertain.value=false;stale.value=false;dialog.value=true;}
async function mutate(){
 if(stale.value)throw new Error("版本已更改，請先重新讀取報價。");
 if(!intent.value)intent.value={eventId:crypto.randomUUID(),version:document.value.version,...(action.value==="cancel"?{reason:reason.value.trim()}: {})};
 busy.value=true;
 try{await sales[action.value==="issue"?"issueQuotation":"cancelQuotation"](document.value.id,structuredClone(toRaw(intent.value)));uncertain.value=false;dialog.value=false;intent.value=null;await load();}
 catch(e){uncertain.value=["TIMEOUT","NETWORK_ERROR","TRANSACTION_OUTCOME_UNKNOWN","IDEMPOTENCY_IN_PROGRESS"].includes(e.code)||e.status>=500;stale.value=e.code==="VERSION_CONFLICT";if(!uncertain.value)intent.value=null;
  throw new Error(uncertain.value?"結果尚未確認；請重試同一提交以確認結果。":stale.value?"版本已更改；請重新讀取報價後再操作。":e.message || "操作失敗");}
 finally{busy.value=false;}
}
function reload(){dialog.value=false;intent.value=null;uncertain.value=false;load();}
</script>
<template><div><PageHeader :title="document?.number ?? '報價詳情'" /><main class="q-px-md q-pb-md">
 <q-skeleton v-if="loading" type="rect" aria-label="載入報價" />
 <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
 <template v-else-if="document">
  <div class="row items-center q-gutter-sm q-mb-md"><q-badge :color="colors[document.status]" :label="labels[document.status]" /><span>版本 {{ document.version }}</span>
   <q-btn v-if="document.allowedActions.includes('edit')" label="編輯 Draft" :to="`/sales/quotations/${document.id}/edit`" />
   <q-btn v-if="document.allowedActions.includes('issue')" label="發出報價" @click="openAction('issue')" />
   <q-btn v-if="document.allowedActions.includes('cancel')" label="取消報價" @click="openAction('cancel')" />
   <q-btn v-if="document.allowedActions.includes('print')" label="列印" :to="`/sales/quotations/${document.id}/print`" />
   <q-btn v-if="document.allowedActions.includes('convert')" color="primary" label="轉為銷售訂單" :to="`/sales/quotations/${document.id}/edit?convert=1`" />
  </div>
  <q-card flat bordered class="q-mb-md"><q-card-section><h2 class="text-h6 q-ma-none q-mb-md">報價資料</h2><dl class="row q-col-gutter-md">
   <div class="col-12 col-md-6"><dt>客戶</dt><dd class="q-ml-none">{{ document.customerCode }} — {{ document.customerName }}</dd></div>
   <div class="col-12 col-md-6"><dt>總額</dt><dd class="q-ml-none">{{ document.currencyCode }} {{ document.totalAmount }}</dd></div>
   <div class="col-12 col-md-6"><dt>報價日期／有效至</dt><dd class="q-ml-none">{{ document.quotationDate }}／{{ document.validUntil }}</dd></div>
   <div class="col-12 col-md-6"><dt>付款條款</dt><dd class="q-ml-none">{{ document.paymentTermName || '未設定' }}</dd></div>
   <div class="col-12"><dt>參考編號</dt><dd class="q-ml-none">{{ document.externalReference || '—' }}</dd></div>
   <div class="col-12"><dt>備註</dt><dd class="q-ml-none pre-line">{{ document.notes || '—' }}</dd></div>
  </dl></q-card-section></q-card>
  <h2 class="text-h6 q-ma-none q-mb-md">報價明細</h2><DataTable :rows="document.lines" :columns="columns" :initial-pagination="{page:1,rowsPerPage:appConfig.defaultPageSize,sortBy:null,descending:false}">
   <template #body-cell-sku="{row}"><EllipsisCell :text="`${row.skuCode} — ${row.skuName}`" /></template>
   <template #body-cell-quantity="{row}"><q-td class="text-right">{{ row.quantity }} {{ row.uomCode }}</q-td></template>
   <template #body-cell-lineNote="{row}"><EllipsisCell :text="row.lineNote" /></template>
  </DataTable>
  <template v-if="document.conversion"><p class="q-mt-md">唯一目標訂單：<router-link :to="`/sales/orders/${document.conversion.salesOrderId}`">{{ document.conversion.salesOrderNumber }}</router-link></p><QuotationDifferencePanel :difference="document.conversion.differenceSummary" /></template>
 </template>
 <q-dialog v-model="dialog" :persistent="busy || uncertain"><q-card><q-card-section><h2 class="text-h6 q-ma-none">{{ action==='issue'?'發出報價':'取消報價' }}</h2><p>{{ document?.number }}；{{ document?.currencyCode }} {{ document?.totalAmount }}</p><p v-if="action==='issue'">發出後明細會凍結。報價不會保留庫存。</p>
  <FormPanel :on-submit="mutate" v-slot="{submitting}"><q-input v-if="action==='cancel'" v-model="reason" label="取消原因 *" type="textarea" maxlength="500" :disable="uncertain || submitting" :rules="[value=>[...value.trim()].length>=5 || '最少五個字元']" outlined dense />
   <p v-if="uncertain" role="status">結果尚未確認，重試會保留同一提交。</p><q-btn v-if="stale" flat label="重新讀取報價" @click="reload" />
   <q-btn color="primary" type="submit" :label="uncertain?'重試確認結果':action==='issue'?'確認發出':'確認取消'" :loading="submitting" :disable="stale" /><q-btn flat label="返回" :disable="submitting || uncertain" @click="dialog=false" />
  </FormPanel>
 </q-card-section></q-card></q-dialog>
 </main></div></template>
<style scoped>.pre-line { white-space: pre-line; overflow-wrap: anywhere; } dd { overflow-wrap: anywhere; }</style>
