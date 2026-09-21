<script setup>
defineProps({
  warnings: { type: Array, default: () => [] },
  issues: { type: Array, default: () => [] }
});
</script>

<template>
  <q-banner v-if="issues.length" class="bg-negative text-white q-mb-md" rounded role="alert">
    <div class="text-weight-medium">啟用阻擋項目</div>
    <ul class="q-ma-none q-pl-md">
      <li v-for="issue in issues" :key="`${issue.field}-${issue.code}`">{{ issue.message }}</li>
    </ul>
  </q-banner>
  <q-banner v-if="warnings.length" class="bg-warning text-dark q-mb-md" rounded aria-label="非阻擋完整度提示">
    <div class="text-weight-medium">資料完整度提示（不影響啟用）</div>
    <ul class="q-ma-none q-pl-md">
      <li v-for="warning in warnings" :key="`${warning.field}-${warning.code}`">{{ warning.message }}</li>
    </ul>
  </q-banner>
</template>
