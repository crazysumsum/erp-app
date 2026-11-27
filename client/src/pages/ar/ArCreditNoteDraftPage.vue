<script>
export const page = { name: "ar-credit-note-draft", path: "/ar/credit-notes/draft/:id?", title: "應收貸項草稿",
  requires: { permissions: ["ar.view", "ar.credit.mgmt"] } };
</script>
<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import ArInvoicePicker from "@/components/ar/ArInvoicePicker.vue";
import { amountInputValid, money, today } from "@/components/ar/arPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ar from "@/services/ar.js";

const route = useRoute(), router = useRouter(), session = useSessionStore(), command = useCommandEvent();
const editId = computed(() => route.params.id ? String(route.params.id) : null);
const key = computed(() => `${session.user?.id}:ar-credit-draft:${editId.value ?? "new"}`);
const busy = computed(() => command.isBusy(key.value)), uncertain = computed(() => command.isUncertain(key.value));
const locked = computed(() => busy.value || uncertain.value);
const invoice = ref(null), selected = ref(null), candidates = ref([]);
const form = reactive({ version: null, creditDate: today(), reason: "", notes: "", customerReturnId: null, lines: [] });
const loading = ref(false), readError = ref(""), validation = ref(""), errorMessage = ref(null);
let controller, nextLineKey = 0, active = true;
onBeforeUnmount(() => { active = false; controller?.abort(); });

const displayAmount = (value) => `${invoice.value.currencyCode} ${money(value, invoice.value.currencyDecimalPlaces)}`;
const lineOptions = computed(() => (invoice.value?.lines ?? []).map((line) => ({
  value: line.id, label: `${line.lineNo}. ${line.skuCode} — ${line.skuName}（${displayAmount(line.lineAmount)}）`
})));
const returnOptions = computed(() => [...new Map(candidates.value.map((line) => [line.returnId,
  { value: line.returnId, label: `CRT-${line.returnId} · ${line.returnDate}` }])).values()]);
const returnLines = (line) => candidates.value.filter((row) => row.returnId === form.customerReturnId && row.invoiceLineId === line.invoiceLineId)
  .map((row) => ({ value: row.returnLineId, label: `退貨行 ${row.lineNo}` }));
function addLine(data = {}) {
  form.lines.push({ key: ++nextLineKey, invoiceLineId: null, customerReturnLineId: null, amount: "", baseQuantity: "", description: "", ...data });
}
function changeReturn() { for (const line of form.lines) line.customerReturnLineId = null; }

