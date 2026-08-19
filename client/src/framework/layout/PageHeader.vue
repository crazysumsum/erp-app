<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import menuConfig from "@config/menu.js";

// 標題直接由目前路由嘅 meta.title 讀出（buildRoutes.js 由 page.title 填），
// 頁面唔使自己再傳一次。麵包屑淨係一層：頁面所屬嘅菜單 group 標籤（冇
// menu 欄位嘅頁面，例如詳情/編輯頁，就冇呢一行）。右側 slot 俾頁面放
// 操作按鈕（例如「新增」）。
const route = useRoute();

const groupLabel = computed(
  () => menuConfig.groups.find((group) => group.name === route.meta?.menuGroup)?.label ?? null
);
</script>

<template>
  <div class="row items-center justify-between q-pa-md">
    <div>
      <div v-if="groupLabel" class="text-caption text-grey-7">{{ groupLabel }}</div>
      <div class="text-h6">{{ route.meta?.title }}</div>
    </div>
    <div>
      <slot name="actions" />
    </div>
  </div>
</template>
