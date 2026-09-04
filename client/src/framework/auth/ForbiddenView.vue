<script setup>
import AuthLayout from "@/framework/layout/AuthLayout.vue";
</script>

<template>
  <AuthLayout>
    <q-card-section class="text-center q-pa-lg">
      <q-icon name="block" size="48px" color="negative" />
      <h1 class="text-h6 q-ma-none q-mt-md">冇權限</h1>
      <div class="text-grey-7 q-mt-sm">你冇權限查看呢一頁。</div>
    </q-card-section>
  </AuthLayout>
</template>
