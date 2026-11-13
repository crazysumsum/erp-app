<script setup>
import { computed, ref, watch } from "vue";
import appConfig from "@config/app.js";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { addressText, timestamp } from "./purchaseOrderPresentation.js";

/**
 * §7.4：顯示提交當刻嘅固定快照，唔用目前 PO 資料代替；assigned approver 喺度批准／拒絕。
 * 只負責顯示同收輸入：record、單一 in-flight 同結果由詳情頁（穩定 owner）擁有，所以 panel 因 loading／error 卸載重建都唔會清走或者重發決定。
 * 密碼送出即清；原因保留（P2-T03）。未確定期間原因用原 payload、唔准改，只准重試同一動作，相反動作鎖住。
 */
const props = defineProps({ approval: { type: Object, required: true }, actions: { type: Array, default: () => [] },
  uncertainAction: { type: String, default: null }, pendingReason: { type: String, default: "" }, busy: { type: Boolean, default: false },
  errorMessage: { type: String, default: "" }, stale: { type: Boolean, default: false } });
const emit = defineEmits(["decide", "reload"]);

const WARNINGS = Object.freeze({ ZERO_PRICE: "有零價明細", NO_PAYMENT_TERM: "未選擇付款條款" });
// 重建後顯示返原本提交、重試會再送嘅原因。
const reason = ref(props.pendingReason), password = ref(""), localError = ref(""), clicked = ref(null);
watch(() => props.pendingReason, (value) => { if (props.uncertainAction) reason.value = value; });
const message = computed(() => localError.value || props.errorMessage);
const snapshot = computed(() => props.approval.snapshot);
const canDecide = computed(() => props.actions.includes("approve") || props.actions.includes("reject"));
const reasonError = (required) => {
  const length = reason.value.trim().length;
  if (!length) return required ? "拒絕必須填寫原因" : "";
  return length < 5 || length > 500 ? "原因須為 5–500 字" : "";
};
const overview = computed(() => {
  const value = snapshot.value;
  return [
    ["供應商", `${value.supplier.code} — ${value.supplier.name}`], ["訂購地址", addressText(value.orderingAddress)],
    ["貨幣", `${value.currency.code} — ${value.currency.name}`], ["付款條款", value.paymentTerm ? `${value.paymentTerm.code} — ${value.paymentTerm.name}` : "未設定"],
    ["訂單日期", value.orderDate], ["預計交貨日", value.expectedDeliveryDate || "未設定"], ["預設收貨倉", value.defaultWarehouseCode || "未設定"],
    ["採購員", value.buyerLabel || "未設定"], ["供應商參考", value.supplierReference || "—"], ["小計／總額", `${value.currency.code} ${value.subtotalAmount}／${value.totalAmount}`],
    ["提交人", `${props.approval.requestedByLabel}，${timestamp(props.approval.requestedAt)}`], ["審批人", props.approval.approverLabel], ["提交備註", props.approval.requestNote || "—"]
  ];
});
const columns = [
  { name: "lineNumber", label: "行", field: "lineNumber", align: "left" },
  { name: "sku", label: "SKU", field: "skuName", align: "left" },
  { name: "ordered", label: "訂購", field: "orderedQuantity", align: "right" },
  { name: "base", label: "數量（Base）", field: "orderedBaseQuantity", align: "right" },
  { name: "unitPrice", label: "單價", field: "unitPrice", align: "right" },
  { name: "lineAmount", label: "明細總額", field: "lineAmount", align: "right" },
  { name: "expectedDeliveryDate", label: "預計交貨", field: "expectedDeliveryDate", align: "left" },
  { name: "lineNote", label: "備註", field: "lineNote", align: "left" }
];

function decide(action) {
  if (props.busy || (props.uncertainAction && props.uncertainAction !== action)) return;
  localError.value = reasonError(action === "reject") || (password.value ? "" : "請輸入密碼");
  if (localError.value) return;
  clicked.value = action;
  emit("decide", { action, reason: reason.value.trim(), password: password.value });
  password.value = "";
}
</script>

