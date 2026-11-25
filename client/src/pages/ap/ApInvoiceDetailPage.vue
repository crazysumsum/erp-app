<script>
export const page = { name: "ap-invoice-detail", path: "/ap/invoices/:id", title: "應付發票詳情", requires: { permissions: ["ap.view"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import ApDocumentDialog from "@/components/ap/ApDocumentDialog.vue";
import ApExpenseRows from "@/components/ap/ApExpenseRows.vue";
import { amountInputValid, invoiceStatusLabels, money, statusColors, timestamp, toUnits } from "@/components/ap/apPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";

const route = useRoute(), session = useSessionStore(), command = useCommandEvent();
const dialog = ref(null), invoice = ref(null), error = ref(""), loadError = ref(""), loading = ref(false), editing = ref(false);
const id = computed(() => String(route.params.id));
const scope = computed(() => `${session.user?.id}:ap-invoice:${id.value}:`);
const actions = computed(() => invoice.value?.allowedActions ?? []);
const mayOverride = computed(() => session.permissions.includes("ap.invoice.price.override"));
const mayPay = computed(() => session.permissions.includes("ap.payment.mgmt") && invoice.value?.status === "CONFIRMED" && toUnits(invoice.value.outstandingAmount) > 0n);
const form = reactive({ supplierInvoiceNumber: "", supplierTotalAmount: "", dueDate: "", dueDateReason: "", notes: "" });
const expenses = ref([]), receiptEdits = ref([]);
const changedDueDate = computed(() => form.dueDate !== invoice.value?.dueDate);
const actionLabels = { update: "儲存草稿", confirm: "確認發票", cancel: "取消草稿", void: "作廢發票" };
const sendAction = { update: ap.updateInvoice, confirm: ap.confirmInvoice, cancel: ap.cancelInvoice, void: ap.voidInvoice };
const uncertain = computed(() => command.uncertainRecords.value.find(({ key }) => key.startsWith(scope.value)));
const busy = computed(() => Object.keys(sendAction).some((action) => command.isBusy(scope.value + action)));
const locked = computed(() => busy.value || Boolean(uncertain.value));
const amount = (value) => value == null ? "—" : `${invoice.value.currencyCode} ${money(value, invoice.value.currencyDecimalPlaces)}`;
const receiptLines = computed(() => invoice.value?.lines.filter((line) => line.lineType === "RECEIPT") ?? []);
let controller;
onBeforeUnmount(() => controller?.abort());

async function load() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  loadError.value = ""; loading.value = true;
  try {
    if (!/^[1-9]\d*$/u.test(id.value)) throw new Error("找不到這張應付發票。");
    const data = await ap.getInvoice(id.value, { signal });
    if (!signal.aborted) invoice.value = data;
  } catch (failure) {
    if (!signal.aborted) loadError.value = failure.message || "載入發票失敗。";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

watch(scope, () => { invoice.value = null; error.value = ""; editing.value = false; void load(); }, { immediate: true });

function edit() {
  const value = invoice.value;
  Object.assign(form, { supplierInvoiceNumber: value.supplierInvoiceNumber, supplierTotalAmount: value.supplierTotalAmount ?? "",
    dueDate: value.dueDate, dueDateReason: "", notes: value.notes });
  expenses.value = value.lines.filter((line) => line.lineType === "EXPENSE").map((line) => ({ ...line, key: `saved-${line.id}` }));
  receiptEdits.value = receiptLines.value.map((line) => ({ ...line }));
  editing.value = true; error.value = "";
}

async function run(action, payload) {
  const oldScope = scope.value;
  const key = oldScope + action;
  error.value = "";
  try {
    const result = await command.run(payload, (body) => sendAction[action](id.value, body), key, { action });
    if (oldScope !== scope.value) return;
    editing.value = false;
    notifySuccess(action === "confirm" ? `已確認應付發票 ${result.number}。` : `${actionLabels[action]}完成。`);
    await load();
  } catch (failure) {
    if (oldScope !== scope.value || command.isUncertain(key)) return;
    error.value = failure.message || "應付發票操作失敗。";
    if (["VERSION_CONFLICT", "AP_STATE_CONFLICT", "CONCURRENT_OPERATION", "AP_INVOICE_HAS_ALLOCATIONS"].includes(failure.code)) {
      editing.value = false;
      await load();
    }
  }
}

async function save() {
  if (form.supplierTotalAmount && !amountInputValid(form.supplierTotalAmount, 4, true)) { error.value = "請核對供應商發票總額格式。"; return; }
  if (changedDueDate.value && !form.dueDateReason.trim()) { error.value = "更改到期日須填原因。"; return; }
  if (expenses.value.some((row) => !row.description.trim() || !amountInputValid(row.lineAmount, 4))) {
    error.value = "每個費用行須有說明和正數金額。"; return;
  }
  let receiptOverrides;
  if (mayOverride.value && receiptEdits.value.length) {
    if (receiptEdits.value.some((row) => !amountInputValid(row.lineAmount, 4, true))) {
      error.value = "請核對發票行金額。"; return;
    }
    const changed = receiptEdits.value.filter((row, index) => {
      const previous = receiptLines.value[index];
      return toUnits(row.lineAmount) !== toUnits(previous.lineAmount) ||
        (toUnits(row.lineAmount) !== toUnits(row.poLineAmount) && row.amountOverrideReason.trim() !== previous.amountOverrideReason);
    });
    if (changed.some((row) => !row.amountOverrideReason.trim())) {
      error.value = "每項改價或恢復採購金額均須填寫原因。"; return;
    }
    receiptOverrides = changed
      .map((row) => ({ goodsReceiptLineId: row.goodsReceiptLineId, lineAmount: row.lineAmount, reason: row.amountOverrideReason.trim() }));
  }
  await run("update", { version: invoice.value.version, supplierInvoiceNumber: form.supplierInvoiceNumber.trim(),
    supplierTotalAmount: form.supplierTotalAmount || null, ...(changedDueDate.value ? { dueDate: form.dueDate, dueDateReason: form.dueDateReason.trim() } : {}),
    notes: form.notes, expenses: expenses.value.map(({ description, lineAmount }) => ({ description, lineAmount })),
    ...(receiptOverrides ? { receiptOverrides } : {}) });
}

async function ask(action) {
  const oldScope = scope.value;
  const { version, number, totalAmount } = invoice.value;
  const message = {
    confirm: `確認後將取得發票編號，並增加應付 ${amount(totalAmount)}。`,
    cancel: "取消會釋放收貨及供應商發票號碼。若要更正發票日期，請重建草稿，並重新輸入費用行及金額調整。",
    void: `作廢 ${number} 後會釋放收貨及供應商發票號碼，原來的內部發票編號仍會保留。`
  }[action];
  const answer = await dialog.value.ask({ title: actionLabels[action], message, okLabel: actionLabels[action], reason: action === "void" });
  if (answer && oldScope === scope.value) await run(action, { version, ...(action === "void" ? { reason: answer } : {}) });
}
</script>

<template>
  <div>
    <ApDocumentDialog ref="dialog" />
    <PageHeader :title="invoice?.number || '應付發票詳情'">
      <template #actions>
        <q-btn v-if="mayPay" color="primary" label="登記付款" :to="{ path: '/ap/payments/new', query: { supplierId: invoice.supplierId, currencyCode: invoice.currencyCode } }" />
        <q-btn flat label="返回發票列表" to="/ap/invoices" />
      </template>
    </PageHeader>
    <div class="q-px-md q-pb-md">
      <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md">
        {{ actionLabels[uncertain.meta.action] }}的結果尚未確認。
        <template #action><q-btn flat label="重試原操作" :loading="busy" @click="run(uncertain.meta.action, uncertain.payload)" /></template>
      </q-banner>
      <q-banner v-if="error" role="alert" class="bg-negative text-white q-mb-md">{{ error }}</q-banner>
      <p v-if="loading" role="status">載入應付發票中…</p>
      <q-banner v-else-if="loadError" role="alert" class="bg-negative text-white">{{ loadError }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
      <template v-else-if="invoice">
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="statusColors[invoice.status]" :label="invoiceStatusLabels[invoice.status]" />
          <q-btn v-if="actions.includes('update') && !editing" flat color="primary" label="編輯草稿" :disable="locked" @click="edit" />
          <q-btn v-for="action in actions.filter((name) => ['confirm', 'cancel', 'void'].includes(name))" v-show="!editing" :key="action"
            :label="actionLabels[action]" :color="action === 'confirm' ? 'primary' : undefined" :disable="locked" @click="ask(action)" />
        </div>
        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <h2 class="text-h6 q-mt-none">發票資料</h2>
            <dl class="row q-col-gutter-md q-my-none">
              <div class="col-12 col-sm-6"><dt>供應商</dt><dd>{{ invoice.supplierCode }} {{ invoice.supplierName }}</dd></div>
              <div class="col-12 col-sm-6"><dt>供應商發票號碼</dt><dd>{{ invoice.supplierInvoiceNumber }}</dd></div>
              <div class="col-12 col-sm-6"><dt>發票日期</dt><dd>{{ invoice.invoiceDate }}</dd></div>
              <div class="col-12 col-sm-6"><dt>到期日</dt><dd>{{ invoice.dueDate }}<template v-if="invoice.dueDateOverridden"> · {{ invoice.dueDateReason }}</template></dd></div>
              <div v-if="invoice.paymentTermName" class="col-12 col-sm-6"><dt>採購付款條款</dt><dd>{{ invoice.paymentTermCode }} {{ invoice.paymentTermName }}</dd></div>
              <div v-if="invoice.noPoReason" class="col-12 col-sm-6"><dt>無採購單原因</dt><dd>{{ invoice.noPoReason }}</dd></div>
              <div class="col-12 col-sm-6"><dt>供應商發票總額</dt><dd>{{ amount(invoice.supplierTotalAmount) }}</dd></div>
              <div class="col-12 col-sm-6"><dt>系統計算總額</dt><dd>{{ amount(invoice.totalAmount) }}</dd></div>
              <div v-if="invoice.status === 'CONFIRMED'" class="col-12 col-sm-6"><dt>已核銷／未付</dt><dd>{{ amount(invoice.allocatedAmount) }} ／ {{ amount(invoice.outstandingAmount) }}</dd></div>
              <div v-if="invoice.notes" class="col-12 col-sm-6"><dt>備註</dt><dd>{{ invoice.notes }}</dd></div>
              <div v-if="invoice.voidReason" class="col-12 col-sm-6"><dt>作廢原因</dt><dd>{{ invoice.voidReason }}</dd></div>
            </dl>
          </q-card-section>
        </q-card>
        <form v-if="editing" method="post" class="q-mb-md" @submit.prevent="save">
          <fieldset class="q-pa-md q-mb-md" :disabled="locked">
            <legend>編輯草稿</legend>
            <p>如需更改發票日期，請先取消草稿再重建。</p>
            <div class="row q-col-gutter-md">
              <div class="col-12 col-sm-6"><q-input v-model="form.supplierInvoiceNumber" name="supplierInvoiceNumber" label="供應商發票號碼" maxlength="100" outlined dense required /></div>
              <div class="col-12 col-sm-6"><q-input v-model="form.supplierTotalAmount" name="supplierTotalAmount" label="供應商發票總額" inputmode="decimal" outlined dense /></div>
              <div class="col-12 col-sm-6"><q-input v-model="form.dueDate" name="dueDate" label="到期日" type="date" stack-label :min="invoice.invoiceDate" outlined dense required /></div>
              <div v-if="changedDueDate" class="col-12 col-sm-6"><q-input v-model="form.dueDateReason" name="dueDateReason" label="更改到期日原因" maxlength="500" outlined dense required /></div>
              <div class="col-12"><q-input v-model="form.notes" name="notes" label="備註" type="textarea" maxlength="2000" outlined dense /></div>
            </div>
          </fieldset>
          <fieldset v-if="mayOverride && receiptEdits.length" class="q-pa-md q-mb-md" :disabled="locked">
            <legend>調整收貨行金額</legend>
            <div v-for="line in receiptEdits" :key="line.id" class="row items-start q-col-gutter-md q-mb-md">
              <div class="col-12 col-sm-4">{{ line.goodsReceiptNumber }} · {{ line.skuCode }}<br />採購金額 {{ amount(line.poLineAmount) }}</div>
              <div class="col-12 col-sm-4"><q-input v-model="line.lineAmount" :name="`lineAmount${line.id}`" :label="`第 ${line.lineNo} 行發票金額`" inputmode="decimal" outlined dense required /></div>
              <div class="col-12 col-sm-4"><q-input v-model="line.amountOverrideReason" :name="`lineReason${line.id}`" :label="`第 ${line.lineNo} 行改價原因`" maxlength="500" outlined dense /></div>
            </div>
          </fieldset>
          <ApExpenseRows v-model="expenses" :locked="locked" />
          <q-btn color="primary" type="submit" label="儲存草稿" :loading="busy" :disable="locked" />
          <q-btn flat type="button" label="放棄編輯" :disable="locked" @click="editing = false" />
        </form>
        <h2 id="ap-invoice-lines" class="text-h6">發票明細</h2>
        <div role="region" aria-labelledby="ap-invoice-lines" tabindex="0" class="lines">
          <q-markup-table flat bordered>
            <thead><tr><th scope="col">來源／費用</th><th scope="col">數量</th><th scope="col">採購單價</th><th scope="col">採購金額</th><th scope="col">發票單價</th><th scope="col">發票金額</th><th scope="col">改價原因</th></tr></thead>
            <tbody>
              <tr v-for="line in invoice.lines" :key="line.id">
                <th scope="row" class="text-left">{{ line.lineType === 'EXPENSE' ? line.description : `${line.goodsReceiptNumber} · ${line.skuCode}` }}</th>
                <td>{{ line.lineType === 'RECEIPT' ? `${line.quantity} ${line.baseUomCode}` : '—' }}</td>
                <td>{{ line.lineType === 'RECEIPT' ? `${amount(line.poUnitPrice)}／${line.purchaseUomCode}` : '—' }}</td>
                <td>{{ line.lineType === 'RECEIPT' ? amount(line.poLineAmount) : '—' }}</td>
                <td>{{ line.invoiceUnitPrice === null ? '—' : `${amount(line.invoiceUnitPrice)}／${line.purchaseUomCode}` }}</td>
                <td>{{ amount(line.lineAmount) }}</td><td>{{ line.amountOverrideReason || '—' }}</td>
              </tr>
            </tbody>
          </q-markup-table>
        </div>
        <h2 class="text-h6">核銷記錄</h2>
        <p v-if="!invoice.allocations.length" role="status">未有核銷。</p>
        <q-list v-else bordered separator>
          <q-item v-for="item in invoice.allocations" :key="item.id">
            <q-item-section><router-link :to="`/ap/payments/${item.paymentId}`">{{ item.paymentNumber || '付款詳情' }}</router-link></q-item-section>
            <q-item-section>{{ amount(item.amount) }} · {{ timestamp(item.createdAt) }}</q-item-section>
            <q-item-section side>{{ item.status === 'ACTIVE' ? '有效' : '已解除' }}</q-item-section>
          </q-item>
        </q-list>
      </template>
    </div>
  </div>
</template>

<style scoped>
dd { margin-inline-start: 0; overflow-wrap: anywhere; }
dt { font-weight: 600; }
.lines { overflow: auto; max-inline-size: 100%; }
</style>