async function load(draftId, invoiceId) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  invoice.value = null;
  candidates.value = [];
  readError.value = "";
  validation.value = "";
  if (!draftId && !invoiceId) { loading.value = false; return; }
  loading.value = true;
  try {
    if (![draftId, invoiceId].filter(Boolean).every((id) => /^[1-9]\d*$/u.test(String(id)))) throw new Error("找不到單據。");
    const draft = draftId ? await ar.getCreditNote(draftId, { signal }) : null;
    if (draft && draft.status !== "DRAFT") throw new Error("只有草稿可以編輯。");
    const source = await ar.getInvoice(draft?.invoiceId ?? invoiceId, { signal });
    if (source.status !== "CONFIRMED") throw new Error("請選擇已確認的原發票。");
    const sources = await ar.listCreditReturnSources(source.id, { signal });
    if (signal.aborted) return;
    invoice.value = source;
    candidates.value = sources;
    Object.assign(form, { version: draft?.version ?? null, creditDate: draft?.creditDate ?? today(), reason: draft?.reason ?? "", notes: draft?.notes ?? "",
      customerReturnId: draft?.customerReturnId ?? null, lines: [] });
    if (draft) {
      for (const line of draft.lines) addLine({ invoiceLineId: line.invoiceLineId, customerReturnLineId: line.customerReturnLineId,
        baseQuantity: line.baseQuantity ?? "", amount: money(line.amount, source.currencyDecimalPlaces), description: line.description });
    } else addLine();
  } catch (failure) {
    if (!signal.aborted) readError.value = failure.message || "載入貸項草稿失敗";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

const reload = () => load(editId.value, selected.value?.id ?? route.query.invoiceId);
watch([editId, () => route.query.invoiceId], () => { selected.value = null; reload(); }, { immediate: true });
function chooseInvoice(item) { selected.value = item; load(null, item?.id); }

async function showError(message) {
  validation.value = message;
  await nextTick();
  errorMessage.value?.focus();
}

async function submit() {
  if (!invoice.value || busy.value) return;
  let payload = {};
  if (!uncertain.value) {
    if (!form.reason.trim()) return showError("請填寫貸項原因。");
    const invalidLine = form.lines.findIndex((line) => !amountInputValid(line.amount, invoice.value.currencyDecimalPlaces)
      || (invoice.value.lines.length && !line.invoiceLineId));
    if (invalidLine !== -1) return showError(`請核對第 ${invalidLine + 1} 行的發票行及貸項金額。`);
    payload = {
      ...(editId.value ? { version: form.version } : { invoiceId: invoice.value.id }),
      creditDate: form.creditDate, reason: form.reason.trim(), notes: form.notes, customerReturnId: form.customerReturnId,
      lines: form.lines.map(({ invoiceLineId, customerReturnLineId, amount, baseQuantity, description }) =>
        ({ invoiceLineId, customerReturnLineId, amount, baseQuantity: baseQuantity || null, description }))
    };
  }
  const commandKey = key.value, id = editId.value;
  validation.value = "";
  try {
    const result = await command.run(payload, (body) => id ? ar.editCreditNote(id, body) : ar.createCreditNote(body),
      commandKey, { action: id ? "edit" : "create" });
    if (active && key.value === commandKey) {
      notifySuccess("貸項草稿已儲存。");
      await router.push(`/ar/credit-notes/${result.id}`);
    }
  } catch (failure) {
    if (active && key.value === commandKey && !command.isUncertain(commandKey)) await showError(failure.message || "儲存貸項草稿失敗");
  }
}
</script>

<template>
  <div>
    <PageHeader :title="editId ? '編輯貸項草稿' : '新增應收貸項單'" />
    <div class="q-px-md q-pb-md">
      <ArInvoicePicker v-if="!editId" :model-value="selected" label="原發票（可按編號或客戶搜尋）" :disable="locked" class="q-mb-md"
        @update:model-value="chooseInvoice" />
      <q-skeleton v-if="loading" type="rect" aria-label="載入發票及退貨來源" />
      <q-banner v-if="readError" role="alert" class="bg-negative text-white q-mb-md">
        {{ readError }}
        <template #action><q-btn flat type="button" label="重試" @click="reload" /></template>
      </q-banner>
      <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md">
        儲存結果尚未確認。請重送原操作。
        <template #action><q-btn flat type="button" label="重試確認結果" :loading="busy" @click="submit" /></template>
      </q-banner>
      <form v-if="invoice" action="/ar/credit-notes" method="post" aria-label="貸項草稿資料" @submit.prevent="submit">
        <p><strong>原發票</strong> {{ invoice.number }} · {{ invoice.customerName }} · {{ displayAmount(invoice.totalAmount) }}</p>
        <fieldset class="q-ma-none q-pa-md q-mb-md" :disabled="locked">
          <legend>貸項資料</legend>
          <div class="row q-col-gutter-md">
            <q-input v-model="form.creditDate" class="col-12 col-sm-4" label="貸項日期（必填）" name="creditDate" required type="date" :max="today()" stack-label outlined />
            <q-input v-model="form.reason" class="col-12 col-sm-8" label="原因（必填）" name="reason" required maxlength="500" outlined />
            <q-select v-if="returnOptions.length" v-model="form.customerReturnId" class="col-12 col-sm-6" label="連結已過帳退貨單"
              name="customerReturnId" :options="returnOptions" emit-value map-options clearable outlined @update:model-value="changeReturn" />
            <q-input v-model="form.notes" class="col-12" label="備註" name="notes" type="textarea" maxlength="2000" outlined />
          </div>
        </fieldset>
        <fieldset v-for="(line, index) in form.lines" :key="line.key" class="q-ma-none q-pa-md q-mb-md" :disabled="locked">
          <legend>{{ invoice.lines.length ? `貸項第 ${index + 1} 行` : "期初發票貸項" }}</legend>
          <div class="row q-col-gutter-md">
            <q-select v-if="invoice.lines.length" v-model="line.invoiceLineId" class="col-12 col-md-6" label="發票行（必填）"
              :name="`invoiceLine-${index}`" :options="lineOptions" emit-value map-options outlined @update:model-value="line.customerReturnLineId = null" />
            <q-input v-model="line.amount" class="col-12 col-sm-6 col-md-3" :label="`貸項金額（${invoice.currencyCode}，必填）`"
              :name="`amount-${index}`" required inputmode="decimal" outlined />
            <q-input v-if="invoice.lines.length" v-model="line.baseQuantity" class="col-12 col-sm-6 col-md-3"
              label="基本單位數量" :name="`quantity-${index}`" inputmode="numeric" pattern="[1-9][0-9]*" outlined />
            <q-select v-if="returnLines(line).length" v-model="line.customerReturnLineId" class="col-12 col-sm-6" label="關聯退貨行"
              :name="`returnLine-${index}`" :options="returnLines(line)" emit-value map-options clearable outlined />
            <q-input v-model="line.description" class="col-12" label="說明" :name="`description-${index}`" maxlength="500" outlined />
          </div>
          <q-btn v-if="form.lines.length > 1" flat type="button" :disable="locked" :label="`移除第 ${index + 1} 行`" @click="form.lines.splice(index, 1)" />
        </fieldset>
        <p v-if="validation" ref="errorMessage" role="alert" tabindex="-1" class="text-negative">{{ validation }}</p>
        <div class="row q-gutter-sm">
          <q-btn v-if="invoice.lines.length" flat type="button" label="新增貸項行" :disable="locked" @click="addLine()" />
          <q-btn type="submit" color="primary" label="儲存草稿" :loading="busy" :disable="locked" />
          <q-btn flat type="button" label="返回" :to="editId ? `/ar/credit-notes/${editId}` : '/ar/credit-notes'" />
        </div>
      </form>
      <q-btn v-else-if="!loading" flat type="button" label="返回貸項單列表" to="/ar/credit-notes" />
    </div>
  </div>
</template>

<style scoped>
fieldset { min-inline-size: 0; }
</style>
