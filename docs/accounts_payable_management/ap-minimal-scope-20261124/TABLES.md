# 應付與付款最小版本：資料表說明（供Sam批准）

日期：2026-11-24。作者：`claude-erp-app-tl-01`。對應同目錄的`SCOPE.md`及`DECISIONS.md`。
**草稿，未經非作者評審；未獲Sam批准前不寫migration。** 來源：`origin/main` `80b54298`（只讀）；以已在main上的應收七張表（migration `0123`、`0124`）為藍本。

本文件按`DECISIONS.md`決定一及決定二的建議（都是A）寫成。Sam若選其他選項，受影響的欄位在各節末以「**隨決定而變**」標明。

共同慣例（與應收相同）：ID為`BIGINT UNSIGNED AUTO_INCREMENT`；時間為epoch毫秒的`BIGINT UNSIGNED`；業務日期為`DATE`；金額為`DECIMAL(19,4)`；代碼及狀態為`VARCHAR`、`ascii_bin`並以`CHECK`限定取值；操作者為`BIGINT UNSIGNED NULL`，外鍵指向`users`、`ON DELETE SET NULL`，另存當時的顯示名稱`VARCHAR(190)`。全部是**新表**，不修改任何現有的表。

## 1. `ap_document_sequences` — 發票及付款的流水號

與`ar_document_sequences`相同：`document_type` VARCHAR(20) ascii（`INVOICE`或`PAYMENT`）、`business_year` SMALLINT UNSIGNED、`next_value` INT UNSIGNED預設1、`updated_at`。

- 主鍵（`document_type`,`business_year`）：一類文件一年一列；取號時鎖這一列，兩人同時確認不會重號。
- `CHECK`限定`document_type`的取值。
- 號碼格式`APV-YYYY-000001`（應付發票）、`PMT-YYYY-000001`（付款）；與應收的`INV`、`RCT`不同，避免混淆。

## 2. `ap_operation_requests` — 每個操作的識別及結果（防止重送重複生效）

欄位、鍵及約束與`ar_operation_requests`完全相同：`id`、`event_id` CHAR(36)、`command_type` VARCHAR(40)、`target_type` VARCHAR(20)、`target_id`預設0、`request_hash` CHAR(64)、操作者及名稱、`result_summary` JSON NULL、`created_at`、`completed_at` NULL。

- `UNIQUE(event_id)`：同一識別只生效一次；回應遺失後重送取回原結果。
- `KEY(target_type,target_id,id)`：按文件查其操作記錄。

## 3. `ap_invoices` — 供應商發票

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | 自動 | 主鍵 |
| `invoice_number` | VARCHAR(24) ascii | NULL | 內部號碼，確認時取號；草稿為空 |
| `status` | VARCHAR(20) ascii | `DRAFT` | `DRAFT`、`CONFIRMED`、`VOID`、`CANCELLED` |
| `supplier_id` | BIGINT UNSIGNED | 無 | 供應商 |
| `supplier_code_snapshot`、`supplier_name_snapshot` | VARCHAR(64)、VARCHAR(190) | 無 | 開票當時的供應商代碼及名稱（長度與`goods_receipts`相同） |
| `currency_code`、`currency_decimal_places` | CHAR(3) ascii、TINYINT UNSIGNED | 無 | 幣別及開票當時的小數位 |
| `supplier_invoice_number` | VARCHAR(100) | 無 | 供應商發票上的號碼，照使用者輸入（已去首尾空白）保存，供顯示 |
| `active_supplier_invoice_key` | VARCHAR(100) `utf8mb4_bin` | NULL | 發票為`DRAFT`或`CONFIRMED`時等於正規化（去首尾空白、轉大寫）後的供應商發票號碼；取消或作廢時由程式在同一交易改為NULL |
| `invoice_date`、`due_date` | DATE | 無 | 供應商發票日期；到期日 |
| `payment_term_code_snapshot`、`payment_term_name_snapshot` | VARCHAR(50)、VARCHAR(190) | `''` | 開票當時的付款條款，只供顯示 |
| `due_date_overridden`、`due_date_reason` | TINYINT(1)、VARCHAR(500) | 0、`''` | 到期日是否經人手修改及其原因 |
| `supplier_total_amount` | DECIMAL(19,4) | NULL | 使用者照供應商發票輸入的總額；確認時必須等於`total_amount` |
| `no_po_reason` | VARCHAR(500) | `''` | 無採購單發票（只有費用行）的原因 |
| `total_amount` | DECIMAL(19,4) | 無 | 系統算出的發票總額 |
| `allocated_amount` | DECIMAL(19,4) | 0 | 已核銷額 |
| `outstanding_amount` | DECIMAL(19,4) | 無 | 未付額；帳齡表讀這一欄 |
| `notes`、`void_reason` | VARCHAR(2000)、VARCHAR(500) | `''` | 備註；作廢原因 |
| `version` | INT UNSIGNED | 1 | 並發修改時防止互相覆蓋 |
| 建立／確認／作廢的操作者、名稱及時間 | 見慣例 | NULL | 記錄及顯示 |
| `created_at`、`updated_at` | BIGINT UNSIGNED | 無 | 時間 |

