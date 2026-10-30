<script setup>
import {computed,nextTick,reactive,ref,toRaw,watch} from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import {confirm} from "@/framework/ui/confirm.js";
import {useSessionStore} from "@/stores/session.js";
import fulfillment,{fulfillmentFailure} from "@/services/fulfillment.js";
const props=defineProps({document:{type:Object,required:true}}),emit=defineEmits(["saved","reload"]),session=useSessionStore();
const pending=ref(null),rejected=ref(null),error=ref(""),summary=ref(null),busy=ref(false),unreadable=ref(false),stale=ref(false),fields=reactive({reason:"",returned:false});
const operate=computed(()=>["fulfillment.view","fulfillment.operation"].every(permission=>session.permissions.includes(permission))),canCancel=computed(()=>operate.value&&props.document.allowedActions.includes("cancel"));
const key=()=>`fulfillment.cancel:${session.user?.id}:${props.document.id}`,draftKey=()=>`fulfillment.cancelDraft:${session.user?.id}:${props.document.id}`;
function validate(body){if(!body||Object.keys(body).sort().join(',')!=="eventId,goodsReturnedToOriginalBins,reason,version"||typeof body.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.eventId)||!Number.isSafeInteger(body.version)||body.version<1||body.version>4294967295||typeof body.goodsReturnedToOriginalBins!=="boolean"||typeof body.reason!=="string"||[...body.reason].length>500||body.reason!==""&&[...body.reason.trim()].length<5||/[\p{Cc}\p{Cf}]/u.test(body.reason))throw new Error("取消資料不正確，請核對原因及原資料版本");return body;}
watch(error,value=>{if(value)nextTick(()=>summary.value?.focus());});
function restore(){pending.value=null;rejected.value=null;error.value="";busy.value=false;unreadable.value=false;stale.value=false;fields.reason="";fields.returned=false;if(!operate.value)return;try{const raw=sessionStorage.getItem(key()),old=sessionStorage.getItem(draftKey());if(raw)pending.value=validate(JSON.parse(raw));if(old)rejected.value=validate(JSON.parse(old));}catch{unreadable.value=true;error.value="無法讀取原取消操作，請保留此頁並聯絡管理員";}}
watch([()=>props.document.id,()=>session.user?.id,()=>session.permissions.join('|')],restore,{immediate:true});
async function send(input){
 if(!operate.value||busy.value||unreadable.value)return;
 const actor=session.user.id,id=props.document.id,storageKey=key(),rejectedKey=draftKey(),wasUncertain=!!pending.value,body=structuredClone(toRaw(pending.value??input));busy.value=true;error.value="";
 try{
  try{sessionStorage.setItem(storageKey,JSON.stringify(body));}catch{error.value="無法保存原取消操作，請允許分頁儲存後再試";return;}
  pending.value=body;const result=await fulfillment.cancel(id,body),outcome=result?.outcome;
  if(!outcome||outcome.id!==id||outcome.status!=="CANCELLED"||outcome.version!==body.version+1||result.fulfillment?.id!==id||result.fulfillment.status!=="CANCELLED"||!Number.isInteger(result.fulfillment.version)||result.fulfillment.version<outcome.version)throw {status:503,code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"};
  if(session.user?.id!==actor||props.document.id!==id)return;
  sessionStorage.removeItem(rejectedKey);sessionStorage.removeItem(storageKey);pending.value=null;rejected.value=null;emit("saved",result);
 }catch(e){
  if(session.user?.id!==actor||props.document.id!==id)return;
  if(e.status===409&&["VERSION_CONFLICT","FULFILLMENT_STATE_CONFLICT"].includes(e.code)||!wasUncertain&&e.status===400&&["FULFILLMENT_INPUT_INVALID","FULFILLMENT_QUANTITY_INVALID"].includes(e.code)){try{sessionStorage.setItem(rejectedKey,JSON.stringify(body));rejected.value=body;sessionStorage.removeItem(storageKey);pending.value=null;stale.value=true;}catch{unreadable.value=true;}}
  error.value=fulfillmentFailure(e).message;
 }finally{if(session.user?.id===actor&&props.document.id===id)busy.value=false;}
}
async function submit(){
 if(!canCancel.value||stale.value)throw new Error("請重新載入目前資料後核對；原輸入仍保留");
 const actor=session.user.id,id=props.document.id,body=validate({eventId:crypto.randomUUID(),version:props.document.version,reason:fields.reason.trim(),goodsReturnedToOriginalBins:props.document.status==="PICKED"&&fields.returned});
 if(props.document.status!=="DRAFT"&&!body.reason||props.document.status==="PICKED"&&!body.goodsReturnedToOriginalBins)throw new Error("請填寫5至500字取消原因；已揀貨時必須確認貨物已放回原庫位及批次");
 if(!await confirm({title:"取消履約工作",message:"確認取消目前履約工作？成功後會釋放未完成的分配及履約計劃，並保留歷史。",okLabel:"確認取消履約工作"}))return;
 if(session.user?.id!==actor||props.document.id!==id||!canCancel.value)return;
 await send(body);if(error.value)throw new Error(error.value);
}
</script>
<template><section v-if="operate&&(canCancel||pending||rejected||unreadable)" aria-label="取消履約工作" class="q-mt-lg"><h2 class="text-h6">取消履約工作</h2><p>取消後保留歷史。已揀貨時，必須先把貨物放回原庫位及批次，再確認取消。</p>
 <q-banner v-if="pending" role="status" class="bg-warning text-dark q-mb-md">原取消結果尚未確認，請沿用原操作確認，勿另建取消操作。<template #action><q-btn flat label="確認原取消操作結果" :loading="busy" @click="send(pending)" /></template></q-banner>
 <div v-if="error" ref="summary" role="alert" tabindex="-1"><q-banner class="bg-warning text-dark q-mb-md">{{ error }}</q-banner></div>
 <section v-if="rejected" aria-label="先前被拒絕的取消輸入" class="q-my-md"><p>原版本 {{ rejected.version }}；原取消原因：{{ rejected.reason||'未填寫' }}。原實物確認：{{ rejected.goodsReturnedToOriginalBins?'已確認':'未確認' }}。</p><p>原輸入保留供核對；重新載入後必須重新確認實物處理。</p><q-btn v-if="!pending&&!unreadable" flat label="重新載入目前履約資料" @click="emit('reload')" /></section>
 <FormPanel v-if="canCancel&&!unreadable" :on-submit="submit" v-slot="{submitting}"><fieldset class="fulfillment-cancel-fields" :disabled="busy||!!pending||submitting" :inert="busy||!!pending||submitting"><legend>取消原因及實物確認</legend><q-input v-model="fields.reason" label="取消原因" :hint="document.status==='DRAFT'?'選填；填寫時須5至500字':'必填5至500字'" type="textarea" maxlength="1000" outlined /><q-checkbox v-if="document.status==='PICKED'" v-model="fields.returned" label="確認貨物已放回原庫位及批次" /></fieldset><q-btn color="negative" type="submit" label="提交取消履約工作" :loading="busy||submitting" :disable="!!pending||stale" class="q-mt-md" /></FormPanel>
</section></template>
<style scoped>
.fulfillment-cancel-fields { min-width: 0; border: 0; padding: 0; margin: 0; }
</style>
