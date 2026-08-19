// 掃 src/pages 底下所有 .vue 檔案，用 eager 模式（唔係 lazy import）係因為
// 啟動驗證（validatePages.js）需要喺 app 真正 mount 之前，同步噴到每個頁面
// 嘅 metadata——如果淨係攞返一個 () => import(...) 嘅 factory，validate 嗰陣
// 仲未知道個 component 存唔存在。
const modules = import.meta.glob("../../pages/**/*.vue", { eager: true });

/**
 * 將 glob 結果轉做 { filePath, page, component } 嘅陣列。純粹讀取，唔做任何
 * 驗證——驗證分喺 validatePages.js，等兩者可以獨立測試。
 *
 * `globModules` 開放做參數，等測試可以傳自己嘅 fixture，唔使靠真正嘅
 * pages 目錄。正式程式碼唔傳，用返上面 import.meta.glob 掃到嘅結果。
 */
export function discoverPages(globModules = modules) {
  return Object.entries(globModules).map(([filePath, module]) => ({
    filePath,
    page: module.page,
    component: module.default
  }));
}
