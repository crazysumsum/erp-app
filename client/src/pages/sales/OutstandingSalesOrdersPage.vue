<script>
export const page={name:"outstanding-sales-orders",path:"/sales/orders/outstanding",title:"未完成銷售訂單",requires:{permissions:["sales.view"]},menu:{group:"salesOrderManagement",icon:"pending_actions",order:21}};
</script>
<script setup>
import SalesOrdersPage from "./SalesOrdersPage.vue";
</script>
<template><SalesOrdersPage outstanding /></template>
