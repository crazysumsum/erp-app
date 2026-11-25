# 開票與應收首期：資料表說明（供Sam批准）

日期：2026-11-19。作者：`claude-erp-app-tl-01`。對應`ar-minimal-scope-20261119/SCOPE.md`（`a260b9a2…`）。
**未獲批准前不寫migration。** 來源：`origin/main` `11f42ca3`（只讀）；型別沿用現有表的做法（`0073`、`0074`、`0096`、Purchasing `0112`～`0115`）。

共同慣例：ID為`BIGINT UNSIGNED AUTO_INCREMENT`；時間為epoch毫秒的`BIGINT UNSIGNED`；業務日期為`DATE`；金額為`DECIMAL(19,4)`（與Sales訂單行相同）；代碼及狀態為`VARCHAR`、`ascii_bin`並以`CHECK`限定取值；操作者為`BIGINT UNSIGNED NULL`，外鍵指向`users`、`ON DELETE SET NULL`，另存當時的顯示名稱`VARCHAR(190)`。全部是**新表**，不修改任何現有的表。

## 1. `ar_document_sequences` — 發票及收款的流水號

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `document_type` | VARCHAR(20) ascii | 無 | `INVOICE`或`RECEIPT` |
| `business_year` | SMALLINT UNSIGNED | 無 | 號碼所屬年度，每年重置 |
| `next_value` | INT UNSIGNED | 1 | 下一個流水號 |
| `updated_at` | BIGINT UNSIGNED | 無 | 最後取號時間 |

- 主鍵（`document_type`,`business_year`）：一類文件一年一列；取號時鎖這一列，兩人同時確認不會重號。
- `CHECK`限定`document_type`的取值。

## 2. `ar_operation_requests` — 每個操作的識別及結果（防止重送重複生效）

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | 自動 | 主鍵 |
| `event_id` | CHAR(36) ascii | 無 | 前端為一次操作產生的識別 |
| `command_type` | VARCHAR(40) ascii | 無 | 例如確認發票、核銷 |
| `target_type`、`target_id` | VARCHAR(20) ascii、BIGINT UNSIGNED | 無、0 | 操作的對象；建立類為0 |
| `request_hash` | CHAR(64) ascii | 無 | 請求內容的hash，用來辨認同一識別是否被用於不同內容 |
| `actor_user_id`、`actor_label` | 見慣例 | NULL、無 | 操作者 |
| `result_summary` | JSON | NULL | 成功後保存的最小結果（ID、號碼、狀態、版本），重送時原樣回覆 |
| `created_at`、`completed_at` | BIGINT UNSIGNED | 無、NULL | 時間 |

- `UNIQUE(event_id)`：同一識別只會生效一次；回應遺失後重送取回原結果。
- `KEY(target_type,target_id,id)`：按文件查其操作記錄。

## 3. `ar_invoices` — 發票

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | 自動 | 主鍵 |
| `invoice_number` | VARCHAR(24) ascii | NULL | 確認時取號；Draft為空 |
| `status` | VARCHAR(20) ascii | `DRAFT` | `DRAFT`、`CONFIRMED`、`VOID`、`CANCELLED` |
| `customer_id` | BIGINT UNSIGNED | 無 | 客戶 |
| `customer_code_snapshot`、`customer_name_snapshot` | VARCHAR(100)、VARCHAR(190) | 無 | 開票當時的客戶代碼及名稱 |
| `currency_code`、`currency_decimal_places` | CHAR(3) ascii、TINYINT UNSIGNED | 無 | 幣別及開票當時的小數位 |
| `invoice_date`、`due_date` | DATE | 無 | 發票日期；到期日（開票時寫入，其後條款改動不影響） |
| `payment_term_code_snapshot`、`payment_term_name_snapshot` | VARCHAR(50)、VARCHAR(190) | `''` | 開票當時的付款條款，只供顯示 |
| `due_date_overridden`、`due_date_reason` | TINYINT(1)、VARCHAR(500) | 0、`''` | 到期日是否經人手修改及其原因 |
| `total_amount` | DECIMAL(19,4) | 無 | 發票總額 |
| `allocated_amount` | DECIMAL(19,4) | 0 | 已核銷額 |
| `outstanding_amount` | DECIMAL(19,4) | 無 | 未收額；帳齡表讀這一欄 |
| `notes`、`void_reason` | VARCHAR(2000)、VARCHAR(500) | `''` | 備註；作廢原因 |
| `version` | INT UNSIGNED | 1 | 並發修改時防止互相覆蓋 |
| 建立／確認／作廢的操作者、名稱及時間 | 見慣例 | NULL | Audit及顯示 |
| `created_at`、`updated_at` | BIGINT UNSIGNED | 無 | 時間 |

