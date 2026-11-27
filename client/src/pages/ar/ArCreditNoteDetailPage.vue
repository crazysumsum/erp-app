<script>
export const page = { name: "ar-credit-note-detail", path: "/ar/credit-notes/:id", title: "應收貸項單詳情", requires: { permissions: ["ar.view"] } };
</script>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import ArInvoicePicker from "@/components/ar/ArInvoicePicker.vue";
import { allocationStatusLabels, amountInputValid, invoiceStatusLabels, money, statusColors, toUnits } from "@/components/ar/arPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { confirm, promptReason } from "@/framework/ui/confirm.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ar from "@/services/ar.js";

const route = useRoute(), router = useRouter(), session = useSessionStore(), command = useCommandEvent();
const note = ref(null), loading = ref(false), readError = ref(""), writeError = ref(""), errorMessage = ref(null);
const invoice = ref(null), amount = ref("");
const id = computed(() => String(route.params.id));
const key = computed(() => `${session.user?.id}:ar-credit:${id.value}`);
const pending = computed(() => command.pending(key.value)), busy = computed(() => command.isBusy(key.value));
const locked = computed(() => busy.value || Boolean(pending.value));
const canManage = computed(() => session.permissions.includes("ar.credit.mgmt"));
const actions = computed(() => canManage.value ? note.value?.allowedActions ?? [] : []);
const displayAmount = (value) => `${note.value.currencyCode} ${money(value, note.value.currencyDecimalPlaces)}`;
let controller, active = true;
onBeforeUnmount(() => { active = false; controller?.abort(); });