- `UNIQUE(invoice_number)`：內部號碼不重複（草稿的NULL不受限）。
- `UNIQUE(supplier_id, active_supplier_invoice_key)`：**同一供應商的同一張發票不會被入帳兩次**。由資料庫保證，兩人同時輸入時只有一個成功；不同供應商可用相同號碼；作廢或取消後該欄為NULL，號碼可再用。比較用`utf8mb4_bin`，所以結果只取決於程式正規化後的字元，不受資料庫對空白及大小寫的比較規則影響。
- `KEY(supplier_id,currency_code,status,due_date,id)`：帳齡表及按供應商查詢。
- `KEY(status,invoice_date,id)`：發票列表。
- 外鍵：`supplier_id`→`suppliers`、`currency_code`→`currencies`，`ON DELETE RESTRICT`：有發票的供應商及幣別不可刪除。
- `CHECK`：三個金額不為負；`outstanding_amount = total_amount − allocated_amount`；`due_date`不早於`invoice_date`；`status`取值；`supplier_total_amount`為NULL或不為負。
- **隨決定而變**：決定一採B時不設`supplier_total_amount`及`no_po_reason`。

## 4. `ap_invoice_lines` — 發票行（收貨行或費用行）

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `id`、`invoice_id`、`line_no` | BIGINT UNSIGNED、BIGINT UNSIGNED、SMALLINT UNSIGNED | 自動、無、無 | 主鍵、所屬發票、行號 |
| `line_type` | VARCHAR(20) ascii | 無 | `RECEIPT`（來自收貨行）或`EXPENSE`（費用行） |
| `goods_receipt_id`、`goods_receipt_line_id` | BIGINT UNSIGNED | NULL | 來源收貨及收貨行；費用行為NULL |
| `active_goods_receipt_line_id` | BIGINT UNSIGNED | NULL | 收貨行而且發票為`DRAFT`或`CONFIRMED`時等於`goods_receipt_line_id`；作廢、取消時由程式在同一交易改為NULL；費用行恆為NULL |
| `purchase_order_id`、`purchase_order_line_id` | BIGINT UNSIGNED | NULL | 來源採購單及採購行的ID，只供追溯；不設外鍵 |
| `goods_receipt_number_snapshot`、`purchase_order_number_snapshot` | VARCHAR(20) ascii | `''` | 收貨單號及採購單號，供顯示 |
| `sku_code_snapshot`、`sku_name_snapshot` | VARCHAR(190) | `''` | 收貨當時的貨品代碼及名稱 |
| `base_uom_code_snapshot`、`purchase_uom_code_snapshot` | VARCHAR(50) | `''` | 基本單位及採購單位（長度與`purchase_order_lines`相同） |
| `to_base_factor_snapshot` | INT UNSIGNED | 1 | 一個採購單位等於多少基本單位 |
| `quantity` | BIGINT UNSIGNED | 0 | 開票數量（基本單位），等於收貨行的收貨數量；費用行為0 |
| `po_unit_price_snapshot` | DECIMAL(19,4) | 0 | 採購行的單價（每採購單位） |
| `unit_price` | DECIMAL(19,4) | 0 | 發票單價；沒有改價時等於上一欄 |
| `price_override_reason` | VARCHAR(500) | `''` | 改價的原因；沒有改價時為空 |
| `description` | VARCHAR(500) | `''` | 費用行的描述 |
| `line_amount` | DECIMAL(19,4) | 無 | 本行金額 |

- `UNIQUE(active_goods_receipt_line_id)`：**一個收貨行同一時間只可在一張有效發票上**。由資料庫保證，兩人同時為同一張收貨開票時只有一個成功。
- `UNIQUE(invoice_id,line_no)`：同一發票內行號不重複。
- `KEY(goods_receipt_id,id)`：按收貨查其發票（建立發票頁標示「已在發票上」）。
- 外鍵：`invoice_id`→`ap_invoices`、`goods_receipt_id`→`goods_receipts`、`goods_receipt_line_id`→`goods_receipt_lines`，均`ON DELETE RESTRICT`。對採購單及採購行不設外鍵：收貨對採購單已有`RESTRICT`外鍵，再加一層只會令插入時多取採購一側的鎖。
- `CHECK`：`line_type`取值；收貨行的兩個收貨ID不為NULL而且`quantity`大於0；費用行的兩個收貨ID及`active_goods_receipt_line_id`為NULL、`quantity`為0、`line_amount`大於0；`unit_price`、`po_unit_price_snapshot`及`line_amount`不為負。
- 不在表結構內的規則（由程式檢查）：改價須`ap.invoice.price.override`及原因；費用行描述不可空白。
- **隨決定而變**：決定一採B時不設`line_type`、`unit_price`、`price_override_reason`、`description`，兩個收貨ID改為`NOT NULL`。決定二採B（按數量部分開票）時，這張表的唯一鍵不適用，要另加一張按收貨行記錄已佔用數量的表，共八張。

