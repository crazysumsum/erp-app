# 應付與付款最小版本：資料表說明（供Sam批准）

日期：2026-11-24（r5）。作者：`claude-erp-app-tl-01`。對應同目錄的`SCOPE.md`及`DECISIONS.md`。
**草稿；未獲Sam批准前不寫migration。** 來源：`origin/main` `80b54298`（只讀）；以已在main上的應收七張表（`server/database/migrations/0123_create_ar_tables.js`）為藍本，下面逐欄列出，不以「同應收」代替。

本文件按`DECISIONS.md`決定一、二、三的建議（都是A）寫成。Sam若選其他選項，受影響的欄位在各節末以「**隨決定而變**」標明；決定五送批的是按他所選版本定稿的完整欄位。決定三若保留貸項或關帳日，需要的表不在這七張之內，要另行說明及批准。

共同慣例：ID為`BIGINT UNSIGNED`；時間為epoch毫秒的`BIGINT UNSIGNED`；業務日期為`DATE`；金額為`DECIMAL(19,4)`；標「ascii」的欄位是`CHARACTER SET ascii COLLATE ascii_bin`（令`CHECK`及比較分大小寫）；其餘文字欄用表的預設`utf8mb4`／`utf8mb4_unicode_ci`。各表`ENGINE=InnoDB`。全部是**新表**，不修改任何現有的表。

## 1. `ap_document_sequences` — 發票及付款的流水號

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `document_type` | VARCHAR(20) ascii | 否 | 無 | `INVOICE`或`PAYMENT` |
| `business_year` | SMALLINT UNSIGNED | 否 | 無 | 號碼所屬年度，每年重置 |
| `next_value` | INT UNSIGNED | 否 | 1 | 下一個流水號 |
| `updated_at` | BIGINT UNSIGNED | 否 | 無 | 最後取號時間 |

- 主鍵（`document_type`,`business_year`）：一類文件一年一列；取號時鎖這一列，兩人同時確認不會重號。
- `CHECK`：`document_type IN ('INVOICE','PAYMENT')`。
- 號碼格式`APV-YYYY-000001`（應付發票）、`PMT-YYYY-000001`（付款），由程式產生。

## 2. `ap_operation_requests` — 每個操作的識別及結果（防止重送重複生效）

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `event_id` | CHAR(36) ascii | 否 | 無 | 前端為一次操作產生的識別 |
| `command_type` | VARCHAR(40) ascii | 否 | 無 | 例如確認發票、核銷 |
| `target_type` | VARCHAR(20) ascii | 否 | 無 | 操作對象的類型 |
| `target_id` | BIGINT UNSIGNED | 否 | 0 | 操作對象的ID；建立類為0 |
| `request_hash` | CHAR(64) ascii | 否 | 無 | 請求內容的hash，辨認同一識別是否被用於不同內容 |
| `actor_user_id` | BIGINT UNSIGNED | 是 | NULL | 操作者 |
| `actor_label` | VARCHAR(190) | 否 | 無 | 操作者當時的顯示名稱 |
| `result_summary` | JSON | 是 | NULL | 成功後保存的最小結果，重送時原樣回覆 |
| `created_at` | BIGINT UNSIGNED | 否 | 無 | 建立時間 |
| `completed_at` | BIGINT UNSIGNED | 是 | NULL | 完成時間 |

- 主鍵`id`。`UNIQUE(event_id)`：同一識別只生效一次。`KEY(target_type,target_id,id)`：按文件查其操作記錄。
- 外鍵：`actor_user_id`→`users(id)` `ON DELETE SET NULL`。