- `UNIQUE(invoice_number)`：號碼不重複（Draft的NULL不受限）。
- `KEY(customer_id,currency_code,status,due_date,id)`：帳齡表及按客戶查詢。
- `KEY(status,invoice_date,id)`：發票列表。
- 外鍵：`customer_id`→`customers`、`currency_code`→`currencies`，`ON DELETE RESTRICT`：有發票的客戶及幣別不可刪除。
- `CHECK`：三個金額不為負；`outstanding_amount = total_amount − allocated_amount`；`due_date`不早於`invoice_date`；`status`取值。

## 4. `ar_invoice_lines` — 發票行（一行對應一個出貨行）

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `id`、`invoice_id`、`line_no` | BIGINT UNSIGNED、BIGINT UNSIGNED、SMALLINT UNSIGNED | 自動、無、無 | 主鍵、所屬發票、行號 |
| `shipment_id`、`shipment_line_id` | BIGINT UNSIGNED | 無 | 來源出貨及出貨行 |
| `sales_order_id`、`sales_order_line_id` | BIGINT UNSIGNED | 無 | 來源訂單及訂單行 |
| `active_shipment_line_id` | BIGINT UNSIGNED | NULL | 發票為`DRAFT`或`CONFIRMED`時等於`shipment_line_id`，作廢或取消時由程式在同一交易改為NULL |
| `sku_code_snapshot`、`sku_name_snapshot`、`base_uom_code_snapshot` | VARCHAR(190)、VARCHAR(190)、VARCHAR(100) | 無 | 開票當時的貨品資料 |
| `quantity` | BIGINT UNSIGNED | 無 | 開票數量（基本單位），等於出貨行的出貨數量 |
| `unit_price_snapshot` | DECIMAL(19,4) | 無 | 訂單行單價 |
| `line_amount` | DECIMAL(19,4) | 無 | 本行金額（剩餘池規則，按出貨次序計算，用盡數量的一批取餘數） |

- `UNIQUE(active_shipment_line_id)`：**一個出貨行同一時間只可在一張有效發票上**。由資料庫保證，兩人同時開同一張出貨時只有一個成功；作廢後該欄為NULL，出貨可重新開票。
- `UNIQUE(invoice_id,line_no)`：同一發票內行號不重複。
- `KEY(sales_order_line_id,id)`：按訂單行查其發票行（金額不依賴這個索引：按出貨次序由訂單及出貨的事實計算）。
- `KEY(shipment_id,id)`：按出貨查其發票。
- 外鍵：`invoice_id`→`ar_invoices`、`shipment_id`→`shipments`、`shipment_line_id`→`shipment_lines`、`sales_order_id`→`sales_orders`、`sales_order_line_id`→`sales_order_lines`，均`ON DELETE RESTRICT`。
- `CHECK`：`quantity`大於0；`line_amount`不為負。

## 5. `ar_receipts` — 收款

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | 自動 | 主鍵 |
| `receipt_number` | VARCHAR(24) ascii | NULL | 確認時取號 |
| `status` | VARCHAR(20) ascii | `DRAFT` | `DRAFT`、`CONFIRMED`、`CANCELLED`、`VOID`（作廢收款） |
| `customer_id`及兩個客戶快照 | 同發票 | 無 | 客戶 |
| `currency_code`、`currency_decimal_places` | 同發票 | 無 | 幣別 |
| `receipt_date` | DATE | 無 | 收款日期 |
| `amount` | DECIMAL(19,4) | 無 | 收款金額 |
| `allocated_amount`、`available_amount` | DECIMAL(19,4) | 0、無 | 已核銷額、尚可核銷額 |
| `payment_method` | VARCHAR(20) ascii | 無 | `BANK_TRANSFER`、`CHEQUE`、`CASH`、`OTHER` |
| `reference`、`notes` | VARCHAR(190)、VARCHAR(2000) | `''` | 參考號、備註 |
| `void_reason` | VARCHAR(500) | `''` | 作廢收款的原因 |
| `voided_by`、`voided_by_label` | BIGINT UNSIGNED、VARCHAR(190) | NULL、`''` | 作廢的操作者：按共同慣例同時保存使用者ID（外鍵`users`、`ON DELETE SET NULL`）及當時的顯示名稱，所以是兩個欄位 |
| `voided_at` | BIGINT UNSIGNED | NULL | 作廢時間 |
| `version`、建立及確認的操作者與時間 | 同發票 | | |

