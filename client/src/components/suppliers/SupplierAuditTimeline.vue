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
import DataTable from "@/framework/ui/DataTable.vue";
import supplierAuditService from "@/services/supplierAudit.js";

/**
 * Supplier 變更紀錄表（設計 §7.4 `SupplierAuditTimeline`；DEF-035、HD-125 A）。Audit 頁傳篩選同頁數，詳情頁嘅 Audit tab
 * 只傳 `supplierId`。篩選一改，頁面會用 `key` 重新掛載呢個元件，由第 1 頁再查（REV-113 L-4）。時間一律用香港時間；
 * detail 由後端遮罩（銀行帳號只有尾四位），呢度唔會再加料。
 */
const props = defineProps({
  supplierId: { type: Number, default: null },
  filters: { type: Object, default: () => ({}) },
  initialPagination: { type: Object, default: null }
});
const emit = defineEmits(["request"]);

// Request ID 放喺內容之前、完整顯示：UAT-055 要每行都睇到，唔可以收埋喺捲軸後面或者 tooltip 入面（REV-113 M-1）。
const columns = [
  { name: "occurredAt", label: "時間", field: "occurredAt", align: "left" },
  { name: "actorUsername", label: "操作者", field: "actorUsername", align: "left" },
  { name: "action", label: "動作", field: "action", align: "left" },
  { name: "target", label: "對象", field: "targetLabel", align: "left" },
  { name: "requestId", label: "Request ID", field: "requestId", align: "left" },
  { name: "reason", label: "原因", field: "reason", align: "left" },
  { name: "detail", label: "內容", field: "detail", align: "left" }
];

function fetchLogs({ page, rowsPerPage }) {
  emit("request", { page, rowsPerPage });
  return supplierAuditService.list({ page, rowsPerPage, ...props.filters, supplierId: props.supplierId ?? props.filters.supplierId });
}

function formatTime(value) {
  return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" });
}

const empty = (value) => value === null || value === undefined || value === "";
/** 長文字（notes）只記 `{ changed, length, sha256 }`（HD-112 A）：講長度，唔印 hash。 */
const isDigest = (value) => Boolean(value) && typeof value === "object" && "sha256" in value && "length" in value;
/** 太長嘅陣列由後端摘要成 `{ count, sample, truncated }`（SupplierAuditLogService.boundedDetail）。 */
const isSummary = (value) => Boolean(value) && typeof value === "object" && value.truncated === true && "count" in value;

function shown(value) {
  if (empty(value)) return "（空）";
  if (isDigest(value)) return `已修改（${value.length} 字）`;
  if (isSummary(value)) return `共 ${value.count} 項，只列頭 ${value.sample?.length ?? 0} 項：${JSON.stringify(value.sample ?? [])}`;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** `{ before, after }` 逐個欄位講「前 → 後」，兩邊都空就唔列（REV-113 L-2）；其餘欄位照列。 */
function detailLines(detail) {
  if (!detail) return [];
  const before = detail.before && typeof detail.before === "object" ? detail.before : {};
  const after = detail.after && typeof detail.after === "object" ? detail.after : {};
  const lines = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !(empty(before[key]) && empty(after[key])))
    .map((key) => (isDigest(after[key]) && empty(before[key]) ? `${key}：${shown(after[key])}` : `${key}：${shown(before[key])} → ${shown(after[key])}`));
  for (const [key, value] of Object.entries(detail)) {
    if (key !== "before" && key !== "after") lines.push(`${key}：${shown(value)}`);
  }
  return lines;
}
</script>

<template>
  <DataTable :fetch="fetchLogs" :columns="columns" row-key="id" :initial-pagination="initialPagination">
    <template #body-cell-occurredAt="{ value }"><q-td class="text-left">{{ formatTime(value) }}</q-td></template>
    <template #body-cell-actorUsername="{ value }"><q-td class="text-left audit-wrap">{{ value || "—" }}</q-td></template>
    <template #body-cell-action="{ value }"><q-td class="text-left">{{ SUPPLIER_AUDIT_ACTIONS[value] ?? value }}</q-td></template>
    <template #body-cell-target="{ row }">
      <q-td class="text-left audit-wrap">{{ SUPPLIER_AUDIT_TARGET_TYPES[row.targetType] ?? row.targetType }}／{{ row.targetLabel || "—" }}</q-td>
    </template>
    <template #body-cell-requestId="{ value }"><q-td class="text-left audit-request-id">{{ value || "—" }}</q-td></template>
    <template #body-cell-reason="{ value }"><q-td class="text-left audit-wrap">{{ value || "—" }}</q-td></template>
    <template #body-cell-detail="{ value }">
      <q-td class="text-left audit-wrap audit-detail">
        <span v-if="detailLines(value).length === 0" class="text-grey-7">—</span>
        <div v-for="(line, index) in detailLines(value)" :key="index" class="text-caption">{{ line }}</div>
      </q-td>
    </template>
  </DataTable>
</template>

<style scoped>
.audit-wrap { white-space: normal; overflow-wrap: anywhere; max-width: 220px; }
.audit-detail { max-width: 420px; min-width: 240px; }
.audit-request-id { font-family: monospace; white-space: nowrap; }
</style>
