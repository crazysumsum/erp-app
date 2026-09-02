<script>
export const page = {
  name: "audit-logs",
  path: "/system/audit",
  title: "變更紀錄",
  requires: { permissions: ["user.mgmt", "role.mgmt"], match: "any" },
  menu: { group: "system", icon: "history", order: 45 }
};
</script>

<script setup>
import { computed, ref } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import auditService from "@/services/audit.js";

const ACTION_LABELS = {
  "user.create": "新增用戶",
  "user.update": "編輯用戶",
  "user.disable": "停用用戶",
  "user.enable": "啟用用戶",
  "user.roles": "配置角色",
  "user.password.reset": "重設密碼",
  "user.password.change": "修改密碼",
  "role.create": "新增角色",
  "role.update": "編輯角色",
  "role.delete": "刪除角色",
  "role.permissions": "配置權限"
};

const ACTION_FILTER_OPTIONS = [
  { label: "全部", value: null },
  ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ label, value }))
];

const columns = [
  { name: "occurredAt", label: "時間", field: "occurredAt", align: "left" },
  { name: "actorUsername", label: "操作者", field: "actorUsername", align: "left" },
  { name: "action", label: "動作", field: "action", align: "left" },
  { name: "target", label: "對象", field: "targetLabel", align: "left" },
  { name: "detail", label: "內容", field: "detail", align: "left" },
  { name: "reason", label: "原因", field: "reason", align: "left" }
];

const tableRef = ref(null);
const fromDate = ref("");
const toDate = ref("");
const actorFilter = ref("");
const targetFilter = ref("");
const actionFilter = ref(null);

// 日期輸入是「哪一天」，查詢要的是那一天的起訖時刻（epoch 毫秒）。
const fromMs = computed(() =>
  fromDate.value ? new Date(`${fromDate.value}T00:00:00`).getTime() : undefined
);
const toMs = computed(() =>
  toDate.value ? new Date(`${toDate.value}T23:59:59.999`).getTime() : undefined
);

function fetchAuditLogs({ page, rowsPerPage }) {
  return auditService.list({
    page,
    rowsPerPage,
    from: fromMs.value,
    to: toMs.value,
    actor: actorFilter.value,
    target: targetFilter.value,
    action: actionFilter.value
  });
}

function reload() {
  tableRef.value?.reload();
}

function formatTime(epochMs) {
  return new Date(epochMs).toLocaleString();
}

function actionLabel(action) {
  return ACTION_LABELS[action] ?? action;
}

/**
 * 把 detail 的前後值渲染成 +新增／−移除（或改變前後值）的一組片段（§4.6）。
 * detail 的形狀因 action 而異：user.create 只有新增（一個角色陣列），
 * user.update／role.update 是純量的 before/after，user.roles／
 * role.permissions 是陣列的 before/after。沒有可記的變更（disable／enable／
 * delete）時 detail 本身是 null。
 */
function detailSegments(detail) {
  if (!detail) {
    return [];
  }

  if (detail.truncated) {
    return [{ kind: "note", text: "內容過長，已截斷" }];
  }

  const segments = [];

  for (const [key, value] of Object.entries(detail)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        segments.push({ kind: "add", text: `+${item}` });
      }
      continue;
    }

    if (value && typeof value === "object" && ("before" in value || "after" in value)) {
      const before = value.before;
      const after = value.after;

      if (Array.isArray(before) || Array.isArray(after)) {
        const beforeList = before ?? [];
        const afterList = after ?? [];
        const added = afterList.filter((item) => !beforeList.includes(item));
        const removed = beforeList.filter((item) => !afterList.includes(item));

        for (const item of added) segments.push({ kind: "add", text: `+${item}` });
        for (const item of removed) segments.push({ kind: "remove", text: `−${item}` });
        continue;
      }

      const beforeText = before === "" || before == null ? "（空）" : String(before);
      const afterText = after === "" || after == null ? "（空）" : String(after);
      segments.push({ kind: "change", text: `${key}：${beforeText} → ${afterText}` });
      continue;
    }

    segments.push({ kind: "note", text: `${key}：${JSON.stringify(value)}` });
  }

  return segments;
}

const SEGMENT_COLOUR = { add: "positive", remove: "negative", change: "grey-8", note: "grey-7" };
</script>

<template>
  <div>
    <PageHeader />

    <div class="row items-center q-gutter-md q-px-md q-pb-md">
      <q-input v-model="fromDate" dense outlined type="date" label="從" style="width: 160px" @update:model-value="reload" />
      <q-input v-model="toDate" dense outlined type="date" label="到" style="width: 160px" @update:model-value="reload" />
      <q-input
        v-model="actorFilter"
        dense
        outlined
        clearable
        debounce="300"
        label="操作者"
        style="width: 160px"
        @update:model-value="reload"
      />
      <q-input
        v-model="targetFilter"
        dense
        outlined
        clearable
        debounce="300"
        label="對象"
        style="width: 160px"
        @update:model-value="reload"
      />
      <q-select
        v-model="actionFilter"
        dense
        outlined
        emit-value
        map-options
        :options="ACTION_FILTER_OPTIONS"
        label="動作"
        style="width: 180px"
        @update:model-value="reload"
      />
    </div>

    <DataTable :ref="(el) => (tableRef = el)" :fetch="fetchAuditLogs" :columns="columns" row-key="id">
      <template #body-cell-occurredAt="{ value }">
        <q-td class="text-left">{{ formatTime(value) }}</q-td>
      </template>

      <template #body-cell-actorUsername="{ value }">
        <q-td class="text-left">
          <q-badge v-if="value.startsWith('cli:')" outline color="grey-7" :label="value" />
          <span v-else>{{ value }}</span>
        </q-td>
      </template>

      <template #body-cell-action="{ value }">
        <q-td class="text-left">{{ actionLabel(value) }}</q-td>
      </template>

      <template #body-cell-target="{ row }">
        <q-td class="text-left">{{ row.targetType }}/{{ row.targetLabel }}</q-td>
      </template>

      <template #body-cell-detail="{ value }">
        <q-td class="text-left">
          <span v-if="detailSegments(value).length === 0" class="text-grey-5">—</span>
          <span
            v-for="(segment, index) in detailSegments(value)"
            :key="index"
            class="q-mr-sm"
            :class="`text-${SEGMENT_COLOUR[segment.kind]}`"
          >
            {{ segment.text }}
          </span>
        </q-td>
      </template>

      <template #body-cell-reason="{ value }">
        <q-td class="text-left">{{ value || "—" }}</q-td>
      </template>
    </DataTable>
  </div>
</template>
