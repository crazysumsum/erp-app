<script>
export const page = { name: "ap-payment-create", path: "/ap/payments/new", title: "登記付款", requires: { permissions: ["ap.view", "ap.payment.mgmt"] } };
</script>
<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import ApCurrencyPicker from "@/components/ap/ApCurrencyPicker.vue";
import ApSupplierPicker from "@/components/ap/ApSupplierPicker.vue";
import { amountInputValid, paymentMethodLabels, today } from "@/components/ap/apPresentation.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const key = computed(() => session.user ? `erp.ap.payment-create.${session.user.id}` : null);
const canSearchSuppliers = computed(() => session.permissions.includes("supplier.view"));
const emptyForm = () => ({
  paymentDate: today(), amount: "", paymentMethod: "BANK_TRANSFER", reference: "", notes: ""
});
const form = reactive(emptyForm());
const restoredParty = ref(null), supplier = ref(null), currency = ref("");
const debt = ref(null), loadingDebt = ref(false), debtError = ref("");
const canEnterPayment = computed(() => Boolean(debt.value || canSearchSuppliers.value));
const supplierIdQuery = computed(() => restoredParty.value?.supplierId ?? route.query.supplierId);
const currencyQuery = computed(() => restoredParty.value?.currencyCode ?? route.query.currencyCode);
const error = ref(""), alert = ref(null);
const methods = Object.entries(paymentMethodLabels).map(([value, label]) => ({ value, label }));
const pending = ref(null), busy = ref(false), storageBlocked = ref(false);
const paymentParty = computed(() => {
  const row = debt.value;
  if (row && (!pending.value || (row.supplierId === pending.value.supplierId && row.currencyCode === pending.value.currencyCode))) {
    return row.supplierCode + " — " + row.supplierName;
  }
  return supplier.value?.supplierName ?? String(pending.value?.supplierId ?? "");
});
const uncertain = computed(() => pending.value !== null && !busy.value);
const locked = computed(() => !key.value || storageBlocked.value || pending.value !== null || busy.value);
const referenceRequired = computed(() => ["BANK_TRANSFER", "CHEQUE"].includes(form.paymentMethod));
const uncertainErrors = new Set(["TIMEOUT", "NETWORK_ERROR", "TRANSACTION_OUTCOME_UNKNOWN", "IDEMPOTENCY_IN_PROGRESS", "AP_EVENT_CONFLICT"]);
const definiteRejections = new Set(["AP_INPUT_INVALID", "AP_DATE_IN_FUTURE", "AP_SUPPLIER_NOT_FOUND", "AP_PREPAYMENT_REQUIRES_ACTIVE_SUPPLIER"]);
const storageError = "此分頁無法保留付款操作，請恢復分頁儲存後重開頁面再試。";
let visible = true;
onBeforeUnmount(() => { visible = false; });

watch(key, (ownerKey) => {
  pending.value = null;
  restoredParty.value = null;
  supplier.value = null;
  currency.value = "";
  busy.value = false;
  storageBlocked.value = false;
  error.value = "";
  Object.assign(form, emptyForm());
  if (!ownerKey) return;
  try {
    const body = JSON.parse(sessionStorage.getItem(ownerKey));
    if (body === null) return;
    if (typeof body.eventId !== "string" || !/^[0-9a-f-]{36}$/u.test(body.eventId)) throw new Error(storageError);
    const { eventId: _eventId, supplierId, currencyCode, ...fields } = body;
    pending.value = body;
    restoredParty.value = { supplierId, currencyCode };
    Object.assign(form, fields);
  } catch {
    storageBlocked.value = true;
    error.value = storageError;
  }
}, { immediate: true });

watch(supplier, (row) => { currency.value = row?.defaultCurrencyCode ?? ""; });
const debtRetry = ref(0);
watch([key, supplierIdQuery, currencyQuery, debtRetry], async ([owner, rawId, currencyCode], _previous, onCleanup) => {
  debt.value = null;
  debtError.value = "";
  loadingDebt.value = false;
  const supplierId = Number(rawId);
  if (!owner || !Number.isSafeInteger(supplierId) || supplierId < 1 || !/^[A-Z]{3}$/u.test(currencyCode ?? "")) return;
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  loadingDebt.value = true;
  try {
    const report = await ap.getAging({ supplierId, currencyCode, signal: controller.signal });
    if (!controller.signal.aborted) debt.value = report.items.find((row) => row.supplierId === supplierId && row.currencyCode === currencyCode) ?? null;
  } catch (failure) {
    if (!controller.signal.aborted) debtError.value = failure.message || "無法核對未付發票。";
  } finally {
    if (!controller.signal.aborted) loadingDebt.value = false;
  }
}, { immediate: true });

function clearRecord(ownerKey, body) {
  const current = JSON.parse(sessionStorage.getItem(ownerKey));
  if (current?.eventId === body.eventId) sessionStorage.removeItem(ownerKey);
  if (visible && key.value === ownerKey) pending.value = null;
}

async function showError(message) {
  error.value = message;
  await nextTick();
  alert.value?.focus();
}

