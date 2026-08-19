import menuConfig from "@config/menu.js";
import { can } from "@/framework/authorization/can.js";

/**
 * 由已驗證嘅頁面 metadata 組菜單樹：按 `menu.group` 分組、group 之間同
 * group 入面嘅項目都跟 `order` 排；冇 `menu` 欄位嘅頁面（詳情頁、編輯頁）
 * 唔會出現喺度。權限唔夠嘅項目喺呢度已經被過濾，Sidebar（Phase 5）唔使
 * 自己再判斷一次。
 */
export function buildMenu(discoveredPages, session) {
  const itemsByGroup = new Map(menuConfig.groups.map((group) => [group.name, []]));

  for (const { page } of discoveredPages) {
    if (!page.menu) {
      continue;
    }
    if (page.requires && !can(session, page.requires)) {
      continue;
    }

    itemsByGroup.get(page.menu.group).push({
      name: page.name,
      path: page.path,
      title: page.title,
      icon: page.menu.icon,
      order: page.menu.order
    });
  }

  return menuConfig.groups
    .map((group) => ({ ...group, items: itemsByGroup.get(group.name).sort((a, b) => a.order - b.order) }))
    .filter((group) => group.items.length > 0)
    .sort((a, b) => a.order - b.order);
}
