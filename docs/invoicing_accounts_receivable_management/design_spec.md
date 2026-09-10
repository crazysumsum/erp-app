# Invoicing & Accounts Receivable Management 系統設計規格

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 狀態 | Ready for Planning；implementation需另行授權 |
| 日期 | 2026-09-10 |
| Requirement baseline | `requirement.md`及`01_requirement_spec.md` |
| 架構基準 | Node.js ES Modules、Express Handler、MySQL、Vue 3、Quasar、Pinia |
| UI／UX基準 | `docs/frontend-design.md` |
| 設計範圍 | Invoicing & AR完整模組；不包含程式實作或Migration序號 |

本設計在現有modular monolith內新增AR bounded context。財務寫操作與其餘額、來源索引、歷史及Audit在同一MySQL transaction完成；耗時的批量、檔案及歸檔工作使用durable job及lease。正式文件、ledger event及來源映射不可覆寫。

## 1. Scope、Goals及Baseline

### 1.1 Goals

1. 保證一張Shipment最多被一張有效Invoice完整開票。
2. 保證Invoice、Credit、Receipt、Allocation及Exposure在重送、並發和commit結果不明下仍守恆。
3. 以快照、Effect Date及append-only event還原任何As-of Date的財務結果。
4. 在每日約10,000張SO、730萬Active候選及50名並發使用者下維持已定性能。
5. 讓Active／Archive、Sales／Fulfillment／Customer之間可雙向追溯且不互相綁死生命週期。

### 1.2 Explicit Non-goals

不設計Tax、GL、FX、Bank Reconciliation、Refund、Customer Return、Debit Note、自動Email、Collection、平台結算Adapter或多公司。Credit Note的壞帳／尾差Reason不等於會計Write-off。

### 1.3 Design Items

| ID | Decision／Component | Covers | Provenance |
| --- | --- | --- | --- |
| DES-001 | 現有modular monolith內建立AR bounded context，Handler薄、Service擁有交易規則。 | FR-001～FR-143 | EXISTING ARCHITECTURE＋NEW |
| DES-002 | API使用decimal string，DB Money用`DECIMAL(19,4)`、Quantity用`DECIMAL(20,6)`／Base Quantity正整數。 | FR-022～FR-038、FR-059～FR-107 | EXISTING CONVENTION |
| DES-003 | 正式文件與Settlement分離狀態機；正式內容append-only。 | FR-022～FR-098、SEC-009 | NEW |
| DES-004 | Shipment Claim及Source Registry以unique key防重，整組建立全有或全無。 | FR-011～FR-024、FR-046～FR-055 | NEW |
| DES-005 | Invoice／Credit／Receipt確認使用durable operation＋單MySQL transaction＋outcome recovery。 | FR-046～FR-085、SEC-015 | NEW |
| DES-006 | 年度文件Sequence於業務交易內鎖取；號碼取得後永不重用。 | FR-005、FR-006、FR-053、FR-064、FR-078 | NEW |
| DES-007 | AR Ledger event為歷史效果真相，Header保存transactional projection供日常查詢。 | FR-064～FR-107 | NEW |
| DES-008 | 固定鎖序：Operation → Sales → Fulfillment source／claim → AR roots → child balances → sequence。 | FR-018、FR-052～FR-085、SEC-015 | NEW |
| DES-009 | Invoice price／分批Shipment原額以Sales快照及確定性remainder算法分配。 | FR-032、FR-037、FR-038 | NEW |
| DES-010 | Billing／Contact／Company／Bank／Item資料在正式確認時重驗並保存白名單快照。 | FR-002～FR-004、FR-025～FR-031、FR-120～FR-123 | NEW |
| DES-011 | Credit Note只引用原Invoice Line；Credit Application以Customer＋Currency鎖控制可用額。 | FR-059～FR-071 | NEW |
| DES-012 | Receipt fact與Allocation分離；解除／重配／整張Reversal以Effect Event記錄。 | FR-072～FR-085 | NEW |
| DES-013 | Customer Account／Aging／Statement共用AsOfProjectionService及相同SQL口徑。 | FR-086～FR-098 | NEW |
| DES-014 | Credit Exposure使用AR projection＋Sales commitment provider，按source classification防雙計。 | FR-099～FR-107 | NEW |
| DES-015 | Opening Import逐source document原子、跨document隔離、content hash idempotent。 | FR-108～FR-119 | NEW |
| DES-016 | 所有PDF／CSV在私有storage；下載重新授權、owner／scope驗證及短期token。 | FR-120～FR-129、SEC-005～SEC-008 | EXISTING PATTERN＋NEW |
| DES-017 | Audit固定builder及敏感欄位redaction；業務原因不寫入metric label。 | FR-130～FR-132、SEC-004、SEC-012 | NEW |
| DES-018 | Finance aggregate獨立Archive，Permanent Source Index維持Active／Archive唯一routing。 | FR-133～FR-143 | NEW |
| DES-019 | Background jobs使用scheduler lease、keyset pagination、bounded batch及backpressure。 | FR-046～FR-051、FR-108～FR-119、FR-126～FR-143、NFR-003～NFR-009 | EXISTING PATTERN＋NEW |
| DES-020 | Provider結果不存在、版本不符或UNKNOWN時fail closed，不在AR複製上游主檔。 | FR-011、FR-052、FR-071、FR-099～FR-107 | NEW |
| DES-021 | 後端fresh permission及object ownership是授權真相；前端只控制可見性。 | FR-001、FR-032、FR-059、FR-072、FR-108、FR-126、SEC-001～SEC-003 | EXISTING＋NEW |
| DES-022 | 銀行敏感欄位使用AES-GCM envelope、AAD owner/context、masked projection。 | FR-003、FR-004、SEC-004～SEC-006 | EXISTING CUSTOMER PATTERN |
| DES-023 | Reconciliation按source、document、ledger、balance、exposure及archive manifest分層。 | FR-132、FR-138～FR-143 | NEW |
| DES-024 | UI使用自動page discovery及共用PageHeader／DataTable／FormPanel／EllipsisCell。 | FR-001～FR-143、SEC-014 | EXISTING FRONTEND |
| DES-025 | Production Recovery目標RTO≤4h、RPO≤15m，須以隔離Restore演練證明。 | NFR-010 | USER APPROVED 2026-09-10 |

## 2. Assumptions、Constraints及Open Decisions

- 單一公司及單一MySQL primary；跨模組Provider與AR部署於同一應用及資料庫，才能共享transaction connection。
- MySQL最低能力以現有專案版本為準；不依賴MySQL 8專用CHECK／window function作正確性保證。
- `CurrencyLookupService`提供ISO code、4位以內precision及active status；所有運算使用decimal-string library，不轉JavaScript Number。
- 外部Sales／Fulfillment設計尚未在main；PHASE-001未完成Provider consumer tests前不得開放Invoice入口。
- RTO≤4h／RPO≤15m、財務記錄≥7年、Import檔90日、Export及可重建PDF檔7日已於2026-09-10批准；legal hold或較長法規優先。
- Migration只按邏輯分片描述；實作時從最新main取下一個可用序號，避免與平行模組衝突。

## 3. Architecture Overview

```text
Vue Pages / Pinia orchestration
        │ HTTPS JSON / private file download
BaseRequestHandler + AJV + auth policy + framework idempotency
        │
AR Application Services
  Workbench | Invoice | Credit | Receipt | Inquiry | Exposure
  Import | Export | Archive | Operation | Reconciliation
        │ transaction-aware provider interfaces
Sales | Fulfillment | Customer | Item | Currency | User
        │
MySQL Active + Durable Jobs + Permanent Index + Archive Mirrors
        │
Private files (PDF/CSV) + Scheduler workers + structured telemetry
```

### 3.1 Module Boundaries

- Handler：解析已驗證input、取得actor/request context、呼叫單一application service、返回統一envelope；不寫SQL及不計金額。
- Domain pure rules：state transition、money、date、rounding、group compatibility、payload canonicalization；無I/O，可unit test。
- Application services：權限重驗、transaction、固定鎖序、Provider協調、Audit及operation outcome。
- Repositories：parameterized SQL、row mapping及bounded query；不得含跨aggregate商業判斷。
- Jobs：claim lease後呼叫同一application command；不建立第二套確認規則。
- Providers：傳入既有transaction，禁止自行commit／rollback或打回自己HTTP API。

## 4. State、Invariants及Algorithms

### 4.1 States

