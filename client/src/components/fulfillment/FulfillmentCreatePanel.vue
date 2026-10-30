<script setup>
import {computed,reactive,ref,toRaw,watch} from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import {fulfillmentFailure} from "@/services/fulfillment.js";
import {isDefinitiveCreateRejection} from "./fulfillmentCreateRejection.js";
const props=defineProps({source:{type:Object,required:true},onSave:{type:Function,required:true},draft:{type:Object,default:null},uncertain:Boolean}),emit=defineEmits(["saved","reload"]);
const amounts=reactive({}),selected=reactive({}),notes=ref(""),stale=ref(false),intent=ref(null);
watch(()=>props.source.id,()=>{const draft=String(props.draft?.salesOrderId)===String(props.source.id)?props.draft:null;for(const line of props.source.lines){const old=draft?.lines.find(row=>String(row.salesOrderLineId)===String(line.id));amounts[line.id]=old?.plannedBaseQuantity??line.fulfillableBaseQuantity;selected[line.id]=draft?!!old:BigInt(line.fulfillableBaseQuantity)>0n;}notes.value=draft?.notes??"";stale.value=false;intent.value=null;},{immediate:true});
watch(()=>props.source,()=>{stale.value=false;});
const lines=computed(()=>props.source.lines.filter(line=>selected[line.id]));
const valid=value=>typeof value==="string"&&/^[1-9][0-9]{0,15}$/u.test(value)&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER);
const columns=[{name:"choose",label:"選取",field:"id"},{name:"sku",label:"SKU",field:"skuCode",align:"left"},{name:"ordered",label:"Ordered",field:"orderedBaseQuantity",align:"right"},{name:"reserved",label:"Reserved",field:"reservedOutstandingBaseQuantity",align:"right"},{name:"backorder",label:"Backorder",field:"backorderedBaseQuantity",align:"right"},{name:"fulfilled",label:"Fulfilled",field:"fulfilledBaseQuantity",align:"right"},{name:"claimed",label:"已計劃",field:"activeClaimedBaseQuantity",align:"right"},{name:"available",label:"可履約",field:"fulfillableBaseQuantity",align:"right"},{name:"quantity",label:"計劃數量（Base）",field:"id",align:"right"}];
async function save(){if(stale.value)throw new Error("請先重新載入來源；輸入仍保留");if(!lines.value.length||lines.value.some(line=>!valid(amounts[line.id])||BigInt(amounts[line.id])>BigInt(line.fulfillableBaseQuantity)))throw new Error("請選取行並填寫不超過目前可履約量的正整數");
 intent.value??={eventId:crypto.randomUUID(),salesOrderId:Number(props.source.id),salesOrderVersion:props.source.version,notes:notes.value,lines:lines.value.map(line=>({salesOrderLineId:Number(line.id),plannedBaseQuantity:amounts[line.id]}))};
 const wasUncertain=props.uncertain;try{const result=await props.onSave(structuredClone(toRaw(intent.value)));intent.value=null;emit("saved",result);return result;}catch(error){const failure=fulfillmentFailure(error);stale.value=failure.action==="reload";if(isDefinitiveCreateRejection(error,wasUncertain))intent.value=null;throw new Error(failure.message);}
}
</script>
<template><div><h2 class="text-h6 q-ma-none q-mb-md">建立履約工作：{{ source.salesOrderNumber }}</h2><p>{{ source.customerCode }} — {{ source.customerName }}／{{ source.warehouseCode }} — {{ source.warehouseName }}</p>
 <q-banner v-if="stale" role="alert" class="bg-warning text-dark q-mb-md">來源已變更，輸入仍保留；請重新載入後核對數量。<template #action><q-btn flat label="重新載入來源" @click="emit('reload')" /></template></q-banner>
 <FormPanel :on-submit="save" v-slot="{submitting}"><fieldset class="fulfillment-create-fields q-pa-none q-ma-none" :disabled="submitting||uncertain" :inert="submitting||uncertain"><legend>選取 SO 行及 Base 單位數量</legend>
  <DataTable sticky-actions :rows="source.lines" :columns="columns" :initial-pagination="{page:1,rowsPerPage:100}"><template #bottom><span class="q-pa-sm">{{ source.lines.length }} 行</span></template>
   <template #body-cell-choose="{row}"><q-td><q-checkbox v-model="selected[row.id]" :aria-label="`選取 ${row.skuCode}`" :disable="row.fulfillableBaseQuantity==='0'" /></q-td></template>
   <template #body-cell-sku="{row}"><q-td>{{ row.skuCode }} — {{ row.skuName }}</q-td></template>
   <template #body-cell-quantity="{row}"><q-td><q-input v-model="amounts[row.id]" :aria-label="`計劃數量：${row.skuCode}`" label="計劃數量" inputmode="numeric" maxlength="16" outlined dense :disable="!selected[row.id]" :rules="[value=>!selected[row.id]||valid(value)&&BigInt(value)<=BigInt(row.fulfillableBaseQuantity)||'請輸入可履約範圍內的正整數']" /></q-td></template>
  </DataTable><q-input v-model="notes" type="textarea" label="履約備註" maxlength="2000" outlined class="q-mt-md" />
 </fieldset><q-btn color="primary" type="submit" label="提交建立履約工作" :loading="submitting" :disable="stale||uncertain" class="q-mt-md" /></FormPanel>
</div></template>
<style scoped>
.fulfillment-create-fields { min-width: 0; border: 0; }
</style>
