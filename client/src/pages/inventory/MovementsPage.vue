<script>
export const page = {
  name: "inventory-movements",
  path: "/inventory/movements",
  title: "庫存異動",
  requires: { permissions: ["inventory.view"] },
  menu: { group: "inventory", icon: "history", order: 40 }
};
</script>

<script setup>
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import inventoryService from "@/services/inventory.js";

const route = useRoute();
const router = useRouter();
const initial = route.query;
const positive = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const text = (value) => typeof value === "string" ? value : "";
const dateValue = (value) => /^\d{4}-\d{2}-\d{2}$/u.test(text(value)) ? value : "";
const toStart = (value) => value ? new Date(`${value}T00:00:00`).getTime() : undefined;
const toEnd = (value) => value ? new Date(`${value}T23:59:59.999`).getTime() : undefined;
const postedFrom = ref(dateValue(initial.postedFrom));
const postedTo = ref(dateValue(initial.postedTo));
const movementType = ref(text(initial.movementType));
const sourceModule = ref(text(initial.sourceModule));
const sourceDocumentType = ref(text(initial.sourceDocumentType));
const sourceDocumentId = ref(text(initial.sourceDocumentId));
const skuId = ref(text(initial.skuId));
const warehouseId = ref(text(initial.warehouseId));
const binId = ref(text(initial.binId));
const lotId = ref(text(initial.lotId));
const actorId = ref(text(initial.actorId));
const selectedId = ref(positive(initial.movementId));
const detail = ref(null);
const detailLoading = ref(false);
const detailError = ref("");
const table = ref(null);
const currentPage = ref(positive(initial.page) ?? 1);
const initialPagination = { page: currentPage.value, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0, sortBy: null, descending: true };
let listController;
let detailController;

const columns = [
  { name: "postedAt", label: "時間", field: "postedAt", align: "left" },
  { name: "movementType", label: "類型", field: "movementType", align: "left" },
  { name: "direction", label: "方向／數量", field: "direction", align: "left" },
  { name: "sku", label: "SKU", field: (row) => row.sku.code, align: "left" },
  { name: "location", label: "位置", field: (row) => row.bin ? `${row.warehouse.code}/${row.bin.code}` : `${row.warehouse.code}/在途`, align: "left" },
  { name: "lot", label: "批次", field: (row) => row.lot?.number ?? "無批次", align: "left" },
  { name: "status", label: "狀態", field: "stockStatus", align: "left" },
  { name: "source", label: "來源", field: (row) => `${row.source.module}/${row.source.documentType}/${row.source.documentId}`, align: "left" },
  { name: "actions", label: "操作", field: "movementId", align: "right" }
];
const detailColumns = [
  { name: "movementId", label: "Movement", field: "movementId", align: "left" },
  { name: "direction", label: "方向", field: "direction", align: "left" },
  { name: "quantity", label: "數量", field: "quantity", align: "right" },
  { name: "location", label: "位置", field: (row) => row.bin ? `${row.warehouse.code}/${row.bin.code}` : `${row.warehouse.code}/在途`, align: "left" },
  { name: "status", label: "狀態", field: "stockStatus", align: "left" }
];
function filters() {
  return {
    postedFrom: toStart(postedFrom.value), postedTo: toEnd(postedTo.value),
    movementType: movementType.value || undefined, sourceModule: sourceModule.value || undefined,
    sourceDocumentType: sourceDocumentType.value || undefined,
    sourceDocumentId: sourceDocumentId.value || undefined, skuId: positive(skuId.value) ?? undefined,
    warehouseId: positive(warehouseId.value) ?? undefined, binId: positive(binId.value) ?? undefined,
    lotId: positive(lotId.value) ?? undefined, actorId: positive(actorId.value) ?? undefined
  };
}
function syncUrl() {
  router.replace({ query: {
    postedFrom: postedFrom.value || undefined, postedTo: postedTo.value || undefined,
    movementType: movementType.value || undefined, sourceModule: sourceModule.value || undefined,
    sourceDocumentType: sourceDocumentType.value || undefined,
    sourceDocumentId: sourceDocumentId.value || undefined, skuId: positive(skuId.value) ?? undefined,
    warehouseId: positive(warehouseId.value) ?? undefined, binId: positive(binId.value) ?? undefined,
    lotId: positive(lotId.value) ?? undefined, actorId: positive(actorId.value) ?? undefined,
    page: currentPage.value, movementId: selectedId.value ?? undefined
  } });
}
function fetchMovements(request) {
  listController?.abort();
  listController = new AbortController();
  currentPage.value = request.page;
  syncUrl();
  return inventoryService.listMovements({ ...request, sortBy: undefined, descending: undefined, ...filters(), signal: listController.signal });
}
async function openDetail(rowOrId) {
  const id = typeof rowOrId === "object" ? rowOrId.movementId : rowOrId;
  selectedId.value = id;
  detailController?.abort();
  detailController = new AbortController();
  detailLoading.value = true;
  detailError.value = "";
  syncUrl();
  try {
    detail.value = await inventoryService.getMovement(id, { signal: detailController.signal });
  } catch (error) {
    if (error.name !== "AbortError") detailError.value = error.message || "無法載入異動詳情";
  } finally {
    detailLoading.value = false;
  }
}
function closeDetail() { detailController?.abort(); selectedId.value = null; detail.value = null; detailError.value = ""; syncUrl(); }
function sourceText(source) { return `${source.module} / ${source.documentType} / ${source.documentId}${source.lineId ? ` / 行 ${source.lineId}` : ""} / 事件 ${source.eventId}`; }
function formatTime(value) { return new Date(value).toLocaleString("zh-HK"); }
watch([postedFrom, postedTo, movementType, sourceModule, sourceDocumentType, sourceDocumentId, skuId, warehouseId, binId, lotId, actorId], () => table.value?.reload({ resetPage: true }));
onMounted(() => { if (selectedId.value) openDetail(selectedId.value); });
onUnmounted(() => { listController?.abort(); detailController?.abort(); });
</script>