## 5. `ap_payments` — 付款

欄位、鍵及約束與`ar_receipts`對應，只把客戶換成供應商、收款換成付款：

| 欄位 | 型別 | 預設 | 用途 |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | 自動 | 主鍵 |
| `payment_number` | VARCHAR(24) ascii | NULL | 確認時取號 |
| `status` | VARCHAR(20) ascii | `DRAFT` | `DRAFT`、`CONFIRMED`、`CANCELLED`、`VOID` |
| `supplier_id`及兩個供應商快照、`currency_code`、`currency_decimal_places` | 同發票 | 無 | 供應商及幣別 |
| `payment_date` | DATE | 無 | 付款日期 |
| `amount` | DECIMAL(19,4) | 無 | 付款金額 |
| `allocated_amount`、`available_amount` | DECIMAL(19,4) | 0、無 | 已核銷額、尚可核銷額（即預付款餘額） |
| `payment_method` | VARCHAR(20) ascii | 無 | `BANK_TRANSFER`、`CHEQUE`、`CASH`、`OTHER` |
| `reference`、`notes` | VARCHAR(190)、VARCHAR(2000) | `''` | 參考號（轉帳參考或支票號）、備註 |
| `void_reason`、`voided_by`、`voided_by_label`、`voided_at` | VARCHAR(500)、見慣例 | `''`、NULL | 作廢付款的原因、操作者及時間 |
| `version`、建立及確認的操作者與時間、`created_at`、`updated_at` | 同發票 | | |

- `UNIQUE(payment_number)`；`KEY(supplier_id,currency_code,status,payment_date,id)`供列表及核銷時選取。
- 外鍵：供應商、幣別`RESTRICT`。
- `CHECK`：`amount`大於0；狀態及方式的取值；未作廢時`amount = allocated_amount + available_amount`，`VOID`時兩者均為0而`amount`保留原值。
- 作廢的規則（由程式在鎖下檢查）：只有`CONFIRMED`而且沒有有效核銷的付款可以作廢，須填原因；已核銷的須先解除。號碼保留不重用。
- 不設公司出款帳戶及供應商收款帳戶的欄位。

## 6. `ap_payment_allocations` — 核銷

與`ar_receipt_allocations`相同：`id`、`payment_id`、`invoice_id`、`amount`、`status`（`ACTIVE`、`UNAPPLIED`，解除後保留記錄）、建立及解除的操作者、名稱及時間。

- `KEY(payment_id,status,id)`、`KEY(invoice_id,status,id)`：分別由付款及發票查其核銷。
- 外鍵：`payment_id`→`ap_payments`、`invoice_id`→`ap_invoices`，`RESTRICT`。
- `CHECK`：`amount`大於0；狀態取值。

## 7. `ap_audit_logs` — 操作記錄

與`ar_audit_logs`相同，只把`customer_id`換成`supplier_id`：時間、操作者及名稱、動作、結果、對象類型（`INVOICE`、`PAYMENT`、`ALLOCATION`）及ID、對象標示、原因、內容（JSON，不超過8192位元組）、請求及關聯識別、IP。索引：時間；供應商＋時間；操作者＋時間。trigger拒絕`UPDATE`及`DELETE`。

## 對現有資料及程式的影響

- **現有資料**：零改動。全部是新表，沒有`ALTER`現有的表，沒有回填。
- **鎖**：建立外鍵時會短暫取得被引用的表（`suppliers`、`currencies`、`users`、`goods_receipts`、`goods_receipt_lines`）的metadata lock；沒有量度過，按現時的資料量預期很短。
- **刪除行為的改變**：有發票或付款的供應商、被開票的收貨，其後不可被實體刪除（`RESTRICT`）。已確認的收貨本來就由trigger禁止刪除，所以對收貨沒有新的限制。
- **Business Master**：新表一出現，幣別及付款條款的異動檢查就需要應付的影響檢查，否則全部被擋；影響檢查與資料表在同一個PR交付。
- **權限**：在權限目錄加入`ap.view`、`ap.invoice.mgmt`、`ap.payment.mgmt`及（決定一採A時）`ap.invoice.price.override`，並授予系統管理員；這是資料不是表結構。新增權限會影響現有以完整權限集合比對的測試，實作時一併處理。
- **回滾**：刪除這七張新表及新權限即可，不影響現有資料。
- **不設的東西**：沒有餘額表、ledger、佔用數量表、貸項、關帳日、設定、期初或歸檔的表。
