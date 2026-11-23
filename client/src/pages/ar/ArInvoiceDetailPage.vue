<script>
export const page = { name: "ar-invoice-detail", path: "/ar/invoices/:id", title: "發票詳情", requires: { permissions: ["ar.view"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { allocationStatusLabels, invoiceOutstandingText, invoiceStatusLabels, money, quantityText, statusColors, timestamp } from "@/components/ar/arPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { confirm, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ar from "@/services/ar.js";

const route = useRoute(), session = useSessionStore();
const command = useCommandEvent();
const invoice = ref(null), loading = ref(false), error = ref("");
const invoiceId = computed(() => String(route.params.id));
let controller;
async function load({ keep = false } = {}) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller, id = invoiceId.value;
  error.value = "";
  if (!keep) { invoice.value = null; loading.value = true; }
  // route param 會 decode：唔係正整數就唔砌入 API path。
  if (!/^[1-9]\d*$/u.test(id)) { error.value = "找不到這張發票。"; loading.value = false; return; }
  try {
    const value = await ar.getInvoice(id, { signal });
    if (!signal.aborted) invoice.value = value;
  } catch (failure) {
    if (!signal.aborted) error.value = failure.message || "載入發票失敗";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch([invoiceId, () => session.user?.id, () => session.permissions.join("|")], () => load(), { immediate: true });
// 換發票、換用戶或者卸載之後，晚到嘅命令結果唔再郁畫面。
let generation = 0;
watch([invoiceId, () => session.user?.id], () => { generation += 1; });
onBeforeUnmount(() => { generation += 1; controller?.abort(); });

// allowedActions 只係提示（server 已按 ar.invoice.mgmt 過濾）；命令 server 會再驗。
const canViewShipments = computed(() => session.permissions.includes("fulfillment.view"));
const actions = computed(() => (session.permissions.includes("ar.invoice.mgmt") ? invoice.value?.allowedActions ?? [] : []));
const dp = computed(() => invoice.value?.currencyDecimalPlaces ?? 2);
const amount = (value) => `${invoice.value.currencyCode} ${money(value, dp.value)}`;
const overview = computed(() => {
  const value = invoice.value;
  return [
    ["客戶", `${value.customerCode} — ${value.customerName}`], ["貨幣", value.currencyCode],
    ["發票日期", value.invoiceDate], ["到期日", value.dueDate ? `${value.dueDate}${value.dueDateOverridden ? `（手動：${value.dueDateReason}）` : ""}` : "—"],
    ["付款條款", value.paymentTermCode ? `${value.paymentTermCode} — ${value.paymentTermName}` : "—"],
    // 總額直接用 server 嘅 totalAmount：各行 lineAmount 有 4 位小數，相加唔一定等於總額（Sam 2026-11-19「採用 A」）。
    ["總額", amount(value.totalAmount)], ["已核銷", amount(value.allocatedAmount)], ["未收額", invoiceOutstandingText(value)],
    ["建立", `${value.createdByLabel}，${timestamp(value.createdAt)}`],
    ...(value.confirmedAt ? [["確認", `${value.confirmedByLabel}，${timestamp(value.confirmedAt)}`]] : []),
    ...(value.voidedAt ? [["作廢", `${value.voidedByLabel}，${timestamp(value.voidedAt)}`], ["作廢原因", value.voidReason]] : [])
  ];
});
const lineColumns = [
  { name: "lineNo", label: "行", field: "lineNo", align: "left" },
  { name: "sku", label: "SKU", field: "skuName", align: "left" },
  { name: "quantity", label: "數量 × 單價", field: "quantity", align: "left" },
  { name: "lineAmount", label: "行金額", field: "lineAmount", align: "right" },
  { name: "shipmentId", label: "出貨單 ID", field: "shipmentId", align: "left" }
];
const allocationColumns = [
  { name: "receiptNumber", label: "收款編號", field: "receiptNumber", align: "left" },
  { name: "receiptDate", label: "收款日期", field: "receiptDate", align: "left" },
  { name: "amount", label: "核銷金額", field: "amount", align: "right" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "createdAt", label: "核銷時間", field: "createdAt", align: "left" }
];

const ACTIONS = Object.freeze({
  confirm: { label: "確認發票", send: ar.confirmInvoice, done: (r) => `已確認，發票編號 ${r.number}。` },
  cancel: { label: "取消草稿", send: ar.cancelInvoice, done: () => "草稿已取消，出貨已釋放。" },
  void: { label: "作廢發票", send: ar.voidInvoice, done: (r) => `${r.number} 已作廢，出貨已釋放。` }
});
const RELOAD = ["VERSION_CONFLICT", "AR_STATE_CONFLICT", "CONCURRENT_OPERATION", "AR_INVOICE_HAS_ALLOCATIONS"];
const commandKey = (action) => `${session.user?.id}:${invoiceId.value}:${action}`;
const uncertain = computed(() => Object.keys(ACTIONS).filter((action) => command.isUncertain(commandKey(action))));
const busy = computed(() => Object.keys(ACTIONS).some((action) => command.isBusy(commandKey(action))));

async function run(action, payload) {
  const gen = generation, id = invoiceId.value, key = commandKey(action);
  try {
    const result = await command.run(payload, (body) => ACTIONS[action].send(id, body), key, { action });
    if (gen !== generation) return;
    notifySuccess(ACTIONS[action].done(result));
    await load({ keep: true });
  } catch (failure) {
    if (gen !== generation || command.isUncertain(key)) return;
    notifyError(failure.message || "操作失敗");
    if (RELOAD.includes(failure.code)) await load({ keep: true });
  }
}
// 未確定：用原 record 重送（同一 eventId），payload 會被忽略。
const retry = (action) => run(action, {});
async function ask(action) {
  const { version, number } = invoice.value, gen = generation, label = number || "這張草稿";
  if (action === "void") {
    const reason = await promptReason({ title: "作廢發票", message: `作廢 ${label}？出貨會釋放，可重新開票。請填寫原因（5 字以上）。`, okLabel: "作廢" });
    if (reason !== null && gen === generation) await run("void", { version, reason: reason.trim() });
    return;
  }
  const message = action === "confirm" ? `確認 ${label}？確認後會取號，金額不可再改。` : `取消 ${label}？出貨會釋放，草稿不可恢復。`;
  if (await confirm({ title: ACTIONS[action].label, message, okLabel: ACTIONS[action].label }) && gen === generation) await run(action, { version });
}
</script>

<template>
  <div>
    <PageHeader :title="invoice?.number || '發票詳情'" subtitle="發票金額以伺服器計算為準；草稿不可修改，填錯請取消後重開。" />
    <div class="q-px-md q-pb-md">
      <q-banner v-for="action in uncertain" :key="action" role="status" class="bg-warning text-dark q-mb-md" data-testid="ar-invoice-uncertain">
        {{ ACTIONS[action].label }}的結果尚未確認；請重試同一操作以確認結果，不會重複執行。
        <template #action><q-btn flat label="重試確認結果" :loading="command.isBusy(commandKey(action))" @click="retry(action)" /></template>
      </q-banner>
      <q-skeleton v-if="loading" type="rect" aria-label="載入發票" />
      <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load()" /><q-btn flat label="返回發票列表" to="/ar/invoices" /></template></q-banner>
      <template v-else-if="invoice">
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="statusColors[invoice.status]" :label="invoiceStatusLabels[invoice.status]" />
          <span>版本 {{ invoice.version }}</span>
          <q-btn v-for="action in actions.filter((name) => ACTIONS[name])" :key="action" :label="ACTIONS[action].label" :color="action === 'confirm' ? 'primary' : undefined"
            :loading="command.isBusy(commandKey(action))" :disable="busy || uncertain.length > 0" @click="ask(action)" />
          <q-btn flat label="返回發票列表" to="/ar/invoices" />
        </div>
        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <h2 class="text-h6 q-ma-none q-mb-md">概覽</h2>
            <dl class="row q-col-gutter-md q-my-none break-word">
              <div v-for="[label, value] in overview" :key="label" class="col-12 col-md-6"><dt class="text-caption text-grey-7">{{ label }}</dt><dd class="q-ml-none">{{ value }}</dd></div>
              <div class="col-12"><dt class="text-caption text-grey-7">備註</dt><dd class="q-ml-none pre-line">{{ invoice.notes || "—" }}</dd></div>
            </dl>
          </q-card-section>
        </q-card>
        <h2 class="text-h6 q-ma-none q-mb-md">明細</h2>
        <DataTable :rows="invoice.lines" :columns="lineColumns" :initial-pagination="{ page: 1, rowsPerPage: appConfig.defaultPageSize, sortBy: null, descending: false }">
          <template #body-cell-sku="{ row }"><EllipsisCell :text="`${row.skuCode} — ${row.skuName}`" max-width="160px" /></template>
          <template #body-cell-quantity="{ row }"><q-td>{{ quantityText(row) }}</q-td></template>
          <template #body-cell-lineAmount="{ row }"><q-td class="text-right">{{ money(row.lineAmount, dp) }}</q-td></template>
          <template #body-cell-shipmentId="{ row }"><q-td><router-link v-if="canViewShipments" :to="`/shipments/${row.shipmentId}`">出貨單 {{ row.shipmentId }}</router-link><template v-else>{{ row.shipmentId }}</template></q-td></template>
        </DataTable>
        <h2 class="text-h6 q-mt-lg q-mb-md">核銷記錄</h2>
        <DataTable :rows="invoice.allocations" :columns="allocationColumns" :initial-pagination="{ page: 1, rowsPerPage: appConfig.defaultPageSize, sortBy: null, descending: false }">
          <template #body-cell-amount="{ row }"><q-td class="text-right">{{ amount(row.amount) }}</q-td></template>
          <template #body-cell-status="{ row }"><q-td>{{ allocationStatusLabels[row.status] ?? row.status }}</q-td></template>
          <template #body-cell-createdAt="{ row }"><q-td>{{ timestamp(row.createdAt) }}</q-td></template>
          <template #no-data><p role="status" class="q-ma-none">未有核銷。</p></template>
        </DataTable>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pre-line { white-space: pre-line; }
.break-word { overflow-wrap: anywhere; }
</style>
