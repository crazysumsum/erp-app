/**
 * 應用程式層級的設定。對應 server/config/application.js。
 *
 * 這個目錄只放設定資料，不放邏輯——與後端 config/ 的規則一致。
 */
const appConfig = {
  // 瀏覽器分頁標題的後綴。頁面標題會組成「<頁面標題> · <這個值>」。
  title: "F&M ERP",

  // 表格預設每頁筆數。DataTable（Phase 6）沒有指定時用這個。
  defaultPageSize: 20,

  // 表格允許的每頁筆數選項。
  pageSizeOptions: [10, 20, 50, 100]
};

export default appConfig;
