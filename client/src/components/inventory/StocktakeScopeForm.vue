<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import inventory from "@/services/inventory.js";
import { stocktakeError, validStocktakeText } from "./stocktakeIntent.js";
const props = defineProps({ detail: { type: Object, default: null }, submit: { type: Function, required: true }, disabled: Boolean });
const emit = defineEmits(["saved", "close", "dirty"]);
const warehouseId = ref(props.detail?.warehouseId ?? null), binIds = ref([]), reason = ref(props.detail?.reason ?? "");
const warehouses = ref([]), bins = ref([]), scopes = ref([]), ready = ref(!props.detail), dirty = ref(false), error = ref("");
const warehousePage = ref(0), warehouseTotal = ref(0), warehouseLoading = ref(false);
const binPage = ref(0), binTotal = ref(0), binLoading = ref(false), scopeLoading = ref(false);
const controller = new AbortController(); const signal = controller.signal;
let alive = true, binGeneration = 0;
const options = computed(() => [...new Map([...scopes.value.map(row => ({ id: row.binId, code: row.binCodeCurrent,
  status: row.statusCurrent })), ...bins.value].map(row => [row.id, row])).values()]);
const valid = computed(() => ready.value && warehouseId.value && binIds.value.length && binIds.value.every(id =>
  options.value.some(row => row.id === id && row.status === "ACTIVE")) && validStocktakeText(reason.value));
function changed() { dirty.value = true; emit("dirty"); }
async function loadWarehouses() {
  if (warehouseLoading.value || !alive) return;
  warehouseLoading.value = true;
  try { const response = await inventory.listWarehouses({ page: warehousePage.value + 1, rowsPerPage: 100, status: "ACTIVE", signal });
    if (!alive) return; warehouses.value.push(...response.rows); warehousePage.value++; warehouseTotal.value = response.rowsNumber;
  } catch (cause) { if (alive) error.value = stocktakeError(cause).message; }
  finally { if (alive) warehouseLoading.value = false; }
}
async function loadBins() {
  if (!warehouseId.value || binLoading.value || !alive) return;
  const captured = binGeneration, warehouse = warehouseId.value, page = binPage.value + 1;
  binLoading.value = true;
  try { const response = await inventory.listBins(warehouse, { page, rowsPerPage: 100, status: "ACTIVE", signal });
    if (!alive || captured !== binGeneration) return;
    bins.value.push(...response.rows.filter(row => row.warehouseId === warehouse && row.status === "ACTIVE")); binPage.value = page; binTotal.value = response.rowsNumber;
  } catch (cause) { if (alive && captured === binGeneration) error.value = stocktakeError(cause).message; }
  finally { if (alive && captured === binGeneration) binLoading.value = false; }
}
async function loadScope() {
  scopeLoading.value = true; ready.value = false; const rows = [], seen = new Set(); let total = null;
  try {
    for (let page = 1; ; page++) {
      if (!alive) return;
      const header = await inventory.getStocktake(props.detail.id, { scopePage: page, scopePageSize: 100, signal });
      if (!alive) return;
      const scope = header.scope;
      if (header.id !== props.detail.id || header.version !== props.detail.version || header.status !== "DRAFT" ||
        header.warehouseId !== props.detail.warehouseId || !scope || scope.page !== page || scope.pageSize !== 100 ||
        !Number.isSafeInteger(scope.total) || scope.total < 1 || !Array.isArray(scope.items) ||
        (total !== null && total !== scope.total) || scope.items.length !== Math.min(100, scope.total - rows.length))
        throw new Error("盤點範圍未完整或版本已改變；未替換任何庫位。");
      total ??= scope.total;
      for (const row of scope.items) {
        if (!Number.isSafeInteger(row.binId) || row.binId < 1 || seen.has(row.binId)) throw new Error("盤點範圍重複或不完整。");
        seen.add(row.binId); rows.push(row);
      }
      if (rows.length === total) break;
    }
    if (alive) { scopes.value = rows; binIds.value = rows.map(row => row.binId); ready.value = true; }
  } catch { if (alive) error.value = "盤點範圍未完整或版本已改變；請關閉後重新載入，不能保存部分範圍。"; }
  finally { if (alive) scopeLoading.value = false; }
}
watch(warehouseId, () => { binGeneration++; bins.value = []; binPage.value = 0; binTotal.value = 0; binLoading.value = false;
  if (!props.detail) binIds.value = []; loadBins(); }, { immediate: true });