| Aggregate | States | Allowed transitions |
| --- | --- | --- |
| Invoice | `DRAFT`,`ISSUING`,`ISSUED`,`VOIDING`,`VOID`,`CANCELLED` | DRAFT→ISSUING／CANCELLED；ISSUING→ISSUED／DRAFT；ISSUED→VOIDING；VOIDING→VOID／ISSUED |
| Invoice settlement | `OPEN`,`PARTIALLY_SETTLED`,`SETTLED` | 由有效Credit及Receipt投影計算，不由client命令直接設置。 |
| Credit Note | `DRAFT`,`ISSUING`,`ISSUED`,`VOIDING`,`VOID`,`CANCELLED` | 與Invoice相同骨架；只允許在來源Invoice合法時轉移。 |
| Receipt | `DRAFT`,`CONFIRMING`,`CONFIRMED`,`REVERSING`,`REVERSED`,`CANCELLED` | DRAFT→CONFIRMING／CANCELLED；CONFIRMED→REVERSING；技術未知保留processing。 |
| Claim | `ACTIVE`,`CONSUMED`,`RELEASED` | ACTIVE→CONSUMED／RELEASED；不可回復ACTIVE。 |
| Operation | `IN_PROGRESS`,`SUCCEEDED`,`FAILED` | terminal不可變；lease只改owner／until。 |
| Job | `QUEUED`,`PROCESSING`,`PARTIALLY_COMPLETED`,`COMPLETED`,`FAILED`,`CANCELLED`,`EXPIRED` | terminal不可重開；重試由原Job未完成item繼續。 |
| Archive Batch | `RUNNING`,`PARTIAL`,`COMPLETED`,`FAILED` | 同period key復用原Batch恢復。 |

### 4.2 Quantity and Money Invariants

所有金額API為固定4位decimal string；DB為`DECIMAL(19,4)`。Currency precision只影響輸入合法位數及顯示，不改4位儲存真值。禁止binary float。

```text
invoice.original = Σ invoice_line.line_amount
invoice.credit_applied = Σ effective credit applications to invoice
invoice.receipt_applied = Σ effective receipt allocations to invoice
invoice.outstanding = original - credit_applied - receipt_applied
0 <= outstanding <= original

credit_note.total = Σ credit_note_line.credit_amount
credit.available = credit_note.total - amount_used_to_origin - Σ active credit applications
receipt.available = receipt.amount - Σ active receipt allocations

exposure = active AR outstanding
         + confirmed uninvoiced Sales commitment
         - available credit balances
         - unallocated confirmed receipts
```

每項運算使用同一`Money`純函式並在transaction內以fresh locked rows重算；client傳入的total只作compare，不作真相。跨Currency不相加。

### 4.3 Shipment Source Allocation

- Source quantity使用Fulfillment回傳Base Quantity正整數；Invoice顯示Quantity可用`DECIMAL(20,6)`。
- 可被Sales UOM factor整除時沿用Sales UOM／price；否則用Base UOM，source gross amount按`SO line amount × shipped base qty / ordered base qty`計算到4位。
- 非最後Shipment使用half-up 4位；最後可開票Shipment取得`SO line amount - prior active source amounts`尾差。
- 在鎖定Sales line invoice allocation row後計算；`UNIQUE(shipment_line_id)`及累計不超SO line amount。
- Void釋放source；Credit不釋放source。局部Shipment Reversal須其mapped source net exposure為0。

### 4.4 Group Compatibility

合併key為`customer_id + currency_code + billing_address_id_or_null + payment_term_snapshot_hash + invoice_date`。Warehouse及SO不在key內。每張Shipment完整加入一組；preview返回每組原因。建立時在同一transaction claim全部選中Shipment；任一衝突整個request不留下Draft。

## 5. Backend Components

| Service | Responsibility |
| --- | --- |
| `ArSettingsService` | 公司快照、銀行、sequence prefix、close date及history。 |
| `InvoiceableWorkbenchService` | bounded候選、group preview、不能開票原因。 |
| `InvoiceService` | Shipment／Manual Draft、versioned update、cancel、detail及allowed actions。 |
| `InvoiceConfirmationService` | Phase A intent、Phase B正式確認、Void及recovery。 |
| `InvoiceSourceService` | Claim、source amount／UOM allocation、Fulfillment guard projection。 |
| `CreditNoteService` | Draft、confirm、application、unapply、void及source credit proof。 |
| `ReceiptService` | Draft、confirm、allocation、unapply／reapply、reversal。 |
| `ArLedgerService` | append-only financial effect event及transactional projections。 |
| `ArInquiryService` | Active／Archive list、detail、Customer Account及cross-document trace。 |
| `ArAsOfProjectionService` | Outstanding、Overdue、Aging、Statement共用Effect Date算法。 |
| `CreditExposureService` | AR＋Sales commitment安全projection及Sales provider。 |
| `OpeningArImportService` | template、precheck、bounded items、confirm及result。 |
| `ArDocumentService` | snapshot projection、A4 print及PDF job。 |
| `ArExportService` | allowlisted bounded filters、CSV neutralization及owner-safe file。 |
| `ArOperationService` | event/hash/lease/outcome及commit-unknown recovery。 |
| `ArArchiveService` | eligibility、copy/hash/delete/routing及query。 |
| `ArAuditService` | fixed action builder、reason、before/after summary及redaction。 |
| `ArReconciliationService` | source、ledger、balance、exposure、operation及archive對賬。 |

## 6. Database Design

### 6.1 Global Conventions

- ID：`BIGINT UNSIGNED AUTO_INCREMENT`；外部event：`CHAR(36) ASCII`；時間：`BIGINT UNSIGNED` epoch ms；業務日期：`DATE`。
- Currency：`CHAR(3) ASCII`；Money：`DECIMAL(19,4)`；Quantity：`DECIMAL(20,6)`；Base Quantity：`BIGINT UNSIGNED`。
- Status／type：`VARCHAR(30) ASCII`＋service allowlist，避免DB enum部署鎖定。
- 所有mutable root有`version INT UNSIGNED NOT NULL DEFAULT 1`及CAS update。
- 財務child使用composite ownership FK，例如`(invoice_id,line_id)`，防止IDOR式跨父關聯。
- MySQL 5.7不能可靠執行所有CHECK，故service驗證＋真MySQL unique／FK／trigger雙層控制。
- append-only表拒絕application UPDATE／DELETE；以DB trigger防誤操作。Archive受專用service identity控制。

### 6.2 Settings and Reference Tables

#### `ar_settings`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `id` | TINYINT UNSIGNED | PK，固定1 | 單公司singleton。 |
| `company_legal_name`,`company_address`,`company_contact`,`document_footer` | VARCHAR(255/1000/255/1000) | NOT NULL／`''` | 新正式文件的公司snapshot來源。 |
| `invoice_prefix`,`credit_prefix`,`receipt_prefix` | VARCHAR(10) ASCII | NOT NULL | 只允許大寫字母數字及`-`；變更不回寫舊號。 |
| `ar_close_date` | DATE | NULL | 該日及以前不接受新Effect。 |
| `version` | INT UNSIGNED | 1 | CAS。 |
| `updated_by`,`updated_at` | BIGINT UNSIGNED／BIGINT UNSIGNED | actor nullable／required | Actor及epoch ms。 |

#### `ar_bank_accounts`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Bank account ID。 |
| `currency_code` | CHAR(3) ASCII | NOT NULL | 共用Currency；同幣別default scope。 |
| `bank_name`,`account_name` | VARCHAR(190) | NOT NULL | 非秘密但一般列表最少化。 |
| `account_number_ciphertext`,`nonce`,`auth_tag`,`key_version` | VARBINARY(1024/12/16)／SMALLINT | NOT NULL | AES-GCM envelope；AAD=`AR_BANK:{id}:{currency}`。 |
| `account_number_last4` | VARCHAR(4) ASCII | NOT NULL | Masked lookup/display。 |
| `is_default`,`status` | TINYINT(1)／VARCHAR(20) | 0／`ACTIVE` | generated `default_scope`確保每Currency最多一個Active default。 |
| `version`,`created_by`,`updated_by`,`created_at`,`updated_at` | INT/BIGINT | NOT NULL | CAS及Audit metadata。 |

Keys：`UNIQUE(currency_code,default_scope)`、`INDEX(currency_code,status,id)`。完整帳號不進一般Audit／Log／Export。

#### `ar_document_sequences`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `document_type`,`business_year` | VARCHAR(20) ASCII／SMALLINT | composite PK part | `INVOICE`,`CREDIT_NOTE`,`RECEIPT`各年度。 |
| `prefix_snapshot` | VARCHAR(10) ASCII | NOT NULL | 第一次取號固定；同年變更以新sequence generation row處理。 |
| `generation` | SMALLINT UNSIGNED | composite PK part | Prefix修改後遞增；若改回舊prefix，必須復用該prefix既有generation及其`next_value`。 |
| `next_value` | BIGINT UNSIGNED | 1 | `SELECT ... FOR UPDATE`後取號及+1。 |
| `updated_at` | BIGINT UNSIGNED | NOT NULL | 監察。 |

Primary key為`(document_type,business_year,generation)`。Business number格式`{prefix}{YYYY}-{sequence padded 8}`，全表另保存於`ar_permanent_document_index`作全域unique；不能靠切換prefix把相同號碼重新由1開始。

