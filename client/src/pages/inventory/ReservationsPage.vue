<script>
export const page = {
  name: "inventory-reservations",
  path: "/inventory/reservations",
  title: "預留與分配",
  requires: { permissions: ["inventory.view"] },
  menu: { group: "inventory", icon: "assignment", order: 40 }
};
</script>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import { can } from "@/framework/authorization/can.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import AllocationPanel from "@/components/inventory/AllocationPanel.vue";
import inventoryService from "@/services/inventory.js";
import { useSessionStore } from "@/stores/session.js";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const canOperate = computed(() => can(session, { permissions: ["inventory.operation"] }));
const canFefoOverride = computed(() => can(session, { permissions: ["inventory.fefo.override"] }));
const positive = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const search = ref(typeof route.query.q === "string" ? route.query.q : "");
const status = ref(typeof route.query.status === "string" ? route.query.status : "ALL");
const uncovered = ref(route.query.uncovered === "true");
const table = ref(null);
const selected = ref(null);
const detailLoading = ref(false);
const detailError = ref("");
const showAllocation = ref(false);
const pagination = { page: positive(route.query.page) ?? 1, rowsPerPage: appConfig.defaultPageSize,
  rowsNumber: 0, sortBy: "updatedAt", descending: true };
const currentPage = ref(pagination.page);
const statuses = [
  { label: "全部狀態", value: "ALL" }, { label: "有效", value: "ACTIVE" },
  { label: "部分耗用", value: "PARTIALLY_CONSUMED" }, { label: "已耗用", value: "CONSUMED" },
  { label: "已釋放", value: "RELEASED" }, { label: "已取消", value: "CANCELLED" }
];
const columns = [
  { name: "skuCode", label: "SKU", field: (row) => row.sku.code, align: "left", sortable: true },
  { name: "warehouse", label: "倉庫", field: (row) => row.warehouse.code, align: "left" },
  { name: "source", label: "來源單據", field: (row) => row.source.documentId, align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "original", label: "原始", field: "originalQuantity", align: "right" },
  { name: "outstanding", label: "未完成", field: "outstandingQuantity", align: "right" },
  { name: "uncovered", label: "未覆蓋", field: (row) => row.availability.uncoveredReserved, align: "right" },
  { name: "actions", label: "操作", field: "id", align: "right" }
];
const sourceText = (source) => `${source.module} / ${source.documentType} / ${source.documentId}` +
  ` / 行 ${source.lineId || '—'} / 事件 ${source.eventId}`;

function syncUrl(pageNumber = 1) {
  router.replace({ query: { q: search.value || undefined, status: status.value === "ALL" ? undefined : status.value,
    uncovered: uncovered.value ? "true" : undefined, page: pageNumber,
    id: selected.value?.id ?? undefined } });
}
function fetchReservations(request) {
  currentPage.value = request.page;
  syncUrl(request.page);
  return inventoryService.listReservations({ ...request, filter: search.value,
    status: status.value, uncovered: uncovered.value || undefined });
}
async function loadDetail(id) {
  detailLoading.value = true;
  detailError.value = "";
  try {
    selected.value = await inventoryService.getReservation(id);
    syncUrl(currentPage.value);
  } catch (error) {
    detailError.value = error.message || "無法載入預留詳情";
  } finally {
    detailLoading.value = false;
  }
}
function closeDetail() {
  showAllocation.value = false;
  selected.value = null;
  syncUrl(currentPage.value);
}
async function refreshAfterAllocation() {
  await loadDetail(selected.value.id);
  await table.value?.reload();
}
async function copySource() {
  try {
    await navigator.clipboard.writeText(sourceText(selected.value.source));
    notifySuccess("來源識別已複製");
  } catch {
    notifyError("無法複製來源識別，請手動選取文字");
  }
}
watch([status, uncovered], () => table.value?.reload());
onMounted(() => { if (positive(route.query.id)) loadDetail(positive(route.query.id)); });
</script>

