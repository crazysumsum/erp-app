<script setup>
import {computed,onBeforeUnmount,reactive,ref,watch} from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import {confirm} from "@/framework/ui/confirm.js";
import {useSessionStore} from "@/stores/session.js";
import shipment,{shipmentFailure,shipmentOriginalReference} from "@/services/shipment.js";
const props=defineProps({fulfillmentId:{type:String,required:true},customerId:{type:String,required:true},draft:{type:Object,default:null},disabled:Boolean}),emit=defineEmits(["saved","pending","permissionLost","dirty"]),session=useSessionStore();
const addresses=ref([]),contacts=ref([]),loading=ref(false),busy=ref(false),error=ref(""),pending=ref(null),unreadable=ref(false),baseVersion=ref(null);
const formFields=draft=>({address:draft?`${draft.shippingAddressId}:${draft.shippingAddressVersion}`:null,contact:draft?.shippingContactId?`${draft.shippingContactId}:${draft.shippingContactVersion}`:null,carrierName:draft?.carrierName??"",trackingNumber:draft?.trackingNumber??"",packageCount:draft?.packageCount===null||!draft?"":String(draft.packageCount),totalWeight:draft?.totalWeight??"",weightUom:draft?.weightUom??"",notes:draft?.notes??""});
const fields=reactive(formFields(null));let controller,generation=0;
const dirty=computed(()=>!!props.draft&&Object.entries(formFields(props.draft)).some(([key,value])=>fields[key]!==value));
watch(dirty,value=>emit("dirty",value),{immediate:true});
const operate=computed(()=>["fulfillment.view","fulfillment.operation"].every(value=>session.permissions.includes(value))),locked=computed(()=>props.disabled||!operate.value||loading.value||busy.value||!!pending.value||unreadable.value);
const storageKey=()=>`shipment.${props.draft?'update':'create'}:${session.user?.id}:${props.draft?.id??props.fulfillmentId}`;
const addressOptions=computed(()=>addresses.value.map(row=>({value:`${row.addressId}:${row.version}`,label:[row.label,row.addressLine1,row.city,row.countryCode].filter(Boolean).join(" · ")}))),contactOptions=computed(()=>contacts.value.map(row=>({value:`${row.contactId}:${row.version}`,label:[row.name,row.phone||row.mobile,row.email].filter(Boolean).join(" · ")})));
async function choices(initial=false){
 controller?.abort();controller=new AbortController();const signal=controller.signal,current=++generation;loading.value=true;error.value="";
 try{const [a,c]=await Promise.all([shipment.listShippingAddresses(props.customerId,props.fulfillmentId,{signal}),shipment.listShippingContacts(props.customerId,props.fulfillmentId,{signal})]);if(signal.aborted||current!==generation)return;
  if(!Array.isArray(a?.items)||!Array.isArray(c?.items))throw {status:503};addresses.value=a.items;contacts.value=c.items;
  if(initial&&!props.draft){const address=a.items.find(row=>row.isDefault),contact=c.items.find(row=>row.isDefault);fields.address=address?`${address.addressId}:${address.version}`:null;fields.contact=contact?`${contact.contactId}:${contact.version}`:null;}
 }catch(cause){if(!signal.aborted&&current===generation){error.value=shipmentFailure(cause).message;if([401,403].includes(cause?.status))emit("permissionLost");}}
 finally{if(!signal.aborted&&current===generation)loading.value=false;}
}
function restore(){
 controller?.abort();generation++;pending.value=null;unreadable.value=false;busy.value=false;loading.value=false;error.value="";addresses.value=[];contacts.value=[];const draft=props.draft;baseVersion.value=draft?.version??null;
 Object.assign(fields,formFields(draft));
 if(!operate.value)return;try{const raw=sessionStorage.getItem(storageKey());if(raw){const saved=JSON.parse(raw),reference=shipmentOriginalReference(saved.eventId,saved.correlationId);if(saved.statusUrl!==reference.statusUrl||Object.keys(saved).length!==3)throw new Error();pending.value=reference;}}catch{unreadable.value=true;error.value="無法讀取原出貨操作，請保留此頁並聯絡管理員。";}choices(true);
}
watch([()=>props.fulfillmentId,()=>props.draft?.id,()=>session.user?.id,()=>session.permissions.join('|')],restore,{immediate:true});
watch([pending,busy,unreadable],()=>emit("pending",busy.value||!!pending.value||unreadable.value),{immediate:true});
onBeforeUnmount(()=>{generation++;controller?.abort();emit("pending",false);emit("dirty",false);});
async function recover(){
 if(!pending.value||busy.value||!operate.value)return;const current=generation,key=storageKey();busy.value=true;error.value="";
 try{const result=await shipment.getOperation(pending.value.eventId);if(current!==generation)return;
  if(result.status==="IN_PROGRESS"){error.value="原操作仍在處理，請稍後查詢同一操作。";return;}
  if(result.status==="SUCCEEDED"){if(result.result.status!=="DRAFT"||props.draft&&result.result.id!==props.draft.id)throw {status:503};const value=await shipment.getShipment(result.result.id);if(current!==generation)return;if(value.shipment.id!==result.result.id||value.shipment.fulfillmentId!==props.fulfillmentId||value.shipment.customer?.id!==props.customerId||value.shipment.version<result.result.version)throw {status:503};sessionStorage.removeItem(key);pending.value=null;emit("saved",value);}
  else{sessionStorage.removeItem(key);pending.value=null;error.value=shipmentFailure({status:409,code:result.publicErrorCode}).message;}
 }catch(cause){if(current===generation){error.value=shipmentFailure(cause).message;if([401,403].includes(cause?.status))emit("permissionLost");}}finally{if(current===generation)busy.value=false;}
}
async function acceptVersion(){if(props.draft&&await confirm({title:"核對目前出貨版本",message:"保留目前表單輸入，改用已重新載入的出貨版本？請先核對下方出貨摘要。",okLabel:"保留輸入並採用目前版本"}))baseVersion.value=props.draft.version;}
async function submit(){
 if(locked.value)return;const selected=addresses.value.find(row=>`${row.addressId}:${row.version}`===fields.address),contact=fields.contact===null?null:contacts.value.find(row=>`${row.contactId}:${row.version}`===fields.contact);
 if(!selected||fields.contact!==null&&!contact)throw new Error("請選擇有效的送貨地址及聯絡人；原選項失效時須重新選擇。");
 if(fields.packageCount&&!/^[1-9][0-9]*$/u.test(fields.packageCount))throw new Error("包裹數須為正整數。");
 const body={eventId:crypto.randomUUID(),...(props.draft?{version:baseVersion.value}:{}),shippingAddressId:Number(selected.addressId),shippingAddressVersion:selected.version,shippingContactId:contact?Number(contact.contactId):null,shippingContactVersion:contact?.version??null,carrierName:fields.carrierName,trackingNumber:fields.trackingNumber,packageCount:fields.packageCount?Number(fields.packageCount):null,totalWeight:fields.totalWeight||null,weightUom:fields.weightUom,notes:fields.notes};
 const current=generation,key=storageKey();busy.value=true;error.value="";
 try{const reference=shipmentOriginalReference(body.eventId);try{sessionStorage.setItem(key,JSON.stringify(reference));}catch{throw new Error("無法保存原操作識別碼，請允許分頁儲存後再試。");}pending.value=reference;
  const value=props.draft?await shipment.updateDraft(props.draft.id,body):await shipment.createDraft(props.fulfillmentId,body);if(current!==generation)return;
  sessionStorage.removeItem(key);pending.value=null;if(props.draft){baseVersion.value=value.shipment.version;Object.assign(fields,formFields(value.shipment));}emit("saved",value);
 }catch(cause){if(current!==generation)return;const failure=shipmentFailure(cause);if([401,403].includes(cause?.status))emit("permissionLost");if(failure.action!=="recover"){sessionStorage.removeItem(key);pending.value=null;}error.value=cause instanceof Error&&cause.message.startsWith("無法保存原操作")?cause.message:failure.message;throw new Error(error.value);}
 finally{if(current===generation)busy.value=false;}
}
</script>
<template><section v-if="operate" aria-label="出貨草稿資料" class="q-mt-lg"><h2 class="text-h6">{{ draft?'編輯出貨草稿':'建立出貨草稿' }}</h2><p>出貨數量取自已保存的實揀數量。地址及聯絡人須從目前有效的送貨資料選擇。</p>
 <q-banner v-if="error" role="alert" class="bg-warning text-dark q-mb-md">{{ error }}</q-banner>
 <q-banner v-if="pending" role="status" class="bg-warning text-dark q-mb-md">原操作 {{ pending.eventId }} 的結果尚未確認。<template #action><q-btn flat label="查詢原草稿操作" :loading="busy" @click="recover" /></template></q-banner>
 <p v-if="!loading&&!addresses.length">沒有可用送貨地址，請先在<router-link :to="`/customers/${customerId}`">客戶資料</router-link>新增有效送貨地址。</p>
 <q-btn flat label="重新載入有效地址及聯絡人" :disable="busy||!!pending" :loading="loading" @click="choices(false)" />
 <q-btn v-if="draft&&baseVersion!==draft.version" flat label="核對並採用目前出貨版本" :disable="locked" @click="acceptVersion" />
 <p v-if="dirty" role="status">表單有未保存修改；請先保存草稿，再確認出貨。</p>
 <FormPanel :on-submit="submit" v-slot="{submitting}"><fieldset class="shipment-form-fields" :disabled="locked||submitting" :inert="locked||submitting"><legend>送貨及物流資料</legend><div class="row q-col-gutter-md">
  <div class="col-12"><q-select v-model="fields.address" label="送貨地址" :options="addressOptions" emit-value map-options outlined :rules="[value=>!!value||'請選擇送貨地址']" /></div>
  <div class="col-12"><q-select v-model="fields.contact" label="送貨聯絡人（選填）" :options="contactOptions" emit-value map-options clearable outlined /></div>
  <div class="col-12 col-md-6"><q-input v-model="fields.carrierName" label="物流商（選填）" maxlength="190" outlined /></div><div class="col-12 col-md-6"><q-input v-model="fields.trackingNumber" label="追蹤號碼（選填）" maxlength="190" outlined /></div>
  <div class="col-12 col-md-4"><q-input v-model="fields.packageCount" label="包裹數（選填）" inputmode="numeric" maxlength="10" outlined /></div>
  <div class="col-8 col-md-5"><q-input v-model="fields.totalWeight" label="總重量（選填）" inputmode="decimal" maxlength="21" hint="精確數值，最多6位小數；不會四捨五入" outlined :rules="[value=>!value||/^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/u.test(value)&&/[1-9]/u.test(value)||'請輸入有效正數，最多14位整數及6位小數']" /></div>
  <div class="col-4 col-md-3"><q-select v-model="fields.weightUom" label="重量單位" :options="['','KG','G']" outlined :rules="[value=>fields.totalWeight?['KG','G'].includes(value)||'請選擇重量單位':value===''||'未填重量時請清除單位']" /></div>
  <div class="col-12"><q-input v-model="fields.notes" label="出貨備註（選填）" type="textarea" maxlength="2000" outlined /></div>
 </div></fieldset><q-btn class="q-mt-md" color="primary" type="submit" :label="draft?'保存出貨草稿':'建立出貨草稿'" :disable="locked||!addresses.length" :loading="busy||submitting" /></FormPanel>
</section></template>
<style scoped>
.shipment-form-fields { min-width: 0; border: 0; padding: 0; margin: 0; }
</style>
