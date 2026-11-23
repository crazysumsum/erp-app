<script setup>
import { computed, ref, watch } from "vue";
import purchasing from "@/services/purchasing.js";

// 一行 physical bucket：單位、數量、倉／庫位、批次資料、庫存狀態（設計 §7.6）。換倉即清庫位；批次欄位按 PO 確認時嘅 tracking 快照顯示。
const props = defineProps({
  modelValue: { type: Object, required: true }, poLine: { type: Object, required: true }, warehouses: { type: Array, default: () => [] },
  path: { type: String, required: true }, fieldError: { type: Function, default: () => "" }, removable: { type: Boolean, default: true }
});
const emit = defineEmits(["update:modelValue", "remove"]);
const STATUSES = [{ value: "AVAILABLE", label: "可用" }, { value: "QUARANTINED", label: "隔離" }, { value: "DAMAGED", label: "損壞" }];

const bins = ref([]), binsError = ref("");
const uoms = computed(() => {
  const line = props.poLine, base = { id: line.baseUomId, label: `${line.baseUomCode}（基本單位）` };
  return line.purchaseUomId === line.baseUomId ? [base] : [{ id: line.purchaseUomId, label: `${line.purchaseUomCode}（× ${line.uomToBaseFactor}）` }, base];
});
const tracked = computed(() => props.poLine.trackingPolicy !== "none");
const factor = computed(() => (props.modelValue.inputUomId === props.poLine.purchaseUomId ? props.poLine.uomToBaseFactor : 1));
const basePreview = computed(() => {
  const quantity = Number(props.modelValue.receivedQuantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity * factor.value : null;
});
const error = (field) => props.fieldError(`${props.path}.${field}`);
const set = (field, value) => emit("update:modelValue", { ...props.modelValue, [field]: value });

let request = 0;
async function loadBins(warehouseId) {
  const mine = (request += 1);
  bins.value = []; binsError.value = "";
  if (!warehouseId) return;
  try {
    const items = await purchasing.lookupReceivingBins(warehouseId);
    if (mine === request) bins.value = items;
  } catch (failure) {
    if (mine === request) binsError.value = failure.message || "未能載入庫位";
  }
}
function chooseWarehouse(warehouseId) {
  emit("update:modelValue", { ...props.modelValue, warehouseId, binId: null });
}
watch(() => props.modelValue.warehouseId, loadBins, { immediate: true });
</script>

<template>
  <q-card flat bordered class="q-pa-sm" :data-testid="`receipt-detail-${path}`">
    <div class="row q-col-gutter-sm">
      <div class="col-12 col-sm-4 col-md-2"><q-select :model-value="modelValue.inputUomId" label="單位 *" :options="uoms" option-value="id" option-label="label" emit-value map-options outlined dense
        :error="!!error('inputUomId')" :error-message="error('inputUomId')" @update:model-value="value => set('inputUomId', value)" /></div>
      <div class="col-12 col-sm-4 col-md-2"><q-input :model-value="modelValue.receivedQuantity" label="數量 *" inputmode="decimal" outlined dense
        :hint="basePreview === null ? '' : `基本單位 ${basePreview}`" :error="!!error('receivedQuantity')" :error-message="error('receivedQuantity')"
        @update:model-value="value => set('receivedQuantity', value)" /></div>
      <div class="col-12 col-sm-4 col-md-2"><q-select :model-value="modelValue.stockStatus" label="庫存狀態 *" :options="STATUSES" emit-value map-options outlined dense
        :error="!!error('stockStatus')" :error-message="error('stockStatus')" @update:model-value="value => set('stockStatus', value)" /></div>
      <div class="col-12 col-sm-6 col-md-3"><q-select :model-value="modelValue.warehouseId" label="倉庫 *" :options="warehouses" option-value="id" :option-label="row => `${row.code} — ${row.name}`" emit-value map-options outlined dense
        :error="!!error('warehouseId')" :error-message="error('warehouseId')" @update:model-value="chooseWarehouse" /></div>
      <div class="col-12 col-sm-6 col-md-3"><q-select :model-value="modelValue.binId" label="庫位 *" :options="bins" option-value="id" option-label="code" emit-value map-options outlined dense
        :disable="!modelValue.warehouseId" :error="!!(error('binId') || binsError)" :error-message="error('binId') || binsError" @update:model-value="value => set('binId', value)" /></div>
      <template v-if="tracked">
        <div class="col-12 col-sm-4"><q-input :model-value="modelValue.lotNumber" label="批號 *" maxlength="100" outlined dense
          :error="!!error('lotNumber')" :error-message="error('lotNumber')" @update:model-value="value => set('lotNumber', value)" /></div>
        <div class="col-12 col-sm-4"><q-input :model-value="modelValue.expiryDate" :label="poLine.trackingPolicy === 'batch_expiry' ? '到期日 *' : '到期日（選填）'" type="date" outlined dense
          :error="!!error('expiryDate')" :error-message="error('expiryDate')" @update:model-value="value => set('expiryDate', value || null)" /></div>
        <div class="col-12 col-sm-4"><q-input :model-value="modelValue.manufactureDate" label="生產日（選填）" type="date" outlined dense
          :error="!!error('manufactureDate')" :error-message="error('manufactureDate')" @update:model-value="value => set('manufactureDate', value || null)" /></div>
        <div class="col-12"><q-input :model-value="modelValue.expiryOverrideReason" label="低效期放行原因（只在剩餘效期不足時需要，須有放行權限）" maxlength="500" outlined dense
          :error="!!error('expiryOverrideReason')" :error-message="error('expiryOverrideReason')" @update:model-value="value => set('expiryOverrideReason', value)" /></div>
      </template>
    </div>
    <div v-if="removable" class="row justify-end"><q-btn flat dense color="negative" icon="delete" label="刪除此明細" @click="emit('remove')" /></div>
  </q-card>
</template>