<template>
  <div>
    <PageHeader subtitle="查看來源預留、數量變化及實際分配。" />
    <div class="q-px-md q-pb-md row q-col-gutter-sm items-center">
      <q-input class="col-12 col-sm-5 col-md-3" v-model="search" dense outlined debounce="300" clearable label="搜尋 SKU 或來源單號" />
      <q-select class="col-12 col-sm-4 col-md-2" v-model="status" dense outlined emit-value map-options :options="statuses" label="狀態" />
      <q-toggle class="col-12 col-sm-3" v-model="uncovered" label="只看未覆蓋" />
    </div>
    <section class="q-px-md q-pb-md" aria-labelledby="reservations-heading">
      <h2 id="reservations-heading" class="text-h6 q-mt-none">Reservation 清單</h2>
      <DataTable ref="table" :fetch="fetchReservations" :columns="columns" :filter="search"
        :initial-pagination="pagination" row-key="id" sticky-actions>
        <template #body-cell-status="{ value }"><q-td><q-badge :color="value === 'ACTIVE' ? 'positive' : 'grey-7'" :label="statuses.find((item) => item.value === value)?.label || value" /></q-td></template>
        <template #body-cell-uncovered="{ value }"><q-td class="text-right"><q-icon v-if="value" name="error" color="negative" class="q-mr-xs" /><span>{{ value ? `未覆蓋 ${value}` : '0' }}</span></q-td></template>
        <template #body-cell-actions="{ row }"><q-td class="text-right"><q-btn flat round dense icon="chevron_right" :aria-label="`查看預留 ${row.id} 詳情`" @click="loadDetail(row.id)" /></q-td></template>
      </DataTable>
    </section>

    <section v-if="selected || detailLoading || detailError" class="q-px-md q-pb-lg" aria-labelledby="reservation-detail-heading" :aria-busy="detailLoading">
      <q-separator class="q-mb-md" />
      <q-btn flat icon="arrow_back" label="關閉詳情" class="q-mb-sm" @click="closeDetail" />
      <q-banner v-if="detailError" role="alert" class="bg-negative text-white q-mb-md">{{ detailError }}
        <template #action><q-btn flat label="重試" @click="loadDetail(selected?.id || route.query.id)" /></template>
      </q-banner>
      <div v-if="detailLoading" role="status">正在載入預留詳情…</div>
      <template v-if="selected">
        <div class="row items-center q-gutter-sm q-mb-md">
          <h2 id="reservation-detail-heading" class="text-h6 q-ma-none">預留 {{ selected.id }} 詳情</h2>
          <q-space />
          <q-btn v-if="canOperate && selected.outstandingQuantity > 0" color="primary" unelevated icon="inventory_2" label="分配庫存" @click="showAllocation = true" />
        </div>
        <div class="text-body2 q-mb-sm">{{ selected.sku.code }} — {{ selected.sku.name }} · {{ selected.warehouse.code }} · {{ statuses.find((item) => item.value === selected.status)?.label || selected.status }}</div>
        <div class="row q-col-gutter-sm q-mb-md" aria-label="預留數量明細">
          <q-card v-for="item in [['原始', selected.originalQuantity], ['已耗用', selected.consumedQuantity], ['已釋放', selected.releasedQuantity], ['未完成', selected.outstandingQuantity]]"
            :key="item[0]" flat bordered class="col-6 col-sm-3"><q-card-section class="q-pa-sm"><span class="text-caption text-grey-8">{{ item[0] }}</span><div class="text-h6">{{ item[0] }} {{ item[1] }}</div></q-card-section></q-card>
        </div>
        <q-banner v-if="selected.availability.uncoveredReserved > 0" role="status" class="bg-warning text-dark q-mb-md">
          未覆蓋 {{ selected.availability.uncoveredReserved }}；請檢查可用庫存與到期批次，再決定補貨或調整來源單據。
        </q-banner>
        <div class="row items-center q-gutter-sm q-mb-md"><span>來源：{{ sourceText(selected.source) }}</span>
          <q-btn flat dense icon="content_copy" label="複製來源識別" @click="copySource" /></div>
        <h3 class="text-subtitle1 q-mb-sm">現有分配</h3>
        <div v-if="!selected.allocations.length" role="status" class="text-grey-7">尚無分配</div>
        <q-list v-else bordered separator><q-item v-for="allocation in selected.allocations" :key="allocation.id">
          <q-item-section>分配 #{{ allocation.id }} · 庫位 #{{ allocation.binId }} · 批次 #{{ allocation.lotId ?? '無批次' }} · {{ allocation.expiryDate || '無效期' }}</q-item-section>
          <q-item-section side>未完成 {{ allocation.outstandingQuantity }} · {{ allocation.status }}</q-item-section>
        </q-item></q-list>
      </template>
    </section>
    <AllocationPanel v-if="selected" v-model="showAllocation" :reservation="selected" :can-fefo-override="canFefoOverride" @updated="refreshAfterAllocation" />
  </div>
</template>
