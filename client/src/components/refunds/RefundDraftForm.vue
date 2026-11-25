<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { useRouter } from "vue-router";
import { money, paymentMethodLabels, today, toUnits } from "@/components/ar/arPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import refunds, { REFUND_REJECTIONS } from "@/services/refunds.js";

const props = defineProps({ area: { type: String, required: true }, base: { type: String, required: true } });
const router = useRouter(), command = useCommandEvent({ definitiveRejections: REFUND_REJECTIONS }), controller = new AbortController();
const amountHint = useId();
onBeforeUnmount(() => controller.abort());
const credit = ref(null), credits = ref([]), creditPage = ref(1), pages = ref(1), loading = ref(false), error = ref("");
const refundDate = ref(today()), amount = ref(""), paymentMethod = ref(null), reference = ref(""), notes = ref("");
const paymentMethods = Object.entries(paymentMethodLabels).map(([value, label]) => ({ label, value }));
const busy = computed(() => command.isBusy());
const pending = computed(() => command.pending());
const formatCredit = row => `${row.number} · ${row.customerName ?? row.supplierName} · ${row.currencyCode} ${money(row.availableAmount, row.currencyDecimalPlaces)}`;

function amountRule(raw) {
  const value = (raw ?? "").trim();
  if (!/^\d{1,15}(?:\.\d{1,4})?$/u.test(value) || !/[1-9]/u.test(value)) return "請輸入大於零的金額";
  if (!credit.value) return true;
  const { currencyDecimalPlaces, availableAmount } = credit.value;
  if (/[1-9]/u.test((value.split(".")[1] ?? "").slice(currencyDecimalPlaces))) {
    return `此幣別最多 ${currencyDecimalPlaces} 位小數`;
  }
  return toUnits(value) <= toUnits(availableAmount) || "退款金額超過貸項可用額";
}

async function loadCredits(page = creditPage.value) {
  loading.value = true;
  error.value = "";
  try {
    const result = await refunds.credits(props.area, page, controller.signal);
    creditPage.value = result.page;
    pages.value = Math.max(1, Math.ceil(result.total / result.pageSize));
    credits.value = result.items.filter(row => toUnits(row.availableAmount) > 0n);
  } catch (failure) {
    if (!controller.signal.aborted) error.value = failure.message || "未能載入貸項單";
  } finally {
    loading.value = false;
  }
}

async function refreshCredit(id) {
  loading.value = true;
  try {
    const row = await refunds.credit(props.area, id, controller.signal);
    const available = row.status === "CONFIRMED" && toUnits(row.availableAmount) > 0n;
    credit.value = available ? row : null;
    credits.value = credits.value.flatMap(choice => choice.id !== id ? [choice] : available ? [row] : []);
  } catch {
    // The failed command's message still applies. A new source page request can be retried.
    credit.value = null;
    credits.value = credits.value.filter(choice => choice.id !== id);
  } finally {
    loading.value = false;
  }
}

async function save() {
  error.value = "";
  const body = pending.value?.payload ?? {
    creditNoteId: credit.value.id, refundDate: refundDate.value, amount: amount.value.trim(), paymentMethod: paymentMethod.value,
    reference: reference.value.trim(), notes: notes.value.trim()
  };
  try {
    const result = await command.run(body, data => refunds.create(props.area, data), "", { action: "create" });
    if (!controller.signal.aborted) await router.replace(`${props.base}/${result.id}`);
  } catch (failure) {
    if (controller.signal.aborted) return;
    if (!pending.value && ["REFUND_EXCEEDS_CREDIT", "REFUND_CREDIT_STATE_CONFLICT"].includes(failure.code)) {
      await refreshCredit(body.creditNoteId);
    }
    error.value = failure.message || "未能建立退款草稿";
  }
}

onMounted(() => loadCredits());
</script>

<template>
  <q-banner v-if="error" role="alert" class="text-negative q-mb-md">
    {{ error }}
    <template v-if="!credits.length && !pending" #action>
      <q-btn flat label="重新載入貸項單" :disable="loading" @click="loadCredits()" />
    </template>
  </q-banner>
  <q-banner v-if="pending" role="status" class="q-mb-md">
    建立結果尚未確認。
    <template #action><q-btn flat label="重試原操作" :loading="busy" @click="save" /></template>
  </q-banner>
  <q-form method="post" aria-label="建立退款草稿" class="refund-form" @submit="save">
    <q-select v-model="credit" outlined label="來源貸項單 *" name="creditNoteId" aria-required="true" :options="credits" option-value="id" :option-label="formatCredit"
      :loading="loading" :disable="loading || busy || !!pending" :rules="[value => !!value || '請選擇來源貸項單']" lazy-rules="ondemand">
      <template #no-option>
        <q-item><q-item-section>{{ loading ? "載入貸項單…" : "本頁沒有可退款的貸項單" }}</q-item-section></q-item>
      </template>
    </q-select>
    <q-pagination v-if="pages > 1" :model-value="creditPage" :max="pages" :max-pages="5" direction-links
      aria-label="貸項單頁次" class="q-mb-md" :disable="loading || busy || !!pending" @update:model-value="loadCredits" />
    <q-input v-model="refundDate" outlined type="date" :max="today()" label="退款日期 *" name="refundDate" stack-label required
      :disable="busy || !!pending" :rules="[value => !!value && value <= today() || '請輸入今日或之前的日期']" lazy-rules="ondemand" />
    <p :id="amountHint" class="q-mb-xs">可退款金額 {{ credit ? `${credit.currencyCode} ${money(credit.availableAmount, credit.currencyDecimalPlaces)}` : "—" }}</p>
    <q-input v-model="amount" outlined label="退款金額 *" name="amount" inputmode="decimal" maxlength="20" required
      :aria-describedby="amountHint" :disable="busy || !!pending" :rules="[amountRule]" lazy-rules="ondemand" />
    <q-select v-model="paymentMethod" outlined label="退款方式 *" name="paymentMethod" aria-required="true" :options="paymentMethods" emit-value map-options
      :disable="busy || !!pending" :rules="[value => !!value || '請選擇退款方式']" lazy-rules="ondemand" />
    <q-input v-model="reference" outlined label="參考號" name="reference" maxlength="190" class="q-mb-md" :disable="busy || !!pending" />
    <q-input v-model="notes" outlined label="備註" name="notes" type="textarea" maxlength="2000" class="q-mb-md" :disable="busy || !!pending" />
    <q-btn type="submit" color="primary" label="建立草稿" :loading="busy" :disable="!!pending || loading" />
  </q-form>
</template>

<style scoped>
.refund-form { max-inline-size: 32rem; }
</style>
