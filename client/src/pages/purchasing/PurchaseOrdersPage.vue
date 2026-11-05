<script>
export const page = { name: "purchase-orders", path: "/purchasing/purchase-orders", title: "採購單", requires: { permissions: ["purchasing.view"] }, menu: { group: "purchasingReceiving", icon: "receipt_long", order: 10 } };
</script>
<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import PurchaseOrderProgress from "@/components/purchasing/PurchaseOrderProgress.vue";
import { riskLabels, statusColors, statusLabels, timestamp } from "@/components/purchasing/purchaseOrderPresentation.js";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import purchasing from "@/services/purchasing.js";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const manage = computed(() => can(session, { permissions: ["purchasing.mgmt"] }));
const SELECTS = ["status", "supplierId", "buyerId", "hasOutstanding"];
const filters = reactive({ q: "", status: null, supplierId: null, buyerId: null, currencyCode: "", hasOutstanding: null, orderDateFrom: "", orderDateTo: "", expectedDeliveryDateFrom: "", expectedDeliveryDateTo: "" });
const rows = ref([]);
const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }));
const outstandingOptions = [{ value: "true", label: "仍有未收" }, { value: "false", label: "沒有未收" }];
const optionsFrom = (id, label) => [...new Map(rows.value.filter((row) => row[id]).map((row) => [String(row[id]), { value: String(row[id]), label: label(row) }])).values()];
const suppliers = computed(() => optionsFrom("supplierId", (row) => `${row.supplierCode} — ${row.supplierName}`));
const buyers = computed(() => optionsFrom("buyerId", (row) => row.buyerLabel));
const filterQuery = computed(() => Object.fromEntries(Object.entries(route.query).filter(([key, value]) => key in filters && value !== "")));
const tableKey = computed(() => JSON.stringify(filterQuery.value));
watch(tableKey, () => { for (const key of Object.keys(filters)) filters[key] = route.query[key] ?? (SELECTS.includes(key) ? null : ""); }, { immediate: true });

const columns = [
  { name: "number", label: "採購單編號", field: "number", align: "left", sortable: true },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "supplierName", label: "供應商", field: "supplierName", align: "left", sortable: true },
  { name: "orderDate", label: "訂單日期", field: "orderDate", align: "left", sortable: true },
  { name: "expectedDeliveryDate", label: "預計交貨", field: "expectedDeliveryDate", align: "left", sortable: true },
  { name: "totalAmount", label: "總額", field: "totalAmount", align: "right", sortable: true },
  { name: "progress", label: "進度（Base）", field: "netReceivedBaseQuantity", align: "left" },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left", sortable: true },
  { name: "actions", label: "操作", align: "right" }
];
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const pagination = () => ({
  page: Number.isSafeInteger(Number(route.query.page)) && Number(route.query.page) > 0 ? Number(route.query.page) : 1,
  rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0,
  sortBy: columns.some((column) => column.sortable && column.name === route.query.sortBy) ? route.query.sortBy : "updatedAt",
  descending: route.query.descending !== "false"
});
async function fetchRows(params) {
  const key = tableKey.value, query = { ...filterQuery.value };
  const result = await purchasing.listPurchaseOrders({ ...params, ...query, filter: query.q ?? "", signal: controller.signal });
  if (key === tableKey.value && !controller.signal.aborted) {
    rows.value = result.rows;
    await router.replace({ query: { ...query, page: String(params.page), sortBy: params.sortBy ?? "updatedAt", descending: String(params.descending) } });
  }
  return result;
}
function apply() { router.replace({ query: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null && value !== "")) }); }
function reset() { router.replace({ query: {} }); }
function acceptId(value, done) { if (/^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value))) done(value, "add-unique"); }
</script>

