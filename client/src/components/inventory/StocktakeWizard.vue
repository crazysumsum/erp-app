<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import InventoryHighRiskDialog from "./InventoryHighRiskDialog.vue";
import StocktakeScopeForm from "./StocktakeScopeForm.vue";
import StocktakeCounter from "./StocktakeCounter.vue";
import StocktakeAddLine from "./StocktakeAddLine.vue";
import inventory from "@/services/inventory.js";
import { createStocktakeTable, stocktakeError, validStocktakeText } from "./stocktakeIntent.js";
const props = defineProps({ id: { type: Number, required: true }, readQuery: { type: Object, default: () => ({}) }, operate: Boolean, adjust: Boolean,
  blocked: Boolean, command: { type: Function, required: true }, intentState: { type: Object, required: true }, retry: { type: Function, required: true },
  queryOriginal: { type: Function, required: true }, reprepare: { type: Function, required: true } });
const header = ref(null), loading = ref(false), error = ref(""), flowError = ref(""), mode = ref(""), action = ref(""), reason = ref(""), passwordModal = ref(false);
const editor = ref(null), row = ref(null), editorDirty = ref(false), settled = ref(false), summary = ref(null), exporting = ref(false), downloadNotice = ref("");
const lookupMode = ref("Code"), lookupText = ref(""), lookupLoading = ref(false), lookupResult = ref(null);
const committedKey = ref(null), currentKnown = ref(false), factsError = ref(""), confirmedAdd = ref(null);
const initialFilters = Object.fromEntries(["binId", "skuId", "lotId", "stockStatus", "progress", "variance", "q"].filter(key => props.readQuery[key] !== undefined).map(key => [key, props.readQuery[key]]));
const filters = ref(initialFilters), queryText = ref(initialFilters.q ?? ""), queryInput = ref(null);
const pendingProgress = ref(initialFilters.progress ?? "ALL"), pendingVariance = ref(initialFilters.variance ?? "ALL");
let alive = true, generation = 0, lookupGeneration = 0, controller = new AbortController();
let returnCountFocus = null;
const current = () => alive && !!header.value;
const lineTable = createStocktakeTable({ active: () => current() && !mode.value,
  initial: { page: props.readQuery.linePage ?? 1, rowsPerPage: 20 },
  read: params => inventory.listStocktakeLines(props.id, { ...params, ...filters.value }),
  onRetire: () => { settled.value = false; committedKey.value = null; },
  onCommit: (response, _, key) => {
    if (response.id !== props.id || !response.globalSummary) { settled.value = false; return; }
    summary.value = response.globalSummary; settled.value = true; committedKey.value = key;
    const pendingFocus = returnCountFocus;
    if (pendingFocus?.key === key && !response.rows.some(line => line.id === pendingFocus.id)) nextTick(() => {
      if (alive && editable.value && key === committedKey.value && key === lines.value?.key && returnCountFocus === pendingFocus && queryInput.value?.nativeEl?.isConnected) {
        queryInput.value.nativeEl.focus(); returnCountFocus = null;
      }
    });
    if (confirmedAdd.value && response.rows.some(line => line.id === confirmedAdd.value.id && line.stocktakeId === props.id)) factsError.value = "";
  } });
const scopeTable = createStocktakeTable({ active: () => current() && !mode.value,
  initial: { page: props.readQuery.scopePage ?? 1, rowsPerPage: 20 },
  read: async ({ page, rowsPerPage, signal }) => { const result = await inventory.getStocktake(props.id, { scopePage: page, scopePageSize: rowsPerPage, signal });
    if (result.id !== props.id || result.version !== header.value?.version || result.status !== header.value?.status) throw new Error("範圍版本已變更。");
    return { rows: result.scope.items, rowsNumber: result.scope.total }; } });
