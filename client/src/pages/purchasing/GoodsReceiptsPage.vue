<script>
export const page = { name: "goods-receipts", path: "/purchasing/goods-receipts", title: "收貨單", requires: { permissions: ["purchasing.view"] }, menu: { group: "purchasingReceiving", icon: "move_to_inbox", order: 30 } };
</script>
<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import purchasing from "@/services/purchasing.js";
import { receiptStatusColors, receiptStatusLabels } from "@/components/purchasing/goodsReceiptPresentation.js";

// 收貨單列表（TASK-031）：只用 server 支援嘅 status filter（設計 §5.3 子集；list 只接受 page、pageSize、status、purchaseOrderId）。
const session = useSessionStore();
const receive = computed(() => can(session, { permissions: ["purchasing.view", "receiving.operation"] }));
const status = ref(null), tableKey = ref(0);
const statusOptions = Object.entries(receiptStatusLabels).map(([value, label]) => ({ value, label }));
const columns = [
  { name: "number", label: "收貨單編號", field: "number", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "purchaseOrderNumber", label: "採購單", field: "purchaseOrderNumber", align: "left" },
  { name: "supplierName", label: "供應商", field: "supplierName", align: "left" },
  { name: "businessReceiptDate", label: "收貨日期", field: "businessReceiptDate", align: "left" },
  { name: "totalReceivedBaseQuantity", label: "收貨數量（基本單位）", field: "totalReceivedBaseQuantity", align: "right" },
  { name: "actions", label: "操作", align: "right" }
];
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const fetchRows = (params) => purchasing.listGoodsReceipts({ page: params.page, rowsPerPage: params.rowsPerPage, status: status.value ?? undefined, signal: controller.signal });
function changeStatus(value) { status.value = value; tableKey.value += 1; }
</script>

<template>
  <div>
    <PageHeader subtitle="從已確認的採購單建立收貨單；確認後才會入庫。">
      <template #actions><q-btn v-if="receive" color="primary" label="新增收貨單" to="/purchasing/goods-receipts/new" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md">
      <div class="row q-col-gutter-md q-mb-md">
        <div class="col-12 col-sm-4"><q-select :model-value="status" label="狀態" :options="statusOptions" emit-value map-options clearable outlined dense @update:model-value="changeStatus" /></div>
      </div>
      <DataTable :key="tableKey" :fetch="fetchRows" :columns="columns" sticky-actions :initial-pagination="{ page: 1, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0 }">
        <template #body-cell-status="{ row }"><q-td><q-badge :color="receiptStatusColors[row.status]" :label="receiptStatusLabels[row.status]" /></q-td></template>
        <template #body-cell-supplierName="{ row }"><EllipsisCell :text="`${row.supplierCode} — ${row.supplierName}`" max-width="160px" /></template>
        <template #body-cell-actions="{ row }">
          <q-td class="text-right">
            <q-btn v-if="row.status === 'DRAFT' && receive" flat dense label="編輯" :aria-label="`編輯 ${row.number}`" :to="`/purchasing/goods-receipts/${row.id}/edit`" />
            <q-btn flat dense label="查看" :aria-label="`查看 ${row.number}`" :to="`/purchasing/goods-receipts/${row.id}`" />
          </q-td>
        </template>
      </DataTable>
    </div>
  </div>
</template>