### 6.3 Durable Operation and Batch Tables

#### `ar_operation_requests`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Internal operation。 |
| `event_id` | CHAR(36) ASCII | UNIQUE／NOT NULL | Domain idempotency key。 |
| `operation_type` | VARCHAR(40) ASCII | NOT NULL | ISSUE_INVOICE、CREDIT_CONFIRM、RECEIPT_CONFIRM等。 |
| `actor_user_id`,`service_identity` | BIGINT／VARCHAR(80) | nullable | Human或worker identity；二者恰一。 |
| `payload_hash` | CHAR(64) ASCII | NOT NULL | Canonical allowlisted payload SHA-256。 |
| `target_type`,`target_id` | VARCHAR(30)／BIGINT | nullable | Outcome定位。 |
| `status`,`result_code`,`safe_result` | VARCHAR(20/80)／JSON | required／defaults | `IN_PROGRESS/SUCCEEDED/FAILED`及最小結果。 |
| `lease_owner`,`lease_until`,`attempt_count` | CHAR(36)／BIGINT／INT | nullable／0 | CAS lease及恢復。 |
| `created_at`,`updated_at`,`completed_at` | BIGINT UNSIGNED | completed nullable | 時間。 |

Keys：`UNIQUE(event_id)`、`INDEX(status,lease_until,id)`、`INDEX(target_type,target_id,created_at,id)`。同event不同hash回`AR_EVENT_CONFLICT`；最少保存7年。

#### `ar_batch_jobs` and `ar_batch_job_items`

Jobs保存`job_type,status,filter_snapshot,source_set_hash,total/success/failed/skipped/processing,lease,owner,timestamps,version`；Items保存`job_id,item_key,payload_hash,status,target_type,target_id,error_code,attempt_count,timestamps`。`UNIQUE(job_id,item_key)`及`INDEX(status,next_attempt_at,id)`；批次來源在建立時物化，不把後來新增資料暗中加入。

### 6.4 Invoice Tables

#### `ar_invoices`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED | PK／AI | Invoice aggregate root。 |
| `invoice_number` | VARCHAR(40) ASCII | NULL／UNIQUE | DRAFT無號；ISSUED後永不清空。 |
| `invoice_type` | VARCHAR(20) ASCII | NOT NULL | `SHIPMENT`,`MANUAL`,`OPENING`。 |
| `status`,`settlement_status` | VARCHAR(20) ASCII | NOT NULL | 文件／計算狀態分離。 |
| `customer_id` | BIGINT UNSIGNED | NOT NULL | Active master ID；Archive後仍保留值。 |
| `customer_code_snapshot`,`customer_name_snapshot` | VARCHAR(50/190) | NOT NULL | 正式快照。 |
| `currency_code` | CHAR(3) ASCII | NOT NULL | Aggregate currency。 |
| `invoice_date`,`due_date`,`effect_date` | DATE | invoice/effect required；due draft nullable | due正式前必填。 |
| `payment_term_id`,`payment_term_version` | BIGINT/INT | NULL | Selected master reference。 |
| `payment_term_snapshot` | JSON | NULL | Allowlisted code/name/days/rule。 |
| `billing_address_id`,`billing_contact_id` | BIGINT UNSIGNED | NULL | 選填reference。 |
| `billing_snapshot`,`contact_snapshot` | JSON | NULL | 正式白名單snapshot，不猜值。 |
| `company_snapshot`,`bank_account_snapshot` | JSON | issue前nullable | 正式文件snapshot；銀行只含文件允許欄位。 |
| `original_amount`,`credit_applied_amount`,`receipt_applied_amount`,`outstanding_amount` | DECIMAL(19,4) | NOT NULL／0 | Transactional projection及守恆。 |
| `price_override_count` | INT UNSIGNED | 0 | 審查projection。 |
| `manual_reason`,`notes`,`internal_follow_up_notes` | VARCHAR(500/2000/2000) | default `''` | Manual原因必填；follow-up不改正式snapshot。 |
| `source_claim_set_hash` | CHAR(64) ASCII | NULL | Shipment invoice source set。 |
| `version` | INT UNSIGNED | 1 | Draft及notes CAS。 |
| `created_by`,`updated_by`,`issued_by`,`voided_by` | BIGINT UNSIGNED | nullable FK users SET NULL | Actors。 |
| `created_at`,`updated_at`,`issued_at`,`voided_at` | BIGINT UNSIGNED | milestones nullable | epoch ms。 |

Indexes：`UNIQUE(invoice_number)`、`INDEX(customer_id,status,invoice_date,id)`、`INDEX(status,invoice_date,id)`、`INDEX(settlement_status,due_date,id)`、`INDEX(currency_code,due_date,id)`、`INDEX(created_by,created_at,id)`。不可把notes／JSON放covering list query。

#### `ar_invoice_lines`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `id`,`invoice_id`,`line_no` | BIGINT／BIGINT／INT | PK／FK／required | `UNIQUE(invoice_id,line_no)`。 |
| `line_type` | VARCHAR(20) ASCII | NOT NULL | `SHIPMENT`,`MANUAL`,`OPENING`。 |
| `sku_id` | BIGINT UNSIGNED | NULL | Manual可空；歷史不依賴current Item。 |
| `sku_code_snapshot`,`description_snapshot`,`uom_code_snapshot` | VARCHAR(80/500/30) | NOT NULL | 文件顯示。 |
| `quantity` | DECIMAL(20,6) | >0 | Invoice UOM quantity。 |
| `base_quantity`,`uom_to_base_factor` | BIGINT UNSIGNED | NULL | Shipment line必填。 |
| `source_unit_price`,`invoice_unit_price`,`line_amount` | DECIMAL(19,4) | NOT NULL | 原價、最終價、server total。 |
| `price_override_reason` | VARCHAR(500) | `''` | 價格不同時必填。 |
| `credited_amount`,`receipt_applied_amount`,`outstanding_amount` | DECIMAL(19,4) | 0 | Line-level projection。 |
| `snapshot_hash` | CHAR(64) ASCII | issue前required | 文件重建／對賬。 |

Keys：`UNIQUE(invoice_id,line_no)`、`UNIQUE(invoice_id,id)`、`INDEX(sku_id,invoice_id,id)`。Shipment line不可update quantity/source fields；正式後全行不可update。

#### `ar_invoice_line_sources`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `id`,`invoice_id`,`invoice_line_id` | BIGINT UNSIGNED | PK／FKs | composite ownership FKs。 |
| `shipment_id`,`shipment_line_id`,`sales_order_id`,`sales_order_line_id` | BIGINT UNSIGNED | NOT NULL | 永久來源IDs；不依賴單邊Active FK。 |
| `source_base_quantity` | BIGINT UNSIGNED | >0 | 本source完整出貨量。 |
| `source_amount` | DECIMAL(19,4) | >=0 | 本source確定性原額。 |
| `effective_invoice_amount` | DECIMAL(19,4) | >=0 | 改價後對本source分配額。 |
| `credited_amount` | DECIMAL(19,4) | 0 | Reversal guard projection。 |
| `shipment_version`,`sales_line_version` | INT UNSIGNED | NOT NULL | 確認時Provider evidence。 |
| `source_snapshot`,`source_hash` | JSON／CHAR(64) | NOT NULL | SO／Shipment白名單證據。 |

Keys：`UNIQUE(shipment_line_id)`只適用active effective Invoice source，透過`ar_invoice_source_registry`實現Void後可重開；另`UNIQUE(invoice_line_id,shipment_line_id)`、`INDEX(shipment_id,invoice_id,id)`、`INDEX(sales_order_id,invoice_id,id)`。

#### `ar_invoice_claims` and `ar_invoice_source_registry`

Claim列保存`shipment_id,invoice_id,batch_item_id,claim_status,claim_owner,event_id,payload_hash,created_at,released_at,consumed_at`。`active_scope BIGINT GENERATED ALWAYS AS (CASE WHEN claim_status='ACTIVE' THEN shipment_id ELSE NULL END)`及`UNIQUE(active_scope)`保證一張Shipment只有一個ACTIVE claim，並允許多個歷史RELEASED／CONSUMED列。Registry以`shipment_id`為PK，保存current invoice/source state、active/archive routing及version；Invoice Void在同transaction令registry回`AVAILABLE`但保留history。任何Claim／Registry關係須與Fulfillment provider的完整line set一致。

#### `ar_invoice_status_history`

Append-only：`id,invoice_id,sequence_no,from_status,to_status,effect_date,reason,actor_user_id,event_id,occurred_at`；`UNIQUE(invoice_id,sequence_no)`。正式內容修改防護trigger允許Archive service identity執行copy/delete，不允許一般application update。

### 6.5 Credit Tables

