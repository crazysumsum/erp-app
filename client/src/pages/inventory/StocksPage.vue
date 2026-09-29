<script>
export const page = {
  name: "inventory-stocks",
  path: "/inventory/stocks",
  title: "庫存總覽",
  requires: { permissions: ["inventory.view"] },
  menu: { group: "inventory", icon: "inventory", order: 20 }
};
</script>

<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
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
const nonNegative = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const oneOf = (value, values, fallback) => values.includes(value) ? value : fallback;
const text = (value) => typeof value === "string" ? value : "";

const search = ref(text(initial.q));
const warehouseId = ref(text(initial.warehouseId));
const binId = ref(text(initial.binId));
const lot = ref(text(initial.lot));
const status = ref(oneOf(initial.status, ["AVAILABLE", "QUARANTINED", "DAMAGED"], null));
const availability = ref(oneOf(initial.availability, ["IN_STOCK", "NO_STOCK", "ZERO_ATP"], "ALL"));
const expiryState = ref(oneOf(initial.expiryState, ["UNEXPIRED", "EXPIRED", "WITHIN_DAYS"], "ALL"));
const withinDays = ref(text(initial.withinDays) || "30");
const selectedSkuId = ref(positive(initial.skuId));
const selectedSku = ref(selectedSkuId.value ? { sku: { skuId: selectedSkuId.value, code: `SKU #${selectedSkuId.value}`, name: "" } } : null);
const summaryError = ref("");
const aggregateTable = ref(null);
const bucketTable = ref(null);
const aggregateRequest = ref({
  page: positive(initial.page) ?? 1,
  sortBy: oneOf(initial.sortBy, ["skuCode", "skuName", "totalOnHand", "availableOnHand"], "skuCode"),
  descending: initial.descending === "true"
});
const bucketRequest = ref({
  page: positive(initial.bucketPage) ?? 1,
  sortBy: oneOf(initial.bucketSort, ["warehouse", "bin", "lot", "expiryDate", "stockStatus", "onHand", "available"], "warehouse"),
  descending: initial.bucketDescending === "true"
});
const aggregatePagination = { ...aggregateRequest.value, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0 };
const bucketPagination = { ...bucketRequest.value, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0 };
let aggregateController;
let bucketController;
let summaryController;

const statusOptions = [
  { label: "全部狀態", value: null }, { label: "可用", value: "AVAILABLE" },
  { label: "隔離", value: "QUARANTINED" }, { label: "損壞", value: "DAMAGED" }
];
const availabilityOptions = [
  { label: "全部存量", value: "ALL" }, { label: "有庫存", value: "IN_STOCK" },
  { label: "無庫存", value: "NO_STOCK" }, { label: "ATP 為零", value: "ZERO_ATP" }
];
const expiryOptions = [
  { label: "全部效期", value: "ALL" }, { label: "未過期", value: "UNEXPIRED" },
  { label: "已過期", value: "EXPIRED" }, { label: "指定日數內到期", value: "WITHIN_DAYS" }
];
const aggregateColumns = [
  { name: "skuCode", label: "SKU", field: (row) => row.sku.code, align: "left", sortable: true },
  { name: "skuName", label: "名稱", field: (row) => row.sku.name, align: "left", sortable: true },
  { name: "totalOnHand", label: "總 On Hand", field: "totalOnHand", align: "right", sortable: true },
  { name: "availableOnHand", label: "Available On Hand", field: "availableOnHand", align: "right", sortable: true },
  { name: "reserved", label: "Reserved", field: "reserved", align: "right" },
  { name: "atp", label: "ATP", field: "atp", align: "right" },
  { name: "quarantined", label: "Quarantined", field: "quarantined", align: "right" },
  { name: "damaged", label: "Damaged", field: "damaged", align: "right" },
  { name: "inTransit", label: "In Transit", field: "inTransit", align: "right" },
  { name: "actions", label: "操作", field: (row) => row.sku.skuId, align: "right" }
];
const bucketColumns = [
  { name: "warehouse", label: "倉庫", field: (row) => row.warehouse.code, align: "left", sortable: true },
  { name: "bin", label: "庫位", field: (row) => row.bin.code, align: "left", sortable: true },
  { name: "lot", label: "批次", field: (row) => row.lot?.number ?? "無批次", align: "left", sortable: true },
  { name: "expiryDate", label: "效期", field: (row) => row.lot?.expiryDate ?? "—", align: "left", sortable: true },
  { name: "stockStatus", label: "狀態", field: "stockStatus", align: "left", sortable: true },
  { name: "onHand", label: "On Hand", field: "onHand", align: "right", sortable: true },
  { name: "allocated", label: "Allocated", field: "allocated", align: "right" },
  { name: "available", label: "Bucket Free", field: "bucketFree", align: "right", sortable: true }
];
const statusLabel = { AVAILABLE: "可用", QUARANTINED: "隔離", DAMAGED: "損壞" };
const statusIcon = { AVAILABLE: "check_circle", QUARANTINED: "warning", DAMAGED: "dangerous" };

