/**
 * CSV／formula injection 防護（OWASP「CSV Injection」）。使用者輸入嘅
 * 字串（SKU Code、名稱、分類、品牌……）一旦原封不動寫入 CSV，開返出嚟嗰個
 * 試算表程式（Excel／Google Sheets）如果見到某個欄位開頭係 `=`、`+`、`-`、
 * `@`，會將成個欄位當做公式執行，而唔係當純文字顯示——呢個系統嘅 SKU
 * Code／名稱冇限制唔可以用呢幾隻字開頭（design_spec DEC-002：SKU Code
 * 「只 trim 首尾空白、拒絕空字串／控制字元」，`=`／`+`／`-`／`@` 唔屬於
 * 控制字元），所以匯出／匯入結果 CSV 都要喺呢一層擋。
 *
 * 做法：開頭係呢幾隻觸發字元就前面加一個單引號 `'`——試算表程式會將呢個
 * 欄位當純文字顯示（連個引號都唔顯示），唔會執行做公式，亦唔改變欄位
 * 本身嘅資料語意（純文字比對唔受影響）。
 */
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function sanitizeCsvCell(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  return FORMULA_TRIGGER_CHARS.has(value[0]) ? `'${value}` : value;
}
