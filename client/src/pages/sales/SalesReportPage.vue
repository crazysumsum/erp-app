<script>
export const page = {
  name: "sales-report", path: "/sales/reports/orders", title: "銷售報表",
  requires: { permissions: ["sales.view"] },
  menu: { group: "salesOrderManagement", icon: "assessment", order: 22 }
};
</script>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import DataTable from "@/framework/ui/DataTable.vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { useRequestAbort } from "@/framework/http/useRequestAbort.js";
import { statusLabels } from "@/components/sales/salesOrderPresentation.js";
import sales from "@/services/sales.js";

const route = useRoute();
const router = useRouter();
const signal = useRequestAbort();
const fieldNames = ["dateFrom", "dateTo", "customerCode", "skuCode"];
const fromRoute = key => typeof route.query[key] === "string" ? route.query[key] : "";
const applied = computed(() => Object.fromEntries(fieldNames.map(key => [key, fromRoute(key)])));
const form = reactive({ ...applied.value });
const tableKey = computed(() => JSON.stringify(applied.value));
const ready = computed(() => Boolean(applied.value.dateFrom && applied.value.dateTo));
const changed = computed(() => fieldNames.some(key => form[key] !== applied.value[key]));
const dateError = ref("");
const dateToInput = ref(null);
const table = ref(null);
const exporting = ref(false);
const downloadError = ref("");

watch(tableKey, () => {
  Object.assign(form, applied.value);
  dateError.value = "";
  downloadError.value = "";
});

const columns = [
  { name: "orderDate", label: "訂單日期", field: "orderDate", align: "left" },
  { name: "orderNumber", label: "訂單編號", field: "orderNumber", align: "left" },
  { name: "status", label: "狀態", field: row => statusLabels[row.status], align: "left" },
  { name: "customer", label: "客戶", field: row => `${row.customerCode} — ${row.customerName}`, align: "left" },
  { name: "warehouseCode", label: "出貨倉", field: "warehouseCode", align: "left" },
  { name: "sku", label: "SKU", field: row => `${row.skuCode} — ${row.skuName}`, align: "left" },
  { name: "quantity", label: "訂購數量（銷售單位）", field: row => `${row.quantity} ${row.salesUomCode}`, align: "right" },
  { name: "fulfilledBaseQuantity", label: "已履約（基本單位）", field: "fulfilledBaseQuantity", align: "right" },
  { name: "cancelledBaseQuantity", label: "已取消（基本單位）", field: "cancelledBaseQuantity", align: "right" },
  { name: "unitSellingPrice", label: "單價", field: "unitSellingPrice", align: "right" },
  { name: "lineAmount", label: "原始明細金額", field: "lineAmount", align: "right" },
  { name: "currencyCode", label: "幣別", field: "currencyCode", align: "left" }
];

const fetchRows = ({ page, rowsPerPage }) => sales.listOrderReport({ ...applied.value, page, pageSize: rowsPerPage, signal });

function submit() {
  if (form.dateTo < form.dateFrom) {
    dateError.value = "結束日期必須等於或晚於開始日期。";
    dateToInput.value?.focus();
    return;
  }
  form.customerCode = form.customerCode.trim();
  form.skuCode = form.skuCode.trim();
  if (!changed.value) {
    table.value?.reload();
    return;
  }
  return router.push({ query: Object.fromEntries(Object.entries(form).filter(([, value]) => value)) });
}

async function download() {
  const key = tableKey.value;
  exporting.value = true;
  downloadError.value = "";
  try {
    const { blob, fileName } = await sales.downloadOrderReport({ ...applied.value, signal });
    if (signal.aborted || key !== tableKey.value) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName ?? "sales-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    if (!signal.aborted && key === tableKey.value) downloadError.value = error.message || "無法匯出銷售報表。";
  } finally {
    if (!signal.aborted) exporting.value = false;
  }
}
</script>

<template>
  <PageHeader subtitle="按訂單日期查詢已確認的訂單明細。原始金額包含其後取消的餘量。" />
  <div class="q-px-md q-pb-md">
    <form class="row q-col-gutter-md items-start q-mb-md" @submit.prevent="submit">
      <div class="col-12 col-sm-6 col-lg-3">
        <q-input v-model="form.dateFrom" type="date" name="dateFrom" label="開始日期" outlined stack-label required
          @update:model-value="dateError = ''" />
      </div>
      <div class="col-12 col-sm-6 col-lg-3">
        <q-input ref="dateToInput" v-model="form.dateTo" type="date" name="dateTo" label="結束日期" outlined stack-label required
          :aria-invalid="Boolean(dateError)" :aria-describedby="dateError ? 'sales-report-date-error' : undefined" @update:model-value="dateError = ''" />
        <div v-if="dateError" id="sales-report-date-error" class="text-negative q-mt-xs" role="alert">{{ dateError }}</div>
      </div>
      <div class="col-12 col-sm-6 col-lg-3">
        <q-input v-model="form.customerCode" name="customerCode" label="客戶代碼（精確）" maxlength="190" outlined
          autocapitalize="none" autocorrect="off" :spellcheck="false" />
      </div>
      <div class="col-12 col-sm-6 col-lg-3">
        <q-input v-model="form.skuCode" name="skuCode" label="SKU 代碼（精確）" maxlength="190" outlined
          autocapitalize="none" autocorrect="off" :spellcheck="false" />
      </div>
      <div class="col-12 row q-gutter-sm">
        <q-btn type="submit" color="primary" label="查詢" />
        <q-btn type="button" outline color="primary" label="下載 CSV" :disable="!ready || changed" :loading="exporting" @click="download" />
      </div>
    </form>
    <p v-if="downloadError" class="text-negative" role="alert">{{ downloadError }}</p>
    <p v-if="!ready" role="status">請選擇日期範圍後查詢。</p>
    <section v-else class="sales-report-results scroll" role="region" aria-label="銷售報表結果" tabindex="0">
      <DataTable ref="table" :key="tableKey" :fetch="fetchRows" :columns="columns">
        <template #body-cell-orderNumber="{ row }">
          <q-td><router-link :to="`/sales/orders/${row.orderId}`">{{ row.orderNumber }}</router-link></q-td>
        </template>
        <template #no-data><p role="status">沒有符合條件的銷售明細。</p></template>
      </DataTable>
    </section>
  </div>
</template>

<style scoped>
.sales-report-results :deep(.q-table__middle) {
  overflow: visible;
}
</style>