function commonFilters() {
  return {
    warehouseId: positive(warehouseId.value) ?? undefined,
    binId: positive(binId.value) ?? undefined,
    lot: lot.value || undefined,
    status: status.value || undefined,
    availability: availability.value,
    expiryState: expiryState.value,
    withinDays: expiryState.value === "WITHIN_DAYS" ? nonNegative(withinDays.value) ?? 30 : undefined
  };
}
function syncUrl() {
  router.replace({ query: {
    q: search.value || undefined, ...commonFilters(),
    page: aggregateRequest.value.page, sortBy: aggregateRequest.value.sortBy,
    descending: String(aggregateRequest.value.descending), skuId: selectedSkuId.value ?? undefined,
    bucketPage: selectedSkuId.value ? bucketRequest.value.page : undefined,
    bucketSort: selectedSkuId.value ? bucketRequest.value.sortBy : undefined,
    bucketDescending: selectedSkuId.value ? String(bucketRequest.value.descending) : undefined
  } });
}
function fetchAggregates(request) {
  aggregateController?.abort();
  aggregateController = new AbortController();
  aggregateRequest.value = { page: request.page, sortBy: request.sortBy, descending: request.descending };
  syncUrl();
  return inventoryService.listStockAggregates({ ...request, ...commonFilters(), signal: aggregateController.signal });
}
function fetchBuckets(request) {
  bucketController?.abort();
  bucketController = new AbortController();
  bucketRequest.value = { page: request.page, sortBy: request.sortBy, descending: request.descending };
  syncUrl();
  return inventoryService.listStocks({
    ...request, ...commonFilters(), filter: search.value, skuId: selectedSkuId.value, signal: bucketController.signal
  }).then((result) => {
    if (result.rows[0] && selectedSku.value?.sku.code.startsWith("SKU #")) {
      selectedSku.value = { ...selectedSku.value, sku: result.rows[0].sku, baseUom: result.rows[0].baseUom };
    }
    return result;
  });
}
async function loadSummary() {
  if (!selectedSkuId.value) return;
  summaryController?.abort();
  summaryController = new AbortController();
  summaryError.value = "";
  try {
    const result = await inventoryService.listStockAggregates({
      page: 1, rowsPerPage: 1, filter: search.value, skuId: selectedSkuId.value,
      ...commonFilters(), signal: summaryController.signal
    });
    if (result.rows[0]) selectedSku.value = result.rows[0];
  } catch (error) {
    if (error.name !== "AbortError") summaryError.value = error.message || "無法載入 SKU 摘要";
  }
}
async function selectSku(row) {
  selectedSku.value = row;
  selectedSkuId.value = row.sku.skuId;
  bucketRequest.value.page = 1;
  syncUrl();
  await nextTick();
}
function closeSku() {
  bucketController?.abort();
  summaryController?.abort();
  selectedSkuId.value = null;
  selectedSku.value = null;
  syncUrl();
}
watch([warehouseId, binId, lot, status, availability, expiryState, withinDays], () => {
  aggregateTable.value?.reload({ resetPage: true });
  bucketTable.value?.reload({ resetPage: true });
  if (selectedSkuId.value) loadSummary();
});
onMounted(() => { if (selectedSkuId.value) loadSummary(); });
onUnmounted(() => { aggregateController?.abort(); bucketController?.abort(); summaryController?.abort(); });
</script>