## 3. `ap_invoices` — 供應商發票

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `invoice_number` | VARCHAR(24) ascii | 是 | NULL | 內部號碼，確認時取號；草稿為空 |
| `status` | VARCHAR(20) ascii | 否 | `DRAFT` | `DRAFT`、`CONFIRMED`、`VOID`、`CANCELLED` |
| `supplier_id` | BIGINT UNSIGNED | 否 | 無 | 供應商 |
| `supplier_code_snapshot` | VARCHAR(64) | 否 | 無 | 開票當時的供應商代碼（長度同`goods_receipts`） |
| `supplier_name_snapshot` | VARCHAR(190) | 否 | 無 | 開票當時的供應商名稱 |
| `currency_code` | CHAR(3) ascii | 否 | 無 | 幣別 |
| `currency_decimal_places` | TINYINT UNSIGNED | 否 | 無 | 開票當時該幣別的小數位 |
| `supplier_invoice_number` | VARCHAR(100) | 否 | 無 | 供應商發票上的號碼，照輸入（已去首尾空白）保存，供顯示 |
| `active_supplier_invoice_key` | VARCHAR(100) `utf8mb4_bin` | 是 | NULL | 發票為`DRAFT`或`CONFIRMED`時等於正規化（去首尾空白、轉大寫）後的供應商發票號碼；取消或作廢時由程式在同一交易改為NULL |
| `invoice_date` | DATE | 否 | 無 | 供應商發票日期 |
| `due_date` | DATE | 否 | 無 | 到期日 |
| `payment_term_code_snapshot` | VARCHAR(50) | 否 | `''` | 採購單上的付款條款代碼，只供顯示 |
| `payment_term_name_snapshot` | VARCHAR(190) | 否 | `''` | 採購單上的付款條款名稱，只供顯示 |
| `due_date_overridden` | TINYINT(1) | 否 | 0 | 到期日是否與按條款算出的預設值不同 |
| `due_date_reason` | VARCHAR(500) | 否 | `''` | 改動預設到期日的原因 |
| `supplier_total_amount` | DECIMAL(19,4) | 是 | NULL | 使用者照供應商發票輸入的總額；確認時必須已輸入並等於`total_amount` |
| `no_po_reason` | VARCHAR(500) | 否 | `''` | 整張發票沒有採購單的原因；只有無採購單發票（沒有任何收貨行）才填，而且必填。與費用行各自的`description`不同：後者說明該行是什麼收費 |
| `total_amount` | DECIMAL(19,4) | 否 | 無 | 系統算出的發票總額 |
| `allocated_amount` | DECIMAL(19,4) | 否 | 0 | 已核銷額 |
| `outstanding_amount` | DECIMAL(19,4) | 否 | 無 | 未付額；帳齡表讀這一欄 |
| `notes` | VARCHAR(2000) | 否 | `''` | 備註 |
| `void_reason` | VARCHAR(500) | 否 | `''` | 作廢原因 |
| `version` | INT UNSIGNED | 否 | 1 | 並發修改時防止互相覆蓋 |
| `created_by` | BIGINT UNSIGNED | 是 | NULL | 建立者 |
| `created_by_label` | VARCHAR(190) | 否 | 無 | 建立者當時的顯示名稱 |
| `confirmed_by` | BIGINT UNSIGNED | 是 | NULL | 確認者 |
| `confirmed_by_label` | VARCHAR(190) | 否 | `''` | 確認者當時的顯示名稱 |
| `confirmed_at` | BIGINT UNSIGNED | 是 | NULL | 確認時間 |
| `voided_by` | BIGINT UNSIGNED | 是 | NULL | 作廢者 |
| `voided_by_label` | VARCHAR(190) | 否 | `''` | 作廢者當時的顯示名稱 |
| `voided_at` | BIGINT UNSIGNED | 是 | NULL | 作廢時間 |
| `created_at` | BIGINT UNSIGNED | 否 | 無 | 建立時間 |
| `updated_at` | BIGINT UNSIGNED | 否 | 無 | 最後修改時間 |

