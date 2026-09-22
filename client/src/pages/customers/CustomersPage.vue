<script>
export const page = {
  name: "customers",
  path: "/customers",
  title: "客戶",
  requires: { permissions: ["customer.view"] },
  menu: { group: "customers", icon: "groups", order: 20 }
};
</script>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import customerService from "@/services/customer.js";

const STATUS_LABEL = Object.freeze({ draft: "草稿", pending_approval: "待審批", active: "啟用", suspended: "已暫停", blocked: "已封鎖", archived: "已封存" });
const STATUS_COLOR = Object.freeze({ draft: "grey", pending_approval: "warning", active: "positive", suspended: "grey-7", blocked: "negative", archived: "warning" });
const statusOptions = [{ value: null, label: "全部" }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))];
const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["customer.mgmt"] }));
const initialQuery = route.query;
const searchText = ref(typeof initialQuery.q === "string" ? initialQuery.q : "");
const statusFilter = ref(typeof initialQuery.status === "string" ? initialQuery.status : null);
const initialPagination = { page: Number(initialQuery.page) > 0 ? Number(initialQuery.page) : 1, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0, sortBy: ["code", "legalName", "accountManager", "status", "updatedAt"].includes(initialQuery.sortBy) ? initialQuery.sortBy : "updatedAt", descending: initialQuery.descending !== "false" };
const currentRequest = ref({ page: initialPagination.page, sortBy: initialPagination.sortBy, descending: initialPagination.descending });
const table = ref(null);
const columns = [
  { name: "code", label: "客戶代碼", field: "code", align: "left", sortable: true },
  { name: "legalName", label: "法定名稱", field: "legalName", align: "left", sortable: true },
  { name: "displayName", label: "顯示名稱", field: "displayName", align: "left" },
  { name: "defaultCurrencyCode", label: "貨幣", field: "defaultCurrencyCode", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left", sortable: true },
  { name: "actions", label: "", field: "id", align: "right" }
];

function syncUrl() { router.replace({ query: { page: currentRequest.value.page, sortBy: currentRequest.value.sortBy, descending: String(currentRequest.value.descending), q: searchText.value || undefined, status: statusFilter.value || undefined } }); }
function fetchCustomers(request) { currentRequest.value = { page: request.page, sortBy: request.sortBy, descending: request.descending }; syncUrl(); return customerService.list({ ...request, status: statusFilter.value }); }
function formatDate(value) { return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }); }
watch(statusFilter, () => table.value?.reload());
</script>

<template>
  <div>
    <PageHeader>
      <template #actions><q-btn v-if="canManage" color="primary" unelevated icon="add" label="新增客戶" to="/customers/new" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-input v-model="searchText" dense outlined debounce="300" placeholder="搜尋代碼、名稱、電話、電郵或識別資料" style="width: 300px" @update:model-value="table?.reload()"><template #prepend><q-icon name="search" /></template></q-input>
      <q-select v-model="statusFilter" dense outlined emit-value map-options :options="statusOptions" label="狀態" style="width: 160px" />
    </div>
    <div class="q-px-md q-pb-md">
      <DataTable ref="table" :fetch="fetchCustomers" :columns="columns" :filter="searchText" :initial-pagination="initialPagination" sticky-actions>
        <template #body-cell-legalName="{ value }"><EllipsisCell :text="value" max-width="240px" /></template>
        <template #body-cell-displayName="{ value }"><EllipsisCell :text="value || '—'" max-width="180px" /></template>
        <template #body-cell-status="{ value }"><q-td class="text-left"><q-badge :color="STATUS_COLOR[value]" :label="STATUS_LABEL[value] ?? value" /></q-td></template>
        <template #body-cell-updatedAt="{ value }"><q-td class="text-left">{{ formatDate(value) }}</q-td></template>
        <template #body-cell-actions="{ row }"><q-td class="text-right"><q-btn flat dense icon="visibility" :aria-label="`查看 ${row.code} 詳情`" :to="`/customers/${row.id}`" /></q-td></template>
      </DataTable>
    </div>
  </div>
</template>
