<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import inventory from "@/services/inventory.js";
const props = defineProps({ action: { type: String, default: "IN" }, movementId: { type: Number, default: null }, disabled: Boolean });
const emit = defineEmits(["review"]);
const statuses = ["AVAILABLE", "QUARANTINED", "DAMAGED"];
const categories = ["COUNT_GAIN", "COUNT_LOSS", "DAMAGE", "EXPIRY", "DATA_CORRECTION", "TRANSFER_VARIANCE", "OTHER"];
const code = ref(""), sku = ref(null), warehouses = ref([]), bins = ref([]), lots = ref([]), buckets = ref([]);
const warehouseId = ref(null), binId = ref(null), stockStatus = ref("AVAILABLE"), sourceBalanceId = ref(null);
const lotMode = ref("EXISTING"), lotId = ref(null), lotNumber = ref(""), expiryDate = ref(""), manufactureDate = ref("");
const destinationStatus = ref("QUARANTINED"), quantity = ref(""), reasonCategory = ref("DATA_CORRECTION"), reasonText = ref("");
const error = ref(""), errorField = ref(""), errorSummary = ref(null), loading = ref(false), lookupLoading = ref(false), selectorLoading = ref(false);
let generation = 0, lookupGeneration = 0, live = true;
const positive = value => Number.isSafeInteger(value) && value > 0;
const currentVersion = value => positive(value) && value <= 4_294_967_295;
const invalid = (message, field = "") => { errorField.value = field; throw new Error(message); };
const identity = row => [row.warehouse?.warehouseId, row.bin?.binId, row.sku?.skuId, row.lot?.lotId ?? null, row.stockStatus];
const same = (a, b) => JSON.stringify(identity(a)) === JSON.stringify(identity(b));
const location = row => `${row.warehouse.code}/${row.bin.code}`;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
async function collect(read, filters, key) {
  const result = [], ids = new Set(); let total;
  for (let page = 1; ; page++) {
    const response = await read({ ...filters, page, rowsPerPage: 100 });
    if (!Array.isArray(response?.rows) || !Number.isSafeInteger(response.rowsNumber) || response.rowsNumber < 0 ||
      (total !== undefined && total !== response.rowsNumber)) invalid("載入資料不完整或已變更，請重新查詢。");
    total = response.rowsNumber;
    for (const row of response.rows) {
      if (!positive(row[key]) || ids.has(row[key])) invalid("查詢資料重複或識別無效，不能確認過帳。");
      ids.add(row[key]); result.push(row);
    }
    if (result.length === total) return result;
    if (!response.rows.length || result.length > total) invalid("載入資料不完整，不能把未讀資料視為不存在。");
  }
}
async function showError(cause) { error.value = cause.message || "無法準備操作，請重新查詢。"; await nextTick(); errorSummary.value?.focus(); }
async function loadWarehouses() {
  selectorLoading.value = true;
  try { const rows = await collect(inventory.listWarehouses, { status: "ACTIVE" }, "id"); if (live) warehouses.value = rows.filter(row => row.status === "ACTIVE"); }
  catch (cause) { if (live) await showError(cause); }
  finally { if (live) selectorLoading.value = false; }
}
async function loadBins() {
  const parent = warehouseId.value; bins.value = []; binId.value = null; buckets.value = []; sourceBalanceId.value = null;
  if (!positive(parent)) return;
  try { const rows = await collect(options => inventory.listBins(parent, options), { status: "ACTIVE" }, "id");
    if (live && warehouseId.value === parent) bins.value = rows.filter(row => row.status === "ACTIVE" && row.warehouseId === parent); }
  catch (cause) { if (live && warehouseId.value === parent) await showError(cause); }
}
async function lookup() {
  if (props.disabled || loading.value || lookupLoading.value) return;
  const value = code.value.trim(), token = ++lookupGeneration;
  sku.value = null; lots.value = []; buckets.value = []; lotId.value = null; sourceBalanceId.value = null; error.value = "";
  if (!value || [...value].length > 190 || /[\p{Cc}]/u.test(value)) return showError(new Error("請輸入有效 SKU Code（最多 190 字元）。"));
  lookupLoading.value = true;
  try {
    const found = await inventory.lookupSku(value, {});
    if (!live || token !== lookupGeneration) return;
    if (!positive(found?.skuId) || !positive(found.baseUom?.uomId) || !["none", "batch", "batch_expiry"].includes(found.trackingPolicy)) invalid("SKU 資料不完整或不支援此追蹤方式。");
    sku.value = found;
    if (found.trackingPolicy !== "none") {
      const rows = await collect(inventory.listLots, { skuId: found.skuId }, "lotId");
      if (rows.some(row => row.sku?.skuId !== found.skuId)) invalid("批次與 SKU 不一致，請重新查詢。");
      if (live && token === lookupGeneration) lots.value = rows;
    }
  } catch (cause) { if (live && token === lookupGeneration) { sku.value = null; await showError(cause); } }
  finally { if (live && token === lookupGeneration) lookupLoading.value = false; }
}
function assertSelection() {
  if (!sku.value || !warehouses.value.some(row => row.id === warehouseId.value) || !bins.value.some(row => row.id === binId.value)) invalid("請查找 SKU 並選擇有效倉庫及庫位。");
}
async function loadStocks() {
  if (props.disabled || loading.value) return;
  error.value = ""; sourceBalanceId.value = null; buckets.value = [];
  try {
    assertSelection(); const selection = [sku.value.skuId, warehouseId.value, binId.value];
    const rows = await collect(inventory.listStocks, { skuId: selection[0], warehouseId: selection[1], binId: selection[2] }, "balanceId");
    if (live && JSON.stringify(selection) === JSON.stringify([sku.value?.skuId, warehouseId.value, binId.value])) buckets.value = rows;
  } catch (cause) { if (live) await showError(cause); }
}
function validateBucket(row) {
  if (!positive(row?.balanceId) || !currentVersion(row.version) || !positive(row.baseUom?.uomId) ||
    !identity(row).slice(0, 3).every(positive) || !statuses.includes(row.stockStatus) ||
    ![row.onHand, row.allocated, row.bucketFree].every(value => Number.isSafeInteger(value) && value >= 0)) invalid("目前庫存資料不完整，請重新查詢。");
  return row;
}
async function targetBucket(target, newLot = false) {
  const rows = await collect(inventory.listStocks, { warehouseId: target.warehouse.warehouseId, binId: target.bin.binId,
    skuId: target.sku.skuId, status: target.stockStatus, ...(target.lot?.number ? { lot: target.lot.number } : {}) }, "balanceId");
  if (newLot) {
    if (rows.some(row => row.lot?.number === target.lot.number)) invalid("新批次已出現在庫存，請重新查找並選擇既有批次。");
    return null;
  }
  const matches = rows.filter(row => same(row, target));
  if (matches.length > 1) invalid("目標庫存識別不唯一，不能確認過帳。");
  return matches.length ? validateBucket(matches[0]) : null;
}
async function summaries(legs) {
  const pairs = new Map(legs.map(leg => [`${leg.bucket.warehouse.warehouseId}:${leg.bucket.sku.skuId}`, leg.bucket]));
  return Promise.all([...pairs.values()].map(async row => {
    const summary = await inventory.getStockSummary({ warehouseId: row.warehouse.warehouseId, skuId: row.sku.skuId });
    if (![summary?.reserved, summary?.uncoveredReserved, summary?.eligibleOnHand].every(value => Number.isSafeInteger(value) && value >= 0) ||
      !Number.isSafeInteger(summary?.atp)) invalid("目前 Reservation 保障摘要不完整，請重新查詢。");
    return { warehouse: row.warehouse.code, sku: row.sku.code, ...summary };
  }));
}
async function prepare() {
  if (props.disabled || loading.value || lookupLoading.value) return;
  const own = ++generation; loading.value = true; error.value = ""; errorField.value = "";
  try {
    const reason = reasonText.value.trim();
    if (!reason || new TextEncoder().encode(reason).length > 500 || /[\p{Cc}]/u.test(reason) ||
      (["IN", "OUT"].includes(props.action) && reasonCategory.value === "OTHER" && [...reason].filter(char => !/\s/u.test(char)).length < 10)) invalid("原因必填、不可有控制字元、最多 500 UTF-8 bytes；OTHER 至少 10 個非空白字元。", "reason");
    let body, legs;
    if (props.action === "REVERSAL") {
      if (!positive(props.movementId)) invalid("請從異動詳情選擇完整沖銷組。");
      const detail = await inventory.getMovement(props.movementId);
      if (detail?.movement.movementId !== props.movementId || detail.reversal.reversalOfMovementId || detail.reversal.reversedByMovementId ||
        !Array.isArray(detail.groupLegs) || !detail.groupLegs.length || detail.groupLegs.length > 200 ||
        !detail.groupLegs.every(row => row.groupId === detail.movement.groupId && row.locationKind === "BIN" && ["RECEIPT", "ISSUE", "BIN_MOVE", "STATUS_TRANSFER", "ADJUSTMENT"].includes(row.movementType))) invalid("此異動組不支援完整沖銷或已有沖銷關聯。");
      if (!detail.groupLegs.every(row => positive(row.movementId)) || new Set(detail.groupLegs.map(row => row.movementId)).size !== detail.groupLegs.length ||
        !detail.groupLegs.some(row => row.movementId === props.movementId)) invalid("異動組不完整或識別重複，不能確認整組沖銷。");
      const current = new Map(); legs = [];
      for (const original of detail.groupLegs) {
        const key = JSON.stringify(identity(original));
        if (!current.has(key)) {
          const bucket = await targetBucket(original); if (!bucket) invalid("原庫存 bucket 不存在，不能重建或部分沖銷。");
          current.set(key, bucket);
        }
        const bucket = current.get(key);
        if (!positive(original.quantity) || !["IN", "OUT"].includes(original.direction)) invalid("原異動資料不完整。");
        legs.push({ movementId: original.movementId, bucket, direction: original.direction === "IN" ? "OUT" : "IN", quantity: original.quantity });
      }
      const guards = [...current.values()].map(row => ({ balanceId: row.balanceId, expectedVersion: row.version })).sort((a, b) => a.balanceId - b.balanceId);
      if (new Set(guards.map(row => row.balanceId)).size !== guards.length) invalid("沖銷庫存識別重複，請重新查詢。");
      body = { expectedBalances: guards, reasonText: reason };
    } else {
      assertSelection(); const amount = Number(quantity.value);
      if (!positive(amount)) invalid("數量必須是 Base UOM 的安全正整數。", "quantity");
      const common = { quantity: amount, uomId: sku.value.baseUom.uomId, reasonText: reason };
      if (["IN", "OUT"].includes(props.action) && !categories.includes(reasonCategory.value)) invalid("請選擇有效原因分類。");
      if (props.action === "IN") {
        if (!statuses.includes(stockStatus.value)) invalid("請選擇有效庫存狀態。");
        const lotFields = {}; let chosenLot = null, newLot = false;
        if (sku.value.trackingPolicy !== "none") {
          const rows = await collect(inventory.listLots, { skuId: sku.value.skuId }, "lotId");
          if (rows.some(row => row.sku?.skuId !== sku.value.skuId)) invalid("批次與 SKU 不一致，請重新查詢。");
          if (lotMode.value === "EXISTING") {
            chosenLot = rows.find(row => row.lotId === lotId.value); if (!chosenLot) invalid("請選擇既有批次，或明確選擇新批次。");
            lotFields.lotNumber = chosenLot.lotNumber;
            for (const field of ["expiryDate", "manufactureDate"]) if (chosenLot[field] !== null && chosenLot[field] !== undefined) {
              if (!validDate(chosenLot[field])) invalid("既有批次日期無效，不能修改或猜測。"); lotFields[field] = chosenLot[field];
            }
          } else if (lotMode.value === "NEW") {
            const number = lotNumber.value.trim();
            if (!number || [...number].length > 100 || /[\p{Cc}]/u.test(number) || rows.some(row => row.lotNumber === number)) invalid("新批次編號無效或已存在，請選擇既有批次。");
            if (sku.value.trackingPolicy === "batch_expiry" && !expiryDate.value) invalid("新效期批次必須輸入效期日期。", "expiry");
            lotFields.lotNumber = number; newLot = true;
            for (const [field, value] of [["expiryDate", expiryDate.value], ["manufactureDate", manufactureDate.value]]) if (value) {
              if (!validDate(value)) invalid("請輸入有效曆日日期。", field === "expiryDate" ? "expiry" : "manufacture"); lotFields[field] = value;
            }
            chosenLot = { lotId: null, number, ...lotFields };
          } else invalid("請選擇有效批次模式。");
        }
        const target = { warehouse: { warehouseId: warehouseId.value, code: warehouses.value.find(row => row.id === warehouseId.value).code },
          bin: { binId: binId.value, code: bins.value.find(row => row.id === binId.value).code }, sku: { skuId: sku.value.skuId, code: sku.value.skuCode, name: sku.value.skuName },
          lot: chosenLot ? { ...chosenLot, number: lotFields.lotNumber } : null, stockStatus: stockStatus.value, baseUom: sku.value.baseUom };
        const current = await targetBucket(target, newLot);
        body = { ...common, direction: "IN", warehouseId: warehouseId.value, binId: binId.value, skuId: sku.value.skuId,
          stockStatus: stockStatus.value, expectedBalanceVersion: current?.version ?? null, reasonCategory: reasonCategory.value, ...lotFields };
        legs = [{ bucket: current ?? { ...target, onHand: 0, allocated: 0, bucketFree: 0, version: null }, direction: "IN", quantity: amount }];
      } else if (["OUT", "STATUS_TRANSFER"].includes(props.action)) {
        const selected = buckets.value.find(row => row.balanceId === sourceBalanceId.value); if (!selected) invalid("請載入並選擇來源庫存 bucket。");
        const source = validateBucket(await inventory.getStock(selected.balanceId));
        if (!same(source, selected) || source.baseUom.uomId !== common.uomId) invalid("來源庫存與選取資料不一致，請重新查詢。");
        legs = [{ bucket: source, direction: "OUT", quantity: amount }];
        if (props.action === "OUT") body = { ...common, direction: "OUT", balanceId: source.balanceId, expectedBalanceVersion: source.version, reasonCategory: reasonCategory.value };
        else {
          if (!statuses.includes(destinationStatus.value) || destinationStatus.value === source.stockStatus) invalid("目標狀態必須有效且與來源不同。");
          const target = { ...source, stockStatus: destinationStatus.value };
          const destination = await targetBucket(target);
          body = { ...common, sourceBalanceId: source.balanceId, destinationStatus: destinationStatus.value, expectedSourceVersion: source.version, expectedDestinationVersion: destination?.version ?? null };
          legs.push({ bucket: destination ?? { ...target, onHand: 0, allocated: 0, bucketFree: 0, version: null }, direction: "IN", quantity: amount });
        }
      } else invalid("操作類型無效。");
    }
    for (const leg of legs) {
      const delta = legs.filter(other => same(other.bucket, leg.bucket)).reduce((sum, other) => sum + (other.direction === "IN" ? other.quantity : -other.quantity), 0);
      leg.projected = leg.bucket.onHand + delta;
      if (!Number.isSafeInteger(leg.projected)) invalid("預覽數量超出安全整數，不能確認。");
    }
    const reserved = await summaries(legs);
    if (live && own === generation && !props.disabled) emit("review", { action: props.action, movementId: props.action === "REVERSAL" ? props.movementId : undefined,
      body, preview: { legs, summaries: reserved, reasonText: reason, reasonCategory: body.reasonCategory } });
  } catch (cause) { if (live && own === generation) await showError(cause); }
  finally { if (live) loading.value = false; }
}
watch(code, () => { lookupGeneration++; lookupLoading.value = false; sku.value = null; lots.value = []; lotId.value = null; buckets.value = []; sourceBalanceId.value = null; });
watch(warehouseId, loadBins);
watch([sku, binId], () => { buckets.value = []; sourceBalanceId.value = null; });
watch([code, sku, warehouseId, binId, stockStatus, lotMode, lotId, lotNumber, expiryDate, manufactureDate, sourceBalanceId,
  destinationStatus, quantity, reasonText, reasonCategory, () => props.action, () => props.movementId, () => props.disabled], () => { generation++; }, { flush: "sync" });
