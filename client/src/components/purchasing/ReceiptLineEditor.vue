<script setup>
import { computed } from "vue";
import ReceiptDetailEditor from "./ReceiptDetailEditor.vue";
import { newDetail } from "./receiptForm.js";

// 一條 PO line 嘅收貨：顯示訂購／已收／未收（基本單位），可分拆多個 detail；超收時顯示原因欄（設計 §7.6；server 以鎖定進度重算）。
const props = defineProps({
  modelValue: { type: Object, required: true }, poLine: { type: Object, required: true }, warehouses: { type: Array, default: () => [] },
  index: { type: Number, required: true }, fieldError: { type: Function, default: () => "" }
});
const emit = defineEmits(["update:modelValue", "remove"]);
const path = computed(() => `lines.${props.index}`);
const error = (field) => props.fieldError(`${path.value}.${field}`);
const set = (field, value) => emit("update:modelValue", { ...props.modelValue, [field]: value });

const factorOf = (detail) => (detail.inputUomId === props.poLine.purchaseUomId ? props.poLine.uomToBaseFactor : 1);
const received = computed(() => props.modelValue.details.reduce((sum, detail) => {
  const quantity = Number(detail.receivedQuantity);
  return Number.isFinite(quantity) && quantity > 0 ? sum + quantity * factorOf(detail) : sum;
}, 0));
const over = computed(() => Math.max(0, received.value - Number(props.poLine.outstandingBaseQuantity)));

function addDetail() {
  const last = props.modelValue.details.at(-1);
  set("details", [...props.modelValue.details, newDetail(props.poLine, last?.warehouseId ?? null)]);
}
function updateDetail(index, detail) {
  set("details", props.modelValue.details.map((current, at) => (at === index ? detail : current)));
}
function removeDetail(index) {
  set("details", props.modelValue.details.filter((_, at) => at !== index));
}
</script>

<template>
  <section class="q-mb-md" :aria-labelledby="`receipt-line-${index}`" :data-testid="`receipt-line-${index}`">
    <q-card flat bordered>
      <q-card-section class="q-pb-sm">
        <div class="row items-start justify-between q-col-gutter-sm">
          <div class="col">
            <h3 :id="`receipt-line-${index}`" class="text-subtitle1 q-ma-none">第 {{ poLine.lineNumber }} 行：{{ poLine.skuCode }} — {{ poLine.skuName }}</h3>
            <div class="text-caption">訂購 {{ poLine.orderedBaseQuantity }}・已收 {{ poLine.netReceivedBaseQuantity }}・未收 {{ poLine.outstandingBaseQuantity }}・本次 {{ received }}（{{ poLine.baseUomCode }}）</div>
            <div v-if="over > 0" class="text-caption text-negative"><q-icon name="warning" aria-hidden="true" /> 預計超收 {{ over }}；確認時以伺服器鎖定的未收數量重算</div>
          </div>
          <div class="col-auto"><q-btn flat dense color="negative" icon="remove_circle_outline" label="移除此行" @click="emit('remove')" /></div>
        </div>
        <q-banner v-if="error('purchaseOrderLineId')" role="alert" class="bg-negative text-white q-mt-sm">{{ error('purchaseOrderLineId') }}</q-banner>
      </q-card-section>
      <q-card-section class="q-pt-none column q-gutter-sm">
        <ReceiptDetailEditor v-for="(detail, at) in modelValue.details" :key="detail.key" :model-value="detail" :po-line="poLine" :warehouses="warehouses"
          :path="`${path}.details.${at}`" :field-error="fieldError" :removable="modelValue.details.length > 1"
          @update:model-value="value => updateDetail(at, value)" @remove="removeDetail(at)" />
        <div><q-btn outline dense icon="add" label="新增明細（分倉／庫位／批次）" @click="addDetail" /></div>
        <q-input v-if="over > 0 || modelValue.overReceiptReason" :model-value="modelValue.overReceiptReason" label="超收原因（超收時必填）" maxlength="500" outlined dense
          :error="!!error('overReceiptReason')" :error-message="error('overReceiptReason')" @update:model-value="value => set('overReceiptReason', value)" />
        <q-input :model-value="modelValue.skuExceptionReason" label="貨品例外原因（貨品資料在採購單確認後改變時必填）" maxlength="500" outlined dense
          :error="!!error('skuExceptionReason')" :error-message="error('skuExceptionReason')" @update:model-value="value => set('skuExceptionReason', value)" />
      </q-card-section>
    </q-card>
  </section>
</template>
