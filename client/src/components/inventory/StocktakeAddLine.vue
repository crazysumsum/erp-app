<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import inventory from "@/services/inventory.js";
import { stocktakeError, validStocktakeText } from "./stocktakeIntent.js";
const props = defineProps({ detail: { type: Object, required: true }, submit: { type: Function, required: true }, disabled: Boolean });
const emit = defineEmits(["saved", "close", "dirty"]);
const mode = ref("Code"), code = ref(""), sku = ref(null), binId = ref(null), lotId = ref(null), stockStatus = ref("AVAILABLE"), error = ref(""), dirty = ref(false);
const scopes = ref([]), scopePage = ref(0), scopeTotal = ref(0), scopeLoading = ref(false), lots = ref([]), lotPage = ref(0), lotTotal = ref(0), lotLoading = ref(false), looking = ref(false);
const controller = new AbortController(), signal = controller.signal; let alive = true, generation = 0;
const validLookup = computed(() => validStocktakeText(code.value, { required: true, bytes: 760, length: 190 }));
const valid = computed(() => sku.value && scopes.value.some(row => row.binId === binId.value) &&
  (sku.value.trackingPolicy === "none" ? lotId.value === null : lots.value.some(row => row.lotId === lotId.value && row.sku?.skuId === sku.value.skuId)));
