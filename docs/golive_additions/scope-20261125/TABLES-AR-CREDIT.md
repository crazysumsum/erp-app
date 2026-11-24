# 片ARC 應收貸項單及客戶退款：資料表說明（供Sam批准）

日期：2026-11-25（r3）。作者：`claude-erp-app-tl-01`。對應`SCOPE.md` 7.4、7.5。**草稿；未獲批准前不寫migration。** 候選來自`returns.md`；作者改為「核銷計入發票現有的`allocated_amount`、不加發票欄」（`SCOPE.md` 7.4的理由），並去掉生效日期（應收沒有關帳日）。共同慣例：ID為`BIGINT UNSIGNED`；時間為epoch毫秒；金額`DECIMAL(19,4)`；「ascii」指`CHARACTER SET ascii COLLATE ascii_bin`；人員欄為`users(id)`外鍵`ON DELETE SET NULL`。全部是新表。

## 1. `ar_credit_notes` — 應收貸項單

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `credit_note_number` | VARCHAR(24) ascii | 是 | NULL | 確認時取號（`CRN-YYYY-000001`） |
| `status` | VARCHAR(20) ascii | 否 | `DRAFT` | `DRAFT`、`CONFIRMED`、`VOID`、`CANCELLED` |
| `invoice_id` | BIGINT UNSIGNED | 否 | 無 | 原發票 |
| `customer_id` | BIGINT UNSIGNED | 否 | 無 | 客戶（取自原發票） |
| `customer_code_snapshot` | VARCHAR(100) | 否 | 無 | 當時的客戶代碼 |
| `customer_name_snapshot` | VARCHAR(190) | 否 | 無 | 當時的客戶名稱 |
| `currency_code` | CHAR(3) ascii | 否 | 無 | 幣別（取自原發票） |
| `currency_decimal_places` | TINYINT UNSIGNED | 否 | 無 | 當時的小數位 |
| `credit_date` | DATE | 否 | 無 | 貸項日期 |
| `reason` | VARCHAR(500) | 否 | 無 | 原因 |
| `customer_return_id` | BIGINT UNSIGNED | 是 | NULL | 連結的客戶退貨單（可空） |
| `total_amount` | DECIMAL(19,4) | 否 | 無 | 貸項金額＝各行之和（各行已是幣別小數位，不再進位） |
| `applied_amount` | DECIMAL(19,4) | 否 | 0 | 已核銷額（含對原發票的那一筆） |
| `refunded_amount` | DECIMAL(19,4) | 否 | 0 | 已退款額 |
| `available_amount` | DECIMAL(19,4) | 否 | 無 | 可用額 |
| `notes` | VARCHAR(2000) | 否 | `''` | 備註 |
| `void_reason` | VARCHAR(500) | 否 | `''` | 作廢原因 |
| `version` | INT UNSIGNED | 否 | 1 | 並發 |
| `created_by` | BIGINT UNSIGNED | 是 | NULL | 建立者 |
| `created_by_label` | VARCHAR(190) | 否 | 無 | 建立者名稱 |
| `confirmed_by` | BIGINT UNSIGNED | 是 | NULL | 確認者 |
| `confirmed_by_label` | VARCHAR(190) | 否 | `''` | 確認者名稱 |
| `confirmed_at` | BIGINT UNSIGNED | 是 | NULL | 確認時間 |
| `voided_by` | BIGINT UNSIGNED | 是 | NULL | 作廢者 |
| `voided_by_label` | VARCHAR(190) | 否 | `''` | 作廢者名稱 |
| `voided_at` | BIGINT UNSIGNED | 是 | NULL | 作廢時間 |
| `created_at`、`updated_at` | BIGINT UNSIGNED | 否 | 無 | 時間 |

- 主鍵`id`；`UNIQUE(credit_note_number)`；`UNIQUE(id, invoice_id)`；`KEY(invoice_id, status, id)`；`KEY(customer_id, currency_code, status, credit_date, id)`。
- 外鍵：`invoice_id`→`ar_invoices(id)`、`customer_id`→`customers(id)`、`currency_code`→`currencies(code)`、`customer_return_id`→`customer_returns(id)`，均`RESTRICT`；人員→`users` `SET NULL`。
- `CHECK`：狀態取值；`total_amount > 0`；三個金額不為負；未作廢時`total_amount = applied_amount + refunded_amount + available_amount`，`VOID`時三者均為0而`total_amount`保留。

## 2. `ar_credit_note_lines` — 貸項行

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `credit_note_id` | BIGINT UNSIGNED | 否 | 無 | 所屬貸項單 |
| `invoice_id` | BIGINT UNSIGNED | 否 | 無 | 原發票（供複合外鍵） |
| `line_no` | SMALLINT UNSIGNED | 否 | 無 | 行號 |
| `invoice_line_id` | BIGINT UNSIGNED | 是 | NULL | 原發票行；只有原發票是沒有行的期初發票時為NULL |
| `customer_return_line_id` | BIGINT UNSIGNED | 是 | NULL | 連結的退貨行 |
| `base_quantity` | BIGINT UNSIGNED | 是 | NULL | 涉及的數量（只供顯示；純價差為空） |
| `amount` | DECIMAL(19,4) | 否 | 無 | 本行金額，只收幣別小數位（程式驗；r3） |
| `description` | VARCHAR(500) | 否 | `''` | 說明 |

