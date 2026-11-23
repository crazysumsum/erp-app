<script>
export const page = {
  name: "ar-invoice-print", path: "/ar/invoices/:id/print", title: "發票列印",
  requires: { permissions: ["ar.view"] }
};
</script>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import ArInvoicePrintSheet from "@/components/ar/ArInvoicePrintSheet.vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import ar from "@/services/ar.js";
import { useSessionStore } from "@/stores/session.js";

const route = useRoute(), session = useSessionStore();
const invoiceId = computed(() => String(route.params.id));
const validId = computed(() => /^[1-9]\d*$/u.test(invoiceId.value) && Number.isSafeInteger(Number(invoiceId.value)));
const invoice = shallowRef(null), loading = ref(false), error = ref("");
let controller;

async function load() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  error.value = "";
  invoice.value = null;
  if (!validId.value) {
    error.value = "找不到這張發票。";
    loading.value = false;
    return null;
  }
  loading.value = true;
  try {
    const result = await ar.getInvoicePrint(invoiceId.value, { signal });
    if (signal.aborted) return null;
    invoice.value = result;
    return result;
  } catch (failure) {
    if (!signal.aborted) error.value = failure.message || "載入發票列印資料失敗。";
    return null;
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch([invoiceId, () => session.user?.id, () => session.permissions.join("|")], load, { immediate: true });
onBeforeUnmount(() => controller?.abort());

async function printInvoice() {
  if (loading.value) return;
  const current = await load();
  await nextTick();
  if (current && current === invoice.value && !controller.signal.aborted) window.print();
}
</script>

<template>
  <div class="ar-invoice-print">
    <div class="invoice-print-actions">
      <PageHeader>
        <template #actions>
          <q-btn v-if="invoice" color="primary" label="列印 A4" @click="printInvoice" />
          <q-btn v-if="validId" flat label="返回發票詳情" :to="`/ar/invoices/${invoiceId}`" />
          <q-btn v-else flat label="返回發票列表" to="/ar/invoices" />
        </template>
      </PageHeader>
    </div>
    <section class="invoice-print-content q-px-md q-pb-md" aria-label="發票列印資料" :aria-busy="loading">
      <q-skeleton v-if="loading" class="invoice-print-status" type="rect" aria-label="載入發票列印資料" />
      <q-banner v-else-if="error" class="invoice-print-status bg-negative text-white" role="alert">
        {{ error }}
        <template v-if="validId" #action><q-btn flat label="重新載入" @click="load" /></template>
      </q-banner>
      <ArInvoicePrintSheet v-else-if="invoice" :invoice="invoice" :issuer-name="invoice.issuerName"
        :issuer-header="invoice.issuerHeader"
        :payment-instructions="invoice.paymentInstructions" :footer="invoice.footer" />
    </section>
  </div>
</template>

<style>
@media print {
  html:has(.ar-invoice-print), body:has(.ar-invoice-print) { overflow: visible !important; height: auto !important; }
  html:has(.ar-invoice-print) body { position: static !important; page: ar-invoice; }
  body:has(.ar-invoice-print) :is(.q-header, .q-drawer, .q-drawer__backdrop),
  .ar-invoice-print :is(.invoice-print-actions, .invoice-print-status) { display: none !important; }
  body:has(.ar-invoice-print) .q-page-container,
  .ar-invoice-print .invoice-print-content { padding: 0 !important; }
  body:has(.ar-invoice-print) .q-page { min-height: 0 !important; background: white; }
}
</style>