<template>
  <div>
    <PageHeader subtitle="顯示交易快照；可用編號、供應商、SKU 或供應商參考搜尋。">
      <template #actions><q-btn v-if="manage" color="primary" label="新增採購單" to="/purchasing/purchase-orders/new" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md">
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6"><q-input v-model="filters.q" label="編號／供應商／SKU／供應商參考" maxlength="190" outlined dense @keyup.enter="apply" /></div>
        <div class="col-12 col-sm-6 col-md-3"><q-select v-model="filters.status" label="狀態" :options="statusOptions" clearable emit-value map-options outlined dense /></div>
        <div class="col-12 col-sm-6 col-md-3"><q-select v-model="filters.hasOutstanding" label="未收" :options="outstandingOptions" clearable emit-value map-options outlined dense /></div>
        <div class="col-12 col-sm-6 col-md-4"><q-select v-model="filters.supplierId" label="供應商 ID" :options="suppliers" hint="輸入正整數 ID 後按 Enter，或選擇目前頁的供應商" use-input clearable emit-value map-options outlined dense @new-value="acceptId" /></div>
        <div class="col-12 col-sm-6 col-md-4"><q-select v-model="filters.buyerId" label="採購員 ID" :options="buyers" hint="輸入正整數 ID 後按 Enter，或選擇目前頁的採購員" use-input clearable emit-value map-options outlined dense @new-value="acceptId" /></div>
        <div class="col-12 col-md-4"><q-input v-model="filters.currencyCode" label="貨幣代碼" hint="例如 HKD" mask="AAA" outlined dense @keyup.enter="apply" /></div>
        <div class="col-6 col-md-3"><q-input v-model="filters.orderDateFrom" label="訂單日期由" type="date" stack-label outlined dense /></div>
        <div class="col-6 col-md-3"><q-input v-model="filters.orderDateTo" label="訂單日期至" type="date" stack-label outlined dense /></div>
        <div class="col-6 col-md-3"><q-input v-model="filters.expectedDeliveryDateFrom" label="預計交貨由" type="date" stack-label outlined dense /></div>
        <div class="col-6 col-md-3"><q-input v-model="filters.expectedDeliveryDateTo" label="預計交貨至" type="date" stack-label outlined dense /></div>
      </div>
      <div class="row q-gutter-sm q-mt-md"><q-btn label="搜尋" color="primary" @click="apply" /><q-btn flat label="清除篩選" @click="reset" /></div>
    </div>
    <div class="q-px-md q-pb-md" aria-live="polite">
      <DataTable :key="tableKey" :fetch="fetchRows" :columns="columns" sticky-actions :initial-pagination="pagination()">
        <template #body-cell-supplierName="{ row }"><EllipsisCell :text="`${row.supplierCode} — ${row.supplierName}`" max-width="130px" /></template>
        <template #body-cell-expectedDeliveryDate="{ row }"><q-td>{{ row.expectedDeliveryDate || "未設定" }}</q-td></template>
        <template #body-cell-totalAmount="{ row }"><q-td class="text-right">{{ row.currencyCode }} {{ row.totalAmount }}</q-td></template>
        <template #body-cell-progress="{ row }"><q-td><PurchaseOrderProgress :received="row.netReceivedBaseQuantity" :ordered="row.orderedBaseQuantity" /><div class="text-caption">未收 {{ row.outstandingBaseQuantity }}</div></q-td></template>
        <template #body-cell-status="{ row }">
          <q-td>
            <q-badge :color="statusColors[row.status]" :label="statusLabels[row.status]" />
            <div v-for="risk in row.risks" :key="risk" class="text-caption q-mt-xs"><q-icon :name="riskLabels[risk].icon" aria-hidden="true" /> {{ riskLabels[risk].label }}</div>
          </q-td>
        </template>
        <template #body-cell-updatedAt="{ row }"><q-td>{{ timestamp(row.updatedAt) }}</q-td></template>
        <template #body-cell-actions="{ row }">
          <q-td class="text-right">
            <q-btn flat dense label="查看" :aria-label="`查看 ${row.number}`" :to="`/purchasing/purchase-orders/${row.id}`" />
            <q-btn v-if="manage && row.allowedActions.includes('edit')" flat dense label="編輯" :aria-label="`編輯 ${row.number}`" :to="`/purchasing/purchase-orders/${row.id}/edit`" />
          </q-td>
        </template>
        <template #no-data><p role="status" class="q-ma-none">沒有符合條件的採購單；請調整搜尋條件。</p></template>
      </DataTable>
    </div>
  </div>
</template>