#### `ar_credit_notes`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `id`,`invoice_id` | BIGINT UNSIGNED | PK／FK RESTRICT | 一張Credit只屬一張Invoice。 |
| `credit_note_number` | VARCHAR(40) ASCII | NULL／UNIQUE | 正式後不可重用。 |
| `status`,`credit_date`,`effect_date` | VARCHAR(20)／DATE | NOT NULL | 關帳及As-of使用Effect Date。 |
| `customer_id`,`currency_code` | BIGINT／CHAR(3) | NOT NULL | 從Invoice複製並在確認時重驗。 |
| `reason_code`,`reason` | VARCHAR(40/500) | NOT NULL | Allowlist＋具體原因。 |
| `total_amount`,`origin_outstanding_reduction`,`credit_balance_created`,`available_amount` | DECIMAL(19,4) | 0 | Transactional projections。 |
| `document_snapshot`,`snapshot_hash` | JSON／CHAR(64) | issue前nullable | 正式文件不可變快照。 |
| `version`,`created_by`,`issued_by`,`voided_by`,`created_at`,`updated_at`,`issued_at`,`voided_at` | INT／BIGINT | 按milestone nullable | CAS、actor及時間。 |

Indexes：`UNIQUE(credit_note_number)`、`INDEX(invoice_id,status,id)`、`INDEX(customer_id,currency_code,status,credit_date,id)`。正式後只允許狀態透過受控Void transition改變。

#### `ar_credit_note_lines`

保存`id,credit_note_id,line_no,invoice_id,invoice_line_id,quantity,unit_amount,credit_amount,amount_applied_to_origin,credit_balance_amount,source_allocation_hash`。以`UNIQUE(credit_note_id,line_no)`及composite FK`(invoice_id,invoice_line_id)`防跨Invoice line；Credit quantity／amount必須正數且累計不超原Line可貸項額。

#### `ar_credit_line_sources`

保存Credit line對`invoice_line_source_id,shipment_id,shipment_line_id,credit_amount`的確定性分配。`UNIQUE(credit_note_line_id,invoice_line_source_id)`；同一Credit line分配合計等於line credit amount。Reversal guard按Shipment彙總有效issued、非void source credits。

#### `ar_credit_applications`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `id`,`credit_note_id`,`target_invoice_id` | BIGINT UNSIGNED | PK／FK | 同Customer／Currency。 |
| `amount` | DECIMAL(19,4) | >0 | 不超credit available或target outstanding。 |
| `status` | VARCHAR(20) ASCII | `ACTIVE` | `ACTIVE`,`UNAPPLIED`。 |
| `effect_date`,`unapplied_effect_date` | DATE | second nullable | As-of history。 |
| `event_id`,`unapplied_event_id` | CHAR(36) ASCII | required／nullable | 重送身份。 |
| `reason`,`created_by`,`unapplied_by`,`created_at`,`unapplied_at` | scalar | 按狀態nullable | 追溯。 |

`UNIQUE(event_id)`、`INDEX(credit_note_id,status,id)`、`INDEX(target_invoice_id,status,id)`。解除不delete原列；重配新增新列。

### 6.6 Receipt and Allocation Tables

#### `ar_receipts`

| Column | Type | Null／Default | Description |
| --- | --- | --- | --- |
| `id`,`receipt_number` | BIGINT／VARCHAR(40) | PK／正式後UNIQUE | DRAFT無正式號。 |
| `status`,`customer_id`,`currency_code` | VARCHAR/BIGINT/CHAR(3) | NOT NULL | Aggregate身份。 |
| `receipt_date`,`effect_date` | DATE | NOT NULL | 不可未來／關帳期。 |
| `amount`,`allocated_amount`,`available_amount` | DECIMAL(19,4) | amount>0／其餘0 | `amount=allocated+available`。 |
| `payment_method` | VARCHAR(20) ASCII | NOT NULL | BANK_TRANSFER、CASH、CHEQUE、OTHER。 |
| `bank_account_id`,`transaction_reference`,`cheque_number`,`other_method_description` | scalar | method-dependent | 由schema及service驗證；銀行snapshot另存。 |
| `bank_account_snapshot`,`customer_snapshot` | JSON | 正式前nullable | Allowlisted正式快照。 |
| `version`,`created_by`,`confirmed_by`,`reversed_by`,`created_at`,`updated_at`,`confirmed_at`,`reversed_at` | INT／BIGINT | 按狀態 | CAS、actor及milestone。 |

Indexes：`UNIQUE(receipt_number)`、`INDEX(customer_id,currency_code,status,receipt_date,id)`、`INDEX(status,receipt_date,id)`、`INDEX(transaction_reference,customer_id,id)`；transaction reference不作全域唯一，允許現實渠道重複但在UI警告。

#### `ar_receipt_allocations`

保存`id,receipt_id,invoice_id,amount,status,effect_date,event_id,reason,created_by,created_at,unapplied_effect_date,unapplied_event_id,unapplied_by,unapplied_at`。`UNIQUE(event_id)`，composite ownership驗Customer＋Currency；`INDEX(receipt_id,status,id)`、`INDEX(invoice_id,status,id)`。Unapply只轉狀態；Reversal批次將所有active allocation標記`REVERSED`並產生反向ledger effect。

#### `ar_receipt_reversals`

一張Receipt最多一筆成功Reversal：`id,receipt_id,reversal_number,status,effect_date,reason,event_id,payload_hash,total_reversed_amount,created_by,created_at,completed_at`；generated `successful_scope=CASE WHEN status='COMPLETED' THEN receipt_id ELSE NULL END`配合`UNIQUE(successful_scope)`及`UNIQUE(event_id)`。`ar_receipt_reversal_details`保存每個原Allocation的反向額及目標Invoice before/after projection，`UNIQUE(reversal_id,receipt_allocation_id)`。Reversal同時把全部active allocation反向、把Receipt未核銷available amount歸零，令Receipt `allocated_amount=0, available_amount=0, status=REVERSED`；不能把未用餘額留成仍可核銷款。

### 6.7 Ledger and Balance Projections

#### `ar_ledger_events`

Append-only欄位：

| Column | Type | Description |
| --- | --- | --- |
| `id` | BIGINT UNSIGNED PK／AI | 全域財務事件序。 |
| `customer_id`,`currency_code` | BIGINT／CHAR(3) | Account partition。 |
| `effect_date`,`occurred_at` | DATE／BIGINT | Business As-of及實際事件時間。 |
| `event_type` | VARCHAR(40) ASCII | INVOICE_ISSUED、CREDIT_ISSUED、RECEIPT_ALLOCATED、ALLOCATION_UNAPPLIED、RECEIPT_REVERSED等。 |
| `document_type`,`document_id`,`document_number` | scalar | 來源文件。 |
| `invoice_id` | BIGINT UNSIGNED NULL | 受影響Invoice；customer-level credit／receipt可空。 |
| `ar_delta`,`credit_available_delta`,`receipt_available_delta` | DECIMAL(19,4) | 三個分開的帶符號效果。 |
| `event_id`,`source_event_id` | CHAR(36) ASCII | `event_id` UNIQUE；反向指向原事件。 |
| `payload_hash`,`details` | CHAR(64)／JSON | Canonical evidence；details≤16KiB。 |

Indexes：`UNIQUE(event_id)`、`INDEX(customer_id,currency_code,effect_date,id)`、`INDEX(invoice_id,effect_date,id)`、`INDEX(document_type,document_id,id)`。Trigger拒絕UPDATE／DELETE。Ledger是As-of真相；root balances是同transaction cache，Reconciliation必須能由ledger重建。

#### `ar_customer_currency_balances`

每個Customer＋Currency一列：`customer_id,currency_code,invoice_outstanding,available_credit,unallocated_receipt,version,last_ledger_event_id,updated_at`。PK`(customer_id,currency_code)`；鎖序按Customer ID／Currency。不可存跨幣總額。

#### `ar_exposure_snapshots`

不是財務真相，只是Sales讀取加速projection：`customer_id,currency_code,ar_outstanding,uninvoiced_commitment,available_credit,unallocated_receipt,total_exposure,source_versions,computed_at,status`。PK同上。任何provider UNKNOWN令`status=UNKNOWN`且Sales不得用舊值當0；Reconciliation定期比較事件分類。

### 6.8 Documents、Audit and Permanent Routing

#### `ar_document_snapshots`

`document_type,document_id,version,payload_json,payload_hash,render_version,created_at`；PK`(document_type,document_id,version)`。正式文件以version 1固定；Void／Reversal watermark是狀態projection，不改原payload。

#### `ar_permanent_document_index`

| Column | Type | Description |
| --- | --- | --- |
| `document_type`,`document_id` | VARCHAR(30)／BIGINT | composite PK。 |
| `document_number` | VARCHAR(40) ASCII UNIQUE | 全生命週期查詢。 |
| `customer_id`,`currency_code` | scalar | Bounded lookup。 |
| `storage_tier` | VARCHAR(10) | `ACTIVE`或`ARCHIVE`。 |
| `archive_batch_id`,`version`,`updated_at` | scalar | atomic routing CAS。 |

