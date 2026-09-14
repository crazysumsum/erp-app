<script>
export const page = {
  name: "business-master-audit",
  path: "/system/business-master/audit",
  title: "Business Master 稽核記錄",
  requires: { permissions: ["business_master.view"] }
};
</script>

<script setup>
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import businessMasterService from "@/services/businessMaster.js";

const route = useRoute();
const router = useRouter();
const initialQuery = route.query;
const entityType = ref(["CURRENCY", "PAYMENT_TERM"].includes(initialQuery.entityType) ? initialQuery.entityType : null);
const entityKey = ref(typeof initialQuery.entityKey === "string" ? initialQuery.entityKey : "");
const action = ref(typeof initialQuery.action === "string" ? initialQuery.action : null);
const actorUserId = ref(typeof initialQuery.actorUserId === "string" ? initialQuery.actorUserId : "");
const from = ref(dateQueryValue(initialQuery.from));
const to = ref(dateQueryValue(initialQuery.to));
const dataTableRef = ref(null);
const currentPage = ref(Number(initialQuery.page) > 0 ? Number(initialQuery.page) : 1);
const initialPagination = {
  page: currentPage.value,
  rowsPerPage: appConfig.defaultPageSize,
  rowsNumber: 0,
  sortBy: null,
  descending: true
};

const columns = [
  { name: "createdAt", label: "時間", field: "createdAt", align: "left" },
  { name: "entity", label: "項目", field: "entityKey", align: "left" },
  { name: "action", label: "動作", field: "action", align: "left" },
  { name: "result", label: "結果", field: "result", align: "left" },
  { name: "actorUserId", label: "操作者", field: "actorUserId", align: "left" },
  { name: "reason", label: "原因", field: "reason", align: "left" },
  { name: "correlationId", label: "Correlation ID", field: "correlationId", align: "left" }
];
const entityOptions = [
  { label: "全部類型", value: null },
  { label: "貨幣", value: "CURRENCY" },
  { label: "付款條款", value: "PAYMENT_TERM" }
];
const actionOptions = [null, "CREATE", "UPDATE", "ACTIVATE", "DEACTIVATE", "CHANGE_PRECISION", "CHANGE_RULE"]
  .map((value) => ({ label: value ?? "全部動作", value }));
const actionLabel = {
  CREATE: "建立", UPDATE: "更新", ACTIVATE: "啟用", DEACTIVATE: "停用",
  CHANGE_PRECISION: "變更小數位", CHANGE_RULE: "變更到期規則"
};

function dateStart(value) { return value ? new Date(`${value}T00:00:00`).getTime() : undefined; }
function dateEnd(value) { return value ? new Date(`${value}T23:59:59.999`).getTime() : undefined; }
function dateQueryValue(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchAudit({ page, rowsPerPage }) {
  currentPage.value = page;
  const params = {
    entityType: entityType.value || undefined,
    entityKey: entityKey.value || undefined,
    action: action.value || undefined,
    actorUserId: actorUserId.value ? Number(actorUserId.value) : undefined,
    from: dateStart(from.value),
    to: dateEnd(to.value),
    page,
    rowsPerPage
  };
  router.replace({ query: {
    entityType: params.entityType,
    entityKey: params.entityKey,
    action: params.action,
    actorUserId: actorUserId.value || undefined,
    from: params.from,
    to: params.to,
    page
  } });
  const result = await businessMasterService.auditList(params);
  return { rows: result.items, rowsNumber: result.total };
}

watch([entityType, entityKey, action, actorUserId, from, to], () => dataTableRef.value?.reload());
function formatTime(value) { return new Date(value).toLocaleString("zh-HK"); }
</script>

<template>
  <div>
    <PageHeader subtitle="顯示建立、修改、狀態及高影響操作的責任鏈。">
      <template #actions>
        <q-btn flat icon="currency_exchange" label="貨幣" to="/system/business-master/currencies" />
        <q-btn flat icon="event_available" label="付款條款" to="/system/business-master/payment-terms" />
      </template>
    </PageHeader>
    <div class="q-px-md q-pb-md row q-col-gutter-sm items-start">
      <q-select class="col-12 col-sm-3" v-model="entityType" dense outlined emit-value map-options :options="entityOptions" label="資料類型" />
      <q-input class="col-12 col-sm-3" v-model="entityKey" dense outlined debounce="300" label="代碼或 ID" />
      <q-select class="col-12 col-sm-3" v-model="action" dense outlined emit-value map-options :options="actionOptions" label="動作" />
      <q-input class="col-12 col-sm-3" v-model="actorUserId" dense outlined debounce="300" inputmode="numeric" label="操作者 ID" />
      <q-input class="col-12 col-sm-3" v-model="from" dense outlined type="date" label="從" />
      <q-input class="col-12 col-sm-3" v-model="to" dense outlined type="date" label="到" />
    </div>
    <div class="q-px-md q-pb-md">
      <DataTable ref="dataTableRef" :fetch="fetchAudit" :columns="columns" :initial-pagination="initialPagination" row-key="id" sticky-actions>
        <template #body-cell-createdAt="{ value }"><q-td>{{ formatTime(value) }}</q-td></template>
        <template #body-cell-entity="{ row }"><q-td>{{ row.entityType === 'CURRENCY' ? '貨幣' : '付款條款' }}/{{ row.entityKey }}</q-td></template>
        <template #body-cell-action="{ value }"><q-td>{{ actionLabel[value] ?? value }}</q-td></template>
        <template #body-cell-result="{ value }"><q-td><q-badge :color="value === 'SUCCESS' ? 'positive' : 'negative'" :label="value === 'SUCCESS' ? '成功' : '拒絕'" /></q-td></template>
        <template #body-cell-actorUserId="{ value }"><q-td>{{ value ?? '系統' }}</q-td></template>
        <template #body-cell-reason="{ value }"><EllipsisCell :text="value || '—'" max-width="240px" /></template>
        <template #body-cell-correlationId="{ value }"><EllipsisCell :text="value" max-width="180px" /></template>
      </DataTable>
    </div>
  </div>
</template>