function changed() { dirty.value = true; emit("dirty"); }
function changeLookup(value, selectedMode = mode.value) {
  code.value = value ?? ""; mode.value = selectedMode; generation++; sku.value = null; lotId.value = null; lots.value = []; lotPage.value = 0; lotTotal.value = 0;
  looking.value = false; lotLoading.value = false; error.value = ""; changed();
}
async function lookup() {
  if (!validLookup.value || props.disabled || looking.value) return;
  const own = ++generation, text = code.value, selectedMode = mode.value; looking.value = true; sku.value = null; lotId.value = null;
  try {
    const response = await inventory[selectedMode === "Barcode" ? "lookupSkuByBarcode" : "lookupSku"](text, { signal });
    if (!alive || own !== generation) return;
    if (!Number.isSafeInteger(response?.skuId) || !response.baseUom || !["none", "batch", "batch_expiry"].includes(response.trackingPolicy)) throw new Error("SKU 資料不完整。");
    sku.value = response; changed(); if (response.trackingPolicy !== "none") await loadLots();
  } catch (cause) { if (alive && own === generation) error.value = stocktakeError(cause).message; }
  finally { if (alive && own === generation) looking.value = false; }
}
async function loadLots() {
  if (!sku.value || sku.value.trackingPolicy === "none" || lotLoading.value) return;
  const own = generation, selectedSku = sku.value.skuId, page = lotPage.value + 1; lotLoading.value = true;
  try {
    const response = await inventory.listLots({ skuId: selectedSku, page, rowsPerPage: 100, signal });
    if (!alive || own !== generation) return;
    lots.value.push(...response.rows.filter(row => row.sku?.skuId === selectedSku)); lotPage.value = page; lotTotal.value = response.rowsNumber;
  } catch (cause) { if (alive && own === generation) error.value = stocktakeError(cause).message; }
  finally { if (alive && own === generation) lotLoading.value = false; }
}
async function loadScope() {
  if (scopeLoading.value || !alive) return;
  const page = scopePage.value + 1; scopeLoading.value = true;
  try {
    const header = await inventory.getStocktake(props.detail.id, { scopePage: page, scopePageSize: 100, signal });
    if (!alive) return;
    if (header.id !== props.detail.id || header.version !== props.detail.version || header.status !== "COUNTING" ||
      header.scope.page !== page || (scopePage.value && header.scope.total !== scopeTotal.value)) throw new Error("範圍已改變。");
    scopes.value.push(...header.scope.items); scopePage.value = page; scopeTotal.value = header.scope.total;
  } catch { if (alive) error.value = "未能確認目前盤點範圍，請重新載入；不能猜測庫位。"; }
  finally { if (alive) scopeLoading.value = false; }
}
async function save() {
  if (!valid.value || props.disabled) throw new Error("請選擇所屬盤點庫位、精確 SKU 及已登記的同 SKU 批次；本期不能建立新批號。");
  try {
    const receipt = await props.submit({ binId: binId.value, skuId: sku.value.skuId, lotId: lotId.value, stockStatus: stockStatus.value });
    if (!receipt) throw new Error("結果未知。"); dirty.value = false; emit("saved", receipt); return receipt;
  } catch (cause) { throw stocktakeError(cause); }
}
function canDiscard() { return !props.disabled && (!dirty.value || window.confirm("帳外行尚未儲存，確定捨棄嗎？")); }
defineExpose({ canDiscard });
onMounted(loadScope); onUnmounted(() => { alive = false; generation++; controller.abort(); });
</script>
<template>
  <FormPanel :on-submit="save" v-slot="{ submitting }" class="q-pa-md">
    <h2 class="text-h6 q-mt-none">新增帳外 Bucket</h2>
    <p>只建立帳面 0、尚未點算的行，不建立 Lot、Balance 或庫存。只接受既有合法批次；不授予銷售或收貨資格。</p>
    <q-banner v-if="error" role="alert" class="bg-negative text-white q-mb-md">{{ error }}</q-banner>
    <q-select :model-value="mode" :options="['Code', 'Barcode']" outlined label="帳外查找模式" :disable="disabled || submitting" @update:model-value="changeLookup(code, $event)" />
    <q-input :model-value="code" outlined label="精確 Code／Barcode" :disable="disabled || submitting" @update:model-value="changeLookup($event)" @keydown.enter.prevent="lookup" />
    <q-btn outline label="查找帳外 SKU" :disable="!validLookup || disabled || submitting || looking" :loading="looking" @click="lookup" />
    <p v-if="sku" role="status">{{ sku.skuCode }} · {{ sku.skuName }} · Base {{ sku.baseUom.uomCode }} · {{ sku.trackingPolicy }}</p>
    <q-select v-model="binId" :options="scopes" option-value="binId" option-label="binCodeCurrent" emit-value map-options outlined label="所屬盤點庫位" :disable="disabled || submitting" :loading="scopeLoading" @update:model-value="changed" />
    <q-btn v-if="scopes.length < scopeTotal || !scopes.length" flat label="載入更多盤點範圍" :disable="disabled || submitting" :loading="scopeLoading" @click="loadScope" />
    <q-select v-if="sku && sku.trackingPolicy !== 'none'" v-model="lotId" :options="lots" option-value="lotId" :option-label="row => `${row.lotNumber} · ${row.expiryDate || '無效期'}`"
      emit-value map-options outlined label="既有合法批次" :disable="disabled || submitting" :loading="lotLoading" @update:model-value="changed" />
    <q-btn v-if="sku && sku.trackingPolicy !== 'none' && (lots.length < lotTotal || !lots.length)" flat label="載入更多既有批次" :disable="disabled || submitting" :loading="lotLoading" @click="loadLots" />
    <q-select v-model="stockStatus" :options="['AVAILABLE', 'QUARANTINED', 'DAMAGED']" outlined label="帳外庫存狀態" :disable="disabled || submitting" @update:model-value="changed" />
    <p class="text-caption">過期／低效期既有批次可記錄實物盤點；不改日期、不假造 Receipt，銷售及收貨仍按原規則。</p>
    <div class="row justify-end q-gutter-sm"><q-btn flat label="明確捨棄帳外行" :disable="disabled || submitting" @click="canDiscard() && emit('close')" />
      <q-btn type="submit" label="建立帳外行" color="primary" :disable="disabled || submitting || !valid" :loading="submitting" /></div>
  </FormPanel>
</template>
