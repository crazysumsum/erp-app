<script>
export const page = {
  name: "ap-supplier-refunds", path: "/ap/refunds/:id?", title: "供應商退款",
  requires: { permissions: ["ap.view"] }, menu: { group: "accountsPayable", icon: "currency_exchange", order: 25 }
};
</script>

<script setup>
import { useRoute } from "vue-router";
import RefundWorkspace from "@/components/refunds/RefundWorkspace.vue";

const route = useRoute();
</script>

<template>
  <RefundWorkspace :key="route.path" area="ap" :id="route.params.id" />
</template>
