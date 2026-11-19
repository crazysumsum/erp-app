<script>
export const page = { name: "my-purchase-order-approvals", path: "/purchasing/approvals", title: "待我審批", requires: { permissions: ["purchasing.view", "purchasing.approval"] },
  menu: { group: "purchasingReceiving", icon: "approval", order: 20 } };
</script>
<script setup>
import { onBeforeUnmount, reactive, ref } from "vue";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { timestamp } from "@/components/purchasing/purchaseOrderPresentation.js";
import purchasing from "@/services/purchasing.js";

// §5.2：server 只回指派畀自己嘅 Pending，最舊先處理；快照太大唔喺列表，入詳情先睇。
const filters = reactive({ q: "", supplierId: null }), applied = ref({}), tableKey = ref(0);
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const columns = [
  { name: "number", label: "採購單編號", field: "number", align: "left" },
  { name: "supplier", label: "供應商", field: "supplierName", align: "left" },
  { name: "totalAmount", label: "總額", field: "totalAmount", align: "right" },
  { name: "requestedByLabel", label: "提交人", field: "requestedByLabel", align: "left" },
  { name: "requestNote", label: "提交備註", field: "requestNote", align: "left" },
  { name: "requestedAt", label: "提交時間", field: "requestedAt", align: "left" },
  { name: "actions", label: "操作", align: "right" }
];
function fetchRows({ page, rowsPerPage }) {
  return purchasing.listMyApprovals({ page, rowsPerPage, filter: applied.value.q, supplierId: applied.value.supplierId, signal: controller.signal });
}
function apply() { applied.value = { q: filters.q.trim(), supplierId: filters.supplierId }; tableKey.value += 1; }
function reset() { Object.assign(filters, { q: "", supplierId: null }); apply(); }
function acceptId(value, done) { if (/^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value))) done(Number(value), "add-unique"); }
</script>

<template>
  <div>
    <PageHeader subtitle="只列出指派給你、仍待審批的採購單，最早提交的排先；按「處理」查看提交時的快照並決定。" />
    <div class="q-px-md q-pb-md">
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6"><q-input v-model="filters.q" label="編號／供應商" maxlength="190" outlined dense @keyup.enter="apply" /></div>
        <div class="col-12 col-md-6"><q-select v-model="filters.supplierId" label="供應商 ID" hint="輸入正整數 ID 後按 Enter" use-input clearable hide-dropdown-icon outlined dense @new-value="acceptId" /></div>
      </div>
      <div class="row q-gutter-sm q-mt-md"><q-btn label="搜尋" color="primary" @click="apply" /><q-btn flat label="清除篩選" @click="reset" /></div>
    </div>
    <div class="q-px-md q-pb-md" aria-live="polite">
      <DataTable :key="tableKey" :fetch="fetchRows" :columns="columns" row-key="approvalId" sticky-actions
        :initial-pagination="{ page: 1, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0, sortBy: null, descending: false }">
        <template #body-cell-supplier="{ row }"><EllipsisCell :text="`${row.supplierCode} — ${row.supplierName}`" max-width="160px" /></template>
        <template #body-cell-totalAmount="{ row }"><q-td class="text-right">{{ row.currencyCode }} {{ row.totalAmount }}</q-td></template>
        <template #body-cell-requestNote="{ row }"><EllipsisCell :text="row.requestNote || '—'" /></template>
        <template #body-cell-requestedAt="{ row }"><q-td>{{ timestamp(row.requestedAt) }}</q-td></template>
        <template #body-cell-actions="{ row }">
          <q-td class="text-right"><q-btn flat dense label="處理" :aria-label="`處理 ${row.number}`" :to="`/purchasing/purchase-orders/${row.purchaseOrderId}`" /></q-td>
        </template>
        <template #no-data><p role="status" class="q-ma-none">目前沒有待你審批的採購單。</p></template>
      </DataTable>
    </div>
  </div>
</template>
