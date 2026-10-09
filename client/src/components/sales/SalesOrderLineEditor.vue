<script setup>
import { nextTick,onBeforeUnmount,ref,watch } from "vue";
import sales from "@/services/sales.js";
import { validPrice,validQuantity } from "./salesEditorMath.js";
const props=defineProps({modelValue:{type:Array,required:true},currencyCode:{type:String,default:""},fieldError:{type:Function,default:()=>""}});
const emit=defineEmits(["update:modelValue"]);
const skus=ref([]),selectedSku=ref(null),selectedUom=ref(null),barcode=ref(""),loading=ref(false),error=ref(""),duplicateMessage=ref(""),root=ref(null);
let controller;
onBeforeUnmount(()=>controller?.abort());
watch(selectedSku,sku=>{selectedUom.value=sku?.uoms.find(uom=>uom.isDefaultSale)?.skuUomId ?? sku?.uoms[0]?.skuUomId ?? null;});
async function lookup(q="",update,exactBarcode){
 controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";
 try{const result=await sales.lookupSkus({q,page:1,pageSize:20,signal,...(exactBarcode?{barcode:exactBarcode}:{}),...(/^[A-Z]{3}$/.test(props.currencyCode)?{currencyCode:props.currencyCode}:{})});
  if(signal.aborted)return;if(exactBarcode)selectedSku.value=result.items[0] ?? null;
  const set=()=>{skus.value=result.items;};if(update)update(set);else set();
 }catch(e){if(!signal.aborted){error.value=e.message || "搜尋失敗，請重試";update?.(()=>{});}}finally{if(!signal.aborted)loading.value=false;}
}
async function addLine(){
 const sku=selectedSku.value,uom=sku?.uoms.find(row=>row.skuUomId===selectedUom.value);if(!uom)return;
 const index=props.modelValue.findIndex(line=>line.skuId===sku.skuId && line.skuUomId===uom.skuUomId);
 if(index>=0){duplicateMessage.value="已存在此 SKU／UOM，請修改原明細數量。";await nextTick();root.value?.querySelector(`[data-line-index="${index}"] input`)?.focus();return;}
 if(props.modelValue.length>=100)return;
 emit("update:modelValue",[...props.modelValue,{skuId:sku.skuId,skuUomId:uom.skuUomId,skuCode:sku.skuCode,skuName:sku.skuName,uomCode:uom.uomCode,quantity:"1",unitSellingPrice:sku.suggestedPrice?.currency===props.currencyCode?sku.suggestedPrice.amount:"",lineNote:""}]);selectedSku.value=null;duplicateMessage.value="";
}
function change(index,field,value){emit("update:modelValue",props.modelValue.map((line,i)=>i===index?{...line,[field]:value}:line));}
function remove(index){emit("update:modelValue",props.modelValue.filter((_,i)=>i!==index));}
</script>
<template><section ref="root"><h2 class="text-h6 q-ma-none q-my-md">明細（{{ modelValue.length }}／100）</h2>
 <q-banner v-if="error || fieldError('lines')" role="alert" class="bg-negative text-white q-mb-md">{{ error || fieldError('lines') }}；請重新搜尋或檢查明細。</q-banner>
 <div class="row q-col-gutter-md q-mb-md">
  <div class="col-12 col-md-6"><q-select v-model="selectedSku" label="搜尋 SKU" :options="skus" :option-label="row=>`${row.skuCode} — ${row.skuName}`" use-input input-debounce="250" :loading="loading" outlined dense @filter="(q,update)=>lookup(q,update)" @keyup.enter="addLine"><template #no-option><q-item><q-item-section>沒有符合條件的可售 SKU；請縮小搜尋。</q-item-section></q-item></template></q-select></div>
  <div class="col-12 col-md-3"><q-select v-model="selectedUom" label="銷售單位" :options="selectedSku?.uoms ?? []" option-value="skuUomId" :option-label="uom=>`${uom.uomCode} — ${uom.uomName}`" emit-value map-options outlined dense /></div>
  <div class="col-12 col-md-3"><q-btn label="新增明細" :disable="!selectedUom || (modelValue.length>=100 && !modelValue.some(line=>line.skuId===selectedSku?.skuId && line.skuUomId===selectedUom))" @click="addLine" /></div>
 </div>
 <div class="row q-gutter-sm q-mb-md"><q-input v-model="barcode" label="條碼（精確搜尋）" maxlength="190" outlined dense @keyup.enter="lookup('',undefined,barcode)" /><q-btn label="搜尋條碼" :disable="!barcode.trim()" :loading="loading" @click="lookup('',undefined,barcode)" /></div>
 <p v-if="duplicateMessage" role="status">{{ duplicateMessage }}</p><p v-if="!modelValue.length" role="status">尚未新增明細；搜尋可售 SKU 後選擇單位。</p>
 <q-card v-for="(line,index) in modelValue" :key="`${line.skuId}-${line.skuUomId}`" flat bordered class="q-mb-md" data-testid="sales-order-line"><q-card-section>
  <h3 class="text-subtitle1 q-ma-none">{{ index+1 }}. {{ line.skuCode }} — {{ line.skuName }}（{{ line.uomCode }}）</h3>
  <div class="row q-col-gutter-md q-mt-xs"><div class="col-12 col-md-4" :data-line-index="index"><q-input :model-value="line.quantity" :label="`數量 ${index+1} *`" inputmode="decimal" :rules="[value=>validQuantity(value)||'數量必須大於零，最多六位小數']" :error="!!fieldError(`lines.${index}.quantity`)" :error-message="fieldError(`lines.${index}.quantity`)" outlined dense @update:model-value="value=>change(index,'quantity',value)" /></div>
   <div class="col-12 col-md-4"><q-input :model-value="line.unitSellingPrice" :label="`售價 ${index+1} *`" :hint="line.unitSellingPrice==='' ? `請輸入 ${currencyCode || '此訂單幣別'} 的售價；不自動換算` : undefined" inputmode="decimal" :rules="[value=>validPrice(value)||'請輸入非負售價，最多四位小數']" :error="!!fieldError(`lines.${index}.unitSellingPrice`)" :error-message="fieldError(`lines.${index}.unitSellingPrice`)" outlined dense @update:model-value="value=>change(index,'unitSellingPrice',value)" /></div>
   <div class="col-12 col-md-4"><q-btn flat color="negative" :label="`刪除明細 ${index+1}`" @click="remove(index)" /></div><div class="col-12"><q-input :model-value="line.lineNote" :label="`明細備註 ${index+1}`" maxlength="500" outlined dense @update:model-value="value=>change(index,'lineNote',value)" /></div>
  </div><p v-if="validPrice(line.unitSellingPrice) && !/[1-9]/.test(line.unitSellingPrice)" class="text-caption">注意：此明細為零售價。</p>
 </q-card-section></q-card></section></template>
