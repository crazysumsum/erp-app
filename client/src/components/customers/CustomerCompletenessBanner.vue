<script setup>
defineProps({ completeness: { type: Object, required: true } });
</script>
<template><q-banner v-if="completeness.issues.length" class="bg-negative text-white q-mb-md" role="alert"><div class="text-weight-medium">啟用阻擋項目</div><ul class="q-ma-none q-pl-md"><li v-for="item in completeness.issues" :key="item.code">{{ item.message }}</li></ul></q-banner><q-banner v-if="completeness.warnings.length" class="bg-warning text-dark q-mb-md" aria-label="非阻擋完整度提示"><div class="text-weight-medium">資料完整度提示（不影響啟用）</div><ul class="q-ma-none q-pl-md"><li v-for="item in completeness.warnings" :key="item.code">{{ item.message }}</li></ul></q-banner></template>