另`ar_permanent_source_index`以`source_type,source_id`為PK，保存Invoice／Shipment／SO／Opening external key及storage tier。Index不保存敏感快照，不隨archive purge。

#### `ar_audit_logs`

Append-only：`id,occurred_at,actor_user_id,actor_label,action,target_type,target_id,target_number,outcome,reason,before_summary,after_summary,event_id,request_id,correlation_id,ip_address`。固定builder限制JSON≤16KiB；銀行只記last4／key version，不記ciphertext或明文。Indexes按target、action、actor及occurred_at。

### 6.9 Import and Export Tables

#### `ar_opening_import_jobs`

保存`id,batch_number,template_version,original_file_name,source_file_path,result_file_path,file_sha256,file_size_bytes,status,total_row_count,source_document_count,valid/invalid/duplicate/success/failed/warning counts,version,lease,owner,timestamps,files_purged_at`。`UNIQUE(batch_number)`、`INDEX(status,created_at,id)`、`INDEX(owner,created_at,id)`；檔案私有並於90日後安全purge，legal hold優先。

#### `ar_opening_import_documents` and `ar_opening_import_errors`

Document保存`job_id,external_source,source_document_key,key_hash,payload_hash,status,invoice_id,credit_balance_event_id,result_code,row range,attempt,next_attempt_at,timestamps`。`UNIQUE(external_source,key_hash)`跨Job防重：same hash replay，different hash conflict。Error保存`document_id,row_no,field_path,error_code,safe_message,value_summary`，一文件最多200項。

#### `ar_export_jobs`

保存`id,export_type,scope,filters,filters_hash,as_of_date,status,row_count,file_path,error_code,lease,created_by,timestamps,expires_at`。一律background以保持單一路徑；`INDEX(status,created_at,id)`、`INDEX(created_by,created_at,id)`、`INDEX(expires_at,status,id)`。Export result及可由正式snapshot重建的PDF檔7日後安全purge，legal hold優先；下載時重驗owner或明確support permission及原scope。

### 6.10 Archive Tables

`ar_archive_batches`保存period key、cutoff、status、counts、keyset cursor、lease及checksum summary；`UNIQUE(period_key)`。`ar_archive_manifests`每aggregate保存active table counts、hashes、routing version及participant versions，`UNIQUE(root_type,root_id)`。

下列表各自鏡像Active業務欄位，使用原ID作PK，另加`archive_batch_id,archived_at,row_hash`；不`AUTO_INCREMENT`，FK只指Archive parent，不指Active master：

- `ar_invoices_archive`、`ar_invoice_lines_archive`、`ar_invoice_line_sources_archive`、`ar_invoice_status_history_archive`、`ar_document_snapshots_archive`。
- `ar_credit_notes_archive`、`ar_credit_note_lines_archive`、`ar_credit_line_sources_archive`、`ar_credit_applications_archive`。
- `ar_receipts_archive`、`ar_receipt_allocations_archive`、`ar_receipt_reversals_archive`、`ar_receipt_reversal_details_archive`。
- 與root相關的`ar_ledger_events_archive`及`ar_audit_logs_archive`；customer-level available balance未清零時不得搬離Active。

Eligibility：document terminal、outstanding=0、available credit=0、unallocated receipt=0、無active application／claim／IN_PROGRESS operation、last business effect早於cutoff。跨SO Invoice不等待所有SO同行歸檔；source index分別route。搬移在單transaction按root鎖、copy、count/hash、manifest、routing CAS、delete child→root；任一差異rollback。Archive資料不可修改，且至少保留7年／legal hold優先。Customer Statement planner按查詢日期與已完成archive cutoff決定只查Active或顯式`UNION ALL` Active＋Archive；同一ledger event由manifest及PK保證只存在一個tier，日常current view不自動掃Archive。

### 6.11 Logical Migration Slices

1. Permissions、config、settings、bank、sequence及operation。
2. Invoice roots、lines、claim、source registry、history及snapshot。
3. Credit、credit source/application及ledger/balance projection。
4. Receipt、allocation、reversal及ledger projection。
5. Batch、Opening Import、Export、Audit及files metadata。
6. Permanent indexes、Archive batches／mirrors／triggers及reconciliation indexes。

每片Migration具forward-only up及非破壞rollback說明；已發正式資料不得用down migration刪除。新增nullable／table先行、provider部署、功能旗標啟用、最後才加不可變trigger。

## 7. API and Interface Contracts

### 7.1 Common Contract

- Base path `/api/v1`；成功沿用`{data,meta}` envelope；錯誤沿用framework public code及field issues。
- List使用`pageSize≤100`及keyset cursor；sort／filter／columns全部allowlist。精確number優先查Permanent Index。
- 所有write帶`eventId` UUID及`expectedVersion`；transport層另用`Idempotency-Key`。同event同hashreplay；不同hash 409 `AR_EVENT_CONFLICT`。
- 長操作3秒內返回`202 {operationId,status,statusUrl}`；client只poll同一operation，不建立新event。
- Decimal與quantity是字串；DATE是`YYYY-MM-DD`；timestamp是安全整數epoch ms字串或number（須在JS safe range）。

### 7.2 Settings and Lookup APIs

| Method／Path | Permission | Request／Response essentials |
| --- | --- | --- |
| `GET /ar/settings` | `ar.settings` | 完整設定、masked bank accounts、version。 |
| `PATCH /ar/settings` | `ar.settings`＋敏感變更重新認證 | `{expectedVersion,changes,reason,password?,eventId}`。 |
| `GET/POST/PATCH /ar/bank-accounts` | `ar.settings` | List masked；write encrypted；default CAS。 |
| `GET /ar/lookups/customers/:id/billing` | `invoice.mgmt`等業務權限 | Active purpose-filtered address/contact/payment term projection。 |
| `GET /ar/lookups/currencies` | 任一AR業務權限 | Active code、precision、display；不回FX。 |

### 7.3 Workbench and Invoice APIs

| Method／Path | Permission | Contract／Result |
| --- | --- | --- |
| `GET /invoiceable-shipments` | `ar.view`＋`invoice.mgmt` | Filters、cursor；rows含Shipment/SO/Customer/date/warehouse/currency/lines/amount/eligibility reason。 |
| `POST /invoice-groups/preview` | `invoice.mgmt` | `{shipmentIds,invoiceDate,billingAddressId?,paymentTermId?}`；回bounded groups及incompatibilities，不claim。 |
| `GET /invoices`、`GET /invoices/:id` | `ar.view` | Active list/detail、allowedActions、source trace、settlement及version。 |
| `POST /invoices/from-shipments` | `invoice.mgmt` | 完整source set、group hash、eventId；transactional claims；201或409。 |
| `POST /invoices/manual` | `invoice.mgmt` | Customer/Currency/reason/lines/date/due/billing；不接受source IDs。 |
| `PATCH /invoices/:id` | `invoice.mgmt` | Draft allowlisted fields、line edits、price override另驗權限＋reason。 |
| `POST /invoices/:id/cancel` | `invoice.mgmt` | Draft only；釋放claims，不取號。 |
| `POST /invoices/:id/confirm` | `invoice.mgmt` | `{expectedVersion,eventId,acknowledgedWarnings}`；200或202。 |
| `POST /invoices/batch-jobs` | `invoice.mgmt` | 物化invoice IDs／group sources；202 job。 |
| `POST /invoices/:id/void` | `invoice.mgmt`＋重新認證 | `{effectDate,reason,password,eventId,expectedVersion}`。 |

### 7.4 Credit APIs

`GET /credit-notes`、`GET /credit-notes/:id`、`POST /invoices/:id/credit-notes`、`PATCH /credit-notes/:id`、`POST /credit-notes/:id/confirm`、`POST /credit-notes/:id/cancel`、`POST /credit-notes/:id/void`、`POST /credit-applications`及`POST /credit-applications/:id/unapply`。全部要求`ar.credit.mgmt`（read detail可只`ar.view`），write含event/version；Void及大額敏感行為按Security policy重新認證。Create只接受original invoice line ID、quantity／amount、reason，不接受任意Customer／Currency。

### 7.5 Receipt APIs

`GET /receipts`、`GET /receipts/:id`、`POST /receipts`、`PATCH /receipts/:id`、`POST /receipts/:id/confirm`、`POST /receipt-allocations`、`POST /receipt-allocations/:id/unapply`、`POST /receipts/:id/reallocate`及`POST /receipts/:id/reverse`。`ar.receipt.mgmt`保護write；Reverse要求password、effectDate、reason及兩項明確確認。Reallocate payload列出完整remove/add set，在單transaction all-or-nothing。

