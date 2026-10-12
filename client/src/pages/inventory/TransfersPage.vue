<script>
export const page = { name: "inventory-transfers", path: "/inventory/transfers", title: "調撥管理",
  requires: { permissions: ["inventory.view"] }, menu: { group: "inventory", icon: "local_shipping", order: 50 } };
</script>
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import { can } from "@/framework/authorization/can.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { promptReason } from "@/framework/ui/confirm.js";
import TransferEditor from "@/components/inventory/TransferEditor.vue";
import TransferReceive from "@/components/inventory/TransferReceive.vue";
import inventory from "@/services/inventory.js";
import { useSessionStore } from "@/stores/session.js";
const route = useRoute(), router = useRouter(), session = useSessionStore();
const canOperate = computed(() => can(session, { permissions: ["inventory.view", "inventory.operation"] }));
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const statuses = ["ALL", "DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];
const text = value => typeof value === "string" ? value : "";
const number = ref(text(route.query.number)), status = ref(statuses.includes(route.query.status) ? route.query.status : "ALL");
const sourceWarehouseId = ref(positive(route.query.sourceWarehouseId)), destinationWarehouseId = ref(positive(route.query.destinationWarehouseId));
const selectedId = ref(positive(route.query.id)), selected = ref(null), detailLoading = ref(false), detailError = ref("");
const table = ref(null), editor = ref(null), receiver = ref(null), mode = ref(""), busy = ref(false), operationError = ref("");
const summaries = ref([]), summaryLoading = ref(false), commandId = ref("");
const warehouses = ref([]), warehousePage = ref(0), warehouseTotal = ref(0), warehouseLoading = ref(false), warehouseError = ref("");
const pagination = { page: positive(route.query.page) ?? 1, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0,
  sortBy: ["number", "status", "createdAt", "updatedAt"].includes(route.query.sortBy) ? route.query.sortBy : "updatedAt", descending: route.query.descending !== "false" };
const current = ref({ ...pagination });
let detailGeneration = 0, summaryGeneration = 0;
const columns = [
  { name: "number", label: "單號", field: "number", sortable: true, align: "left" },
  { name: "status", label: "狀態", field: "status", sortable: true, align: "left" },
  { name: "source", label: "來源倉庫", field: "sourceWarehouseId", align: "left" },
  { name: "destination", label: "目的倉庫", field: "destinationWarehouseId", align: "left" },
  { name: "transit", label: "在途數量", field: "inTransitQuantity", align: "right" },
  { name: "actions", label: "詳情", field: "id", align: "right" }
];
const warehouseName = id => warehouses.value.find(row => row.id === id)?.code || `倉庫 #${id}`;
function syncUrl() {
  router.replace({ query: { number: number.value || undefined, status: status.value === "ALL" ? undefined : status.value,
    sourceWarehouseId: sourceWarehouseId.value || undefined, destinationWarehouseId: destinationWarehouseId.value || undefined,
    page: current.value.page, sortBy: current.value.sortBy, descending: String(current.value.descending), id: selectedId.value || undefined } });
}
function fetchTransfers(request) {
  current.value = request; syncUrl();
  return inventory.listTransfers({ ...request, filter: number.value, status: status.value, sourceWarehouseId: sourceWarehouseId.value, destinationWarehouseId: destinationWarehouseId.value });
}
async function loadDetail(id = selectedId.value) {
  const generation = ++detailGeneration;
  selectedId.value = id; selected.value = null; detailLoading.value = true; detailError.value = ""; syncUrl();
  try { const detail = await inventory.getTransfer(id); if (generation === detailGeneration) selected.value = detail; }
  catch (cause) { if (generation === detailGeneration) detailError.value = cause.message || "無法載入調撥，請重試。"; }
  finally { if (generation === detailGeneration) detailLoading.value = false; }
}
async function loadWarehouses() {
  if (warehouseLoading.value) return;
  warehouseLoading.value = true; warehouseError.value = "";
  try { const response = await inventory.listWarehouses({ page: warehousePage.value + 1, rowsPerPage: 100 });
    warehouses.value.push(...response.rows); warehousePage.value++; warehouseTotal.value = response.rowsNumber; }
  catch (cause) { warehouseError.value = cause.message || "無法載入倉庫，請重試。"; }
  finally { warehouseLoading.value = false; }
}
function canLeave() { return !busy.value && (mode.value !== "edit" || editor.value?.canDiscard()) && (mode.value !== "receive" || receiver.value?.canDiscard()); }
function newDraft() {
  detailGeneration++; selectedId.value = null; selected.value = null; detailLoading.value = false;
  detailError.value = ""; operationError.value = ""; syncUrl(); mode.value = "edit";
}
function closeDialog() { if (canLeave()) { mode.value = ""; summaryGeneration++; } }
onBeforeRouteLeave(canLeave);
async function saved(result) { mode.value = ""; operationError.value = ""; await loadDetail(result.id); await table.value?.reload(); }
async function prepareDispatch() {
  mode.value = "dispatch"; commandId.value = crypto.randomUUID(); await loadSummaries();
}
async function loadSummaries() {
  const generation = ++summaryGeneration;
  summaryLoading.value = true; summaries.value = []; operationError.value = "";
  try { const rows = await Promise.all([...new Set(selected.value.lines.map(line => line.skuId))].map(async skuId => ({
    skuId, code: selected.value.lines.find(line => line.skuId === skuId).skuCode,
    quantity: selected.value.lines.filter(line => line.skuId === skuId).reduce((sum, line) => sum + line.quantity, 0),
    ...await inventory.getStockSummary({ skuId, warehouseId: selected.value.sourceWarehouseId }) })));
    if (generation === summaryGeneration) summaries.value = rows;
  } catch (cause) { if (generation === summaryGeneration) operationError.value = cause.message || "無法載入 Reservation 保障摘要，請重試。"; }
  finally { if (generation === summaryGeneration) summaryLoading.value = false; }
}
async function change(action, reason) {
  if (!canOperate.value || busy.value || (action === "dispatch" && (summaryLoading.value || operationError.value || !summaries.value.length))) return;
  busy.value = true; operationError.value = "";
  try { const result = await inventory[`${action}Transfer`](selected.value.id, { version: selected.value.version, idempotencyKey: commandId.value,
    source: { module: "INVENTORY", documentType: "TRANSFER", documentId: String(selected.value.id), lineId: "", eventId: commandId.value },
    ...(action === "cancel" ? { reason } : {}) }); await saved(result); }
  catch (cause) { operationError.value = `${cause.message || '操作失敗'}。未自動重送；請重載詳情核對版本與庫存。`; }
  finally { busy.value = false; }
}
async function cancelDraft() {
  const reason = await promptReason({ title: "取消草稿", message: "取消整張草稿，不扣庫存。請輸入原因。" });
  if (reason !== null) { commandId.value = crypto.randomUUID(); await change("cancel", reason); }
}
watch([status, sourceWarehouseId, destinationWarehouseId], () => table.value?.reload());
onMounted(() => { loadWarehouses(); if (selectedId.value) loadDetail(); });
</script>

<template>
  <div>
    <PageHeader subtitle="整張調撥：草稿 → 在途 → 收貨；不支援部分過帳。" />
    <div class="q-px-md q-pb-md row q-col-gutter-sm items-start">
      <q-input class="col-12 col-sm-4" v-model="number" outlined dense debounce="300" label="搜尋調撥單號" clearable />
      <q-select class="col-12 col-sm-2" v-model="status" outlined dense :options="statuses" label="調撥狀態" />
      <q-select v-for="field in ['source', 'destination']" :key="field" class="col-12 col-sm-3" outlined dense clearable
        :model-value="field === 'source' ? sourceWarehouseId : destinationWarehouseId" :options="warehouses" option-value="id" option-label="code" emit-value map-options
        :label="field === 'source' ? '來源倉庫篩選' : '目的倉庫篩選'" :loading="warehouseLoading"
        @update:model-value="field === 'source' ? sourceWarehouseId = $event : destinationWarehouseId = $event" />
      <div class="col-12"><q-btn v-if="canOperate" color="primary" label="新增調撥" @click="newDraft" />
        <q-btn v-if="warehouseError || warehouses.length < warehouseTotal" flat label="載入篩選倉庫" @click="loadWarehouses" /></div>
      <q-banner v-if="warehouseError" role="alert" class="bg-negative text-white">{{ warehouseError }}</q-banner>
    </div>
    <section class="q-px-md q-pb-md" aria-label="調撥清單">
      <DataTable ref="table" :fetch="fetchTransfers" :columns="columns" :filter="number" :initial-pagination="pagination" row-key="id" sticky-actions>
        <template #body-cell-number="{ value }"><EllipsisCell :text="value" /></template>
        <template #body-cell-source="{ value }"><q-td>{{ warehouseName(value) }}</q-td></template>
        <template #body-cell-destination="{ value }"><q-td>{{ warehouseName(value) }}</q-td></template>
        <template #body-cell-actions="{ row }"><q-td class="text-right"><q-btn flat round icon="chevron_right" :aria-label="`查看調撥 ${row.number}`" @click="loadDetail(row.id)" /></q-td></template>
      </DataTable>
    </section>
    <section v-if="selectedId" class="q-px-md q-pb-md" aria-label="調撥詳情" :aria-busy="detailLoading">
      <q-btn flat label="關閉詳情" @click="selectedId = null; selected = null; detailGeneration++; syncUrl()" />
      <div v-if="detailLoading" role="status">正在載入調撥詳情…</div>
      <q-banner v-if="detailError || operationError" role="alert" class="bg-negative text-white q-mb-sm">{{ detailError || operationError }}</q-banner>
      <q-btn v-if="!detailLoading" flat label="重載詳情" @click="operationError = ''; loadDetail()" />
      <template v-if="selected">
        <h2 class="text-h6">{{ selected.number }} · {{ selected.status }}</h2>
        <p>{{ warehouseName(selected.sourceWarehouseId) }} → {{ warehouseName(selected.destinationWarehouseId) }} · 在途 {{ selected.inTransitQuantity }}</p>
        <q-banner v-if="selected.status === 'IN_TRANSIT'" role="status" class="bg-warning q-mb-md">來源已扣、目的未入；在途不可修改／取消。</q-banner>
        <div v-if="canOperate" class="row q-gutter-sm q-mb-md">
          <template v-if="selected.status === 'DRAFT'">
            <q-btn outline label="編輯草稿" @click="mode = 'edit'" /><q-btn outline label="取消草稿" @click="cancelDraft" :disable="busy" />
            <q-btn color="primary" label="準備整張出庫" @click="prepareDispatch" :disable="busy" />
          </template>
          <q-btn v-if="selected.status === 'IN_TRANSIT'" color="primary" label="準備整張收貨" @click="mode = 'receive'" />
        </div>
        <q-list bordered separator><q-item v-for="line in selected.lines" :key="line.id"><q-item-section>
          <q-item-label>{{ line.skuCode }} · {{ line.lotNumber || '無批次' }} · {{ line.expiryDate || '無效期' }}</q-item-label>
          <q-item-label>來源 Bin #{{ line.sourceBinId }} → {{ line.destinationBinId ? `目的 Bin #${line.destinationBinId}` : '目的未入' }} · {{ line.dispatchStockStatus }} → {{ line.receiveStockStatus || '未收貨' }}</q-item-label>
          <q-item-label>數量 {{ line.quantity }} · 在途 {{ line.inTransitQuantity }}</q-item-label>
        </q-item-section></q-item></q-list>
        <p v-if="selected.reason">原因：{{ selected.reason }}</p>
        <h3 class="text-subtitle1">異動追溯</h3><div v-if="!selected.movements.length" role="status">尚無庫存異動。</div>
        <q-list v-else bordered><q-item v-for="movement in selected.movements" :key="movement.movementId" clickable :to="{ path: '/inventory/movements', query: { movementId: movement.movementId } }">
          <q-item-section>Movement {{ movement.movementId }} · {{ movement.direction }} {{ movement.quantity }} · {{ movement.stockStatus }}</q-item-section>
        </q-item></q-list>
      </template>
    </section>
    <q-dialog :model-value="!!mode" persistent @update:model-value="closeDialog">
      <q-card class="transfer-dialog">
        <TransferEditor v-if="mode === 'edit'" ref="editor" :detail="selected" @saved="saved" @close="mode = ''" />
        <TransferReceive v-if="mode === 'receive' && selected" ref="receiver" :detail="selected" @saved="saved" @close="mode = ''" />
        <q-card-section v-if="mode === 'dispatch'">
          <h2 class="text-h6">整張出庫 {{ selected.number }}</h2>
          <p>只可移動未保障 Reservation 的數量。整張過帳，不支援部分；提交時後端重新檢查庫存及鎖定。</p>
          <div v-if="summaryLoading" role="status">正在載入來源保障摘要…</div>
          <q-banner v-if="operationError" role="alert" class="bg-negative text-white">{{ operationError }}</q-banner>
          <p v-for="row in summaries" :key="row.skuId">{{ row.code }}：來源 {{ row.eligibleOnHand }} · 本單 {{ row.quantity }} · Reserved {{ row.reserved }} · ATP {{ row.atp }}</p>
          <q-btn v-if="operationError" flat label="重試摘要" @click="loadSummaries" />
          <div class="row justify-end q-gutter-sm"><q-btn flat label="返回詳情" :disable="busy" @click="closeDialog" />
            <q-btn color="primary" label="確認整張出庫" :loading="busy" :disable="summaryLoading || !!operationError || !summaries.length || busy" @click="change('dispatch')" /></div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>
<style scoped>
.transfer-dialog { width: 840px; max-width: 100%; }
</style>
