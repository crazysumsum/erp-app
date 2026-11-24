# 片RT 客戶退貨及退回供應商：資料表說明（供Sam批准）

日期：2026-11-25（r1）。作者：`claude-erp-app-tl-01`。對應`SCOPE.md` 7.2、7.3。**草稿；未獲批准前不寫migration。** 候選來自`returns.md`；作者補上號碼、往來方快照、確認事件及約束。共同慣例：ID為`BIGINT UNSIGNED`；時間為epoch毫秒；「ascii」指`CHARACTER SET ascii COLLATE ascii_bin`；人員欄為`users(id)`外鍵`ON DELETE SET NULL`。全部是新表。

## 1. `returns_operation_requests` — 退貨模組的操作識別

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `event_id` | CHAR(36) ascii | 否 | 無 | 一次操作的識別 |
| `command_type` | VARCHAR(40) ascii | 否 | 無 | 命令 |
| `target_type` | VARCHAR(20) ascii | 否 | 無 | 對象類型 |
| `target_id` | BIGINT UNSIGNED | 否 | 0 | 對象ID；建立類為0 |
| `request_hash` | CHAR(64) ascii | 否 | 無 | 請求內容的hash |
| `actor_user_id` | BIGINT UNSIGNED | 是 | NULL | 操作者 |
| `actor_label` | VARCHAR(190) | 否 | 無 | 操作者名稱 |
| `result_summary` | JSON | 是 | NULL | 成功後的最小結果，重送時原樣回覆 |
| `created_at` | BIGINT UNSIGNED | 否 | 無 | 建立時間 |
| `completed_at` | BIGINT UNSIGNED | 是 | NULL | 完成時間 |

- 主鍵`id`；`UNIQUE(event_id)`；`KEY(target_type, target_id, id)`；`actor_user_id`→`users(id)` `SET NULL`。

## 2. `customer_returns` — 客戶退貨單

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `return_number` | VARCHAR(24) ascii | 是 | NULL | 過帳時取號（`CRT-YYYY-000001`）；草稿為空 |
| `status` | VARCHAR(20) ascii | 否 | `DRAFT` | `DRAFT`、`POSTED`、`CANCELLED` |
| `shipment_id` | BIGINT UNSIGNED | 否 | 無 | 原出貨 |
| `customer_id` | BIGINT UNSIGNED | 否 | 無 | 客戶（取自原出貨） |
| `customer_code_snapshot` | VARCHAR(100) | 否 | 無 | 當時的客戶代碼 |
| `customer_name_snapshot` | VARCHAR(190) | 否 | 無 | 當時的客戶名稱 |
| `return_date` | DATE | 否 | 無 | 退回日期 |
| `reason` | VARCHAR(500) | 否 | 無 | 原因 |
| `version` | INT UNSIGNED | 否 | 1 | 並發 |
| `posted_event_id` | CHAR(36) ascii | 是 | NULL | 過帳的操作識別 |
| `created_by` | BIGINT UNSIGNED | 是 | NULL | 建立者 |
| `created_by_label` | VARCHAR(190) | 否 | 無 | 建立者名稱 |
| `created_at` | BIGINT UNSIGNED | 否 | 無 | 建立時間 |
| `posted_by` | BIGINT UNSIGNED | 是 | NULL | 過帳者 |
| `posted_by_label` | VARCHAR(190) | 否 | `''` | 過帳者名稱 |
| `posted_at` | BIGINT UNSIGNED | 是 | NULL | 過帳時間 |
| `cancelled_by` | BIGINT UNSIGNED | 是 | NULL | 取消者 |
| `cancelled_at` | BIGINT UNSIGNED | 是 | NULL | 取消時間 |
| `updated_at` | BIGINT UNSIGNED | 否 | 無 | 時間 |

- 主鍵`id`；`UNIQUE(return_number)`；`UNIQUE(id, shipment_id)`（供明細複合外鍵）；`KEY(shipment_id, status, id)`（出貨沖銷的檢查及按出貨查詢）；`KEY(customer_id, return_date, id)`。
- 外鍵：`shipment_id`→`shipments(id)`、`customer_id`→`customers(id)` `RESTRICT`；人員→`users` `SET NULL`。
- `CHECK`：`status`取值；`POSTED`時`return_number`及`posted_at`不為NULL，其餘狀態`return_number`為NULL；`version >= 1`。

## 3. `customer_return_lines` — 客戶退貨行

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `return_id` | BIGINT UNSIGNED | 否 | 無 | 所屬退貨單 |
| `shipment_id` | BIGINT UNSIGNED | 否 | 無 | 原出貨（供複合外鍵） |
| `line_no` | SMALLINT UNSIGNED | 否 | 無 | 行號 |
| `shipment_issue_detail_id` | BIGINT UNSIGNED | 否 | 無 | 原發出明細（帶原批號、庫位、原出貨異動） |
| `base_quantity` | BIGINT UNSIGNED | 否 | 無 | 退回基本數量 |
| `bin_id` | BIGINT UNSIGNED | 否 | 無 | 收回的庫位（隔離） |
| `inventory_movement_id` | BIGINT UNSIGNED | 是 | NULL | 過帳後的收回異動 |

