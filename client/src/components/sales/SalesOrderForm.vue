<script setup>
import { computed,onBeforeUnmount,reactive,ref,toRaw,watch } from "vue";
import { onBeforeRouteLeave,onBeforeRouteUpdate } from "vue-router";
import FormPanel from "@/framework/ui/FormPanel.vue";
import SalesOrderLineEditor from "./SalesOrderLineEditor.vue";
import SalesOrderQuantitySummary from "./SalesOrderQuantitySummary.vue";
import sales from "@/services/sales.js";
const props=defineProps({document:{type:Object,default:null},onSave:{type:Function,required:true}}),emit=defineEmits(["saved","reload"]);
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const form=reactive({}),customers=ref([]),warehouses=ref([]),customer=ref(null),lookupError=ref(""),loading=reactive({customers:false,warehouses:false});
const stale=ref(false),intent=ref(null),uncertain=ref(false),saving=ref(false);const pristine=ref("");const controllers={};
function reset(document){
 Object.assign(form,{customerId:document?.customerId ?? null,currencyCode:document?.currencyCode ?? "",paymentTermId:document?.paymentTermId ?? null,
  fulfillmentWarehouseId:document?.fulfillmentWarehouseId ?? null,orderDate:document?.orderDate ?? today(),requestedDeliveryDate:document?.requestedDeliveryDate ?? null,
  customerPoReference:document?.customerPoReference ?? "",notes:document?.notes ?? "",lines:(document?.lines ?? []).map(line=>({...line}))});
 customer.value=document?{customerId:document.customerId,customerCode:document.customerCode,displayName:document.customerName,defaultCurrencyCode:document.currencyCode,defaultPaymentTermId:document.paymentTermId}:null;
 warehouses.value=document?[{id:document.fulfillmentWarehouseId,code:document.warehouseCode,name:document.warehouseName}]:[];
 pristine.value=JSON.stringify(form);stale.value=false;intent.value=null;uncertain.value=false;
}
watch(()=>props.document,reset,{immediate:true});
const dirty=computed(()=>JSON.stringify(form)!==pristine.value);
function canLeave(){return !saving.value && ((!dirty.value&&!uncertain.value)||window.confirm("有未儲存或結果尚未確認的變更，確定離開？"));}
onBeforeRouteLeave(canLeave);onBeforeRouteUpdate(canLeave);
function beforeUnload(event){if(saving.value||dirty.value||uncertain.value){event.preventDefault();event.returnValue="";}}
window.addEventListener("beforeunload",beforeUnload);onBeforeUnmount(()=>{window.removeEventListener("beforeunload",beforeUnload);Object.values(controllers).forEach(c=>c.abort());});
async function lookup(kind,q,update){controllers[kind]?.abort();const controller=new AbortController();controllers[kind]=controller;loading[kind]=true;lookupError.value="";
 try{const result=await sales[kind==="customers"?"lookupCustomers":"lookupWarehouses"]({q,page:1,pageSize:20,signal:controller.signal});if(!controller.signal.aborted)update(()=>{(kind==="customers"?customers:warehouses).value=result.items;});}
 catch(error){if(!controller.signal.aborted){lookupError.value=error.message || "搜尋失敗，請重試";update(()=>{});}}
 finally{if(controllers[kind]===controller)loading[kind]=false;}
}
function chooseCustomer(value){customer.value=value;form.customerId=value?.customerId ?? null;if(value){form.currencyCode=value.defaultCurrencyCode ?? "";form.paymentTermId=value.defaultPaymentTermId ?? null;}}
watch(()=>form.currencyCode,(value,previous)=>{if(previous&&value!==previous)form.lines=form.lines.map(line=>({...line,unitSellingPrice:""}));},{flush:"sync"});
const paymentTerms=computed(()=>{const id=customer.value?.defaultPaymentTermId ?? props.document?.paymentTermId;return id?[{value:id,label:props.document?.paymentTermId===id?props.document.paymentTermName:"客戶預設條款"}]:[];});
const required=value=>Boolean(value)||"必填";
function payload(){return {customerId:form.customerId,currencyCode:form.currencyCode,paymentTermId:form.paymentTermId,fulfillmentWarehouseId:form.fulfillmentWarehouseId,
 orderDate:form.orderDate,requestedDeliveryDate:form.requestedDeliveryDate || null,customerPoReference:form.customerPoReference,notes:form.notes,...(props.document?{version:props.document.version}:{}),
 lines:form.lines.map(line=>({...((props.document&&line.id)?{id:line.id}:{}),skuId:line.skuId,skuUomId:line.skuUomId,quantity:line.quantity,unitSellingPrice:line.unitSellingPrice,lineNote:line.lineNote ?? ""}))};}
async function save(){if(stale.value)throw new Error("資料已被修改；你的輸入仍保留，請載入最新資料。");if(!form.lines.length)throw new Error("請新增至少一項明細。");
 if(!intent.value)intent.value={...payload(),eventId:crypto.randomUUID()};saving.value=true;
 try{const result=await props.onSave(structuredClone(toRaw(intent.value)));pristine.value=JSON.stringify(form);intent.value=null;uncertain.value=false;saving.value=false;emit("saved",result);return result;}
 catch(error){uncertain.value=["TIMEOUT","NETWORK_ERROR","TRANSACTION_OUTCOME_UNKNOWN","IDEMPOTENCY_IN_PROGRESS"].includes(error.code)||error.status>=500;stale.value=error.code==="VERSION_CONFLICT";if(!uncertain.value)intent.value=null;
  const safe=new Error(uncertain.value?"結果尚未確認；保留原提交，請重試確認結果。":stale.value?"版本已更改；你的輸入仍保留，請載入最新資料後再修改。":error.message || "儲存失敗");
  if(!uncertain.value&&!stale.value){if(Array.isArray(error.details))safe.details=error.details;else if(error.details?.field)safe.details=[{location:"body",path:"/"+error.details.field.replace(/\[(\d+)\]/g,".$1").split(".").join("/"),message:safe.message}];}throw safe;
 }finally{saving.value=false;}}
