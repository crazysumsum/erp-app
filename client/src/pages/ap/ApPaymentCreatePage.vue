<script>
export const page = { name: "ap-payment-create", path: "/ap/payments/new", title: "登記付款", requires: { permissions: ["ap.view", "ap.payment.mgmt"] } };
</script>
<script setup>
import { computed, nextTick, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { amountInputValid, paymentMethodLabels, today } from "@/components/ap/apPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const command = useCommandEvent();
const key = computed(() => `${session.user?.id}:ap-payment-create`);
const form = reactive({
  supplierId: String(route.query.supplierId ?? ""), currencyCode: String(route.query.currencyCode ?? ""), paymentDate: today(),
  amount: "", paymentMethod: "BANK_TRANSFER", reference: "", notes: ""
});
const error = ref(""), alert = ref(null);
const methods = Object.entries(paymentMethodLabels).map(([value, label]) => ({ value, label }));
const uncertain = computed(() => command.isUncertain(key.value));
const busy = computed(() => command.isBusy(key.value));
const locked = computed(() => uncertain.value || busy.value);
const referenceRequired = computed(() => ["BANK_TRANSFER", "CHEQUE"].includes(form.paymentMethod));

async function showError(message) {
  error.value = message;
  await nextTick();
  alert.value?.focus();
}

async function submit() {
  const pending = command.pending(key.value);
  const supplierId = Number(form.supplierId), currencyCode = form.currencyCode.trim().toUpperCase();
  error.value = "";
  if (!pending) {
    if (!Number.isSafeInteger(supplierId) || supplierId < 1) return showError("請輸入有效的供應商 ID。");
    if (!/^[A-Z]{3}$/u.test(currencyCode)) return showError("請輸入三個英文字母的貨幣代碼。");
    if (!amountInputValid(form.amount, 4)) return showError("請輸入大於零的十進制金額。");
    if (referenceRequired.value && !form.reference.trim()) return showError("請輸入轉帳參考或支票號。");
    if (form.paymentMethod === "OTHER" && !form.notes.trim()) return showError("請在備註說明付款方式。");
  }
  const payload = pending?.payload ?? { ...form, supplierId, currencyCode, reference: form.reference.trim(), notes: form.notes.trim() };
  try {
    const result = await command.run(payload, (body) => ap.createPayment(body), key.value, { action: "create" });
    notifySuccess("已登記付款草稿。");
    await router.push(`/ap/payments/${result.id}`);
  } catch (failure) {
    if (!command.isUncertain(key.value)) await showError(failure.message || "登記付款失敗。");
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
      <form method="post" @submit.prevent="submit">
        <div class="row q-col-gutter-md">
          <div class="col-12 col-sm-6"><q-input v-model="form.supplierId" label="供應商 ID" name="supplierId" inputmode="numeric" pattern="[1-9][0-9]*" required :disable="locked" outlined dense /></div>
          <div class="col-12 col-sm-6"><q-input v-model="form.currencyCode" label="貨幣代碼" name="currencyCode" autocapitalize="characters" maxlength="3" pattern="[A-Za-z]{3}" required :disable="locked" outlined dense /></div>
          <div class="col-12 col-sm-6"><q-input v-model="form.paymentDate" label="付款日期" name="paymentDate" type="date" stack-label :max="today()" required :disable="locked" outlined dense /></div>
          <div class="col-12 col-sm-6"><q-input v-model="form.amount" label="付款金額" name="amount" inputmode="decimal" required :disable="locked" outlined dense /></div>
          <div class="col-12 col-sm-6"><q-select v-model="form.paymentMethod" label="付款方式" name="paymentMethod" :options="methods" emit-value map-options :disable="locked" outlined dense /></div>
          <div class="col-12 col-sm-6"><q-input v-model="form.reference" :label="form.paymentMethod === 'CHEQUE' ? '支票號' : form.paymentMethod === 'BANK_TRANSFER' ? '轉帳參考' : '參考號'" name="reference" maxlength="190" :required="referenceRequired" :disable="locked" outlined dense /></div>
          <div class="col-12"><q-input v-model="form.notes" :label="form.paymentMethod === 'OTHER' ? '付款方式說明' : '備註'" name="notes" type="textarea" maxlength="2000" :required="form.paymentMethod === 'OTHER'" :disable="locked" outlined dense /></div>
        </div>
        <div v-if="error" ref="alert" role="alert" tabindex="-1" class="text-negative q-mt-md">{{ error }}</div>
        <div class="row q-gutter-sm q-mt-md">
          <q-btn color="primary" type="submit" label="登記付款草稿" :loading="busy" :disable="locked" />
          <q-btn flat label="返回付款列表" to="/ap/payments" />
        </div>
      </form>
    </div>
  </div>
</template>
