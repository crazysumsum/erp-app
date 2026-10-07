<script>
export const page={name:"sales-order-detail",path:"/sales/orders/:id",title:"銷售訂單詳情",requires:{permissions:["sales.view"]}};
</script>
<script setup>
import { computed,onBeforeUnmount,ref,watch } from "vue";
import { useRoute } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { statusLabels,statusColors,sourceLabels } from "@/components/sales/salesOrderPresentation.js";
import sales from "@/services/sales.js";
import { useSessionStore } from "@/stores/session.js";
import { useSalesCommandEvent } from "@/composables/sales/useSalesCommandEvent.js";
const route=useRoute(),session=useSessionStore(),document=ref(null),loading=ref(false),error=ref("");let controller,creditController;
const dialog=ref(false),credit=ref(null),creditLoading=ref(false),creditError=ref(""),notice=ref(""),failed=ref(false);
const warningLabels={PARTIAL_BACKORDER:"部分數量轉為 Backorder。",CREDIT_LIMIT_ADVISORY:"信用額度只供參考。",MASTER_DATA_CHANGED:"主檔已變更，已保存確認時的最新快照。"};
const command=useSalesCommandEvent({userId:()=>session.user?.id,onTerminal:async operation=>{
 failed.value=["FAILED","REJECTED"].includes(operation.status);
 notice.value=failed.value?`確認未完成：${operation.errorCode}`:
  `訂單已確認。 ${(operation.warnings??[]).map(code=>warningLabels[code]??code).join(" ")}`;
 await load();}});
const {pending,busy,error:commandError,retryable}=command;
const lifecycleDialog=ref(false),lifecycleAction=ref(""),reason=ref("");
const lifecycleLabels={withdraw:"撤回確認",cancel:"取消訂單",closeRemaining:"關閉剩餘數量"};
const lifecycle=useSalesCommandEvent({userId:()=>session.user?.id,commandType:"lifecycle",onTerminal:async operation=>{
 failed.value=["FAILED","REJECTED"].includes(operation.status);notice.value=failed.value?`操作未完成：${operation.errorCode}`:"訂單操作已完成。";await load();}});
const {pending:lifecyclePending,busy:lifecycleBusy,error:lifecycleError,retryable:lifecycleRetryable}=lifecycle;
const actions=computed(()=>session.permissions.includes("sales.mgmt")&&!pending.value&&!lifecyclePending.value?document.value?.allowedActions??[]:[]);
const validReason=computed(()=>[...reason.value.trim()].length>=5&&[...reason.value.trim()].length<=500&&![...reason.value].some(c=>{const n=c.codePointAt(0);return n===127||n<32&&![9,10,13].includes(n);}));
function openLifecycle(action){if(!actions.value.includes(action))return;lifecycleAction.value=action;reason.value="";lifecycleDialog.value=true;}
async function submitLifecycle(){if(!validReason.value||!actions.value.includes(lifecycleAction.value))return;const action=lifecycleAction.value;lifecycleDialog.value=false;await lifecycle.start(document.value.id,document.value.version,{action,reason:reason.value.trim()});}

const canConfirm=computed(()=>session.permissions.includes("sales.mgmt")&&actions.value.includes("confirm"));
const masterChanged=computed(()=>{const value=document.value;if(!value)return false;const current=value.currentMaster.customer;
 return !current||current.customerCode!==value.customerCode||current.customerName!==value.customerName||
  value.lines.some(line=>{const sku=value.currentMaster.skus.find(row=>row.skuId===line.skuId);return !sku||sku.skuName!==line.skuName||sku.skuCode!==line.skuCode;});});
async function load(){command.stop();lifecycle.stop();controller?.abort();creditController?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";document.value=null;dialog.value=false;lifecycleDialog.value=false;
 try{const value=await sales.getOrder(Number(route.params.id),{signal});if(!signal.aborted){document.value=value;if(session.permissions.includes("sales.mgmt")){await command.resume(value.id);if(!signal.aborted)await lifecycle.resume(value.id);}}}
 catch(e){if(!signal.aborted)error.value=e.message||"載入銷售訂單失敗";}finally{if(!signal.aborted)loading.value=false;}}
watch([()=>route.params.id,()=>session.user?.id,()=>session.permissions.join("|")],()=>{notice.value="";load();},{immediate:true});
onBeforeUnmount(()=>{controller?.abort();creditController?.abort();});
async function openConfirm(){
 if(!canConfirm.value)return;dialog.value=true;credit.value=null;creditError.value="";creditLoading.value=true;creditController?.abort();creditController=new AbortController();const signal=creditController.signal;
 try{const result=await sales.lookupCustomers({q:document.value.customerCode,page:1,pageSize:20,signal});if(!signal.aborted)credit.value=result.items.find(row=>row.customerId===document.value.customerId)?.credit??null;}
 catch(e){if(!signal.aborted)creditError.value=e.message||"未能讀取信用狀態，提交時會重新驗證。";}
 finally{if(!signal.aborted)creditLoading.value=false;}
}
watch(dialog,value=>{if(!value)creditController?.abort();});
async function confirm(){if(!canConfirm.value||creditLoading.value||credit.value?.status==="on_hold")return;dialog.value=false;await command.start(document.value.id,document.value.version);}
const columns=[{name:"lineNo",label:"行",field:"lineNo"},{name:"sku",label:"SKU",field:"skuName",align:"left"},{name:"quantity",label:"Ordered／UOM",field:"quantity",align:"right"},
 {name:"base",label:"數量（Base 單位）",field:"orderedBaseQuantity",align:"left"},{name:"unitSellingPrice",label:"售價",field:"unitSellingPrice",align:"right"},{name:"lineAmount",label:"明細總額",field:"lineAmount",align:"right"},{name:"lineNote",label:"備註",field:"lineNote",align:"left"}];
