import { can } from "../authorization/can.js";

/**
 * 根據目標路由嘅 `meta.public` / `meta.requires` 判斷呢次導航要點做。抽成
 * 純函數方便測試——唔使起真正嘅 router 或 pinia 就可以測三種情境。
 *
 * `meta.public` / `meta.requires` 嘅形狀特登同 Phase 4 頁面 metadata 嘅
 * `page.public` / `page.requires` 對齊：Phase 4 由 pages 目錄底下嘅 .vue 檔案
 * 自動生成 routes 嗰陣，淨係將 metadata 複製到 route.meta，呢個函數唔使改。
 */
export function resolveNavigation(to, session) {
  if (to.meta?.public) {
    return { allow: true };
  }

  if (!session.isAuthenticated) {
    return { allow: false, redirect: { name: "login", query: { redirect: to.fullPath } } };
  }

  if (to.meta?.requires && !can(session, to.meta.requires)) {
    return { allow: false, redirect: { name: "forbidden" } };
  }

  return { allow: true };
}

export function createAuthGuard(session) {
  return (to) => {
    const decision = resolveNavigation(to, session);
    return decision.allow ? true : decision.redirect;
  };
}
