<script>
export const page = {
  name: "ap-credit-notes", path: "/ap/credit-notes", title: "應付貸項單",
  requires: { permissions: ["ap.view"] }, menu: { group: "accountsPayable", icon: "receipt_long", order: 25 }
};
</script>
<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { invoiceStatusLabels, money, statusColors } from "@/components/ap/apPresentation.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const invoiceId = computed(() => /^[1-9]\d*$/u.test(route.query.invoiceId ?? "") ? route.query.invoiceId : undefined);
const status = ref(null);
const appliedStatus = computed(() => Object.hasOwn(invoiceStatusLabels, route.query.status) ? route.query.status : undefined);
const tableKey = computed(() => `${invoiceId.value ?? ""}:${appliedStatus.value ?? ""}`);
watch(appliedStatus, (value) => { status.value = value ?? null; }, { immediate: true });
const statuses = Object.entries(invoiceStatusLabels).map(([value, label]) => ({ value, label }));
const columns = [
  { name: "number", field: "number", label: "貸項單", align: "left" },
  { name: "supplierName", field: "supplierName", label: "供應商", align: "left" },
  { name: "invoiceNumber", field: "invoiceNumber", label: "原發票", align: "left" },
  { name: "creditDate", field: "creditDate", label: "貸項日期", align: "left" },
  { name: "status", field: "status", label: "狀態", align: "left" },
  { name: "totalAmount", field: "totalAmount", label: "貸項總額", align: "right" },
  { name: "availableAmount", field: "availableAmount", label: "可用額", align: "right" }
];
const fetchRows = ({ page, rowsPerPage }) => ap.listCreditNotes({ page, rowsPerPage, invoiceId: invoiceId.value, status: appliedStatus.value });
const amount = (row, field) => `${row.currencyCode} ${money(row[field], row.currencyDecimalPlaces)}`;
function apply() { router.replace({ query: { invoiceId: invoiceId.value, status: status.value ?? undefined } }); }
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
        <q-btn v-if="session.permissions.includes('ap.credit.mgmt')" color="primary" label="選擇原發票" to="/ap/invoices?status=CONFIRMED" />
      </template>
    </PageHeader>
    <div class="q-px-md q-pb-md">
      <form role="search" action="/ap/credit-notes" method="get" class="row items-center q-gutter-sm q-mb-md" @submit.prevent="apply">
        <q-select v-model="status" name="status" label="狀態" :options="statuses" clearable emit-value map-options outlined dense class="status-filter" />
        <q-btn color="primary" label="篩選" type="submit" />
        <q-btn v-if="invoiceId" flat label="顯示所有發票的貸項單" type="button" to="/ap/credit-notes" />
      </form>
      <DataTable :key="tableKey" :fetch="fetchRows" :columns="columns">
        <template #body-cell-number="{ row }"><q-td><router-link :to="`/ap/credit-notes/${row.id}`">{{ row.number || `草稿 ${row.id}` }}</router-link></q-td></template>
        <template #body-cell-status="{ row }"><q-td><q-badge :color="statusColors[row.status]" :label="invoiceStatusLabels[row.status]" /></q-td></template>
        <template #body-cell-totalAmount="{ row }"><q-td class="text-right">{{ amount(row, 'totalAmount') }}</q-td></template>
        <template #body-cell-availableAmount="{ row }"><q-td class="text-right">{{ amount(row, 'availableAmount') }}</q-td></template>
        <template #no-data><p role="status" class="q-ma-none">沒有符合條件的貸項單。</p></template>
      </DataTable>
    </div>
  </div>
</template>

<style scoped>
.status-filter { inline-size: 9rem; max-inline-size: calc(100% - 8px); }
</style>