async function load(keep = false) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller, creditId = id.value;
  readError.value = "";
  if (!keep) { note.value = null; loading.value = true; }
  try {
    if (!/^[1-9]\d*$/u.test(creditId)) throw new Error("找不到這張貸項單。");
    const record = await ar.getCreditNote(creditId, { signal });
    if (!signal.aborted) note.value = record;
  } catch (failure) {
    if (!signal.aborted) readError.value = failure.message || "載入貸項單失敗";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch([id, () => session.user?.id, () => session.permissions.join("|")], () => {
  invoice.value = null;
  amount.value = "";
  writeError.value = "";
  load();
}, { immediate: true });

const COMMANDS = {
  confirm: { label: "確認貸項單", message: "確認後會取號，並先沖減原發票的未收額。", send: ar.confirmCreditNote, success: "貸項單已確認。" },
  cancel: { label: "取消草稿", message: "取消後，這張草稿不能再確認。", send: ar.cancelCreditNote, success: "貸項草稿已取消。" },
  void: { label: "作廢貸項單", send: ar.voidCreditNote, success: "貸項單已作廢。" },
  apply: { label: "核銷至其他發票", send: ar.applyCreditNote, success: "貸項核銷已完成。" },
  unapply: { label: "解除核銷", send: (creditId, body, applicationId) => ar.unapplyCreditNote(creditId, applicationId, body), success: "貸項核銷已解除。" }
};
const overview = computed(() => {
  const row = note.value;
  return [["客戶", `${row.customerCode} — ${row.customerName}`], ["貸項日期", row.creditDate],
    ["貸項金額", displayAmount(row.totalAmount)], ["已核銷", displayAmount(row.appliedAmount)],
    ["已退款", displayAmount(row.refundedAmount)], ["可用額", displayAmount(row.availableAmount)],
    ["貸項原因", row.reason], ["備註", row.notes || "—"], ...(row.voidReason ? [["作廢原因", row.voidReason]] : [])];
});

async function showError(message) {
  writeError.value = message;
  await nextTick();
  errorMessage.value?.focus();
}

async function run(action, payload, applicationId = null) {
  const commandKey = key.value, creditId = id.value, operation = COMMANDS[action];
  writeError.value = "";
  try {
    await command.run(payload, (body) => operation.send(creditId, body, applicationId), commandKey, { action, applicationId });
    if (!active || commandKey !== key.value) return;
    notifySuccess(operation.success);
    if (action === "apply") { invoice.value = null; amount.value = ""; }
    await load(true);
  } catch (failure) {
    if (!active || commandKey !== key.value || command.isUncertain(commandKey)) return;
    if (["VERSION_CONFLICT", "AR_STATE_CONFLICT", "CONCURRENT_OPERATION"].includes(failure.code)) await load(true);
    await showError(failure.message || "貸項操作失敗");
  }
}

function retry() {
  const { meta, payload } = pending.value;
  return run(meta.action, payload, meta.applicationId);
}

async function ask(action, application = null) {
  const operation = COMMANDS[action], commandKey = key.value, version = note.value.version;
  if (action === "void") {
    const reason = await promptReason({ title: operation.label, message: "作廢會還原對原發票的沖減。請填寫原因（最少 5 字）。", okLabel: "作廢" });
    if (reason !== null && active && commandKey === key.value && !locked.value) await run(action, { version, reason: reason.trim() });
    return;
  }
  const message = action === "unapply" ? `解除發票 ${application.invoiceNumber} 的核銷 ${displayAmount(application.amount)}？` : operation.message;
  if (await confirm({ title: operation.label, message, okLabel: operation.label, cancelLabel: "返回" }) &&
      active && commandKey === key.value && !locked.value) await run(action, { version }, application?.id);
}

async function apply() {
  if (!invoice.value || !amountInputValid(amount.value, note.value.currencyDecimalPlaces)) return showError("請選擇發票並輸入正確的核銷金額。");
  const units = toUnits(amount.value);
  if (units > toUnits(note.value.availableAmount) || units > toUnits(invoice.value.outstandingAmount)) {
    return showError("核銷金額不可超過貸項可用額或發票未收額。");
  }
  await run("apply", { version: note.value.version, invoiceId: invoice.value.id, amount: amount.value });
}
</script>

<template>
  <div>
    <PageHeader :title="note?.number || '應收貸項單詳情'" />
    <div class="q-px-md q-pb-md">
      <q-skeleton v-if="loading" type="rect" aria-label="載入貸項單" />
      <q-banner v-if="readError" role="alert" class="bg-negative text-white q-mb-md">
        {{ readError }}
        <template #action><q-btn flat label="重試" @click="load()" /></template>
      </q-banner>
      <q-banner v-if="pending" role="status" class="bg-warning text-dark q-mb-md">
        操作結果尚未確認。請重送原操作。
        <template #action><q-btn flat label="重試確認結果" :loading="busy" @click="retry" /></template>
      </q-banner>
      <p v-if="writeError" ref="errorMessage" role="alert" tabindex="-1" class="text-negative">{{ writeError }}</p>
      <template v-if="note">
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="statusColors[note.status]" :label="invoiceStatusLabels[note.status]" />
          <span>版本 {{ note.version }}</span>
          <q-btn v-if="actions.includes('edit')" flat :disable="locked" label="編輯草稿" :to="`/ar/credit-notes/draft/${note.id}`" />
          <q-btn v-for="action in actions.filter((value) => ['confirm', 'cancel', 'void'].includes(value))" :key="action"
            :color="action === 'confirm' ? 'primary' : undefined" :disable="locked" :label="COMMANDS[action].label" @click="ask(action)" />
        </div>
        <q-card flat bordered class="q-mb-lg">
          <q-card-section>
            <dl class="row q-col-gutter-md q-my-none break-word">
              <div class="col-12 col-sm-6"><dt>原發票</dt>
                <dd class="q-ml-none"><router-link :to="`/ar/invoices/${note.invoiceId}`">{{ note.invoiceNumber }}</router-link></dd>
              </div>
              <div v-if="note.customerReturnId" class="col-12 col-sm-6"><dt>客戶退貨單</dt>
                <dd class="q-ml-none">
                  <router-link v-if="router.hasRoute('customer-returns') && session.permissions.includes('returns.view')"
                    :to="`/customer-returns/${note.customerReturnId}`">CRT-{{ note.customerReturnId }}</router-link>
                  <span v-else>CRT-{{ note.customerReturnId }}</span>
                </dd>
              </div>
              <div v-for="[label, value] in overview" :key="label" class="col-12 col-sm-6">
                <dt>{{ label }}</dt><dd class="q-ml-none formatted-text">{{ value }}</dd>
              </div>
            </dl>
          </q-card-section>
        </q-card>
        <h2 id="credit-lines" class="text-h6 q-my-md">貸項明細</h2>
        <q-markup-table flat bordered class="credit-table" tabindex="0" role="region" aria-labelledby="credit-lines">
          <thead><tr><th scope="col">來源行</th><th scope="col">說明</th><th scope="col">基本單位數量</th><th scope="col">金額</th></tr></thead>
          <tbody>
            <tr v-for="line in note.lines" :key="line.id">
              <th scope="row">{{ line.skuCode ? `${line.skuCode} — ${line.skuName}` : "期初發票" }}</th>
              <td>{{ line.description || "—" }}</td><td>{{ line.baseQuantity ? `${line.baseQuantity} ${line.baseUomCode}` : "—" }}</td>
              <td>{{ displayAmount(line.amount) }}</td>
            </tr>
          </tbody>
        </q-markup-table>
        <h2 id="credit-applications" class="text-h6 q-my-md">貸項核銷</h2>
        <q-markup-table v-if="note.applications.length" flat bordered class="credit-table" tabindex="0" role="region" aria-labelledby="credit-applications">
          <thead><tr><th scope="col">發票</th><th scope="col">核銷類型</th><th scope="col">金額</th><th scope="col">狀態</th><th scope="col">操作</th></tr></thead>
          <tbody>
            <tr v-for="application in note.applications" :key="application.id">
              <th scope="row"><router-link :to="`/ar/invoices/${application.invoiceId}`">{{ application.invoiceNumber }}</router-link></th>
              <td>{{ application.isOrigin ? "原發票沖減" : "其他發票" }}</td><td>{{ displayAmount(application.amount) }}</td>
              <td>{{ allocationStatusLabels[application.status] }}</td>
              <td><q-btn v-if="canManage && application.allowedActions.includes('unapply')" flat :disable="locked" label="解除核銷"
                :aria-label="`解除核銷 ${application.invoiceNumber}`" @click="ask('unapply', application)" /></td>
            </tr>
          </tbody>
        </q-markup-table>
        <p v-else role="status">未有貸項核銷。</p>
        <form v-if="actions.includes('apply')" action="/ar/credit-notes" method="post" aria-labelledby="apply-credit" class="q-mb-lg" @submit.prevent="apply">
          <h2 id="apply-credit" class="text-h6 q-my-md">核銷至其他發票</h2>
          <div class="row q-col-gutter-md">
            <ArInvoicePicker v-model="invoice" class="col-12 col-md-7" label="核銷發票（同客戶及幣別）" :customer-id="note.customerId"
              :currency-code="note.currencyCode" :exclude-invoice-id="note.invoiceId" :disable="locked" outstanding-only />
            <q-input v-model="amount" class="col-12 col-sm-6 col-md-3" label="核銷金額（必填）" name="amount" :disable="locked" inputmode="decimal" required outlined />
          </div>
          <q-btn class="q-mt-sm" color="primary" type="submit" label="執行核銷" :disable="locked" />
        </form>
      </template>
      <q-btn flat label="返回貸項單列表" to="/ar/credit-notes" />
    </div>
  </div>
</template>

<style scoped>
.credit-table { max-inline-size: 100%; overflow: auto; }
.credit-table th, .credit-table td { text-align: start; }
.formatted-text { white-space: pre-wrap; }
.break-word { overflow-wrap: anywhere; }
</style>
