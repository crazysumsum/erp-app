# 開票與應收首期：資料表補充一（發票行的銷售單位）

日期：2026-11-19。作者：`claude-erp-app-tl-01`。補充`TABLES.md`（sha256 `2ffa6b0b53c6d84c9133f0cea5fa5f860c91038850c363571d1d612c67718aca`）；該檔不改動，因為其hash已被migration 0123及其測試引用。

**批准**：Sam於2026-11-19在TL的chat直接答覆，原話：「批准加兩欄」。所答的問題：「是否批准在 ar_invoice_lines 加銷售單位及換算率兩個欄位？」，問題之前已向他列出下表的欄位、型別、預設、用途及影響。批准範圍只限本文件所列。

## 原因

這是`TABLES.md`第4節的遺漏。發票行的`quantity`是基本單位，`unit_price_snapshot`卻是訂單行每「銷售單位」的單價，表內沒有銷售單位及換算率。換算率不是1時（按箱賣、按件出），發票詳情會顯示「24件 × 240.00 ＝ 240.00」；行金額本身正確。

## 改動（表`ar_invoice_lines`，以新的migration加上，不修改0123）

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `sales_uom_code_snapshot` | VARCHAR(100) NOT NULL | `''` | 開票當時訂單行的銷售單位代碼（來源：`sales_order_lines.uom_code_snapshot`，經Fulfillment的reader的`salesUomCodeSnapshot`） |
| `to_base_factor_snapshot` | INT UNSIGNED NOT NULL | 1 | 一個銷售單位等於多少基本單位（來源：`sales_order_lines.to_base_factor_snapshot`，經reader的`toBaseFactor`） |

- 型別與`sales_order_lines`的同名欄位相同（`0074_create_sales_order_lines.js`）。
- 位置：接在`base_uom_code_snapshot`之後。
- **不加索引，不加約束**，不加外鍵。
- Migration須可重跑：欄位已存在即不做任何事。

## 影響

- 現有資料：`ar_invoice_lines`在所有環境仍是空的；`ALTER TABLE`瞬間完成，沒有回填。
- 程式：建立發票時寫入這兩個值；發票詳情回傳。讀取介面已經提供這兩個值，Fulfillment及Sales不用改。
- 行金額、總額、未收額的計算及全部CHECK不變。
- 回滾：刪除這兩個欄位即可。

## 顯示（供前端，非表結構）

數量可被換算率整除時，可顯示「銷售單位數量 × 單價」（既有需求FR-INV-016）；不可整除時顯示基本單位數量，單價註明是每個銷售單位的價格。不儲存換算後的每基本單位單價（四位小數下不一定除得盡）。
