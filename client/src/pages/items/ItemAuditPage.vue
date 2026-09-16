<script>
export const page = {
  name: "itemAudit",
  path: "/items/audit",
  title: "商品變更紀錄",
  requires: { permissions: ["item.view", "item.mgmt"], match: "any" },
  menu: { group: "items", icon: "history", order: 70 }
};
</script>

<script setup>
import { computed, ref } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import itemAuditService from "@/services/itemAudit.js";

const ACTION_LABELS = {
  "category.create": "新增分類",
  "category.update": "編輯分類",
  "category.status": "更新分類狀態",
  "category.delete": "刪除分類",
  "brand.create": "新增品牌",
  "brand.update": "編輯品牌",
  "brand.status": "更新品牌狀態",
  "brand.delete": "刪除品牌",
  "uom.create": "新增計量單位",
  "uom.update": "編輯計量單位",
  "uom.status": "更新計量單位狀態",
  "uom.delete": "刪除計量單位",
  "attribute.create": "新增商品屬性",
  "attribute.update": "編輯商品屬性",
  "attribute.status": "更新商品屬性狀態",
  "attribute.delete": "刪除商品屬性",
  "category.attributes.assign": "指派分類屬性",
  "item.create": "新增商品",
  "item.update": "編輯商品",
  "item.activate": "啟用商品",
  "item.deactivate": "停用商品",
  "item.discontinue": "停產商品",
  "item.archive": "封存商品",
  "item.restore": "恢復商品",
  "item.delete": "刪除商品",
  "item.copy": "複製商品",
  "sku.create": "新增 SKU",
  "sku.update": "編輯 SKU",
  "sku.activate": "啟用 SKU",
  "sku.deactivate": "停用 SKU",
  "sku.discontinue": "停產 SKU",
  "sku.archive": "封存 SKU",
  "sku.restore": "恢復 SKU",
  "sku.delete": "刪除 SKU",
  "sku.code.change": "修改 SKU 編號",
  "barcode.release": "釋放條碼",
  "media.upload": "上載媒體",
  "media.update": "更新媒體",
  "media.delete": "刪除媒體",
  "item.import": "確認商品匯入",
  "item.export": "匯出商品"
};

