<script setup>
import { onErrorCaptured, ref, watch } from "vue";
import { useRoute } from "vue-router";

// 攔截頁面例外，顯示錯誤區塊而唔係白畫面。`return false` 阻止錯誤再向上傳
// 到 Vue 嘅全域 handler，同時停低子樹其餘部分嘅渲染——呢個位置本身已經係
// 錯誤最終應該被攔截嘅地方。轉頁嗰陣清返 error：唔係咁嘅話，用戶由一個
// 壞咗嘅頁面轉去第二頁，都會繼續見到舊嗰個錯誤畫面。
const error = ref(null);
const route = useRoute();

onErrorCaptured((caughtError) => {
  error.value = caughtError;
  return false;
});

watch(
  () => route.fullPath,
  () => {
    error.value = null;
  }
);
</script>

<template>
  <q-banner v-if="error" class="bg-negative text-white q-ma-md">
    <template #avatar>
      <q-icon name="error" />
    </template>
    呢一頁出咗問題：{{ error.message }}
  </q-banner>
  <slot v-else />
</template>
