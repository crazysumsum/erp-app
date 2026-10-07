<script>
export const page={name:"sales-order-create",path:"/sales/orders/new",title:"新增銷售訂單",requires:{permissions:["sales.view","sales.mgmt"]}};
</script>
<script setup>
import { useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SalesOrderForm from "@/components/sales/SalesOrderForm.vue";
import sales from "@/services/sales.js";
const router=useRouter();
</script>
<template><div><PageHeader subtitle="建立人工 Draft；儲存不會保留庫存。" /><main class="q-px-md q-pb-md"><SalesOrderForm :on-save="sales.createOrder" @saved="result=>router.push(`/sales/orders/${result.salesOrder.id}`)" /></main></div></template>