function timestamp(value){return new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",dateStyle:"short",timeStyle:"short"}).format(new Date(value));}
</script>
<template><div><PageHeader :title="document?.number??'銷售訂單詳情'" subtitle="Active 訂單；歷史快照與目前主檔參考分開顯示。" /><main class="q-px-md q-pb-md">
 <q-banner v-if="notice" :role="failed?'alert':'status'" :class="failed?'bg-negative text-white q-mb-md':'bg-positive text-white q-mb-md'">{{ notice }}</q-banner>
 <q-banner v-if="pending" role="status" aria-live="polite" class="bg-info text-white q-mb-md">確認結果仍在處理或未確定；保留原操作並查詢結果。</q-banner>
 <q-banner v-if="lifecyclePending" role="status" class="bg-info text-white q-mb-md">訂單操作結果仍未確定；保留原操作並核對結果。</q-banner>
 <q-banner v-if="lifecycleError" role="alert" class="bg-warning text-dark q-mb-md">{{ lifecycleError }}<template #action><q-btn v-if="lifecycleRetryable" flat label="重查並重試原訂單操作" :loading="lifecycleBusy" @click="lifecycle.retry" /></template></q-banner>
 <q-banner v-if="commandError" role="alert" class="bg-warning text-dark q-mb-md">{{ commandError }}<template #action><q-btn v-if="retryable" flat label="重查原操作並重試" :loading="busy" @click="command.retry" /></template></q-banner>
 <q-skeleton v-if="loading" type="rect" aria-label="載入銷售訂單" />
 <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
 <template v-else-if="document"><div class="row items-center q-gutter-sm q-mb-md"><q-badge color="primary" label="Active" /><q-badge :color="statusColors[document.status]" :label="statusLabels[document.status]" /><span>版本 {{ document.version }}</span><q-btn v-if="actions.includes('edit')" label="編輯 Draft" :to="`/sales/orders/${document.id}/edit`" /><q-btn v-if="canConfirm" color="primary" label="確認訂單" :disable="busy" @click="openConfirm" /><q-btn v-for="action in actions.filter(value=>lifecycleLabels[value])" :key="action" :label="lifecycleLabels[action]" :disable="busy||lifecycleBusy" @click="openLifecycle(action)" /><q-btn flat label="返回訂單列表" to="/sales/orders" /></div>
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
 </template>
 <q-dialog v-model="dialog" aria-labelledby="sales-confirm-title"><q-card class="confirmation-dialog"><q-card-section>
  <h2 id="sales-confirm-title" class="text-h6 q-ma-none q-mb-md">確認銷售訂單</h2>
  <p>{{ document?.customerCode }} — {{ document?.customerName }}</p><p>{{ document?.warehouseCode }} — {{ document?.warehouseName }}</p>
  <p>明細：{{ document?.lineCount }} 行；{{ document?.currencyCode }} {{ document?.totalAmount }}</p>
  <p>確認時會重新驗證主檔及庫存；不足部分會轉為 Backorder。</p>
  <q-banner v-if="document?.lines.some(line=>/^0(?:\.0+)?$/u.test(line.unitSellingPrice))" class="bg-warning text-dark q-mb-sm">注意：包含零售價明細。</q-banner>
  <q-banner v-if="masterChanged" class="bg-warning text-dark q-mb-sm">主檔參考與 Draft 快照不同；提交時採用最新有效資料。</q-banner>
  <q-skeleton v-if="creditLoading" type="text" aria-label="讀取信用狀態" />
  <q-banner v-else-if="credit?.status==='on_hold'" role="alert" class="bg-negative text-white">Customer Credit ON_HOLD；不能確認。</q-banner>
  <p v-else-if="credit?.configured">信用額度：{{ credit.currencyCode }} {{ credit.creditLimit??'未設定' }}；只供參考，不自動阻擋。</p>
  <p v-else>信用狀態{{ credit?'未設定':'參考不可用' }}；提交時會重新驗證。</p><p v-if="creditError" role="alert">{{ creditError }}</p>
 </q-card-section><q-card-actions align="right"><q-btn flat label="返回" @click="dialog=false" /><q-btn color="primary" label="提交確認" :disable="creditLoading||credit?.status==='on_hold'||!canConfirm" @click="confirm" /></q-card-actions></q-card></q-dialog>
 <q-dialog v-model="lifecycleDialog" aria-labelledby="sales-lifecycle-title"><q-card class="confirmation-dialog"><q-card-section>
  <h2 id="sales-lifecycle-title" class="text-h6 q-ma-none q-mb-md">{{ lifecycleLabels[lifecycleAction] }}</h2>
  <p>{{ lifecycleAction==='withdraw'?'釋放所有剩餘保留及 Backorder，回到 Draft。':lifecycleAction==='cancel'?'取消全部尚未履約數量，釋放剩餘保留。':'保留已履約數量，取消其餘數量並釋放剩餘保留。' }}</p>
  <q-input v-model="reason" label="操作原因（5–500 字元）" type="textarea" outlined :rules="[()=>validReason||'請輸入 5–500 個有效字元']" />
 </q-card-section><q-card-actions align="right"><q-btn flat label="返回" @click="lifecycleDialog=false" /><q-btn color="negative" label="提交訂單操作" :disable="!validReason||lifecycleBusy" @click="submitLifecycle" /></q-card-actions></q-card></q-dialog>
 </main></div></template>
<style scoped>.confirmation-dialog { width:100%; max-width:36rem; overflow-wrap:anywhere; }.pre-line { white-space:pre-line; }.break-word { overflow-wrap:anywhere; }</style>
