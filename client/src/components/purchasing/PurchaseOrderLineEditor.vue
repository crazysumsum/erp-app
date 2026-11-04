<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import purchasing from "@/services/purchasing.js";
import { isZeroPrice, previewBaseQuantity, previewLineAmount, validPrice, validQuantity } from "./purchasingEditorMath.js";

const props = defineProps({
  modelValue: { type: Array, required: true }, currencyCode: { type: String, default: "" }, currencyPlaces: { type: Number, default: null },
  orderDate: { type: String, default: "" }, fieldError: { type: Function, default: () => "" }
});
const emit = defineEmits(["update:modelValue"]);
const TRACKING = { none: "不追蹤", batch: "批次", batch_expiry: "批次及到期日" };
const MAX_LINES = 100;
const skus = ref([]), selectedSku = ref(null), selectedUom = ref(null), barcode = ref(""), loading = ref(false), error = ref(""), message = ref("");
let controller, nextKey = 0;
onBeforeUnmount(() => controller?.abort());

const uomOption = (uom) => `${uom.uomCode} — ${uom.uomName}（1 = ${uom.toBaseFactor} ${selectedSku.value?.baseUomCode ?? ""}）`;
const chosenUom = computed(() => selectedSku.value?.uoms.find((uom) => uom.skuUomId === selectedUom.value) ?? null);
watch(selectedSku, (sku) => { selectedUom.value = (sku?.uoms.find((uom) => uom.isDefaultPurchase) ?? sku?.uoms.find((uom) => uom.isBase) ?? sku?.uoms[0])?.skuUomId ?? null; });

async function lookup(query, update) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  loading.value = true; error.value = ""; message.value = "";
  try {
    const items = await purchasing.lookupSkus({ ...query, signal });
    if (signal.aborted) return null;
    const apply = () => { skus.value = items; };
    if (update) update(apply); else apply();
    return items;
  } catch (e) {
    if (!signal.aborted) { error.value = e.message || "搜尋失敗，請重試"; update?.(() => {}); }
    return null;
  } finally { if (!signal.aborted) loading.value = false; }
}
async function scan() {
  const items = await lookup({ barcode: barcode.value.trim() });
  if (!items) return;
  selectedSku.value = items[0] ?? null;
  if (!items.length) message.value = "找不到可採購的貨品；請檢查條碼或改用搜尋。";
}
function addLine() {
  const sku = selectedSku.value, uom = chosenUom.value;
  if (!uom || props.modelValue.length >= MAX_LINES) return;
  emit("update:modelValue", [...props.modelValue, { key: `new-${nextKey++}`, id: null, skuId: sku.skuId, skuCode: sku.skuCode, skuName: sku.skuName ?? sku.itemName, trackingPolicy: sku.trackingPolicy,
    baseUomCode: sku.baseUomCode, purchaseSkuUomId: uom.skuUomId, purchaseUomCode: uom.uomCode, factor: uom.toBaseFactor, orderedQuantity: "1", unitPrice: "", zeroPriceReason: "", expectedDeliveryDate: null, lineNote: "" }]);
  selectedSku.value = null; barcode.value = ""; message.value = "";
}
function change(index, field, value) { emit("update:modelValue", props.modelValue.map((line, i) => (i === index ? { ...line, [field]: value } : line))); }
function remove(index) { emit("update:modelValue", props.modelValue.filter((_, i) => i !== index)); }
function move(index, offset) {
  const lines = [...props.modelValue];
  [lines[index], lines[index + offset]] = [lines[index + offset], lines[index]];
  emit("update:modelValue", lines);
}
const quantityRule = (line) => (value) => {
  if (!validQuantity(value)) return "數量必須大於零，最多六位小數";
  return previewBaseQuantity(value, line.factor) !== null || `換算後不是整數 ${line.baseUomCode}；請調整數量或單位`;
};
const amount = (line) => previewLineAmount(line.orderedQuantity, line.unitPrice, props.currencyPlaces);
</script>

