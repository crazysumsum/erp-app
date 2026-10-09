<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import TransferSkuField from "./TransferSkuField.vue";
import inventory from "@/services/inventory.js";
const props = defineProps({ detail: { type: Object, default: null } });
const emit = defineEmits(["saved", "close"]);
const sourceWarehouseId = ref(props.detail?.sourceWarehouseId ?? null), destinationWarehouseId = ref(props.detail?.destinationWarehouseId ?? null);
const reason = ref(props.detail?.reason ?? ""), dirty = ref(false), saving = ref(false), error = ref("");
const newLine = () => ({ key: crypto.randomUUID(), selection: { sku: null, lotId: null }, sourceBinId: null, stockStatus: "AVAILABLE", quantity: 1, initialCode: "" });
const lines = ref(props.detail ? props.detail.lines.map(line => ({ ...newLine(), id: line.id, expectedVersion: line.version,
  initialCode: line.skuCode, sourceBinId: line.sourceBinId, stockStatus: line.dispatchStockStatus, quantity: line.quantity })) : [newLine()]);
const warehouses = ref([]), warehousePage = ref(0), warehouseTotal = ref(0), warehouseLoading = ref(false);
const bins = ref([]), binPage = ref(0), binTotal = ref(0), binLoading = ref(false);
const documentId = props.detail ? String(props.detail.id) : crypto.randomUUID();
let binGeneration = 0, alive = true;
const commandId = ref(crypto.randomUUID());
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const valid = computed(() => warehouses.value.some(row => row.id === sourceWarehouseId.value) &&
  warehouses.value.some(row => row.id === destinationWarehouseId.value) && sourceWarehouseId.value !== destinationWarehouseId.value &&
  new TextEncoder().encode(reason.value).length <= 500 && !/[\p{Cc}]/u.test(reason.value) &&
  lines.value.length > 0 && lines.value.every(line => positive(line.quantity) && bins.value.some(bin => bin.id === line.sourceBinId) &&
    line.selection.sku && (line.selection.sku.trackingPolicy === "none" || positive(line.selection.lotId))));
function changed() { dirty.value = true; commandId.value = crypto.randomUUID(); }
watch([sourceWarehouseId, destinationWarehouseId, reason, lines], changed, { deep: true });
async function loadWarehouses() {
  if (warehouseLoading.value) return;
  warehouseLoading.value = true; error.value = "";
  try {
    const response = await inventory.listWarehouses({ page: warehousePage.value + 1, rowsPerPage: 100, status: "ACTIVE" });
    if (!alive) return;
    warehouses.value.push(...response.rows); warehousePage.value++; warehouseTotal.value = response.rowsNumber;
  } catch (cause) { if (alive) error.value = cause.message || "無法載入倉庫，請重試。"; }
  finally { warehouseLoading.value = false; }
}
async function loadBins() {
  if (!sourceWarehouseId.value || binLoading.value) return;
  const current = binGeneration;
  binLoading.value = true; error.value = "";
  try {
    const response = await inventory.listBins(sourceWarehouseId.value, { page: binPage.value + 1, rowsPerPage: 100, status: "ACTIVE" });
    if (!alive || current !== binGeneration) return;
    bins.value.push(...response.rows); binPage.value++; binTotal.value = response.rowsNumber;
  } catch (cause) { if (alive && current === binGeneration) error.value = cause.message || "無法載入來源庫位，請重試。"; }
  finally { if (current === binGeneration) binLoading.value = false; }
}
watch(sourceWarehouseId, (_, previous) => {
  binGeneration++; bins.value = []; binPage.value = 0; binTotal.value = 0; binLoading.value = false;
  if (previous !== undefined) lines.value.forEach(line => { line.sourceBinId = null; });
  loadBins();
}, { immediate: true });
async function save() {
  if (!valid.value || saving.value) throw new Error("請完成每行 SKU、批次、來源庫位及正整數數量，並選擇不同的來源／目的倉庫。");
  saving.value = true;
  const payload = { idempotencyKey: commandId.value,
    source: { module: "INVENTORY", documentType: "TRANSFER", documentId, lineId: "", eventId: commandId.value },
    sourceWarehouseId: sourceWarehouseId.value, destinationWarehouseId: destinationWarehouseId.value, reason: reason.value,
    lines: lines.value.map(line => ({ ...(line.id ? { id: line.id, expectedVersion: line.expectedVersion } : {}),
      skuId: line.selection.sku.skuId, lotId: line.selection.lotId, sourceBinId: line.sourceBinId,
      stockStatus: line.stockStatus, quantity: Number(line.quantity) })) };
  try {
    const result = props.detail ? await inventory.updateTransfer(props.detail.id, { ...payload, version: props.detail.version }) : await inventory.createTransfer(payload);
    dirty.value = false; emit("saved", result); return result;
  } catch (cause) {
    throw new Error(`${cause.message || '無法儲存草稿'}。輸入內容仍保留；請重載詳情並重新查找／選料後再提交。`);
  } finally { saving.value = false; }
}
function canDiscard() { return !saving.value && (!dirty.value || window.confirm("有未儲存的調撥變更，確定要離開嗎？")); }
function beforeUnload(event) { if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = ""; } }
defineExpose({ canDiscard });
onMounted(() => { loadWarehouses(); window.addEventListener("beforeunload", beforeUnload); });
onUnmounted(() => { alive = false; binGeneration++; window.removeEventListener("beforeunload", beforeUnload); });
</script>