<template>
  <div>
    <PageHeader subtitle="先查看 SKU 聚合數量，再深入倉庫、庫位、批次與狀態 bucket。">
      <template #actions>
        <q-btn flat icon="event" label="批次與效期" to="/inventory/lots" />
        <q-btn flat icon="history" label="庫存異動" to="/inventory/movements" />
      </template>
    </PageHeader>
    <div class="q-px-md q-pb-md row q-col-gutter-sm items-start">
      <q-input class="col-12 col-sm-6 col-md-3" v-model="search" dense outlined debounce="300" clearable label="搜尋 SKU Code、名稱或條碼"><template #prepend><q-icon name="search" /></template></q-input>
      <q-input class="col-6 col-sm-3 col-md-2" v-model="warehouseId" dense outlined inputmode="numeric" label="倉庫 ID" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="binId" dense outlined inputmode="numeric" label="庫位 ID" />
      <q-input class="col-12 col-sm-6 col-md-2" v-model="lot" dense outlined debounce="300" label="批次" />
      <q-select class="col-12 col-sm-6 col-md-3" v-model="status" dense outlined emit-value map-options :options="statusOptions" label="庫存狀態" />
      <q-select class="col-12 col-sm-6 col-md-3" v-model="availability" dense outlined emit-value map-options :options="availabilityOptions" label="存量" />
      <q-select class="col-12 col-sm-6 col-md-3" v-model="expiryState" dense outlined emit-value map-options :options="expiryOptions" label="效期" />
      <q-input v-if="expiryState === 'WITHIN_DAYS'" class="col-12 col-sm-6 col-md-2" v-model="withinDays" dense outlined inputmode="numeric" label="到期日數" />
    </div>
    <section class="q-px-md q-pb-md" aria-labelledby="aggregate-heading">
      <h2 id="aggregate-heading" class="text-h6 q-mt-none">SKU 庫存摘要</h2>
      <DataTable ref="aggregateTable" :fetch="fetchAggregates" :columns="aggregateColumns" :filter="search" :initial-pagination="aggregatePagination" row-key="sku.skuId" sticky-actions>
        <template #body-cell-skuName="{ value }"><EllipsisCell :text="value" max-width="220px" /></template>
        <template #body-cell-atp="{ row, value }"><q-td><q-icon v-if="row.uncoveredReserved" name="error" color="negative" class="q-mr-xs" /><span>{{ value }}</span><span v-if="row.uncoveredReserved" class="text-negative">（未覆蓋 {{ row.uncoveredReserved }}）</span></q-td></template>
        <template #body-cell-actions="{ row }"><q-td class="text-right"><q-btn flat round dense icon="chevron_right" :aria-label="`查看 ${row.sku.code} 庫存明細`" @click="selectSku(row)" /></q-td></template>
      </DataTable>
    </section>
    <section v-if="selectedSku" class="q-px-md q-pb-md" aria-labelledby="bucket-heading">
      <q-separator class="q-mb-md" />
      <div class="row items-center q-gutter-sm q-mb-md">
        <q-btn flat icon="arrow_back" label="關閉明細" @click="closeSku" />
        <h2 id="bucket-heading" class="text-h6 q-ma-none">{{ selectedSku.sku.code }} {{ selectedSku.sku.name }} 的庫存 bucket</h2>
      </div>
      <q-banner v-if="summaryError" role="alert" class="bg-negative text-white q-mb-md">{{ summaryError }} <template #action><q-btn flat label="重試摘要" @click="loadSummary" /></template></q-banner>
      <div class="row q-col-gutter-sm q-mb-md" aria-label="SKU 數量摘要">
        <q-card v-for="item in [
          ['總 On Hand', selectedSku.totalOnHand], ['Available On Hand', selectedSku.availableOnHand],
          ['Reserved', selectedSku.reserved], ['ATP', selectedSku.atp], ['Quarantined', selectedSku.quarantined],
          ['Damaged', selectedSku.damaged], ['In Transit', selectedSku.inTransit]
        ]" :key="item[0]" flat bordered class="col-6 col-sm-3 col-lg"><q-card-section class="q-pa-sm"><div class="text-caption text-grey-8">{{ item[0] }}</div><div class="text-h6">{{ item[1] ?? '—' }}</div></q-card-section></q-card>
      </div>
      <DataTable ref="bucketTable" :fetch="fetchBuckets" :columns="bucketColumns" :initial-pagination="bucketPagination" row-key="balanceId">
        <template #body-cell-warehouse="{ row, value }"><q-td><EllipsisCell :text="`${value} — ${row.warehouse.name}`" max-width="180px" /></q-td></template>
        <template #body-cell-bin="{ row, value }"><q-td><EllipsisCell :text="row.bin.name ? `${value} — ${row.bin.name}` : value" max-width="180px" /></q-td></template>
        <template #body-cell-lot="{ value }"><EllipsisCell :text="value" max-width="180px" /></template>
        <template #body-cell-expiryDate="{ row, value }"><q-td><q-icon v-if="row.isExpired" name="error" color="negative" class="q-mr-xs" /><span>{{ row.isExpired ? `已過期 ${value}` : value }}</span></q-td></template>
        <template #body-cell-stockStatus="{ value }"><q-td><q-icon :name="statusIcon[value]" class="q-mr-xs" /><span>{{ statusLabel[value] }}</span></q-td></template>
      </DataTable>
    </section>
  </div>
</template>
