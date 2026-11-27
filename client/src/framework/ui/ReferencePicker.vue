<script setup>
import { onBeforeUnmount, ref } from "vue";

const props = defineProps({
  label: { type: String, required: true },
  search: { type: Function, required: true },
  optionLabel: { type: Function, default: row => [row?.code, row?.name].filter(Boolean).join(" — ") }
});
const selection = defineModel({ type: Object, default: null });
const options = ref([]);
const error = ref("");
const query = ref("");
let controller;

function cancel() {
  controller?.abort();
}
onBeforeUnmount(cancel);

async function filter(input, update) {
  cancel();
  const request = new AbortController();
  controller = request;
  query.value = input.trim();
  error.value = "";
  try {
    const rows = query.value ? await props.search(query.value, request.signal) : [];
    if (!request.signal.aborted) update(() => { options.value = rows; });
  } catch {
    if (request.signal.aborted) return;
    error.value = "搜尋失敗，請重新輸入關鍵字。";
    update(() => { options.value = []; });
  }
}
</script>

<template>
  <q-select v-model="selection" :label="label" :options="options" :option-label="optionLabel"
    option-value="id" use-input input-debounce="250" clearable dense outlined
    :error="Boolean(error)" :error-message="error" @filter="filter" @filter-abort="cancel">
    <template #no-option>
      <q-item v-if="!error"><q-item-section role="status">{{ query ? "沒有符合條件的資料" : "請輸入代碼或名稱搜尋" }}</q-item-section></q-item>
    </template>
  </q-select>
</template>
