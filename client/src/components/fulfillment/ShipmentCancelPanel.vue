<script setup>
import {computed,onBeforeUnmount,ref,watch} from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import {confirm} from "@/framework/ui/confirm.js";
import {useSessionStore} from "@/stores/session.js";
import shipment,{shipmentFailure,shipmentOriginalReference} from "@/services/shipment.js";
const props=defineProps({document:{type:Object,required:true},disabled:Boolean}),emit=defineEmits(["saved","pending","permissionLost"]),session=useSessionStore(),reason=ref(""),pending=ref(null),busy=ref(false),error=ref(""),unreadable=ref(false);let generation=0;
const allowed=computed(()=>["fulfillment.view","fulfillment.operation"].every(value=>session.permissions.includes(value))&&props.document.allowedActions.includes("cancel")),key=()=>`shipment.cancel:${session.user?.id}:${props.document.id}`;
watch([()=>props.document.id,()=>session.user?.id,()=>session.permissions.join('|')],()=>{generation++;reason.value="";pending.value=null;error.value="";unreadable.value=false;busy.value=false;try{const raw=sessionStorage.getItem(key());if(raw){const saved=JSON.parse(raw),value=shipmentOriginalReference(saved.eventId,saved.correlationId);if(saved.statusUrl!==value.statusUrl||Object.keys(saved).length!==3)throw new Error();pending.value=value;}}catch{unreadable.value=true;error.value="無法讀取原取消操作，請保留此頁並聯絡管理員。";}},{immediate:true});
watch([pending,busy,unreadable],()=>emit("pending",busy.value||!!pending.value||unreadable.value),{immediate:true});
onBeforeUnmount(()=>{generation++;emit("pending",false);});
async function recover(){if(!pending.value||busy.value)return;const current=generation,storageKey=key();busy.value=true;error.value="";
 try{const value=await shipment.getOperation(pending.value.eventId);if(current!==generation)return;if(value.status==="IN_PROGRESS"){error.value="原取消操作仍在處理，請稍後查詢同一事件。";return;}
  if(value.status==="SUCCEEDED"&&(value.result.id!==props.document.id||value.result.status!=="CANCELLED"))throw {status:503};sessionStorage.removeItem(storageKey);pending.value=null;if(value.status==="SUCCEEDED")emit("saved");else error.value=shipmentFailure({status:409,code:value.publicErrorCode}).message;
 }catch(cause){if(current===generation)error.value=shipmentFailure(cause).message;}finally{if(current===generation)busy.value=false;}}
async function submit(){if(!allowed.value||props.disabled||busy.value||pending.value||unreadable.value)return;const current=generation,version=props.document.version;
 if(!await confirm({title:"取消出貨草稿",message:"只取消這張出貨草稿，不會釋放原履約單的庫存分配。成功後可回履約單建立新草稿。",okLabel:"確認取消出貨草稿"}))return;
 if(current!==generation||version!==props.document.version||!allowed.value||props.disabled)return;const reference=shipmentOriginalReference(crypto.randomUUID()),storageKey=key();busy.value=true;error.value="";
 try{try{sessionStorage.setItem(storageKey,JSON.stringify(reference));}catch{unreadable.value=true;throw new Error();}pending.value=reference;
  await shipment.cancelDraft(props.document.id,{eventId:reference.eventId,version,reason:reason.value});if(current!==generation)return;sessionStorage.removeItem(storageKey);pending.value=null;emit("saved");
 }catch(cause){if(current!==generation)return;const failure=shipmentFailure(cause);if([401,403].includes(cause?.status))emit("permissionLost");if(failure.action!=="recover"&&!unreadable.value){sessionStorage.removeItem(storageKey);pending.value=null;}error.value=unreadable.value?"無法保存原取消識別碼，未提交取消操作。":failure.message;throw new Error(error.value);}finally{if(current===generation)busy.value=false;}}
</script>
<template><section v-if="allowed||pending||unreadable" aria-label="取消出貨草稿" class="q-mt-lg"><h2 class="text-h6">取消出貨草稿</h2><q-banner v-if="error" role="alert" class="bg-warning text-dark q-mb-md">{{ error }}</q-banner><q-banner v-if="pending" role="status" class="bg-warning text-dark q-mb-md">原取消操作：{{ pending.eventId }}<template #action><q-btn flat label="查詢原取消結果" :loading="busy" @click="recover" /></template></q-banner><FormPanel v-if="allowed" :on-submit="submit" v-slot="{submitting}"><q-input v-model="reason" label="出貨取消原因（選填）" type="textarea" maxlength="500" outlined :disable="disabled||busy||!!pending||unreadable||submitting" /><q-btn class="q-mt-md" type="submit" color="negative" label="取消出貨草稿" :disable="disabled||!!pending||unreadable" :loading="busy||submitting" /></FormPanel></section></template>
