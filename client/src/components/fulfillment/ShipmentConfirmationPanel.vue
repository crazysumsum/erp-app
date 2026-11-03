<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from "vue";
import {timestamp} from "@/components/fulfillment/fulfillmentPresentation.js";
import DataTable from "@/framework/ui/DataTable.vue";
import {confirm} from "@/framework/ui/confirm.js";
import fulfillment from "@/services/fulfillment.js";
import shipment,{shipmentFailure,shipmentOriginalReference,shipmentOperationReference} from "@/services/shipment.js";
import {useShipmentOperationPolling} from "@/components/fulfillment/useShipmentOperationPolling.js";
import {useSessionStore} from "@/stores/session.js";
const props=defineProps({document:{type:Object,required:true},disabled:Boolean}),emit=defineEmits(["settled","pending","permissionLost"]),session=useSessionStore();
const reference=ref(null),source=ref(null),loading=ref(false),busy=ref(false),error=ref(""),unreadable=ref(false),dialogOpen=ref(false),summary=ref(null),lastLookupAt=ref(null);let controller,generation=0;
const allowed=computed(()=>["fulfillment.view","fulfillment.operation"].every(value=>session.permissions.includes(value))&&props.document.allowedActions.includes("confirm"));
const {operation,error:pollError,loading:checking,polling,resolvedReference,refresh}=useShipmentOperationPolling({reference,shipmentId:()=>props.document.id,actorId:()=>session.user?.id});
watch(checking,value=>{if(value)lastLookupAt.value=Date.now();},{immediate:true});
const storageKey=()=>`shipment.confirm:${session.user?.id}:${props.document.id}`;
const columns=[{name:"sku",label:"SKU",field:"skuCode",align:"left"},{name:"bin",label:"庫位",field:"binCode",align:"left"},{name:"lot",label:"批次",field:row=>row.lotNumber||'—',align:"left"},{name:"expiry",label:"到期日",field:row=>row.expiryDate||'無到期日',align:"left"},{name:"quantity",label:"實揀／本次出貨",field:row=>`${row.pickedBaseQuantity} ${row.baseUomCode}`,align:"right"}];
function restore(){controller?.abort();generation++;lastLookupAt.value=null;source.value=null;error.value="";reference.value=null;unreadable.value=false;busy.value=false;loading.value=false;
 try{const raw=sessionStorage.getItem(storageKey());if(raw){const saved=JSON.parse(raw),value=shipmentOriginalReference(saved.eventId,saved.correlationId);if(saved.statusUrl!==value.statusUrl||Object.keys(saved).length!==3)throw new Error();reference.value=value;}
  else if(props.document.status==="SHIPPING"&&props.document.confirmationEventId)reference.value=shipmentOriginalReference(props.document.confirmationEventId);
 }catch{unreadable.value=true;error.value="無法保存或讀取原確認識別碼，請保留此頁並聯絡管理員。";}
}
watch([()=>props.document.id,()=>session.user?.id,()=>session.permissions.join('|')],restore,{immediate:true});
watch(()=>props.document.version,()=>{source.value=null;if(!reference.value&&props.document.status==="SHIPPING")restore();});
watch(resolvedReference,value=>{if(value)try{sessionStorage.setItem(storageKey(),JSON.stringify(value));}catch{unreadable.value=true;error.value="無法保存原確認識別碼，請保留此頁並聯絡管理員。";}});
watch(()=>operation.value?.status,status=>{if(status)error.value="";if(["SUCCEEDED","FAILED"].includes(status)){try{sessionStorage.removeItem(storageKey());}catch{unreadable.value=true;}emit("pending",false);emit("settled");}});
watch([reference,busy,unreadable,dialogOpen],()=>emit("pending",busy.value||unreadable.value||dialogOpen.value||!!reference.value&&!['SUCCEEDED','FAILED'].includes(operation.value?.status)),{immediate:true});
watch([error,pollError],()=>{if(error.value||pollError.value)nextTick(()=>summary.value?.$el?.focus());});
onBeforeUnmount(()=>{generation++;controller?.abort();emit("pending",false);});
async function loadSource(){
 controller?.abort();controller=new AbortController();const signal=controller.signal,current=++generation;loading.value=true;source.value=null;error.value="";
 try{const value=await fulfillment.getPickList(props.document.fulfillmentId,{signal});if(signal.aborted||current!==generation)return;
  if(value.status!=="PICKED"||value.id!==props.document.fulfillmentId||!Array.isArray(value.rows)||!value.rows.length||value.rows.length>5000||value.lines.length!==props.document.lines.length||props.document.lines.some(line=>!value.lines.some(item=>item.id===line.fulfillmentLineId&&item.pickedBaseQuantity===line.shippedBaseQuantity)))throw {status:409,code:"FULFILLMENT_SOURCE_CONFLICT"};source.value=value;
 }catch(cause){if(!signal.aborted&&current===generation)error.value=shipmentFailure(cause).message;}finally{if(!signal.aborted&&current===generation)loading.value=false;}
}
async function submit(){
 if(!allowed.value||props.disabled||busy.value||dialogOpen.value||!source.value||reference.value||unreadable.value)return;
 const actor=session.user?.id,id=props.document.id,version=props.document.version,current=generation;
 dialogOpen.value=true;let accepted;try{accepted=await confirm({title:"確認出貨",message:"確認以上全部實揀數量及送貨資料？成功後會原子扣減庫存並同步 Sales，不能再次出貨。",okLabel:"確認全部出貨"});}finally{dialogOpen.value=false;}if(!accepted)return;
 if(actor!==session.user?.id||id!==props.document.id||version!==props.document.version||current!==generation||!allowed.value||props.disabled||busy.value||reference.value||unreadable.value)return;
 const original=shipmentOriginalReference(crypto.randomUUID()),key=storageKey();busy.value=true;error.value="";
 try{try{sessionStorage.setItem(key,JSON.stringify(original));}catch{unreadable.value=true;error.value="無法保存原確認識別碼，請允許分頁儲存後再試。";return;}
  // Keep the original intent before POST; start GET polling only after its response.
  const result=await shipment.confirm(id,{eventId:original.eventId,version});if(actor!==session.user?.id||id!==props.document.id||current!==generation)return;
  if(result.outcome==="SHIPPING")reference.value=shipmentOperationReference(result);
  else{sessionStorage.removeItem(key);emit("settled");}
 }catch(cause){if(actor!==session.user?.id||id!==props.document.id||current!==generation)return;const failure=shipmentFailure(cause);error.value=failure.message;if([401,403].includes(cause?.status))emit("permissionLost");
  if(failure.action==="recover")reference.value=original;else sessionStorage.removeItem(key);
 }finally{if(actor===session.user?.id&&id===props.document.id&&current===generation)busy.value=false;}
}
function clearFailed(){if(operation.value?.status==="FAILED"&&props.document.status==="DRAFT"){reference.value=null;source.value=null;error.value="";}}
</script>
<template><section v-if="allowed||reference||unreadable||document.status==='SHIPPING'" aria-label="確認出貨與原事件恢復" class="q-mt-lg"><h2 class="text-h6">確認出貨</h2>
 <q-banner v-if="error||pollError" ref="summary" tabindex="-1" role="alert" class="bg-warning text-dark q-mb-md">{{ error||pollError.message }}<template #action><q-btn v-if="(error||pollError)&&document.status==='DRAFT'" flat label="返回履約單核對" :to="`/fulfillments/${document.fulfillmentId}`" /></template></q-banner>
 <q-banner v-if="reference" role="status" class="bg-warning text-dark q-mb-md"><p>原操作：{{ reference.eventId }}</p><p>最後查詢嘗試（香港時間）：{{ lastLookupAt===null?'尚未查詢':timestamp(lastLookupAt) }}</p><p v-if="resolvedReference?.correlationId">關聯識別碼：{{ resolvedReference.correlationId }}</p><p>{{ operation?.status==='SUCCEEDED'?'原確認已成功':operation?.status==='FAILED'?'原確認已失敗，輸入及歷史保留':polling?'正查詢同一確認結果；不會重新提交':'結果尚待確認，請繼續查詢原事件' }}</p><template #action><q-btn v-if="!operation||operation.status==='IN_PROGRESS'" flat label="查詢原確認結果" :loading="checking" :disable="polling" @click="refresh" /><q-btn v-if="operation?.status==='FAILED'&&document.status==='DRAFT'" flat label="已核對失敗結果，重新準備確認" @click="clearFailed" /></template></q-banner>
 <template v-if="allowed&&!reference&&!unreadable"><p>只會出貨已保存的實揀數量；不能在此更改 SKU、庫位、批次或數量。提交前請核對上方地址、聯絡人及物流資料。</p><q-btn flat label="載入完整出貨庫位摘要" :loading="loading" :disable="busy" @click="loadSource" />
  <DataTable v-if="source" :rows="source.rows" :columns="columns" row-key="allocationId" :initial-pagination="{page:1,rowsPerPage:100}"><template #no-data><p role="status">沒有可出貨明細。</p></template></DataTable>
  <p v-if="source">完整摘要共 {{ source.rows.length }} 筆庫位／批次，{{ document.lines.length }} 行。表格可分頁核對。</p><q-btn class="q-mt-md" color="primary" label="提交確認出貨" :loading="busy" :disable="disabled||!source||loading" @click="submit" />
 </template>
</section></template>