- 主鍵`id`；`UNIQUE(credit_note_id, line_no)`；`KEY(invoice_line_id, id)`（求原發票行的已貸累計）。
- 外鍵：（`credit_note_id`,`invoice_id`）→`ar_credit_notes(id, invoice_id)`；`invoice_line_id`→`ar_invoice_lines(id)`；`customer_return_line_id`→`customer_return_lines(id)`；均`RESTRICT`。
- `CHECK`：`amount > 0`；`base_quantity`為NULL或大於0。
- 由程式在原發票鎖下檢查：發票行屬於`invoice_id`；同一原發票行的已確認貸項累計不超過該行金額；同一原發票的已確認貸項總額累計不超過發票總額；期初發票只容許一行、`invoice_line_id`為NULL；所連退貨行屬於所連退貨單，而且其原出貨行是該發票行的來源。

## 3. `ar_credit_applications` — 貸項核銷

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `credit_note_id` | BIGINT UNSIGNED | 否 | 無 | 貸項單 |
| `invoice_id` | BIGINT UNSIGNED | 否 | 無 | 被核銷的發票（原發票或其他發票） |
| `is_origin` | TINYINT(1) | 否 | 0 | 是否確認時對原發票的那一筆（不可單獨解除） |
| `amount` | DECIMAL(19,4) | 否 | 無 | 核銷額 |
| `status` | VARCHAR(20) ascii | 否 | `ACTIVE` | `ACTIVE`、`UNAPPLIED` |
| `created_by` | BIGINT UNSIGNED | 是 | NULL | 核銷者 |
| `created_by_label` | VARCHAR(190) | 否 | 無 | 核銷者名稱 |
| `created_at` | BIGINT UNSIGNED | 否 | 無 | 核銷時間 |
| `unapplied_by` | BIGINT UNSIGNED | 是 | NULL | 解除者 |
| `unapplied_by_label` | VARCHAR(190) | 否 | `''` | 解除者名稱 |
| `unapplied_at` | BIGINT UNSIGNED | 是 | NULL | 解除時間 |

- 主鍵`id`；`KEY(credit_note_id, status, id)`；`KEY(invoice_id, status, id)`。
- 外鍵：`credit_note_id`→`ar_credit_notes(id)`、`invoice_id`→`ar_invoices(id)`，`RESTRICT`。
- `CHECK`：`amount > 0`；狀態取值；`is_origin IN (0,1)`。
- 核銷時把金額加到發票的`allocated_amount`並減`outstanding_amount`（`SCOPE.md` 7.4）。

## 4. `ar_refunds` — 客戶退款記錄

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `refund_number` | VARCHAR(24) ascii | 是 | NULL | 確認時取號（`RFD-YYYY-000001`） |
| `status` | VARCHAR(20) ascii | 否 | `DRAFT` | `DRAFT`、`CONFIRMED`、`VOID`、`CANCELLED` |
| `credit_note_id` | BIGINT UNSIGNED | 否 | 無 | 來源貸項單 |
| `customer_id` | BIGINT UNSIGNED | 否 | 無 | 取自貸項單 |
| `currency_code` | CHAR(3) ascii | 否 | 無 | 取自貸項單 |
| `refund_date` | DATE | 否 | 無 | 退款日期 |
| `amount` | DECIMAL(19,4) | 否 | 無 | 金額（到幣別小數位） |
| `payment_method` | VARCHAR(20) ascii | 否 | 無 | `BANK_TRANSFER`、`CHEQUE`、`CASH`、`OTHER` |
| `reference` | VARCHAR(190) | 否 | `''` | 參考號 |
| `notes` | VARCHAR(2000) | 否 | `''` | 備註 |
| `void_reason` | VARCHAR(500) | 否 | `''` | 作廢原因 |
| `version` | INT UNSIGNED | 否 | 1 | 並發 |
| `created_by`、`confirmed_by`、`voided_by` | BIGINT UNSIGNED | 是 | NULL | 人員 |
| `created_by_label` | VARCHAR(190) | 否 | 無 | 建立者名稱 |
| `confirmed_by_label`、`voided_by_label` | VARCHAR(190) | 否 | `''` | 名稱 |
| `confirmed_at`、`voided_at` | BIGINT UNSIGNED | 是 | NULL | 時間 |
| `created_at`、`updated_at` | BIGINT UNSIGNED | 否 | 無 | 時間 |

- 主鍵`id`；`UNIQUE(refund_number)`；`KEY(credit_note_id, status, id)`；`KEY(customer_id, refund_date, id)`。
- 外鍵：`credit_note_id`→`ar_credit_notes(id)`、`customer_id`→`customers(id)`、`currency_code`→`currencies(code)`，`RESTRICT`。
- `CHECK`：狀態及方式取值；`amount > 0`。

## 5. 現有表須改的`CHECK`（不改資料、不加欄）

- `ar_document_sequences.chk_ar_sequence_type`：取值加`CREDIT_NOTE`、`REFUND`（已核`0123:34`）。
- `ar_audit_logs.chk_ar_audit_target`：取值加`CREDIT_NOTE`、`CREDIT_APPLICATION`、`REFUND`（已核`0123:225`）。
- `ArBusinessMasterImpactChecker`須把貸項單及退款列入幣別引用：草稿貸項、可用額大於0的已確認貸項及草稿退款算「進行中」，其餘算歷史。

## 影響

- 現有資料不變。新權限：`ar.credit.mgmt`、`ar.refund.mgmt`（查閱沿用`ar.view`）。
- 發票的`allocated_amount`自此包括貸項核銷；收款程式不用改；發票詳情及報表須分別列出兩種核銷。
- 回滾：空表可刪，兩個`CHECK`可改回；有資料後不可。
