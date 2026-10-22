<script>
/** 動作同對象類型嘅中文名：Audit 頁嘅篩選同表格共用。 */
export const SUPPLIER_AUDIT_ACTIONS = Object.freeze({
  "supplier.create": "新增供應商",
  "supplier.update": "編輯供應商",
  "supplier.code.change": "修改供應商編號",
  "supplier.activate": "啟用",
  "supplier.suspend": "暫停",
  "supplier.reactivate": "重新啟用",
  "supplier.block": "封鎖",
  "supplier.unblock": "解除封鎖",
  "supplier.archive": "封存",
  "supplier.restore": "還原",
  "supplier.delete": "永久刪除",
  "supplier.address.create": "新增地址",
  "supplier.address.update": "編輯地址",
  "supplier.address.deactivate": "停用地址",
  "supplier.contact.create": "新增聯絡人",
  "supplier.contact.update": "編輯聯絡人",
  "supplier.contact.deactivate": "停用聯絡人",
  "supplier.identifier.create": "新增識別資料",
  "supplier.identifier.update": "編輯識別資料",
  "supplier.identifier.delete": "刪除識別資料",
  "supplier.bank.create": "新增銀行帳戶",
  "supplier.bank.update": "編輯銀行帳戶",
  "supplier.bank.default": "設為預設銀行帳戶",
  "supplier.bank.deactivate": "停用銀行帳戶",
  "supplier.bank.reveal": "查看完整帳號",
  "supplier_sku.create": "新增供貨關係",
  "supplier_sku.update": "編輯供貨關係",
  "supplier_sku.supply": "記錄供貨",
  "approval.submit": "提交審批",
  "approval.approve": "批准",
  "approval.reject": "拒絕",
  "approval.reassign": "改派審批人",
  "approval.withdraw": "撤回審批",
  "approval.invalidate": "審批申請失效",
  "setting.update": "更新設定",
  "import.upload": "上載匯入檔",
  "import.precheck": "預檢匯入",
  "import.confirm": "確認匯入",
  "import.cancel": "取消匯入",
  "import.expire": "匯入結果過期",
  "supplier.export": "匯出供應商"
});

export const SUPPLIER_AUDIT_TARGET_TYPES = Object.freeze({
  supplier: "供應商",
  address: "地址",
  contact: "聯絡人",
  identifier: "識別資料",
  bank: "銀行帳戶",
  supplier_sku: "供貨關係",
  approval: "審批",
  setting: "設定",
  import: "匯入",
  export: "匯出"
});
</script>

<script setup>
import { ref } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import supplierAuditService from "@/services/supplierAudit.js";

/**
 * Supplier 變更紀錄表（設計 §7.4 `SupplierAuditTimeline`；DEF-035、HD-125 A）。Audit 頁傳篩選，詳情頁嘅 Audit tab
 * 只傳 `supplierId`。時間一律用香港時間；detail 由後端遮罩（銀行帳號只有尾四位），呢度唔會再加料。
 */
const props = defineProps({
  supplierId: { type: Number, default: null },
  filters: { type: Object, default: () => ({}) }
});

const columns = [
  { name: "occurredAt", label: "時間", field: "occurredAt", align: "left" },
  { name: "actorUsername", label: "操作者", field: "actorUsername", align: "left" },
  { name: "action", label: "動作", field: "action", align: "left" },
  { name: "target", label: "對象", field: "targetLabel", align: "left" },
  { name: "detail", label: "內容", field: "detail", align: "left" },
  { name: "reason", label: "原因", field: "reason", align: "left" },
  { name: "requestId", label: "Request ID", field: "requestId", align: "left" }
];

const table = ref(null);

function fetchLogs({ page, rowsPerPage }) {
  return supplierAuditService.list({ page, rowsPerPage, ...props.filters, supplierId: props.supplierId ?? props.filters.supplierId });
}

function formatTime(value) {
  return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" });
}

const shown = (value) => (value === null || value === undefined || value === "" ? "（空）"
  : typeof value === "object" ? JSON.stringify(value) : String(value));

/** `{ before, after }` 逐個欄位講「前 → 後」；其餘欄位照原樣列出。 */
function detailLines(detail) {
  if (!detail) return [];
  if (detail.truncated) return ["內容過長，已截斷"];
  const before = detail.before && typeof detail.before === "object" ? detail.before : {};
  const after = detail.after && typeof detail.after === "object" ? detail.after : {};
  const lines = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map((key) => `${key}：${shown(before[key])} → ${shown(after[key])}`);
  for (const [key, value] of Object.entries(detail)) {
    if (key !== "before" && key !== "after") lines.push(`${key}：${shown(value)}`);
  }
  return lines;
}

defineExpose({ reload: () => table.value?.reload() });
</script>

<template>
  <DataTable ref="table" :fetch="fetchLogs" :columns="columns" row-key="id">
    <template #body-cell-occurredAt="{ value }"><q-td class="text-left">{{ formatTime(value) }}</q-td></template>
    <template #body-cell-actorUsername="{ value }"><EllipsisCell :text="value || '—'" max-width="160px" /></template>
    <template #body-cell-action="{ value }"><q-td class="text-left">{{ SUPPLIER_AUDIT_ACTIONS[value] ?? value }}</q-td></template>
    <template #body-cell-target="{ row }">
      <EllipsisCell :text="`${SUPPLIER_AUDIT_TARGET_TYPES[row.targetType] ?? row.targetType}／${row.targetLabel || '—'}`" max-width="220px" />
    </template>
    <template #body-cell-detail="{ value }">
      <q-td class="text-left">
        <span v-if="detailLines(value).length === 0" class="text-grey-7">—</span>
        <div v-for="(line, index) in detailLines(value)" :key="index" class="text-caption">{{ line }}</div>
      </q-td>
    </template>
    <template #body-cell-reason="{ value }"><EllipsisCell :text="value || '—'" :tooltip="value || null" max-width="200px" /></template>
    <template #body-cell-requestId="{ value }"><EllipsisCell :text="value || '—'" max-width="140px" /></template>
  </DataTable>
</template>
