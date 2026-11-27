<script>
export const page = {
  name: "supplier-returns", path: "/supplier-returns/:id?", title: "退回供應商",
  requires: { permissions: ["returns.view"] }, menu: { group: "returns", icon: "local_shipping", order: 20 }
};
</script>

<script setup>
import { useRoute } from "vue-router";
import ReturnWorkspace from "@/components/returns/ReturnWorkspace.vue";

const route = useRoute();
</script>

<template>
  <ReturnWorkspace :key="route.path" kind="supplier" :id="route.params.id" />
</template>
