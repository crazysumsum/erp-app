<script setup>
import { ref } from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { stocktakeError, stocktakeQuantity } from "./stocktakeIntent.js";
const props = defineProps({ line: { type: Object, required: true }, submit: { type: Function, required: true }, disabled: Boolean });
const emit = defineEmits(["saved", "close", "dirty"]);
const original = Object.freeze({ ...props.line });
const quantity = ref(original.countedQuantity === null ? "" : String(original.countedQuantity));
const notFound = ref(original.notFound), dirty = ref(false);
function changed() { dirty.value = true; emit("dirty"); }
async function save() {
  if (props.disabled) throw new Error("原操作仍待核對，不能重新提交。");
  const value = stocktakeQuantity(quantity.value);
  if (!notFound.value && value === null) throw new Error("請輸入 Base UOM 安全非負整數；留白不是 0，或明確選擇未發現。");
  try {
    const receipt = await props.submit({ lines: [{ lineId: original.id, expectedVersion: original.version,
      ...(notFound.value ? { notFound: true } : { countedQuantity: value }) }] });
    if (!receipt) throw new Error("原結果仍待核對。");
    dirty.value = false; emit("saved", receipt); return receipt;
  } catch (error) { throw stocktakeError(error); }
}
function canDiscard() { return !props.disabled && (!dirty.value || window.confirm("有未儲存的點算；確定明確捨棄嗎？")); }
defineExpose({ canDiscard });
</script>
<template>
  <FormPanel :on-submit="save" v-slot="{ submitting }" class="q-pa-md">
    <h2 class="text-h6 q-mt-none">點算 {{ original.skuCodeCurrent }} · {{ original.binId }}</h2>
    <p>{{ original.skuNameCurrent }} · {{ original.stockStatus }} · {{ original.lotNumberCurrent || '無批次' }}</p>
    <p>帳面 {{ original.snapshotQuantity }} {{ original.baseUom.uomCode }} · 原行版本 {{ original.version }}。輸入只更新點算，不改庫存。</p>
    <q-checkbox :model-value="notFound" label="未發現（實際為 0）" :disable="disabled || submitting"
      @update:model-value="notFound = $event; changed()" />
    <q-input :model-value="quantity" label="實數（Base UOM）" outlined inputmode="numeric" :disable="disabled || submitting || notFound"
      @update:model-value="quantity = $event ?? ''; changed()" />
    <p class="text-caption">留白＝未輸入，不是 0。沒有清回未點算動作；不接受 Pack 換算。</p>
    <div class="row justify-end q-gutter-sm">
      <q-btn flat label="明確捨棄點算" :disable="disabled || submitting" @click="canDiscard() && emit('close')" />
      <q-btn type="submit" color="primary" label="儲存此行點算" :disable="disabled || submitting" :loading="submitting" />
    </div>
  </FormPanel>
</template>