<template>
  <section aria-labelledby="po-lines-heading">
    <h2 id="po-lines-heading" class="text-h6 q-ma-none q-my-md">明細（{{ modelValue.length }}／{{ MAX_LINES }}）</h2>
    <q-banner v-if="error || fieldError('lines')" role="alert" class="bg-negative text-white q-mb-md">{{ error || fieldError('lines') }}</q-banner>
    <div class="row q-col-gutter-md q-mb-md">
      <div class="col-12 col-md-5"><q-select v-model="selectedSku" label="搜尋貨品" :options="skus" :option-label="row => `${row.skuCode} — ${row.skuName ?? row.itemName}`" use-input input-debounce="250" :loading="loading" outlined dense @filter="(q, update) => lookup({ q }, update)"><template #no-option><q-item><q-item-section>沒有符合條件的可採購貨品；請縮小搜尋。</q-item-section></q-item></template></q-select></div>
      <div class="col-12 col-md-3"><q-input v-model="barcode" label="條碼（精確搜尋）" maxlength="190" outlined dense @keydown.enter.prevent="barcode.trim() && scan()"><template #append><q-btn flat dense label="搜尋條碼" :disable="!barcode.trim()" @click="scan" /></template></q-input></div>
      <div class="col-12 col-md-3"><q-select v-model="selectedUom" label="採購單位" :options="selectedSku?.uoms ?? []" option-value="skuUomId" :option-label="uomOption" emit-value map-options outlined dense /></div>
      <div class="col-12 col-md-1"><q-btn label="新增明細" no-wrap :disable="!chosenUom || modelValue.length >= MAX_LINES" @click="addLine" /></div>
    </div>
    <p v-if="selectedSku" class="text-caption" data-testid="sku-summary">可採購；基本單位 {{ selectedSku.baseUomCode }}；追蹤：{{ TRACKING[selectedSku.trackingPolicy] ?? selectedSku.trackingPolicy }}<template v-if="selectedSku.minimumReceiptLifeDays !== null">；最短收貨效期 {{ selectedSku.minimumReceiptLifeDays }} 天</template></p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="!modelValue.length" role="status">尚未新增明細；搜尋可採購貨品後選擇單位。</p>
    <div v-for="(line, index) in modelValue" :key="line.key" class="po-line" role="group" :aria-label="`明細 ${index + 1}：${line.skuCode}`" data-testid="po-line">
      <div class="po-line__sku">
        <strong>{{ index + 1 }}. {{ line.skuCode }}</strong> {{ line.skuName }}
        <div class="text-caption">{{ line.purchaseUomCode }}<template v-if="previewBaseQuantity(line.orderedQuantity, line.factor) !== null"> ＝ {{ previewBaseQuantity(line.orderedQuantity, line.factor) }} {{ line.baseUomCode }}</template>；追蹤：{{ TRACKING[line.trackingPolicy] ?? line.trackingPolicy }}</div>
      </div>
      <q-input :model-value="line.orderedQuantity" :label="`數量 ${index + 1} *`" inputmode="decimal" :rules="[quantityRule(line)]" :error="!!fieldError(`lines.${index}.orderedQuantity`)" :error-message="fieldError(`lines.${index}.orderedQuantity`)" outlined dense @update:model-value="value => change(index, 'orderedQuantity', value)" />
      <q-input :model-value="line.unitPrice" :label="`單價 ${index + 1} *`" inputmode="decimal" :hint="`${currencyCode || '此單貨幣'}；不自動換算`" :rules="[value => validPrice(value) || '請輸入非負單價，最多四位小數']" :error="!!fieldError(`lines.${index}.unitPrice`)" :error-message="fieldError(`lines.${index}.unitPrice`)" outlined dense @update:model-value="value => change(index, 'unitPrice', value)" />
      <div class="po-line__amount"><span class="text-caption">金額預覽</span><div data-testid="po-line-amount">{{ amount(line) ?? "—" }}</div></div>
      <q-input :model-value="line.expectedDeliveryDate" :label="`交期 ${index + 1}`" type="date" stack-label :rules="[value => !value || value >= orderDate || '交期不可早於訂單日期']" :error="!!fieldError(`lines.${index}.expectedDeliveryDate`)" :error-message="fieldError(`lines.${index}.expectedDeliveryDate`)" outlined dense @update:model-value="value => change(index, 'expectedDeliveryDate', value || null)" />
      <q-input :model-value="line.lineNote" :label="`明細備註 ${index + 1}`" maxlength="1000" outlined dense @update:model-value="value => change(index, 'lineNote', value)" />
      <div class="po-line__actions">
        <q-btn flat dense round icon="arrow_upward" :aria-label="`上移明細 ${index + 1}`" :disable="index === 0" @click="move(index, -1)" />
        <q-btn flat dense round icon="arrow_downward" :aria-label="`下移明細 ${index + 1}`" :disable="index === modelValue.length - 1" @click="move(index, 1)" />
        <q-btn flat dense round color="negative" icon="delete" :aria-label="`刪除明細 ${index + 1}`" @click="remove(index)" />
      </div>
      <q-input v-if="isZeroPrice(line.unitPrice)" class="po-line__wide" :model-value="line.zeroPriceReason" :label="`零價原因 ${index + 1} *`" hint="單價為零時必須說明原因" maxlength="500" :rules="[value => value?.trim().length >= 5 || '請輸入最少 5 個字的原因']" :error="!!fieldError(`lines.${index}.zeroPriceReason`)" :error-message="fieldError(`lines.${index}.zeroPriceReason`)" outlined dense @update:model-value="value => change(index, 'zeroPriceReason', value)" />
    </div>
  </section>
</template>

<style scoped>
/* 同一份 DOM：窄屏係 card，1024px 以上排成一行 grid，所以唔使兩份 markup，亦唔會有頁面級橫向捲動（§7.3、§7.9）。 */
.po-line { display: grid; grid-template-columns: minmax(0, 1fr); gap: .5rem; padding: .75rem; margin-bottom: .75rem; border: 1px solid var(--app-border); border-radius: 4px; }
.po-line__actions { display: flex; gap: .25rem; }
@media (min-width: 1024px) {
  .po-line { grid-template-columns: minmax(10rem, 2fr) minmax(6rem, 1fr) minmax(7rem, 1fr) minmax(6rem, 1fr) minmax(9rem, 1fr) minmax(8rem, 1.5fr) auto; align-items: start; }
  .po-line__wide { grid-column: 1 / -1; }
}
</style>