const ACTION_FILTER_OPTIONS = [
  { label: "全部", value: null },
  ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ label, value }))
];
const TARGET_TYPE_OPTIONS = [
  { label: "全部", value: null },
  { label: "商品", value: "item" },
  { label: "SKU", value: "sku" },
  { label: "分類", value: "category" },
  { label: "品牌", value: "brand" },
  { label: "計量單位", value: "uom" },
  { label: "商品屬性", value: "attribute" },
  { label: "媒體", value: "media" },
  { label: "匯入工作", value: "import" },
  { label: "匯出工作", value: "export" }
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
const targetTypeFilter = ref(null);

const fromMs = computed(() =>
  fromDate.value ? new Date(`${fromDate.value}T00:00:00`).getTime() : undefined
);
const toMs = computed(() =>
  toDate.value ? new Date(`${toDate.value}T23:59:59.999`).getTime() : undefined
);

function fetchAuditLogs({ page, rowsPerPage }) {
  return itemAuditService.list({
    page,
    rowsPerPage,
    from: fromMs.value,
    to: toMs.value,
    actor: actorFilter.value,
    target: targetFilter.value,
    action: actionFilter.value,
    targetType: targetTypeFilter.value
  });
}

function reload() {
  tableRef.value?.reload();
}

function formatTime(epochMs) {
  return new Date(epochMs).toLocaleString();
}

function detailSegments(detail) {
  if (!detail) return [];
  if (detail.truncated) return [{ kind: "note", text: "內容過長，已截斷" }];

  const segments = [];
  for (const [key, value] of Object.entries(detail)) {
    if (key === "added" && Array.isArray(value)) {
      for (const assignment of value) segments.push({ kind: "add", text: `+${formatAssignment(assignment)}` });
      continue;
    }
    if (key === "removed" && Array.isArray(value)) {
      for (const assignment of value) segments.push({ kind: "remove", text: `−${formatAssignment(assignment)}` });
      continue;
    }
    if (key === "updated" && Array.isArray(value)) {
      for (const change of value) {
        segments.push(
          typeof change === "number"
            ? { kind: "change", text: `屬性 #${change} 已更新；舊紀錄未保存欄位差異` }
            : { kind: "change", text: formatAssignmentChange(change.before, change.after) }
        );
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) segments.push({ kind: "add", text: `+${item}` });
      continue;
    }

    if (value && typeof value === "object" && ("before" in value || "after" in value)) {
      if (Array.isArray(value.before) || Array.isArray(value.after)) {
        const beforeList = value.before ?? [];
        const afterList = value.after ?? [];
        for (const item of afterList.filter((item) => !beforeList.includes(item))) {
          segments.push({ kind: "add", text: `+${item}` });
        }
        for (const item of beforeList.filter((item) => !afterList.includes(item))) {
          segments.push({ kind: "remove", text: `−${item}` });
        }
        continue;
      }

      const beforeText = value.before === "" || value.before == null ? "（空）" : String(value.before);
      const afterText = value.after === "" || value.after == null ? "（空）" : String(value.after);
      segments.push({ kind: "change", text: `${key}：${beforeText} → ${afterText}` });
      continue;
    }

    segments.push({ kind: "note", text: `${key}：${JSON.stringify(value)}` });
  }
  return segments;
}

function formatAssignment(assignment) {
  if (typeof assignment === "number") return `屬性 #${assignment}`;
  return `屬性 #${assignment.attributeId}（必填：${assignment.requiredForActivation ? "是" : "否"}，排序：${assignment.sortOrder}）`;
}

function formatAssignmentChange(before, after) {
  return `屬性 #${after.attributeId}：必填：${before.requiredForActivation ? "是" : "否"} → ${after.requiredForActivation ? "是" : "否"}；排序：${before.sortOrder} → ${after.sortOrder}`;
}

const SEGMENT_COLOUR = { add: "positive", remove: "negative", change: "grey-8", note: "grey-7" };
</script>

<template>
  <div>
    <PageHeader />

    <div class="row items-center q-gutter-md q-px-md q-pb-md">
      <q-input v-model="fromDate" dense outlined type="date" label="從" style="width: 160px" @update:model-value="reload" />
      <q-input v-model="toDate" dense outlined type="date" label="到" style="width: 160px" @update:model-value="reload" />
      <q-input v-model="actorFilter" dense outlined clearable debounce="300" label="操作者" style="width: 160px" @update:model-value="reload" />
      <q-input v-model="targetFilter" dense outlined clearable debounce="300" label="對象" style="width: 160px" @update:model-value="reload" />
      <q-select v-model="actionFilter" dense outlined emit-value map-options :options="ACTION_FILTER_OPTIONS" label="動作" style="width: 180px" @update:model-value="reload" />
      <q-select v-model="targetTypeFilter" dense outlined emit-value map-options :options="TARGET_TYPE_OPTIONS" label="對象類型" style="width: 160px" @update:model-value="reload" />
    </div>

    <div class="q-px-md q-pb-md">
      <DataTable :ref="(el) => (tableRef = el)" :fetch="fetchAuditLogs" :columns="columns" row-key="id">
        <template #body-cell-occurredAt="{ value }">
          <q-td class="text-left">{{ formatTime(value) }}</q-td>
        </template>
        <template #body-cell-actorUsername="{ value }">
          <q-td class="text-left">{{ value }}</q-td>
        </template>
        <template #body-cell-action="{ value }">
          <q-td class="text-left">{{ ACTION_LABELS[value] ?? value }}</q-td>
        </template>
        <template #body-cell-target="{ row }">
          <EllipsisCell :text="`${row.targetType}/${row.targetLabel}`" max-width="200px" />
        </template>
        <template #body-cell-detail="{ value }">
          <q-td class="text-left">
            <span v-if="detailSegments(value).length === 0" class="text-grey-5">—</span>
            <span v-for="(segment, index) in detailSegments(value)" :key="index" class="q-mr-sm" :class="`text-${SEGMENT_COLOUR[segment.kind]}`">
              {{ segment.text }}
            </span>
          </q-td>
        </template>
        <template #body-cell-reason="{ value }">
          <EllipsisCell :text="value || '—'" :tooltip="value || null" max-width="200px" />
        </template>
      </DataTable>
    </div>
  </div>
</template>
