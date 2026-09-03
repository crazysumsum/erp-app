<script setup>
// 登入、設備待審批、修改密碼、404、冇權限——呢五頁全部都係「未入到
// AppShell 之前／之外」嘅獨立版面，本身有一份幾乎一樣但各自複製咗一份嘅
// 置中卡片樣式（bg-grey-2 window-height row justify-center items-center +
// 各自寫死嘅 q-card width）。抽出嚟做一個共用版面，換色／調間距／改
// 響應式只需要改呢一個檔案。
import appConfig from "@config/app.js";
</script>

<template>
  <div class="auth-layout">
    <div class="auth-layout__brand">
      <q-icon name="apartment" size="24px" />
      <span>{{ appConfig.title }}</span>
    </div>

    <q-card bordered class="auth-layout__card">
      <slot />
    </q-card>
  </div>
</template>

<style scoped>
.auth-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px 16px;
  background: var(--app-bg);
}

.auth-layout__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--q-primary);
  font-size: 1.05rem;
  font-weight: 600;
}

.auth-layout__card {
  width: 100%;
  max-width: 420px;
}
</style>
