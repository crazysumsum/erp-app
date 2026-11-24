<script>
export const page = { name: "ap-payment-detail", path: "/ap/payments/:id", title: "付款詳情", requires: { permissions: ["ap.view"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { allocationStatusLabels, amountInputValid, fromUnits, money, paymentMethodLabels, paymentStatusLabels, statusColors, timestamp, toUnits } from "@/components/ap/apPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import ApDocumentDialog from "@/components/ap/ApDocumentDialog.vue";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";

const route = useRoute(), session = useSessionStore();
const command = useCommandEvent();
const actionDialog = ref(null);
const confirm = (options) => actionDialog.value.ask(options);
const promptReason = (options) => actionDialog.value.ask({ ...options, reason: true });
const payment = ref(null), loading = ref(false), error = ref("");
const INVOICE_PAGE_SIZE = 100;
const invoices = ref([]), invoicesError = ref(""), invoicesLoading = ref(false);
const invoicePage = ref(1), invoiceTotal = ref(0), invoiceSearch = ref(""), invoiceQuery = ref("");
const invoicePages = computed(() => Math.max(1, Math.ceil(invoiceTotal.value / INVOICE_PAGE_SIZE)));
const selected = reactive(new Map());
const paymentId = computed(() => String(route.params.id));
let controller, invoiceController;
async function load({ keep = false } = {}) {
  controller?.abort();
  invoiceController?.abort();
  invoicesLoading.value = false;
  controller = new AbortController();
  const { signal } = controller, id = paymentId.value;
  error.value = "";
  if (!keep) {
    payment.value = null;
    loading.value = true;
    invoices.value = [];
    invoicesError.value = "";
    invoicePage.value = 1;
    invoiceTotal.value = 0;
    invoiceSearch.value = invoiceQuery.value = "";
    selected.clear();
  }
  if (!/^[1-9]\d*$/u.test(id)) { error.value = "找不到這筆付款。"; loading.value = false; return; }
  try {
    const value = await ap.getPayment(id, { signal });
    if (signal.aborted) return;
    payment.value = value;
    if (canAllocate.value) await loadInvoices();
  } catch (failure) {
    if (!signal.aborted) error.value = failure.message || "載入付款失敗";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
// 可核銷嘅發票：同供應商、同幣別、已確認而仍有未付額（契約建議嘅查詢）。
async function loadInvoices(page = invoicePage.value) {
  invoiceController?.abort();
  invoiceController = new AbortController();
  const { signal } = invoiceController;
  invoicePage.value = page;
  invoicesError.value = "";
  invoicesLoading.value = true;
  try {
    const { rows, rowsNumber } = await ap.listInvoices({ supplierId: payment.value.supplierId, currencyCode: payment.value.currencyCode,
      outstandingOnly: true, q: invoiceQuery.value, page, rowsPerPage: INVOICE_PAGE_SIZE, signal });
    if (signal.aborted) return;
    invoiceTotal.value = rowsNumber;
    if (page > invoicePages.value) return await loadInvoices(invoicePages.value);
    invoices.value = rows;
    for (const row of rows) {
      const entry = selected.get(row.id);
      if (entry) entry.row = row;
    }
  } catch (failure) {
    if (!signal.aborted) invoicesError.value = failure.message || "載入可核銷發票失敗";
  } finally {
    if (!signal.aborted) invoicesLoading.value = false;
  }
}
function searchInvoices() {
  invoiceQuery.value = (invoiceSearch.value ?? "").trim();
  return loadInvoices(1);
}
watch([paymentId, () => session.user?.id, () => session.permissions.join("|")], () => load(), { immediate: true });
let generation = 0;
watch([paymentId, () => session.user?.id], () => { generation += 1; });
onBeforeUnmount(() => { generation += 1; controller?.abort(); invoiceController?.abort(); });

const manage = computed(() => session.permissions.includes("ap.payment.mgmt"));
const actions = computed(() => (manage.value ? payment.value?.allowedActions ?? [] : []));
const canAllocate = computed(() => actions.value.includes("allocate"));
const dp = computed(() => payment.value?.currencyDecimalPlaces ?? 2);
const amount = (value) => `${payment.value.currencyCode} ${money(value, dp.value)}`;
const overview = computed(() => {
  const value = payment.value;
  return [
    ["供應商", `${value.supplierCode} — ${value.supplierName}`], ["貨幣", value.currencyCode], ["付款日期", value.paymentDate],
    ["付款方式", paymentMethodLabels[value.paymentMethod] ?? value.paymentMethod], ["參考號", value.reference || "—"],
    ["金額", amount(value.amount)], ["已核銷", amount(value.allocatedAmount)], ["可核銷額", amount(value.availableAmount)],
    ["建立", `${value.createdByLabel}，${timestamp(value.createdAt)}`],
    ...(value.confirmedAt ? [["確認", `${value.confirmedByLabel}，${timestamp(value.confirmedAt)}`]] : []),
    ...(value.voidedAt ? [["作廢", `${value.voidedByLabel}，${timestamp(value.voidedAt)}`], ["作廢原因", value.voidReason]] : [])
  ];
});
const allocationColumns = [
  { name: "invoiceNumber", label: "發票編號", field: "invoiceNumber", align: "left" },
  { name: "dueDate", label: "到期日", field: "dueDate", align: "left" },
  { name: "invoiceOutstandingAmount", label: "發票未付額", field: "invoiceOutstandingAmount", align: "right" },
  { name: "amount", label: "核銷金額", field: "amount", align: "right" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "createdAt", label: "核銷", field: "createdAt", align: "left" },
  { name: "actions", label: "操作", align: "right" }
];

// 核銷輸入：逐張發票填金額；以 BigInt 萬分位計，唔用浮點。
const entries = computed(() => [...selected.values()]);
const currentInvoiceIds = computed(() => new Set(invoices.value.map((row) => row.id)));
const allocationRows = computed(() => [...entries.value.map(({ row }) => row).filter((row) => !currentInvoiceIds.value.has(row.id)), ...invoices.value]);
function setAmount(row, value) {
  const trimmed = (value ?? "").trim();
  if (trimmed) selected.set(row.id, { row, value: trimmed });
  else selected.delete(row.id);
}
const entryError = (row) => {
  const value = selected.get(row.id)?.value ?? "";
  if (!value) return "";
  if (!amountInputValid(value, dp.value)) return `請輸入大於零、最多 ${dp.value} 位小數的金額`;
  return toUnits(value) > toUnits(row.outstandingAmount) ? "超過發票未付額" : "";
};
const totalUnits = computed(() => entries.value.reduce((sum, { value, row }) => sum + (entryError(row) ? 0n : toUnits(value)), 0n));
const overAvailable = computed(() => payment.value && totalUnits.value > toUnits(payment.value.availableAmount));
const allocationReady = computed(() => entries.value.length > 0 && entries.value.length <= 50 && entries.value.every(({ row }) => !entryError(row)) && !overAvailable.value);
function fill(row) {
  const used = entries.value.filter((entry) => entry.row.id !== row.id && !entryError(entry.row)).reduce((sum, { value }) => sum + toUnits(value), 0n);
  const remaining = toUnits(payment.value.availableAmount) - used, outstanding = toUnits(row.outstandingAmount);
  const units = remaining < outstanding ? remaining : outstanding;
  // 幣別小數位以下嘅尾數唔可以送（server 會拒），向下取到幣別小數位。
  const step = 10n ** BigInt(4 - dp.value), rounded = units - (units % step);
  setAmount(row, rounded > 0n ? fromUnits(rounded, dp.value) : "");
}

const ACTIONS = Object.freeze({
  confirm: { label: "確認付款", send: (id, body) => ap.confirmPayment(id, body), done: (r) => `已確認，付款編號 ${r.number}。` },
  cancel: { label: "取消草稿", send: (id, body) => ap.cancelPayment(id, body), done: () => "草稿已取消。" },
  void: { label: "作廢付款", send: (id, body) => ap.voidPayment(id, body), done: (r) => `${r.number} 已作廢。` },
  allocate: { label: "核銷", send: (id, body) => ap.allocatePayment(id, body), done: (r) => `已核銷；可核銷額尚餘 ${payment.value.currencyCode} ${money(r.availableAmount, dp.value)}。` },
  unapply: { label: "解除核銷", send: (id, body, meta) => ap.unapplyAllocation(id, meta.allocationId, body), done: () => "已解除核銷。" }
});
const RELOAD = ["VERSION_CONFLICT", "AP_STATE_CONFLICT", "CONCURRENT_OPERATION", "AP_PAYMENT_HAS_ALLOCATIONS", "AP_ALLOCATION_EXCEEDS_OUTSTANDING", "AP_ALLOCATION_EXCEEDS_AVAILABLE", "AP_PARTY_MISMATCH"];
const commandKey = (action, allocationId = "") => `${session.user?.id}:ap-payment:${paymentId.value}:${action}${allocationId ? `:${allocationId}` : ""}`;
const uncertain = computed(() => command.uncertainRecords.value.filter(({ key }) => key.startsWith(`${session.user?.id}:ap-payment:${paymentId.value}:`)));
const busy = computed(() => Object.keys(ACTIONS).some((action) => command.isBusy(commandKey(action)))
  || (payment.value?.allocations ?? []).some((row) => command.isBusy(commandKey("unapply", row.id))));
const locked = computed(() => busy.value || uncertain.value.length > 0);

// 錯誤 field 係 "allocations.N.amount"：指返係邊張發票。
function failureText(failure, payload) {
  const index = /^allocations\.(\d+)\./u.exec(failure.details?.field ?? "")?.[1];
  const invoice = index === undefined ? null : selected.get(payload?.allocations?.[Number(index)]?.invoiceId)?.row;
  return `${failure.message || "操作失敗"}${invoice ? `（${invoice.number}）` : ""}`;
}
async function run(action, payload, meta = {}) {
  const gen = generation, id = paymentId.value, key = commandKey(action, meta.allocationId);
  try {
    const result = await command.run(payload, (body) => ACTIONS[action].send(id, body, meta), key, { action, ...meta });
    if (gen !== generation) return;
    notifySuccess(ACTIONS[action].done(result));
    if (action === "allocate") selected.clear();
    await load({ keep: true });
  } catch (failure) {
    if (gen !== generation || command.isUncertain(key)) return;
    notifyError(failureText(failure, payload));
    if (RELOAD.includes(failure.code)) await load({ keep: true });
  }
}
// 未確定：用原 record 重送（同一 eventId、同一內容）。
const retry = (record) => run(record.meta.action, record.payload, record.meta.allocationId ? { allocationId: record.meta.allocationId } : {});
async function ask(action) {
  const { version, number } = payment.value, gen = generation, label = number || "這張草稿";
  if (action === "void") {
    const reason = await promptReason({ title: "作廢付款", message: `作廢 ${label}？金額及號碼會保留，但不可再核銷。請填寫原因（5 字以上）。`, okLabel: "作廢" });
    if (reason !== null && gen === generation) await run("void", { version, reason: reason.trim() });
    return;
  }
  const message = action === "confirm" ? `確認 ${label}？確認後會取號，之後可核銷。` : `取消 ${label}？草稿不可恢復。`;
  if (await confirm({ title: ACTIONS[action].label, message, okLabel: ACTIONS[action].label }) && gen === generation) await run(action, { version });
}
async function allocate() {
  const allocations = entries.value.map(({ row, value }) => ({ invoiceId: row.id, amount: value }));
  await run("allocate", { version: payment.value.version, allocations });
}
async function unapply(row) {
  const gen = generation;
  if (await confirm({ title: "解除核銷", message: `解除 ${row.invoiceNumber} 的核銷 ${amount(row.amount)}？發票未付額及付款可核銷額會還原。`, okLabel: "解除" }) && gen === generation) {
    await run("unapply", { version: payment.value.version }, { allocationId: row.id });
  }
}
</script>

<template>
  <div>
    <ApDocumentDialog ref="actionDialog" />
    <PageHeader :title="payment?.number || '付款詳情'" subtitle="草稿填錯可取消後重新登記。" />
    <div class="q-px-md q-pb-md">
      <q-banner v-for="record in uncertain" :key="record.key" role="status" class="bg-warning text-dark q-mb-md" data-testid="ap-payment-uncertain">
        {{ ACTIONS[record.meta.action].label }}的結果尚未確認；請重試同一操作以確認結果，不會重複執行。
        <template #action><q-btn flat label="重試確認結果" :loading="command.isBusy(record.key)" @click="retry(record)" /></template>
      </q-banner>
      <q-skeleton v-if="loading" type="rect" aria-label="載入付款" />
      <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load()" /><q-btn flat label="返回付款列表" to="/ap/payments" /></template></q-banner>
      <template v-else-if="payment">
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="statusColors[payment.status]" :label="paymentStatusLabels[payment.status]" />
          <span>版本 {{ payment.version }}</span>
          <q-btn v-for="action in actions.filter((name) => ['confirm', 'cancel', 'void'].includes(name))" :key="action" :label="ACTIONS[action].label"
            :color="action === 'confirm' ? 'primary' : undefined" :loading="command.isBusy(commandKey(action))" :disable="locked" @click="ask(action)" />
          <q-btn flat label="返回付款列表" to="/ap/payments" />
        </div>
        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <h2 class="text-h6 q-ma-none q-mb-md">概覽</h2>
            <dl class="row q-col-gutter-md q-my-none break-word">
              <div v-for="[label, value] in overview" :key="label" class="col-12 col-md-6"><dt class="text-caption text-grey-7">{{ label }}</dt><dd class="q-ml-none">{{ value }}</dd></div>
              <div class="col-12"><dt class="text-caption text-grey-7">備註</dt><dd class="q-ml-none pre-line">{{ payment.notes || "—" }}</dd></div>
            </dl>
          </q-card-section>
        </q-card>
        <q-card v-if="canAllocate" flat bordered class="q-mb-md" data-testid="ap-allocate-panel">
          <q-card-section>
            <h2 class="text-h6 q-ma-none q-mb-md">核銷到發票</h2>
            <form class="row items-center q-gutter-sm q-mb-sm" @submit.prevent="searchInvoices">
              <q-input v-model="invoiceSearch" label="發票編號前綴" type="search" maxlength="190" clearable :disable="locked || invoicesLoading" outlined dense />
              <q-btn type="submit" label="搜尋發票" :disable="locked || invoicesLoading" flat />
            </form>
            <p v-if="invoicesLoading" role="status">載入可核銷發票…</p>
            <q-banner v-else-if="invoicesError" role="alert" class="bg-negative text-white">{{ invoicesError }}<template #action><q-btn flat label="重試" @click="loadInvoices()" /></template></q-banner>
            <template v-else>
              <div class="row items-center q-gutter-sm">
                <span role="status">{{ invoiceQuery ? "符合搜尋" : "未付發票" }}共 {{ invoiceTotal }} 張。第 {{ invoicePage }}／{{ invoicePages }} 頁</span>
                <q-btn v-if="invoicePages > 1" flat dense label="上一頁" :disable="locked || invoicePage <= 1" @click="loadInvoices(invoicePage - 1)" />
                <q-btn v-if="invoicePages > 1" flat dense label="下一頁" :disable="locked || invoicePage >= invoicePages" @click="loadInvoices(invoicePage + 1)" />
              </div>
              <p v-if="!invoices.length" role="status">{{ invoiceQuery ? "沒有符合搜尋的未付發票。" : "此供應商在此幣別沒有仍有未付額的已確認發票。" }}</p>
            </template>
            <q-list v-if="!invoicesLoading && !invoicesError" separator>
              <q-item v-for="row in allocationRows" :key="row.id">
                <q-item-section>
                  <q-item-label>{{ row.number }}，到期 {{ row.dueDate || "—" }}</q-item-label>
                  <q-item-label caption>未付額 {{ amount(row.outstandingAmount) }}／總額 {{ amount(row.totalAmount) }}</q-item-label>
                  <q-item-label v-if="!currentInvoiceIds.has(row.id)" caption>已填金額，來自其他頁或搜尋結果</q-item-label>
                </q-item-section>
                <q-item-section side class="allocation-input">
                  <q-input :model-value="selected.get(row.id)?.value ?? ''" :label="`${row.number} 核銷金額`" inputmode="decimal" :error="Boolean(entryError(row))"
                    :error-message="entryError(row)" :disable="locked" outlined dense @update:model-value="(value) => setAmount(row, value)" />
                </q-item-section>
                <q-item-section side><q-btn flat dense label="填入" :aria-label="`填入 ${row.number}`" :disable="locked" @click="fill(row)" /></q-item-section>
              </q-item>
            </q-list>
            <div class="row items-center q-gutter-sm q-mt-md">
              <q-btn color="primary" label="核銷" :loading="command.isBusy(commandKey('allocate'))" :disable="!allocationReady || locked || invoicesLoading || Boolean(invoicesError)" @click="allocate" />
              <span>合計 {{ payment.currencyCode }} {{ fromUnits(totalUnits, dp) }}／可核銷 {{ amount(payment.availableAmount) }}</span>
              <span v-if="overAvailable" role="alert" class="text-negative">合計超過可核銷額</span>
            </div>
          </q-card-section>
        </q-card>
        <h2 class="text-h6 q-ma-none q-mb-md">核銷記錄</h2>
        <DataTable :rows="payment.allocations" :columns="allocationColumns" :initial-pagination="{ page: 1, rowsPerPage: appConfig.defaultPageSize, sortBy: null, descending: false }">
          <template #body-cell-invoiceNumber="{ row }"><q-td><router-link :to="`/ap/invoices/${row.invoiceId}`">{{ row.invoiceNumber }}</router-link></q-td></template>
          <template #body-cell-invoiceOutstandingAmount="{ row }"><q-td class="text-right">{{ amount(row.invoiceOutstandingAmount) }}</q-td></template>
          <template #body-cell-amount="{ row }"><q-td class="text-right">{{ amount(row.amount) }}</q-td></template>
          <template #body-cell-status="{ row }"><q-td>{{ allocationStatusLabels[row.status] ?? row.status }}<div v-if="row.unappliedAt" class="text-caption">{{ row.unappliedByLabel }}，{{ timestamp(row.unappliedAt) }}</div></q-td></template>
          <template #body-cell-createdAt="{ row }"><q-td>{{ row.createdByLabel }}，{{ timestamp(row.createdAt) }}</q-td></template>
          <template #body-cell-actions="{ row }">
            <q-td class="text-right"><q-btn v-if="manage && row.allowedActions.includes('unapply')" flat dense label="解除" :aria-label="`解除 ${row.invoiceNumber} 的核銷`"
              :loading="command.isBusy(commandKey('unapply', row.id))" :disable="locked" @click="unapply(row)" /></q-td>
          </template>
          <template #no-data><p role="status" class="q-ma-none">未有核銷。</p></template>
        </DataTable>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pre-line { white-space: pre-line; }
.break-word { overflow-wrap: anywhere; }
.allocation-input { min-width: 12rem; }
</style>
