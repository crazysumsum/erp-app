<script setup>
import { computed } from "vue";
import appConfig from "@config/app.js";
import DataTable from "@/framework/ui/DataTable.vue";
const props=defineProps({difference:{type:Object,required:true}});
const labels={added:"新增",removed:"刪除",quantityChanged:"數量修改",priceChanged:"售價修改"};
const rows=computed(()=>Object.entries(labels).flatMap(([key,label])=>(props.difference[key]??[]).map((line,index)=>({id:`${key}-${index}`,kind:label,sku:`${line.skuId}／${line.skuUomId}`,before:line.beforeQuantity??line.beforePrice??"—",after:line.afterQuantity??line.afterPrice??"—"}))));
const columns=[{name:"kind",label:"差異",field:"kind",align:"left"},{name:"sku",label:"SKU／UOM ID",field:"sku",align:"left"},{name:"before",label:"原值",field:"before",align:"right"},{name:"after",label:"新值",field:"after",align:"right"}];
</script>
<template><section class="q-mt-md"><h2 class="text-h6 q-ma-none q-mb-md">已儲存的轉換差異</h2><DataTable :rows="rows" :columns="columns" :initial-pagination="{ page: 1, rowsPerPage: appConfig.defaultPageSize, sortBy: null, descending: false }"><template #no-data><p role="status">明細沒有差異。</p></template></DataTable></section></template>
