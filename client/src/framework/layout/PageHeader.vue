<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import menuConfig from "@config/menu.js";

// 標題預設由目前路由嘅 meta.title 讀出（buildRoutes.js 由 page.title 填），
// 大部分頁面唔使自己再傳一次；`title`／`subtitle` 開放做 prop，俾需要補充
// 一句說明嘅頁面（例如 DeviceApprovalsPage）覆蓋。明確宣告呢兩個 prop，
// 亦順便擋咗佢哋透過 attrs fallthrough 落去根元素——冇宣告之前 `title`
// 會變成原生 HTML `title` attribute，喺成個標題列度 hover 就彈瀏覽器
// tooltip。麵包屑淨係一層：頁面所屬嘅菜單 group 標籤（冇 menu 欄位嘅頁面，
// 例如詳情/編輯頁，就冇呢一行）。右側 slot 俾頁面放操作按鈕（例如「新增」）。
const props = defineProps({
  title: { type: String, default: null },
  subtitle: { type: String, default: null }
});

const route = useRoute();

const groupLabel = computed(
  () => menuConfig.groups.find((group) => group.name === route.meta?.menuGroup)?.label ?? null
);
const resolvedTitle = computed(() => props.title ?? route.meta?.title);
</script>

<template>
  <div class="page-header row items-center justify-between q-pa-md">
    <div>
      <div v-if="groupLabel" class="text-caption text-grey-7">{{ groupLabel }}</div>
      <div class="text-h6">{{ resolvedTitle }}</div>
      <div v-if="subtitle" class="text-caption text-grey-7 q-mt-xs">{{ subtitle }}</div>
    </div>
    <div>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-header {
  border-bottom: 1px solid var(--app-border);
}
</style>