<template>
  <FormPanel :on-submit="save" class="q-pa-md">
    <h2 class="text-h6 q-mt-none">{{ detail ? `編輯 ${detail.number}` : '新增調撥草稿' }}</h2>
    <p>每行請重新查找並選擇 SKU／批次。儲存只建立草稿，不扣庫存。</p>
    <q-banner v-if="error" role="alert" class="bg-negative text-white q-mb-md">{{ error }}</q-banner>
    <div class="row q-col-gutter-sm">
      <q-select class="col-12 col-sm-6" v-model="sourceWarehouseId" :options="warehouses" option-value="id"
        :option-label="row => `${row.code} — ${row.name || ''}`" emit-value map-options outlined dense label="來源倉庫" :disable="saving" :loading="warehouseLoading" />
      <q-select class="col-12 col-sm-6" v-model="destinationWarehouseId" :options="warehouses" option-value="id"
        :option-label="row => `${row.code} — ${row.name || ''}`" emit-value map-options outlined dense label="目的倉庫" :disable="saving" :loading="warehouseLoading" />
    </div>
    <q-btn v-if="warehouses.length < warehouseTotal || !warehouses.length" flat label="載入倉庫" :loading="warehouseLoading" @click="loadWarehouses" />
    <q-banner v-if="sourceWarehouseId && sourceWarehouseId === destinationWarehouseId" role="alert" class="bg-warning q-mt-sm">來源與目的倉庫必須不同。</q-banner>
    <q-card v-for="(line, index) in lines" :key="line.key" :data-testid="`transfer-line-${index + 1}`" flat bordered class="q-mt-md">
      <q-card-section>
        <div class="row items-center"><h3 class="text-subtitle1 q-ma-none">第 {{ index + 1 }} 行</h3><q-space />
          <q-btn flat round icon="delete" :aria-label="`移除第 ${index + 1} 行`" :disable="saving || lines.length === 1" @click="lines.splice(index, 1)" /></div>
        <TransferSkuField v-model="line.selection" :line-number="index + 1" :initial-code="line.initialCode" :disabled="saving" @dirty="changed" />
        <div class="row q-col-gutter-sm q-mt-sm">
          <q-select class="col-12 col-sm-5" v-model="line.sourceBinId" :options="bins" option-value="id" option-label="code" emit-value map-options
            outlined dense :label="`第 ${index + 1} 行來源庫位`" :disable="saving || !sourceWarehouseId" :loading="binLoading" />
          <q-select class="col-12 col-sm-4" v-model="line.stockStatus" :options="['AVAILABLE', 'QUARANTINED', 'DAMAGED']" outlined dense :label="`第 ${index + 1} 行庫存狀態`" :disable="saving" />
          <q-input class="col-12 col-sm-3" v-model.number="line.quantity" type="number" min="1" step="1" outlined dense :label="`第 ${index + 1} 行數量`"
            :disable="saving" :error="!positive(line.quantity)" error-message="請輸入 Base UOM 正整數" />
        </div>
      </q-card-section>
    </q-card>
    <q-btn v-if="sourceWarehouseId && (bins.length < binTotal || !bins.length)" flat label="載入來源庫位" :loading="binLoading" @click="loadBins" />
    <div class="q-mt-md"><q-btn outline icon="add" label="新增一行" :disable="saving || lines.length >= 100" @click="lines.push(newLine())" /></div>
    <q-input v-model="reason" outlined autogrow type="textarea" label="草稿備註" class="q-mt-md" :disable="saving" />
    <div class="row justify-end q-gutter-sm q-mt-md">
      <q-btn flat label="取消編輯" :disable="saving" @click="canDiscard() && emit('close')" />
      <q-btn type="submit" color="primary" unelevated label="儲存草稿" :disable="!valid || saving" :loading="saving" />
    </div>
  </FormPanel>
</template>
