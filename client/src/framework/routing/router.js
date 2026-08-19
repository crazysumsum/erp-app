import { createRouter, createWebHistory } from "vue-router";
import authConfig from "@config/auth.js";
import ForbiddenView from "@/framework/auth/ForbiddenView.vue";
import { createAuthGuard } from "@/framework/auth/routeGuard.js";
import LoginPage from "@/pages/LoginPage.vue";

// Phase 4 會用 pages/**/*.vue 嘅 metadata（`import.meta.glob`）自動生成呢份
// routes，呢度暫時手寫，只為咗俾 Phase 3 嘅 guard 有嘢好測。route.meta 嘅
// 形狀特登同頁面嘅 `export const page` 對齊（見 routeGuard.js 頂部註解），
// 到時淨係換生成方式，guard 邏輯唔使改。
const routes = [
  {
    path: authConfig.loginPath,
    name: "login",
    component: LoginPage,
    meta: { public: true }
  },
  {
    path: "/403",
    name: "forbidden",
    component: ForbiddenView,
    meta: { public: true }
  },
  {
    path: "/",
    name: "home",
    component: () => import("@/pages/HomePage.vue")
  }
];

/**
 * `history` 開放做參數，等測試可以傳 `createMemoryHistory()`——`createWebHistory()`
 * 會綁住瀏覽器嘅真實 history API，多個測試共用同一個 jsdom window 嗰陣會互相
 * 干擾。正式應用（main.js）唔傳呢個參數，用返預設嘅 `createWebHistory()`。
 */
export function createAppRouter({ session, history = createWebHistory() }) {
  const router = createRouter({ history, routes });

  router.beforeEach(createAuthGuard(session));

  return router;
}
