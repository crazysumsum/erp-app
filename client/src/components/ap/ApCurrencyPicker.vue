<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import supplier from "@/services/supplier.js";

const selection = defineModel({ type: String, default: "" });
const options = ref(null), loading = ref(false), error = ref("");
let mounted = true;
onBeforeUnmount(() => { mounted = false; });

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const rows = await supplier.currencyOptions();
    if (mounted) options.value = rows.map(({ code, name }) => ({ value: code, label: code + " — " + name }));
  } catch (failure) {
    if (mounted) error.value = failure.message || "載入幣別失敗。";
  } finally {
    if (mounted) loading.value = false;
  }
}

onMounted(load);
watch([options, selection], ([rows, code]) => {
  if (rows && code && !rows.some((row) => row.value === code)) selection.value = "";
});
</script>

<template>
  <q-select v-model="selection" label="幣別" :options="options ?? []" emit-value map-options
    :loading="loading" :error="Boolean(error)" :error-message="error" dense outlined>
    <template v-if="error" #append><q-btn flat dense label="重試" @click.stop="load" /></template>
  </q-select>
</template>