- 主鍵`id`。`UNIQUE(invoice_number)`：內部號碼不重複（草稿的NULL不受限）。
- `UNIQUE(supplier_id, active_supplier_invoice_key)`：**同一供應商的同一張發票不會被入帳兩次**。由資料庫保證，兩人同時輸入時只有一個成功；不同供應商可用相同號碼；作廢或取消後該欄為NULL，號碼可再用。比較用`utf8mb4_bin`，結果只取決於程式正規化後的字元，不受資料庫對空白及大小寫的比較規則影響。
- `KEY(supplier_id,currency_code,status,due_date,id)`：帳齡表及按供應商查詢。`KEY(status,invoice_date,id)`：發票列表。
- 外鍵：`supplier_id`→`suppliers(id)`、`currency_code`→`currencies(code)`，`ON DELETE RESTRICT`；`created_by`、`confirmed_by`、`voided_by`→`users(id)` `ON DELETE SET NULL`。
- `CHECK`：`status`取值；`total_amount`、`allocated_amount`、`outstanding_amount`不為負並且`outstanding_amount = total_amount − allocated_amount`；`due_date >= invoice_date`；`supplier_total_amount`為NULL或不為負。
- 草稿修改由誰做不另設欄位：每次修改寫一筆操作記錄（第7節）。
- **隨決定而變**：決定一採B時不設`supplier_total_amount`及`no_po_reason`；採C時不設`no_po_reason`，`supplier_total_amount`保留。

## 4. `ap_invoice_lines` — 發票行（收貨行或費用行）

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `invoice_id` | BIGINT UNSIGNED | 否 | 無 | 所屬發票 |
| `line_no` | SMALLINT UNSIGNED | 否 | 無 | 行號 |
| `line_type` | VARCHAR(20) ascii | 否 | 無 | `RECEIPT`（來自收貨行）或`EXPENSE`（費用行） |
| `goods_receipt_id` | BIGINT UNSIGNED | 是 | NULL | 來源收貨；費用行為NULL |
| `goods_receipt_line_id` | BIGINT UNSIGNED | 是 | NULL | 來源收貨行；費用行為NULL |
| `active_goods_receipt_line_id` | BIGINT UNSIGNED | 是 | NULL | 收貨行而且發票為`DRAFT`或`CONFIRMED`時等於`goods_receipt_line_id`；作廢、取消時由程式在同一交易改為NULL；費用行恆為NULL |
| `purchase_order_id` | BIGINT UNSIGNED | 是 | NULL | 來源採購單ID，只供追溯，不設外鍵 |
| `purchase_order_line_id` | BIGINT UNSIGNED | 是 | NULL | 來源採購行ID，只供追溯，不設外鍵 |
| `goods_receipt_number_snapshot` | VARCHAR(20) ascii | 否 | `''` | 收貨單號，供顯示 |
| `purchase_order_number_snapshot` | VARCHAR(20) ascii | 否 | `''` | 採購單號，供顯示 |
| `sku_code_snapshot` | VARCHAR(190) | 否 | `''` | 收貨當時的貨品代碼 |
| `sku_name_snapshot` | VARCHAR(190) | 否 | `''` | 收貨當時的貨品名稱 |
| `base_uom_code_snapshot` | VARCHAR(50) | 否 | `''` | 基本單位（長度同`purchase_order_lines`） |
| `purchase_uom_code_snapshot` | VARCHAR(50) | 否 | `''` | 採購單位 |
| `to_base_factor_snapshot` | INT UNSIGNED | 否 | 1 | 一個採購單位等於多少基本單位 |
| `quantity` | BIGINT UNSIGNED | 否 | 0 | 開票數量（基本單位），等於收貨行的收貨數量；費用行為0 |
| `po_unit_price_snapshot` | DECIMAL(19,4) | 否 | 0 | 採購行的單價（每採購單位） |
| `po_line_amount` | DECIMAL(19,4) | 否 | 0 | 按採購單價算出的本行金額（數量 × 單價 ÷ 換算因子，half-up四位小數）；費用行為0 |
| `line_amount` | DECIMAL(19,4) | 否 | 無 | 本行的發票金額。收貨行：沒有改動時等於`po_line_amount`。費用行：使用者輸入的金額 |
| `amount_override_reason` | VARCHAR(500) | 否 | `''` | **只用於收貨行**：`line_amount`與`po_line_amount`不同時的原因。費用行恆為空 |
| `description` | VARCHAR(500) | 否 | `''` | **只用於費用行**：這一行是什麼收費（例如運費）。收貨行為空 |