### 7.6 Inquiry、Exposure、Documents and Jobs

| Method／Path | Permission | Notes |
| --- | --- | --- |
| `GET /ar/customer-accounts/:customerId` | `ar.view` | 必須指定Currency；As-of optional。 |
| `GET /ar/outstanding`、`/ar/aging`、`/ar/statements` | `ar.view` | 共用asOf／filters；statement可create PDF job。 |
| `GET /internal/ar/credit-exposure/:customerId` | trusted Sales service | versioned projection；`OK/WARNING/HOLD/UNKNOWN`。 |
| `GET /ar/documents/:type/:id/print` | `ar.view` | Snapshot projection；不改business timestamps。 |
| `POST /ar/documents/:type/:id/pdf-jobs` | `ar.view` | 202；owner-safe下載。 |
| `POST /ar/export-jobs`、`GET /ar/export-jobs/:id` | `ar.export` | filters/asOf snapshot、progress。 |
| `GET /ar/export-jobs/:id/download` | `ar.export`＋owner/scope | private file；expiry後410。 |
| `GET /ar/operations/:eventId` | 原actor或support service | SUCCEEDED／FAILED／IN_PROGRESS最小結果。 |
| `GET /ar/archive/search`、`GET /ar/archive/:type/:id` | `ar.view` | exact number或customer＋≤366日；唯讀。 |

### 7.7 Opening Import APIs

`GET /ar/opening-import/template`、`POST /ar/opening-import-jobs`（multipart private upload）、`GET /ar/opening-import-jobs/:id`、`POST /ar/opening-import-jobs/:id/confirm`、`POST /ar/opening-import-jobs/:id/cancel`及owner-safe result download。要求`ar.opening.import`；precheck不取號、不建AR；confirm逐document全有或全無。

### 7.8 Stable Public Error Codes

| Code | HTTP | Meaning／Client action |
| --- | ---: | --- |
| `AR_VALIDATION_FAILED` | 400 | 顯示field issues。 |
| `AR_PERMISSION_REQUIRED` | 403 | 不重試；重新載入session。 |
| `AR_NOT_FOUND` | 404 | 不揭露未授權object。 |
| `AR_VERSION_CONFLICT` | 409 | Reload detail後由使用者重做。 |
| `AR_EVENT_CONFLICT` | 409 | 同event不同payload；產生新event前先查outcome。 |
| `AR_SHIPMENT_NOT_INVOICEABLE` | 409 | 顯示safe reason並reload Workbench。 |
| `AR_SHIPMENT_ALREADY_CLAIMED` | 409 | 顯示正在其他Draft／Job處理。 |
| `AR_SOURCE_CONTRACT_MISMATCH` | 409 | Fail closed；營運警報。 |
| `AR_PERIOD_CLOSED` | 409 | 選擇開放Effect Date。 |
| `AR_AMOUNT_EXCEEDED` | 409 | Credit／allocation fresh available不足。 |
| `AR_RELATIONSHIP_BLOCKS_VOID` | 409 | 先解除列出的Credit／Allocation。 |
| `AR_PROVIDER_UNKNOWN` | 503 | 不假設0／clear；安全稍後重試。 |
| `AR_OPERATION_IN_PROGRESS` | 202 | Poll原statusUrl。 |
| `AR_FILE_EXPIRED` | 410 | 重新建立export/PDF。 |
| `AR_ARCHIVE_UNAVAILABLE` | 503 | Active查詢仍可用；不route錯誤資料。 |

內部error可更具體，但不得把SQL、完整帳號、token、path或未授權ID放進public message。

## 8. Cross-module Provider Contracts

所有write provider接收caller已有的MySQL transaction object；callee不得commit、rollback或另開connection。每個contract含`contractVersion`，啟動時驗required providers；缺失或不兼容令AR mutation routes保持disabled。

### 8.1 Fulfillment Provider

```js
FulfillmentInvoiceProvider.listInvoiceableShipments(query)
FulfillmentInvoiceProvider.lockShipmentsForInvoiceInTransaction(tx, command)
FulfillmentInvoiceProvider.markInvoiceResultInTransaction(tx, command)
FulfillmentInvoiceProvider.getShipmentSourceAcrossTiers(sourceId)
```

Locked projection至少回Shipment／Lines、SO／line mappings、customer、currency、warehouse、shipment date、base quantities、versions及status。Provider重驗完整line set、`SHIPPED`、非`REVERSED`、無IN_PROGRESS reversal；AR再驗Registry／Claim。`markInvoiceResult`只保存下游reference／event，不改Shipment數量。

```js
ArFulfillmentGuard.getShipmentReversalStatus(shipmentId, { atMs })
// { status: "CLEAR" | "BLOCKED" | "UNKNOWN", reasonCodes, invoiceRefs }
```

若任何有效Invoice source未Void且相關source有效Credit少於invoice amount，回BLOCKED；provider／Archive不可用回UNKNOWN。AR不執行Shipment reversal。

### 8.2 Sales Provider

```js
SalesInvoiceProvider.lockSalesSourcesInTransaction(tx, command)
SalesInvoiceProvider.classifyCommitmentAsInvoicedInTransaction(tx, command)
SalesExposureProvider.getUninvoicedCommitment(customerId, currency, { atMs })
SalesArchiveSourceProvider.getSourceAcrossTiers(sourceId)
```

Confirm Invoice在固定鎖序內鎖Sales line allocation projection，取得ordered／shipped／prior invoiced source amount及remainder owner；成功後以相同`eventId`將完整Shipment承諾由`UNINVOICED`轉`INVOICED`。Void做相反分類，但若SO狀態不再允許重新開票則fail closed。classification event unique，確保Exposure總額不跳變。

### 8.3 Customer、Item and Currency Providers

```js
CustomerLookupService.assertCustomerUsableInTransaction(tx, customerId, purpose, expectedVersion)
CustomerLookupService.assertAddressUsableInTransaction(tx, customerId, addressId, { purpose: "billing", expectedVersion })
CustomerLookupService.assertContactUsableInTransaction(tx, customerId, contactId, { purpose: "billing" | "ar", expectedVersion })
ItemLookupService.findManyByIds(skuIds, { purpose: "invoice-snapshot" })
CurrencyLookupService.assertActive(code, expectedVersion)
PaymentTermLookupService.assertUsableInTransaction(tx, id, expectedVersion)
```

Shipment Invoice允許Suspended／Hold customer處理既有債權；Manual新交易只接受Active。Address／Contact選填，但提供ID時須屬同Customer、purpose正確且Active。Item只供快照，不以當前Inactive阻止已出貨開票。Currency precision及Payment Term在確認時重驗。

## 9. Transaction、Concurrency and Idempotency

### 9.1 Two-phase Durable Command

適用Invoice／Credit／Receipt Confirm、Void／Reverse、Opening document confirm及Archive root：

1. **Phase A intent**：短transaction插入／claim`ar_operation_requests`，比較payload hash，令target轉`ISSUING/CONFIRMING/VOIDING/REVERSING`並commit。
2. HTTP可同步呼叫Phase B；若預計超3秒即202。Worker以lease取得相同operation。
3. **Phase B effect**：單一MySQL transaction按固定lock order重驗actor／permission、close date、providers、version、amount；寫正式號、document／ledger／balance／source／history／audit，最後operation SUCCEEDED。
4. 永久business failure在同transaction寫FAILED並把target回原可編輯狀態；不消耗正式號碼，除非號碼已在同一成功transaction取得。
5. Phase B rollback或connection lost時保留processing。Recovery以同event及payload hash查DB：若operation terminal replay；否則重取lease並重做。不得因client timeout產生新event。

框架`Idempotency-Key`處理HTTP response replay；domain `eventId`跨HTTP／Job／process crash保證商業效果唯一，兩者不可互相取代。

### 9.2 Global Lock Order

1. `ar_operation_requests`（event ID）。
2. Sales Order／Lines／commitment classification（ID ascending）。
3. Fulfillment Shipment／Lines（ID ascending）。
4. Invoice Source Registry／Claims（Shipment ID ascending）。
5. AR Customer＋Currency balance row。
6. Invoice roots→lines→sources；Credit roots→lines→applications；Receipt roots→allocations（各ID ascending）。
7. `ar_document_sequences`只在其他驗證成功後鎖取。
8. Ledger、history、audit append；operation terminal update。

不同命令缺少某類時跳過但不得倒序。Deadlock只在MySQL明確rollback後有限jitter retry（最多3次）；connection lost／request abort視commit unknown，交Recovery。

### 9.3 Key Command Atomicity