- `UNIQUE(receipt_number)`；`KEY(customer_id,currency_code,status,receipt_date,id)`供列表及核銷時選取。
- 外鍵同發票（客戶、幣別`RESTRICT`）。
- `CHECK`：`amount`大於0；狀態及方式的取值；金額關係按狀態表達：未作廢時`amount = allocated_amount + available_amount`，`VOID`時`allocated_amount`及`available_amount`均為0而`amount`保留原值。
- 作廢的規則（由程式在鎖下檢查，不是表結構）：只有`CONFIRMED`而且沒有任何有效核銷（`allocated_amount`為0）的收款可以作廢，須填原因；已核銷的須先解除核銷。作廢後不可再核銷，號碼保留不重用。

## 6. `ar_receipt_allocations` — 核銷

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `id`、`receipt_id`、`invoice_id` | BIGINT UNSIGNED | 自動、無、無 | 主鍵、收款、發票 |
| `amount` | DECIMAL(19,4) | 無 | 核銷金額 |
| `status` | VARCHAR(20) ascii | `ACTIVE` | `ACTIVE`、`UNAPPLIED`（解除後保留記錄） |
| 建立及解除的操作者、名稱及時間 | 見慣例 | NULL | |

- `KEY(receipt_id,status,id)`、`KEY(invoice_id,status,id)`：分別由收款及發票查其核銷。
- 外鍵：`receipt_id`→`ar_receipts`、`invoice_id`→`ar_invoices`，`RESTRICT`。
- `CHECK`：`amount`大於0；狀態取值。

## 7. `ar_audit_logs` — 操作記錄

欄位與現有的`purchasing_audit_logs`（migration `0115`）相同，只把供應商欄換成`customer_id`：時間、操作者及名稱、動作、結果、對象類型及ID、對象標示、原因、內容（JSON，不超過8192位元組）、請求及關聯識別、IP。索引：時間；客戶＋時間；操作者＋時間。trigger拒絕`UPDATE`及`DELETE`，記錄不可修改。

## 對現有資料及程式的影響

- **現有資料**：零改動。全部是新表，沒有`ALTER`現有的表，沒有回填。
- **鎖**：建立外鍵時會短暫取得被引用的表（`customers`、`currencies`、`users`、`shipments`、`shipment_lines`、`sales_orders`、`sales_order_lines`）的metadata lock；以現時的資料量是瞬間完成。
- **刪除行為的改變**：有發票或收款的客戶、被開票的出貨及訂單，其後不可被實體刪除（`RESTRICT`）。現有功能不會刪除已出貨的訂單或出貨，所以首期沒有實際影響；**第二期的歸檔**（把訂單及出貨搬離在用表）在AR的歸檔設計完成前，會被已開票的資料擋住。
- **權限**：另須在權限目錄加入三個新權限（`ar.view`、`ar.invoice.mgmt`、`ar.receipt.mgmt`），這是資料而不是表結構；新增權限會影響現有以完整權限集合比對的測試，實作時一併處理。
- **回滾**：刪除這七張新表即可，不影響現有資料。
- **不設的東西**：沒有餘額表、ledger、信用額度、關帳日、期初或歸檔的表。

## 作廢收款的來歷

本文件第一版（`393793fc…`、`4c02bbdd…`）把作廢收款列為待決的缺口。PM於2026-11-19通知（agentmsg `ecbbf9d2`）：Sam在PM的工作階段答覆「批准，含作廢收款」，所答的問題是「是否批准應收七張新表，並包含作廢收款的欄位？」。本版據此把作廢收款寫入第5節正文。這是PM轉述的答覆，作者沒有直接聽到。

與第一版末段所說的「三欄」相比，實際是**四個欄位**：`void_reason`、`voided_by`、`voided_by_label`、`voided_at`；多出的一個是操作者的顯示名稱，與本文件其他操作者欄位的共同慣例一致。其餘六張表的欄位、型別、鍵及約束與第一版完全相同。
