<script setup>
import { onBeforeUnmount, ref } from "vue";
import { money } from "./arPresentation.js";
import ar from "@/services/ar.js";

const selected = defineModel({ type: Object, default: null });
const props = defineProps({
  label: { type: String, required: true },
  customerId: { type: Number, default: null },
  currencyCode: { type: String, default: null },
  excludeInvoiceId: { type: Number, default: null },
  outstandingOnly: Boolean,
  disable: Boolean
});
const options = ref([]), error = ref(""), loading = ref(false);
let controller;
onBeforeUnmount(() => controller?.abort());

async function filter(query, update, abort) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  loading.value = true;
  error.value = "";
  try {
    const { rows } = await ar.listInvoices({ status: "CONFIRMED", customerId: props.customerId, currencyCode: props.currencyCode,
      outstandingOnly: props.outstandingOnly || undefined, q: query.trim(), rowsPerPage: 25, signal });
    if (!signal.aborted) update(() => { options.value = rows.filter(({ id }) => id !== props.excludeInvoiceId); });
  } catch (failure) {
    if (!signal.aborted) {
      abort();
      error.value = failure.message || "載入發票失敗";
    }
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

const labelFor = (invoice) => `${invoice.number} — ${invoice.customerName}（${invoice.currencyCode} ${money(
  props.outstandingOnly ? invoice.outstandingAmount : invoice.totalAmount, invoice.currencyDecimalPlaces)}）`;
</script>

<template>
  <q-select v-model="selected" :label="label" name="invoice" :options="options" :option-label="labelFor" option-value="id"
    :error="Boolean(error)" :error-message="error" :disable="disable" :loading="loading" use-input clearable outlined @filter="filter">
    <template #no-option><q-item><q-item-section>沒有符合條件的發票</q-item-section></q-item></template>
  </q-select>
</template>
