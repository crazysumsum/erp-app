<script setup>
import ReferencePicker from "@/framework/ui/ReferencePicker.vue";
import supplier from "@/services/supplier.js";

const props = defineProps({
  activeOnly: Boolean,
  label: { type: String, default: "供應商" }
});
const selection = defineModel({ type: Object, default: null });

async function search(query, signal) {
  const { rows } = await supplier.list({
    page: 1, rowsPerPage: 20, filter: query, signal,
    ...(props.activeOnly ? { status: "active" } : { includeArchived: true })
  });
  return rows;
}

const supplierLabel = row => [row?.supplierCode, row?.supplierName].filter(Boolean).join(" — ");
</script>

<template>
  <ReferencePicker v-model="selection" :label="label" :search="search" :option-label="supplierLabel" />
</template>
