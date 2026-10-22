/**
 * 權限目錄的**正本**。
 *
 * 這份清單在程式碼裡，不在資料庫裡。`permissions` 表是它的投影：由 migration
 * 種入，沒有任何 handler 寫得了它（設計說明見 docs/user_management/design_spec.md §1.3）。
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
  Object.freeze({ name: "device.mgmt", description: "審批、拒絕或撤銷設備綁定申請" }),
  // item.view／item.mgmt 是查看與管理分權，不是同一件事的兩個顆粒度。現有
  // authorization 沒有 permission inheritance，持有 item.mgmt 不會自動得到
  // item.view；商品管理員角色要兩者都配。設計見
  // docs/items_management/design_spec.md §3.1。
  Object.freeze({ name: "item.view", description: "查看商品、SKU 與商品變更歷史" }),
  Object.freeze({ name: "item.mgmt", description: "管理商品、SKU 與商品主資料" }),
  Object.freeze({ name: "customer.view", description: "查看客戶一般資料與變更歷史" }),
  Object.freeze({ name: "customer.mgmt", description: "管理客戶一般、信用及主資料" }),
  Object.freeze({ name: "customer.approval", description: "審批客戶啟用及封鎖狀態" }),
  Object.freeze({ name: "customer.bank.view", description: "主動查看客戶完整銀行資料及敏感附件" }),
  Object.freeze({ name: "customer.bank.mgmt", description: "管理客戶銀行資料及敏感附件" }),
  Object.freeze({ name: "customer.settings", description: "管理客戶設定及受控分類目錄" }),
  Object.freeze({ name: "business_master.view", description: "查看貨幣、付款條款與變更歷史" }),
  Object.freeze({ name: "business_master.mgmt", description: "管理貨幣與付款條款主資料" }),
  Object.freeze({ name: "supplier.view", description: "查看一般供應商資料與變更歷史" }),
  Object.freeze({ name: "supplier.mgmt", description: "管理供應商一般主資料與一般狀態" }),
  Object.freeze({ name: "supplier.approval", description: "審批供應商啟用及管理封鎖狀態" }),
  Object.freeze({ name: "supplier.bank.view", description: "查看供應商完整銀行資料" }),
  Object.freeze({ name: "supplier.bank.mgmt", description: "管理供應商銀行資料" }),
  Object.freeze({ name: "supplier.settings", description: "管理供應商模組參數" }),
  Object.freeze({ name: "inventory.view", description: "查看庫存、批次、異動及匯出" }),
  Object.freeze({ name: "inventory.operation", description: "執行一般庫存、預留、調撥及盤點操作" }),
  Object.freeze({ name: "inventory.mgmt", description: "管理倉庫、庫位、期初庫存及上線" }),
  Object.freeze({ name: "inventory.adjust", description: "執行庫存調整、狀態轉移、沖銷及盤點過帳" }),
  Object.freeze({ name: "inventory.fefo.override", description: "在仍符合庫存資格時偏離 FEFO 揀貨次序" }),
  Object.freeze({ name: "sales.operation", description: "執行銷售預留及其釋放或取消" }),
  Object.freeze({ name: "sales.view", description: "查看報價、銷售訂單及匯出" }),
  Object.freeze({ name: "sales.mgmt", description: "管理報價、銷售訂單與確認操作" }),
  Object.freeze({ name: "sales.import", description: "匯入銷售訂單及管理外部接單" }),
  Object.freeze({ name: "fulfillment.view", description: "查看履約、出貨及歷史資料" }),
  Object.freeze({ name: "fulfillment.reverse", description: "沖銷已確認出貨" }),
  Object.freeze({ name: "fulfillment.operation", description: "執行履約庫存分配及出庫" }),
  // receiving.operation 與 receiving.expiry.override 早已被 InventoryPostingService
  // 的收貨 provider 路徑要求（RECEIVING_RECEIPT.requiredCallerPermission 與
  // OVERRIDE_PERMISSION），但一直不在目錄裡——沒有角色配得上不存在的權限，所以那條
  // 路徑在正式環境是走不通的。啟動自檢比對目錄與資料庫，不會抓到「程式要求一個
  // 目錄裡沒有的權限」，所以今天沒有任何東西報錯。設計見
  // docs/purchasing_receiving_management/03_design_spec.md §6.1。
  Object.freeze({ name: "purchasing.view", description: "查看採購單、收貨單、數量、金額及來源歷史" }),
  Object.freeze({ name: "purchasing.mgmt", description: "管理採購單草稿、提交、撤回、取消及關閉未收數量" }),
  Object.freeze({ name: "purchasing.approval", description: "審批指定給自己的採購單" }),
  Object.freeze({ name: "purchasing.settings", description: "管理採購模組參數" }),
  Object.freeze({ name: "receiving.operation", description: "建立及確認收貨單" }),
  Object.freeze({ name: "receiving.expiry.override", description: "在剩餘效期不足時以原因批准收貨例外" })

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