- 主鍵`id`。`UNIQUE(active_goods_receipt_line_id)`：**一個收貨行同一時間只可在一張有效發票上**，由資料庫保證，兩人同時為同一張收貨開票時只有一個成功。
- 「整張收貨只屬於一張發票」由兩件事合起來保證：這個按收貨行的唯一鍵，加上程式在同一交易為收貨的全部行各建一行、取消或作廢時一併釋放。資料庫本身只保證到行。
- `UNIQUE(invoice_id,line_no)`：同一發票內行號不重複。`KEY(goods_receipt_id,id)`：按收貨查其發票。
- 外鍵：`invoice_id`→`ap_invoices(id)`；`goods_receipt_id`→`goods_receipts(id)`；（`goods_receipt_line_id`,`goods_receipt_id`）→`goods_receipt_lines(id,goods_receipt_id)`（現有唯一鍵`uq_gr_lines_id_gr`），由資料庫保證該行確實屬於該收貨（Purchasing負責人`9e2fd7ab`的建議）。均`ON DELETE RESTRICT`。對採購單及採購行不設外鍵：收貨對採購單已有`RESTRICT`外鍵。
- `CHECK`：`line_type`取值；收貨行的`goods_receipt_id`、`goods_receipt_line_id`不為NULL而且`quantity > 0`；費用行的這兩欄及`active_goods_receipt_line_id`為NULL、`quantity = 0`、`po_line_amount = 0`、`line_amount > 0`、`amount_override_reason = ''`；`po_unit_price_snapshot`、`po_line_amount`、`line_amount`不為負。
- 由程式檢查、不在表結構內的規則：**收貨行**的`line_amount`與`po_line_amount`不同時須`ap.invoice.price.override`及原因；這項權限及原因**不適用於費用行**——加一行正常的運費，或登記整張無採購單發票，只需要`ap.invoice.mgmt`。費用行的`description`不可空白。
- 這張表不獨立保存「發票單價」：收貨行保存採購單價、按採購單價算出的金額及發票金額，畫面上的發票單價由發票金額除以數量折算，只供顯示。
- **隨決定而變**：決定一採B時不設`line_type`、`po_line_amount`、`amount_override_reason`、`description`，兩個收貨ID改為`NOT NULL`。採C時不設`line_type`及`description`，兩個收貨ID改為`NOT NULL`，其餘與A相同。決定二採B（按數量部分開票）時，這張表的唯一鍵不適用，要另加一張按收貨行記錄已佔用數量的表，共八張。