function reload(){if(!dirty.value||window.confirm("載入最新資料會取代未儲存輸入，確定繼續？"))emit("reload");}
</script>
<template><div>
 <q-banner v-if="lookupError" role="alert" class="bg-negative text-white q-mb-md">{{ lookupError }}；請重新搜尋。</q-banner>
 <q-banner v-if="stale" role="alert" class="bg-warning text-dark q-mb-md">資料已更改，你的輸入仍保留。<template #action><q-btn flat label="載入最新資料" @click="reload" /></template></q-banner>
 <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md">結果尚未確認；請先重試同一提交以確認結果。</q-banner>
 <FormPanel :on-submit="save" v-slot="{submitting,fieldError}"><fieldset class="q-pa-none q-ma-none" :disabled="submitting||uncertain" :inert="submitting||uncertain"><legend class="text-h6 q-mb-md">銷售訂單資料</legend>
  <div class="row q-col-gutter-md">
   <div class="col-12 col-md-6"><q-select :model-value="customer" label="客戶 *" :options="customers" :option-label="row=>`${row.customerCode} — ${row.displayName}`" use-input input-debounce="250" :loading="loading.customers" :rules="[required]" :error="!!fieldError('customerId')" :error-message="fieldError('customerId')" outlined dense @filter="(q,update)=>lookup('customers',q,update)" @update:model-value="chooseCustomer"><template #no-option><q-item><q-item-section>沒有符合條件的啟用客戶；請縮小搜尋。</q-item-section></q-item></template></q-select></div>
   <div class="col-12 col-md-3"><q-input v-model="form.currencyCode" label="貨幣 *" hint="更換貨幣後須重新輸入售價" maxlength="3" :rules="[value=>/^[A-Z]{3}$/.test(value)||'請輸入三位大寫貨幣代碼']" :error="!!fieldError('currencyCode')" :error-message="fieldError('currencyCode')" outlined dense /></div>
   <div class="col-12 col-md-3"><q-select v-model="form.paymentTermId" label="付款條款（選填）" :options="paymentTerms" emit-value map-options clearable outlined dense /></div>
   <div class="col-12 col-md-6"><q-select v-model="form.fulfillmentWarehouseId" label="履約倉庫 *" :options="warehouses" :option-label="row=>`${row.code} — ${row.name}`" option-value="id" emit-value map-options use-input input-debounce="250" :rules="[required]" :loading="loading.warehouses" :error="!!fieldError('fulfillmentWarehouseId')" :error-message="fieldError('fulfillmentWarehouseId')" outlined dense @filter="(q,update)=>lookup('warehouses',q,update)" /></div>
   <div class="col-12 col-md-6"><q-input v-model="form.orderDate" label="訂單日期 *" type="date" :rules="[required]" outlined dense /></div>
   <div class="col-12 col-md-6"><q-input v-model="form.requestedDeliveryDate" label="要求送貨日期（選填）" type="date" :rules="[value=>!value||value>=form.orderDate||'要求送貨日期不可早於訂單日期']" outlined dense /></div>
   <div class="col-12 col-md-6"><q-input v-model="form.customerPoReference" label="客戶 PO" maxlength="190" outlined dense /></div>
   <div class="col-12"><q-input v-model="form.notes" label="備註" type="textarea" autogrow maxlength="2000" outlined dense /></div>
  </div>
  <q-banner v-if="customer?.defaultCurrencyCode&&form.currencyCode!==customer.defaultCurrencyCode" class="bg-warning text-dark q-mb-md">貨幣與客戶預設不同；售價不自動換算。</q-banner>
  <q-banner v-if="customer?.credit?.status==='on_hold'" class="bg-warning text-dark q-mb-md">客戶信用暫停；Draft 可儲存，確認訂單時會重新驗證信用。</q-banner>
  <p v-else-if="customer?.credit?.creditLimit" class="text-caption">信用限額參考：{{ customer.credit.currencyCode }} {{ customer.credit.creditLimit }}；不代表可用信用或庫存承諾。</p>
  <SalesOrderLineEditor v-model="form.lines" :currency-code="form.currencyCode" :field-error="fieldError" />
 </fieldset><div class="sales-order-summary"><SalesOrderQuantitySummary :lines="form.lines" :currency-code="form.currencyCode" :saved-total="document?.totalAmount ?? null" /><q-btn class="q-mt-md" color="primary" type="submit" :label="uncertain?'重試確認結果':'儲存 Draft 銷售訂單'" :loading="submitting" :disable="stale" /></div></FormPanel>
</div></template>
<style scoped>fieldset { border:0; min-width:0; }.sales-order-summary { position:sticky; bottom:0; z-index:1; background:var(--app-bg); padding:.5rem 0; border-top:1px solid var(--app-border); }</style>