const lines = lineTable.instance, scopes = scopeTable.instance;
const globalSummary = computed(() => summary.value ?? header.value?.progress);
const total = computed(() => globalSummary.value?.totalLines ?? null);
const completed = computed(() => globalSummary.value ? globalSummary.value.countedLines + globalSummary.value.notFoundLines : null);
const status = computed(() => header.value?.status);
const editable = computed(() => props.operate && status.value === "COUNTING" && currentKnown.value && settled.value && !props.blocked);
const strong = computed(() => ["post", "cancel"].includes(action.value));
const strongAllowed = computed(() => (action.value === "post" ? props.adjust : props.operate) && !props.intentState.busy &&
  (!props.blocked || (["UNKNOWN", "REJECTED"].includes(props.intentState.status) && props.intentState.record?.action === action.value)));
const validReason = computed(() => validStocktakeText(reason.value, { required: true }));
const lineColumns = [{ name: "bin", label: "庫位", field: "binCodeCurrent", align: "left" }, { name: "sku", label: "SKU／名稱", field: "skuCodeCurrent", align: "left" },
  { name: "lot", label: "批次／狀態", field: "lotNumberCurrent", align: "left" }, { name: "snapshot", label: "帳面 Base", field: "snapshotQuantity", align: "right" },
  { name: "actual", label: "實數／點算狀態", field: "actualQuantity", align: "right" }, { name: "variance", label: "差異／階段", field: "varianceQuantity", align: "right" },
  { name: "actions", label: "操作", field: "id", align: "right" }];
