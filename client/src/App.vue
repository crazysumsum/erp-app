<script setup>
// Phase 3 加咗路由之後，內容由路由決定。Phase 1 嘅驗證用畫面搬咗去
// pages/HomePage.vue；Phase 5 會喺呢度加返 AppShell（QLayout + QDrawer +
// QPageContainer），登入頁到時會繼續唔套用嗰個版面。
</script>

<template>
  <router-view />
</template>