async function submit() {
  const ownerKey = key.value;
  if (!ownerKey || busy.value || storageBlocked.value) return;
  const previous = pending.value;
  let body = previous;
  error.value = "";
  if (!previous) {
    if (loadingDebt.value || debtError.value) return;
    const supplierId = debt.value?.supplierId ?? supplier.value?.id;
    const currencyCode = debt.value?.currencyCode ?? currency.value;
    if (!supplierId || (!debt.value && !canSearchSuppliers.value)) return showError("請選擇供應商。");
    if (!currencyCode) return showError("請選擇幣別。");
    if (!amountInputValid(form.amount, 4)) return showError("請輸入大於零的十進制金額。");
    if (referenceRequired.value && !form.reference.trim()) return showError("請輸入轉帳參考或支票號。");
    if (form.paymentMethod === "OTHER" && !form.notes.trim()) return showError("請在備註說明付款方式。");
    body = { ...form, supplierId, currencyCode, reference: form.reference.trim(), notes: form.notes.trim(), eventId: crypto.randomUUID() };
  }
  // Store before sending so reload during the request still reuses the same event.
  try {
    sessionStorage.setItem(ownerKey, JSON.stringify(body));
  } catch {
    storageBlocked.value = true;
    return showError(storageError);
  }
  pending.value = body;
  busy.value = true;
  try {
    const result = await ap.createPayment(body);
    clearRecord(ownerKey, body);
    if (visible && key.value === ownerKey) {
      notifySuccess("已登記付款草稿。");
      await router.push(`/ap/payments/${result.id}`);
    }
  } catch (failure) {
    if (definiteRejections.has(failure.code) ||
        (!previous && failure.status >= 400 && failure.status < 500 && !uncertainErrors.has(failure.code))) {
      try { clearRecord(ownerKey, body); } catch { /* Keep the original operation if browser storage cannot clear it. */ }
    }
    if (visible && key.value === ownerKey && (previous || !pending.value)) await showError(failure.message || "登記付款失敗。");
  } finally {
    if (visible && key.value === ownerKey) busy.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader subtitle="登記已發生的付款，確認後取號及核銷。" />
    <div class="q-px-md q-pb-md">
      <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md">
        付款草稿的結果尚未確認。
        <template #action><q-btn flat label="重試原操作" :loading="busy" @click="submit" /></template>
      </q-banner>
      <p v-if="!pending && loadingDebt" role="status">核對未付發票中…</p>
      <q-banner v-else-if="!pending && debtError" role="alert" class="bg-negative text-white q-mb-md">
        {{ debtError }}
        <template #action><q-btn flat label="重試" @click="debtRetry += 1" /></template>
      </q-banner>
      <p v-else-if="!pending && !canEnterPayment" role="status">
        請從未付發票或應付帳齡表登記付款。搜尋供應商需要「查看供應商」權限。
      </p>
      <form v-if="pending || (canEnterPayment && !loadingDebt && !debtError)" method="post" @submit.prevent="submit">
        <div class="row q-col-gutter-md">
          <template v-if="pending || debt">
            <div class="col-12 col-sm-6"><q-input :model-value="paymentParty" label="供應商" readonly outlined dense /></div>
            <div class="col-12 col-sm-6"><q-input :model-value="pending?.currencyCode ?? debt?.currencyCode" label="幣別" readonly outlined dense /></div>
          </template>
          <template v-else>
            <div class="col-12 col-sm-6"><ApSupplierPicker v-model="supplier" :disable="locked" /></div>
            <div class="col-12 col-sm-6"><ApCurrencyPicker v-model="currency" :disable="locked || !supplier" /></div>
          </template>
          <div class="col-12 col-sm-6"><q-input v-model="form.paymentDate" label="付款日期" name="paymentDate" type="date" stack-label :max="today()" required :disable="locked" outlined dense /></div>
          <div class="col-12 col-sm-6"><q-input v-model="form.amount" label="付款金額" name="amount" inputmode="decimal" required :disable="locked" outlined dense /></div>
          <div class="col-12 col-sm-6"><q-select v-model="form.paymentMethod" label="付款方式" name="paymentMethod" :options="methods" emit-value map-options :disable="locked" outlined dense /></div>
          <div class="col-12 col-sm-6"><q-input v-model="form.reference" :label="form.paymentMethod === 'CHEQUE' ? '支票號' : form.paymentMethod === 'BANK_TRANSFER' ? '轉帳參考' : '參考號'" name="reference" maxlength="190" :required="referenceRequired" :disable="locked" outlined dense /></div>
          <div class="col-12"><q-input v-model="form.notes" :label="form.paymentMethod === 'OTHER' ? '付款方式說明' : '備註'" name="notes" type="textarea" maxlength="2000" :required="form.paymentMethod === 'OTHER'" :disable="locked" outlined dense /></div>
        </div>
        <div class="row q-gutter-sm q-mt-md">
          <q-btn color="primary" type="submit" label="登記付款草稿" :loading="busy" :disable="locked" />
        </div>
      </form>
      <div v-if="error" ref="alert" role="alert" tabindex="-1" class="text-negative q-mt-md">{{ error }}</div>
      <q-btn flat class="q-mt-md" label="返回付款列表" to="/ap/payments" />
    </div>
  </div>
</template>
