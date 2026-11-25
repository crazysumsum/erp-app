<script>
export const page = {
  name: "ar-opening-invoice-create", path: "/ar/opening-invoices/new", title: "登記期初發票",
  requires: { permissions: ["ar.opening.mgmt"] },
  menu: { group: "accountsReceivable", icon: "playlist_add", order: 15 }
};
</script>
<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { amountInputValid, today } from "@/components/ar/arPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { useSessionStore } from "@/stores/session.js";
import ar from "@/services/ar.js";

const session = useSessionStore(), command = useCommandEvent();
const key = computed(() => `${session.user?.id}:ar-opening-invoice-create`);
const emptyForm = () => ({ customerCode: "", currencyCode: "", openingReference: "", invoiceDate: "", dueDate: "", amount: "", notes: "" });
const form = reactive(emptyForm());
const error = ref(""), errorSummary = ref(null), registered = ref(null);
const customer = ref(null), lookingUp = ref(false);
const busy = computed(() => command.isBusy(key.value));
const uncertain = computed(() => command.isUncertain(key.value));
const locked = computed(() => busy.value || uncertain.value);
const canView = computed(() => session.permissions.includes("ar.view"));

let generation = 0;
let lookupController;
function clearCustomer() {
  lookupController?.abort();
  customer.value = null;
  lookingUp.value = false;
}
watch(() => form.customerCode, () => { clearCustomer(); error.value = ""; }, { flush: "sync" });
watch(key, () => {
  generation += 1;
  clearCustomer();
  Object.assign(form, emptyForm());
  error.value = "";
  registered.value = null;
});
onBeforeUnmount(() => { generation += 1; lookupController?.abort(); });

async function showError(message) {
  error.value = message;
  await nextTick();
  errorSummary.value?.focus();
}

async function lookupCustomer() {
  if (locked.value || lookingUp.value) return;
  const code = form.customerCode.trim();
  clearCustomer();
  error.value = "";
  if (!code || [...code].length > 64) return showError("請輸入有效的客戶代碼。");
  lookupController = new AbortController();
  const { signal } = lookupController;
  lookingUp.value = true;
  try {
    const match = await ar.findOpeningCustomer(code, { signal });
    if (!signal.aborted) customer.value = match;
  } catch (failure) {
    if (!signal.aborted) await showError(failure.message || "查找客戶失敗。");
  } finally {
    if (!signal.aborted) lookingUp.value = false;
  }
}

async function submit() {
  if (busy.value) return;
  error.value = "";
  const pending = command.pending(key.value);
  const openingReference = form.openingReference.trim();
  if (!pending) {
    registered.value = null;
    if (!customer.value) return showError("請查找並核對客戶。");
    if (!openingReference || [...openingReference].length > 50) return showError("請輸入 1 至 50 字的舊發票號碼。");
    if (!amountInputValid(form.amount, 4)) return showError("請輸入大於零且最多有四位小數的截數餘額。");
  }
  const payload = pending?.payload ?? {
    customerId: customer.value.customerId, currencyCode: form.currencyCode.toUpperCase(), openingReference,
    invoiceDate: form.invoiceDate, dueDate: form.dueDate, amount: form.amount,
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {})
  };
  const submittedKey = key.value, submittedGeneration = generation;
  try {
    const result = await command.run(payload, ar.registerOpeningInvoice, submittedKey, { action: "register" });
    if (submittedGeneration !== generation) return;
    registered.value = result;
    Object.assign(form, emptyForm());
  } catch (failure) {
    if (submittedGeneration !== generation || command.isUncertain(submittedKey)) return;
    if (failure.code === "AR_INPUT_INVALID" && failure.details?.field === "amount") {
      await showError("截數餘額的小數位超過此幣別允許的精度。");
    } else {
      await showError(failure.message || "登記期初發票失敗。");
    }
  }
}
</script>

<template>
  <div>
    <PageHeader subtitle="按財務截數清單逐張登記舊系統尚未收齊的發票。登記後即確認入帳。" />
    <form class="q-px-md q-pb-md" @submit.prevent="submit">
      <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md">
        登記結果尚未確認，請重試同一操作以確認結果。
        <template #action><q-btn flat label="重試確認結果" :loading="busy" @click="submit" /></template>
      </q-banner>
      <q-banner v-if="registered" role="status" class="bg-positive text-white q-mb-md">
        已為 {{ registered.customerCode }} — {{ registered.customerName }} 確認期初發票 {{ registered.number }}。
        <template v-if="canView" #action><q-btn flat label="查看發票" :to="`/ar/invoices/${registered.id}`" /></template>
      </q-banner>
      <div class="row q-col-gutter-sm items-center">
        <div class="col-12 col-sm-6 col-md-4">
          <q-input v-model="form.customerCode" name="customerCode" label="客戶代碼" :disable="locked" outlined dense @keydown.enter.prevent="lookupCustomer" />
        </div>
        <div class="col-auto"><q-btn type="button" flat label="查找客戶" :loading="lookingUp" :disable="locked || !form.customerCode.trim()" @click="lookupCustomer" /></div>
      </div>
      <p v-if="customer" role="status" class="q-mt-sm q-mb-none">
        {{ customer.customerCode }} — {{ customer.customerName }}{{ customer.active ? "" : "（已停用）" }}
      </p>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-4"><q-input v-model="form.currencyCode" name="currencyCode" label="幣別代碼" hint="例如 HKD" pattern="[A-Za-z]{3}" maxlength="3" required :disable="locked" outlined dense /></div>
        <div class="col-12 col-md-4"><q-input v-model="form.openingReference" name="openingReference" label="舊發票號碼" required :disable="locked" outlined dense /></div>
        <div class="col-12 col-md-4"><q-input v-model="form.invoiceDate" name="invoiceDate" label="原發票日期" type="date" stack-label :max="today()" required :disable="locked" outlined dense /></div>
        <div class="col-12 col-md-4"><q-input v-model="form.dueDate" name="dueDate" label="原到期日" type="date" stack-label :min="form.invoiceDate || undefined" required :disable="locked" outlined dense /></div>
        <div class="col-12 col-md-4"><q-input v-model="form.amount" name="amount" label="截數餘額" inputmode="decimal" maxlength="19" required :disable="locked" outlined dense /></div>
        <div class="col-12"><q-input v-model="form.notes" name="notes" label="備註（選填）" type="textarea" maxlength="2000" autogrow :disable="locked" outlined dense /></div>
      </div>
      <div v-if="error" ref="errorSummary" role="alert" tabindex="-1" class="bg-negative text-white q-pa-md q-mt-md">{{ error }}</div>
      <q-btn type="submit" color="primary" class="q-mt-md" label="登記期初發票" :loading="busy" :disable="locked || !customer" />
    </form>
  </div>
</template>
