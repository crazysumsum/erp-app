<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, toRaw, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import FormPanel from "@/framework/ui/FormPanel.vue";
import sales from "@/services/sales.js";
const props = defineProps({ document: { type: Object, default: null }, conversion: { type: Boolean, default: false }, onSave: { type: Function, required: true } });
const emit = defineEmits(["saved", "reload"]);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const form = reactive({});
const customers = ref([]), skus = ref([]), warehouses = ref([]), selectedSku = ref(null), selectedUom = ref(null), customer = ref(null);
const barcode = ref("");
const paymentTerms = computed(() => { const id=customer.value?.defaultPaymentTermId ?? props.document?.paymentTermId;return id?[{value:id,label:props.document?.paymentTermId===id?props.document.paymentTermName:"客戶預設條款"}]:[]; });
const lookupError = ref(""), lookupBusy = reactive({ customers: false, skus: false, warehouses: false });
const stale = ref(false), intent = ref(null), uncertain = ref(false), root = ref(null), duplicateMessage = ref("");
const pristine = ref("");
const controllers = {};
function reset(document) {
 Object.assign(form, { customerId: document?.customerId ?? null, currencyCode: document?.currencyCode ?? "", paymentTermId: document?.paymentTermId ?? null,
  quotationDate: document?.quotationDate ?? today(), validUntil: document?.validUntil ?? today(), externalReference: document?.externalReference ?? "", notes: document?.notes ?? "",
  fulfillmentWarehouseId: null, orderDate: today(), requestedDeliveryDate: null, customerPoReference: "",
  lines: (document?.lines ?? []).map(line => ({ ...line })) });
 customer.value = document ? { customerId: document.customerId, customerCode: document.customerCode, displayName: document.customerName, defaultCurrencyCode: document.currencyCode, defaultPaymentTermId: document.paymentTermId } : null;
 pristine.value = JSON.stringify(form);stale.value=false;intent.value=null;uncertain.value=false;
}
watch(() => props.document, reset, { immediate: true });
const dirty = computed(() => JSON.stringify(form) !== pristine.value);
function beforeUnload(event) { if (dirty.value || uncertain.value) { event.preventDefault();event.returnValue=""; } }
window.addEventListener("beforeunload", beforeUnload);
const canLeave = () => (!dirty.value && !uncertain.value) || window.confirm("有未儲存或結果尚未確認的變更，確定離開？");
onBeforeRouteLeave(canLeave);onBeforeRouteUpdate(canLeave);
onBeforeUnmount(() => { window.removeEventListener("beforeunload",beforeUnload);Object.values(controllers).forEach(controller=>controller.abort()); });
async function lookup(kind, q = "", update, exactBarcode) {
 controllers[kind]?.abort();const controller=new AbortController();controllers[kind]=controller;lookupBusy[kind]=true;lookupError.value="";
 try {
  const method={customers:"lookupCustomers",skus:"lookupSkus",warehouses:"lookupWarehouses"}[kind];
  const result=await sales[method]({q,page:1,pageSize:20,signal:controller.signal,...(exactBarcode?{barcode:exactBarcode}:{}),...(kind==="skus" && /^[A-Z]{3}$/.test(form.currencyCode)?{currencyCode:form.currencyCode}:{})});
  if (controller.signal.aborted) return;
  if(exactBarcode)selectedSku.value=result.items[0] ?? null;
  const set=()=>{({customers,skus,warehouses})[kind].value=result.items;};if(update)update(set);else set();
 } catch(error) { if(!controller.signal.aborted) { lookupError.value=error.message || "搜尋失敗，請重試";update?.(()=>{}); } }
 finally { if(controllers[kind]===controller)lookupBusy[kind]=false; }
}
function chooseCustomer(value) { customer.value=value;form.customerId=value?.customerId ?? null;if(value){form.currencyCode=value.defaultCurrencyCode ?? "";form.paymentTermId=value.defaultPaymentTermId ?? null;} }
watch(selectedSku, value => { selectedUom.value=value?.uoms.find(uom=>uom.isDefaultSale)?.skuUomId ?? value?.uoms[0]?.skuUomId ?? null; });
watch(() => form.currencyCode, (value, previous) => {
 if(previous && value!==previous)for(const line of form.lines)line.unitSellingPrice="";
}, { flush: "sync" });
async function addLine() {
 const sku=selectedSku.value,uom=sku?.uoms.find(value=>value.skuUomId===selectedUom.value);if(!uom)return;
 const existing=form.lines.findIndex(line=>line.skuId===sku.skuId && line.skuUomId===uom.skuUomId);
 if(existing>=0){duplicateMessage.value="已存在此 SKU／UOM，請修改原明細數量。";await nextTick();root.value?.querySelector(`[data-line-index="${existing}"] input`)?.focus();return;}
 if(form.lines.length>=100)return;
 form.lines.push({skuId:sku.skuId,skuUomId:uom.skuUomId,skuCode:sku.skuCode,skuName:sku.skuName,uomCode:uom.uomCode,quantity:"1",unitSellingPrice:sku.suggestedPrice?.currency===form.currencyCode?sku.suggestedPrice.amount:"",lineNote:""});
 duplicateMessage.value="";selectedSku.value=null;
}
const validQuantity = value => /^\d{1,14}(?:\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
const validPrice = value => /^\d{1,15}(?:\.\d{1,4})?$/.test(value);
const required = value => Boolean(value) || "必填";
function scaled(value,places){const [whole,fraction=""]=value.split(".");return BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,"0"));}
const preview = computed(() => {
 if(!form.lines.length || form.lines.some(line=>!validQuantity(line.quantity)||!validPrice(line.unitSellingPrice)))return "—";
 const total=form.lines.reduce((sum,line)=>sum+(scaled(line.quantity,6)*scaled(line.unitSellingPrice,4)+500000n)/1000000n,0n);
 const digits=total.toString().padStart(5,"0");return `${digits.slice(0,-4)}.${digits.slice(-4)}`;
});
function payload() {
 const lines=form.lines.map(line=>({...(line.id && !props.conversion?{id:line.id}:{}),skuId:line.skuId,skuUomId:line.skuUomId,quantity:line.quantity,unitSellingPrice:line.unitSellingPrice,lineNote:line.lineNote}));
 const common={customerId:form.customerId,currencyCode:form.currencyCode,paymentTermId:form.paymentTermId,notes:form.notes,lines};
 if(props.conversion)return {version:props.document.version,order:{...common,fulfillmentWarehouseId:form.fulfillmentWarehouseId,orderDate:form.orderDate,requestedDeliveryDate:form.requestedDeliveryDate || null,customerPoReference:form.customerPoReference}};
 return {...common,...(props.document?{version:props.document.version}:{}),quotationDate:form.quotationDate,validUntil:form.validUntil,externalReference:form.externalReference};
}
async function save() {
 if(stale.value)throw new Error("資料已被修改；你的輸入仍保留，請明確載入最新資料。");
 if(!form.lines.length)throw new Error("請新增至少一項明細。");
 if(!intent.value)intent.value={...payload(),eventId:crypto.randomUUID()};
 try { const result=await props.onSave(structuredClone(toRaw(intent.value)));pristine.value=JSON.stringify(form);intent.value=null;uncertain.value=false;emit("saved",result);return result; }
 catch(error) {
  uncertain.value=["TIMEOUT","NETWORK_ERROR","TRANSACTION_OUTCOME_UNKNOWN","IDEMPOTENCY_IN_PROGRESS"].includes(error.code) || error.status>=500;
  if(!uncertain.value)intent.value=null;
  stale.value=error.code==="VERSION_CONFLICT";
  const message=uncertain.value?"結果尚未確認；保留原提交，請重試確認結果。":stale.value?"版本已更改；你的輸入仍保留，請載入最新資料後再修改。":`${error.message || "儲存失敗"}${error.details?.field?`（${error.details.field}）`:""}`;
  const safe=new Error(message);if(Array.isArray(error.details))safe.details=error.details;throw safe;
 }
}
function reload(){if(!dirty.value || window.confirm("載入最新資料會取代未儲存輸入，確定繼續？"))emit("reload");}
</script>

