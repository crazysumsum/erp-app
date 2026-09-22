/**
 * 左側菜單的群組定義。
 *
 * 頁面自己不決定菜單的順序與標題，只宣告「我屬於哪一組」（`page.menu.group`）。
 * 群組的顯示名稱、排序與圖示集中在這裡，否則「為什麼這一組排在那一組前面」的
 * 答案會散落在幾十個頁面檔案裡。
 *
 * Phase 4 的啟動驗證會檢查每個頁面宣告的 group 都在這份清單裡；打錯字會讓
 * 應用程式在啟動時就指名是哪個檔案，而不是讓那一頁安靜地從菜單消失。
 *
 * icon 用 Material Icons 的名稱（由 @quasar/extras 提供）。
 */
const menuConfig = {
  groups: [
    {
      name: "userManagement",
      label: "用戶管理",
      icon: "people",
      order: 100
    },
    {
      name: "items",
      label: "商品管理",
      icon: "inventory_2",
      order: 200
    },
    {
      name: "suppliers",
      label: "供應商管理",
      icon: "local_shipping",
      order: 300
    },
    {
      name: "customers",
      label: "客戶管理",
      icon: "groups",
      order: 400
    },
    // 目前沒有任何頁面掛在這個群組——buildMenu() 會濾掉沒有頁面的群組，所以
    // 它暫時不會出現在側欄。保留定義是留給日後非用戶管理的系統設定用。
    {
      name: "system",
      label: "系統管理",
      icon: "settings",
      order: 900
    }
  ]
};

export default menuConfig;
