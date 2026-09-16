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
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import SupplierStatusActions from "@/components/suppliers/SupplierStatusActions.vue";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
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
const initialPagination = {
  page: Number(initialQuery.page) > 0 ? Number(initialQuery.page) : 1,
  rowsPerPage: appConfig.defaultPageSize,
  rowsNumber: 0,
  sortBy: ["supplierCode", "supplierName", "status", "updatedAt"].includes(initialQuery.sortBy) ? initialQuery.sortBy : "updatedAt",
  descending: initialQuery.descending !== "false"
};
const currentRequest = ref({ page: initialPagination.page, sortBy: initialPagination.sortBy, descending: initialPagination.descending });
const table = ref(null);

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

function syncUrl() {
  router.replace({ query: {
    page: currentRequest.value.page,
    sortBy: currentRequest.value.sortBy,
    descending: String(currentRequest.value.descending),
    q: searchText.value || undefined,
    status: statusFilter.value || undefined
  } });
}

function fetchSuppliers(request) {
  currentRequest.value = { page: request.page, sortBy: request.sortBy, descending: request.descending };
  syncUrl();
  return supplierService.list({ ...request, status: statusFilter.value });
}

watch(statusFilter, () => table.value?.reload());

function formatDate(value) {
  return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" });
}
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
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
