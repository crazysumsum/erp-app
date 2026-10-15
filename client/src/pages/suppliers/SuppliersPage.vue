<script>
export const page = {
  name: "suppliers",
  path: "/suppliers",
  title: "供應商",
  requires: { permissions: ["supplier.view"] },
  menu: { group: "suppliers", icon: "local_shipping", order: 10 }
};
</script>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import SupplierStatusActions from "@/components/suppliers/SupplierStatusActions.vue";
import { can } from "@/framework/authorization/can.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import businessMasterService from "@/services/businessMaster.js";
import supplierService from "@/services/supplier.js";

const STATUS_LABEL = Object.freeze({
  draft: "草稿", pending_approval: "待審批", active: "啟用", suspended: "已暫停",
  blocked: "已封鎖", archived: "已封存"
});
const STATUS_COLOR = Object.freeze({
  draft: "grey", pending_approval: "warning", active: "positive", suspended: "grey-7",
  blocked: "negative", archived: "warning"
});
const statusOptions = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));
statusOptions.unshift({ value: null, label: "全部" });

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["supplier.mgmt"] }));
const canApprove = computed(() => can(session, { permissions: ["supplier.view", "supplier.approval"] }));
const initialQuery = route.query;
const searchText = ref(typeof initialQuery.q === "string" ? initialQuery.q : "");
const statusFilter = ref(typeof initialQuery.status === "string" ? initialQuery.status : null);
// 設計 7.3 嘅其餘篩選（HD-107 G4）；日期用 YYYY-MM-DD 存，送 API 先轉香港時間 epoch ms。
const filters = reactive({
  currencyCode: /^[A-Z]{3}$/u.test(initialQuery.currencyCode) ? initialQuery.currencyCode : null,
  paymentTermId: Number(initialQuery.paymentTermId) > 0 ? Number(initialQuery.paymentTermId) : null,
  missingPrimaryContact: initialQuery.missingPrimaryContact === "true",
  missingAddress: initialQuery.missingAddress === "true",
  missingBank: initialQuery.missingBank === "true",
  includeArchived: initialQuery.includeArchived === "true",
  createdFrom: dateQuery(initialQuery.createdFrom),
  createdTo: dateQuery(initialQuery.createdTo),
  updatedFrom: dateQuery(initialQuery.updatedFrom),
  updatedTo: dateQuery(initialQuery.updatedTo)
});
const DATE_RANGES = Object.freeze([["created", "建立日期"], ["updated", "更新日期"]]);
// 貨幣／付款條件嘅選項要 business_master.view；冇呢個權限就唔顯示呢兩個篩選。
const canPickMasters = computed(() => can(session, { permissions: ["business_master.view"] }));
const currencyOptions = ref([]);
const paymentTermOptions = ref([]);
const initialPagination = {
  page: Number(initialQuery.page) > 0 ? Number(initialQuery.page) : 1,
  rowsPerPage: appConfig.defaultPageSize,
  rowsNumber: 0,
  sortBy: ["supplierCode", "supplierName", "status", "updatedAt"].includes(initialQuery.sortBy) ? initialQuery.sortBy : "updatedAt",
  descending: initialQuery.descending !== "false"
};
const currentRequest = ref({ page: initialPagination.page, sortBy: initialPagination.sortBy, descending: initialPagination.descending });
const table = ref(null);
const exporting = ref(false);

