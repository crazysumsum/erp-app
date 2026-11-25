<script>
export const page = {
  name: "ar-refunds", path: "/ar/refunds/:id?", title: "客戶退款",
  requires: { permissions: ["ar.view"] }, menu: { group: "accountsReceivable", icon: "currency_exchange", order: 25 }
};
</script>

<script setup>
import { useRoute } from "vue-router";
import RefundWorkspace from "@/components/refunds/RefundWorkspace.vue";

const route = useRoute();
</script>

<template>
  <RefundWorkspace :key="route.path" area="ar" :id="route.params.id" />
</template>
