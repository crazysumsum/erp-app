<script>
export const page = { name: "ap-payments", path: "/ap/payments", title: "應付付款", requires: { permissions: ["ap.view"] }, menu: { group: "accountsPayable", icon: "payments", order: 20 } };
</script>
<script setup>
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { money, paymentMethodLabels, paymentStatusLabels, statusColors, timestamp } from "@/components/ap/apPresentation.js";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";
import { page as createPage } from "./ApPaymentCreatePage.vue";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const canCreate = computed(() => can(session, createPage.requires));
const SELECTS = ["status"];
const filters = reactive({ q: "", status: null, currencyCode: "", paymentDateFrom: "", paymentDateTo: "" });
const statusOptions = Object.entries(paymentStatusLabels).map(([value, label]) => ({ value, label }));
const filterQuery = computed(() => Object.fromEntries(Object.entries(route.query).filter(([key, value]) => key in filters && value !== "")));
const tableKey = computed(() => JSON.stringify(filterQuery.value));
watch(tableKey, () => { for (const key of Object.keys(filters)) filters[key] = route.query[key] ?? (SELECTS.includes(key) ? null : ""); }, { immediate: true });

// Server 固定新到舊，冇排序參數，所以欄位唔可以排序。
const columns = [
  { name: "number", label: "付款編號", field: "number", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "supplier", label: "供應商", field: "supplierName", align: "left" },
  { name: "paymentDate", label: "付款日期", field: "paymentDate", align: "left" },
  { name: "paymentMethod", label: "方式", field: "paymentMethod", align: "left" },
  { name: "amount", label: "金額", field: "amount", align: "right" },
  { name: "availableAmount", label: "可核銷額", field: "availableAmount", align: "right" },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left" },
  { name: "actions", label: "操作", align: "right" }
];
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const pagination = () => ({ page: /^[1-9]\d*$/u.test(route.query.page ?? "") && Number.isSafeInteger(Number(route.query.page)) ? Number(route.query.page) : 1, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0 });
async function fetchRows(params) {
  const key = tableKey.value, query = { ...filterQuery.value };
  const result = await ap.listPayments({ page: params.page, rowsPerPage: params.rowsPerPage, ...query, signal: controller.signal });
  if (key === tableKey.value && !controller.signal.aborted) await router.replace({ query: { ...query, page: String(params.page) } });
  return result;
}
function apply() { router.replace({ query: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null && value !== "")) }); }
function reset() { router.replace({ query: {} }); }
</script>

<template>
  <div>
    <PageHeader subtitle="按供應商、付款編號或參考號搜尋付款。">
      <template #actions><q-btn v-if="canCreate" color="primary" label="登記付款" to="/ap/payments/new" /></template>
    </PageHeader>
    <form role="search" method="get" class="q-px-md q-pb-md" @submit.prevent="apply">
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6"><q-input v-model="filters.q" label="付款編號／參考號／供應商" maxlength="190" outlined dense /></div>
        <div class="col-12 col-md-6"><q-select v-model="filters.status" label="狀態" :options="statusOptions" clearable emit-value map-options outlined dense /></div>
        <div class="col-12 col-md-4"><q-input v-model="filters.currencyCode" label="貨幣代碼" hint="例如 HKD" mask="AAA" outlined dense /></div>
        <div class="col-6 col-md-4"><q-input v-model="filters.paymentDateFrom" label="付款日期由" type="date" stack-label outlined dense /></div>
        <div class="col-6 col-md-4"><q-input v-model="filters.paymentDateTo" label="付款日期至" type="date" stack-label outlined dense /></div>
      </div>
      <div class="row q-gutter-sm q-mt-md"><q-btn label="搜尋" color="primary" type="submit" /><q-btn flat label="清除篩選" @click="reset" /></div>
    </form>
    <div class="q-px-md q-pb-md" aria-live="polite">
      <DataTable :key="tableKey" :fetch="fetchRows" :columns="columns" sticky-actions :initial-pagination="pagination()">
        <template #body-cell-number="{ row }"><q-td>{{ row.number || "（草稿未編號）" }}</q-td></template>
        <template #body-cell-status="{ row }"><q-td><q-badge :color="statusColors[row.status]" :label="paymentStatusLabels[row.status]" /></q-td></template>
        <template #body-cell-supplier="{ row }"><EllipsisCell :text="`${row.supplierCode} — ${row.supplierName}`" max-width="160px" /></template>
        <template #body-cell-paymentMethod="{ row }"><q-td>{{ paymentMethodLabels[row.paymentMethod] ?? row.paymentMethod }}</q-td></template>
        <template #body-cell-amount="{ row }"><q-td class="text-right">{{ row.currencyCode }} {{ money(row.amount, row.currencyDecimalPlaces) }}</q-td></template>
        <template #body-cell-availableAmount="{ row }"><q-td class="text-right">{{ row.currencyCode }} {{ money(row.availableAmount, row.currencyDecimalPlaces) }}</q-td></template>
        <template #body-cell-updatedAt="{ row }"><q-td>{{ timestamp(row.updatedAt) }}</q-td></template>
        <template #body-cell-actions="{ row }"><q-td class="text-right"><q-btn flat dense label="查看" :aria-label="`查看 ${row.number || `草稿 ${row.id}`}`" :to="`/ap/payments/${row.id}`" /></q-td></template>
        <template #no-data><p role="status" class="q-ma-none">沒有符合條件的付款；請調整搜尋條件。</p></template>
      </DataTable>
    </div>
  </div>
</template>
