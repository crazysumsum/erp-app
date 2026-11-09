<script>
export const page = { name: "purchase-order-detail", path: "/purchasing/purchase-orders/:id", title: "採購單詳情", requires: { permissions: ["purchasing.view"] } };
</script>
<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
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

const router = useRouter(), session = useSessionStore(), copying = ref(false), withdrawing = ref(false);
const copyCommand = useCommandEvent(), withdrawCommand = useCommandEvent();
let withdrawReason = "";
const { document, loading, error, load } = usePurchaseOrder({ onLoad: () => { copyCommand.reset(); withdrawCommand.reset(); } });

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
  const { id, number } = document.value;
  copying.value = true;
  try {
    const result = await copyCommand.run({}, (body) => purchasing.copyPurchaseOrder(id, body));
    notifySuccess(`已由 ${number} 複製為 ${result.number}。`);
    result.warnings.forEach((warning) => notifyWarning(warningText(warning)));
    await router.push(`/purchasing/purchase-orders/${result.id}`);
  } catch (failure) {
    if (!copyCommand.uncertain.value) notifyError(failure.message || "複製失敗");
  } finally {
    copying.value = false;
  }
}
async function withdraw() {
  withdrawing.value = true;
  try {
    const result = await withdrawCommand.run({ version: document.value.version, reason: withdrawReason }, (body) => purchasing.withdrawPurchaseOrderApproval(document.value.id, body));
    notifySuccess(`${result.number} 已撤回審批，回到草稿。`);
    await load({ keep: true });
  } catch (failure) {
    if (!withdrawCommand.uncertain.value) notifyError(failure.message || "撤回失敗");
  } finally {
    withdrawing.value = false;
  }
}
async function askWithdraw() {
  const reason = await promptReason({ title: "撤回審批", message: `撤回 ${document.value.number} 的審批？採購單會回到草稿，需要重新提交。`, okLabel: "撤回" });
  if (reason === null) return;
  withdrawReason = reason.trim();
  await withdraw();
}
async function decided({ action, result }) {
  notifySuccess(action === "approve" ? `${result.number} 已批准並確認。` : `${result.number} 已拒絕，回到草稿。`);
  await load({ keep: true });
}
async function askCopy() {
  if (await confirm({ title: "複製採購單", message: `以 ${document.value.number} 建立新草稿？會佔用一個新編號，並按目前主資料重新驗證。`, okLabel: "複製" })) await copy();
}
</script>

<template>
  <div>
    <PageHeader :title="document?.number ?? '採購單詳情'" subtitle="交易快照不因主資料變更而改變；目前主資料另區顯示。" />
    <div class="q-px-md q-pb-md">
      <q-skeleton v-if="loading" type="rect" aria-label="載入採購單" />
      <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load()" /><q-btn flat label="返回採購單列表" to="/purchasing/purchase-orders" /></template></q-banner>
      <template v-else-if="document">
        <q-banner v-if="copyCommand.uncertain.value" role="status" class="bg-warning text-dark q-mb-md">複製結果尚未確認；請重試同一操作以確認結果，不會重複建立。<template #action><q-btn flat label="重試確認結果" :loading="copying" @click="copy" /></template></q-banner>
        <q-banner v-if="withdrawCommand.uncertain.value" role="status" class="bg-warning text-dark q-mb-md">撤回結果尚未確認；請重試同一操作以確認結果。<template #action><q-btn flat label="重試確認結果" :loading="withdrawing" @click="withdraw" /></template></q-banner>
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="statusColors[document.status]" :label="statusLabels[document.status]" />
          <span>版本 {{ document.version }}</span>
          <q-btn v-if="actions.includes('edit')" label="編輯草稿" :to="`/purchasing/purchase-orders/${document.id}/edit`" />
          <q-btn v-if="actions.includes('withdraw')" label="撤回審批" :loading="withdrawing" :disable="withdrawCommand.uncertain.value" @click="askWithdraw" />
          <q-btn v-if="actions.includes('copy')" label="複製" :loading="copying" :disable="copyCommand.uncertain.value" @click="askCopy" />
          <q-btn v-if="printKind(document.status)" label="列印" :to="`/purchasing/purchase-orders/${document.id}/print`" />
          <q-btn flat label="返回採購單列表" to="/purchasing/purchase-orders" />
        </div>
        <ApprovalSnapshotPanel v-if="document.approval" :key="document.approval.id" :approval="document.approval" :purchase-order-id="document.id" :version="document.version"
          :actions="actions.filter((action) => DECISIONS.includes(action))" @decided="decided" @reload="load({ keep: true })" />
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
