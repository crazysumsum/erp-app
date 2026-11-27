<script setup>
import { formatMoney } from "@/framework/ui/numberFormat.js";
import { watchPostEffect } from "vue";
import { money, quantityText } from "@/components/ar/arPresentation.js";

const props = defineProps({
  issuerName: { type: String, required: true },
  issuerHeader: { type: String, default: "" },
  paymentInstructions: { type: String, default: "" },
  footer: { type: String, default: "" },
  invoice: { type: Object, required: true }
});

watchPostEffect((onCleanup) => {
  const rootStyle = document.documentElement.style;
  const property = "--ar-invoice-print-reference";
  rootStyle.setProperty(property, JSON.stringify(`發票 ${props.invoice.number}`));
  onCleanup(() => rootStyle.removeProperty(property));
});
</script>

<template>
  <article class="invoice-print-sheet" aria-label="發票預覽">
    <header>
      <p class="text-h6 q-ma-none">{{ issuerName }}</p>
      <p v-if="issuerHeader" class="invoice-print-company-text q-ma-none">{{ issuerHeader }}</p>
      <h2 class="text-h5 q-mt-xs q-mb-md">發票 {{ invoice.number }}</h2>
      <dl class="invoice-print-summary">
        <div>
          <dt>客戶</dt>
          <dd>{{ invoice.customerName }}</dd>
        </div>
        <div>
          <dt>發票日期</dt>
          <dd>{{ invoice.invoiceDate }}</dd>
        </div>
        <div>
          <dt>帳單地址</dt>
          <dd>
            <address>
              <div v-for="(line, index) in invoice.billingAddress" :key="index">{{ line }}</div>
            </address>
          </dd>
        </div>
        <div>
          <dt>到期日</dt>
          <dd>{{ invoice.dueDate }}</dd>
        </div>
        <div>
          <dt>付款條款</dt>
          <dd>{{ [invoice.paymentTermCode, invoice.paymentTermName].filter(Boolean).join(" — ") || "—" }}</dd>
        </div>
        <div>
          <dt>幣別</dt>
          <dd>{{ invoice.currencyCode }}</dd>
        </div>
      </dl>
    </header>
    <div class="invoice-print-table">
      <table>
        <caption>發票明細（{{ invoice.currencyCode }}）</caption>
        <thead>
          <tr>
            <th scope="col" class="line-number">行</th>
            <th scope="col">SKU／品名</th>
            <th scope="col">數量 × 單價</th>
            <th scope="col" class="text-right">金額</th>
            <th scope="col">銷售單／出貨單</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in invoice.lines" :key="line.lineNo">
            <td>{{ line.lineNo }}</td>
            <td>{{ line.skuCode }} — {{ line.skuName }}</td>
            <td>{{ quantityText(line) }}</td>
            <td class="text-right">{{ formatMoney(money(line.lineAmount, invoice.currencyDecimalPlaces)) }}</td>
            <td><div>{{ line.salesOrderNumber }}</div><div>{{ line.shipmentNumber }}</div></td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colspan="3" class="text-right">小計</th>
            <td colspan="2" class="text-right">{{ invoice.currencyCode }} {{ formatMoney(invoice.totalAmount, invoice.currencyCode, invoice.currencyDecimalPlaces) }}</td>
          </tr>
          <tr>
            <th scope="row" colspan="3" class="text-right">總額</th>
            <td colspan="2" class="text-right text-weight-bold">{{ invoice.currencyCode }} {{ formatMoney(invoice.totalAmount, invoice.currencyCode, invoice.currencyDecimalPlaces) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div v-if="paymentInstructions || footer" class="invoice-print-end">
      <section v-if="paymentInstructions" class="invoice-print-payment">
        <h3 class="text-subtitle1 text-weight-bold q-mb-none">付款資料</h3>
        <p>{{ paymentInstructions }}</p>
      </section>
      <footer v-if="footer" class="invoice-print-footer">{{ footer }}</footer>
    </div>
  </article>
</template>

<style scoped>
.invoice-print-sheet { max-inline-size: 210mm; margin-inline: auto; overflow-wrap: anywhere; }
.invoice-print-summary { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem 1rem; margin: 0 0 1rem; }
dt { font-size: .875em; font-weight: 600; }
dd { margin: 0; }
address { font-style: normal; }
.invoice-print-table { overflow-x: auto; }
table { inline-size: 100%; min-inline-size: 31rem; border-collapse: collapse; }
caption { text-align: start; font-weight: 600; padding-block-end: .35em; }
th, td { border-block-end: 1px solid var(--app-border); padding: .5em; text-align: start; vertical-align: top; }
.text-right { text-align: end; }
.line-number { inline-size: 3em; }
.invoice-print-company-text, .invoice-print-payment, .invoice-print-footer { white-space: pre-wrap; }

@media print {
  .invoice-print-sheet { page: ar-invoice; max-inline-size: none; margin: 0; background: white; color: black; font-family: var(--ar-invoice-print-font); font-size: 10pt; line-height: 1.35; }
  .invoice-print-table { overflow: visible; }
  table { min-inline-size: 0; table-layout: fixed; }
  th, td { border-block-end-color: #bdbdbd; padding: .32em .45em; }
  header, tr, .invoice-print-end { break-inside: avoid; }
  thead { display: table-header-group; }
  tfoot { display: table-row-group; }
}
</style>

<style>
@media print {
  html:has(.ar-invoice-print) {
    --ar-invoice-print-font: Roboto, "-apple-system", "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
}

@page ar-invoice {
  size: A4 portrait;
  margin: 14mm;

  @top-right {
    content: var(--ar-invoice-print-reference, "");
    color: #333;
    font-family: var(--ar-invoice-print-font);
    font-size: 9pt;
  }

  @bottom-right {
    content: "第 " counter(page) " 頁，共 " counter(pages) " 頁";
    color: #333;
    font-family: var(--ar-invoice-print-font);
    font-size: 9pt;
  }
}
</style>