async function save() {
  if (props.disabled || !valid.value) throw new Error("請選擇完整的所屬有效庫位範圍，並核對備註格式。");
  try { const receipt = await props.submit({ ...(props.detail ? { expectedVersion: props.detail.version } : { warehouseId: warehouseId.value }),
    binIds: [...binIds.value].sort((a, b) => a - b), reason: reason.value.trim() });
    if (!receipt) throw new Error("原結果仍待核對。"); dirty.value = false; emit("saved", receipt); return receipt;
  } catch (cause) { throw stocktakeError(cause); }
}
function canDiscard() { return !props.disabled && (!dirty.value || window.confirm("有未儲存的盤點範圍，確定捨棄嗎？")); }
async function refreshCurrent() {
  if (!alive || !warehouseId.value || !binIds.value.length) return false;
  try {
    const warehouse = await inventory.getWarehouse(warehouseId.value, { signal });
    if (!alive || warehouse.id !== warehouseId.value || warehouse.status !== "ACTIVE") return false;
    for (const id of binIds.value) {
      const bin = await inventory.getBin(warehouseId.value, id, { signal });
      if (!alive || bin.id !== id || bin.warehouseId !== warehouseId.value || bin.status !== "ACTIVE") return false;
    }
    return alive;
  } catch { return false; }
}
defineExpose({ canDiscard, refreshCurrent });
onMounted(() => { loadWarehouses(); if (props.detail) loadScope(); });
onUnmounted(() => { alive = false; binGeneration++; controller.abort(); });
</script>
<template>
  <FormPanel :on-submit="save" v-slot="{ submitting }" class="q-pa-md">
    <h2 class="text-h6 q-mt-none">{{ detail ? '編輯完整草稿範圍' : '新增盤點草稿' }}</h2>
    <p>草稿排斥其他未完成盤點，但尚未鎖定庫存；Start 才會建立實體鎖。</p>
    <q-banner v-if="error" role="alert" class="bg-negative text-white q-mb-md">{{ error }}</q-banner>
    <div v-if="scopeLoading" role="status">正在讀取全部原範圍；完成前不可保存。</div>
    <q-select v-model="warehouseId" :options="warehouses" option-value="id" option-label="code" emit-value map-options outlined label="盤點倉庫"
      :disable="!!detail || disabled || submitting" :loading="warehouseLoading" @update:model-value="changed" />
    <q-btn v-if="warehouses.length < warehouseTotal || !warehouses.length" flat label="載入更多倉庫" :loading="warehouseLoading" :disable="disabled || submitting" @click="loadWarehouses" />
    <q-select v-model="binIds" :options="options" option-value="id" option-label="code" :option-disable="row => row.status !== 'ACTIVE'" multiple emit-value map-options use-chips outlined label="盤點庫位"
      :disable="disabled || submitting || !ready" :loading="binLoading" @update:model-value="changed" />
    <q-btn v-if="warehouseId && (bins.length < binTotal || !bins.length)" flat label="載入更多庫位" :loading="binLoading" :disable="disabled || submitting" @click="loadBins" />
    <p>已選 {{ binIds.length }} 個庫位；保存傳送整個所選集合，不會默默刪除未顯示的原庫位。</p>
    <q-input :model-value="reason" type="textarea" autogrow outlined label="草稿備註" :disable="disabled || submitting" @update:model-value="reason = $event ?? ''; changed()" />
    <div class="row justify-end q-gutter-sm q-mt-md">
      <q-btn flat label="明確捨棄範圍" :disable="disabled || submitting" @click="canDiscard() && emit('close')" />
      <q-btn type="submit" label="儲存完整草稿" color="primary" :disable="disabled || submitting || !valid" :loading="submitting" />
    </div>
  </FormPanel>
</template>
