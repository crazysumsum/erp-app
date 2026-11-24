<script>
export const page = { name: "ap-invoices", path: "/ap/invoices", title: "應付發票", requires: { permissions: ["ap.view"] }, menu: { group: "accountsPayable", icon: "request_quote", order: 10 } };
</script>
<script setup>
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { invoiceOutstandingText, invoiceStatusLabels, money, statusColors, timestamp } from "@/components/ap/apPresentation.js";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";
import { page as createPage } from "./ApInvoiceCreatePage.vue";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const canCreate = computed(() => can(session, createPage.requires));
const SELECTS = ["status", "outstandingOnly"];
const filters = reactive({ q: "", status: null, currencyCode: "", invoiceDateFrom: "", invoiceDateTo: "", outstandingOnly: null });
const statusOptions = Object.entries(invoiceStatusLabels).map(([value, label]) => ({ value, label }));
const outstandingOptions = [{ value: "true", label: "只列仍有未付額" }];
const filterQuery = computed(() => Object.fromEntries(Object.entries(route.query).filter(([key, value]) => key in filters && value !== "")));
const tableKey = computed(() => JSON.stringify(filterQuery.value));
watch(tableKey, () => { for (const key of Object.keys(filters)) filters[key] = route.query[key] ?? (SELECTS.includes(key) ? null : ""); }, { immediate: true });

// Server 固定新到舊，冇排序參數，所以欄位唔可以排序。
const columns = [
  { name: "number", label: "發票編號", field: "number", align: "left" },
  { name: "supplierInvoiceNumber", label: "供應商發票號碼", field: "supplierInvoiceNumber", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "supplier", label: "供應商", field: "supplierName", align: "left" },
  { name: "invoiceDate", label: "發票日期", field: "invoiceDate", align: "left" },
  { name: "dueDate", label: "到期日", field: "dueDate", align: "left" },
  { name: "totalAmount", label: "總額", field: "totalAmount", align: "right" },
  { name: "outstandingAmount", label: "未付額", field: "outstandingAmount", align: "right" },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left" },
  { name: "actions", label: "操作", align: "right" }
];
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const pagination = () => ({ page: /^[1-9]\d*$/u.test(route.query.page ?? "") && Number.isSafeInteger(Number(route.query.page)) ? Number(route.query.page) : 1, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0 });
async function fetchRows(params) {
  const key = tableKey.value, query = { ...filterQuery.value };
  const result = await ap.listInvoices({ page: params.page, rowsPerPage: params.rowsPerPage, ...query, signal: controller.signal });
  if (key === tableKey.value && !controller.signal.aborted) await router.replace({ query: { ...query, page: String(params.page) } });
  return result;
}
function apply() { router.replace({ query: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null && value !== "")) }); }
function reset() { router.replace({ query: {} }); }
</script>

<template>
  <div>
    <PageHeader subtitle="可搜尋內部發票編號、供應商發票號碼、供應商代碼或名稱。">
      <template #actions><q-btn v-if="canCreate" color="primary" label="登記應付發票" to="/ap/invoices/new" /></template>
    </PageHeader>
    <form role="search" method="get" class="q-px-md q-pb-md" @submit.prevent="apply">
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6"><q-input v-model="filters.q" label="發票編號／供應商" maxlength="190" outlined dense /></div>
        <div class="col-12 col-sm-6 col-md-3"><q-select v-model="filters.status" label="狀態" :options="statusOptions" clearable emit-value map-options outlined dense /></div>
        <div class="col-12 col-sm-6 col-md-3"><q-select v-model="filters.outstandingOnly" label="未付" :options="outstandingOptions" clearable emit-value map-options outlined dense /></div>
        <div class="col-12 col-md-4"><q-input v-model="filters.currencyCode" label="貨幣代碼" hint="例如 HKD" mask="AAA" outlined dense /></div>
        <div class="col-6 col-md-4"><q-input v-model="filters.invoiceDateFrom" label="發票日期由" type="date" stack-label outlined dense /></div>
        <div class="col-6 col-md-4"><q-input v-model="filters.invoiceDateTo" label="發票日期至" type="date" stack-label outlined dense /></div>
      </div>
      <div class="row q-gutter-sm q-mt-md"><q-btn label="搜尋" color="primary" type="submit" /><q-btn flat label="清除篩選" @click="reset" /></div>
    </form>
    <div class="q-px-md q-pb-md" aria-live="polite">
      <DataTable :key="tableKey" :fetch="fetchRows" :columns="columns" sticky-actions :initial-pagination="pagination()">
        <template #body-cell-number="{ row }"><q-td>{{ row.number || "（草稿未編號）" }}</q-td></template>
        <template #body-cell-status="{ row }"><q-td><q-badge :color="statusColors[row.status]" :label="invoiceStatusLabels[row.status]" /></q-td></template>
        <template #body-cell-supplier="{ row }"><EllipsisCell :text="`${row.supplierCode} — ${row.supplierName}`" max-width="160px" /></template>
        <template #body-cell-dueDate="{ row }"><q-td>{{ row.dueDate || "—" }}</q-td></template>
        <template #body-cell-totalAmount="{ row }"><q-td class="text-right">{{ row.currencyCode }} {{ money(row.totalAmount, row.currencyDecimalPlaces) }}</q-td></template>
        <template #body-cell-outstandingAmount="{ row }"><q-td class="text-right">{{ invoiceOutstandingText(row) }}</q-td></template>
        <template #body-cell-updatedAt="{ row }"><q-td>{{ timestamp(row.updatedAt) }}</q-td></template>
        <template #body-cell-actions="{ row }"><q-td class="text-right"><q-btn flat dense label="查看" :aria-label="`查看 ${row.number || `草稿 ${row.id}`}`" :to="`/ap/invoices/${row.id}`" /></q-td></template>
        <template #no-data><p role="status" class="q-ma-none">沒有符合條件的發票；請調整搜尋條件。</p></template>
      </DataTable>
    </div>
  </div>
</template>
