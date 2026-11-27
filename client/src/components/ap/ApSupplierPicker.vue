<script setup>
import { onBeforeUnmount, ref } from "vue";
import supplier from "@/services/supplier.js";

const props = defineProps({
  activeOnly: Boolean,
  label: { type: String, default: "供應商" }
});
const selection = defineModel({ type: Object, default: null });
const options = ref([]), error = ref("");
let searchId = 0;
onBeforeUnmount(() => { searchId += 1; });

async function filter(input, update) {
  const id = ++searchId, query = input.trim();
  error.value = "";
  if (!query) {
    update(() => { options.value = []; });
    return;
  }
  try {
    const { rows } = await supplier.list({ page: 1, rowsPerPage: 20, filter: query,
      ...(props.activeOnly ? { status: "active" } : { includeArchived: true }) });
    if (id === searchId) update(() => { options.value = rows; });
  } catch (failure) {
    if (id !== searchId) return;
    error.value = failure.message || "搜尋供應商失敗。";
    update(() => { options.value = []; });
  }
}

const supplierLabel = (row) => row ? row.supplierCode + " — " + row.supplierName : "";
</script>

<template>
  <q-select v-model="selection" :label="label" :options="options" :option-label="supplierLabel"
    option-value="id" use-input input-debounce="250" clearable dense outlined
    :error="Boolean(error)" :error-message="error" @filter="filter">
    <template #no-option><q-item><q-item-section>輸入供應商代碼或名稱搜尋。</q-item-section></q-item></template>
  </q-select>
</template>