const scopeColumns = [{ name: "code", label: "所屬庫位", field: "binCodeCurrent", align: "left" }, { name: "status", label: "目前庫位狀態", field: "statusCurrent", align: "left" }];
async function reload() {
  const own = ++generation; controller.abort(); controller = new AbortController(); loading.value = true; error.value = ""; settled.value = false;
  lineTable.dispose(); scopeTable.dispose(); summary.value = null;
  try {
    const result = await inventory.getStocktake(props.id, { signal: controller.signal });
    if (!alive || own !== generation) return false;
    if (result.id !== props.id || !result.progress || !result.scope || !Number.isSafeInteger(result.version) || !Number.isSafeInteger(result.progress.totalLines)) throw new Error("目前盤點資料不完整。");
    header.value = result; currentKnown.value = true;
    if (!mode.value) { lineTable.resume(); scopeTable.resume(); }
    return true;
  } catch (cause) { if (alive && own === generation) { currentKnown.value = false; error.value = stocktakeError(cause).message; } return false; }
  finally { if (alive && own === generation) loading.value = false; }
}
function pauseTables() { lineTable.suspend(); scopeTable.suspend(); lookupGeneration++; lookupLoading.value = false; lookupResult.value = null; }
function openEditor(kind, selectedRow = null, tableKey = null) {
  if (props.blocked || !currentKnown.value || !props.operate || mode.value || (kind === "count" &&
    (!editable.value || tableKey !== committedKey.value || tableKey !== lines.value?.key))) return;
  returnCountFocus = null; row.value = selectedRow ? Object.freeze(JSON.parse(JSON.stringify(selectedRow))) : null;
  mode.value = kind; editorDirty.value = false; pauseTables();
}
const rowAction = (selectedRow, tableKey) => () => openEditor("count", selectedRow, tableKey);
function closeEditor(confirmed = false) {
  if (props.blocked || (!confirmed && !editor.value?.canDiscard())) return;
  const id = mode.value === "count" ? row.value?.id : null;
  mode.value = ""; row.value = null; editorDirty.value = false; lineTable.resume(); scopeTable.resume();
  returnCountFocus = id ? { id, key: lines.value?.key } : null;
}
// The Count table remounts, so QDialog's original trigger no longer exists.
function focusCount(button, id, key) {
  if (!button) return;
  nextTick(() => {
    if (alive && editable.value && returnCountFocus?.id === id && returnCountFocus.key === key && key === committedKey.value && button.$el.isConnected) {
      button.$el.focus(); returnCountFocus = null;
    }
  });
}
async function saved() {
  if (!alive) return;
  const id = mode.value === "count" ? row.value?.id : null;
  mode.value = ""; row.value = null; editorDirty.value = false; action.value = ""; passwordModal.value = false; reason.value = ""; flowError.value = "";
  await reload();
  if (alive && id) returnCountFocus = { id, key: lines.value?.key };
}
async function perform(kind, body, password) {
  const own = generation;
  const receipt = await props.command(kind, props.id, body, password);
  return alive && own === generation ? receipt : null;
}
async function add(body) {
  const receipt = await perform("add_line", body);
  if (!receipt || !alive) return null;
  confirmedAdd.value = receipt;
  try {
    const response = await inventory.listStocktakeLines(props.id, { binId: body.binId, skuId: body.skuId,
      ...(body.lotId === null ? {} : { lotId: body.lotId }), stockStatus: body.stockStatus, page: 1, rowsPerPage: 20, signal: controller.signal });
    if (!alive) return null;
    if (!response.rows.some(line => line.id === receipt.id && line.stocktakeId === props.id && line.binId === body.binId && line.skuId === body.skuId && line.lotId === body.lotId && line.stockStatus === body.stockStatus)) throw new Error("目前行未確認。");
    factsError.value = "";
  } catch { if (alive) factsError.value = "帳外行原回執已確認；目前行尚未核對，請重讀。這不是失敗的寫入，不能重建提交。"; }
  if (!alive) return null;
  filters.value = { binId: body.binId, skuId: body.skuId, ...(body.lotId === null ? {} : { lotId: body.lotId }), stockStatus: body.stockStatus };
  return receipt;
}
function prepare(kind) {
  if (props.blocked || !currentKnown.value || mode.value || (kind === "post" ? !props.adjust : !props.operate)) return;
  if (kind === "ready" && globalSummary.value?.uncountedLines !== 0) return;
  action.value = kind; reason.value = ""; flowError.value = ""; mode.value = "flow"; pauseTables();
}
async function confirmFlow() {
  if (strong.value) { if (!validReason.value || !strongAllowed.value) throw new Error("請輸入非空白原因，最多 500 UTF-8 bytes，不含控制字元。"); passwordModal.value = true; return; }
  try {
    const receipt = await perform(action.value, { expectedVersion: header.value.version });
    if (receipt) await saved();
  } catch (cause) { throw stocktakeError(cause); }
}
async function confirmStrong(password) {
  if (!strongAllowed.value) return;
  const own = generation;
  try {
    if (["UNKNOWN", "REJECTED"].includes(props.intentState.status)) {
      await props.retry(password);
    } else {
      const receipt = await perform(action.value, { expectedVersion: header.value.version, reason: reason.value.trim() }, password);
      if (receipt && alive && own === generation) await saved();
    }
  } catch (cause) { if (alive && own === generation) { passwordModal.value = false; flowError.value = `${stocktakeError(cause).message} 原提交不會自動重送；請查詢原結果核對庫存及鎖。`; } }
  finally { password = null; }
}
function closeFlow() {
  if (props.blocked || props.intentState.busy) return;
  if (reason.value && !window.confirm("確認尚未提交，確定捨棄原因與確認嗎？")) return;
  mode.value = ""; action.value = ""; reason.value = ""; passwordModal.value = false; lineTable.resume(); scopeTable.resume();
}
function applyFilters() {
  if (mode.value || props.blocked || !validStocktakeText(queryText.value, { bytes: 760, length: 190 })) return;
  filters.value = { ...filters.value, q: queryText.value.trim(), progress: pendingProgress.value, variance: pendingVariance.value };
  lineTable.refresh({ page: 1, rowsPerPage: lineTable.committed().rowsPerPage });
}
function changeLookup(value, selectedMode = lookupMode.value) { lookupText.value = value ?? ""; lookupMode.value = selectedMode; lookupGeneration++; lookupLoading.value = false; lookupResult.value = null; }
async function locate() {
  if (mode.value || lookupLoading.value || !validStocktakeText(lookupText.value, { required: true, bytes: 760, length: 190 })) return;
  const own = ++lookupGeneration, text = lookupText.value, selectedMode = lookupMode.value; lookupLoading.value = true;
  try { const result = await inventory[selectedMode === "Barcode" ? "lookupSkuByBarcode" : "lookupSku"](text, { signal: controller.signal });
    if (!alive || own !== lookupGeneration || mode.value) return;
    lookupResult.value = result; filters.value = { ...filters.value, skuId: result.skuId }; settled.value = false; lineTable.refresh({ page: 1, rowsPerPage: 20 });
  } catch (cause) { if (alive && own === lookupGeneration) flowError.value = stocktakeError(cause).message; }
  finally { if (alive && own === lookupGeneration) lookupLoading.value = false; }
}
async function download() {
  if (exporting.value || mode.value) return;
  const own = generation; exporting.value = true; downloadNotice.value = ""; let url;
  try {
    const result = await inventory.exportStocktake(props.id, { ...filters.value, signal: controller.signal });
    if (!alive || own !== generation) return;
    url = URL.createObjectURL(result.blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.fileName || `stocktake-${props.id}.csv`;
    document.body.appendChild(anchor); try { anchor.click(); } finally { anchor.remove(); }
    downloadNotice.value = "CSV 已交付下載，不代表完整；請檢查最後 SUMMARY 的 truncated／reason。預覽可能因後續點算而過時。";
  } catch (cause) { if (alive && own === generation) downloadNotice.value = stocktakeError(cause).message; }
  finally { if (url) URL.revokeObjectURL(url); if (alive && own === generation) exporting.value = false; }
}
function hasChanges() { return !!mode.value || editorDirty.value; }
function canDiscard() {
  if (!mode.value) return true;
  if (props.blocked) return false;
  if (mode.value === "flow") { if (!window.confirm("確認尚未儲存，確定離開嗎？")) return false;
    closeEditor(true); action.value = ""; reason.value = ""; passwordModal.value = false; return true; }
  if (!editor.value?.canDiscard()) return false;
  closeEditor(true); return true;
}
function clear() {
  returnCountFocus = null;
  generation++; lookupGeneration++; controller.abort(); header.value = null; summary.value = null; row.value = null; mode.value = ""; reason.value = "";
  passwordModal.value = false; editorDirty.value = false; lookupText.value = ""; lookupResult.value = null; error.value = ""; flowError.value = "";
  currentKnown.value = false; factsError.value = ""; confirmedAdd.value = null; filters.value = {}; queryText.value = "";
  lineTable.dispose(); scopeTable.dispose();
}
async function recovered() { await saved(); }
watch(() => props.readQuery, query => {
  if (!alive || mode.value) return;
  const next = Object.fromEntries(["binId", "skuId", "lotId", "stockStatus", "progress", "variance", "q"].filter(key => query[key] !== undefined).map(key => [key, query[key]]));
  const page = query.linePage ?? 1, scopePage = query.scopePage ?? 1;
  if (JSON.stringify(next) !== JSON.stringify(filters.value) || page !== lineTable.committed().page) {
    filters.value = next; queryText.value = next.q ?? ""; pendingProgress.value = next.progress ?? "ALL"; pendingVariance.value = next.variance ?? "ALL";
    lookupGeneration++; lookupResult.value = null; lineTable.refresh({ page, rowsPerPage: 20 });
  }
  if (scopePage !== scopeTable.committed().page) scopeTable.refresh({ page: scopePage, rowsPerPage: 20 });
});
defineExpose({ reload, recovered, clear, canDiscard, hasChanges });
onMounted(reload); onUnmounted(() => { alive = false; clear(); });
</script>
<template>
  <section class="q-mt-lg stocktake-wizard" aria-label="盤點四步流程">
    <div v-if="loading" role="status">正在載入目前盤點；不推定庫存或鎖狀態。</div>
    <q-banner v-if="error || flowError || factsError" role="alert" class="bg-negative text-white q-mb-md">{{ error || flowError || factsError }}</q-banner>
    <q-btn v-if="!header && !loading" outline label="重讀目前盤點" @click="reload" />
    <template v-if="header">
      <h2 class="text-h6">{{ header.number }} · {{ header.status }} · workflow version {{ header.version }}</h2>
      <p>1 選範圍 → 2 Start → 3 點算 → 4 Review／Post</p>
      <q-banner class="q-mb-md bg-surface">
        <template v-if="!currentKnown">上次已讀到 {{ header.status }}；目前狀態未能確認，不能推定已解鎖或仍鎖定。</template>
        <template v-else-if="status === 'DRAFT'">範圍排他；尚未鎖定庫存。</template>
        <template v-else-if="['COUNTING', 'READY_TO_POST'].includes(status)">本次讀取：{{ header.scope.total }} 個範圍庫位有持久盤點鎖，暫停庫存異動。失敗或未知結果必須重查，不能推定已解鎖。</template>
        <template v-else-if="status === 'CANCELLED'">已取消，不代表已過帳。保留取消前 {{ header.varianceStage }} 與歷史。</template>
        <template v-else>本次讀取：已過帳，歷史唯讀。</template>
      </q-banner>
      <p v-if="globalSummary" role="status">全局完成 {{ completed }}/{{ total }} · 未點算 {{ globalSummary.uncountedLines }} · NOT_FOUND {{ globalSummary.notFoundLines }}</p>
      <p>差異 {{ header.varianceStage }}：PREVIEW 是未凍結預覽；FROZEN 才是 Ready 後的伺服器值。不同 SKU／UOM 不加總數量。</p>
      <div class="row q-gutter-sm q-mb-md">
        <q-btn v-if="operate && status === 'DRAFT'" outline label="編輯草稿範圍" :disable="blocked || !!mode" @click="openEditor('scope')" />
        <q-btn v-if="operate && status === 'DRAFT'" color="primary" label="準備 Start" :disable="blocked || !!mode" @click="prepare('start')" />
        <q-btn v-if="operate && status === 'COUNTING'" outline label="新增帳外 Bucket" :disable="blocked || !!mode" @click="openEditor('add')" />
        <q-btn v-if="operate && status === 'COUNTING'" color="primary" label="準備 Ready" :disable="blocked || !!mode || !settled || globalSummary?.uncountedLines !== 0" @click="prepare('ready')" />
        <q-btn v-if="adjust && status === 'READY_TO_POST'" color="negative" label="準備 Post" :disable="blocked || !!mode" @click="prepare('post')" />
        <q-btn v-if="operate && ['DRAFT', 'COUNTING', 'READY_TO_POST'].includes(status)" outline label="準備 Cancel" :disable="blocked || !!mode" @click="prepare('cancel')" />
        <q-btn outline label="下載盤點 CSV" :disable="!!mode || exporting" :loading="exporting" @click="download" />
        <q-btn flat label="重讀目前盤點" :disable="!!mode || blocked || loading" @click="reload" />
      </div>
      <p v-if="downloadNotice" role="status">{{ downloadNotice }}</p>
      <DataTable v-if="scopes && !mode" :key="`scope:${scopes.key}`" :fetch="scopes.fetch" :initial-pagination="scopes.pagination" :columns="scopeColumns" aria-label="目前盤點範圍" />
      <div v-if="!mode" class="q-mt-md">
        <div class="row q-col-gutter-sm items-start">
          <q-input ref="queryInput" v-model="queryText" class="col-12 col-sm-5" outlined label="盤點行 Code／名稱 q（不搜尋帳外目錄）" :disable="blocked" @keydown.enter.prevent="applyFilters" />
          <div class="col-12 col-sm-3"><q-btn outline label="套用行篩選" :disable="blocked" @click="applyFilters" /></div>
          <q-select v-model="pendingProgress" class="col-12 col-sm-4" outlined :options="['ALL', 'UNCOUNTED', 'COUNTED', 'NOT_FOUND']" label="點算篩選" :disable="blocked" @update:model-value="applyFilters" />
          <q-select v-model="pendingVariance" class="col-12 col-sm-4" outlined :options="['ALL', 'GAIN', 'LOSS', 'ZERO']" label="差異篩選" :disable="blocked" @update:model-value="applyFilters" />
          <q-select v-model="lookupMode" class="col-12 col-sm-3" outlined :options="['Code', 'Barcode']" label="定位模式" :disable="blocked" @update:model-value="changeLookup(lookupText, $event)" />
          <q-input :model-value="lookupText" class="col-12 col-sm-5" outlined label="定位 Code／Barcode" :disable="blocked" @update:model-value="changeLookup($event)" @keydown.enter.prevent="locate" />
        </div>
        <q-btn outline label="定位現有 SKU 行" :disable="blocked || lookupLoading" :loading="lookupLoading" @click="locate" />
        <p v-if="lookupResult">已定位 {{ lookupResult.skuCode }}；請明確選擇 Bucket，不自動增加實數或選 Bin／Lot／Status。</p>
        <DataTable v-if="lines" :key="`line:${lines.key}`" :fetch="lines.fetch" :initial-pagination="lines.pagination" :columns="lineColumns" sticky-actions aria-label="點算行表格" class="q-mt-md">
          <template #body-cell-sku="cell"><q-td :props="cell"><EllipsisCell :text="`${cell.row.skuCodeCurrent} · ${cell.row.skuNameCurrent}`" /></q-td></template>
          <template #body-cell-lot="cell"><q-td :props="cell">{{ cell.row.lotNumberCurrent || '無批次' }} · {{ cell.row.stockStatus }}</q-td></template>
          <template #body-cell-snapshot="cell"><q-td :props="cell">{{ cell.row.snapshotQuantity }} {{ cell.row.baseUom.uomCode }}</q-td></template>
          <template #body-cell-actual="cell"><q-td :props="cell">{{ cell.row.actualQuantity ?? '未點算（NULL）' }} · {{ cell.row.countState }} · 行版本 {{ cell.row.version }}</q-td></template>
          <template #body-cell-variance="cell"><q-td :props="cell">{{ cell.row.varianceQuantity ?? '未有差異（NULL）' }} · {{ cell.row.varianceStage }}</q-td></template>
          <template #body-cell-actions="cell"><q-td :props="cell"><q-btn v-if="operate && status === 'COUNTING'" :ref="button => focusCount(button, cell.row.id, lines?.key)" flat label="點算此行" :disable="!editable" :onClick="rowAction(cell.row, lines.key)" /></q-td></template>
        </DataTable>
      </div>
      <q-dialog :model-value="['scope', 'count', 'add'].includes(mode)" persistent @update:model-value="closeEditor">
        <q-card class="stocktake-dialog">
          <section v-if="intentState.record" class="q-pa-md" aria-label="原操作復原">
            <p>原結果 {{ intentState.status }}；原輸入及版本保留，不自動重送。</p>
            <q-btn outline label="查詢原結果" :disable="intentState.busy" @click="queryOriginal" />
            <q-btn v-if="['UNKNOWN', 'REJECTED'].includes(intentState.status)" outline label="明確重試原提交" :disable="intentState.busy" @click="retry()" />
            <q-btn v-if="intentState.status === 'REJECTED'" flat label="查詢並重新準備被拒意圖" :disable="intentState.busy" @click="reprepare" />
          </section>
          <StocktakeScopeForm v-if="mode === 'scope'" ref="editor" :detail="header" :submit="body => perform('update', body)" :disabled="blocked" @dirty="editorDirty = true" @close="closeEditor(true)" @saved="saved" />
          <StocktakeCounter v-if="mode === 'count'" ref="editor" :line="row" :submit="body => perform('count', body)" :disabled="blocked" @dirty="editorDirty = true" @close="closeEditor(true)" @saved="saved" />
          <StocktakeAddLine v-if="mode === 'add'" ref="editor" :detail="header" :submit="add" :disabled="blocked" @dirty="editorDirty = true" @close="closeEditor(true)" @saved="saved" />
        </q-card>
      </q-dialog>
      <q-dialog :model-value="mode === 'flow'" persistent @update:model-value="closeFlow">
        <q-card class="stocktake-dialog"><FormPanel :on-submit="confirmFlow" aria-label="盤點工作流程確認" class="q-pa-md" v-slot="{ submitting }">
          <h2 class="text-h6 q-mt-none">確認 {{ action }} · {{ header.number }}</h2>
          <p v-if="action === 'start'">Start 處理整個範圍，暫停庫存異動；只有伺服器確認成功才取得鎖與快照。</p>
          <p v-if="action === 'ready'">使用全局最新已提交點算結果；Ready 才凍結，不可重新開啟。空範圍行數 0/0 仍須明確確認。</p>
          <p v-if="action === 'post'">整張 FROZEN 差異原子過帳。每 Bucket 仍須保護 allocated，整張仍須保護 Reserved 覆蓋；全零仍需密碼與 device 簽章。</p>
          <p v-if="action === 'cancel'">取消保留歷史，只解除這張盤點的鎖；需目前密碼，不需 device 簽章。停用庫位不阻擋合法取消。</p>
          <p>全局 {{ total }} 行；不混加不同 SKU／UOM。</p>
          <q-input v-if="strong" v-model="reason" type="textarea" autogrow outlined label="Post／Cancel 原因" :disable="blocked || submitting" />
          <q-banner v-if="flowError" role="alert" class="bg-negative text-white q-mt-md">{{ flowError }}</q-banner>
          <section v-if="intentState.record" aria-label="原工作流程復原">
            <p>原結果 {{ intentState.status }}；不自動重送。</p>
            <q-btn outline label="查詢原結果" :disable="intentState.busy" @click="queryOriginal" />
            <q-btn v-if="!strong && ['UNKNOWN', 'REJECTED'].includes(intentState.status)" outline label="明確重試原提交" :disable="intentState.busy" @click="retry()" />
            <q-btn v-if="intentState.status === 'REJECTED'" flat label="查詢並重新準備被拒意圖" :disable="intentState.busy" @click="reprepare" />
          </section>
          <div class="row justify-end q-gutter-sm q-mt-md"><q-btn flat label="返回盤點" :disable="blocked || submitting" @click="closeFlow" />
            <q-btn v-if="strong" color="negative" label="確認原因並輸入密碼" :disable="!validReason || !strongAllowed || submitting" @click="confirmFlow" />
            <q-btn v-else color="primary" type="submit" :label="action === 'start' ? '確認整張 Start' : '確認 Ready'" :disable="blocked || submitting" :loading="submitting" />
          </div>
        </FormPanel></q-card>
      </q-dialog>
      <InventoryHighRiskDialog v-if="passwordModal" :model-value="passwordModal" :title="action === 'cancel' ? '取消盤點（只需目前密碼）' : '盤點過帳（密碼＋設備簽章）'"
        :confirm-label="action === 'cancel' ? '取消盤點' : '確認過帳'" :disabled="!strongAllowed" :busy="intentState.busy" :execute="confirmStrong" @update:model-value="passwordModal = $event" />
    </template>
  </section>
</template>
<style scoped>
.stocktake-wizard { min-width: 0; }
.stocktake-dialog { width: 760px; max-width: 100%; }
</style>