- Create from Shipments：所有Fulfillment locks＋registry＋claims＋Invoice／lines/sources同一transaction；任一Shipment衝突全部rollback。
- Invoice Confirm：source validation、Sales classification、sequence、ISSUED、ledger、balances、snapshot、history及audit原子。
- Credit Confirm／Application：鎖origin Invoice、Customer balance、target invoices；不得造成負outstanding或負credit available。
- Receipt Reallocate：鎖Receipt及受影響Invoices，先驗完整remove/add後一次寫全部effects；中途錯誤保持原allocation。
- Receipt Reversal：鎖Receipt＋全部active allocations＋target invoices，原子反向；不提供部分reversal。
- Close Date：只可向前推進；鎖settings，bounded檢查目標日期前所有IN_PROGRESS operation／job及reconciliation mismatch，存在即拒絕。沒有public倒退功能；錯誤關帳須按受控support runbook及新審批變更處理，不直接改DB。

## 10. Frontend Design

### 10.1 Routes and Permissions

| Route | Page | Permission |
| --- | --- | --- |
| `/ar/invoiceable` | Invoiceable Workbench | `ar.view`＋`invoice.mgmt` |
| `/ar/invoices`、`/ar/invoices/:id` | Invoice List／Detail | `ar.view` |
| `/ar/invoices/new/manual` | Manual Invoice | `invoice.mgmt` |
| `/ar/credit-notes`、`/:id` | Credit List／Detail | `ar.view`；write按`ar.credit.mgmt` |
| `/ar/receipts`、`/:id` | Receipt List／Detail | `ar.view`；write按`ar.receipt.mgmt` |
| `/ar/customer-accounts/:id` | Customer Account | `ar.view` |
| `/ar/aging`、`/ar/statements` | Aging／Statement | `ar.view` |
| `/ar/opening-imports` | Opening Import Jobs | `ar.opening.import` |
| `/ar/exports` | Export Jobs | `ar.export` |
| `/ar/archive`、`/:type/:id` | Archive Search／Read-only Detail | `ar.view` |
| `/ar/settings` | Settings／Bank／Close Date | `ar.settings` |

Route guard只改善UX；所有API獨立重驗fresh permission。System Administrator不因名稱看見AR功能。

### 10.2 Core Page Behavior

- Workbench：URL保存filters／cursor；DataTable sticky selection summary；先preview groups，再create。不可選rows顯示文字原因；衝突reload不保留失效選擇。
- Invoice Detail：Header、Lines、Shipment Sources、Settlement、History、Audit tabs；server回`allowedActions`。正式狀態所有快照readonly；Void為PasswordReasonDialog。
- Draft Form：FormPanel分Customer／Dates／Billing／Lines／Payment；Price override行內顯示原價、差額、權限及必填原因；零價需確認。
- Credit：只能從Invoice detail選原lines；UI即時顯示可貸項額、origin reduction及可能形成Credit Balance，但submit以server fresh值為準。
- Receipt：method-specific fields；allocation grid按Due Date建議但不自動保存；始終顯示Allocated／Unallocated及Currency。
- Account／Aging／Statement：As-of date顯著且相同；各Currency tabs不可顯示虛構grand total；每筆可trace document。
- Processing：提交後disable相同action並poll原operation；離頁abort polling，回頁由target status恢復。
- Archive：要求exact number或Customer＋最多366日；Active miss只提供明確「搜尋Archive」入口，不自動全表scan。

### 10.3 Shared Components and Files

新增`client/src/pages/ar/*`、`client/src/components/ar/*`、`client/src/services/ar*.js`及必要Pinia store；使用`PageHeader`、`DataTable`、`FormPanel`、`EllipsisCell`、`notify`、`confirm`、`PasswordReasonDialog`、`useRequestAbort`。不建立第二套table、dialog或HTTP client。

### 10.4 Responsive、Accessibility and Security UX

- 375／768px table可水平scroll或summary cards，但不可隱藏amount、currency、status、due date。
- Status用文字＋icon，不只靠顏色；error summary可聚焦並連到field；dialog合理focus trap／return focus。
- Keyboard可完成filter、create、allocation及download；loading標`aria-busy`，所有input有visible label。
- 所有Customer／notes／CSV文字以text render，不使用未消毒`v-html`；公式前綴在CSV server端neutralize。
- 完整銀行號只在有權流程短暫顯示，不進Pinia持久store、URL、analytics或console。

### 10.5 Print and PDF

A4 Invoice／Credit模板固定公司、Customer、optional Billing、document number/date/due、currency、lines、total、SO／Shipment refs及payment account snapshot。PDF可合併同SKU/UOM/price顯示，但source detail不丟失。VOID watermark由current status加上；原snapshot hash不變。Print CSS在A4與browser preview做visual regression。

## 11. Validation and Security

### 11.1 Validation Layers

1. AJV拒絕unknown fields、超長值、不合法decimal/date/UUID及超量arrays。
2. Pure rules正規化decimal、日期、group hash、reason及state transition。
3. Service在fresh transaction重驗permission、ownership、status、version、close date及provider versions。
4. DB以FK、unique、composite ownership及immutable trigger保最後防線。

Server限制：單Invoice最多100 Shipment、500 source mappings及100 display lines；超限preview拆成多組。單Batch最多10,000 Shipment，單Import≤50MiB／100,000 rows，單Export filter最多366日（exact number例外）。數值是防資源濫用及符合已確認容量，變更須performance review。

### 11.2 Authorization Matrix

| Action | Required controls |
| --- | --- |
| View financial data | `ar.view`＋object visibility |
| Invoice draft／confirm／void | `invoice.mgmt`; price override另`invoice.price.override`; Void重新認證 |
| Credit／application／void | `ar.credit.mgmt`; Void重新認證 |
| Receipt／allocation／reversal | `ar.receipt.mgmt`; Reversal重新認證＋雙確認 |
| Settings／bank／close date | `ar.settings`; sensitive change重新認證 |
| Opening／Export | 各自獨立permission；download再驗owner／scope |
| Recovery／Archive／Reconciliation | trusted service identity；無public mutation API |

撤權後尚在進行的Job在每個item開始前fresh recheck；撤權即停止未開始items，已commit結果保留。服務身份不可用human JWT，internal provider不可從public route直接呼叫。

### 11.3 Threat Controls

- IDOR：所有nested ID以composite ownership query，不先回存在性；未授權與不存在均404。
- Injection：SQL parameterized；sort/filter allowlist；CSV formula字符`=+-@`前置單引號；PDF／HTML escape控制字元。
- Sensitive data：AES-GCM key version、每row新nonce、AAD；log／audit／error／metrics redaction；private storage deny public listing。
- Replay／tamper：canonical payload hash包含target、amount、effect date、reason及expected versions；同event不同hash conflict。
- DoS：page／batch／file／filter limits、upload concurrency、scheduler lease、DB pool backpressure及request timeout。
- CSRF依現有Bearer token模型；XSS依Vue escaped binding及CSP/security middleware；不得把下載token放query log。

## 12. Observability and Operations

### 12.1 Structured Events and Metrics

Events：`ar.invoice.claimed/issued/voided`、`ar.credit.issued/applied/voided`、`ar.receipt.confirmed/allocated/reversed`、`ar.operation.recovered`、`ar.reconciliation.mismatch`、`ar.archive.completed/conflict`。Fields只含IDs、counts、currency、duration、outcome、request/correlation，不含完整銀行或自由文字。

Metrics：invoiceable queue depth/age、claim conflict、batch throughput/error、operation processing age、sequence latency、lock wait/deadlock、negative-balance prevented、exposure unknown/mismatch、import/export queue、PDF latency、archive candidates/results/hash mismatch、recovery outcome及DB pool saturation。

Alerts：processing超lease＋grace、source duplicate、partial projection mismatch、negative amount detector、provider UNKNOWN持續、sequence gap異常增長、archive hash conflict、reconciliation mismatch、monthly archive未完成及private storage failure。

### 12.2 Scheduler Jobs

| Job | Frequency | Behavior |
| --- | --- | --- |
| Operation recovery | 每分鐘 | keyset claim expired lease，bounded 50；同event恢復。 |
| Batch invoice/import | queue driven＋每分鐘 | 每worker bounded groups；權限及provider fresh check。 |
| Export/PDF | queue driven | resource-class separate concurrency，避免阻塞interactive pool。 |
| Reconciliation | 每日增量＋每月全量抽樣 | source／ledger／balances／exposure／routing；只報告，不自行改財務數據。 |
| Archive | 每月 | terminal eligible roots，bounded 100／transaction，count/hash及resume。 |
| File purge | 每日 | 到期且無legal hold文件；metadata／Audit保留。 |

### 12.3 Runbooks

- Commit unknown：禁止手工重按新event；以operation outcome及target status判定，讓Recovery收斂。
- Negative／over-allocation detector：停止Credit／Receipt writes，保留read，查ledger與projection；只作forward repair event。
- Provider mismatch：停止Invoice confirm／Shipment reversal clear，保存payload hashes，通知上游owner。
- Sequence incident：不得重置next value或填補號碼；停正式確認並核對operation／documents。
- Archive conflict：保留Active、停止該root、比較canonical hash；不得`INSERT IGNORE`或刪除較新副本。
- Restore：在隔離環境還原MySQL＋private files，核對manifests、source registry、ledger/projection及抽樣PDF hash後才開writes。