onMounted(() => { if (props.action !== "REVERSAL") loadWarehouses(); });
onUnmounted(() => { live = false; generation++; lookupGeneration++; });
</script>
<template>
  <form aria-label="高風險庫存操作表單" @submit.prevent="prepare">
    <div v-if="error" ref="errorSummary" role="alert" tabindex="-1" class="bg-negative text-white q-pa-md q-mb-md">
      <a v-if="errorField" class="text-white" :href="`#inventory-adjustment-${errorField}`" @click.prevent="errorSummary.ownerDocument.getElementById(`inventory-adjustment-${errorField}`)?.focus()">{{ error }}</a><template v-else>{{ error }}</template>
    </div>
    <div v-if="loading || lookupLoading || selectorLoading" role="status" class="q-mb-sm">正在載入目前資料…</div>
    <fieldset :disabled="disabled || loading" class="operation-fields">
      <div v-if="action !== 'REVERSAL'" class="row q-col-gutter-sm">
        <q-input class="col-12 col-sm-8" v-model="code" outlined dense label="SKU Code" :disable="disabled || loading" @keydown.enter.prevent="lookup" />
        <div class="col-12 col-sm-4"><q-btn outline label="查找 SKU" :loading="lookupLoading" :disable="disabled || loading || lookupLoading" @click="lookup" /></div>
        <p v-if="sku" class="col-12" role="status">{{ sku.skuCode }} · {{ sku.skuName }} · Base UOM {{ sku.baseUom.uomCode }} · {{ sku.trackingPolicy }}</p>
        <q-select class="col-12 col-sm-6" v-model="warehouseId" :options="warehouses" option-value="id" option-label="code" emit-value map-options outlined dense label="倉庫" :disable="disabled || loading" />
        <q-select class="col-12 col-sm-6" v-model="binId" :options="bins" option-value="id" option-label="code" emit-value map-options outlined dense label="庫位" :disable="disabled || loading" />
        <template v-if="action === 'IN'">
          <q-select class="col-12 col-sm-6" v-model="stockStatus" :options="statuses" outlined dense label="庫存狀態" :disable="disabled || loading" />
          <template v-if="sku && sku.trackingPolicy !== 'none'">
            <q-select class="col-12 col-sm-6" v-model="lotMode" :options="[{ label: '既有批次', value: 'EXISTING' }, { label: '新批次', value: 'NEW' }]" emit-value map-options outlined dense label="批次模式" :disable="disabled || loading" />
            <q-select v-if="lotMode === 'EXISTING'" class="col-12" v-model="lotId" :options="lots" option-value="lotId" :option-label="lot => `${lot.lotNumber} · ${lot.expiryDate || '無效期'}`" emit-value map-options outlined dense label="既有批次" :disable="disabled || loading" />
            <p v-if="lotMode === 'EXISTING' && lotId" class="col-12">既有日期不可修改：效期 {{ lots.find(row => row.lotId === lotId)?.expiryDate || '無' }} · 製造日期 {{ lots.find(row => row.lotId === lotId)?.manufactureDate || '無' }} · 首次收貨 {{ lots.find(row => row.lotId === lotId)?.firstReceiptDate || '無' }}</p>
            <template v-if="lotMode === 'NEW'">
              <q-input class="col-12" v-model="lotNumber" outlined dense label="批次編號" :disable="disabled || loading" />
              <q-input id="inventory-adjustment-expiry" class="col-12 col-sm-6" v-model="expiryDate" outlined dense type="date" label="效期" :disable="disabled || loading" :error="errorField === 'expiry' && !!error" :error-message="error" />
              <q-input id="inventory-adjustment-manufacture" class="col-12 col-sm-6" v-model="manufactureDate" outlined dense type="date" label="製造日期" :disable="disabled || loading" :error="errorField === 'manufacture' && !!error" :error-message="error" />
            </template>
          </template>
        </template>
        <template v-else>
          <div class="col-12"><q-btn outline label="載入來源庫存" :disable="disabled || loading || !sku || !binId" @click="loadStocks" /></div>
          <q-select class="col-12" v-model="sourceBalanceId" :options="buckets" option-value="balanceId" :option-label="row => `${location(row)} · ${row.lot?.number || '無批次'} · ${row.stockStatus} · On Hand ${row.onHand} · v${row.version}`" emit-value map-options outlined dense label="來源庫存 bucket" :disable="disabled || loading" />
          <div v-if="!buckets.length" class="col-12" role="status">尚未載入或沒有來源庫存；不能確認。</div>
          <q-select v-if="action === 'STATUS_TRANSFER'" class="col-12" v-model="destinationStatus" :options="statuses" outlined dense label="目標狀態" :disable="disabled || loading" />
        </template>
        <q-input id="inventory-adjustment-quantity" class="col-12" v-model="quantity" outlined dense inputmode="numeric" label="數量（Base UOM）" :disable="disabled || loading" :error="errorField === 'quantity' && !!error" :error-message="error" hint="只接受安全正整數；本期 UI 不做 Pack 換算。" />
      </div>
      <p v-else>整組沖銷 Movement {{ movementId }}：準備確認時重新讀取原組及所有目前 bucket；不使用歷史版本、不重建 bucket。</p>
      <q-select v-if="action === 'IN' || action === 'OUT'" class="q-mt-md" v-model="reasonCategory" :options="categories" outlined dense label="原因分類" :disable="disabled || loading" />
      <q-input id="inventory-adjustment-reason" class="q-mt-md" v-model="reasonText" type="textarea" outlined label="原因說明" :disable="disabled || loading" :error="errorField === 'reason' && !!error" :error-message="error" hint="必填，最多 500 UTF-8 bytes；OTHER 至少 10 個非空白字元。" />
      <q-btn id="inventory-adjustment-review" class="q-mt-md" color="primary" type="submit" label="準備確認" :disable="disabled || loading || lookupLoading" :loading="loading" />
      <q-btn v-if="error && action !== 'REVERSAL'" class="q-mt-md" flat label="重載倉庫選擇器" :disable="disabled || loading" @click="loadWarehouses" />
    </fieldset>
  </form>
</template>
<style scoped>
.operation-fields { padding: 0; margin: 0; border: 0; min-width: 0; }
</style>
