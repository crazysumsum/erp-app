<script>
export const page = {
  name: "inventory-lots",
  path: "/inventory/lots",
  title: "批次與效期",
  requires: { permissions: ["inventory.view"] },
  menu: { group: "inventory", icon: "event", order: 30 }
};
</script>

<script setup>
import { onUnmounted, ref, watch } from "vue";
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
const text = (value) => typeof value === "string" ? value : "";
const oneOf = (value, values, fallback) => values.includes(value) ? value : fallback;
const skuId = ref(text(initial.skuId));
const warehouseId = ref(text(initial.warehouseId));
const lot = ref(text(initial.lot));
const status = ref(oneOf(initial.status, ["AVAILABLE", "QUARANTINED", "DAMAGED"], null));
const expiryState = ref(oneOf(initial.expiryState, ["UNEXPIRED", "EXPIRED", "WITHIN_DAYS"], "ALL"));
const expiryFrom = ref(text(initial.expiryFrom));
const expiryTo = ref(text(initial.expiryTo));
const withinDays = ref(text(initial.withinDays) || "30");
const table = ref(null);
const currentRequest = ref({
  page: positive(initial.page) ?? 1,
  sortBy: oneOf(initial.sortBy, ["skuCode", "lot", "expiryDate", "firstReceiptDate"], "lot"),
  descending: initial.descending === "true"
});
const initialPagination = { ...currentRequest.value, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0 };
let controller;

const statusOptions = [
  { label: "全部狀態", value: null }, { label: "可用", value: "AVAILABLE" },
  { label: "隔離", value: "QUARANTINED" }, { label: "損壞", value: "DAMAGED" }
];
const expiryOptions = [
  { label: "全部效期", value: "ALL" }, { label: "未過期", value: "UNEXPIRED" },
  { label: "已過期", value: "EXPIRED" }, { label: "指定日數內到期", value: "WITHIN_DAYS" }
];
const columns = [
  { name: "skuCode", label: "SKU", field: (row) => row.sku.code, align: "left", sortable: true },
  { name: "skuName", label: "名稱", field: (row) => row.sku.name, align: "left" },
  { name: "lot", label: "批次", field: "lotNumber", align: "left", sortable: true },
  { name: "expiryDate", label: "效期狀態", field: "expiryDate", align: "left", sortable: true },
  { name: "firstReceiptDate", label: "首次收貨", field: "firstReceiptDate", align: "left", sortable: true },
  { name: "totalOnHand", label: "總 On Hand", field: "totalOnHand", align: "right" },
  { name: "availableOnHand", label: "Available On Hand", field: "availableOnHand", align: "right" },
  { name: "quarantined", label: "Quarantined", field: "quarantined", align: "right" },
  { name: "damaged", label: "Damaged", field: "damaged", align: "right" }
];
function filters() {
  return {
    skuId: positive(skuId.value) ?? undefined, warehouseId: positive(warehouseId.value) ?? undefined,
    lot: lot.value || undefined, status: status.value || undefined, expiryState: expiryState.value,
    expiryFrom: expiryFrom.value || undefined, expiryTo: expiryTo.value || undefined,
    withinDays: expiryState.value === "WITHIN_DAYS" ? nonNegative(withinDays.value) ?? 30 : undefined
  };
}
function syncUrl() {
  router.replace({ query: {
    ...filters(), page: currentRequest.value.page, sortBy: currentRequest.value.sortBy,
    descending: String(currentRequest.value.descending)
  } });
}
function fetchLots(request) {
  controller?.abort();
  controller = new AbortController();
  currentRequest.value = { page: request.page, sortBy: request.sortBy, descending: request.descending };
  syncUrl();
  return inventoryService.listLots({ ...request, ...filters(), signal: controller.signal });
}
function expiryPresentation(row) {
  if (!row.expiryDate) return { icon: "remove_circle_outline", text: "無效期", color: "grey-7" };
  if (row.isExpired) return { icon: "error", text: `已過期（${row.remainingLifeDays} 日）`, color: "negative" };
  if (row.remainingLifeDays !== null && row.remainingLifeDays <= Number(withinDays.value || 30)) {
    return { icon: "schedule", text: `${row.remainingLifeDays} 日後到期`, color: "warning" };
  }
  return { icon: "check_circle", text: `${row.remainingLifeDays} 日後到期`, color: "positive" };
}
watch([skuId, warehouseId, lot, status, expiryState, expiryFrom, expiryTo, withinDays], () => table.value?.reload({ resetPage: true }));
onUnmounted(() => controller?.abort());
</script>

<template>
  <div>
    <PageHeader subtitle="查看批次存量、已過期與低效期狀態。">
      <template #actions><q-btn flat icon="inventory" label="庫存總覽" to="/inventory/stocks" /><q-btn flat icon="history" label="庫存異動" to="/inventory/movements" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md row q-col-gutter-sm items-start">
      <q-input class="col-6 col-sm-3 col-md-2" v-model="skuId" dense outlined inputmode="numeric" label="SKU ID" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="warehouseId" dense outlined inputmode="numeric" label="倉庫 ID" />
      <q-input class="col-12 col-sm-6 col-md-2" v-model="lot" dense outlined debounce="300" label="批次" />
      <q-select class="col-12 col-sm-6 col-md-2" v-model="status" dense outlined emit-value map-options :options="statusOptions" label="庫存狀態" />
      <q-select class="col-12 col-sm-6 col-md-2" v-model="expiryState" dense outlined emit-value map-options :options="expiryOptions" label="效期" />
      <q-input v-if="expiryState === 'WITHIN_DAYS'" class="col-12 col-sm-6 col-md-2" v-model="withinDays" dense outlined inputmode="numeric" label="到期日數" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="expiryFrom" dense outlined type="date" label="效期從" />
      <q-input class="col-6 col-sm-3 col-md-2" v-model="expiryTo" dense outlined type="date" label="效期到" />
    </div>
    <section class="q-px-md q-pb-md" aria-labelledby="lots-heading">
      <h2 id="lots-heading" class="text-h6 q-mt-none">批次清單</h2>
      <DataTable ref="table" :fetch="fetchLots" :columns="columns" :initial-pagination="initialPagination" row-key="lotId">
        <template #body-cell-skuName="{ value }"><EllipsisCell :text="value" max-width="220px" /></template>
        <template #body-cell-lot="{ value }"><EllipsisCell :text="value" max-width="180px" /></template>
        <template #body-cell-expiryDate="{ row, value }"><q-td><q-icon :name="expiryPresentation(row).icon" :color="expiryPresentation(row).color" class="q-mr-xs" /><span>{{ value || '—' }} · {{ expiryPresentation(row).text }}</span></q-td></template>
      </DataTable>
    </section>
  </div>
</template>
