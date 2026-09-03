<script setup>
import { computed, ref } from "vue";
import { buildMenu } from "@/framework/discovery/buildMenu.js";
import { discoverPages } from "@/framework/discovery/pages.js";
import ErrorBoundary from "@/framework/errors/ErrorBoundary.vue";
import { useSessionStore } from "@/stores/session.js";
import AppSidebar from "./AppSidebar.vue";
import AppTopbar from "./AppTopbar.vue";

// `pages` 開放做 prop 方便測試傳 fixture，唔使靠真正嘅 pages 目錄。正式
// 程式碼唔傳，用返 discoverPages() 掃到嘅結果——同 router.js 嘅 `pages`
// 參數用緊同一套 discovered pages，兩者理應一致（都係 main.js 開機嗰陣
// validatePages() 驗證過嗰份）。
const props = defineProps({
  pages: { type: Array, default: () => discoverPages() }
});

const session = useSessionStore();
const menu = computed(() => buildMenu(props.pages, session));
const drawerOpen = ref(true);
</script>

<template>
  <!--
    冇傳 `view`，用返 Quasar 預設值 "hhh lpr fff"：header 一定跨成個闊度，
    drawer 喺 header 落面先開始。試過用 "lHh Lpr lFf"（想抄 Quasar 官方
    quick-start 範例），結果 drawer 由 y=0 開始同 header 疊埋，將 Topbar
    嗰個開關按鈕都遮咗——因為嗰個範例假設冇留位俾 header 嘅左上角，同呢度
    嘅設計唔啱。
  -->
  <q-layout>
    <q-header bordered class="bg-white text-grey-9">
      <AppTopbar @toggle-drawer="drawerOpen = !drawerOpen" />
    </q-header>

    <!--
      `show-if-above`：闊畫面永遠顯示（唔可以覆蓋內容），窄畫面預設收埋、
      變做浮喺內容之上嘅抽屜——呢個係 Quasar 內建行為，唔使自己寫
      breakpoint 判斷。
    -->
    <q-drawer v-model="drawerOpen" show-if-above bordered>
      <AppSidebar :menu="menu" />
    </q-drawer>

    <!--
      app-page-bg：Quasar 冇幫 QPage 設預設背景色，之前每個頁面自己包一層
      bg-grey-2 嘅 div（見 HomePage.vue 改之前嘅版本），而家喺呢度統一設，
      頁面唔使再各自處理。用 theme.css 嗰個 --app-bg token 而唔係 Quasar
      內建嘅 bg-grey-2，等成個 app（連埋 AuthLayout 嗰幾頁）用返同一種
      背景色。
    -->
    <q-page-container>
      <q-page class="app-page-bg">
        <ErrorBoundary>
          <router-view />
        </ErrorBoundary>
      </q-page>
    </q-page-container>
  </q-layout>
</template>
