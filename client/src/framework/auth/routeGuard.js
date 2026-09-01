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

  // 強制首次改密碼：順序排喺權限檢查之前（見 docs/user-management.md §4.5）。
  // 後端（jwtAuthStrategy 嘅 mcp claim 擋）先係真正嘅關卡，呢度淨係等使用者
  // 見到一個講得通嘅畫面，而唔係一路撞 403。
  if (session.user?.mustChangePassword && to.name !== "change-password") {
    return { allow: false, redirect: { name: "change-password" } };
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
