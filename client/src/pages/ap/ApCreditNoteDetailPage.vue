<script>
export const page = { name: "ap-credit-note-detail", path: "/ap/credit-notes/:id", title: "應付貸項單詳情", requires: { permissions: ["ap.view"] } };
</script>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import ApCreditDraftForm from "@/components/ap/ApCreditDraftForm.vue";
import ApDocumentDialog from "@/components/ap/ApDocumentDialog.vue";
import { allocationStatusLabels, amountInputValid, invoiceStatusLabels, money, statusColors, toUnits } from "@/components/ap/apPresentation.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";

const route = useRoute(), router = useRouter(), session = useSessionStore(), dialog = ref(null);
const id = computed(() => String(route.params.id));
const creating = computed(() => id.value === "new");
const sourceId = computed(() => creating.value ? String(route.query.invoiceId ?? "") : String(credit.value?.invoiceId ?? ""));
const owner = computed(() => `erp.ap.credit.${session.user?.id}.${id.value}.${creating.value ? sourceId.value : ""}`);
const credit = ref(null), origin = ref(null), editing = ref(false), loading = ref(false);
const error = ref(""), loadError = ref(""), alert = ref(null);
const pending = ref(null), busy = ref(false), storageError = ref(false);
const locked = computed(() => busy.value || !!pending.value || storageError.value);
const actions = computed(() => credit.value?.allowedActions ?? []);
const candidates = ref([]), targetsLoading = ref(false), targetError = ref(""), targetSearch = ref(""), target = ref(null), allocationAmount = ref("");
const format = (value, row = credit.value ?? origin.value) => `${row.currencyCode} ${money(value, row.currencyDecimalPlaces)}`;
const actionLabels = { create: "建立貸項草稿", update: "儲存草稿", confirm: "確認貸項單", cancel: "取消草稿",
  void: "作廢貸項單", allocate: "核銷貸項", unapply: "解除核銷" };
const send = {
  create: (_id, body) => ap.createCreditNote(body), update: ap.updateCreditNote, confirm: ap.confirmCreditNote,
  cancel: ap.cancelCreditNote, void: ap.voidCreditNote, allocate: ap.allocateCreditNote,
  unapply: (creditId, body, allocationId) => ap.unapplyCreditNote(creditId, allocationId, body)
};
const uncertainCodes = new Set(["TIMEOUT", "NETWORK_ERROR", "TRANSACTION_OUTCOME_UNKNOWN", "IDEMPOTENCY_IN_PROGRESS", "AP_EVENT_CONFLICT"]);
// These 409s are raised after ApCommandRunner checks for a committed result for the same event.
const definitiveRejections = new Set([
  "AP_CREDIT_EXCEEDS_INVOICE", "AP_CREDIT_EXCEEDS_AVAILABLE", "AP_ALLOCATION_EXCEEDS_OUTSTANDING",
  "AP_CREDIT_RETURN_MISMATCH", "AP_CREDIT_PARTY_MISMATCH", "AP_CREDIT_HAS_ACTIVITY",
  "AP_CREDIT_ORIGIN_ALLOCATION", "AP_STATE_CONFLICT", "VERSION_CONFLICT", "DOCUMENT_SEQUENCE_EXHAUSTED"
]);
let active = true, controller, targetsController;
onBeforeUnmount(() => { active = false; controller?.abort(); targetsController?.abort(); });