## 5. `ap_payments` — 付款

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `payment_number` | VARCHAR(24) ascii | 是 | NULL | 確認時取號 |
| `status` | VARCHAR(20) ascii | 否 | `DRAFT` | `DRAFT`、`CONFIRMED`、`CANCELLED`、`VOID` |
| `supplier_id` | BIGINT UNSIGNED | 否 | 無 | 供應商 |
| `supplier_code_snapshot` | VARCHAR(64) | 否 | 無 | 當時的供應商代碼 |
| `supplier_name_snapshot` | VARCHAR(190) | 否 | 無 | 當時的供應商名稱 |
| `currency_code` | CHAR(3) ascii | 否 | 無 | 幣別 |
| `currency_decimal_places` | TINYINT UNSIGNED | 否 | 無 | 當時該幣別的小數位 |
| `payment_date` | DATE | 否 | 無 | 付款日期 |
| `amount` | DECIMAL(19,4) | 否 | 無 | 付款金額 |
| `allocated_amount` | DECIMAL(19,4) | 否 | 0 | 已核銷額 |
| `available_amount` | DECIMAL(19,4) | 否 | 無 | 尚可核銷額（即預付款餘額） |
| `payment_method` | VARCHAR(20) ascii | 否 | 無 | `BANK_TRANSFER`、`CHEQUE`、`CASH`、`OTHER` |
| `reference` | VARCHAR(190) | 否 | `''` | 轉帳參考或支票號 |
| `notes` | VARCHAR(2000) | 否 | `''` | 備註 |
| `void_reason` | VARCHAR(500) | 否 | `''` | 作廢原因 |
| `voided_by` | BIGINT UNSIGNED | 是 | NULL | 作廢者 |
| `voided_by_label` | VARCHAR(190) | 否 | `''` | 作廢者當時的顯示名稱 |
| `voided_at` | BIGINT UNSIGNED | 是 | NULL | 作廢時間 |
| `version` | INT UNSIGNED | 否 | 1 | 並發修改時防止互相覆蓋 |
| `created_by` | BIGINT UNSIGNED | 是 | NULL | 建立者 |
| `created_by_label` | VARCHAR(190) | 否 | 無 | 建立者當時的顯示名稱 |
| `confirmed_by` | BIGINT UNSIGNED | 是 | NULL | 確認者 |
| `confirmed_by_label` | VARCHAR(190) | 否 | `''` | 確認者當時的顯示名稱 |
| `confirmed_at` | BIGINT UNSIGNED | 是 | NULL | 確認時間 |
| `created_at` | BIGINT UNSIGNED | 否 | 無 | 建立時間 |
| `updated_at` | BIGINT UNSIGNED | 否 | 無 | 最後修改時間 |

- 主鍵`id`。`UNIQUE(payment_number)`。`KEY(supplier_id,currency_code,status,payment_date,id)`：列表及核銷時選取。
- 外鍵：`supplier_id`→`suppliers(id)`、`currency_code`→`currencies(code)`，`ON DELETE RESTRICT`；`created_by`、`confirmed_by`、`voided_by`→`users(id)` `ON DELETE SET NULL`。
- `CHECK`：`amount > 0`；`status`及`payment_method`取值；`status <> 'VOID'`時`amount = allocated_amount + available_amount`，`VOID`時`allocated_amount = 0`及`available_amount = 0`而`amount`保留原值。
- 作廢的規則（由程式在鎖下檢查）：只有`CONFIRMED`而且`allocated_amount`為0的付款可以作廢，須填原因；已核銷的須先解除。號碼保留不重用。
- 不設公司出款帳戶及供應商收款帳戶的欄位。

## 6. `ap_payment_allocations` — 核銷

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `payment_id` | BIGINT UNSIGNED | 否 | 無 | 付款 |
| `invoice_id` | BIGINT UNSIGNED | 否 | 無 | 發票 |
| `amount` | DECIMAL(19,4) | 否 | 無 | 核銷金額 |
| `status` | VARCHAR(20) ascii | 否 | `ACTIVE` | `ACTIVE`、`UNAPPLIED`（解除後保留記錄） |
| `created_by` | BIGINT UNSIGNED | 是 | NULL | 核銷者 |
| `created_by_label` | VARCHAR(190) | 否 | 無 | 核銷者當時的顯示名稱 |
| `created_at` | BIGINT UNSIGNED | 否 | 無 | 核銷時間 |
| `unapplied_by` | BIGINT UNSIGNED | 是 | NULL | 解除者 |
| `unapplied_by_label` | VARCHAR(190) | 否 | `''` | 解除者當時的顯示名稱 |
| `unapplied_at` | BIGINT UNSIGNED | 是 | NULL | 解除時間 |

