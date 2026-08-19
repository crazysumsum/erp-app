<script setup>
// Phase 5 會將呢個換成真正嘅 QLayout + QDrawer + QToolbar 版面。Phase 4 淨係
// 需要路由結構已經將受保護嘅頁面包喺一個共同嘅父路由之下——buildRoutes.js
// 將呢個元件掛做父路由，落地 AppShell 嗰陣只需要改呢一個檔案，唔使再改
// 路由生成邏輯。
</script>

<template>
  <router-view />
</template>
