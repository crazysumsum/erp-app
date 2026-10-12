<script setup>
import { computed, onUnmounted, ref } from "vue";
import inventory from "@/services/inventory.js";
const props = defineProps({ modelValue: { type: Object, required: true }, lineNumber: { type: Number, required: true }, initialCode: { type: String, default: "" }, disabled: Boolean });
const emit = defineEmits(["update:modelValue", "dirty"]);
const code = ref(props.initialCode);
const result = ref(null), error = ref(""), loading = ref(false);
const lots = ref([]), lotPage = ref(0), lotTotal = ref(0), lotLoading = ref(false);
let generation = 0;
const validCode = computed(() => code.value.trim() && Array.from(code.value).length <= 190 &&
  ![...code.value].some(character => character.codePointAt(0) <= 0x1f || character.codePointAt(0) === 0x7f));
function changeCode(value) {
  code.value = value ?? "";
  generation++;
  result.value = null; error.value = ""; loading.value = false; lotLoading.value = false;
  lots.value = []; lotPage.value = 0; lotTotal.value = 0;
  emit("update:modelValue", { sku: null, lotId: null }); emit("dirty");
}
async function lookup() {
  if (!validCode.value || props.disabled) return;
  const current = ++generation;
  loading.value = true; result.value = null; error.value = "";
  emit("update:modelValue", { sku: null, lotId: null }); emit("dirty");
  try {
    const found = await inventory.lookupSku(code.value);
    if (current === generation) result.value = found;
  } catch (cause) {
    if (current === generation) error.value = cause.message || "無法查找 SKU，請重試或重新登入。";
  } finally { if (current === generation) loading.value = false; }
}
async function loadLots(sku = props.modelValue.sku) {
  if (!sku || sku.trackingPolicy === "none" || lotLoading.value) return;
  const current = generation;
  lotLoading.value = true; error.value = "";
  try {
    const page = lotPage.value + 1;
    const response = await inventory.listLots({ skuId: sku.skuId, page, rowsPerPage: 100 });
    if (current !== generation) return;
    lots.value.push(...response.rows); lotPage.value = page; lotTotal.value = response.rowsNumber;
  } catch (cause) {
    if (current === generation) error.value = cause.message || "無法載入批次，請重試。";
  } finally { if (current === generation) lotLoading.value = false; }
}
function select() {
  if (!result.value || props.disabled) return;
  emit("update:modelValue", { sku: result.value, lotId: null }); emit("dirty");
  lots.value = []; lotPage.value = 0; lotTotal.value = 0;
  loadLots(result.value);
}
onUnmounted(() => { generation++; });
</script>

<template>
  <div>
    <div class="row q-col-gutter-sm items-start">
      <q-input class="col-12 col-sm-8" :model-value="code" @update:model-value="changeCode" outlined dense
        :label="`第 ${lineNumber} 行 SKU Code`" :disable="disabled" clearable @keydown.enter.prevent="lookup" />
      <div class="col-12 col-sm-4"><q-btn outline color="primary" label="查找 SKU" :disable="!validCode || disabled || loading" :loading="loading" @click="lookup" /></div>
    </div>
    <div v-if="loading" role="status" class="q-mt-sm">正在查找 SKU…</div>
    <q-banner v-if="error" role="alert" class="bg-negative text-white q-mt-sm">{{ error }}</q-banner>
    <div v-if="result && !modelValue.sku" class="q-mt-sm">
      <span>{{ result.skuCode }} · {{ result.skuName }} · {{ result.baseUom.uomCode }} · {{ result.trackingPolicy }}</span>
      <q-btn flat color="primary" label="選擇此 SKU" :disable="disabled" @click="select" />
    </div>
    <div v-if="modelValue.sku" role="status" class="q-mt-sm">已選 {{ modelValue.sku.skuCode }} · {{ modelValue.sku.skuName }} · {{ modelValue.sku.baseUom.uomCode }} · {{ modelValue.sku.trackingPolicy }}</div>
    <template v-if="modelValue.sku && modelValue.sku.trackingPolicy !== 'none'">
      <q-select class="q-mt-sm" :model-value="modelValue.lotId" :options="lots" option-value="lotId"
        :option-label="lot => `${lot.lotNumber} · ${lot.expiryDate || '無效期'}`" emit-value map-options outlined dense clearable
        :label="`第 ${lineNumber} 行批次`" :disable="disabled" :loading="lotLoading"
        @update:model-value="emit('update:modelValue', { sku: modelValue.sku, lotId: $event }); emit('dirty')" />
      <div v-if="!lotLoading && !lots.length" role="status" class="q-mt-sm">尚無可選批次，不能儲存此行。</div>
      <q-btn v-if="lots.length < lotTotal || !lots.length" flat label="載入批次" :disable="disabled" :loading="lotLoading" @click="loadLots()" />
    </template>
  </div>
</template>