- 主鍵`id`。`KEY(payment_id,status,id)`、`KEY(invoice_id,status,id)`：分別由付款及發票查其核銷。
- 外鍵：`payment_id`→`ap_payments(id)`、`invoice_id`→`ap_invoices(id)`，`ON DELETE RESTRICT`；`created_by`、`unapplied_by`→`users(id)` `ON DELETE SET NULL`。
- `CHECK`：`amount > 0`；`status`取值。

## 7. `ap_audit_logs` — 操作記錄

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `occurred_at` | BIGINT UNSIGNED | 否 | 無 | 發生時間 |
| `actor_user_id` | BIGINT UNSIGNED | 是 | NULL | 操作者 |
| `actor_label` | VARCHAR(190) | 否 | 無 | 操作者當時的顯示名稱 |
| `action` | VARCHAR(80) ascii | 否 | 無 | 動作，例如`invoice.confirmed` |
| `outcome` | VARCHAR(20) ascii | 否 | 無 | `SUCCEEDED`、`REJECTED`、`FAILED` |
| `target_type` | VARCHAR(30) ascii | 否 | 無 | `INVOICE`、`PAYMENT`、`ALLOCATION` |
| `target_id` | BIGINT UNSIGNED | 是 | NULL | 對象ID |
| `supplier_id` | BIGINT UNSIGNED | 是 | NULL | 供應商（不設外鍵，記錄不因主檔而受限） |
| `target_label` | VARCHAR(190) | 否 | `''` | 對象的號碼 |
| `reason` | VARCHAR(500) | 否 | `''` | 原因 |
| `detail` | JSON | 是 | NULL | 內容 |
| `request_id` | VARCHAR(64) | 否 | `''` | 請求識別 |
| `correlation_id` | VARCHAR(64) | 否 | `''` | 關聯識別 |
| `ip` | VARCHAR(45) | 否 | `''` | 來源IP |

- 主鍵`id`。`KEY(occurred_at,id)`、`KEY(supplier_id,occurred_at,id)`、`KEY(actor_user_id,occurred_at,id)`：按時間、供應商、操作者查詢。
- 外鍵：`actor_user_id`→`users(id)` `ON DELETE SET NULL`。
- `CHECK`：`outcome`及`target_type`取值；`detail`為NULL或轉成文字後不超過8192位元組。
- 兩個trigger拒絕`UPDATE`及`DELETE`：記錄不可修改。（外鍵的`SET NULL`不觸發trigger，所以刪除使用者仍可清空操作者欄。）
- 以上與`ar_audit_logs`逐欄相同，只有`customer_id`換成`supplier_id`、`target_type`的`RECEIPT`換成`PAYMENT`。

## 對現有資料及程式的影響

- **現有資料**：零改動。全部是新表，沒有`ALTER`現有的表，沒有回填。
- **鎖**：建立外鍵時會短暫取得被引用的表（`suppliers`、`currencies`、`users`、`goods_receipts`、`goods_receipt_lines`）的metadata lock；沒有量度過，按現時的資料量預期很短。
- **刪除行為的改變**：有發票或付款的供應商、被開票的收貨，其後不可被實體刪除（`RESTRICT`）。已確認的收貨本來就由trigger禁止刪除；Supplier沒有實體刪除供應商的路徑。
- **Business Master**：新表一出現，幣別及付款條款的異動檢查就需要應付的影響檢查，否則全部被擋；影響檢查與資料表在同一個PR交付。
- **權限**：在權限目錄加入`ap.view`、`ap.invoice.mgmt`、`ap.payment.mgmt`及（決定一採A或C時）`ap.invoice.price.override`，並授予系統管理員；這是資料不是表結構。新增權限會影響現有以完整權限集合比對的測試，實作時一併處理。
- **回滾**：新表仍是空的、沒有產生任何業務資料時，刪除這七張表及新權限即可，不影響現有資料。一旦有了發票、付款或核銷，這些是財務記錄，不可以刪表回滾，只能以修正的migration向前處理。
- **不設的東西**：沒有餘額表、ledger、佔用數量表、貸項、關帳日、設定、期初或歸檔的表。
