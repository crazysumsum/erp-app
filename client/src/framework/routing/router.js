import { watch } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { createAuthGuard, resolveNavigation } from "@/framework/auth/routeGuard.js";
import { discoverPages } from "@/framework/discovery/pages.js";
import { buildRoutes } from "./buildRoutes.js";

/**
 * `history` 同 `pages` 都開放做參數：`history` 等測試可以傳
 * `createMemoryHistory()`（`createWebHistory()` 會綁住瀏覽器嘅真實 history
 * API，多個測試共用同一個 jsdom window 會互相干擾）；`pages` 等測試可以傳
 * 自己嘅 fixture，唔使靠真正嘅 pages 目錄。main.js 會喺呢度傳返
 * `validatePages()` 過咗嘅 discovered pages——路由要生成之前，metadata
 * 已經證實冇問題。
 */
export function createAppRouter({ session, history = createWebHistory(), pages = discoverPages() }) {
  const routes = buildRoutes(pages);
  const router = createRouter({ history, routes });

  router.beforeEach(createAuthGuard(session));

  // 守衛淨係喺導航嗰陣行。session.refresh()（每 15 分鐘，由 watchdog 叫）會重讀
  // roles/permissions 並且換走成個 user object，所以坐喺原地嘅人被撤權之後，冇
  // 任何嘢會重新評估佢仲入唔入得呢一頁——佢會一直留喺度，連同已經攞落嚟嘅資料。
  //
  // 頁內嘅 can() computed 同 v-can 本身已經係響應式，撤權之後啲按鈕會自己收埋；
  // 真正冇人接嘅係呢個導航層面嘅決定。重跑返同一個 resolveNavigation：入唔得就
  // 走，元件 unmount 連帶清走佢記憶體入面嗰份資料。
  //
  // 用 replace 而唔係 push：撤權唔係一次用戶導航，唔應該留低一個歷史紀錄。
  // 呢個分別**測唔出**——兩種寫法撳返上一頁最後都係停喺 /403（push 嗰個會被
  // 守衛再踢一次），所以冇為佢寫測試，只係語意上 replace 啱啲。
  //
  // 冇特登去 diff 新舊權限：resolveNavigation 係純函數，權限冇變就一定係 allow，
  // 重跑嘅成本比一個要記得同步嘅版本號平。
  watch(
    () => session.user,
    () => {
      // 登出／401 唔關呢度事：clear() 之後點走已經各有各嘅路（AppTopbar 嘅
      // handleLogout、main.js 嘅 onUnauthorized），兩條都會去一個冇 redirect
      // query 嘅登入頁。唔攔呢一 case，否則登出會變成帶住「返返去嗰頁」。
      if (!session.isAuthenticated) {
        return;
      }

      const decision = resolveNavigation(router.currentRoute.value, session);

      if (!decision.allow) {
        void router.replace(decision.redirect);
      }
    }
  );

  return router;
}
