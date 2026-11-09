<script>
export const page = { name: "purchase-order-detail", path: "/purchasing/purchase-orders/:id", title: "採購單詳情", requires: { permissions: ["purchasing.view"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import ApprovalSnapshotPanel from "@/components/purchasing/ApprovalSnapshotPanel.vue";
import PurchaseOrderProgress from "@/components/purchasing/PurchaseOrderProgress.vue";
import { addressText, printKind, statusColors, statusLabels, timestamp, warningText } from "@/components/purchasing/purchaseOrderPresentation.js";
import { isZeroPrice } from "@/components/purchasing/purchasingEditorMath.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { usePurchaseOrder } from "@/composables/purchasing/usePurchaseOrder.js";
import { confirm, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess, notifyWarning } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import purchasing from "@/services/purchasing.js";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const copyCommand = useCommandEvent(), withdrawCommand = useCommandEvent(), decisionCommand = useCommandEvent();
let withdrawReason = "";
const { document, loading, error, load } = usePurchaseOrder();
// 呢個頁係 record 嘅穩定 owner（換 PO 時 vue-router 重用佢；panel 會因 loading／error 卸載）。Key 綁 actor、route 上嘅 PO 同目標：
// 同一 context 重新載入唔清走未確定操作；換 PO／actor 唔會用錯原 record，返嚟仍然可以用原 eventId 確認結果。
const poId = computed(() => Number(route.params.id));
const commandKey = (action) => `${session.user?.id}:${poId.value}:${action}`;
// 可見回調只屬於發出嗰次生命週期：真正換 PO、換 actor 或者卸載就作廢；普通同 context GET 唔算離開。
let generation = 0;
const decision = reactive({ key: null, message: "", stale: false });
watch([poId, () => session.user?.id], () => { generation += 1; Object.assign(decision, { key: null, message: "", stale: false }); });
onBeforeUnmount(() => { generation += 1; });

// 審批決定要 purchasing.approval，其餘寫入要 purchasing.mgmt（§6.1 六個權限互不繼承）；server 仍然會再驗。
const DECISIONS = ["approve", "reject"];
const actions = computed(() => (document.value?.allowedActions ?? [])
  .filter((action) => session.permissions.includes(DECISIONS.includes(action) ? "purchasing.approval" : "purchasing.mgmt")));
const sum = (field) => document.value.lines.reduce((total, line) => total + BigInt(line[field]), 0n).toString();
const master = computed(() => document.value?.currentMasterDifferences);
const overview = computed(() => {
  const value = document.value;
  return [
    ["供應商快照", `${value.supplierCode} — ${value.supplierName}`], ["訂購地址快照", addressText(value.orderingAddress)],
    ["貨幣", `${value.currencyCode} — ${value.currencyName}`], ["付款條款快照", value.paymentTerm ? `${value.paymentTerm.code} — ${value.paymentTerm.name}` : "未設定"],
    ["訂單日期", value.orderDate], ["預計交貨日", value.expectedDeliveryDate || "未設定"],
    ["預設收貨倉", value.defaultWarehouseCode || "未設定"], ["採購員", value.buyerLabel || "未設定"],
    ["供應商參考", value.supplierReference || "—"], ["小計／總額", `${value.currencyCode} ${value.subtotalAmount}／${value.totalAmount}`],
    ["建立", `${value.createdByLabel}，${timestamp(value.createdAt)}`], ["最後更新", `${value.updatedByLabel}，${timestamp(value.updatedAt)}`],
    ...(value.confirmedAt ? [["確認時間", timestamp(value.confirmedAt)]] : []), ...(value.closedAt ? [["結案時間", timestamp(value.closedAt)]] : []), ...(value.cancelledAt ? [["取消時間", timestamp(value.cancelledAt)]] : [])
  ];
});
const columns = [
  { name: "lineNumber", label: "行", field: "lineNumber", align: "left" },
  { name: "sku", label: "SKU", field: "skuName", align: "left" },
  { name: "ordered", label: "訂購", field: "orderedQuantity", align: "right" },
  { name: "base", label: "數量（Base）", field: "orderedBaseQuantity", align: "left" },
  { name: "unitPrice", label: "單價", field: "unitPrice", align: "right" },
  { name: "lineAmount", label: "明細總額", field: "lineAmount", align: "right" },
  { name: "expectedDeliveryDate", label: "預計交貨", field: "expectedDeliveryDate", align: "left" },
  { name: "lineNote", label: "備註", field: "lineNote", align: "left" }
];
const BASE_ROWS = [["Ordered", "orderedBaseQuantity"], ["Gross Received", "grossReceivedBaseQuantity"], ["Reversed", "reversedBaseQuantity"], ["Net Received", "netReceivedBaseQuantity"],
  ["Outstanding", "outstandingBaseQuantity"], ["Over-received", "overReceivedBaseQuantity"], ["Closed Remaining", "closedRemainingBaseQuantity"]];

async function copy() {
  const id = poId.value, number = document.value?.number ?? "", key = commandKey("copy"), gen = generation;
  try {
    const result = await copyCommand.run({}, (body) => purchasing.copyPurchaseOrder(id, body), key, { action: "copy" });
    if (gen !== generation) return; // 晚到：已經離開或者換咗 PO／actor
    notifySuccess(`已由 ${number} 複製為 ${result.number}。`);
    result.warnings.forEach((warning) => notifyWarning(warningText(warning)));
    await router.push(`/purchasing/purchase-orders/${result.id}`);
  } catch (failure) {
    if (gen === generation && !copyCommand.isUncertain(key)) notifyError(failure.message || "複製失敗");
  }
}
async function withdraw() {
  const id = poId.value, key = commandKey("withdraw"), gen = generation;
  try {
    const result = await withdrawCommand.run({ version: document.value?.version, reason: withdrawReason }, (body) => purchasing.withdrawPurchaseOrderApproval(id, body), key, { action: "withdraw" });
    if (gen !== generation) return;
    notifySuccess(`${result.number} 已撤回審批，回到草稿。`);
    await load({ keep: true });
  } catch (failure) {
    if (gen === generation && !withdrawCommand.isUncertain(key)) notifyError(failure.message || "撤回失敗");
  }
}
async function askWithdraw() {
  const reason = await promptReason({ title: "撤回審批", message: `撤回 ${document.value.number} 的審批？採購單會回到草稿，需要重新提交。`, okLabel: "撤回" });
  if (reason === null) return;
  withdrawReason = reason.trim();
  await withdraw();
}
// 審批決定：record key 連 approval ID，所以重新提交後嘅新 pending approval 唔會撞到舊決定。
const RELOAD = ["VERSION_CONFLICT", "PO_STATE_CONFLICT", "APPROVAL_ASSIGNEE_MISMATCH", "CONCURRENT_OPERATION"];
const decisionKey = (approvalId) => `${session.user?.id}:${poId.value}:decision:${approvalId}`;
const panelKey = computed(() => (document.value?.approval ? decisionKey(document.value.approval.id) : null));
const panelPending = computed(() => (panelKey.value ? decisionCommand.pending(panelKey.value) : null));
const canDecide = computed(() => ["purchasing.view", "purchasing.approval"].every((permission) => session.permissions.includes(permission)));
// Panel 處理唔到嘅未確定決定（例如決定已 commit 但回應丟失，GET 返嚟 approval 係 null；或者已經冇權）：喺頁面另外顯示，
// 唔當 PO 目前狀態或者他人歷史係原 event 終局。有權就用原 action／目標／body 再輸入密碼重試；冇權只顯示被擋。
const detachedDecisions = computed(() => decisionCommand.uncertainRecords.value.filter(({ meta }) => meta.actorId === session.user?.id && meta.poId === poId.value
  && !(meta.approvalId === document.value?.approval?.id && actions.value.includes(meta.action))));
const replayPasswords = reactive({});
async function sendDecision({ key, meta, payload, password }) {
  const gen = generation, retry = decisionCommand.isUncertain(key);
  const send = meta.action === "approve" ? purchasing.approvePurchaseOrder : purchasing.rejectPurchaseOrder;
  Object.assign(decision, { key, message: "", stale: false });
  try {
    const result = await decisionCommand.run(payload, (body) => send(meta.poId, { ...body, password }), key, meta);
    if (gen !== generation) return;
    Object.assign(decision, { key: null, message: "" });
    notifySuccess(meta.action === "approve" ? `${result.number} 已批准並確認。` : `${result.number} 已拒絕，回到草稿。`);
    await load({ keep: true });
  } catch (failure) {
    if (gen !== generation) return;
    const uncertain = decisionCommand.isUncertain(key);
    decision.stale = !uncertain && RELOAD.includes(failure.code);
    decision.message = uncertain ? `${retry && failure.message ? `${failure.message}。` : ""}結果尚未確認；請再輸入密碼，重試同一操作以確認結果。` : failure.message || "操作失敗";
  }
}
function decide({ action, reason, password }) {
  const { approval, version, number } = document.value;
  return sendDecision({ key: panelKey.value, meta: { action, approvalId: approval.id, poId: poId.value, actorId: session.user?.id, number },
    payload: { version, ...(reason ? { reason } : {}) }, password });
}
function replay(record) {
  const password = replayPasswords[record.key] ?? "";
  replayPasswords[record.key] = "";
  return sendDecision({ ...record, password });
}
async function askCopy() {
  if (await confirm({ title: "複製採購單", message: `以 ${document.value.number} 建立新草稿？會佔用一個新編號，並按目前主資料重新驗證。`, okLabel: "複製" })) await copy();
}
</script>

<template>
  <div>
    <PageHeader :title="document?.number ?? '採購單詳情'" subtitle="交易快照不因主資料變更而改變；目前主資料另區顯示。" />
    <div class="q-px-md q-pb-md">
      <q-banner v-for="record in detachedDecisions" :key="record.key" role="status" class="bg-warning text-dark q-mb-md" data-testid="po-detached-decision">
        {{ record.meta.number }} 的{{ record.meta.action === "approve" ? "批准" : "拒絕" }}結果尚未確認；目前畫面不能當作原操作的結果。
        <template v-if="decision.key === record.key && decision.message"><br>{{ decision.message }}</template>
        <template v-if="canDecide">
          <q-input v-model="replayPasswords[record.key]" label="確認用密碼" type="password" autocomplete="current-password" class="q-mt-sm" outlined dense />
          <q-btn class="q-mt-sm" :label="`以原內容重試${record.meta.action === 'approve' ? '批准' : '拒絕'}`" :loading="decisionCommand.isBusy(record.key)" :disable="!replayPasswords[record.key]" @click="replay(record)" />
        </template>
        <template v-else><br>你目前沒有審批權限，未能重試確認；請聯絡管理員。</template>
      </q-banner>
      <q-skeleton v-if="loading" type="rect" aria-label="載入採購單" />
      <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load()" /><q-btn flat label="返回採購單列表" to="/purchasing/purchase-orders" /></template></q-banner>
      <template v-else-if="document">
        <q-banner v-if="copyCommand.isUncertain(commandKey('copy'))" role="status" class="bg-warning text-dark q-mb-md">複製結果尚未確認；請重試同一操作以確認結果，不會重複建立。<template #action><q-btn flat label="重試確認結果" :loading="copyCommand.isBusy(commandKey('copy'))" @click="copy" /></template></q-banner>
        <q-banner v-if="withdrawCommand.isUncertain(commandKey('withdraw'))" role="status" class="bg-warning text-dark q-mb-md">撤回結果尚未確認；請重試同一操作以確認結果。<template #action><q-btn flat label="重試確認結果" :loading="withdrawCommand.isBusy(commandKey('withdraw'))" @click="withdraw" /></template></q-banner>
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="statusColors[document.status]" :label="statusLabels[document.status]" />
          <span>版本 {{ document.version }}</span>
          <q-btn v-if="actions.includes('edit')" label="編輯草稿" :to="`/purchasing/purchase-orders/${document.id}/edit`" />
          <q-btn v-if="actions.includes('withdraw')" label="撤回審批" :loading="withdrawCommand.isBusy(commandKey('withdraw'))" :disable="withdrawCommand.isUncertain(commandKey('withdraw'))" @click="askWithdraw" />
          <q-btn v-if="actions.includes('copy')" label="複製" :loading="copyCommand.isBusy(commandKey('copy'))" :disable="copyCommand.isUncertain(commandKey('copy'))" @click="askCopy" />
          <q-btn v-if="printKind(document.status)" label="列印" :to="`/purchasing/purchase-orders/${document.id}/print`" />
          <q-btn flat label="返回採購單列表" to="/purchasing/purchase-orders" />
        </div>
        <ApprovalSnapshotPanel v-if="document.approval" :key="document.approval.id" :approval="document.approval" :actions="actions.filter((action) => DECISIONS.includes(action))"
          :uncertain-action="panelPending?.meta.action ?? null" :pending-reason="panelPending?.payload.reason ?? ''" :busy="decisionCommand.isBusy(panelKey)"
          :error-message="decision.key === panelKey ? decision.message : ''" :stale="decision.key === panelKey && decision.stale" @decide="decide" @reload="load({ keep: true })" />
        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <h2 class="text-h6 q-ma-none q-mb-md">概覽</h2>
            <dl class="row q-col-gutter-md q-my-none break-word">
              <div v-for="[label, value] in overview" :key="label" class="col-12 col-md-6"><dt class="text-caption text-grey-7">{{ label }}</dt><dd class="q-ml-none">{{ value }}</dd></div>
              <div class="col-12 col-md-6"><dt class="text-caption text-grey-7">已收／訂購（Base）</dt><dd class="q-ml-none"><PurchaseOrderProgress :received="sum('netReceivedBaseQuantity')" :ordered="sum('orderedBaseQuantity')" /></dd></div>
              <div class="col-12"><dt class="text-caption text-grey-7">備註</dt><dd class="q-ml-none pre-line">{{ document.notes || "—" }}</dd></div>
            </dl>
          </q-card-section>
        </q-card>
        <h2 class="text-h6 q-ma-none q-mb-md">明細</h2>
        <DataTable :rows="document.lines" :columns="columns" :initial-pagination="{ page: 1, rowsPerPage: appConfig.defaultPageSize, sortBy: null, descending: false }">
          <template #body-cell-sku="{ row }"><EllipsisCell :text="`${row.skuCode} — ${row.skuName}`" max-width="160px" /></template>
          <template #body-cell-ordered="{ row }"><q-td class="text-right">{{ row.orderedQuantity }} {{ row.purchaseUomCode }}</q-td></template>
          <template #body-cell-unitPrice="{ row }">
            <q-td class="text-right">{{ row.unitPrice }}<div v-if="isZeroPrice(row.unitPrice)" class="text-caption break-word"><q-icon name="money_off" aria-hidden="true" /> 零價：{{ row.zeroPriceReason }}</div></q-td>
          </template>
          <template #body-cell-base="{ row }">
            <q-td>
              <div v-for="[label, field] in BASE_ROWS" :key="field">{{ label }} {{ row[field] }} {{ row.baseUomCode }}</div>
              <div v-if="row.overReceivedBaseQuantity !== '0'" class="text-caption"><q-icon name="warning" aria-hidden="true" /> 超收</div>
            </q-td>
          </template>
          <template #body-cell-expectedDeliveryDate="{ row }"><q-td>{{ row.expectedDeliveryDate || "未設定" }}</q-td></template>
          <template #body-cell-lineNote="{ row }"><EllipsisCell :text="row.lineNote" /></template>
        </DataTable>
        <q-card v-if="master.supplier || master.lines.length" flat bordered class="q-mt-md" data-testid="po-current-master">
          <q-card-section>
            <h2 class="text-h6 q-ma-none q-mb-md">目前主資料</h2>
            <p>以下目前值與交易快照不同，只供參考，不改寫上方快照。</p>
            <p v-if="master.supplier" class="break-word">供應商：{{ master.supplier.supplierCode }} — {{ master.supplier.supplierName }}（{{ master.supplier.status }}）</p>
            <ul v-if="master.lines.length" class="q-my-none">
              <li v-for="line in master.lines" :key="line.lineId" class="break-word">{{ line.skuCode }} — {{ line.skuName }}（SKU {{ line.skuStatus }}；Item {{ line.itemStatus }}）</li>
            </ul>
          </q-card-section>
        </q-card>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pre-line { white-space: pre-line; }
.break-word { overflow-wrap: anywhere; }
</style>
