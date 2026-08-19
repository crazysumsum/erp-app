import { createRouter, createWebHistory } from "vue-router";
import { createAuthGuard } from "@/framework/auth/routeGuard.js";
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

  return router;
}
