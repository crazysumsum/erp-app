<script setup>
import { onUnmounted, ref } from "vue";

const props = defineProps({
  label: { type: String, required: true },
  filename: { type: String, required: true },
  load: { type: Function, required: true }
});
const downloading = ref(false);
const error = ref("");
let controller;

async function download() {
  if (downloading.value) return;
  controller = new AbortController();
  const { signal } = controller;
  downloading.value = true;
  error.value = "";
  try {
    const { blob, fileName } = await props.load(signal);
    if (signal.aborted) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName || props.filename;
    document.body.appendChild(link);
    try { link.click(); } finally {
      link.remove();
      URL.revokeObjectURL(url);
    }
  } catch (cause) {
    if (!signal.aborted) error.value = cause?.message || "無法匯出 CSV";
  } finally {
    downloading.value = false;
  }
}

onUnmounted(() => controller?.abort());
</script>

<template>
  <div>
    <q-btn type="button" flat icon="download" :label="label" :loading="downloading" @click="download" />
    <p v-if="error" role="alert" class="q-mb-none text-negative">{{ error }}</p>
  </div>
</template>