<template>
  <q-card flat bordered class="q-mb-md" data-testid="po-approval-snapshot">
    <q-card-section>
      <h2 class="text-h6 q-ma-none q-mb-sm">審批快照</h2>
      <p class="text-caption">以下為 {{ snapshot.number }} 提交時的固定內容（版本 {{ approval.purchaseOrderVersion }}），不因之後的主資料變更而改變。</p>
      <ul v-if="snapshot.warnings.length" class="q-my-sm q-pl-md">
        <li v-for="warning in snapshot.warnings" :key="warning"><q-icon name="warning" aria-hidden="true" /> {{ WARNINGS[warning] ?? warning }}</li>
      </ul>
      <dl class="row q-col-gutter-md q-my-none break-word">
        <div v-for="[label, value] in overview" :key="label" class="col-12 col-md-6"><dt class="text-caption text-grey-7">{{ label }}</dt><dd class="q-ml-none">{{ value }}</dd></div>
        <div class="col-12"><dt class="text-caption text-grey-7">備註</dt><dd class="q-ml-none pre-line">{{ snapshot.notes || "—" }}</dd></div>
      </dl>
    </q-card-section>
    <DataTable :rows="snapshot.lines" :columns="columns" row-key="lineNumber" :initial-pagination="{ page: 1, rowsPerPage: appConfig.defaultPageSize, sortBy: null, descending: false }">
      <template #body-cell-sku="{ row }"><EllipsisCell :text="`${row.skuCode} — ${row.skuName}`" max-width="160px" /></template>
      <template #body-cell-ordered="{ row }"><q-td class="text-right">{{ row.orderedQuantity }} {{ row.purchaseUomCode }}</q-td></template>
      <template #body-cell-base="{ row }"><q-td class="text-right">{{ row.orderedBaseQuantity }} {{ row.baseUomCode }}</q-td></template>
      <template #body-cell-unitPrice="{ row }"><q-td class="text-right">{{ row.unitPrice }}<div v-if="row.zeroPriceReason" class="text-caption break-word">零價：{{ row.zeroPriceReason }}</div></q-td></template>
      <template #body-cell-expectedDeliveryDate="{ row }"><q-td>{{ row.expectedDeliveryDate || "未設定" }}</q-td></template>
      <template #body-cell-lineNote="{ row }"><EllipsisCell :text="row.lineNote" /></template>
    </DataTable>
    <q-card-section v-if="canDecide">
      <h2 class="text-h6 q-ma-none q-mb-sm">審批決定</h2>
      <q-banner v-if="message" role="alert" class="bg-negative text-white q-mb-sm">{{ message }}<template v-if="stale && !localError" #action><q-btn flat label="重新載入" @click="emit('reload')" /></template></q-banner>
      <q-input v-model="reason" label="原因（批准選填，拒絕必填）" type="textarea" autogrow maxlength="500" counter :readonly="!!uncertainAction || busy" outlined dense />
      <q-input v-model="password" label="密碼 *" type="password" autocomplete="current-password" class="q-mt-sm" outlined dense />
      <div class="row q-gutter-sm q-mt-sm">
        <q-btn v-if="actions.includes('approve')" color="primary" label="批准" :loading="busy && clicked === 'approve'" :disable="busy || (!!uncertainAction && uncertainAction !== 'approve')" @click="decide('approve')" />
        <q-btn v-if="actions.includes('reject')" outline color="negative" label="拒絕" :loading="busy && clicked === 'reject'" :disable="busy || (!!uncertainAction && uncertainAction !== 'reject')" @click="decide('reject')" />
      </div>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.pre-line { white-space: pre-line; }
.break-word { overflow-wrap: anywhere; }
dd { margin: 0; }
</style>