<template>
  <div>
    <PageHeader subtitle="依固定時間順序追溯不可變 Movement、來源、同組 legs 與沖銷關聯。">
      <template #actions><q-btn flat icon="inventory" label="庫存總覽" to="/inventory/stocks" /><q-btn flat icon="event" label="批次與效期" to="/inventory/lots" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md row q-col-gutter-sm items-start">
      <q-input class="col-6 col-sm-3 col-md-2" v-model="postedFrom" dense outlined type="date" label="異動日期從" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="postedTo" dense outlined type="date" label="異動日期到" />
      <q-input class="col-12 col-sm-6 col-md-2" v-model="movementType" dense outlined debounce="300" label="異動類型" />
      <q-input class="col-12 col-sm-6 col-md-2" v-model="sourceModule" dense outlined debounce="300" label="來源模組" />
      <q-input class="col-12 col-sm-6 col-md-2" v-model="sourceDocumentType" dense outlined debounce="300" label="來源單據類型" />
      <q-input class="col-12 col-sm-6 col-md-2" v-model="sourceDocumentId" dense outlined debounce="300" label="來源單據 ID" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="skuId" dense outlined inputmode="numeric" label="SKU ID" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="warehouseId" dense outlined inputmode="numeric" label="倉庫 ID" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="binId" dense outlined inputmode="numeric" label="庫位 ID" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="lotId" dense outlined inputmode="numeric" label="批次 ID" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="actorId" dense outlined inputmode="numeric" label="操作者 ID" />
    </div>
    <section class="q-px-md q-pb-md" aria-labelledby="movements-heading">
      <h2 id="movements-heading" class="text-h6 q-mt-none">Movement Ledger</h2>
      <DataTable ref="table" :fetch="fetchMovements" :columns="columns" :initial-pagination="initialPagination" row-key="movementId" sticky-actions>
        <template #body-cell-postedAt="{ value }"><q-td>{{ formatTime(value) }}</q-td></template>
        <template #body-cell-direction="{ row, value }"><q-td><q-icon :name="value === 'IN' ? 'south' : 'north'" class="q-mr-xs" /><span>{{ value === 'IN' ? '入' : '出' }} {{ row.quantity }}</span></q-td></template>
        <template #body-cell-sku="{ row, value }"><q-td><EllipsisCell :text="`${value} — ${row.sku.name}`" max-width="220px" /></q-td></template>
        <template #body-cell-lot="{ value }"><EllipsisCell :text="value" max-width="160px" /></template>
        <template #body-cell-source="{ row }"><q-td><EllipsisCell :text="sourceText(row.source)" max-width="260px" /></q-td></template>
        <template #body-cell-actions="{ row }"><q-td class="text-right"><q-btn flat round dense icon="open_in_new" :aria-label="`查看 Movement ${row.movementId}`" @click="openDetail(row)" /></q-td></template>
      </DataTable>
    </section>
    <section v-if="selectedId" class="q-px-md q-pb-md" aria-labelledby="movement-detail-heading" :aria-busy="detailLoading">
      <q-card flat bordered>
        <q-card-section>
          <div class="row items-center q-gutter-sm"><h2 id="movement-detail-heading" class="text-h6 q-ma-none">Movement {{ selectedId }} 詳情</h2><q-space /><q-btn flat round dense icon="close" aria-label="關閉 Movement 詳情" @click="closeDetail" /></div>
          <q-banner v-if="detailError" role="alert" class="bg-negative text-white q-mt-md">{{ detailError }}<template #action><q-btn flat label="重試" @click="openDetail(selectedId)" /></template></q-banner>
          <template v-if="detail">
            <dl class="movement-meta q-my-md">
              <div><dt>Group</dt><dd>{{ detail.movement.groupId }}</dd></div>
              <div><dt>來源</dt><dd>{{ sourceText(detail.movement.source) }}</dd></div>
              <div><dt>操作者</dt><dd>{{ detail.movement.postedBy.label }}</dd></div>
            </dl>
            <div class="row q-gutter-sm q-mb-md">
              <q-btn v-if="detail.reversal.reversalOfMovementId" outline icon="undo" :label="`原 Movement ${detail.reversal.reversalOfMovementId}`" @click="openDetail(detail.reversal.reversalOfMovementId)" />
              <q-btn v-if="detail.reversal.reversedByMovementId" outline icon="redo" :label="`沖銷 Movement ${detail.reversal.reversedByMovementId}`" @click="openDetail(detail.reversal.reversedByMovementId)" />
              <span v-if="!detail.reversal.reversalOfMovementId && !detail.reversal.reversedByMovementId" class="text-grey-8"><q-icon name="link_off" /> 沒有沖銷關聯</span>
            </div>
            <h3 class="text-subtitle1">同組 Movement legs</h3>
            <DataTable :rows="detail.groupLegs" :columns="detailColumns" row-key="movementId" />
          </template>
        </q-card-section>
      </q-card>
    </section>
  </div>
</template>

<style scoped>
.movement-meta { display: grid; gap: 8px; }
.movement-meta div { display: grid; grid-template-columns: 80px minmax(0, 1fr); }
.movement-meta dt { color: var(--q-grey-8); }
.movement-meta dd { margin: 0; overflow-wrap: anywhere; }
</style>
