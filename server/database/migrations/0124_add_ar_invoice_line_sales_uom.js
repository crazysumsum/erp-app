// 發票行加兩欄：開票當時的銷售單位代碼，及一個銷售單位等於多少基本單位。正本是 TL 的 TABLES-ADDENDUM-1.md
// （sha256 45f24a54…bcd9）；Sam 2026-11-19 批准，原話「批准加兩欄」。
// 原因：發票行的 quantity 是基本單位，unit_price_snapshot 卻是訂單行每銷售單位的單價；換算率不是 1 時（按箱賣、按件出）
// 沒有這兩欄就顯示不出「多少銷售單位 × 單價」。型別與 sales_order_lines 的同名欄位相同（0074），接在 base_uom_code_snapshot 之後。
// 不加索引、約束或外鍵；ar_invoice_lines 在所有環境仍是空的，沒有回填。不修改 0123。
//
// 用 information_schema 檢查而不是 ADD COLUMN IF NOT EXISTS（MySQL 不支援），令重跑是 no-op。
const COLUMNS = Object.freeze([
  ["sales_uom_code_snapshot", "VARCHAR(100) NOT NULL DEFAULT '' AFTER base_uom_code_snapshot"],
  ["to_base_factor_snapshot", "INT UNSIGNED NOT NULL DEFAULT 1 AFTER sales_uom_code_snapshot"]
]);

export async function up(connection) {
  for (const [name, definition] of COLUMNS) {
    const [existing] = await connection.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'ar_invoice_lines' AND column_name = ?", [name]);
    if (existing.length === 0) await connection.query(`ALTER TABLE ar_invoice_lines ADD COLUMN ${name} ${definition}`);
  }
}
