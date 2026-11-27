<script setup>
import AuthLayout from "@/framework/layout/AuthLayout.vue";
</script>

<template>
  <AuthLayout>
    <q-card-section class="text-center q-pa-lg">
      <q-icon name="block" size="48px" color="negative" />
      <h1 class="text-h6 q-ma-none q-mt-md">沒有權限</h1>
      <div class="text-grey-7 q-mt-sm">你沒有權限查看此頁。</div>
      <q-btn flat color="primary" class="q-mt-md" label="回首頁" :to="{ name: 'home' }" />
    </q-card-section>
  </AuthLayout>
</template>
