<script>
export const page = {
  name: "customer-returns", path: "/customer-returns/:id?", title: "客戶退貨",
  requires: { permissions: ["returns.view"] }, menu: { group: "returns", icon: "assignment_return", order: 10 }
};
</script>

<script setup>
import { useRoute } from "vue-router";
import ReturnWorkspace from "@/components/returns/ReturnWorkspace.vue";

const route = useRoute();
</script>

<template>
  <ReturnWorkspace :key="route.path" kind="customer" :id="route.params.id" />
</template>