const columns = [
  { name: "supplierCode", label: "Supplier Code", field: "supplierCode", align: "left", sortable: true },
  { name: "supplierName", label: "供應商名稱", field: "supplierName", align: "left", sortable: true },
  { name: "displayName", label: "顯示名稱", field: "displayName", align: "left" },
  { name: "defaultCurrencyCode", label: "貨幣", field: "defaultCurrencyCode", align: "left" },
  { name: "defaultPaymentTermId", label: "付款條件", field: "defaultPaymentTermId", align: "left" },
  { name: "primaryContactName", label: "主要聯絡人", field: "primaryContactName", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left", sortable: true },
  { name: "actions", label: "", field: "id", align: "right" }
];

function dateQuery(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : "";
}

function dayStart(value) { return value ? new Date(`${value}T00:00:00+08:00`).getTime() : undefined; }
function dayEnd(value) { return value ? new Date(`${value}T23:59:59.999+08:00`).getTime() : undefined; }

function rangeError(prefix) {
  const from = filters[`${prefix}From`];
  const to = filters[`${prefix}To`];
  return from && to && from > to ? "結束日期不可早於開始日期" : "";
}

function filterParams() {
  return {
    status: statusFilter.value,
    currencyCode: filters.currencyCode,
    paymentTermId: filters.paymentTermId,
    missingPrimaryContact: filters.missingPrimaryContact,
    missingAddress: filters.missingAddress,
    missingBank: filters.missingBank,
    includeArchived: filters.includeArchived,
    createdFrom: dayStart(filters.createdFrom),
    createdTo: dayEnd(filters.createdTo),
    updatedFrom: dayStart(filters.updatedFrom),
    updatedTo: dayEnd(filters.updatedTo)
  };
}

function syncUrl() {
  const filterQuery = Object.fromEntries(Object.entries(filters)
    .filter(([, value]) => value !== null && value !== "" && value !== false)
    .map(([name, value]) => [name, String(value)]));
  router.replace({ query: {
    page: currentRequest.value.page,
    sortBy: currentRequest.value.sortBy,
    descending: String(currentRequest.value.descending),
    q: searchText.value || undefined,
    status: statusFilter.value || undefined,
    ...filterQuery
  } });
}

function fetchSuppliers(request) {
  currentRequest.value = { page: request.page, sortBy: request.sortBy, descending: request.descending };
  syncUrl();
  return supplierService.list({ ...request, ...filterParams() });
}

watch([statusFilter, filters], () => table.value?.reload());

async function loadMasterOptions() {
  if (!canPickMasters.value) return;
  try {
    const [currencies, paymentTerms] = await Promise.all([
      businessMasterService.currencyList({ page: 1, rowsPerPage: 100, sortBy: "code" }),
      businessMasterService.paymentTermList({ page: 1, rowsPerPage: 100, sortBy: "code" })
    ]);
    currencyOptions.value = currencies.rows.map((item) => ({ label: `${item.code} — ${item.name}`, value: item.code }));
    paymentTermOptions.value = paymentTerms.rows.map((item) => ({ label: `${item.code} — ${item.name}`, value: item.id }));
  } catch (error) {
    notifyError(error.message || "載入貨幣／付款條件失敗");
  }
}

onMounted(loadMasterOptions);

function formatDate(value) {
  return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** 一般匯出（T47；HD-067）：用目前嘅搜尋、狀態同排序，密碼確認後下載 CSV。 */
async function exportSuppliers() {
  const password = await promptPassword({
    title: "匯出供應商",
    message: "按目前的搜尋、篩選及排序匯出供應商一般資料（匯入範本格式，不含銀行資料），最多 10,000 筆。",
    okLabel: "匯出"
  });
  if (password === null) return;
  exporting.value = true;
  try {
    const { blob, fileName } = await supplierService.exportCsv({
      filter: searchText.value, ...filterParams(),
      sortBy: currentRequest.value.sortBy, descending: currentRequest.value.descending, password
    });
    downloadBlob(blob, fileName ?? "suppliers.csv");
  } catch (error) {
    notifyError(error.message || "匯出失敗");
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
        <q-btn v-if="canManage" flat icon="download" label="匯出 CSV" :loading="exporting" @click="exportSuppliers" />
        <q-btn v-if="canManage" color="primary" unelevated icon="add" label="新增供應商" to="/suppliers/new" />
      </template>
    </PageHeader>

    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-input
        v-model="searchText"
        dense outlined debounce="300" placeholder="搜尋 Code、名稱、電話或電郵"
        style="width: 300px"
        @update:model-value="table?.reload()"
      ><template #prepend><q-icon name="search" /></template></q-input>
      <q-select v-model="statusFilter" dense outlined emit-value map-options :options="statusOptions" label="狀態" style="width: 160px" />
      <template v-if="canPickMasters">
        <q-select
          v-model="filters.currencyCode" dense outlined emit-value map-options clearable
          :options="currencyOptions" label="貨幣" style="width: 200px"
        />
        <q-select
          v-model="filters.paymentTermId" dense outlined emit-value map-options clearable
          :options="paymentTermOptions" label="付款條件" style="width: 220px"
        />
      </template>
    </div>
    <div class="q-px-md q-pb-md row q-gutter-sm items-start">
      <q-checkbox v-model="filters.missingPrimaryContact" dense label="缺主要訂單聯絡人" />
      <q-checkbox v-model="filters.missingAddress" dense label="缺採購地址" />
      <q-checkbox v-model="filters.missingBank" dense label="缺有效銀行資料" />
      <q-checkbox v-model="filters.includeArchived" dense label="包括已封存" />
      <template v-for="[prefix, label] in DATE_RANGES" :key="prefix">
        <q-input
          v-model="filters[`${prefix}From`]" dense outlined stack-label type="date" :label="`${label}由`" style="width: 170px"
        />
        <q-input
          v-model="filters[`${prefix}To`]" dense outlined stack-label type="date" :label="`${label}至`" style="width: 170px"
          :error="!!rangeError(prefix)" :error-message="rangeError(prefix)"
        />
      </template>
    </div>

    <div class="q-px-md q-pb-md">
      <DataTable
        ref="table" :fetch="fetchSuppliers" :columns="columns" :filter="searchText"
        :initial-pagination="initialPagination" sticky-actions
      >
        <template #body-cell-supplierName="{ value }"><EllipsisCell :text="value" max-width="240px" /></template>
        <template #body-cell-displayName="{ value }"><EllipsisCell :text="value || '—'" max-width="180px" /></template>
        <template #body-cell-defaultPaymentTermId="{ value }"><q-td class="text-left">{{ value ?? "未設定" }}</q-td></template>
        <template #body-cell-primaryContactName="{ value }"><EllipsisCell :text="value || '未設定'" max-width="160px" /></template>
        <template #body-cell-status="{ value }">
          <q-td class="text-left"><q-badge :color="STATUS_COLOR[value]" :label="STATUS_LABEL[value] ?? value" /></q-td>
        </template>
        <template #body-cell-updatedAt="{ value }"><q-td class="text-left">{{ formatDate(value) }}</q-td></template>
        <template #body-cell-actions="{ row }">
          <q-td class="text-right">
            <q-btn flat dense icon="visibility" :aria-label="`查看 ${row.supplierCode} 詳情`" :to="`/suppliers/${row.id}`" />
            <SupplierStatusActions
              compact :supplier="row" :can-manage="canManage" :can-approve="canApprove"
              :username="session.user?.username ?? ''"
              @updated="table?.reload()" @deleted="table?.reload()" @conflict="table?.reload()"
            />
          </q-td>
        </template>
      </DataTable>
    </div>
  </div>
</template>
