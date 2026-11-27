<script setup>
import { useId } from "vue";

const issues = defineModel({ type: Array, required: true });
const titleId = useId();
</script>

<template>
  <q-dialog
    :model-value="issues.length > 0"
    :aria-labelledby="titleId"
    @update:model-value="issues = []"
  >
    <q-card>
      <q-card-section>
        <h2 :id="titleId" class="text-h6 q-ma-none">SKU 啟用失敗</h2>
        <ul class="q-mb-none q-pl-lg">
          <li v-for="(message, index) in issues" :key="index">{{ message }}</li>
        </ul>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="關閉" autofocus @click="issues = []" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