<template>
 <div ref="root">
  <q-banner v-if="lookupError" role="alert" class="bg-negative text-white q-mb-md">{{ lookupError }}；請重新搜尋。</q-banner>
  <q-banner v-if="stale" role="alert" class="bg-warning text-dark q-mb-md">資料已更改，你的輸入仍保留。<template #action><q-btn flat label="載入最新資料" @click="reload" /></template></q-banner>
  <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md">結果尚未確認；重試會使用同一提交，請先確認結果。</q-banner>
  <FormPanel :on-submit="save" v-slot="{ submitting, fieldError }">
   <fieldset class="q-pa-none q-ma-none" :disabled="submitting || uncertain" :inert="submitting || uncertain">
    <legend class="text-h6 q-mb-md">{{ conversion ? '轉為銷售訂單' : '報價資料' }}</legend>
    <div class="row q-col-gutter-md">
     <div class="col-12 col-md-6"><q-select :model-value="customer" label="客戶 *" :options="customers" :option-label="row=>`${row.customerCode} — ${row.displayName}`" use-input input-debounce="250" :loading="lookupBusy.customers" :rules="[required]" outlined dense @filter="(q,update)=>lookup('customers',q,update)" @update:model-value="chooseCustomer"><template #no-option><q-item><q-item-section>沒有符合條件的啟用客戶；請縮小搜尋。</q-item-section></q-item></template></q-select></div>
     <div class="col-12 col-md-3"><q-input v-model="form.currencyCode" label="貨幣 *" hint="更換貨幣後須重新輸入售價" maxlength="3" :rules="[value=>/^[A-Z]{3}$/.test(value)||'請輸入三位大寫貨幣代碼']" :error="!!fieldError('currencyCode')" :error-message="fieldError('currencyCode')" outlined dense /></div>
     <div class="col-12 col-md-3"><q-select v-model="form.paymentTermId" label="付款條款（選填）" :options="paymentTerms" emit-value map-options clearable outlined dense /></div>
     <div class="col-12 col-md-6"><q-input v-if="!conversion" v-model="form.quotationDate" type="date" label="報價日期 *" :rules="[required]" outlined dense /><q-input v-else v-model="form.orderDate" type="date" label="訂單日期 *" :rules="[required]" outlined dense /></div>
     <div class="col-12 col-md-6"><q-input v-if="!conversion" v-model="form.validUntil" type="date" label="有效至 *" :rules="[value=>value>=form.quotationDate || '有效日期不可早於報價日期']" outlined dense /><q-select v-else v-model="form.fulfillmentWarehouseId" label="履約倉庫 *" :options="warehouses" :option-label="row=>`${row.code} — ${row.name}`" option-value="id" emit-value map-options use-input input-debounce="250" :rules="[required]" :loading="lookupBusy.warehouses" outlined dense @filter="(q,update)=>lookup('warehouses',q,update)" /></div>
     <div v-if="conversion" class="col-12 col-md-6"><q-input v-model="form.requestedDeliveryDate" type="date" label="要求送貨日期（選填）" outlined dense /></div>
     <div class="col-12 col-md-6"><q-input v-if="!conversion" v-model="form.externalReference" label="參考編號" maxlength="190" outlined dense /><q-input v-else v-model="form.customerPoReference" label="客戶 PO" maxlength="190" outlined dense /></div>
     <div class="col-12"><q-input v-model="form.notes" label="備註" type="textarea" autogrow maxlength="2000" outlined dense /></div>
    </div>
    <q-banner v-if="customer?.defaultCurrencyCode && form.currencyCode!==customer.defaultCurrencyCode" class="bg-warning text-dark q-mb-md">貨幣與客戶預設不同；售價不自動換算。</q-banner>
    <q-banner v-if="customer?.credit?.status==='on_hold'" class="bg-warning text-dark q-mb-md">客戶信用暫停；Draft 可儲存，確認訂單時會重新驗證信用。</q-banner>
    <p v-else-if="customer?.credit?.creditLimit" class="text-caption">信用限額參考：{{ customer.credit.currencyCode }} {{ customer.credit.creditLimit }}；不代表可用信用或庫存承諾。</p>
    <h2 class="text-h6 q-ma-none q-my-md">明細（{{ form.lines.length }}／100）</h2>
    <div class="row q-col-gutter-md q-mb-md">
     <div class="col-12 col-md-6"><q-select v-model="selectedSku" label="搜尋 SKU" :options="skus" :option-label="row=>`${row.skuCode} — ${row.skuName}`" use-input input-debounce="250" :loading="lookupBusy.skus" outlined dense @filter="(q,update)=>lookup('skus',q,update)"><template #no-option><q-item><q-item-section>沒有符合條件的可售 SKU；請縮小搜尋。</q-item-section></q-item></template></q-select></div>
     <div class="col-12 col-md-3"><q-select v-model="selectedUom" label="銷售單位" :options="selectedSku?.uoms ?? []" option-value="skuUomId" :option-label="uom=>`${uom.uomCode} — ${uom.uomName}`" emit-value map-options outlined dense /></div>
     <div class="col-12 col-md-3"><q-btn label="新增明細" :disable="!selectedUom || (form.lines.length>=100 && !form.lines.some(line=>line.skuId===selectedSku?.skuId && line.skuUomId===selectedUom))" @click="addLine" /></div>
    </div>
    <div class="row q-gutter-sm q-mb-md"><q-input v-model="barcode" label="條碼（精確搜尋）" maxlength="190" outlined dense /><q-btn label="搜尋條碼" :disable="!barcode.trim()" :loading="lookupBusy.skus" @click="lookup('skus','',undefined,barcode)" /></div>
    <p v-if="duplicateMessage" role="status">{{ duplicateMessage }}</p>
    <p v-if="!form.lines.length" role="status">尚未新增明細；搜尋可售 SKU 後選擇單位。</p>
    <q-card v-for="(line,index) in form.lines" :key="`${line.skuId}-${line.skuUomId}`" flat bordered class="q-mb-md" data-testid="quotation-line">
     <q-card-section><h3 class="text-subtitle1 q-ma-none">{{ index+1 }}. {{ line.skuCode }} — {{ line.skuName }}（{{ line.uomCode }}）</h3>
      <div class="row q-col-gutter-md q-mt-xs"><div class="col-12 col-md-4" :data-line-index="index"><q-input v-model="line.quantity" :label="`數量 ${index+1} *`" inputmode="decimal" :rules="[value=>validQuantity(value)||'數量必須大於零，最多六位小數']" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="line.unitSellingPrice" :label="`售價 ${index+1} *`" inputmode="decimal" :rules="[value=>validPrice(value)||'請輸入非負售價，最多四位小數']" outlined dense /></div><div class="col-12 col-md-4"><q-btn flat color="negative" :label="`刪除明細 ${index+1}`" @click="form.lines.splice(index,1)" /></div><div class="col-12"><q-input v-model="line.lineNote" :label="`明細備註 ${index+1}`" maxlength="500" outlined dense /></div></div>
      <p v-if="validPrice(line.unitSellingPrice) && scaled(line.unitSellingPrice,4)===0n" class="text-caption">注意：此明細為零售價。</p>
     </q-card-section>
    </q-card>
   </fieldset>
   <div class="q-mt-md" role="status">{{ form.currencyCode || '未選貨幣' }} 預計總額 {{ preview }}；以儲存後伺服器總額為準。<span v-if="document && !conversion"> 上次儲存總額 {{ document.totalAmount }}</span></div>
   <q-btn class="q-mt-md" color="primary" type="submit" :label="uncertain?'重試確認結果':conversion?'建立 Draft 銷售訂單':'儲存報價 Draft'" :loading="submitting" :disable="stale" />
  </FormPanel>
 </div>
</template>
<style scoped>fieldset { border: 0; min-width: 0; }</style>
