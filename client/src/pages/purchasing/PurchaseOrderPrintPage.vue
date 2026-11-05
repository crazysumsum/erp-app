<script>
export const page = { name: "purchase-order-print", path: "/purchasing/purchase-orders/:id/print", title: "採購單列印", requires: { permissions: ["purchasing.view"] } };
</script>
<script setup>
import { computed } from "vue";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { addressText, printKind } from "@/components/purchasing/purchaseOrderPresentation.js";
import { usePurchaseOrder } from "@/composables/purchasing/usePurchaseOrder.js";

const { document, loading, error, load } = usePurchaseOrder();
const kind = computed(() => (document.value ? printKind(document.value.status) : null));
function print() { window.print(); }
</script>

<template>
  <div class="po-print">
    <div class="po-print-actions">
      <PageHeader>
        <template #actions>
          <q-btn v-if="kind" color="primary" :label="kind === 'draft' ? '列印草稿' : '列印 A4'" @click="print" />
          <q-btn v-if="document" flat class="q-ml-sm" label="返回採購單" :to="`/purchasing/purchase-orders/${document.id}`" />
        </template>
      </PageHeader>
    </div>
    <div class="q-px-md q-pb-md">
      <q-skeleton v-if="loading" type="rect" aria-label="載入列印資料" />
      <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load()" /></template></q-banner>
      <article v-else-if="kind" class="po-sheet" data-testid="po-sheet">
        <div v-if="kind === 'draft'" class="po-watermark" aria-hidden="true">草稿</div>
        <h2 class="text-h5 q-mt-none q-mb-sm">{{ appConfig.title }}</h2>
        <h3 class="text-h6 q-my-sm">採購單 {{ document.number }}<span v-if="kind === 'draft'">（草稿，非正式文件）</span></h3>
        <dl class="po-terms">
          <div><dt>供應商</dt><dd>{{ document.supplierCode }} — {{ document.supplierName }}</dd></div>
          <div><dt>訂購地址</dt><dd>{{ addressText(document.orderingAddress) }}</dd></div>
          <div><dt>訂單日期</dt><dd>{{ document.orderDate }}</dd></div>
          <div><dt>預計交期</dt><dd>{{ document.expectedDeliveryDate || "未設定" }}</dd></div>
          <div><dt>貨幣</dt><dd>{{ document.currencyCode }} — {{ document.currencyName }}</dd></div>
          <div><dt>付款條款</dt><dd>{{ document.paymentTerm ? `${document.paymentTerm.code} — ${document.paymentTerm.name}` : "未設定" }}</dd></div>
          <div v-if="document.supplierReference"><dt>供應商參考</dt><dd>{{ document.supplierReference }}</dd></div>
          <div v-if="document.buyerLabel"><dt>採購員</dt><dd>{{ document.buyerLabel }}</dd></div>
        </dl>
        <table>
          <caption class="text-left q-pb-xs">採購明細（{{ document.currencyCode }}）</caption>
          <thead>
            <tr><th colspan="6" scope="colgroup">{{ document.number }}</th></tr>
            <tr><th scope="col">行</th><th scope="col">SKU／名稱</th><th scope="col">數量／單位</th><th scope="col" class="text-right">單價</th><th scope="col" class="text-right">金額</th><th scope="col">交期</th></tr>
          </thead>
          <tbody>
            <tr v-for="line in document.lines" :key="line.id">
              <td>{{ line.lineNumber }}</td>
              <td>{{ line.skuCode }} — {{ line.skuName }}<div v-if="line.supplierItemCode">供應商貨號：{{ line.supplierItemCode }}</div><div v-if="line.lineNote">{{ line.lineNote }}</div></td>
              <td><span class="po-number">{{ line.orderedQuantity }}</span> {{ line.purchaseUomCode }}</td>
              <td class="po-number text-right">{{ line.unitPrice }}</td>
              <td class="po-number text-right">{{ line.lineAmount }}</td>
              <td class="po-number">{{ line.expectedDeliveryDate || "—" }}</td>
            </tr>
          </tbody>
        </table>
        <p class="text-right text-weight-bold q-mt-md" data-testid="po-print-total">總額：{{ document.currencyCode }} {{ document.totalAmount }}</p>
        <div v-if="document.notes"><strong>備註</strong><p class="po-notes">{{ document.notes }}</p></div>
      </article>
      <q-banner v-else-if="document" role="status" class="bg-warning text-dark">目前狀態不允許列印此採購單。</q-banner>
    </div>
  </div>
</template>

<style scoped>
.po-sheet { max-width: 210mm; margin: auto; overflow-wrap: anywhere; }
.po-terms { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem 1rem; margin: 0 0 1rem; }
dt { font-size: .75rem; opacity: .7; }
dd { margin: 0; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 1px solid var(--app-border); padding: 6px; text-align: left; vertical-align: top; }
th.text-right, td.text-right { text-align: right; }
.po-number { white-space: nowrap; }
.po-notes { white-space: pre-line; }
.po-watermark { position: fixed; top: 50%; left: 50%; z-index: 1; transform: translate(-50%, -50%) rotate(-30deg); font-size: 8rem; font-weight: 700; opacity: .12; pointer-events: none; }
@media print {
  .po-print-actions { display: none; }
  .po-sheet { max-width: none; background: white; color: black; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
}
</style>
<style>
@media print {
  @page { size: A4 portrait; margin: 14mm; }
  body:has(.po-print) .q-header, body:has(.po-print) .q-drawer, body:has(.po-print) .q-drawer__backdrop { display: none !important; }
  body:has(.po-print) .q-page-container { padding: 0 !important; }
  body:has(.po-print) .q-page { background: white; }
}
</style>
