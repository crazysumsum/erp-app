<script>
export const page = { name: "ar-credit-notes", path: "/ar/credit-notes", title: "應收貸項單", requires: { permissions: ["ar.view"] },
  menu: { group: "accountsReceivable", icon: "assignment_return", order: 25 } };
</script>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { invoiceStatusLabels, money, statusColors } from "@/components/ar/arPresentation.js";
import { useSessionStore } from "@/stores/session.js";
import ar from "@/services/ar.js";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const query = computed(() => ({
  q: typeof route.query.q === "string" ? route.query.q : "",
  status: typeof route.query.status === "string" && Object.hasOwn(invoiceStatusLabels, route.query.status) ? route.query.status : ""
}));
const filterKey = computed(() => JSON.stringify(query.value));
const searchText = ref(""), status = ref("");
watch(filterKey, () => { searchText.value = query.value.q; status.value = query.value.status; }, { immediate: true });
const statusOptions = Object.entries(invoiceStatusLabels).map(([value, label]) => ({ value, label }));
const currencyAmount = (row, field) => `${row.currencyCode} ${money(row[field], row.currencyDecimalPlaces)}`;
const columns = [
  { name: "number", label: "貸項單編號", field: "number", align: "left" },
  { name: "customer", label: "客戶", field: (row) => `${row.customerCode} — ${row.customerName}`, align: "left" },
  { name: "date", label: "貸項日期", field: "creditDate", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "amount", label: "貸項金額", field: (row) => currencyAmount(row, "totalAmount"), align: "right" },
  { name: "available", label: "可用額", field: (row) => currencyAmount(row, "availableAmount"), align: "right" }
];

const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const initialPage = () => /^[1-9]\d*$/u.test(route.query.page ?? "") && Number.isSafeInteger(Number(route.query.page)) ? Number(route.query.page) : 1;
async function fetchRows({ page: pageNumber, rowsPerPage }) {
  const key = filterKey.value, filters = { ...query.value };
  const result = await ar.listCreditNotes({ ...filters, page: pageNumber, rowsPerPage, signal: controller.signal });
  if (!controller.signal.aborted && key === filterKey.value) await router.replace({ query: { ...filters, page: String(pageNumber) } });
  return result;
}
function applyFilters() { return router.replace({ query: { q: searchText.value.trim(), status: status.value ?? "" } }); }
</script>

<template>
  <div>
    <PageHeader>
      <template #actions><q-btn v-if="session.permissions.includes('ar.credit.mgmt')" color="primary" label="新增貸項單" to="/ar/credit-notes/draft" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md">
      <form role="search" action="/ar/credit-notes" method="get" class="row items-center q-col-gutter-sm q-mb-md" @submit.prevent="applyFilters">
        <div class="col-12 col-sm-6"><q-input v-model="searchText" type="search" name="q" label="貸項單編號或客戶" maxlength="190" outlined dense /></div>
        <div class="col-8 col-sm-4"><q-select v-model="status" name="status" label="狀態" :options="statusOptions" emit-value map-options clearable outlined dense /></div>
        <div class="col-auto"><q-btn type="submit" color="primary" label="搜尋" /></div>
      </form>
      <DataTable :key="filterKey" :fetch="fetchRows" :columns="columns" :initial-pagination="{ page: initialPage(), rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0 }">
        <template #body-cell-number="{ row }"><q-td><router-link :to="`/ar/credit-notes/${row.id}`">{{ row.number || `草稿 ${row.id}` }}</router-link></q-td></template>
        <template #body-cell-status="{ row }"><q-td><q-badge :color="statusColors[row.status]" :label="invoiceStatusLabels[row.status]" /></q-td></template>
        <template #no-data><p role="status" class="q-ma-none">沒有符合條件的貸項單。</p></template>
      </DataTable>
    </div>
  </div>
</template>