## 13. Performance、Capacity and Resilience

- 以730萬Active invoiceable／Invoice級資料、24個月、50 interactive users、10,000 Shipment batch及100-line document作production-like基線。
- List先走covering root index再batch load children，禁止N+1及先join children再count；使用keyset pagination。
- As-of statement按Customer＋Currency＋effect_date index；大範圍Export background stream，不載全結果入memory。
- Workbench先從Fulfillment bounded IDs再anti-join source registry；不得每天掃全部Archive。
- p95：常用Active／exact number≤2s；100-line mutation≤3s或202；PDF preview≤3s；Archive exact≤3s、Customer＋366日≤5s；10k batch≤30m。
- 保存EXPLAIN、rows examined、temporary/filesort、lock wait、pool queue、heap、GC、throughput及error rate；不能縮小資料集宣稱Pass。
- DB overload回503＋Retry-After；job backpressure停止claim新items但不丟失queued work。Provider timeout回UNKNOWN；不以cached zero或clear降級。

### 13.1 Backup、HA and DR

- 備份MySQL Active／Archive／Permanent Index／operations／keys metadata及private files；加密、離線副本及定期restore。
- 已批准`RPO≤15分鐘`（binlog/增量）及`RTO≤4小時`；TC-099～100須保存實測時間及資料完整性證據。
- Key material與DB備份分開保護，但restore環境必須可取得已使用key versions；輪替不重寫正式快照。
- 單primary故障期間write停止、read只在能保證一致routing時提供；不以stale replica確認款項。

## 14. Deployment、Rollback and Code Changes

### 14.1 Expected Server Changes

新增：

```text
server/src/modules/ar/
  arConstants.js arErrors.js arMoney.js arStateMachines.js arPayloadHash.js
  ArSettingsService.js InvoiceableWorkbenchService.js InvoiceService.js
  InvoiceConfirmationService.js InvoiceSourceService.js CreditNoteService.js
  ReceiptService.js ArLedgerService.js ArInquiryService.js
  ArAsOfProjectionService.js CreditExposureService.js OpeningArImportService.js
  ArDocumentService.js ArExportService.js ArOperationService.js
  ArArchiveService.js ArAuditService.js ArReconciliationService.js
server/src/handlers/ar/**
server/src/services/ar/jobs/**
server/database/migrations/<next>_*.js
server/test/{unit,integration,contract,performance}/ar/**
```

修改：permission catalogue／seed、configuration normalization、scheduler registrations、sensitive field redaction、service discovery（如自動discovery已足夠則不改）、Sales／Fulfillment／Customer provider modules及coverage config。每項修改須由對應Task證明，不做無關重構。

### 14.2 Expected Client Changes

新增`client/src/pages/ar/`、`components/ar/`、`services/ar.js`、必要store及tests；自動page discovery應避免手工route registry。只在共用error message／menu capability必須時修改framework檔。

### 14.3 Deployment Order

1. 合併上游additive provider contracts及consumer tests。
2. 部署permissions／config／operation／schema migrations，feature flags保持off。
3. 部署Settings、Invoice／Credit／Receipt services及Recovery；只開內部smoke。
4. 逐Phase開啟角色：Invoice→Credit/Receipt→Inquiry/Import/Archive。
5. Archive先dry-run及manifest/restore proof，再啟用monthly schedule。

Rollback採forward-safe：可關閉mutation routes及回上一application版本，但不刪正式號碼、operations、ledger、documents或archive rows。含新資料的Migration不執行destructive down；以兼容欄位／table留存後續forward fix。

## 15. Test Design

### 15.1 Unit

State transitions、decimal／rounding、pack/base split及last remainder、group compatibility、due/close/as-of dates、settlement/exposure equations、canonical hash、CSV neutralization、permissions及archive eligibility。

### 15.2 Real MySQL Integration

FK/composite ownership、unique Shipment claim、source registry、sequence concurrency、immutable triggers、50-way credit／receipt allocation barrier、fixed lock order、transaction rollback、commit unknown、recovery lease、archive count/hash/routing及ledger rebuild。不得用mock DB代替高風險證據。

### 15.3 API／Contract／Frontend／Security

- 全endpoint schema、envelope、error、version、Idempotency及202 outcome。
- Sales/Fulfillment/Customer/Item/Currency provider完整、缺項、duplicate、wrong owner/version及UNKNOWN。
- Vue route permission、forms、field/server errors、polling recovery、keyboard、focus、responsive及A4 visual。
- Horizontal／vertical IDOR、bank exposure、CSV/PDF/XSS、file owner／expiry、oversized inputs、replay及service identity。

### 15.4 Performance／Recovery／UAT

按§13完整資料及並發負載；process crash在Phase A後、commit前、commit response lost、archive copy/hash/routing各點；backup restore驗證。UAT以Finance使用者可見頁面、文件、balances、Audit及correlation ID作證，不要求業務直接查DB。

## 16. Trade-offs and Rejected Alternatives

| Choice | Accepted | Rejected／Reason |
| --- | --- | --- |
| Modular monolith＋single DB transaction | 跨模組財務原子性、符合現有架構 | 新microservices／saga會增加不必要最終一致性及營運成本。 |
| Ledger＋transactional projections | As-of可靠且日常查詢快 | 只存mutable balance無法還原歷史；每次全ledger掃描又不達性能。 |
| Active／Archive physical tables | FK、bounded query、清楚routing | 預先partition或外部warehouse會增加SMB複雜度。 |
| Domain event＋framework idempotency | 跨worker/process及HTTP均安全 | 只靠HTTP key無法處理Job／recovery。 |
| Full Shipment invoicing | 防漏及簡化source守恆 | Partial line/quantity不在需求且顯著增加狀態。 |
| Same-currency only | 可解釋balance | FX／匯兌不在本期。 |
| Background export／large operations | backpressure及可恢復 | 長HTTP transaction會耗盡pool。 |

## 17. Requirement-to-Design Mapping

| Requirement group | Design coverage |
| --- | --- |
| FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010 | DES-006、DES-010、DES-017、DES-021～022；§§6.2、7.2、11～12。 |
| FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021 | DES-004、DES-019～021、DES-024；§§4.4、6.4、7.3、8.1、9、10.2。 |
| FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038 | DES-002～010、DES-024；§§4、6.4、7.3、8、9、10。 |
| FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045 | DES-002～003、DES-005、DES-010、DES-021；§§6.4、7.3、8.3、9。 |
| FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058 | DES-005～008、DES-016～020；§§6.3、7.3、9、12～14。 |
| FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071 | DES-003、DES-005～008、DES-011、DES-017、DES-020～021；§§6.5、7.4、8.1、9。 |
| FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085 | DES-003、DES-005～008、DES-012、DES-021～022；§§6.6～6.7、7.5、9。 |
| FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098 | DES-007、DES-013、DES-016、DES-018～020、DES-024；§§6.7、7.6、10、13。 |
| FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107 | DES-007、DES-014、DES-020～021；§§6.7、7.6、8.2、9。 |
| FR-108, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119 | DES-005、DES-015～017、DES-019、DES-021；§§6.3、6.9、7.7、9、11～12。 |
| FR-120, FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132 | DES-010、DES-016～017、DES-019、DES-021～024；§§6.8～6.9、7.6、10.5、11～12。 |
| FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140, FR-141, FR-142, FR-143 | DES-018～020、DES-023、DES-025；§§6.8、6.10、7.6、12～14。 |
| NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010 | DES-019、DES-023～025；§§12～15。 |
| SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014, SEC-015 | DES-003、DES-005、DES-016～017、DES-020～022、DES-024；§§7、9～12、15。 |

## 18. Design Gate Checklist

- [x] Business scope、Out of Scope及existing IDs preserved。
- [x] Frontend、backend、API、DB、provider、transaction及failure behavior defined。
- [x] Money／source／balance／Exposure invariants and lock order explicit。
- [x] Idempotency、commit unknown、recovery、archive及reconciliation explicit。
- [x] Security、performance、capacity、deployment、rollback及test design explicit。
- [x] OI-001 RTO≤4h／RPO≤15m已於2026-09-10確認。
- [x] OI-002財務≥7年、Import 90日、Export／可重建PDF 7日已於2026-09-10確認。
- [ ] Sales／Fulfillment／Customer provider versions在最新main實作及通過contract tests。
- [ ] Independent Design Review完成並無open CRITICAL／HIGH finding。

在最後一項完成前，本設計不可標示`APPROVED_FOR_IMPLEMENTATION`；可先產出Draft Tasks及Tests供評審。
