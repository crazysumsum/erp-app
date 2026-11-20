<script>
export const page = { name: "ar-receipt-create", path: "/ar/receipts/new", title: "登記收款", requires: { permissions: ["ar.view", "ar.receipt.mgmt"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { amountInputValid, paymentMethodLabels, today } from "@/components/ar/arPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ar from "@/services/ar.js";

const router = useRouter(), session = useSessionStore();
const command = useCommandEvent();
const key = computed(() => `${session.user?.id}:ar-receipt-create`);
const form = reactive({ party: null, receiptDate: today(), amount: "", paymentMethod: "BANK_TRANSFER", reference: "", notes: "" });
const parties = ref([]), submitError = ref("");
const methodOptions = Object.entries(paymentMethodLabels).map(([value, label]) => ({ value, label }));
const uncertain = computed(() => command.isUncertain(key.value));
const busy = computed(() => command.isBusy(key.value));
const locked = computed(() => uncertain.value || busy.value);

// 客戶及幣別：由仍有未收額嘅已確認發票揀（首期流程係收款後核銷到發票）；一個客戶每個幣別一個選項。
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
onMounted(async () => {
  try {
    const { rows } = await ar.listInvoices({ outstandingOnly: true, page: 1, rowsPerPage: 100, signal: controller.signal });
    parties.value = [...new Map(rows.map((row) => [`${row.customerId}:${row.currencyCode}`, { value: `${row.customerId}:${row.currencyCode}`,
      label: `${row.customerCode} — ${row.customerName}（${row.currencyCode}）`, customerId: row.customerId, currencyCode: row.currencyCode, decimalPlaces: row.currencyDecimalPlaces }])).values()];
  } catch (failure) {
    if (!controller.signal.aborted) submitError.value = failure.message || "載入客戶選項失敗";
  }
});
const party = computed(() => parties.value.find((option) => option.value === form.party) ?? null);
const amountError = computed(() => (form.amount && party.value && !amountInputValid(form.amount, party.value.decimalPlaces) ? `請輸入大於零、最多 ${party.value.decimalPlaces} 位小數的金額` : ""));
const ready = computed(() => party.value && form.receiptDate && form.amount && !amountError.value);

async function submit() {
  submitError.value = "";
  const { customerId, currencyCode } = party.value;
  const payload = { customerId, currencyCode, receiptDate: form.receiptDate, amount: form.amount, paymentMethod: form.paymentMethod,
    ...(form.reference.trim() ? { reference: form.reference.trim() } : {}), ...(form.notes.trim() ? { notes: form.notes.trim() } : {}) };
  try {
    const result = await command.run(payload, (body) => ar.createReceipt(body), key.value, { action: "create" });
    notifySuccess("已登記收款草稿；請核對後確認。");
    await router.push(`/ar/receipts/${result.id}`);
  } catch (failure) {
    if (!command.isUncertain(key.value)) submitError.value = failure.message || "登記收款失敗";
  }
}
</script>

<template>
  <div>
    <PageHeader subtitle="登記後是草稿；確認才取號，之後可核銷。草稿不可修改，填錯請取消後重新登記。" />
    <div class="q-px-md q-pb-md">
      <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md" data-testid="ar-receipt-create-uncertain">
        登記收款的結果尚未確認；請重試同一操作以確認結果，不會重複登記。期間不能修改內容。
        <template #action><q-btn flat label="重試確認結果" :loading="busy" @click="submit" /></template>
      </q-banner>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6"><q-select v-model="form.party" label="客戶及幣別" :options="parties" hint="只列有未收發票的客戶" emit-value map-options :disable="locked" outlined dense /></div>
        <div class="col-12 col-sm-6 col-md-3"><q-input v-model="form.receiptDate" label="收款日期" type="date" stack-label :max="today()" :disable="locked" outlined dense /></div>
        <div class="col-12 col-sm-6 col-md-3"><q-input v-model="form.amount" label="金額" inputmode="decimal" :error="Boolean(amountError)" :error-message="amountError" :disable="locked" outlined dense /></div>
        <div class="col-12 col-sm-6 col-md-3"><q-select v-model="form.paymentMethod" label="收款方式" :options="methodOptions" emit-value map-options :disable="locked" outlined dense /></div>
        <div class="col-12 col-sm-6 col-md-9"><q-input v-model="form.reference" label="參考號" maxlength="190" :disable="locked" outlined dense /></div>
        <div class="col-12"><q-input v-model="form.notes" label="備註" type="textarea" maxlength="2000" autogrow :disable="locked" outlined dense /></div>
      </div>
      <q-banner v-if="submitError" role="alert" class="bg-negative text-white q-mt-md">{{ submitError }}</q-banner>
      <div class="row q-gutter-sm q-mt-md">
        <q-btn color="primary" label="登記收款草稿" :loading="busy" :disable="!ready || locked" @click="submit" />
        <q-btn flat label="返回收款列表" to="/ar/receipts" />
      </div>
    </div>
  </div>
</template>
