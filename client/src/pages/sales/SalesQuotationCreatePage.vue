<script>
export const page = { name: "sales-quotation-create", path: "/sales/quotations/new", title: "新增報價", requires: { permissions: ["sales.view", "sales.mgmt"] } };
</script>
<script setup>
import { ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SalesQuotationForm from "@/components/sales/SalesQuotationForm.vue";
import sales from "@/services/sales.js";
const created=ref(null);
</script>
<template><div><PageHeader subtitle="建立草稿；儲存不會保留庫存。" /><main class="q-px-md q-pb-md"><template v-if="created"><q-banner role="status" class="bg-positive text-dark q-mb-md">報價 {{ created.number }} 已儲存；總額 {{ created.currencyCode }} {{ created.totalAmount }}</q-banner><q-btn color="primary" label="編輯已儲存報價" :to="`/sales/quotations/${created.id}/edit`" /></template><SalesQuotationForm v-else :on-save="sales.createQuotation" @saved="result=>created=result.quotation" /></main></div></template>
