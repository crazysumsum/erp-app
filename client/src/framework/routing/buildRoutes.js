import ForbiddenView from "@/framework/auth/ForbiddenView.vue";
import AppShell from "@/framework/layout/AppShell.vue";
import NotFoundView from "./NotFoundView.vue";

/**
 * 由已驗證嘅頁面 metadata 生成 vue-router 嘅 routes。Public 頁面（例如登入
 * 頁）留喺頂層，唔套用 AppShell；其餘全部做 AppShell 呢個父路由嘅
 * children。403／404 係框架自己嘅路由，唔經 pages 目錄發現。
 */
export function buildRoutes(discoveredPages) {
  const publicRoutes = [];
  const protectedRoutes = [];

  for (const { page, component } of discoveredPages) {
    const route = {
      path: page.path,
      name: page.name,
      component,
      meta: { title: page.title, public: !!page.public, requires: page.requires, menuGroup: page.menu?.group }
    };

    if (page.public) {
      publicRoutes.push(route);
    } else {
      protectedRoutes.push(toChildRoute(route));
    }
  }

  return [
    ...publicRoutes,
    { path: "/403", name: "forbidden", component: ForbiddenView, meta: { public: true } },
    {
      path: "/",
      component: AppShell,
      children: protectedRoutes
    },
    { path: "/:pathMatch(.*)*", name: "not-found", component: NotFoundView, meta: { public: true } }
  ];
}

// vue-router 嘅 children path 係相對父路由，所以要斬走開頭嘅「/」；首頁
// 「/」本身要變做空字串先會啱啱好對應父路由自己嗰個位置。
function toChildRoute(route) {
  return { ...route, path: route.path === "/" ? "" : route.path.replace(/^\//, "") };
}
