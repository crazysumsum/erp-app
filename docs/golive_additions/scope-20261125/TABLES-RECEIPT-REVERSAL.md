# 片GR 收貨沖銷：資料表說明（供Sam批准）

日期：2026-11-25（r3）。作者：`claude-erp-app-tl-01`。對應`SCOPE.md` 6.2。**草稿；未獲批准前不寫migration。** 候選欄位來自`purchasing.md`（沿用採購設計§4.12–4.13），型別及約束由作者定，須`codex-erp-app-purchasing-01`核對。共同慣例：ID為`BIGINT UNSIGNED`；時間為epoch毫秒；「ascii」指`CHARACTER SET ascii COLLATE ascii_bin`；人員欄為`users(id)`外鍵`ON DELETE SET NULL`。全部是新表。收貨表頭、收貨明細及採購行已有的累計沖銷欄位沿用，不加欄（`purchasing.md`）。

## 1. `goods_receipt_reversals` — 收貨更正單

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `goods_receipt_id` | BIGINT UNSIGNED | 否 | 無 | 原收貨 |
| `reversal_sequence` | SMALLINT UNSIGNED | 否 | 無 | 該收貨的第幾次更正 |
| `reversal_reference` | VARCHAR(30) ascii | 否 | 無 | 顯示用號碼：原收貨號加`-R`及序號 |
| `status` | VARCHAR(20) ascii | 否 | `POSTED` | 只有`POSTED`（建立即過帳，沒有草稿） |
| `event_id` | CHAR(36) ascii | 否 | 無 | 操作識別 |
| `reason` | VARCHAR(500) | 否 | 無 | 原因 |
| `total_reversed_base_quantity` | BIGINT UNSIGNED | 否 | 無 | 本次沖銷總量 |
| `inventory_result_summary` | JSON | 否 | 無 | Inventory過帳摘要（r3：照採購設計§4.12為必填） |
| `confirmed_at` | BIGINT UNSIGNED | 否 | 無 | 過帳時間 |
| `confirmed_by` | BIGINT UNSIGNED | 是 | NULL | 操作者 |
| `confirmed_by_label` | VARCHAR(190) | 否 | 無 | 操作者顯示名稱 |
| `request_id`、`correlation_id` | VARCHAR(64) | 否 | `''` | 追查 |

- 主鍵`id`；`UNIQUE(goods_receipt_id, reversal_sequence)`；`UNIQUE(reversal_reference)`（r3：照採購設計§4.12）；`UNIQUE(event_id)`；`UNIQUE(id, goods_receipt_id)`（供明細的複合外鍵）。
- 外鍵：`goods_receipt_id`→`goods_receipts(id)` `RESTRICT`；`confirmed_by`→`users(id)` `SET NULL`。
- `CHECK`：`status = 'POSTED'`；`total_reversed_base_quantity > 0`；`reversal_sequence >= 1`。trigger拒絕`UPDATE`及`DELETE`。

## 2. `goods_receipt_reversal_details` — 更正明細

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `reversal_id` | BIGINT UNSIGNED | 否 | 無 | 所屬更正單 |
| `goods_receipt_id` | BIGINT UNSIGNED | 否 | 無 | 原收貨 |
| `goods_receipt_detail_id` | BIGINT UNSIGNED | 否 | 無 | 原收貨明細 |
| `purchase_order_line_id` | BIGINT UNSIGNED | 否 | 無 | 原採購行 |
| `sku_id` | BIGINT UNSIGNED | 否 | 無 | SKU |
| `reversed_base_quantity` | BIGINT UNSIGNED | 否 | 無 | 沖銷數量 |
| `original_inventory_movement_id` | BIGINT UNSIGNED | 否 | 無 | 原入庫異動 |
| `reversal_inventory_movement_id` | BIGINT UNSIGNED | 否 | 無 | 沖銷出庫異動 |
| `reversal_inventory_operation_id` | BIGINT UNSIGNED | 否 | 無 | Inventory操作 |
| `created_at` | BIGINT UNSIGNED | 否 | 無 | 時間 |

- 主鍵`id`；`UNIQUE(reversal_inventory_movement_id)`；`UNIQUE(reversal_id, goods_receipt_detail_id)`（r3：同一張更正單內同一原明細只一行，照採購設計§4.13）；`KEY(goods_receipt_detail_id, id)`供求累計。
- 明細屬於該收貨、其採購行、SKU及原入庫異動，由程式在採購單鎖下驗（`goods_receipt_details`沒有`(id, goods_receipt_id)`唯一鍵，只能單欄外鍵）。
- 外鍵：（`reversal_id`,`goods_receipt_id`）→`goods_receipt_reversals(id, goods_receipt_id)`；`goods_receipt_detail_id`→`goods_receipt_details(id)`；`purchase_order_line_id`→`purchase_order_lines(id)`；兩個異動欄→`inventory_movements(id)`；操作欄→`inventory_operation_requests(id)`；均`RESTRICT`。
- `CHECK`：`reversed_base_quantity > 0`。trigger拒絕`UPDATE`及`DELETE`。

## 影響

現有資料不變；新權限不需要（`purchasing.md`：`purchasing.view`＋`inventory.adjust`）。回滾：空表可刪。收貨確認後凍結的trigger已容許累計沖銷欄位變動（已核`0119`、`0121`）。
