<script setup>
import { onBeforeUnmount, ref } from "vue";

const props = defineProps({
  download: { type: Function, required: true },
  fallbackFilename: { type: String, required: true },
  disabled: Boolean
});
const error = ref(""), busy = ref(false);
let controller;
onBeforeUnmount(() => controller?.abort());

async function save() {
  if (props.disabled || busy.value) return;
  controller = new AbortController();
  const { signal } = controller;
  busy.value = true;
  error.value = "";
  try {
    const { blob, fileName } = await props.download({ signal });
    if (signal.aborted) return;
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName || props.fallbackFilename;
      link.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (failure) {
    if (!signal.aborted) error.value = failure.message || "匯出帳齡失敗，請重試。";
  } finally {
    if (!signal.aborted) busy.value = false;
  }
}
</script>

<template>
  <div>
    <q-btn type="button" outline label="匯出 CSV" :loading="busy" :disable="disabled" @click="save" />
    <p v-if="error" role="alert" class="text-negative q-mt-sm q-mb-none">{{ error }}</p>
  </div>
</template>