- 主鍵`id`；`UNIQUE(return_id, line_no)`；`UNIQUE(inventory_movement_id)`；`KEY(shipment_issue_detail_id, id)`（求累計已退量）。
- 外鍵：（`return_id`,`shipment_id`）→`customer_returns(id, shipment_id)`；（`shipment_issue_detail_id`,`shipment_id`）→`shipment_issue_details(id, shipment_id)`（已核`uq_shipment_issue_owner`），保證退貨行屬於同一出貨；`bin_id`→`inventory_bins(id)`；`inventory_movement_id`→`inventory_movements(id)`；均`RESTRICT`。
- `CHECK`：`base_quantity > 0`。
- 累計上限「同一發出明細的已過帳退回 ≤ 其發出量」由程式在出貨鎖下檢查。過帳後退貨單及其行不可改（trigger，照收貨的做法）。

## 4. `supplier_returns` — 退回供應商單

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `return_number` | VARCHAR(24) ascii | 是 | NULL | 過帳時取號（`SRT-YYYY-000001`） |
| `status` | VARCHAR(20) ascii | 否 | `DRAFT` | `DRAFT`、`POSTED`、`CANCELLED` |
| `goods_receipt_id` | BIGINT UNSIGNED | 否 | 無 | 原收貨 |
| `purchase_order_id` | BIGINT UNSIGNED | 否 | 無 | 原採購單（鎖序及查詢） |
| `supplier_id` | BIGINT UNSIGNED | 否 | 無 | 供應商（取自原收貨） |
| `supplier_code_snapshot` | VARCHAR(64) | 否 | 無 | 當時的供應商代碼 |
| `supplier_name_snapshot` | VARCHAR(190) | 否 | 無 | 當時的供應商名稱 |
| `return_date` | DATE | 否 | 無 | 退回日期 |
| `reason` | VARCHAR(500) | 否 | 無 | 原因 |
| `version` | INT UNSIGNED | 否 | 1 | 並發 |
| `posted_event_id` | CHAR(36) ascii | 是 | NULL | 過帳的操作識別 |
| `created_by` | BIGINT UNSIGNED | 是 | NULL | 建立者 |
| `created_by_label` | VARCHAR(190) | 否 | 無 | 建立者名稱 |
| `created_at` | BIGINT UNSIGNED | 否 | 無 | 建立時間 |
| `posted_by` | BIGINT UNSIGNED | 是 | NULL | 過帳者 |
| `posted_by_label` | VARCHAR(190) | 否 | `''` | 過帳者名稱 |
| `posted_at` | BIGINT UNSIGNED | 是 | NULL | 過帳時間 |
| `cancelled_by` | BIGINT UNSIGNED | 是 | NULL | 取消者 |
| `cancelled_at` | BIGINT UNSIGNED | 是 | NULL | 取消時間 |
| `updated_at` | BIGINT UNSIGNED | 否 | 無 | 時間 |

- 主鍵`id`；`UNIQUE(return_number)`；`UNIQUE(id, goods_receipt_id)`；`KEY(goods_receipt_id, status, id)`；`KEY(supplier_id, return_date, id)`。
- 外鍵：`goods_receipt_id`→`goods_receipts(id)`、`purchase_order_id`→`purchase_orders(id)`、`supplier_id`→`suppliers(id)` `RESTRICT`；人員`SET NULL`。
- `CHECK`：`status`取值；`POSTED`時`return_number`及`posted_at`不為NULL，其餘狀態`return_number`為NULL；`version >= 1`。

## 5. `supplier_return_lines` — 退回供應商行

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `return_id` | BIGINT UNSIGNED | 否 | 無 | 所屬退回單 |
| `goods_receipt_id` | BIGINT UNSIGNED | 否 | 無 | 原收貨（供複合外鍵） |
| `line_no` | SMALLINT UNSIGNED | 否 | 無 | 行號 |
| `goods_receipt_detail_id` | BIGINT UNSIGNED | 否 | 無 | 原收貨明細（帶原批號、庫位及原入庫異動） |
| `base_quantity` | BIGINT UNSIGNED | 否 | 無 | 退回基本數量 |
| `bin_id` | BIGINT UNSIGNED | 否 | 無 | 出庫庫位 |
| `stock_status` | VARCHAR(20) ascii | 否 | 無 | 出庫的存貨狀態 |
| `inventory_movement_id` | BIGINT UNSIGNED | 是 | NULL | 過帳後的出庫異動 |

- 主鍵`id`；`UNIQUE(return_id, line_no)`；`UNIQUE(inventory_movement_id)`；`KEY(goods_receipt_detail_id, id)`。
- 外鍵：（`return_id`,`goods_receipt_id`）→`supplier_returns(id, goods_receipt_id)`；`goods_receipt_detail_id`→`goods_receipt_details(id)`（已核`0121`：該表沒有`(id, goods_receipt_id)`的唯一鍵，所以不能用複合外鍵；明細屬於該收貨由程式在採購單鎖下驗）；`bin_id`→`inventory_bins(id)`；`inventory_movement_id`→`inventory_movements(id)`；均`RESTRICT`。
- `CHECK`：`base_quantity > 0`。
- 上限見`SCOPE.md` 6.2（與收貨沖銷共用），在採購單鎖下檢查。

## 影響

- 現有資料不變。新權限：`returns.view`、`returns.customer.mgmt`、`returns.supplier.mgmt`（名稱待returns-01核定；現有`returns.operation`是Inventory的過帳權限，沿用）。
- 現有表的`RESTRICT`：有退貨的出貨、收貨、客戶及供應商不可實體刪除；Supplier的永久刪除已把外鍵拒絕對應為409（S1評審時已核）。客戶模組若有實體刪除，須同樣處理（未核）。
- 回滾：空表可刪。
