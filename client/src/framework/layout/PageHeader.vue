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
  <!-- q-mb-md：分隔線同下面嘅頁面內容之間留返口氣，唔係貼住嚟。頁面自己嗰個
       內容容器（例如 UsersPage 嘅 `q-px-md q-pb-md`）刻意冇補呢一份上邊
       padding——留喺呢度統一控制，等所有頁面用返同一個間距，唔使逐頁記得
       加。 -->
  <div class="page-header row items-center justify-between q-pa-md q-mb-md">
    <div>
      <div v-if="groupLabel" class="text-caption text-grey-7">{{ groupLabel }}</div>
      <!-- h1：Quasar 嘅 text-h6 淨係管字體大細，同 tag 語意冇關係——用返
           真正嘅 heading tag，用螢幕閱讀器嘅人先可以用「跳去下一個標題」
           嚟導覽（之前呢度成頁都係得返 div，一個標題都搵唔到）。q-ma-none
           係因為原生 <h1> 有瀏覽器預設 margin，唔清返會將 layout 谷開。 -->
      <h1 class="text-h6 q-ma-none">{{ resolvedTitle }}</h1>
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