async function load() {
  controller?.abort();
  targetsController?.abort();
  controller = new AbortController();
  const { signal } = controller;
  loading.value = true;
  loadError.value = "";
  try {
    if (creating.value) {
      if (!session.permissions.includes("ap.credit.mgmt")) throw new Error("你沒有管理應付貸項單的權限。");
      if (!/^[1-9]\d*$/u.test(sourceId.value)) throw new Error("請從已確認的應付發票建立貸項單。");
      const invoice = await ap.getInvoice(sourceId.value, { signal });
      if (invoice.status !== "CONFIRMED" || !invoice.lines.length || toUnits(invoice.totalAmount) === 0n) {
        throw new Error("這張發票沒有可供建立貸項的發票行。");
      }
      if (!signal.aborted) origin.value = invoice;
    } else {
      if (!/^[1-9]\d*$/u.test(id.value)) throw new Error("找不到這張應付貸項單。");
      const value = await ap.getCreditNote(id.value, { signal });
      if (!signal.aborted) {
        credit.value = value;
        if (value.allowedActions.includes("allocate")) void loadTargets();
      }
    }
  } catch (failure) {
    if (!signal.aborted) loadError.value = failure.message || "載入貸項單失敗。";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

watch(owner, (key) => {
  credit.value = origin.value = target.value = null;
  pending.value = null;
  editing.value = busy.value = storageError.value = false;
  error.value = targetSearch.value = allocationAmount.value = "";
  try {
    const stored = JSON.parse(sessionStorage.getItem(key));
    if (stored && (!Object.hasOwn(send, stored.action) || !/^[0-9a-f-]{36}$/u.test(stored.body?.eventId ?? ""))) throw new Error();
    pending.value = stored;
  } catch {
    storageError.value = true;
    error.value = "無法讀取此分頁保留的貸項操作。請恢復分頁儲存後重試。";
  }
  void load();
}, { immediate: true });

async function showError(message) {
  error.value = message;
  await nextTick();
  alert.value?.focus();
}

async function run(action, payload, allocationId) {
  if (busy.value || storageError.value) return;
  const key = owner.value, creditId = id.value, previous = pending.value;
  const record = previous ?? { action, body: { ...payload, eventId: crypto.randomUUID() }, allocationId };
  const stillHere = () => active && key === owner.value;
  const settle = () => {
    const stored = JSON.parse(sessionStorage.getItem(key));
    if (stored?.body?.eventId === record.body.eventId) sessionStorage.removeItem(key);
    if (stillHere() && pending.value?.body?.eventId === record.body.eventId) pending.value = null;
  };
  try {
    sessionStorage.setItem(key, JSON.stringify(record));
  } catch {
    return showError("無法保留原操作，請恢復分頁儲存後再試。");
  }
  pending.value = record;
  busy.value = true;
  error.value = "";
  try {
    const result = await send[record.action](creditId, record.body, record.allocationId);
    settle();
    if (!stillHere()) return;
    editing.value = false;
    target.value = null;
    allocationAmount.value = "";
    notifySuccess(`${actionLabels[record.action]}完成。`);
    if (record.action === "create") await router.replace(`/ap/credit-notes/${result.id}`);
    else await load();
  } catch (failure) {
    const rejectedAfterReplayCheck = failure.status === 409 && definitiveRejections.has(failure.code);
    if (rejectedAfterReplayCheck || (!previous && failure.status >= 400 && failure.status < 500 && !uncertainCodes.has(failure.code))) settle();
    if (!stillHere()) return;
    await showError(failure.message || "貸項操作未能完成。");
    if (failure.code === "VERSION_CONFLICT" && !pending.value) {
      editing.value = false;
      await load();
    }
  } finally {
    if (stillHere()) busy.value = false;
  }
}

async function beginEdit() {
  const key = owner.value;
  try {
    const invoice = await ap.getInvoice(credit.value.invoiceId, { signal: controller.signal });
    if (!active || key !== owner.value) return;
    origin.value = invoice;
    editing.value = true;
  } catch (failure) {
    if (active && key === owner.value) await showError(failure.message || "載入原發票失敗。");
  }
}

function save(fields) {
  return creating.value ? run("create", { ...fields, invoiceId: Number(sourceId.value) }) : run("update", { ...fields, version: credit.value.version });
}

async function ask(action, allocationId) {
  const key = owner.value, { version } = credit.value;
  const message = {
    confirm: "確認後會取號，先沖減原發票未付額，餘額可核銷其他發票或收回退款。",
    cancel: "取消後會保留草稿記錄。",
    void: "作廢後會撤銷對原發票的貸項核銷，並保留單號。",
    unapply: "解除後會恢復發票未付額與貸項可用額。"
  }[action];
  const answer = await dialog.value.ask({ title: actionLabels[action], okLabel: actionLabels[action], message, reason: action === "void" });
  if (answer && active && key === owner.value) await run(action, { version, ...(action === "void" ? { reason: answer } : {}) }, allocationId);
}

async function loadTargets() {
  targetsController?.abort();
  targetsController = new AbortController();
  const { signal } = targetsController;
  const { supplierId, currencyCode, invoiceId } = credit.value;
  targetError.value = "";
  targetsLoading.value = true;
  try {
    const { rows } = await ap.listInvoices({ supplierId, currencyCode, outstandingOnly: true, rowsPerPage: 100, q: targetSearch.value.trim(), signal });
    if (!signal.aborted) {
      candidates.value = rows.filter((row) => row.id !== invoiceId);
      if (!candidates.value.some((row) => row.id === target.value)) target.value = null;
    }
  } catch (failure) {
    if (!signal.aborted) targetError.value = failure.message || "載入可核銷發票失敗。";
  } finally {
    if (!signal.aborted) targetsLoading.value = false;
  }
}

function allocate() {
  const invoice = candidates.value.find((row) => row.id === target.value);
  const amount = allocationAmount.value;
  if (!invoice || !amountInputValid(amount, credit.value.currencyDecimalPlaces) ||
    toUnits(amount) > toUnits(credit.value.availableAmount) || toUnits(amount) > toUnits(invoice.outstandingAmount)) {
    return showError("請選擇發票，輸入大於零且不超過可用額及未付額的核銷金額。");
  }
  return run("allocate", { version: credit.value.version, invoiceId: invoice.id, amount });
}
</script>

<template>
  <div>
    <ApDocumentDialog ref="dialog" />
    <PageHeader :title="creating ? '建立應付貸項單' : credit?.number || '應付貸項單詳情'">
      <template #actions><q-btn flat label="返回貸項列表" to="/ap/credit-notes" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md">
      <q-banner v-if="pending && !busy" role="status" class="bg-warning text-dark q-mb-md">
        {{ actionLabels[pending.action] }}的結果尚未確認。
        <template #action><q-btn flat label="重試原操作" @click="run(pending.action)" /></template>
      </q-banner>
      <p v-if="error" ref="alert" tabindex="-1" role="alert" class="text-negative">{{ error }}</p>
      <p v-if="loading" role="status">載入貸項資料中…</p>
      <q-banner v-else-if="loadError" role="alert" class="bg-negative text-white">
        {{ loadError }}
        <template #action><q-btn flat label="重試" @click="load" /><q-btn flat label="選擇原發票" to="/ap/invoices?status=CONFIRMED" /></template>
      </q-banner>
      <template v-else-if="creating && origin">
        <p>原發票 <router-link :to="`/ap/invoices/${origin.id}`">{{ origin.number }}</router-link> · {{ origin.supplierName }} · {{ origin.currencyCode }}</p>
        <ApCreditDraftForm :invoice="origin" :initial-draft="pending?.body" :locked="locked" @save="save" />
      </template>
      <template v-else-if="credit">
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="statusColors[credit.status]" :label="invoiceStatusLabels[credit.status]" />
          <q-btn v-if="actions.includes('update') && !editing" flat label="編輯草稿" :disable="locked" @click="beginEdit" />
          <q-btn v-for="action in actions.filter((value) => ['confirm', 'cancel', 'void'].includes(value))" v-show="!editing" :key="action"
            :label="actionLabels[action]" :color="action === 'confirm' ? 'primary' : undefined" :disable="locked" @click="ask(action)" />
        </div>
        <ApCreditDraftForm v-if="editing && origin" :invoice="origin" :credit="credit" :locked="locked" @save="save" @cancel="editing = false" />
        <template v-else>
          <dl class="row q-col-gutter-md overview">
            <div class="col-6 col-md-3"><dt>原發票</dt><dd><router-link :to="`/ap/invoices/${credit.invoiceId}`">{{ credit.invoiceNumber }}</router-link></dd></div>
            <div class="col-6 col-md-3"><dt>供應商</dt><dd>{{ credit.supplierName }}</dd></div>
            <div class="col-6 col-md-3"><dt>貸項日期</dt><dd>{{ credit.creditDate }}</dd></div>
            <div class="col-6 col-md-3"><dt>供應商貸項單號</dt><dd>{{ credit.supplierCreditReference || "—" }}</dd></div>
            <div class="col-6 col-md-3"><dt>貸項總額</dt><dd>{{ format(credit.totalAmount) }}</dd></div>
            <div class="col-6 col-md-3"><dt>已核銷</dt><dd>{{ format(credit.appliedAmount) }}</dd></div>
            <div class="col-6 col-md-3"><dt>已退款</dt><dd>{{ format(credit.refundedAmount) }}</dd></div>
            <div class="col-6 col-md-3"><dt>可用額</dt><dd>{{ format(credit.availableAmount) }}</dd></div>
            <div v-if="credit.supplierReturnId" class="col-6"><dt>退回供應商單</dt><dd>{{ credit.supplierReturnId }}</dd></div>
            <div class="col-12"><dt>貸項原因</dt><dd>{{ credit.reason }}</dd></div>
            <div v-if="credit.notes" class="col-12"><dt>備註</dt><dd>{{ credit.notes }}</dd></div>
            <div v-if="credit.voidReason" class="col-12"><dt>作廢原因</dt><dd>{{ credit.voidReason }}</dd></div>
          </dl>
          <h2 class="text-h6">貸項行</h2>
          <q-markup-table flat bordered class="credit-lines">
            <thead><tr><th scope="col">原發票行 ID</th><th scope="col">基本數量</th><th scope="col">退貨行 ID</th><th scope="col">說明</th><th scope="col">貸項金額</th></tr></thead>
            <tbody><tr v-for="line in credit.lines" :key="line.id">
              <th scope="row">{{ line.invoiceLineId }}</th><td>{{ line.baseQuantity || "—" }}</td><td>{{ line.supplierReturnLineId || "—" }}</td>
              <td>{{ line.description || "—" }}</td><td>{{ format(line.amount) }}</td>
            </tr></tbody>
          </q-markup-table>
          <form v-if="actions.includes('allocate')" :action="`/api/v1/ap-credit-notes/${credit.id}/allocations`" method="post"
            aria-labelledby="allocate-credit-heading" class="q-mt-md" @submit.prevent="allocate">
            <h2 id="allocate-credit-heading" class="text-h6">核銷其他發票</h2>
            <fieldset :disabled="locked" class="allocation-fields">
              <legend class="sr-only">核銷資料</legend>
              <div class="row q-col-gutter-sm q-mb-sm items-center">
                <q-input v-model="targetSearch" name="invoiceSearch" label="發票編號" maxlength="190" outlined dense class="col-12 col-sm-6" />
                <div class="col-auto"><q-btn flat type="button" label="搜尋發票" :loading="targetsLoading" @click="loadTargets" /></div>
              </div>
              <p v-if="targetError" role="alert" class="text-negative">{{ targetError }}</p>
              <p v-else-if="targetsLoading" role="status">載入可核銷發票中…</p>
              <p v-else-if="!candidates.length" role="status">沒有符合條件的未付發票。</p>
              <div v-if="candidates.length" class="q-mb-sm">
                <label for="credit-target-invoice">被核銷發票</label>
                <select id="credit-target-invoice" v-model="target" name="invoiceId" required class="target-select">
                  <option :value="null" disabled>選擇發票</option>
                  <option v-for="invoice in candidates" :key="invoice.id" :value="invoice.id">{{ invoice.number }} · 未付 {{ format(invoice.outstandingAmount) }}</option>
                </select>
              </div>
              <q-input v-if="candidates.length" v-model.trim="allocationAmount" name="amount" label="核銷金額" :prefix="credit.currencyCode"
                inputmode="decimal" maxlength="20" required outlined dense class="q-mb-sm" />
              <q-btn v-if="candidates.length" color="primary" type="submit" label="核銷貸項" />
            </fieldset>
          </form>
          <h2 class="text-h6">核銷記錄</h2>
          <p v-if="!credit.allocations.length" role="status">未有核銷。</p>
          <q-list v-else bordered separator>
            <q-item v-for="allocation in credit.allocations" :key="allocation.id">
              <q-item-section>
                <router-link :to="`/ap/invoices/${allocation.invoiceId}`">{{ allocation.invoiceNumber }}</router-link>
                <q-item-label caption>{{ allocation.isOrigin ? "原發票核銷" : "其他發票核銷" }}</q-item-label>
              </q-item-section>
              <q-item-section>{{ format(allocation.amount) }} · {{ allocationStatusLabels[allocation.status] }}</q-item-section>
              <q-item-section v-if="allocation.allowedActions.includes('unapply')" side>
                <q-btn flat label="解除核銷" :disable="locked" @click="ask('unapply', allocation.id)" />
              </q-item-section>
            </q-item>
          </q-list>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overview dt { font-weight: 600; }
.overview dd { margin-inline-start: 0; overflow-wrap: anywhere; }
.credit-lines { max-inline-size: 100%; overflow: auto; }
.allocation-fields { border: 0; padding-inline: 0; min-inline-size: 0; }
.target-select { display: block; inline-size: 100%; min-block-size: 3rem; font: inherit; color: inherit; }
.sr-only { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
