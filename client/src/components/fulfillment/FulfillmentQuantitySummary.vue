<script setup>
import DataTable from "@/framework/ui/DataTable.vue";
defineProps({lines:{type:Array,required:true}});
const columns=[{name:"line",label:"行",field:"lineNo",align:"left"},{name:"sku",label:"SKU／名稱",field:row=>`${row.skuCode} — ${row.skuName}`,align:"left"},{name:"unit",label:"Base 單位",field:row=>row.baseUom.code,align:"left"},...[["plannedBaseQuantity","計劃"],["allocatedBaseQuantity","累計分配"],["pickedBaseQuantity","已揀"],["shortBaseQuantity","短揀"],["shippedBaseQuantity","已出貨"],["reversedBaseQuantity","已沖銷"]].map(([field,label])=>({name:field,label,field,align:"right"})),...[["activeBaseQuantity","有效 Claim"],["releasedBaseQuantity","已釋放 Claim"],["consumedBaseQuantity","已使用 Claim"]].map(([field,label])=>({name:field,label,field:row=>row.claims[field],align:"right"})),{name:"reason",label:"短揀原因",field:"shortPickReason",align:"left"}];
</script>
<template><div><p>數量均以保存的 Base 單位顯示。累計分配包含重新分配的歷史，不能視為目前可用庫存。</p><DataTable :rows="lines" :columns="columns" :initial-pagination="{page:1,rowsPerPage:100}"><template #bottom><span class="q-pa-sm">{{ lines.length }} 行</span></template></DataTable></div></template>
