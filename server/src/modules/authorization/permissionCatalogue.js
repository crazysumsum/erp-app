/**
 * 權限目錄的**正本**。
 *
 * 這份清單在程式碼裡，不在資料庫裡。`permissions` 表是它的投影：由 migration
 * 種入，沒有任何 handler 寫得了它（設計說明見 docs/user-management.md §1.3）。
 *
 * 為什麼權限是程式碼而角色是資料：一個權限的意義由「哪些 route 檢查它」定義，
 * 那件事只有原始碼說得算——資料庫裡憑空多一列 `invoice.approve`，不會讓任何
 * route 開放，只會讓某個管理員以為自己配好了。角色相反，它是「這間公司怎麼分
 * 工」，那會變，而且該由使用者自己改。
 *
 * 新增權限的步驟是三步，缺一不可：改這個檔案 → 寫一支 migration 種進資料庫 →
 * 在 handler 上掛 hasPermission。少了第二步啟動會失敗（PermissionCatalogueService），
 * 少了第三步那個權限誰都用不到（但不會壞）。第一步打錯字則由
 * permissionConventions.test.js 抓。
 */
export const PERMISSION_CATALOGUE = Object.freeze([
  Object.freeze({ name: "user.mgmt", description: "管理用戶與用戶的角色" }),
  Object.freeze({ name: "role.mgmt", description: "管理角色與角色的權限" }),
  Object.freeze({ name: "device.mgmt", description: "審批、拒絕或撤銷設備綁定申請" })
]);

/** 目錄裡所有權限的名字，供比對用。 */
export const PERMISSION_NAMES = Object.freeze(
  PERMISSION_CATALOGUE.map((permission) => permission.name)
);

/**
 * 粒度是「一個管理功能」而不是「一個動作」。
 *
 * 切成 user.read / user.write / user.role.assign 換來的是一份沒有人配得對的
 * 權限清單——實務上會發生的是所有人都被配上全部三個，只是多花三倍維護成本。
 * 要細分的時機是「真的有一個角色只該看不該改」出現的那一天。
 */
