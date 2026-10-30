<script setup>
import {computed,nextTick,onBeforeUnmount,reactive,ref,toRaw,watch} from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import {confirm} from "@/framework/ui/confirm.js";
import {useSessionStore} from "@/stores/session.js";
import fulfillment,{fulfillmentFailure} from "@/services/fulfillment.js";
import {loadPickScope,buildPickIntent,validatePickIntent,isDefinitivePickRejection} from "./fulfillmentPickModel.js";
const props=defineProps({document:{type:Object,required:true}}),emit=defineEmits(["saved","reload"]),session=useSessionStore();
const scope=ref(null),loading=ref(false),busy=ref(false),error=ref(""),errorSummary=ref(null),pending=ref(null),rejectedDraft=ref(null),unreadable=ref(false),stale=ref(false),amounts=reactive({}),reasons=reactive({});let controller;
watch(error,value=>{if(value)nextTick(()=>errorSummary.value?.focus());});
const operate=computed(()=>session.permissions.includes("fulfillment.operation")),canPick=computed(()=>operate.value&&props.document.allowedActions.includes("pickConfirm")),storageKey=()=>`fulfillment.pickConfirm:${session.user?.id}:${props.document.id}`;
const draftKey=()=>`fulfillment.pickDraft:${session.user?.id}:${props.document.id}`,rejectedRows=computed(()=>rejectedDraft.value?.lines.flatMap(line=>line.allocations.map(row=>({...row,fulfillmentLineId:line.fulfillmentLineId,shortPickReason:line.shortPickReason})))??[]);
function restore(){controller?.abort();scope.value=null;loading.value=false;busy.value=false;error.value="";pending.value=null;rejectedDraft.value=null;unreadable.value=false;stale.value=false;for(const key of Object.keys(amounts))delete amounts[key];for(const key of Object.keys(reasons))delete reasons[key];if(!operate.value)return;try{const raw=sessionStorage.getItem(storageKey()),draft=sessionStorage.getItem(draftKey());if(raw)pending.value=validatePickIntent(JSON.parse(raw));if(draft)rejectedDraft.value=validatePickIntent(JSON.parse(draft));}catch{unreadable.value=true;error.value="無法讀取已保存的原揀貨操作；請保留此頁並聯絡管理員";}}
watch([()=>props.document.id,()=>session.user?.id,()=>session.permissions.join('|')],restore,{immediate:true});onBeforeUnmount(()=>controller?.abort());
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";try{const result=await loadPickScope(fulfillment.getFulfillment,props.document.id,props.document.version,signal);if(signal.aborted)return;scope.value=result;stale.value=false;for(const row of result.allocations)amounts[row.id]??=row.availableBaseQuantity;}catch(e){if(!signal.aborted)error.value=e.code==="FULFILLMENT_PICK_SCOPE_INVALID"?e.message:fulfillmentFailure(e).message;}finally{if(!signal.aborted)loading.value=false;}}
async function send(input){
 if(!operate.value||busy.value||unreadable.value)return;
 const actor=session.user.id,id=props.document.id,key=storageKey(),rejectedKey=draftKey(),wasUncertain=!!pending.value,body=structuredClone(toRaw(pending.value??input));busy.value=true;error.value="";
 try{
  try{sessionStorage.setItem(key,JSON.stringify(body));}catch{error.value="無法保存原揀貨操作，請允許分頁儲存後再試";return;}
  pending.value=body;const result=await fulfillment.confirmPick(id,body),outcome=result?.outcome;
  if(!outcome||outcome.id!==id||outcome.status!=="PICKED"||outcome.version!==body.version+1||result.fulfillment?.id!==id||!Number.isInteger(result.fulfillment.version)||result.fulfillment.version<outcome.version)throw {status:503,code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"};
  if(session.user?.id!==actor||props.document.id!==id)return;
  sessionStorage.removeItem(rejectedKey);sessionStorage.removeItem(key);pending.value=null;rejectedDraft.value=null;scope.value=null;emit("saved",result);
 }catch(e){
  if(session.user?.id!==actor||props.document.id!==id)return;
  if(isDefinitivePickRejection(e,wasUncertain)){try{sessionStorage.setItem(rejectedKey,JSON.stringify(body));rejectedDraft.value=body;sessionStorage.removeItem(key);pending.value=null;stale.value=true;}catch{unreadable.value=true;}}
  error.value=fulfillmentFailure(e).message;
 }finally{if(session.user?.id===actor&&props.document.id===id)busy.value=false;}
}
async function submit(){if(stale.value||!canPick.value)throw new Error("請重新載入目前資料後核對；原輸入仍保留");const actor=session.user.id,id=props.document.id,body=buildPickIntent(scope.value,amounts,reasons,crypto.randomUUID());if(!await confirm({title:"確認揀貨",message:`確認已核對 ${scope.value.allocations.length} 筆分配的實揀數量及短揀原因？`,okLabel:"確認揀貨"}))return;if(session.user?.id!==actor||props.document.id!==id||!canPick.value)return;await send(body);if(error.value)throw new Error(error.value);}
const columns=[{name:"sku",label:"SKU",field:"fulfillmentLineId",align:"left"},{name:"id",label:"分配 ID",field:"id",align:"left"},{name:"bin",label:"庫位",field:"binCode",align:"left"},{name:"lot",label:"批次",field:"lotNumber",align:"left"},{name:"expiry",label:"到期日",field:row=>row.expiryDate??"無到期日",align:"left"},{name:"available",label:"目前分配量",field:"availableBaseQuantity",align:"right"},{name:"actual",label:"實揀數量（Base）",field:"id",align:"right"}];
const rejectedColumns=[{name:"line",label:"原履約行 ID",field:"fulfillmentLineId",align:"left"},{name:"allocation",label:"原分配 ID",field:"fulfillmentAllocationId",align:"left"},{name:"quantity",label:"原實揀輸入",field:"pickedBaseQuantity",align:"right"},{name:"reason",label:"原短揀原因",field:"shortPickReason",align:"left"}];
</script>
<template><section v-if="operate&&(canPick||pending||rejectedDraft||unreadable)" aria-label="確認揀貨" class="q-mt-lg"><h2 class="text-h6">確認揀貨</h2><p>核對所有分配的實揀量。短揀必須填寫原因；全部為零時請使用取消履約工作。</p>
 <q-banner v-if="pending" role="status" class="bg-warning text-dark q-mb-md">原揀貨結果尚未確認，輸入已鎖定；請沿用原操作確認結果。<template #action><q-btn flat label="確認原揀貨操作結果" :loading="busy" @click="send(pending)" /></template></q-banner>
 <div v-if="error" ref="errorSummary" role="alert" tabindex="-1"><q-banner class="bg-warning text-dark q-mb-md">{{ error }}</q-banner></div>
 <section v-if="rejectedDraft" aria-label="先前被拒絕的揀貨輸入" class="q-my-md"><h3 class="text-subtitle1">先前被拒絕的揀貨輸入（版本 {{ rejectedDraft.version }}）</h3><p>原輸入保留供核對，未套用到新分配。請重新載入目前履約資料，再按新分配逐項確認。</p><DataTable :rows="rejectedRows" :columns="rejectedColumns" row-key="fulfillmentAllocationId" :initial-pagination="{page:1,rowsPerPage:100}" /><q-btn v-if="!pending&&!unreadable" flat label="重新載入目前履約資料" @click="emit('reload')" /></section>
 <q-btn v-if="canPick&&!pending&&!unreadable" flat :label="scope?'重新載入完整揀貨明細':'載入完整揀貨明細'" :loading="loading" :disable="busy" @click="load" />
 <div v-if="loading" role="status" aria-busy="true"><q-skeleton type="rect" height="120px" /><span>正在讀取完整分配，請稍候</span></div>
 <FormPanel v-if="scope" :on-submit="submit" v-slot="{submitting}"><p>原資料版本 {{ scope.version }}；目前頁面版本 {{ document.version }}。重新載入不會靜默調整已輸入數量。</p><fieldset class="fulfillment-pick-fields" :disabled="busy||!!pending||unreadable||submitting" :inert="busy||!!pending||unreadable||submitting"><legend>實揀數量及短揀原因</legend>
  <DataTable :rows="scope.allocations" :columns="columns" :initial-pagination="{page:1,rowsPerPage:100}"><template #body-cell-sku="{row}"><q-td>{{ scope.lines.find(line=>line.id===row.fulfillmentLineId).skuCode }}</q-td></template><template #body-cell-actual="{row}"><q-td><q-input v-model="amounts[row.id]" :aria-label="`實揀數量：分配 ${row.id}`" label="實揀數量" inputmode="numeric" maxlength="16" dense outlined /></q-td></template></DataTable>
  <q-input v-for="line in scope.lines" :key="line.id" v-model="reasons[line.id]" :label="`短揀原因：${line.skuCode}`" hint="短揀時填寫5至500字" type="textarea" maxlength="1000" outlined class="q-mt-sm" />
 </fieldset><q-btn color="primary" type="submit" label="提交確認揀貨" :loading="submitting||busy" :disable="!!pending||unreadable||stale||loading||!canPick" class="q-mt-md" /></FormPanel>
</section></template>
<style scoped>
.fulfillment-pick-fields { min-width: 0; border: 0; padding: 0; margin: 0; }
</style>
