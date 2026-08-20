<script>
export const page = {
  name: "my-devices",
  path: "/device/mine",
  title: "我的設備",
  menu: { group: "system", icon: "laptop", order: 20 }
};
</script>

<script setup>
import { ref } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { currentDeviceId } from "@/framework/auth/deviceKey.js";
import deviceService from "@/services/device.js";

const thisDeviceId = ref("");

const columns = [
  { name: "label", label: "裝置名稱", field: "label", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "deviceId", label: "設備編號", field: "deviceId", align: "left" },
  { name: "lastUsedAt", label: "最後使用", field: "lastUsedAt", align: "left" },
  { name: "requestedAt", label: "申請時間", field: "requestedAt", align: "left" }
];

const STATUS = {
  approved: { label: "已核准", colour: "positive" },
  pending: { label: "等待審批", colour: "warning" },
  rejected: { label: "已拒絕", colour: "negative" },
  revoked: { label: "已停用", colour: "grey" }
};

async function fetchMine() {
  // 順手記低自己而家坐緊邊一台，等清單可以標出嚟——一個人有幾台已核准設備
  // 嘅時候，「邊個係我而家用緊嗰個」淨係睇 thumbprint 分唔出。
  thisDeviceId.value = await currentDeviceId().catch(() => "");

  const rows = await deviceService.listMine();
  return { rows, rowsNumber: rows.length };
}

function formatTime(epochMs) {
  // null 代表從來未成功用過（仲喺等審批，或者核准咗但用戶再冇返嚟）。
  // 顯示 0 會變成 1970 年。
  return epochMs === null ? "—" : new Date(epochMs).toLocaleString();
}
</script>

<template>
  <div>
    <PageHeader title="我的設備" subtitle="每一台設備都要經批准先可以登入" />

    <DataTable :fetch="fetchMine" :columns="columns" row-key="id">
      <template #body-cell-status="{ value }">
        <q-td class="text-left">
          <q-badge :color="STATUS[value]?.colour ?? 'grey'" :label="STATUS[value]?.label ?? value" />
        </q-td>
      </template>

      <template #body-cell-deviceId="{ value }">
        <q-td class="text-left">
          <span class="text-caption">{{ value.slice(0, 16) }}…</span>
          <q-badge v-if="value === thisDeviceId" color="primary" class="q-ml-sm" label="目前這台" />
        </q-td>
      </template>

      <template #body-cell-lastUsedAt="{ value }">
        <q-td class="text-left">{{ formatTime(value) }}</q-td>
      </template>

      <template #body-cell-requestedAt="{ value }">
        <q-td class="text-left">{{ formatTime(value) }}</q-td>
      </template>
    </DataTable>
  </div>
</template>
