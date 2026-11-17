# Accounts Payable Management 系統設計規格

Relationship authority: `08_traceability.json`; module/data/API boundary:
`00_module_manifest.json`. Use one level-two definition per DES ID.

## Scope, goals, constraints and requirement baseline

### 文件資訊

| 項目 | 內容 |
| --- | --- |
| 版本／狀態 | 0.12 Draft；四個交付（DES-001～DES-035）的Required已獲非作者評審在設計層面全部關閉；收貨發票未設計；整份設計未完成，不授權任何實作 |
| 日期 | 2026-11-17 |
| 需求基線 | `01_requirement_spec.md` 0.3 Draft（git blob `edd09c087f19b947361508a13d34125bda9ec185`，尚未commit） |
| 程式基線 | `origin/main` `6a34b8c2`；下文引用的檔案及行號均以此為準 |
| 作者 | `claude-erp-app-tl-01` |

### 已交付的範圍

- **第一個交付（DES-001～DES-015，已獲非作者評審在設計層面接受）**：不依賴收貨（GR）的核心：模組邊界、金額表示、文件狀態、命令執行及重送授權、取鎖次序及關帳日、文件編號、餘額模型、發票／貸項／付款的命令、同步操作的界限、期初匯入的身分，以及與Purchasing、Supplier、Business Master的**待確認契約清單**。
- **第二個交付（DES-016～DES-023，已獲非作者評審在設計層面接受）**：列表及詳情、現況及As-of的計算、Supplier Statement、列印頁、CSV匯出、權限及物件層授權、輸入輸出及上傳的安全處理、檔案保留及清理。
- **第三個交付（DES-024～DES-028，兩項Required已在設計層面關閉）**：資料表欄位及索引、migration分片、API及權限、錯誤及結果不明的查回、Audit。均不含收貨發票。
- **第四個交付（DES-029～DES-035，一項Required已在設計層面關閉）**：路由、頁面及選單；列表及詳情的共同行為；命令的畫面流程；表單及核銷；帳戶、報表、列印、匯出及Audit的畫面；期初匯入的畫面；無障礙、回應式、文案及共用檔案的改動。均不含收貨發票。

### 尚未涵蓋（留待其後的交付）

- 由收貨行建立發票、可開票數量、按PO單價計價及尾差、收貨沖銷時的AP檢查、發票與收貨之間的來源追溯（FR-004～FR-007、FR-009～FR-011、FR-020及FR-033的一部分），包括其欄位、介面及畫面：只在DES-014列出待確認事項。
- 請求及回應的欄位schema；報表的SQL及其索引；CSV及列印的欄位格式；各頁面的欄位清單及版面稿；對賬的排程及報告；部署及回滾。

### 約束

- 單一公司、單一MySQL primary；AP與上游模組在同一應用及資料庫內，可共用交易連線。
- 規模：約20名使用者、每日最多1,000張訂單（Sam）。AP自身單量未提供（OI-001）。
- 不設AP自身的Archive分層及背景Job佇列（A-008）；只可使用現有Scheduler做唯讀對賬及檔案清理。
- 回應時間及復原目標的數字未獲確認（OI-007、OI-008）。本設計不採用任何未確認的數字作為門檻；所有上限以具名參數表示，數值待定。
- AR設計的六項評審Required未關閉。本設計不引用AR設計作為已核准的做法；相同問題在本文獨立處理。

## Architecture and component responsibilities

```text
Vue頁面（其後交付）
        │ HTTPS JSON
BaseRequestHandler：認證 → route授權 → handler授權 → 輸入驗證 → HTTP idempotency
        │
AP application services（單一交易內完成一個命令）
  Settings | Invoice | CreditNote | Payment | Allocation | OpeningImport | Inquiry
        │                         │
AP共用元件                        上游provider（交易內、唯讀或鎖定讀取）
  ApOperationService              Supplier lookup｜Business Master｜Purchasing（待確認）
  ApPeriodFence
  ApLedgerService
  ApSequenceService
  ApAuditService
        │
MySQL：AP自有的表（本模組唯一可寫）
```

- Handler只解析已驗證的輸入、取得操作者及請求脈絡、呼叫一個application service，不寫SQL、不計金額。
- Application service擁有交易、取鎖次序、授權重驗、上游協調、Audit及命令結果。
- AP只寫入AP自有的表。上游資料只透過其owner提供的介面讀取；AP不直接查詢上游的私有表。
- 上游provider使用AP傳入的交易連線，不自行commit、rollback或另開連線。

## DES-001 — 模組邊界及資料擁有權

### Decision
在現有modular monolith內新增AP模組：`server/src/modules/ap/`放services及純規則，`server/src/handlers/`下按URL前綴分目錄放handlers（沿用現有「handler目錄與URL前綴一致」的慣例）。AP擁有並獨佔寫入下列資料（名稱暫定，欄位在其後的交付定義）：

| 資料 | 用途 |
| --- | --- |
| `ap_settings` | 單列：三類文件前綴、AP關帳日、版本。同時是期間界線（DES-005）。 |
| `ap_document_sequences` | 每類文件每年度的流水號。 |
| `ap_prefix_history` | 每個用過的前綴及其所屬的文件類型（DES-006、DES-024）。 |
| `ap_exports` | 匯出記錄（DES-020）。 |
| `ap_operation_requests` | 每個命令的event、命令類型、操作者、目標、內容hash及結果摘要。 |
| `ap_supplier_currency_balances` | 每個Supplier＋Currency一列：未付額、Credit Balance可用額、付款可用額。同時是帳戶層的序列化點。 |
| `ap_invoices`、`ap_invoice_lines` | Supplier Invoice及其行（費用行、收貨行、期初行）。 |
| `ap_credit_notes`、`ap_credit_note_lines`、`ap_credit_applications` | 貸項、其行及Credit Balance的應用。 |
| `ap_payments`、`ap_payment_allocations` | 付款及核銷。 |
| `ap_ledger_events` | 只增不改的餘額效果記錄，帶Effect Date。 |
| `ap_status_history`、`ap_audit_logs` | 狀態歷史及Audit。 |
| `ap_opening_import_batches`、`ap_opening_import_documents` | 期初匯入批次及其文件。 |
| `ap_opening_sources` | 每個期初來源身分一列，記錄該來源唯一的入帳結果（DES-013）。 |

AP對Supplier、Currency、付款條件、PO及收貨只讀。對`suppliers`的引用以外鍵`ON DELETE RESTRICT`保護（Supplier設計`03_design_spec.md:498`對下游模組的要求）。

### Rationale
FR-001～FR-045的資料都屬AP；核心規則8要求AP不改寫上游。沿用現有模組的目錄及handler慣例，不新增框架。資料表數量是功能所需的最小集合：沒有Archive鏡像、沒有job表、沒有餘額快照表。

### Failure behavior
任何AP命令失敗時，上游資料不受影響，因為AP不寫上游。上游介面未註冊或版本不符時，依賴它的命令在啟動檢查或執行時拒絕，不以替代資料繼續。

## DES-002 — 金額表示

### Decision
- API、CSV及列印以固定小數位的字串表示金額，小數位取自Business Master的Currency設定（0至4位）。不使用JavaScript Number。
- 計算以Currency最小單位的整數（BigInt）進行；資料庫以`DECIMAL(25,4)`保存，與Purchasing的`purchase_orders.total_amount`、`purchase_order_lines.line_amount`一致。
- 輸入金額的小數位多於該Currency允許的位數時拒絕，不捨入。
- 本交付只涉及「輸入金額的加總」：費用行的行金額由使用者輸入，發票總額是行金額之和；貸項、付款及核銷金額都是輸入值。這些運算沒有乘法，因此沒有捨入。
- 數量乘單價的行金額、捨入規則及分拆開票的尾差只在收貨發票出現，留待其後的交付（DES-014第7項）。

Purchasing的`moneyMath.js`是該模組的內部檔案（引用其常數及錯誤碼）。AP需要的只是固定小數位字串的解析、格式化及加總，有兩個做法：

| 做法 | 內容 | 影響 |
| --- | --- | --- |
| a（本設計採用） | AP自備一個小的金額工具。精度、Currency小數位及範圍檢查與`moneyMath.js`的`formatAmount`、`storedAmount`、`documentTotal`相同，但按下文區分無號及有號兩類。 | 不改Purchasing；有少量重複。 |
| b | 把這些函式抽到共用位置，兩個模組共用。 | 要改Purchasing的檔案，須其owner同意及SCOPE批准。 |

AP的金額分兩類，工具必須分開處理，不可用取絕對值掩蓋負值：

| 類別 | 例子 | 規則 |
| --- | --- | --- |
| 無號金額 | 行金額、發票總額、貸項金額、付款金額、核銷金額、各種可用額及未付額 | 不可為負；輸入類須為正數。 |
| 有號金額 | ledger的三個變動、Supplier的淨應付 | 可為負；以前置負號的固定小數位字串表示，資料庫以有號的`DECIMAL(25,4)`保存。 |

兩類都以BigInt及固定的Currency小數位運算，絕對值都受同一範圍檢查。Purchasing的三個函式只接受非負值（`moneyMath.js:28–40,55–67`），所以不能原樣沿用於有號金額。紙上例：ledger變動`-70.00`及淨應付`-20.00`可以寫入、讀回及顯示而數值不變；付款金額輸入`-20.00`被拒絕。

### Rationale
NFR-004要求精確小數並與Purchasing一致。現有來源：`server/src/modules/purchasing/moneyMath.js:15–68`以BigInt及Currency小數位運算，`:37`以`DECIMAL(25,4)`字串讀回；migration 0112、0113的金額欄位為`DECIMAL(25,4)`、單價為`DECIMAL(19,4)`。

### Failure behavior
金額超出`DECIMAL(25,4)`範圍或小數位不合時，以輸入驗證錯誤拒絕。讀回的金額小數位多於其Currency時視為資料錯誤，拒絕處理，不截斷。

## DES-003 — 文件狀態

### Decision

| 文件 | 狀態 | 轉移 |
| --- | --- | --- |
| Supplier Invoice | `DRAFT`、`CONFIRMED`、`VOID`、`CANCELLED` | DRAFT→CONFIRMED；DRAFT→CANCELLED；CONFIRMED→VOID |
| Invoice結算 | `OPEN`、`PARTIALLY_SETTLED`、`SETTLED` | 由未付額計算，不由命令直接設定 |
| Supplier Credit Note | `DRAFT`、`CONFIRMED`、`VOID`、`CANCELLED` | 同Invoice |
| Payment | `DRAFT`、`CONFIRMED`、`REVERSED`、`CANCELLED` | DRAFT→CONFIRMED；DRAFT→CANCELLED；CONFIRMED→REVERSED |
| Credit應用、付款核銷 | `ACTIVE`、`UNAPPLIED`、`REVERSED` | ACTIVE→UNAPPLIED（解除）；ACTIVE→REVERSED（僅付款沖銷） |

沒有「處理中」的持久狀態：每個命令在一個交易內完成，交易未commit時其他交易看不到中間結果。

### Rationale
FR-016、FR-019、FR-023、FR-025、FR-028、FR-032。單交易命令（DES-004）令中間狀態不需要落到資料庫，狀態機較小，也沒有需要恢復的卡住文件。

### Failure behavior
不合法的轉移被service拒絕。已確認文件的正式欄位以資料庫trigger拒絕UPDATE及DELETE（main上已有8個migration使用trigger）；狀態欄位只容許上表的轉移。

## DES-004 — 命令執行、授權及重送

### Decision

**交易內的固定步驟**（每個AP寫命令相同；沿用`PurchaseOrderService.js:148–159`及`PurchasingOperationService.js:83–113`的做法）：

1. 開一個REPEATABLE READ交易（`MySqlDatabaseService.withTransaction`的預設）。
2. 當時驗權：以`assertActorFresh`比對操作者聲稱與資料庫現時的角色及權限，並確認具備該命令所需的AP權限。不符即拒絕。
3. Claim event：寫入`ap_operation_requests`，**唯一鍵只有`event_id`**。命令類型、目標、操作者及內容hash是該列保存的比較內容，不屬於唯一鍵。同一event的另一個請求在唯一鍵上等待前者commit或rollback。
   - 該event已有終態（成功的結果，或下文拒絕收口留下的拒絕）：比較命令類型、目標、操作者及內容hash。全部相同即返回當時保存的結果摘要；任何一項不同回`AP_EVENT_CONFLICT`。
   - 目標以「目標類型＋目標ID」保存。建立類命令尚無目標ID，目標ID一律記為0，其身分由命令類型及內容hash區分；沒有可為空的目標欄位。
   - 內容hash涵蓋目標、金額、Effect Date、原因及預期版本。
   - 這比Purchasing的claim嚴格：Purchasing以來源文件＋event作查找鍵，AP在整個模組內以event作唯一身分。
4. 按DES-005的次序取鎖及重驗，寫入業務效果、ledger、歷史及Audit。
5. 寫入命令結果並commit。

**重送已完成的命令**在步驟3返回，不重跑步驟4。因此不會因為文件版本、主檔或關帳日其後改變而否定原已成功的結果；但步驟2在步驟3之前，所以被撤權的操作者、或另一名操作者，拿不到原結果。

**HTTP層**（`apiDispatcher.js:387–420`的次序是：認證 → route授權 → handler的`authorizeRequest` → 輸入驗證 → idempotency）：

- AP的寫入route啟用HTTP idempotency，並宣告`idempotencyPreparation`。其`replay`回呼在送出已保存的回應前，先做與步驟2相同的當時驗權及目標可見性檢查（`IdempotencyService.js:295–304`提供這個回呼）。本設計不依賴route授權本身是否讀取資料庫現況。
- HTTP idempotency的範圍是操作者身分＋方法＋路徑＋key（`IdempotencyService.js:199–201`），不同使用者不共用key。
- 回應沒有保存下來時，框架回`IDEMPOTENCY_RESULT_UNAVAILABLE`（`:265–283`）。此時client以**新的**HTTP key、**原來的**event及內容重送，由步驟3取回原結果。
- 發票作廢、貸項作廢、付款沖銷及關帳日變更的route使用現有的`jwt-password`認證；重送同樣須附密碼。

**結果不明**：連線中斷或commit結果不明時，資料庫服務回`DATABASE_TRANSACTION_INDETERMINATE`，AP回`AP_OUTCOME_UNKNOWN`。Client以同一event及內容重送：該event已有終態則取回該終態（成功的結果，或拒絕收口留下的拒絕）；沒有終態則這次執行，同一event最多只有一次生效。

**被拒絕的命令**：業務交易rollback，業務效果及該交易內的claim一併撤回。其後分兩種情況：

- **claim之前的拒絕**（步驟2的驗權等）：不留operation列；拒絕結果在rollback之後另行寫入Audit（outcome `REJECTED`），沿用`PurchaseOrderService.js:142–144,478`的做法。這種拒絕只說明這一次請求。
- **claim之後的業務拒絕**（步驟4的狀態、版本、期間、數額等檢查）：只rollback並不足夠，因為rollback之後沒有任何記錄可以阻止同一event其後再執行。所以在確定業務交易沒有提交之後，於同一請求內以一個附屬交易做**拒絕收口**，為該event留下拒絕的終態：
  1. 重做步驟2的當時驗權；不通過即回該授權錯誤，不留終態。
  2. 以同一`event_id`寫入operation列，結果為`REJECTED`及錯誤代碼；命令類型、目標、操作者及內容hash照常保存。拒絕的Audit在同一個附屬交易寫入。唯一鍵仍只有`event_id`，所以這個寫入與同一event的其他請求（包括遲到的原請求）在同一列上會合。
  3. 寫入成功並**確定commit**：該event的終態就是這個拒絕，回應帶`eventOutcome: "REJECTED"`。其後任何帶同一event的請求在步驟3讀到它：身分及內容相同即回這個保存的拒絕（同樣帶`eventOutcome: "REJECTED"`），不執行步驟4；不同則回`AP_EVENT_CONFLICT`。
  4. 唯一鍵上已有另一個請求留下的終態：比較身分及內容後，回**該終態**，不回這一次的結果，也不另寫拒絕的Audit或改動任何文件（包括期初的批次文件）。在唯一鍵上等待之後，須以鎖定讀取讀出該列的現況（下文「讀取規則」），不能沿用這個附屬交易驗權時建立的快照。已是成功即回原成功的結果；已是拒絕即回保存的拒絕，同樣帶`eventOutcome: "REJECTED"`。
  5. 附屬交易沿用原請求的訊號及剩餘時限（DES-012），不另起完整的時限。時限不足、寫入失敗或其COMMIT結果不明時，回`AP_OUTCOME_UNKNOWN`，不回這一次的拒絕：業務交易確定沒有提交，但該event沒有確認的終態，client按結果未確定處理。因此凡是帶業務拒絕代碼的回應都帶`eventOutcome: "REJECTED"`。
- 拒絕收口只取event列的鎖並寫入Audit，不取期間界線、帳戶列或文件列，不寫入任何財務效果。期初文件的確認另有批次文件的拒絕狀態要寫，兩者在同一個附屬交易內，event列在先（DES-013）。
- 不做拒絕收口的情況：死鎖或鎖等待逾時（`CONCURRENT_OPERATION`）、時限不足、上游不可用及其他非業務的失敗。這些只說明這一次的交易，event仍可重送。
- 拒絕的終態一經commit不可更改，同一event不能再執行。使用者修正後的再次操作是新的event。HTTP層不保存拒絕：失敗的請求會釋放HTTP key（`IdempotencyService.js:330–338`），重送到達步驟3時由operation列回覆。

**讀取規則**：步驟2是普通讀取，會在REPEATABLE READ下固定交易的快照。其後凡是決定所依據的資料（關帳日、文件狀態及餘額、上游狀態）一律用鎖定讀取（`FOR UPDATE`或`FOR SHARE`），以讀到最新已提交的值。

### Rationale
FR-017、SEC-008、NFR-003、FR-043。評審要求：重送須先驗當時授權，並綁定操作者、命令、目標及原內容；涵蓋HTTP回放及業務命令兩層；回應不可用時要有取回結果的路徑。Claim與業務效果在同一交易，所以沒有持久的處理中狀態，也不需要恢復用的背景工作。

不採用的做法：把授權放在claim之後（撤權者可取回結果）；只比較內容hash（不同操作者或不同命令可取回結果）；重送時重跑業務驗證（會以其後的變更否定原成功）。

### Failure behavior

| 情況 | 結果 |
| --- | --- |
| 撤權後重送已成功的event | 步驟2拒絕；HTTP回放同樣被`replay`回呼拒絕。 |
| 同一event E、另一名操作者、其餘相同 | `AP_EVENT_CONFLICT`。 |
| 同一event E、同一操作者，先確認發票A，再用E確認發票B | 第二次在`event_id`唯一鍵上找到A的列，目標不同，`AP_EVENT_CONFLICT`；B不被執行。 |
| 同一event E、同一目標，命令類型不同（例如確認後用E作廢） | `AP_EVENT_CONFLICT`。 |
| 同一event E、同一命令及目標，內容不同 | `AP_EVENT_CONFLICT`。 |
| 同一event E、命令、目標、操作者及內容全部相同 | 返回原結果。 |
| 文件版本已變、關帳日已推進後重送已成功的event | 返回原結果。 |
| 原交易已rollback而該event沒有終態（例如死鎖、連線中斷，或拒絕收口未能確認）後重送 | 重新執行，並以當時的資料驗證。 |
| 原交易被業務拒絕並已完成拒絕收口後重送 | 回保存的拒絕（帶`eventOutcome: "REJECTED"`），不重新執行，即使條件其後已改變。 |
| HTTP回應未保存 | 以新HTTP key、原event及內容取回。 |
| 遲到的原請求與拒絕收口：原請求A（event E）停在claim之前；重送B（同一E）先claim，被業務拒絕並rollback | B的拒絕收口先commit：A其後到達步驟3，讀到E的拒絕終態，回保存的拒絕，不執行；即使其間條件已改變（例如文件被重新開啟），A也不會執行。A在B的拒絕收口寫入之前claim而仍在進行：B的拒絕收口在event列上等待A；A commit成功則B按下一列回成功，A被拒絕則兩者之中先寫入的拒絕成為終態、另一方讀回它；B的時限先到則B回`AP_OUTCOME_UNKNOWN`。 |
| 成功與這次的拒絕競爭：B的業務交易rollback之後、拒絕收口之前，A claim並成功commit | B的拒絕收口在唯一鍵上讀到A的成功，身分及內容相同，回A的成功結果，不回拒絕。該event的終態是成功。 |
| 拒絕收口未能確認（時限不足、寫入失敗或COMMIT結果不明），或其回應遺失 | 回`AP_OUTCOME_UNKNOWN`（或沒有回應）。Client不把event當作已終結，保留intent並以E重送（DES-027）：收口其實已commit則讀回拒絕終態；未commit則重新執行業務交易，成功即成功，再被拒絕則再做收口。 |
| 死鎖或鎖等待逾時 | 交易已確定rollback時回可重試的錯誤；不自動重試。 |

## DES-005 — 取鎖次序及期間界線

### Decision

所有AP寫命令使用**同一個**取鎖次序。命令沒有某一步時跳過，不得倒序。

| 步 | 鎖 | 模式 |
| --- | --- | --- |
| 1 | `ap_operation_requests`的event列（DES-004步驟3） | 寫入或排他 |
| 2 | 期間界線：`ap_settings`的單一列 | 一般命令`FOR SHARE`；關帳日及設定變更`FOR UPDATE` |
| 3a | Purchasing的列，只在收貨發票的命令 | 待確認（DES-014） |
| 3b | Supplier列：凡是涉及某Supplier的AP文件的命令都取得 | 由Supplier的交易內lookup取得，現為`FOR UPDATE`（DES-015） |
| 3c | 期初來源列，只在期初文件的命令（DES-013） | `FOR UPDATE` |
| 4 | 帳戶列：`ap_supplier_currency_balances`的Supplier＋Currency列 | `FOR UPDATE` |
| 5 | 文件根列，先Invoice，再Credit Note，再Payment；同類按ID升序 | `FOR UPDATE` |
| 6 | 子列：行、應用、核銷；按ID升序 | `FOR UPDATE` |
| 7 | `ap_document_sequences`的類型＋年度列，只在全部驗證通過後 | `FOR UPDATE` |
| 8 | 寫入ledger、歷史、Audit及命令結果 | 寫入 |

**期間界線**：每個AP寫命令（包括建立及修改Draft）在步2取得`ap_settings`列的共享鎖並持有至commit，同一個鎖定讀取讀出現時的AP關帳日。推進關帳日的命令在步2取得同一列的排他鎖，等待在途命令完成，然後以鎖定讀取重驗條件（DES-011）。只寫Audit、匯出記錄及檔案清除標記的寫入不影響關帳的判定，不取期間界線及帳戶列（T-11）；期初文件的重新開啟、拒絕及取消仍須取得。

**帳戶列**：每個命令只涉及一個Supplier及一個Currency。所有會改變該帳戶餘額的命令先取得其帳戶列的排他鎖，因此同一帳戶內的文件鎖不會互相倒序。帳戶列不存在時先插入再鎖。

各命令實際取的鎖：

| 命令 | 步1 | 步2 | 步3b Supplier | 步3c | 步4 | 步5 | 步6 | 步7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 建立無PO發票Draft | ✓ | S | ✓（新交易用途） | — | — | 新增Invoice | 新增行 | — |
| 修改、取消Draft | ✓ | S | ✓ | — | — | Invoice | 行 | — |
| 確認無PO發票 | ✓ | S | ✓（新交易用途） | — | ✓ | Invoice | 行 | ✓ |
| 作廢發票 | ✓ | S | ✓ | — | ✓ | Invoice | — | — |
| 建立、修改、取消貸項Draft | ✓ | S | ✓ | — | — | 原Invoice，Credit Note | 行 | — |
| 確認貸項 | ✓ | S | ✓ | — | ✓ | 原Invoice，Credit Note | 行 | ✓ |
| 應用、解除Credit Balance | ✓ | S | ✓ | — | ✓ | 目標Invoice，Credit Note | 應用 | — |
| 作廢貸項 | ✓ | S | ✓ | — | ✓ | 原Invoice，Credit Note | — | — |
| 建立、修改、取消付款Draft | ✓ | S | ✓ | — | — | Payment | — | — |
| 確認付款 | ✓ | S | ✓（含銀行帳戶，如有選用） | — | ✓ | Payment | — | ✓ |
| 核銷、解除、重新核銷 | ✓ | S | ✓ | — | ✓ | 目標Invoices（ID升序），Payment | 核銷 | — |
| 付款沖銷 | ✓ | S | ✓ | — | ✓ | 全部目標Invoices（ID升序），Payment | 全部有效核銷 | — |
| 推進關帳日、修改前綴 | ✓ | X | — | — | — | — | — | — |
| 上傳及預檢期初批次 | ✓ | S | — | — | — | 新增批次及文件 | — | — |
| 確認一筆期初文件 | ✓ | S | ✓（新交易用途） | ✓ | ✓ | 批次文件，新增財務文件 | 新增行 | ✓ |
| 拒絕收口：claim之後的業務拒絕，確定rollback後寫入event的拒絕終態及Audit（DES-004） | ✓ | — | — | — | — | — | — | — |
| 期初文件確認被業務拒絕後的附屬寫入：拒絕收口，並記錄批次文件的拒絕原因 | ✓ | S | — | ✓ | — | 批次文件 | — | — |
| 期初文件的重新開啟（附屬寫入，不claim event） | — | S | — | ✓ | — | 批次文件 | — | — |
| 取消期初批次 | ✓ | S | — | — | — | 批次及其`PENDING`文件 | — | — |

**Supplier列（步3b）**：除設定及期初上傳外，每個AP命令都屬於一個Supplier，並在接觸任何AP文件列之前取得該Supplier列的鎖。原因有二：

- AP的文件及帳戶列以外鍵引用`suppliers`。InnoDB在插入這些列時會對被引用的Supplier列取共享鎖；這是隱含的鎖，即使AP「只讀上游」也存在。
- Supplier的封存、改代碼及刪除先鎖Supplier列，再呼叫下游的檢查（`SupplierAdminService.js:586,592,664,705,794,797`）；AP向Supplier提供的檢查會以鎖定讀取讀AP的列（DES-015第4項）。

若AP命令先鎖AP文件列、之後才（經外鍵）碰Supplier列，便與Supplier的次序相反。因此AP一律「先Supplier、後AP的列」，與Supplier一方同向。兩個交錯時序：

- AP命令先取得Supplier列：封存在Supplier列上等待；AP命令commit後，封存取得鎖，其檢查讀到已提交的AP列。
- 封存先取得Supplier列：AP命令在步3b等待，此時未持有任何AP文件列；封存的檢查可以讀AP的列；封存commit後，AP命令取得Supplier列並以最新狀態繼續。

文件所屬的Supplier在文件建立後不可更改。處理既有文件的命令先以不鎖定的讀取取得該文件的Supplier，取得Supplier列的鎖之後，才鎖定文件根列並以鎖定讀取重新讀出其內容。

Supplier的鎖經由其交易內lookup取得（`SupplierLookupService.assertUsableInTransaction`，現以`FOR UPDATE`鎖定，`:303–306`）：建立及確認無PO發票、確認期初文件使用要求Active的用途；其餘處理既有應付的命令使用不因停用而拒絕的`history`用途（FR-045）。鎖的模式及用途名稱由Supplier owner確認（DES-015）。

**發票根列**保存該發票的三個扣減額（自己貸項的原發票沖減額、Credit Balance應用額、付款核銷額）、未付額，以及**有效貸項的數目**。任何改變這些數值的命令都持有該發票根列的排他鎖。確認貸項時數目加一，作廢貸項時減一，與貸項的狀態在同一交易更新。

三個扣減額為零不代表沒有有效貸項：發票100已全數核銷後確認貸項50，原發票沖減額為0、全部發行為Credit Balance；其後解除該核銷，發票未付100、三個扣減額全為0，但貸項50仍然有效。所以作廢發票要同時檢查三個扣減額為零**及**有效貸項數目為零，兩者都在發票根列的鎖下讀取，不必逐一鎖定其貸項。

### Rationale
FR-003、NFR-003、FR-022、FR-024、FR-029。AR評審的R2指出兩個問題：關帳日與財務提交沒有共同的界線；全域次序與個別命令的描述不一致。本設計以單一的界線列及一張逐命令的表處理，並要求每個命令的鎖集合可對照同一次序。

兩個交錯時序：

- 命令先取得界線：命令持有共享鎖並以當時的關帳日通過驗證；推進關帳日的交易在排他鎖上等待；命令commit後，推進才取得鎖。該命令的Effect在關帳前完成，以提交次序為準。
- 推進先取得界線：推進持有排他鎖；命令在共享鎖上等待；推進commit新的關帳日後，命令取得共享鎖並以鎖定讀取讀到新的關帳日，Effect Date不合即被拒絕。

兩種情況都不會出現「以舊關帳日通過、在新關帳日之後提交」。

### Failure behavior
遵守同一次序可避免AP命令之間因倒序而死鎖，但不排除其他來源的鎖衝突：唯一鍵檢查、外鍵的隱含鎖、間隙鎖，以及與上游模組次序的交會。發生死鎖或鎖等待逾時時，MySQL令一方rollback，該命令回可重試的錯誤，不留部分結果。命令不自動重試；是否由client有限次重試在API交付定義，條件是確定已rollback、原請求仍有效且時限有餘。

## DES-006 — 文件編號

### Decision
`ap_document_sequences`以文件類型（Invoice、Credit Note、Payment）及業務年度為鍵，保存下一個流水號。確認命令在全部驗證通過後（DES-005步7）以排他鎖讀出並加一，與業務效果同一交易commit。號碼格式為`前綴＋年度＋流水號`，前綴取自`ap_settings`當時的值。三類文件各自的號碼欄位有唯一鍵。

設定命令須確保三個前綴互不相同，並拒絕改用任何曾經使用過而屬於另一類文件的前綴，使完整號碼在全公司唯一。這個規則需要保存每類文件用過的前綴；三張表各自的唯一鍵只保證同類內不重號，不足以保證跨類別唯一。前綴歷史以`ap_prefix_history`保存，前綴為主鍵（DES-024）：設定命令及取號時把當時的前綴登記到該表，前綴已屬另一類文件即拒絕。

### Rationale
FR-002。做法與`PurchasingSequenceService.js:13–25`相同（插入或忽略、鎖定讀取、加一），只是以年度而非年月為鍵。

### Failure behavior
確認失敗時交易rollback，流水號不前進，沒有跳號。並發確認在序號列上排隊，不會重號。年度切換時自動建立新年度的列。

## DES-007 — 餘額模型

### Decision
三層資料在同一交易內一併更新：

1. **文件根列的數額**（現況，供日常查詢及上限檢查）：
   - Invoice：總額、自己貸項的原發票沖減額、Credit Balance應用額、付款核銷額、未付額。
   - Credit Note：總額、原發票沖減額、發行的Credit Balance、已應用額、可用額。
   - Payment：金額、已核銷額、可用額。
2. **帳戶列**：該Supplier＋Currency的未付額合計、Credit Balance可用額合計、付款可用額合計。
3. **`ap_ledger_events`**（只增不改）：每個效果一列，記錄Supplier、Currency、Effect Date、事件類型、文件、受影響的Invoice，以及三個帶正負號的變動：未付額、Credit Balance可用額、付款可用額。

現況查詢讀第1、2層。As-of查詢（FR-037）以Effect Date不晚於指定日期的ledger事件加總。對賬以ledger重算第1、2層並比較（NFR-003）。

每個解除、作廢及沖銷寫入**自己的**反向事件，使用自己的Effect Date，不修改或刪除原事件。

**歷史餘額檢查**。只驗證目前的數額並不足夠：Effect Date較早的補記可以令某些歷史日期的餘額不成立，即使目前的數額正確。因此每個寫入ledger的命令，在寫入之前、在已持有的帳戶列及文件根列的鎖下，對每份受影響的文件做以下檢查：

- 受影響的數額：發票的未付額、貸項的可用額、付款的可用額。
- 上下限：發票未付額在0與發票總額之間；貸項可用額在0與其發行額之間；付款可用額在0與付款金額之間。
- 把新事件按其Effect Date加入該文件該數額的事件序列後，由新事件的Effect Date起、其後每一個有事件的日期，日終的累計值都必須在上下限之內。任何一日不成立即拒絕整個命令。
- 讀取該文件的ledger事件使用鎖定讀取（DES-004的讀取規則）。該文件的ledger事件只會由持有其根列鎖的命令寫入，所以在鎖下讀到的序列是完整的。
- 新事件的Effect Date不早於該文件該數額已有事件的最後日期時，只有目前的數額受影響，已由各命令原有的上限檢查涵蓋，不必讀取事件序列。
- 需要讀取的事件數量有上限（`maxBackdatedCheckEvents`，數值待定，規則同DES-012）；超出時拒絕該補記，並提示改用不早於該文件最後事件日期的Effect Date。

這個檢查保留合法的補記，只拒絕會令歷史日期出現負數或超額的補記；沒有禁止Effect Date早於其他事件。帳戶的三個合計是各文件數額之和，各文件在每日都成立時，合計及Aging的加總也成立。

走查（同一Supplier及Currency，全部日期在開放期間；發票及付款各100）：

| 操作（按實際先後） | Effect Date | 檢查 | 結果 |
| --- | --- | --- | --- |
| 確認發票100、確認付款100 | 11/01 | 無較後事件 | 發票未付100、付款可用100 |
| 核銷100 | 11/05 | 無較後事件 | 11/05起兩者為0 |
| 解除該核銷 | 11/10 | 無較後事件 | 11/10起兩者為100 |
| 再核銷100，Effect Date補記為11/03 | 11/03 | 加入後日終值：11/03為0、11/05為−100 | **拒絕**；改用11/10或之後的Effect Date則可以 |
| 另一情況：發票100、付款100於11/01確認，其後沒有其他事件；11/10才記錄核銷100，Effect Date為11/03 | 11/03 | 加入後日終值：11/03為0，其後沒有事件 | 允許；11/03起的As-of顯示已核銷 |
| 另一情況：核銷於11/05生效；解除時把Effect Date填為11/03 | 11/03 | 加入後日終值：11/03發票未付200，超過總額100 | **拒絕**；解除的Effect Date不可早於被解除的核銷 |

以NFR-003的紙上例走查（同一Supplier及Currency；付款的確認及核銷在此分兩步列出；最後一欄是該步寫入的ledger變動：未付額／Credit可用／付款可用）：

| 步驟 | 鎖定的文件 | 文件數額的變化 | ledger |
| --- | --- | --- | --- |
| 發票A 100確認 | A | A未付100 | ＋100／0／0 |
| 付款P 70確認 | P | P可用70 | 0／0／＋70 |
| P核銷70到A | A、P | A核銷額70、未付30；P已核銷70、可用0 | −70／0／−70 |
| A的貸項C 50確認 | A、C | 沖減額＝min(50, A未付30)＝30，發行20；A未付0；C可用20 | −30／＋20／0 |
| 發票B 100確認 | B | B未付100 | ＋100／0／0 |
| 把C的20應用到B | B、C | B應用額20、未付80；C已應用20、可用0 | −20／−20／0 |
| 解除該應用 | B、C | B未付100；C可用20 | ＋20／＋20／0 |
| 付款P沖銷 | A、P、其核銷 | A核銷額0、未付70；P已核銷0、可用0、狀態REVERSED | ＋70／0／0 |

每一步之後，帳戶列的三個合計及淨應付與NFR-003的表逐列相同（最後一列：未付170、Credit可用20、付款可用0，淨應付150）。付款沖銷一步的付款可用變動為0：反向核銷令可用額加70，同一命令再把可用額歸零減70。

FR-025的兩個例：

- 例一：發票100；貸項30（沖減30）後未付70；核銷20後未付50；作廢貸項寫入＋30／0／0，未付80。
- 例二：發票100，核銷70後未付30；貸項50（沖減30、發行20）後未付0、Credit可用20；作廢貸項寫入＋30／−20／0，未付30、Credit可用0，付款核銷額70不變。

### Rationale
「餘額口徑」、FR-023～FR-025、FR-029～FR-032、FR-034、FR-037、NFR-003。ledger提供As-of及對賬的依據；文件根列及帳戶列避免每次查詢掃描ledger。沒有另設快照表。

不採用：只保存可變餘額（無法還原歷史時點）；每次查詢由ledger重算（日常查詢不必要地慢）；貸項的沖減額其後自動重新分配（評審指出這會改變業務流程，預設不做）。

### Failure behavior
三層在同一交易寫入，任何一層失敗則全部rollback。上限檢查在文件根列的排他鎖下以當時的數額進行，並發命令不會令任何數額為負。對賬發現不一致時只報告，不自動修改；修復以新的更正事件進行。

## DES-008 — 無PO發票的命令

### Decision
- **建立Draft**：驗證Supplier可用（DES-015第1項）、Currency有效、費用行金額為正、原因不為空。新增發票及行，狀態`DRAFT`，沒有號碼、沒有ledger事件。
- **供應商發票號唯一**（FR-008）：發票保存去除首尾空白並轉為統一大小寫的號碼，另有一個只在狀態為`DRAFT`或`CONFIRMED`時取值的衍生欄位；以Supplier＋該衍生欄位的唯一鍵由資料庫保證。取消或作廢後該欄位為空，號碼可再用。
- **修改Draft**：以預期版本比對，更新允許的欄位及行，版本加一。
- **取消Draft**：狀態改為`CANCELLED`。
- **確認**：在帳戶列及發票根列的鎖下重驗版本、Supplier、Effect Date不在關帳日或以前（以DES-005步2讀到的關帳日）、到期日、行、輸入的總額與行合計相等（FR-013）。取號，狀態改為`CONFIRMED`，未付額＝總額，寫入ledger（＋總額／0／0）、歷史及Audit。
- **作廢**：在發票根列的鎖下確認三個扣減額均為零、**有效貸項數目為零**（DES-005）、Effect Date在開放期間。狀態改為`VOID`，未付額歸零，寫入ledger（−總額／0／0）。號碼及內容保留。

### Rationale
FR-008、FR-012～FR-019（無收貨來源的部分）。唯一性交給資料庫的唯一鍵，並發輸入相同號碼時只有一個成功，不需要應用層的檢查再寫入。

### Failure behavior
唯一鍵衝突轉為「供應商發票號已存在」並指出現有發票。版本不符回版本衝突，由使用者重新載入。確認的任何驗證失敗時整個交易rollback，發票仍是Draft、沒有號碼。作廢時有任何扣減額不為零、或仍有有效貸項（包括原發票沖減額為零的貸項），即拒絕並列出相關的貸項及核銷。例：發票100已全數核銷，貸項50確認後全部發行為Credit Balance；解除核銷後三個扣減額均為零，但作廢仍被拒絕，因為有效貸項數目為1。

## DES-009 — 貸項的命令

### Decision
- **建立Draft**：原發票須為`CONFIRMED`。只可選該發票自己的行；Supplier及Currency由原發票帶入。行以發票ID＋行ID的複合外鍵保證屬於該發票。
- **確認**：在帳戶列、原發票根列及貸項根列的鎖下，**重驗原發票仍為`CONFIRMED`**，並檢查每行累計有效貸項不超過該行金額、發票累計有效貸項不超過發票總額。原發票的有效貸項數目加一。計算原發票沖減額＝貸項總額與原發票當時未付額的較小者，其餘為發行的Credit Balance；兩個數額保存在貸項上，之後不變。取號，更新原發票的沖減額及未付額、貸項的可用額，寫入ledger。
- **應用Credit Balance**：在帳戶列、目標發票及貸項的鎖下，檢查金額不超過貸項可用額及目標發票未付額、兩者同Supplier同Currency。新增一列應用，更新兩邊數額，寫入ledger。
- **解除應用**：把該列標為`UNAPPLIED`並記錄其Effect Date，更新兩邊數額，寫入反向事件。重新應用是新增一列。
- **作廢**：在原發票及貸項的鎖下確認貸項的已應用額為零、Effect Date在開放期間。原發票的沖減額減去該貸項的原發票沖減額、未付額相應增加、有效貸項數目減一；貸項的可用額歸零；寫入反向事件。其他貸項、應用及核銷不變。

### Rationale
FR-021～FR-025、「餘額口徑」。作廢只反向該貸項自己的兩個數額，是評審AP-R1的結論；兩個紙上例見DES-007。

### Failure behavior
並發確認兩張貸項時，兩者都要原發票根列的排他鎖，後者以最新數額檢查上限，超出即拒絕。貸項Draft建立後原發票被作廢：確認貸項時在原發票根列的鎖下讀到`VOID`，拒絕確認，不會因原發票未付額為零而把整張貸項發行為Credit Balance。確認貸項與作廢原發票並發時，兩者在原發票根列上排隊，後到者以最新狀態及有效貸項數目重驗。應用與作廢並發時同樣在貸項根列上排隊，後到者以最新數額重驗。任何驗證失敗時整個交易rollback。

## DES-010 — 付款及核銷的命令

### Decision
- **建立、修改、取消Draft**：驗證付款方式的必要欄位（FR-026）。不記錄公司出款帳戶（D10）。
- **確認**：重驗版本、Effect Date、付款方式欄位；如選用了供應商收款帳戶，在確認時重新驗證其歸屬、有效性及操作者的銀行資料權限，並保存遮蔽後的快照（DES-015第3項）。取號，可用額＝金額，寫入ledger（0／0／＋金額）。
- **核銷**：一個請求可帶多張發票的金額。在帳戶列、全部目標發票（ID升序）及付款的鎖下，檢查每筆不超過發票未付額、合計不超過付款可用額。新增核銷列，更新數額，寫入ledger。
- **解除**：把核銷列標為`UNAPPLIED`，更新數額，寫入反向事件。
- **重新核銷**：一個請求列出完整的移除及新增。全部在一個交易內驗證及寫入；任何一項不合法則全部不變。
- **付款沖銷**：在帳戶列、全部有效核銷的目標發票（ID升序）、付款及其全部有效核銷的鎖下，把每列核銷標為`REVERSED`並恢復對應發票的未付額，把付款的可用額歸零，狀態改為`REVERSED`；以沖銷的Effect Date寫入反向事件。不提供部分沖銷。

一筆付款可同時存在的有效核銷數量、以及一個核銷或重新核銷請求可帶的項目數量，各有上限（DES-012）。前者同時界定了付款沖銷一次要處理的集合，使整張沖銷可以在一個交易內完成。

### Rationale
FR-026～FR-032。FR-032要求整張沖銷原子完成，不可拆成多次commit；因此以「一筆付款的有效核銷數量上限」令沖銷的工作量有界，而不是拆分沖銷。

### Failure behavior
並發核銷同一付款或同一發票時在根列上排隊，後者以最新數額檢查，超出即拒絕。沖銷時任何一張發票的更新失敗則整個交易rollback。供應商銀行帳戶的介面不可用時，已選用帳戶的付款不能確認；系統不靜默丟棄所選帳戶。未選用帳戶的付款不受影響。

## DES-011 — 推進AP關帳日及修改設定

### Decision
推進關帳日的命令：claim event後取得`ap_settings`列的排他鎖（DES-005步2），以鎖定讀取讀出現時的關帳日及版本；確認新日期晚於現值；以鎖定讀取檢查是否有Effect Date在新日期或以前的Draft（發票、貸項、付款）及未完成的期初批次，有則拒絕並列出。通過後更新關帳日及版本，寫入歷史及Audit。沒有把關帳日改早的命令。

修改前綴同樣取得排他鎖。

### Rationale
FR-001、FR-003、SEC-005。所有AP寫命令（含Draft的建立及修改）都持有界線的共享鎖，所以排他鎖取得之後不會有在途命令；其後的檢查看到的是全部已提交的Draft。

### Failure behavior
並發的兩個推進命令在排他鎖上排隊，後者以最新的關帳日重驗。推進等待在途命令時受請求時限約束，逾時即放棄，關帳日不變。

## DES-012 — 同步操作的界限及時限

### Decision
每個AP請求的財務效果只在一個交易內完成，不跨交易；沒有背景工作代為續做。拒絕的Audit、期初文件的拒絕狀態及重新開啟是業務交易以外的附屬寫入，不帶任何財務效果（約束見下文及DES-013）。

下列上限是具名參數，**數值全部待定**；本設計只規定它們必須存在、超限時拒絕整個請求、並且在資料寫入之前檢查：

| 參數 | 界定的工作 |
| --- | --- |
| `maxInvoiceLines` | 一張發票的行數 |
| `maxCreditLines` | 一張貸項的行數 |
| `maxActiveAllocationsPerPayment` | 一筆付款同時有效的核銷數量；也是付款沖銷的工作量上限 |
| `maxAllocationItemsPerRequest` | 一個核銷或重新核銷請求的項目數量 |
| `maxActiveApplicationsPerCredit` | 一張貸項同時有效的應用數量 |
| `maxOpeningFileBytes`、`maxOpeningRows` | 一個期初檔案的大小及行數 |
| `maxExportRows`、`maxExportRangeDays` | 一次匯出的列數及日期範圍（DES-020） |
| `maxAsOfInvoices` | 一次跨Supplier的As-of計算所涵蓋的發票數量（DES-017） |
| `maxBackdatedCheckEvents` | 一次補記所須檢查的ledger事件數量（DES-007） |
| `exportAbandonAfterMs` | 匯出記錄停留在處理中多久之後成為清理的候選；只用於挑選，不作為已結束的證明（DES-020） |
| `maxStatementRows` | 一份Statement的交易列數 |
| `minCommandBudgetMs` | 進入業務交易前所需的最小剩餘時限 |

在這些數值由owner提出、有業務影響的獲批准之前，本設計不聲稱任何操作可驗收或必定在請求時限內完成，也不據此進行容量量度。

時限：

- 請求的時限由進入dispatcher時開始計算，認證、授權、上傳解析及idempotency都在交易之前消耗時間（`apiDispatcher.js:377–418`）；交易的計時則在取得連線之後才開始（`MySqlDatabaseService.js:459–480,515–521`）。因此「交易時限短於請求時限」**不能保證**交易結果先於請求結束返回。
- 進入業務交易之前，service以原請求的剩餘時限決定交易的預算：剩餘時間不足以完成等待連線、交易及回應所需的最小預算（`minCommandBudgetMs`，數值待定）時，在任何寫入之前拒絕，回可重試的錯誤。足夠時，把原請求的訊號及不超過剩餘時限的預算傳給`withTransaction`；時限涵蓋到COMMIT為止。
- 原請求的訊號全程沿用。請求被中止後不再開始新的業務工作，也不另起一個有完整時限的交易去繼續。
- Client可能只收到HTTP 504或斷線，而不是`AP_OUTCOME_UNKNOWN`。這兩種情況一律當作結果不明：以原event及內容重送查回（DES-004），不得據此認定已rollback，也不得改用新的event。
- 附屬寫入（拒絕收口、被拒絕命令的Audit、期初文件的拒絕狀態）只在業務交易已確定rollback之後進行，不做任何業務工作，沿用原請求的訊號及剩餘時限。結果不明時不寫拒絕，也不以附屬寫入作為已rollback的證據。時限內寫不進去時記錄於應用日誌；「沒有財務效果」只指這一次已rollback的業務交易，不指整個event：同一event仍可能由另一個請求成功，其結果以DES-004的拒絕收口及終態為準，不能據此把結果不明當作失敗，或把已成功的event回成拒絕。
- 期初匯入的上傳分兩段：解析及驗證是唯讀的，受檔案大小及行數上限約束；通過解析後，才在一個有界的交易內保存批次及文件的記錄。這個保存不取號、不寫ledger、不建立任何應付。在保存之前超出時限即中止，不留下批次。
- 匯出以資料流寫入私有檔案；列數超過上限時拒絕並要求縮窄條件，不產生部分檔案。

### Rationale
NFR-001、NFR-002、FR-042、FR-038、FR-032。AR評審的R6指出：有日期範圍不等於有列數上限；以資料流處理只限制記憶體，不限制時間；整張沖銷不能為遷就時限而拆開。數值涉及可接受的業務資料量，須連同OI-001由owner提出、有業務影響的交Sam確認，不由本設計自訂。

### Failure behavior
超限的請求在任何寫入之前被拒絕，並指出是哪個上限。剩餘時限不足時在進入交易前拒絕。時限在交易中到達時，交易被原訊號中止：已確定rollback的回可重試的錯誤，其餘一律是結果不明，由client以原event查回（DES-004）。沒有「做了一部分」的結果。

## DES-013 — 期初匯入的身分及請求集合

### Decision
- **上傳及預檢**：檔案存入私有位置，逐行解析及驗證（唯讀）；通過解析後在一個有界的交易內保存批次及其文件，每個文件保存其類型、Supplier、舊系統來源識別、內容及內容hash、預檢結果。保存不取號、不寫ledger、不建立應付。
- **穩定身分**：文件類型＋Supplier＋舊系統來源識別。Currency及金額屬於內容。
- **一個請求確認一個文件**：請求指明批次內的文件及其event。該文件的財務效果、來源列及批次文件的狀態、命令結果在同一交易commit（DES-004、DES-005）。批次的其餘文件由client逐個送出。
- **來源列與批次文件分開**。兩者是不同的記錄：
  - **來源列**（`ap_opening_sources`）：每個穩定身分一列，身分上有唯一鍵。記錄該來源是否已入帳；已入帳時記下產生的財務文件、內容hash及當時的event。來源列是該來源唯一的結果。
  - **批次文件**（`ap_opening_import_documents`）：每個批次內每筆上傳的記錄一列，是該批次對某個來源的一次引用，有自己的處理狀態。
- **來源仲裁**：確認命令在做任何財務效果之前（DES-005步3c，早於帳戶列），以身分插入或取得來源列，並以排他鎖鎖定至commit。不同批次、不同event、不同Currency對同一來源的嘗試都在這一列上會合，不是等到最後才在唯一鍵上競爭。取得鎖之後：
  - 來源已入帳、內容hash相同：不產生第二筆財務效果；把本批次文件標為`RESOLVED_BY_EXISTING`並指向原結果。
  - 來源已入帳、內容hash不同：命令被拒絕並rollback，回應顯示既有記錄；本批次文件其後由附屬交易標為`REJECTED`（見Failure behavior）。
  - 來源未入帳：執行財務效果，把來源列標為已入帳，把本批次文件標為`SUCCEEDED`，全部在同一交易commit。
- **結果不明及修正**：取得來源列的鎖，只證明先前**已進入來源仲裁**的嘗試已經結束（已commit或已rollback）。仍在event、期間界線或Supplier階段、尚未到達來源列的請求不在此列，來源鎖不能證明它的結果；結果不明的請求仍須以原event查回（DES-004、DES-012），不能以「來源未入帳」代替。在此範圍內：先前的嘗試仍在途時，帶著修改內容的新嘗試只能等待，不能搶先入帳；先前的嘗試已commit時，修改內容的嘗試按「已入帳、內容不同」被拒絕；先前的嘗試已確定rollback時，來源仍是未入帳，才接受修正後的內容。來源已入帳後即使其財務文件被作廢，來源列仍是已入帳，不能以同一來源重新匯入。
- **批次文件的狀態**：`PENDING`（預檢通過、尚未處理）、`INVALID`（預檢不通過）、`SUCCEEDED`（本文件產生了財務效果）、`RESOLVED_BY_EXISTING`（來源已由先前的文件入帳，內容相同）、`REJECTED`（最近一次已結束的確認被拒絕）、`CANCELLED`（批次被取消時尚未處理的文件）。
- **只有`PENDING`的文件可以確認**。要重試`REJECTED`的文件，須先把它重新開啟為`PENDING`：這是一個不帶財務效果的附屬寫入（條件更新`REJECTED→PENDING`），在重試請求開始業務交易之前commit。因此摘要不會把上一次的`REJECTED`當作這一次嘗試的結果。
  - `PENDING`的檢查是確認命令**在批次文件的鎖下、寫入財務效果之前**對當前狀態的驗證，不是交易外的一次預讀。
  - 已完成的event在DES-004步驟3先返回保存的結果，不重跑這項驗證；所以原確認已commit而回應不明時，重送原event仍取回成功，不會因文件已是`SUCCEEDED`而被拒絕。
  - `PENDING`不是執行租約：取消、或上一次嘗試晚到的拒絕寫入，可以先改變文件狀態，令尚未通過鎖下驗證的確認被拒絕。重新開啟只接受`REJECTED`，不能重新開啟`CANCELLED`；取消只改`PENDING`，不改已成功的文件。
- **批次摘要**由文件狀態即時計算，三類的合計恆等於批次上傳時的文件總數（取消不會移除文件）：

  | 摘要類別（FR-039） | 包含的狀態 | 分列顯示 |
  | --- | --- | --- |
  | 確定成功 | `SUCCEEDED`、`RESOLVED_BY_EXISTING` | 「本批次入帳」「已由先前批次入帳」 |
  | 確定未入帳 | `INVALID`、`REJECTED`、`CANCELLED` | 「預檢不通過」「確認被拒絕」「已取消」。已取消不是驗證失敗，也不是結果不明。 |
  | 尚未處理或待查明 | `PENDING` | 包括從未送出的文件，以及已送出而結果不明的文件。 |

  結果檔使用同一分類。批次沒有`PENDING`的文件即為完成；關帳日檢查的「未完成的期初批次」指仍有`PENDING`文件的批次（DES-011）。結果不明的文件維持`PENDING`，直到其原event被查回或該文件被取消。

走查：

| 情況 | 結果 |
| --- | --- |
| 批次A的來源X（USD 100，event EA）在途、回應中斷；批次B以同一來源X（另一Currency或金額，event EB）提交 | EB在來源列上等待EA。EA commit後，EB讀到已入帳而內容不同，被拒絕，B的文件為`REJECTED`。EA rollback後，EB讀到未入帳，按B的內容入帳。兩者的Currency不同也在同一來源列上會合。 |
| 批次A的來源X已入帳；批次B重傳相同內容 | B的文件標為`RESOLVED_BY_EXISTING`，沒有新的財務效果；B不再有`PENDING`，摘要及關帳日檢查都視B為完成。 |
| 來源Y因金額格式錯誤，預檢為`INVALID`；其後在新批次以同一識別、修正後的內容上傳 | 來源Y從未入帳，新批次的文件可確認並入帳；舊批次的`INVALID`文件保留。 |
| 文件D第一次確認確定rollback，D為`REJECTED`（摘要：確定未入帳1，批次完成）。使用者重試：D先重新開啟為`PENDING`，然後第二次確認的回應中斷，結果不明 | 重新開啟後摘要為「尚未處理或待查明1」，批次未完成，關帳日檢查視為未完成；不顯示舊的`REJECTED`。Client以原event查回：第二次已commit則D為`SUCCEEDED`，摘要「確定成功1」；第二次被業務拒絕並已完成拒絕收口則回該拒絕，D為`REJECTED`；第二次已rollback而沒有終態則重新執行，成功為`SUCCEEDED`，被拒絕則在確定rollback後寫回`REJECTED`。第二次確認用的是新的event，不是第一次被拒絕的那一個。 |
| 一批兩筆：一筆`SUCCEEDED`，另一筆未處理時使用者取消批次 | 另一筆由`PENDING`改為`CANCELLED`。摘要：確定成功1、確定未入帳1（已取消1）、尚未處理0，合計2，等於上傳總數。 |
- 期初發票以匯入的未清餘額作為總額；期初預付款及Credit Balance以匯入的可用額建立，各寫入一個ledger事件。期初文件不引用PO或收貨。

### Rationale
FR-038～FR-040、D11。AR評審的R5指出：一個event不可對應會變動的文件集合。以「一個請求一個文件」作為起點，每個event只對應一個固定的文件，沒有集合的問題，也不需要背景工作。

### Failure behavior
確認被拒絕時交易rollback，批次文件的狀態不變。拒絕原因在rollback之後以另一個附屬交易寫入：取得期間界線的共享鎖及來源列的排他鎖（DES-005的鎖表），只在該批次文件仍是`PENDING`或`REJECTED`時才把它寫成`REJECTED`及原因。這個條件更新是原子的，不會覆蓋`SUCCEEDED`、`RESOLVED_BY_EXISTING`或`CANCELLED`；它不寫入任何財務效果、ledger或號碼。確認在claim之後被業務拒絕時，該event的拒絕終態（DES-004的拒絕收口）在這同一個附屬交易寫入，event列在先；拒絕收口讀到同一event已成功時回原成功，不寫`REJECTED`。被拒絕的event已是終態，重新開啟之後的確認須用新的event。

附屬寫入（拒絕狀態、拒絕的Audit、重新開啟）的共同約束：拒絕類的寫入只在業務交易**已確定rollback**之後進行；結果不明時不寫拒絕，文件維持`PENDING`。附屬寫入沿用原請求的訊號及剩餘時限，不另起完整的時限；時限內寫不進去時文件維持原狀態，不影響財務結果。附屬寫入若因原交易rollback而找不到來源列，須先建立再鎖定；其取得方式及外鍵的鎖在欄位的交付交代。

回應中斷後重送同一event：已commit則返回原結果；已留下拒絕終態則回該拒絕；沒有終態則重新執行。批次中途停止時，未送出的文件保持`PENDING`，可在其後繼續，或由使用者取消批次。

## DES-014 — 與Purchasing的契約（未確認）

### Decision
本項不是設計決定，是由收貨建立發票及收貨沖銷檢查所需、**尚待Purchasing owner確認**的事項。上游的收貨行、明細、確認及沖銷均未在main；下列任何一項都不得當作已存在的服務。

已由Purchasing owner按其設計來源確認的事實（agentmsg `3a316de6`）：一行實收等於各明細合計並含超收，確認後不變；已沖銷數量記在明細；一次沖銷請求只屬一張收貨單並且原子；以收貨行作為AP佔用的粒度與其規則不衝突。

待確認：

1. **共同的序列化點及鎖模式**。獨立評審（AP需求評審報告）提出的方向：AP建立、增減、釋放佔用及確認，與收貨沖銷，都先按同一來源次序取得PO root的**排他鎖**（與現有寫入者相容），再取AP的列；沖銷在Inventory效果之前完成AP檢查，不可持有Inventory鎖後回頭取Purchasing或AP的鎖。作者先前的方案（`AP-PURCHASING-CONTRACT-PROPOSAL.md`的P1）對PO root及收貨列使用共享鎖，是未確認的替代做法，不作為預設。
2. **讀取介面的擁有者及形狀**：由Purchasing提供、使用呼叫方交易的讀取，回傳收貨行的實收及各明細已沖銷的合計；AP不直接查詢Purchasing的表，Purchasing不計算AP的佔用。此介面未設計，不在任何已批准的Task。
3. **AP檢查在Purchasing取鎖次序（其設計§2.6）中的位置**，以及AP的期間界線及帳戶列相對於Purchasing列的次序。本設計的DES-005把上游列放在步3，即AP的event及界線之後、AP業務列之前；沖銷一方則是Purchasing的列之後才取AP的佔用列。兩條路徑是否可能形成循環，須兩邊owner一起核對。沖銷時呼叫的AP檢查**不是**AP的寫命令：它在Purchasing已持有其鎖的交易內執行，不取AP的event、期間界線或帳戶列，只讀取及鎖定收貨行的佔用資料。DES-004及DES-005的通用步驟不可直接套用在這個檢查上。
4. **沖銷被AP檢查拒絕時的錯誤碼及顯示內容**；無AP查看權限的倉務人員只看到阻擋原因。
5. **「一行實收等於各明細合計」的保證**：沒有資料庫層的強制，依賴TASK-029及TASK-032的寫入邏輯。
6. **AP佔用資料的形狀**：每個收貨行一列佔用合計，還是只有發票行上的數量。屬AP的設計，但取決於第1項的鎖模式。
7. **計價**：PO行單價、採購單位及換算、Currency小數位的不可變來源；數量乘單價的捨入規則（Purchasing現行為四捨五入至Currency小數位，`moneyMath.js:43–52`）；一行分多張發票時尾差的歸屬；改價後尾差如何計算。
8. **付款條件快照**作為到期日預設的來源欄位。
9. **owner**：TASK-035／036（收貨沖銷）未指派；加入AP檢查是Purchasing的跨模組設計變更。

### Rationale
FR-004～FR-007、FR-009～FR-011、FR-020。Purchasing現有設計明文排除AP（其`03_design_spec.md:49`），沖銷流程沒有AP檢查。把未確認的事項集中列出，避免在其他設計項目中把它們寫成既定事實。

### Failure behavior
在這些事項確認之前，由收貨建立發票的功能不可設計為可實作狀態。DES-001～DES-013不依賴本項。

## DES-015 — 與Supplier及Business Master的契約（待確認）

### Decision
下列事項需要Supplier或Business Master的owner確認，本設計暫按所列的假設：

1. **Supplier lookup的用途**：`SupplierLookupService`現有`purchase`及`history`兩種用途（`:7`），`purchase`在Supplier不是Active時回報不可用（`:73`）。暫定：建立及確認無PO發票使用等同`purchase`的Active規則；處理既有應付（核銷、貸項、作廢、查詢）使用`history`，不因Supplier停用而拒絕（FR-045）。是否需要AP專用的用途名稱待確認。
2. **Supplier列的鎖**：本設計規定每個涉及某Supplier的AP命令都在步3b先取得Supplier列的鎖，再接觸AP的列（DES-005），以配合Supplier「先鎖Supplier、後查下游」的次序及外鍵的隱含鎖。待Supplier owner確認的是：鎖的模式（現有`assertUsableInTransaction`為`FOR UPDATE`；AP只需要阻止封存、改代碼及刪除，共享鎖是否足夠）、AP向Supplier提供的檢查會鎖定哪些AP列（第4項）、以及兩個交錯時序是否與Supplier的實作一致。收貨發票的命令先取Purchasing的列再取Supplier列，與Purchasing更新PO時的次序相同（`PurchaseOrderService.js:169,307–315,393–419`）；這條路徑屬DES-014，未確認。
3. **供付款選用的供應商銀行帳戶介面**（FR-027）：現有lookup不含銀行資料；Supplier設計`:1252`把Payment的銀行契約列為日後另行增加的高信任流程。需要的內容：列出某Supplier的有效帳戶（遮蔽）、在交易內驗證所選帳戶的歸屬及有效性、提供可保存的遮蔽快照，並要求操作者具備Supplier銀行資料的查看權限。FR-027是選填功能，介面未提供時付款的其餘部分仍可實作。
4. **AP向Supplier提供的引用及未完成事項檢查**：Supplier設計`:498`要求下游模組提供引用查詢及`ON DELETE RESTRICT`外鍵，並點名AP invoice及payment instruction。暫定AP提供兩個檢查：該Supplier是否有任何AP文件（引用）；是否有未付發票、可用的Credit Balance、預付款或Draft（未完成事項）。檢查的讀取須為鎖定讀取。實際由誰接線、封存是否因未完成的應付而被阻擋，待Supplier owner確認。
5. **Business Master的影響檢查**：Purchasing及Supplier各自向Business Master提供Currency及付款條件的影響檢查。AP使用Currency，暫定同樣提供；付款條件在AP只作為到期日的預設來源，是否需要提供待確認。

### Rationale
FR-015、FR-027、FR-045、SEC-004。這些是跨模組的介面，不應由AP單方面決定。

### Failure behavior
任何一項的介面未註冊時，依賴它的命令拒絕（fail closed）。第3項未提供時，付款不能選用收款帳戶，但可以確認。

## DES-016 — 列表、詳情及精確查詢

### Decision
- **列表**沿用現有做法（`PurchasingInquiryService.js:161–182`）：`page`及`pageSize`分頁；先以篩選條件計數並取得一頁的ID，再一次載入該頁的摘要；查詢次數固定，不隨列數增加。排序及篩選欄位以allowlist限定。
- **篩選**：Supplier、文件狀態、結算狀態、文件日期、到期日、Currency、內部文件號、供應商發票號。
- **精確查詢**：內部文件號使用各類文件號碼的唯一鍵；供應商發票號使用正規化後的號碼（去首尾空白、統一大小寫）的索引，可限定Supplier或跨Supplier查找。
- **詳情**：文件內容及行、三個扣減額及未付額（發票）或可用額（貸項、付款）、相關的貸項、應用及核銷、狀態歷史。伺服器按文件狀態、數額、關帳日及操作者當時的權限回傳`allowedActions`；這只供畫面顯示，命令執行時仍按DES-004、DES-005重驗。
- 一次查詢的全部讀取在同一個唯讀交易內進行，讀到同一個快照。
- 發票與收貨、PO之間的來源追溯屬DES-014，不在本項。

### Rationale
FR-033（來源追溯除外）、FR-044。沿用現有的分頁及「先ID頁、後批次載入」做法，不新增游標或其他分頁方式。

### Failure behavior
不在allowlist的排序或篩選欄位以驗證錯誤拒絕。資料庫不可用時回錯誤，不回空清單。查詢不寫入任何業務資料。

## DES-017 — 現況及As-of的計算

### Decision
- **現況**（沒有指定日期）：供應商帳戶讀帳戶列；未付、逾期及到期應付清單讀發票根列的未付額及到期日。
- **As-of 某日D**：只以Effect Date不晚於D的ledger事件計算（DES-007）：
  - 一張發票在D的未付額 ＝ 該發票的未付額變動之和。
  - 一張貸項在D的可用額、一筆付款在D的可用額，同樣由其變動加總。
  - 帳戶在D的三個合計 ＝ 該Supplier＋Currency的變動之和。
  為此每個ledger事件記下其三個變動各自所屬的發票、貸項及付款（變動為零的可空）。
- **逾期**：在D的未付額大於零，而到期日早於D。到期日等於D不算逾期。
- **Aging**：以D減到期日的日數分桶：不大於0為未到期，1–30、31–60、61–90、大於90。各桶合計等於在D的未付額合計。
- **同一日內的多個事件**以事件的先後次序計算；As-of只呈現該日結束時的結果。
- **補記較早Effect Date的事件**：在開放期間內，其後補記而Effect Date較早的事件，會改變由該Effect Date起各日的As-of結果。這類補記只有通過DES-007的歷史餘額檢查才會被接受，所以任何日期的As-of都不會出現負的發票未付額、貸項可用額或付款可用額，也不會超過其上限。關帳日或以前的日期不會再有新事件（DES-005），其As-of結果固定。
- 畫面、列印及CSV由同一個計算產生同一個結果模型，再各自呈現。
- 一次As-of計算在同一個唯讀交易內完成。
- 跨全部Supplier的As-of計算（歷史日期的Aging及未付清單）須彙總大量ledger事件；其可處理的發票數量有上限（`maxAsOfInvoices`，數值待定，規則同DES-012），超出時要求以Supplier或Currency縮窄。現況的Aging不受此限，因為只讀仍有未付額的發票。

### Rationale
「餘額口徑」、FR-034、FR-035、FR-037。逾期及分桶規則來自需求假設A-006（與AR需求FR-AR-004、FR-AR-005相同）。以單一計算避免畫面、列印及匯出口徑不同。

### Failure behavior
唯讀；超出上限時在計算前拒絕並指出縮窄方式，不回傳不完整的結果。歷史As-of的性能沒有量度，也沒有採用任何回應時間數字（OI-007）。

## DES-018 — Supplier Statement

### Decision
輸入Supplier、Currency及期間（起日、止日）或單一As-of日期。輸出：

- 期初：起日前一日的帳戶三個合計及淨應付（DES-017）。
- 期內交易：Effect Date在期間內的ledger事件，按Effect Date、再按事件次序排列；每列顯示文件類型、內部文件號、供應商發票號（如適用）、三個變動及累計淨應付。
- 期末：止日的三個合計及淨應付，以及止日的Aging摘要。

期初加期內各列的變動等於期末。期初、期內、期末及Aging摘要在同一個唯讀交易內讀取，使用同一個快照。期內交易列數受`maxStatementRows`限制（DES-012），超出時要求縮短期間。期初匯入只帶未清餘額（D11），Statement不涵蓋切換日之前的交易。

### Rationale
FR-036、FR-037。期初、期內及期末都由同一組ledger事件計算，所以三者必然相符，也與供應商帳戶及Aging一致。

### Failure behavior
唯讀；超出列數上限時拒絕。Supplier或Currency不存在時回找不到。

## DES-019 — 列印頁

### Decision
- 兩個A4列印頁：付款明細（一筆付款及其所核銷的發票）及Supplier Statement。做法沿用現有的列印頁（例如`client/src/pages/purchasing/PurchaseOrderPrintPage.vue`）：前端路由載入與畫面相同的資料後以列印樣式呈現，PDF由瀏覽器列印另存。沒有伺服器端的PDF產生及檔案。
- 已作廢或已沖銷的文件，列印頁按當時狀態加上明顯標示。
- 所有文字以純文字插值呈現，不使用未消毒的HTML。銀行資料只顯示遮蔽後的快照。
- 列印不改變任何業務資料。列印動作的Audit（FR-043）是只寫Audit的記錄，不屬於業務寫入，不取期間界線及帳戶列。

### Rationale
FR-041、FR-044、SEC-007。Sam對AR的同類決定（由瀏覽器列印另存，A-008）及現有的列印頁做法。

### Failure behavior
資料載入失敗時顯示錯誤，不顯示空白的文件。Audit寫入失敗不影響已顯示的內容，但須記錄於應用日誌。

## DES-020 — CSV匯出

### Decision
- 匯出在請求內同步完成，沿用`CustomerExportService`的次序（`:65–135`）：建立匯出記錄（`PROCESSING`）→ 在一個唯讀交易內取得資料 → 產生CSV並保存到私有位置 → 把記錄標為`COMPLETED`。只有`COMPLETED`的記錄可以下載。確定失敗的記錄標為`FAILED`。
- **檔案的位置由匯出記錄決定**：暫存檔及正式檔的名稱都由匯出記錄的ID推導（與Customer匯出以operation ID命名相同，`CustomerImportStorage.js:127–130`）。因此任何屬於某個匯出的檔案，不論何時寫出，都只會出現在該記錄的兩個已知位置，不會成為無主的檔案。產生時先以「不存在才建立」的方式開啟暫存檔，寫完後改名為正式檔。
- **完成與清理在匯出記錄上仲裁**（沿用`CustomerExportService.js:214–224,341–347`的完成鎖及狀態條件）：
  - 完成：在一個交易內鎖定該記錄。已是`COMPLETED`即回原記錄；不是`PROCESSING`（即已被標為`FAILED`）則不得完成；仍是`PROCESSING`才以帶狀態條件的更新改為`COMPLETED`，並確認更新了一列。`FAILED`不能回到`PROCESSING`或`COMPLETED`。
  - 放棄：清理工作以帶狀態條件的更新把`PROCESSING`改為`FAILED`，並確認更新了一列；沒有更新到（已完成或已失敗）即不處理該記錄。
  - 雙方都以更新結果為準。「更新成功」指該更新所在的交易已確定commit，不是只看到更新了一列；交易尚未commit、或COMMIT的結果不明時，不據此刪除任何檔案，留待下一次。
  - 放棄的仲裁以記錄為對象，不取決於是否已有檔案：建立記錄後尚未產生暫存檔便中止的匯出，同樣由這個條件更新收口，只是沒有檔案可刪。
  - `exportAbandonAfterMs`只用來挑選清理的候選，不代表原請求、其交易或其檔案寫入已經結束；正確性來自上述記錄上的仲裁，不是來自時間。
- **界限**：日期範圍及列數各有上限（`maxExportRangeDays`、`maxExportRows`，數值待定，規則同DES-012）。在同一個唯讀交易內先計數，超出列數上限即拒絕並要求縮窄條件，不產生檔案。資料與計數來自同一個快照。
- **內容**：只含操作者有權查看的資料；不含完整銀行帳號。以公式字元（`=`、`+`、`-`、`@`）或控制字元開頭的欄位值加上前置單引號，公式字元前有空白時同樣處理；全部欄位加引號，欄位內的引號以重複引號轉義（與`CustomerExportService.js:25–28`的處理一致）。
- **記錄**：`ap_exports`保存建立者、類型、篩選條件、As-of日期、列數、檔案參照及到期時間。
- **授權**：`ap.export`不包含資料的查看權。建立匯出、取得匯出記錄（包括HTTP回放及以請求鍵查回）及實際下載，每一次都以資料庫現時的權限重驗下列全部條件；曾經建立過檔案不構成其後的授權：
  - 該匯出類型所需的查看權（發票、貸項、付款、未付、Aging及Statement均為`ap.view`）；
  - `ap.export`；
  - 操作者是該匯出的建立者；
  - 記錄為`COMPLETED`且未到期（只適用於取得結果及下載）。

  | 情況 | 結果 |
  | --- | --- |
  | 建立後被撤去`ap.view`，仍有`ap.export` | 取得記錄及下載均被拒絕。 |
  | 建立後被撤去`ap.export`，仍有`ap.view` | 取得記錄及下載均被拒絕。 |
  | 另一名同時具備兩項權限的使用者以該匯出的ID下載 | 回應與不存在相同。 |
  | 被撤權後以原HTTP key重送建立請求 | 回放前的重驗拒絕，不回傳原記錄。 |

  下載以附件方式回傳，不可快取。匯出內容只含遮蔽後的銀行快照，所以不另外要求Supplier銀行資料的查看權。
- **請求鍵及重送**：匯出不是財務命令，不取期間界線及帳戶列。建立請求在內容中帶`eventId`，它就是匯出記錄的`request_key`；它與HTTP的`Idempotency-Key`是兩個不同的鍵。這一點與Customer匯出不同：該模組把HTTP的key直接當作service的鍵（`customerExportHandlers.js:17–19`），換HTTP key就會變成另一筆匯出，AP不沿用這個綁定。
  - 記錄以「建立者＋`request_key`」唯一。以相同的`eventId`及相同的內容再次`POST /ap-exports/create`時，service找到原記錄並比較內容hash：相同即回原記錄及其現時狀態（`PROCESSING`、`FAILED`或`COMPLETED`），不重新產生；內容不同回`AP_EVENT_CONFLICT`。
  - 查回不需要知道匯出的ID：首次回應遺失時，client以原`eventId`及原內容重送建立請求；原HTTP key仍可用時沿用，框架回`IDEMPOTENCY_RESULT_UNAVAILABLE`或原key已不可用時改用新的HTTP key，`eventId`不變。取得記錄的ID之後，才以`GET /ap-exports/:id`查詢狀態。
  - 每一次仍按「授權」一段重驗查看權、`ap.export`及建立者。以新的`eventId`建立的是另一筆匯出，不算查回成功。

  | 步驟 | 結果 |
  | --- | --- |
  | Client以HTTP key H、`eventId` K建立匯出；伺服器已建立記錄E（甚至已完成），回應遺失，client不知道E的ID | — |
  | Client以H重送，框架回`IDEMPOTENCY_RESULT_UNAVAILABLE`，請求沒有到達service | Client改用新的HTTP key H2，`eventId`仍是K、內容不變 |
  | 請求以H2到達service | Service以建立者＋K找到E，內容hash相同，回E及其狀態；沒有新的匯出、沒有重新產生檔案 |
  | Client其後以K但不同的篩選條件送出 | 內容hash不同，`AP_EVENT_CONFLICT` |
- **時限及結果不明**：沿用原請求的訊號及剩餘時限，逾時後不另起完整的時限繼續。把記錄標為`COMPLETED`的交易若已送出COMMIT而回應未收到，結果是不明，不能當作未完成；client以同一請求鍵查回。只有在**確定**未完成時（檔案產生或保存失敗、或完成的交易確定rollback），請求才以帶狀態條件的更新把記錄由`PROCESSING`改為`FAILED`；更新成功後才刪除該記錄位置上的檔案。請求報錯本身不是刪除檔案的依據。

### Rationale
FR-042、SEC-007、SEC-009、NFR-005。AR評審指出：日期範圍不等於列數上限，資料流只限制記憶體；沿用現有匯出模式時仍須有明確的列數上限、同一快照及超限拒絕。Customer匯出的上限值（10,000列）是該模組的設定，不視為AP的容量。

### Failure behavior
| 情況 | 結果 |
| --- | --- |
| 檔案已保存，標為`COMPLETED`的COMMIT已送出，回應因逾時或斷線未收到 | 結果不明。Client以同一請求鍵查回：已commit則記錄為`COMPLETED`，回原記錄，檔案完好可下載；未commit則記錄仍為`PROCESSING`，按下一列處理。請求一方不刪除任何檔案。 |
| 記錄停留在`PROCESSING`超過`exportAbandonAfterMs`（數值待定） | 成為清理的候選。清理工作以條件更新（只在仍是`PROCESSING`時）把它標為`FAILED`；更新成功才刪除該記錄位置上的檔案。時間不證明原請求已結束，三個交錯見下表。 |
| 檔案產生或保存確定失敗（例如儲存不可用） | 記錄標為`FAILED`，不可下載；已寫出的部分檔案由該請求或清理工作刪除。 |
| 超出列數或日期範圍上限 | 在產生檔案之前拒絕，不建立可下載的記錄。 |

完成與清理的三個交錯：

| 交錯 | 結果 |
| --- | --- |
| 完成先贏：原請求的完成交易已鎖定記錄並在提交中，清理此時挑中該記錄 | 清理的條件更新在記錄上等待。完成commit後記錄是`COMPLETED`，清理更新不到任何一列，不刪除檔案；檔案可正常下載。 |
| 清理先贏：原請求仍在交易外產生或保存檔案，清理把記錄改為`FAILED`並刪除其位置上的檔案 | 原請求其後進入完成步驟，鎖定記錄後讀到`FAILED`，不得完成，回報失敗，並刪除自己其後寫到該位置的檔案。記錄維持`FAILED`，不可下載。 |
| 檔案寫入晚到：清理已把記錄改為`FAILED`並刪除檔案，原請求先前發出的寫入或改名其後才落到磁碟，而原請求沒有機會自行清理 | 該檔案只會出現在這個`FAILED`記錄的已知位置。它不可下載，因為下載要求`COMPLETED`。其後每一次清理都會再次檢查並刪除（DES-023），不會因為曾經清理過而被略過。 |

超限、逾時及儲存不可用各自回明確的錯誤；其他AP功能不受影響。本設計不保證逾時的請求必然沒有完成。

## DES-021 — 權限及物件層授權

### Decision
- AP的權限加入現有的權限目錄：`ap.view`、`ap.invoice.mgmt`、`ap.invoice.price.override`、`ap.credit.mgmt`、`ap.payment.mgmt`、`ap.settings`、`ap.opening.import`、`ap.export`（名稱沿用需求的建議，待定案）。各權限互不包含；系統管理員角色不自動取得。
- 每個route宣告所需權限；service在交易內以資料庫現時的權限重驗（DES-004）。入帳類命令只接受`ap.invoice.mgmt`，付款類命令只接受`ap.payment.mgmt`，兩者不可互相代替。
- **物件層**：子記錄一律以「父ID＋子ID」查詢及鎖定（例如貸項行必須屬於所指的發票）。不屬於該父記錄的ID、以及操作者無權查看的記錄，回應與不存在相同。
- 匯出記錄及匯出檔：每次取得及下載都重驗所需的查看權、`ap.export`、建立者、狀態及到期（DES-020）。
- 期初批次的來源檔及結果檔：每次下載都重驗操作者當時仍具`ap.opening.import`並且是該批次的建立者，檔案未到期。批次的狀態及摘要向當時具`ap.opening.import`者顯示。
- 曾經建立某個檔案或記錄，不構成其後取得它的授權。
- 供應商銀行資料的顯示及選用另須`supplier.bank.view`（現有權限），並經Supplier的介面取得（DES-015第3項）。

### Rationale
SEC-001、SEC-002、SEC-003、SEC-004。以權限分開入帳與付款，取代付款審批流程（D4）。

### Failure behavior
缺少權限時拒絕且不洩露目標是否存在。權限被撤回後，進行中的頁面再送出的命令在交易內的重驗被拒絕。

## DES-022 — 輸入、輸出及上傳的安全處理

### Decision
- **輸入**：每個請求以schema驗證，拒絕未列明的欄位、超長的值、格式不合的金額、日期及識別碼。
- **輸出**：供應商名稱、發票號、描述、原因及備註在畫面及列印頁以純文字呈現；CSV按DES-020處理。
- **上傳**（期初匯入）：經現有的上傳中介層及檔案類型檢查（`server/src/services/filetype/FileTypeService.js`）。AP另外限定：只接受CSV；須為合法的UTF-8；大小及行數不超過`maxOpeningFileBytes`、`maxOpeningRows`（DES-012）。任何一項不符即拒絕整個檔案，不部分處理。檔案保存於私有位置，只作為資料解析，不被執行或引用為程式。

### Rationale
SEC-007、FR-038。沿用框架已有的驗證及上傳檢查，不另建一套。

### Failure behavior
驗證失敗時指出欄位，不寫入任何資料。上傳被拒絕時不保留檔案。

## DES-023 — 檔案保留及清理

### Decision
- 保留期限（假設A-004，Sam已接受）：正式的發票、貸項、付款、核銷歷史、ledger及Audit至少7年，本模組沒有刪除這些資料的功能；期初匯入的來源檔及結果檔90日；匯出檔7日。
- 一個每日的Scheduler工作（沿用現有的`SchedulerService`）清理私有檔案。清理**以私有位置內實際存在的檔案為準**：每次執行都檢查每一個檔案所屬的記錄（由檔名推導，DES-020），只在可證明屬於下列情況時刪除：
  - 所屬記錄已到期（匯出檔及期初檔）；
  - 所屬的匯出記錄為`FAILED`；
  - 所屬的匯出記錄停留在`PROCESSING`超過`exportAbandonAfterMs`：先以條件更新標為`FAILED`並確認更新了一列，才刪除；更新不到或結果不明即不刪除（DES-020的仲裁）。

  未到期的`COMPLETED`記錄的檔案，以及未超過上述時間的`PROCESSING`記錄的檔案，不會被刪除。刪除時先刪暫存檔、後刪正式檔，使針對已存在暫存檔的改名不會成功。這不證明所有晚到的寫入已經停止：其後才建立的暫存檔仍可能出現，由下一次清理處理。保障來自「`FAILED`的記錄不可下載」及「每次都重新檢查實際存在的檔案」，不要求原流程在清理前已實際停止。
- 記錄上的「檔案已清除」只供顯示，不用來略過檢查。因為每次都由實際存在的檔案出發，清理之後才寫出的晚到檔案會在下一次被發現並刪除，不會成為未被追蹤的殘留。
- 清理只處理檔案及其記錄上的狀態與清除標記，不讀寫任何財務資料。
- 這個工作可重複執行：刪除已不存在的檔案不算錯誤；失敗的留待下一次。
- 備份及還原沒有AP專屬的設計：AP的表及私有檔案隨系統備份。復原目標是否適用於AP待核對（OI-008）。

### Rationale
NFR-005、NFR-006、SEC-009。清理是本模組唯一需要排程的寫入，使用現有Scheduler，不另設佇列。

### Failure behavior
清理失敗不影響財務功能，並記錄於應用日誌。檔案已到期但尚未被清理時，下載仍按到期時間拒絕。

## DES-024 — 資料表欄位及索引（不含收貨發票）

### Decision
共同慣例（沿用Purchasing的migration，例如0112～0115）：ID為`BIGINT UNSIGNED AUTO_INCREMENT`；時間為epoch毫秒的`BIGINT UNSIGNED`；業務日期為`DATE`；代碼及狀態為`VARCHAR`、`ascii_bin`並以`CHECK`限定取值；無號金額為`DECIMAL(25,4)`並以`CHECK`限定不為負；可變的根列有`version INT UNSIGNED`；操作者為`*_by BIGINT UNSIGNED NULL`，外鍵指向`users`、`ON DELETE SET NULL`，另存當時的顯示名稱。引用`suppliers`的外鍵一律`ON DELETE RESTRICT`。

下表列出每張表的欄位及鍵。收貨行的欄位（來源收貨行、PO行、數量、PO單價、覆寫原因及佔用）屬收貨發票的交付，不在此列。

| 表 | 欄位 | 鍵及約束 |
| --- | --- | --- |
| `ap_settings` | `id`（固定為1）、`invoice_prefix`、`credit_note_prefix`、`payment_prefix`、`close_date`（可空）、`version`、`updated_by`、`updated_at` | PK `id`；`CHECK(id = 1)`；三個前綴互不相同 |
| `ap_prefix_history` | `prefix`、`document_type`、`first_used_at` | PK `prefix`：一個前綴只能屬於一類文件，用過即保留 |
| `ap_document_sequences` | `document_type`、`business_year`、`next_value`、`updated_at` | PK（`document_type`,`business_year`） |
| `ap_operation_requests` | `id`、`event_id`、`command_type`、`target_type`、`target_id`（建立類為0）、`request_hash`、`actor_user_id`、`actor_label`、`result_summary`（含終態：`SUCCEEDED`或`REJECTED`；拒絕時含錯誤代碼，DES-004）、`completed_at`、`request_id`、`correlation_id`、`created_at` | `UNIQUE(event_id)`；`KEY(target_type,target_id,id)`；`event_id`及`request_hash`的格式`CHECK`與Purchasing相同 |
| `ap_supplier_currency_balances` | `supplier_id`、`currency_code`、`invoice_outstanding`、`credit_available`、`payment_available`、`version`、`updated_at` | PK（`supplier_id`,`currency_code`）；三個數額不為負 |
| `ap_invoices` | `id`、`invoice_type`（`NON_PO`、`OPENING`；`RECEIPT`留待其後）、`status`、`supplier_id`、Supplier代碼及名稱快照、`currency_code`、Currency小數位快照、`supplier_invoice_number`、`supplier_invoice_number_key`（正規化）、`active_number_key`（衍生欄位，只在`DRAFT`及`CONFIRMED`時等於正規化號碼）、`internal_number`（可空）、`invoice_date`、`effect_date`、`due_date`（Draft可空）、付款條件快照、`entered_total_amount`、`total_amount`、`credit_reduction_amount`、`credit_applied_amount`、`payment_applied_amount`、`outstanding_amount`、`active_credit_count`、`non_po_reason`、`notes`、`follow_up_notes`、`opening_original_amount`及`opening_original_date`（可空，只作參考）、`void_reason`、`void_effect_date`、`version`、建立／確認／作廢的操作者及時間 | `UNIQUE(internal_number)`；`UNIQUE(supplier_id,active_number_key)`；`KEY(supplier_id,currency_code,status,invoice_date,id)`；`KEY(status,due_date,id)`；`KEY(supplier_invoice_number_key,id)`；各數額不為負，未付額不大於總額 |
| `ap_invoice_lines` | `id`、`invoice_id`、`line_no`、`line_type`（`CHARGE`、`OPENING`；`RECEIPT`留待其後）、`description`、`line_amount`、`credited_amount` | `UNIQUE(invoice_id,line_no)`；`UNIQUE(invoice_id,id)`供複合外鍵；`line_amount`為正，`credited_amount`不大於`line_amount` |
| `ap_credit_notes` | `id`、`credit_type`（`NORMAL`、`OPENING`）、`invoice_id`（`OPENING`為空）、`status`、`supplier_id`、`currency_code`及小數位快照、`internal_number`、`supplier_credit_number`、`credit_date`、`effect_date`、`reason`、`total_amount`、`origin_reduction_amount`、`balance_issued_amount`、`balance_applied_amount`、`balance_available_amount`、`void_reason`、`void_effect_date`、`version`、操作者及時間 | `UNIQUE(internal_number)`；`KEY(invoice_id,status,id)`；`KEY(supplier_id,currency_code,status,id)`；`credit_type`為`OPENING`時`invoice_id`必須為空，否則必須有值；`total_amount = origin_reduction_amount + balance_issued_amount` |
| `ap_credit_note_lines` | `id`、`credit_note_id`、`line_no`、`invoice_id`、`invoice_line_id`、`credit_amount` | `UNIQUE(credit_note_id,line_no)`；複合外鍵（`invoice_id`,`invoice_line_id`）指向`ap_invoice_lines(invoice_id,id)`，欄位次序與父表的`UNIQUE(invoice_id,id)`相同。這個外鍵只保證該行屬於所指的發票；貸項與其原發票的其他一致性仍由service及物件層檢查 |
| `ap_credit_applications` | `id`、`credit_note_id`、`target_invoice_id`、`amount`、`status`（`ACTIVE`、`UNAPPLIED`）、`effect_date`、`unapplied_effect_date`、建立及解除的操作者與時間 | `KEY(credit_note_id,status,id)`；`KEY(target_invoice_id,status,id)` |
| `ap_payments` | `id`、`payment_type`（`NORMAL`、`OPENING`）、`status`、`supplier_id`、`currency_code`及小數位快照、`internal_number`、`payment_date`、`effect_date`、`amount`、`allocated_amount`、`available_amount`、`active_allocation_count`、`payment_method`、`transaction_reference`、`cheque_number`、`other_description`、`supplier_bank_account_id`及遮蔽快照（可空）、`notes`、`reversal_reason`、`reversal_effect_date`、`version`、操作者及時間 | `UNIQUE(internal_number)`；`KEY(supplier_id,currency_code,status,payment_date,id)`；`amount = allocated_amount + available_amount`（已沖銷時兩者為0） |
| `ap_payment_allocations` | `id`、`payment_id`、`invoice_id`、`amount`、`status`（`ACTIVE`、`UNAPPLIED`、`REVERSED`）、`effect_date`、`ended_effect_date`、建立及結束的操作者與時間 | `KEY(payment_id,status,id)`；`KEY(invoice_id,status,id)` |
| `ap_ledger_events` | `id`（即事件次序）、`supplier_id`、`currency_code`、`effect_date`、`occurred_at`、`event_type`、`operation_request_id`、`outstanding_delta`及其`invoice_id`、`credit_delta`及其`credit_note_id`、`payment_delta`及其`payment_id`、`reverses_event_id`（可空） | 三個變動為有號的`DECIMAL(25,4)`；變動不為零時其所屬文件不可為空；`KEY(supplier_id,currency_code,effect_date,id)`；`KEY(invoice_id,effect_date,id)`；`KEY(credit_note_id,effect_date,id)`；`KEY(payment_id,effect_date,id)`；trigger拒絕`UPDATE`及`DELETE` |
| `ap_status_history` | `id`、`document_type`、`document_id`、`from_status`、`to_status`、`effect_date`、`reason`、`operation_request_id`、操作者、`occurred_at` | `KEY(document_type,document_id,id)`；trigger拒絕`UPDATE`及`DELETE` |
| `ap_audit_logs` | 見DES-028 | 見DES-028 |
| `ap_opening_import_batches` | `id`、原檔名、檔案hash及大小、行數、文件數、`cancelled_at`（可空）、`created_by`、`created_at`、`expires_at`、`files_purged_at` | `KEY(created_by,created_at,id)` |
| `ap_opening_import_documents` | `id`、`batch_id`、`row_no`、`document_type`（`INVOICE`、`PREPAYMENT`、`CREDIT_BALANCE`）、`supplier_id`（預檢不通過時可空）、`legacy_source_id`、`content`、`content_hash`、`status`、`result_code`、`result_detail`、`opening_source_id`（可空）、`updated_at` | `UNIQUE(batch_id,row_no)`；`KEY(batch_id,status,id)` |
| `ap_opening_sources` | `id`、`document_type`、`supplier_id`、`legacy_source_id`、`posted`、`content_hash`、結果文件的類型及ID、`posted_operation_request_id`、`posted_at` | `UNIQUE(document_type,supplier_id,legacy_source_id)` |
| `ap_exports` | `id`、`request_key`（即建立請求的`eventId`，不是HTTP的`Idempotency-Key`）、`request_hash`（匯出類型、篩選條件及As-of日期的內容hash）、`export_type`、`filters`、`filters_hash`、`as_of_date`、`status`（`PROCESSING`、`COMPLETED`、`FAILED`）、`row_count`、`file_sha256`、`created_by`、`created_at`、`completed_at`、`expires_at`、`files_purged_at` | `UNIQUE(created_by,request_key)`；`KEY(created_by,created_at,id)`；`KEY(status,created_at,id)` |

補充：

- **期初預付款及期初Credit Balance的形狀**：期初預付款是一筆`payment_type`為`OPENING`的已確認付款，可用額等於匯入額。期初Credit Balance是一張`credit_type`為`OPENING`的已確認貸項，沒有原發票，全部金額發行為Credit Balance。這是FR-021「一張貸項只屬於一張發票」的唯一例外，只由期初匯入產生。
- 期初類型的界線：`OPENING`的付款及貸項只由期初文件的確認產生，建立時即為`CONFIRMED`；一般的建立及確認路徑不可選用這個類型，一般貸項仍須有`CONFIRMED`的原發票。`OPENING`貸項的原發票沖減額為0、發行額等於匯入額，不更新任何發票的有效貸項數目；其應用、解除及作廢沿用同Supplier同Currency、可用額及期間的規則，作廢只反向自己的可用額及狀態，不涉及原發票的鎖、沖減或數目。`OPENING`付款沿用核銷及整張沖銷的規則，不要求填寫付款方式的欄位。來源的已入帳身分在作廢或沖銷後仍然保留（DES-013）。
- 與狀態有關的`CHECK`須按狀態表達：例如付款的`amount = allocated_amount + available_amount`只適用於`CONFIRMED`；已沖銷時保留原`amount`，其餘兩者為0。可空及必填的條件同樣按類型及狀態寫出，不為遷就一條無條件的`CHECK`而改寫正式金額。
- 一個事件涉及多份文件時，每份受影響的文件一列ledger事件（例如付款沖銷按每張受影響的發票各一列）。
- 一筆發票根列的`outstanding_amount`及三個扣減額、貸項及付款根列的可用額，是ledger的即時彙總，由同一交易更新（DES-007）。
- 上表不含收貨發票所需的欄位、報表的SQL及為報表而加的索引；後者在量度之後才決定。

### Rationale
DES-001、DES-005～DES-013、DES-017、DES-020。型別及約束沿用Purchasing現有migration的做法，使同一資料庫內的寫法一致。`ap_prefix_history`以主鍵落實DES-006「前綴用過即屬於該類文件」的規則。`active_number_key`以唯一鍵落實FR-008。

### Failure behavior
違反唯一鍵、外鍵或`CHECK`的寫入由資料庫拒絕，交易rollback，轉為DES-027的對應錯誤。對ledger、狀態歷史及Audit的`UPDATE`、`DELETE`由trigger拒絕。

## DES-025 — Migration分片

### Decision
按依賴次序分為六片，每片只新增表、索引及trigger，不修改現有的表：

1. `ap_settings`（含唯一一列的初始資料）、`ap_prefix_history`、`ap_document_sequences`、`ap_operation_requests`、`ap_audit_logs`。
2. `ap_supplier_currency_balances`、`ap_invoices`、`ap_invoice_lines`、`ap_status_history`、`ap_ledger_events`及其不可變trigger。
3. `ap_credit_notes`、`ap_credit_note_lines`、`ap_credit_applications`。
4. `ap_payments`、`ap_payment_allocations`。
5. `ap_opening_import_batches`、`ap_opening_import_documents`、`ap_opening_sources`。
6. `ap_exports`。

Migration的序號在實作時由當時最新的main取下一個可用號碼；本設計不指定序號。新增AP權限的資料寫入屬另一項工作（DES-026），不在這六片內。

- 第2片的`ap_ledger_events`有貸項及付款的識別欄位，本設計沒有為它們宣告外鍵，所以第2片不依賴第3、4片。實作如要加上這些外鍵，須在父表建立之後才加，並相應調整分片次序。
- trigger的重跑不由`CREATE TABLE IF NOT EXISTS`處理；沿用`0114_create_purchasing_operation_requests.js`核對並確保trigger定義的做法。

### Rationale
分片對應建議的分期，前一片不依賴後一片。Purchasing的收貨行候選已佔用其後的序號，預先指定會衝突。

### Failure behavior
每片在空的AP表上執行；失敗時該片的DDL按MySQL的原子DDL逐句生效或不生效，重跑不產生重複物件（沿用`CREATE TABLE IF NOT EXISTS`的寫法）。已寫入業務資料之後不提供破壞性的回退。

## DES-026 — API及權限（不含收貨發票）

### Decision
沿用現有慣例：路徑為`/api/v1/<資源>`；列表`GET /<資源>`、詳情`GET /<資源>/:id`、建立`POST /<資源>/create`、其他動作`POST /<資源>/:id/<動作>`；handler目錄與URL前綴一致。所有寫入帶`eventId`，修改既有文件的另帶`expectedVersion`；寫入route啟用HTTP idempotency（DES-004）。

| 路徑 | 動作 | 權限 | 備註 |
| --- | --- | --- | --- |
| `/ap-settings` | `GET` | `ap.settings` | |
| `/ap-settings/update`、`/ap-settings/advance-close-date` | `POST` | `ap.settings` | 重新認證 |
| `/ap-invoices`、`/ap-invoices/:id` | `GET` | `ap.view` | 詳情含`allowedActions` |
| `/ap-invoices/create`、`/:id/update`、`/:id/cancel`、`/:id/confirm` | `POST` | `ap.invoice.mgmt` | 本交付只有無PO發票 |
| `/ap-invoices/:id/follow-up-notes/update` | `POST` | `ap.invoice.mgmt` | 不改正式內容 |
| `/ap-invoices/:id/void` | `POST` | `ap.invoice.mgmt` | 重新認證 |
| `/ap-credit-notes`、`/ap-credit-notes/:id` | `GET` | `ap.view` | |
| `/ap-credit-notes/create`、`/:id/update`、`/:id/cancel`、`/:id/confirm` | `POST` | `ap.credit.mgmt` | |
| `/ap-credit-notes/:id/void` | `POST` | `ap.credit.mgmt` | 重新認證 |
| `/ap-credit-applications/create`、`/ap-credit-applications/:id/unapply` | `POST` | `ap.credit.mgmt` | |
| `/ap-payments`、`/ap-payments/:id` | `GET` | `ap.view` | 銀行快照只顯示遮蔽值 |
| `/ap-payments/create`、`/:id/update`、`/:id/cancel`、`/:id/confirm` | `POST` | `ap.payment.mgmt` | 選用供應商銀行帳戶另須`supplier.bank.view` |
| `/ap-payments/:id/allocate`、`/:id/reallocate` | `POST` | `ap.payment.mgmt` | |
| `/ap-payment-allocations/:id/unapply` | `POST` | `ap.payment.mgmt` | |
| `/ap-payments/:id/reverse` | `POST` | `ap.payment.mgmt` | 重新認證 |
| `/ap-supplier-accounts/:supplierId` | `GET` | `ap.view` | 須指定Currency；可指定As-of |
| `/ap-reports/outstanding`、`/aging`、`/due`、`/statement` | `GET` | `ap.view` | Statement的請求一律帶起日及截止日（As-of日期即截止日），伺服器不設預設日期；缺少其一或起日晚於截止日時回`AP_INPUT_INVALID`（DES-033） |
| `/ap-opening-imports/template` | `GET` | `ap.opening.import` | |
| `/ap-opening-imports/upload` | `POST` | `ap.opening.import` | 檔案上傳 |
| `/ap-opening-imports`、`/ap-opening-imports/:id` | `GET` | `ap.opening.import` | 批次狀態及摘要 |
| `/ap-opening-imports/:id/documents/:documentId/confirm`、`/reopen` | `POST` | `ap.opening.import` | 一個請求一個文件 |
| `/ap-opening-imports/:id/cancel` | `POST` | `ap.opening.import` | |
| `/ap-opening-imports/:id/source`、`/:id/result` | `GET` | `ap.opening.import`＋建立者 | 檔案下載，每次重驗 |
| `/ap-exports/create` | `POST` | 該類型的查看權＋`ap.export` | 內容帶`eventId`作為請求鍵；相同鍵及內容回原記錄，也是不知道ID時的查回路徑（DES-020） |
| `/ap-exports` | `GET` | `ap.view`＋`ap.export` | 只回操作者自己建立的匯出，由伺服器以建立者作查詢條件，不接受以建立者作篩選參數；分頁及每頁上限同DES-016，按建立時間倒序（DES-024的`KEY(created_by,created_at,id)`）；只含狀態資料，不含檔案。不是查回的途徑 |
| `/ap-exports/:id` | `GET` | 查看權＋`ap.export`＋建立者 | **狀態資料**：可回`PROCESSING`、`FAILED`或`COMPLETED`，不含檔案 |
| `/ap-exports/:id/result` | `GET` | 同上，並須`COMPLETED`且未到期 | **完成的結果**：檔案下載 |
| `/ap-audit-logs` | `GET` | `ap.view` | |

- 由收貨建立發票、待開票清單及收貨沖銷檢查的介面不在此表，待DES-014確認。
- 八個AP權限加入權限目錄並寫入資料；不自動授予任何現有角色。新增目錄項目會影響現有以完整權限集合比對的測試，屬實作時須處理的事項。
- 每個route的權限只是入口檢查；service在交易內以資料庫現時的權限再驗（DES-004），物件層的檢查見DES-021。

### Rationale
FR-001～FR-045的介面（收貨發票除外）、SEC-001、SEC-002。路徑及動作的寫法與`server/src/handlers/purchase-orders/`相同。匯出的狀態資料與完成結果分為兩個路徑，使查回處理中或失敗的狀態不需要`COMPLETED`的條件。

### Failure behavior
見DES-027。未列於此表的路徑不存在；AP不提供直接修改餘額、ledger或號碼的介面。

## DES-027 — 錯誤及結果不明的查回

### Decision
AP的錯誤以模組的錯誤表定義（做法同`purchasingErrors.js`：代碼對應HTTP狀態及固定的中文訊息），對外訊息不含SQL、路徑、完整銀行帳號或未授權的ID。

| 代碼 | HTTP | 意義 | Client的處理（首次送出時；重送見下文的分類） |
| --- | --- | --- | --- |
| `AP_INPUT_INVALID` | 400 | 輸入不合規，附欄位 | 修正後以新的event重送 |
| `AP_NOT_FOUND` | 404 | 不存在或無權查看 | 不重試 |
| `AP_VERSION_CONFLICT` | 409 | 文件已被修改 | 重新載入後由使用者重做 |
| `AP_STATE_CONFLICT` | 409 | 狀態不容許該動作（例如文件不是`PENDING`、原發票不是`CONFIRMED`） | 重新載入 |
| `AP_EVENT_CONFLICT` | 409 | 同一event用於不同的操作者、命令、目標或內容 | 不可重用該event |
| `AP_PERIOD_CLOSED` | 409 | Effect Date在關帳日或以前 | 改用開放的日期 |
| `AP_AMOUNT_EXCEEDED` | 409 | 超過未付額、可用額或可貸項上限 | 重新載入最新數額 |
| `AP_HISTORY_BALANCE_VIOLATION` | 409 | 補記會令歷史日期的餘額不成立（DES-007） | 改用較後的Effect Date |
| `AP_DUPLICATE_SUPPLIER_INVOICE_NUMBER` | 409 | 同一Supplier已有相同的供應商發票號 | 顯示既有發票 |
| `AP_RELATIONS_BLOCK_VOID` | 409 | 仍有有效的貸項、應用或核銷 | 先解除所列項目 |
| `AP_OPENING_SOURCE_CONFLICT` | 409 | 期初來源已入帳而內容不同 | 顯示既有記錄 |
| `AP_LIMIT_EXCEEDED` | 422 | 超過DES-012的某個上限，指出是哪一個 | 縮窄範圍，或把可分開的請求拆分；整張付款沖銷不可拆分（DES-010） |
| `AP_FILE_EXPIRED` | 410 | 檔案已到期 | 重新建立 |
| `AP_DEADLINE_INSUFFICIENT` | 503 | 剩餘時限不足，未開始任何寫入 | 可重試；是否沿用原event按下文的結果分類 |
| `CONCURRENT_OPERATION` | 409 | 死鎖或鎖等待逾時，這次的交易已確定rollback | 可有限次重試；是否沿用原event按下文的結果分類 |
| `AP_DEPENDENCY_UNAVAILABLE` | 503 | 上游介面不可用或版本不符 | 稍後重試 |
| `AP_OUTCOME_UNKNOWN` | 500 | 尚未確認該event的終態：commit的結果不明，或拒絕收口因時限不足、寫入失敗或其commit不明而未能確認（DES-004） | 按下文查回，不可更換event |

框架本身回傳的idempotency錯誤照常傳回：`IDEMPOTENCY_IN_PROGRESS`（稍後以同一key重試）、`IDEMPOTENCY_CONFLICT`、`IDEMPOTENCY_RESULT_UNAVAILABLE`。權限過期沿用現有的`PERMISSION_STALE`。

**結果不明的查回契約**：

- 以下情況視為結果未確定：`AP_OUTCOME_UNKNOWN`、HTTP 504及其他沒有AP代碼的5xx、逾時、連線中斷、`IDEMPOTENCY_IN_PROGRESS`、`IDEMPOTENCY_RESULT_UNAVAILABLE`。重送時另有一批回應同樣是未確定；完整的分類見下文「重送時的結果分類」。
- 財務命令：以**原來的**`eventId`及**原來的**內容重送。原HTTP key仍可用時沿用；框架回`IDEMPOTENCY_RESULT_UNAVAILABLE`或原key已不可用時，改用新的HTTP key，event不變。
- 重送的結果有四種：取回原結果；原交易其實未提交，這次執行並回新結果；該event留下拒絕的終態（回應帶`eventOutcome: "REJECTED"`，DES-004），即原命令確定沒有生效，其後也不會生效；或仍然未確定（下表第三至第五列）。在取得前三種明確結果之一之前，client不得產生新的event，也不得把該操作當作失敗。
- 匯出：尚未取得匯出ID時，以原來的`eventId`及原來的內容重送`POST /ap-exports/create`，必要時換HTTP key；已取得ID之後，以`GET /ap-exports/:id`查詢狀態資料（DES-020）。
- 期初文件：以原event重送確認；文件在此之前維持`PENDING`（DES-013）。
- 沒有另設查詢操作結果的介面；查回就是重送。

**重送時的結果分類**（client據此決定是否移除保存的intent，DES-031）。同一個回應在首次送出與重送時的意義不同：首次送出時，任何明確的拒絕都來自這一次請求，而該event沒有其他請求，所以確定沒有寫入；重送時，只有該event已commit的終態（成功，或DES-004的拒絕收口）才能說明原請求的結果。移除intent的依據是終態，不是錯誤代碼出現在哪一步。

| 回應 | 首次送出（這個intent從未有過未確定的嘗試） | 重送（曾有未確定的嘗試，包括由`sessionStorage`恢復的intent） |
| --- | --- | --- |
| 2xx | 明確成功，移除intent | 明確成功：原結果，或原交易未提交而這次執行的結果；移除intent |
| 帶`eventOutcome: "REJECTED"`的拒絕（任何業務拒絕代碼；拒絕收口已確定commit，包括其後讀回的保存的拒絕） | 明確拒絕，移除intent | 明確拒絕：這是該event的終態，原請求及任何遲到的請求都不會再執行；移除intent |
| 不帶`eventOutcome`的明確拒絕：claim之前的拒絕（`AP_INPUT_INVALID`、`AP_NOT_FOUND`、`IDEMPOTENCY_CONFLICT`、401、403、`PERMISSION_STALE`、429等）、只說明這次交易的拒絕（`CONCURRENT_OPERATION`、`AP_DEADLINE_INSUFFICIENT`、`AP_DEPENDENCY_UNAVAILABLE`） | 明確拒絕：這次請求確定沒有寫入，移除intent；再次提交是新的event | **未確定**，保留intent：這個回應只說明這一次請求或這一次的交易，該event沒有終態；原請求可能已提交，也可能其後才執行 |
| `AP_EVENT_CONFLICT` | 明確拒絕 | 異常，保留intent，不產生新的event（DES-031） |
| `AP_OUTCOME_UNKNOWN`、HTTP 504、其他沒有上列代碼的5xx（包括框架的`IDEMPOTENCY_STORE_FAILED`及`IDEMPOTENCY_CAPACITY_EXCEEDED`）、逾時、連線中斷、`IDEMPOTENCY_IN_PROGRESS`、`IDEMPOTENCY_RESULT_UNAVAILABLE` | 未確定，保留intent | 未確定，保留intent |

- 只憑錯誤代碼不足以在重送時移除intent。`AP_VERSION_CONFLICT`等業務拒絕即使必定在claim之後產生，業務交易rollback之後event列已不存在；沒有拒絕收口的終態，一個仍停在claim之前的原請求其後仍可執行。所以重送時必須見到`eventOutcome: "REJECTED"`或成功的結果。拒絕收口未能確認時伺服器回`AP_OUTCOME_UNKNOWN`（DES-004），屬上表最後一列。
- 不經DES-004的claim的寫入，其終態另有來源：建立匯出的終態是匯出記錄，重送得到記錄（任何狀態）即為明確結果；重送得到不帶記錄的明確拒絕時同樣移除intent，因為匯出不是財務命令，遲到的原請求最多多出一筆列在自己記錄頁的匯出。期初檔案的上傳及期初文件的重新開啟不保存intent（DES-034）。
- 未確定時以保存的`eventId`及內容重送。HTTP 5xx按代碼而不是按狀態碼分類：帶有`AP_DEADLINE_INSUFFICIENT`或`AP_DEPENDENCY_UNAVAILABLE`的503在首次送出時是明確的未寫入，沒有AP代碼的5xx一律未確定。
- 重送被歸入「未確定」而且持續不變的情況（例如操作者已被撤權），intent留在該分頁，該操作者拿不到原結果；這是DES-004的授權次序的結果，不是把原命令當作失敗。

### Rationale
FR-017、NFR-003、DES-004、DES-012、DES-020。代碼表集中列出，使畫面及測試有固定的對照。`AP_OUTCOME_UNKNOWN`的HTTP狀態與Purchasing的`TRANSACTION_OUTCOME_UNKNOWN`相同（500）。

### Failure behavior
未列入錯誤表的內部錯誤一律回通用的伺服器錯誤，不洩露細節，並記錄於應用日誌。錯誤回應本身不改變任何業務資料。

## DES-028 — Audit

### Decision
`ap_audit_logs`的欄位沿用`purchasing_audit_logs`（migration 0115）：`id`、`occurred_at`、`actor_user_id`（可空，外鍵`ON DELETE SET NULL`）、`actor_label`、`action`、`outcome`（`SUCCEEDED`、`REJECTED`、`FAILED`）、`target_type`、`target_id`、`supplier_id`（可空）、`target_label`、`reason`、`detail`（JSON，不超過8192位元組）、`request_id`、`correlation_id`、`ip`。索引：時間；Supplier＋時間；操作者＋時間；動作＋結果＋時間。trigger拒絕`UPDATE`及`DELETE`。

- **寫入時點**：成功的命令在業務交易內寫入`SUCCEEDED`，與業務效果一同commit。被拒絕的命令在確定rollback之後以附屬寫入記錄`REJECTED`（DES-004、DES-012）。結果不明時不寫入拒絕；其後查回為成功的，成功的記錄已在原交易內。`FAILED`用於確定失敗而非業務拒絕的情況（例如匯出產生失敗）。
- **記錄的動作**：設定及關帳日變更；發票、貸項、付款的建立、修改、取消、確認、作廢或沖銷；價格覆寫（收貨發票交付）；Credit Balance的應用及解除；核銷、解除及重新核銷；期初批次的上傳、文件確認、重新開啟及取消；匯出的建立及下載；檔案下載；列印。
- **`detail`的內容**以白名單決定：相關文件的ID及號碼、金額的前後值、Effect Date、狀態的前後值、被拒絕的錯誤代碼。不記錄完整銀行帳號（只記遮蔽值）、密碼、token或自由文字以外的請求內容。
- **查詢**：`/ap-audit-logs`以`ap.view`查看，可按時間、Supplier、操作者、動作及結果篩選，分頁同DES-016。
- **保留**：至少7年（DES-023）；沒有刪除的功能。
- 只寫Audit的記錄（列印、下載、匯出的建立）不取期間界線及帳戶列（T-11）。

### Rationale
FR-043、SEC-006、SEC-004。欄位與Purchasing一致，使兩個模組的Audit可用同一種方式查閱。成功的記錄與業務效果同一交易，落實「成功的財務操作不會沒有Audit」。

### Failure behavior
業務交易內的Audit寫入失敗時整個交易rollback，命令不算成功。附屬的Audit寫入（拒絕、列印、下載）失敗時記錄於應用日誌，不改變已確定的業務結果。

## DES-029 — 路由、頁面及選單（不含收貨發票）

### Decision
頁面放在`client/src/pages/ap/`，每個`.vue`以`export const page = { name, path, title, requires, menu }`宣告，由現有的頁面自動發現及驗證處理（`client/src/framework/discovery/`），不另寫路由表。路徑寫法與Purchasing相同：列表、`/new`、`/:id`、`/:id/edit`、`/:id/print`。

| 頁面 | 路徑 | 進入所需權限 | 選單 |
| --- | --- | --- | --- |
| 供應商發票列表 | `/ap/invoices` | `ap.view` | ✓ |
| 新增無PO發票 | `/ap/invoices/new` | `ap.view`＋`ap.invoice.mgmt` | |
| 發票詳情 | `/ap/invoices/:id` | `ap.view` | |
| 編輯發票Draft | `/ap/invoices/:id/edit` | `ap.view`＋`ap.invoice.mgmt` | |
| 貸項列表 | `/ap/credit-notes` | `ap.view` | ✓ |
| 由發票新增貸項 | `/ap/invoices/:invoiceId/credit-notes/new` | `ap.view`＋`ap.credit.mgmt` | |
| 貸項詳情 | `/ap/credit-notes/:id` | `ap.view` | |
| 編輯貸項Draft | `/ap/credit-notes/:id/edit` | `ap.view`＋`ap.credit.mgmt` | |
| 付款列表 | `/ap/payments` | `ap.view` | ✓ |
| 新增付款 | `/ap/payments/new` | `ap.view`＋`ap.payment.mgmt` | |
| 付款詳情（含核銷） | `/ap/payments/:id` | `ap.view` | |
| 編輯付款Draft | `/ap/payments/:id/edit` | `ap.view`＋`ap.payment.mgmt` | |
| 付款明細列印 | `/ap/payments/:id/print` | `ap.view` | |
| 供應商帳戶 | `/ap/supplier-accounts`、`/ap/supplier-accounts/:supplierId` | `ap.view` | ✓ |
| 未付及Aging | `/ap/aging` | `ap.view` | ✓ |
| 到期應付 | `/ap/due` | `ap.view` | ✓ |
| Supplier Statement | `/ap/statements` | `ap.view` | ✓ |
| Statement列印 | `/ap/statements/print` | `ap.view` | |
| 期初匯入列表、批次詳情 | `/ap/opening-imports`、`/ap/opening-imports/:id` | `ap.view`＋`ap.opening.import` | ✓ |
| 匯出記錄 | `/ap/exports` | `ap.view`＋`ap.export` | ✓ |
| Audit | `/ap/audit-logs` | `ap.view` | ✓ |
| 應付設定 | `/ap/settings` | `ap.view`＋`ap.settings` | ✓ |

- 選單需要一個新的群組（例如`accountsPayable`），在`client/config/menu.js`定義；頁面驗證會拒絕未定義的群組。這個檔案是共用檔案，修改須按模組邊界取得批准。
- 頁面的`requires`只決定入口是否顯示及可否進入，不是授權；每個API在後端重驗（DES-004、DES-021）。
- 待開票收貨清單及由收貨建立發票的頁面不在此表，待DES-014確認。
- URL及查詢參數不放事件識別、銀行資料或其他敏感內容。

### Rationale
FR-001～FR-045的畫面入口（收貨發票除外）、SEC-001、SEC-002。沿用`PurchaseOrdersPage.vue`等頁面的宣告方式，使AP不需要改動路由或頁面發現的框架。

### Failure behavior
無權限的使用者看不到選單項，直接輸入路徑時由現有的路由守衛擋下。頁面宣告不合規時，現有的頁面驗證在啟動時報錯。

## DES-030 — 列表及詳情頁的共同行為

### Decision
- **列表**使用`DataTable`並加`sticky-actions`；篩選、頁碼及排序保存在URL的查詢參數，重新整理或分享連結後得到同一結果（做法同`PurchaseOrdersPage.vue`）。自由文字或可能過長的欄位使用`EllipsisCell`。
- **金額**靠右顯示並帶Currency；不同Currency不相加，不顯示跨幣別合計。
- **狀態**以文字徽章顯示（文件狀態與結算狀態分開），不只靠顏色。
- **空白與錯誤分開**：沒有資料時顯示空白狀態；載入失敗時顯示錯誤及重試，不顯示空清單。
- **詳情**顯示文件內容及行、三個扣減額及未付額（或可用額）、相關的貸項、應用及核銷、狀態歷史，並連到該文件的Audit。供應商發票及付款的銀行資料只顯示遮蔽值。
- **動作按鈕**取伺服器回傳的`allowedActions`與操作者權限的交集；兩者都只是顯示用，命令在後端重驗。
- 離開頁面時中止未完成的請求（`useRequestAbort`）。

### Rationale
FR-033、FR-034、FR-044、SEC-004。`docs/frontend-design.md`§2、§3及§6的現有規範。

### Failure behavior
列表或詳情載入失敗不影響其他頁面。詳情所依賴的文件已不存在或無權查看時，顯示找不到。

## DES-031 — 命令的畫面流程

### Decision
- **一次操作一個event，送出前先保存**：使用者發起一個寫入命令（包括建立匯出及期初文件的確認；例外是期初檔案的上傳及期初文件的重新開啟，見DES-034）時，前端產生`eventId`及HTTP key，並在**第一次送出之前**把這次操作的intent寫入`sessionStorage`。寫入成功才送出。在取得明確結果之前，重試一律送出保存的內容及`eventId`；取得明確結果後才移除（明確結果的定義見DES-027「重送時的結果分類」）。
- **intent的內容**：格式版本、操作者的使用者ID、所屬位置、命令及其目標（類型及ID；建立類沒有ID）、`eventId`、HTTP key、送出的request body（含`expectedVersion`）及保存時間。body是DES-004內容hash所涵蓋的全部欄位，所以重送的內容與原來的逐字相同。
  - 不保存密碼、token及完整銀行帳號。密碼不屬於內容hash，也不屬於HTTP idempotency的指紋：它由`jwt-password`在認證階段從body的`password`欄位讀取（`passwordReauth.js:12,30`），AP的`idempotencyPreparation`所提供的input不含它（`IdempotencyService.js:172`）。付款選用的供應商銀行帳戶在body內只是該帳戶的ID；AP的表單沒有輸入完整帳號的欄位（DES-032）。
- **保存的位置及鍵**：`sessionStorage`，鍵為`ap.intent:<操作者ID>:<位置>`。同一位置在取得明確結果之前只有一個intent。
  - 在既有文件上的命令：位置是進行操作的詳情頁的文件（發票、貸項、付款、設定、期初批次）。例如解除核銷的API目標是核銷記錄，位置仍是該付款。
  - 建立類命令沒有文件ID：位置是命令本身，即「建立發票」「建立付款」「建立匯出」；由發票建立貸項的位置另帶原發票的ID。
  - 做法參照現有的`useSalesCommandEvent.js:8,68`及Fulfillment的面板（`FulfillmentCancelPanel.vue:10,20`），兩者都以操作者及文件作鍵。不同之處：Sales以操作查詢介面取回結果；AP沒有這個介面（T-15），恢復的方法是以原event重送。
- **保存失敗即不送出**：`sessionStorage`不可用、已滿或寫入拋錯時，命令不送出，畫面顯示「無法保存這次操作，請允許此分頁儲存後再試」，表單內容保留。不會出現「已送出但沒有保存」的命令。現有的Sales及Fulfillment採用同一做法。
- **進入頁面時先查intent**：每一個會發出寫入命令的頁面（詳情頁、建立頁、Draft的編輯頁、設定頁、期初批次頁及提供匯出按鈕的頁面）在顯示動作按鈕或可提交的表單之前，先讀取當前操作者在該位置的intent；操作者改變時重新讀取。同一文件的詳情頁及編輯頁是同一個位置。有intent時：
  - 顯示「上一次操作的結果未能確認」，並以唯讀方式列出保存的命令及內容（命令、目標、金額、Effect Date、原因）。
  - 只提供「重試查回」；該位置的其他動作按鈕停用，建立頁不提供空白表單，不產生新的event。
  - **重送由使用者按下才發出，不在恢復時自動送出**：沒有查詢介面，重送在原交易未提交時會執行該命令，而且可能距離第一次送出已有一段時間；所以先讓使用者看見將要送出的內容。
  - 文件本身照常以伺服器的現況顯示；現況不用來判定原命令的結果。
- **重送的請求**：保存的`eventId`及body不變。HTTP key先用保存的那一個：原請求若仍在執行，框架回`IDEMPOTENCY_IN_PROGRESS`（`IdempotencyService.js:256`），稍後以同一key再試；框架回`IDEMPOTENCY_RESULT_UNAVAILABLE`時改用新的HTTP key並寫回intent，event不變。寫回失敗不阻止這次重送：HTTP key只影響框架層的回放，命令的去重由event負責。重送之前先中止本頁仍在途的同一請求。
- **須重新認證的命令的重送**：原因及Effect Date取自保存的body並以唯讀顯示，`PasswordReasonDialog`只重新收集密碼。密碼錯誤、登入過期或權限被撤（401、403、`PERMISSION_STALE`）都發生在event claim之前（DES-004），不代表原交易沒有成功，intent保留。
- **操作者隔離**：鍵及intent內都有操作者ID，讀取時兩者都要等於當前登入者。另一名使用者在同一分頁登入時，前一人的intent不被讀取、不顯示，也不被刪除；原操作者在同一分頁再次登入後可繼續查回。登出不清除intent。
- **未確認的操作的提示**：AP各頁的頁首在當前操作者於本分頁有任何intent時，顯示提示及返回該位置的連結，使離開原頁面的使用者仍能找到它。
- **離頁**：離開頁面會中止在途的請求（DES-030），但中止不代表伺服器的交易已rollback；intent留在`sessionStorage`，回到該位置時按上文恢復。一般導覽、重新整理及未儲存變更的提示（DES-032）都不清除intent。
- **intent沒有年期**：保存時間只供顯示，不用來使intent失效。重送依靠`ap_operation_requests`內原event的記錄；這張表沒有清理功能（DES-023只清理私有檔案），所以原event的記錄不會在intent存在期間被移除。日後若為這張表加入清理，須同時為intent訂出不長於其保留期的年期。
- **讀不出的intent**：內容不是合法的JSON、格式版本不符、操作者或位置與鍵不符、`eventId`格式不合時，不送出任何請求，也不產生新的event；畫面提示先在文件詳情及Audit核對先前的操作，該位置在本分頁內維持停用。本設計不提供清除intent的按鈕。
- **保證的範圍**：涵蓋重新整理、同一分頁內的離頁及返回、同一分頁內重新登入。**不涵蓋**關閉分頁或瀏覽器、另一個分頁或裝置、清除瀏覽器資料；這些情況下原event無法取回，使用者只能從文件詳情、其應用及核銷的記錄及Audit（按操作者及時間）核對先前的命令是否已生效。此時沒有任何機制能找回原event。一次性的狀態轉換（確認、取消、作廢、沖銷、期初文件的確認）受鎖下的狀態檢查限制（DES-004、DES-013），不會生效兩次。核銷、重新核銷、Credit Balance的應用及建立類命令不是一次性的轉換：重新載入後以新的event再做一次，是另一筆合法的效果，可能與使用者的原意重複，伺服器不會把它識別為同一操作；新的版本或餘額也不能證明原命令有沒有生效。供應商發票另受發票號唯一鍵限制（T-06）。瀏覽器「複製分頁」會把intent一併複製，兩個分頁以同一event重送，得到同一結果。
- **確認類動作**（確認發票、貸項、付款；核銷；應用）先以`confirm`對話框說明影響。
- **須重新認證的動作**（作廢發票、作廢貸項、付款沖銷、推進關帳日、修改設定）第一次送出時使用`PasswordReasonDialog`收集原因、密碼及Effect Date。
- **版本衝突**（`AP_VERSION_CONFLICT`）提示重新載入，不自動覆蓋。
- **錯誤訊息**經`client/src/framework/http/errorMessages.js`的對照表顯示中文；DES-027的AP代碼須加入該表。這是共用檔案，修改須按模組邊界取得批准。
- 成功後重新載入詳情，不以前端計算的數額代替伺服器的結果。

紙上走查（恢復的身分、可用的按鈕、下一個請求）：

| 情況 | 恢復的原身分 | 可用的按鈕 | 下一個請求及結果 |
| --- | --- | --- | --- |
| 建立付款Draft，回應遺失後重新整理 | 位置「建立付款」的intent：event E、HTTP key H、原body | 只有「重試查回」；不提供空白表單 | `POST /ap-payments/create`帶E、H及原body。原交易已commit：取回原Draft（經HTTP回放或DES-004步驟3），轉到該付款的詳情；未commit：這次才建立，只有一張Draft。 |
| 核銷的結果不明，其後重新整理，或轉到另一文件再返回 | 位置是該付款的intent：E、H、原核銷內容及當時的`expectedVersion` | 只有「重試查回」；該付款的其他動作停用 | `POST /ap-payments/:id/allocate`帶E、H及原body，不使用重新載入後的版本。原交易已commit：步驟3回原結果，與現時的版本及餘額無關；未commit而文件其後已改變：`AP_VERSION_CONFLICT`並完成拒絕收口，回應帶`eventOutcome: "REJECTED"`，該event已終結，移除intent，使用者按現況以新的event另行操作。拒絕收口未能確認時伺服器回`AP_OUTCOME_UNKNOWN`，仍未確定，intent保留，可再按「重試查回」。 |
| 期初文件D的確認結果不明，離頁後返回 | 位置是該批次的intent：E、H及文件D | 只有文件D的「重試查回」；「繼續」及「取消批次」在本分頁停用 | 以E重送D的確認。已commit回原結果；已留下拒絕終態回該拒絕；沒有終態則這次執行。取得明確結果後才送出下一筆。 |
| 以原HTTP key重送，框架回`IDEMPOTENCY_RESULT_UNAVAILABLE` | 同一intent；HTTP key換成H2並寫回，E及body不變 | 同上 | 帶E、H2及原body重送，由步驟3取回原結果。 |
| 作廢發票的結果不明；重送時須重新認證，其間操作者可能已被撤權 | 位置是該發票的intent：E、H、原因、Effect Date及`expectedVersion`；沒有密碼 | 「重試查回」，按下後只要求輸入密碼 | `POST /ap-invoices/:id/void`帶E、H、原body及新輸入的密碼。密碼錯誤或登入過期：未確定，intent保留，可再試。已被撤權：403或`PERMISSION_STALE`，拿不到原結果（DES-004），intent保留，不當作原命令沒有成功。 |
| 另一名使用者在同一分頁登入 | 沒有：前一人的intent不被讀取 | 該使用者的正常按鈕 | 該使用者的操作是新的event，與前一人的intent無關。 |

### Rationale
FR-017、FR-019、FR-025、FR-032、SEC-005、DES-027。評審指出（AP-D8-R1）：文件的現況不是某一個命令的結果，event只放在記憶體時，重新整理後無法以原event查回，建立、核銷及期初確認尤其如此。intent在送出前保存，使「結果不明時不產生新event」在重新整理及離頁後仍然成立；採用`sessionStorage`是因為現有的Sales及Fulfillment已是這個做法，而且它以分頁為範圍，不需要處理多個分頁之間的協調。不新增背景工作、佇列或查詢介面。

### Failure behavior
- 明確被拒絕時顯示原因並移除intent；使用者修正後重新發起即為新的操作及新的event。
- 結果未確定時不移除intent，也不允許在該位置以新的event重做。
- 保存intent失敗時不送出命令（見上）。
- 取得明確結果後移除intent失敗：照常顯示結果，並提示未能清除本分頁的操作記錄。該記錄其後若被恢復及重送，結果由伺服器上該event的終態決定，不取決於這個記錄有沒有被清除：已成功的回原結果；已有拒絕終態的回同一個拒絕，不會執行。只有首次送出時不帶`eventOutcome`的拒絕沒有終態（claim之前的拒絕，或`CONCURRENT_OPERATION`等只說明該次交易的拒絕）；其後的重送等同以保存的內容再提交一次，畫面在重送前已列出這些內容，並說明重送可能執行該命令。
- 重送原event而伺服器回`AP_EVENT_CONFLICT`：保存的內容與伺服器記錄的不一致，屬異常。不移除intent、不產生新的event，提示在文件詳情及Audit核對。
- 遲到的原請求：重送被業務拒絕時，伺服器以拒絕收口為該event留下終態（DES-004），其後才到達的原請求只會讀回這個拒絕。拒絕收口未能確認時回`AP_OUTCOME_UNKNOWN`，client保留intent。因此不會出現「intent已移除而原event仍可執行」的情況。中止在途的請求及`IDEMPOTENCY_IN_PROGRESS`只減少無謂的並行，不是這個保證的依據。

## DES-032 — 發票、貸項及付款的表單與核銷

### Decision
- 表單使用`FormPanel`：提交失敗時顯示錯誤總覽並把焦點移到總覽，欄位錯誤連到對應欄位。
- **無PO發票**：Supplier（只可選Active）、Currency、供應商發票號、發票日期、Effect Date、到期日、原因、費用行（描述、金額）。畫面同時顯示行金額合計與使用者輸入的發票總額及兩者差額；差額不為零時不可確認（FR-013）。儲存Draft與確認是兩個分開的動作。
- **貸項**：由發票詳情進入，只列出該發票的行；逐行輸入沖減金額，畫面顯示該行尚可沖減的金額、預計的原發票沖減額及可能發行的Credit Balance。這些數字只供參考，以伺服器確認時的結果為準。
- **付款**：Supplier、Currency、付款日期、Effect Date、金額、付款方式；按方式顯示必要欄位（交易參考、支票號或說明）。操作者具`supplier.bank.view`時可選用該Supplier的有效銀行帳戶，清單只顯示遮蔽值；沒有該權限時不顯示這個欄位。
- **核銷**在付款詳情進行：列出同一Supplier及Currency、仍有未付額的發票，按到期日排列，可按到期日建議分配，但不自動儲存；始終顯示付款的已核銷額及可用額。重新核銷以一次提交完整的移除及新增。一次提交的項目數量受上限限制（DES-012），超出時在提交前提示。
- **Credit Balance的應用**在貸項詳情進行，方式同核銷。
- **Effect Date早於今日時**顯示提示：補記可能因歷史餘額不成立而被拒絕（`AP_HISTORY_BALANCE_VIOLATION`）。
- **未儲存的變更**：離開表單前提示。除了離開路由之外，同一頁面只換路徑參數（例如由一張Draft直接跳到另一張）時同樣要提示，並處理`beforeunload`。這個提示只涉及尚未送出的表單內容：使用者選擇離開時放棄的是這些內容；已送出而未確認結果的intent不受影響，也不因離開而被清除（DES-031）。
- 金額以字串輸入及送出，前端只做格式及小數位的初步檢查；計算及上限以伺服器為準。

### Rationale
FR-008、FR-012～FR-015、FR-021～FR-024、FR-026、FR-027、FR-029～FR-031。未儲存變更的提示須涵蓋路徑參數改變，因為只處理離開路由的守衛在這種情況下不會觸發。

### Failure behavior
伺服器的驗證錯誤按欄位顯示；上限或數額衝突（`AP_AMOUNT_EXCEEDED`）時重新載入最新數額並保留使用者的輸入供修正。

## DES-033 — 帳戶、報表、列印、匯出及Audit的畫面

### Decision
- **供應商帳戶、Aging、到期應付、Statement**：As-of日期或期間顯著顯示；每個Currency各自一個分頁或區塊，不顯示跨幣別合計；每一列可連到對應的文件。超出上限（`AP_LIMIT_EXCEEDED`）時提示以Supplier、Currency或期間縮窄。
- **列印**：付款明細及Statement各有列印頁，做法同`PurchaseOrderPrintPage.vue`：沒有選單項、A4樣式、由瀏覽器列印另存PDF。已作廢或已沖銷的文件有明顯標示。
- **Statement的日期**：畫面有起日及截止日兩個欄位，As-of日期就是截止日。起日預填為本月第一日、截止日預填為今日，兩者都可修改，並顯示在結果的標題；使用者按下查詢才送出，請求一律帶這兩個明確的日期。預填只是畫面的初始值，不是伺服器的預設；列印及匯出使用同一組日期。輸出不因日期的給法而減少：期初（起日前一日）、期內交易、期末及截止日的Aging摘要全部按DES-018提供。DES-018所說的「單一As-of日期」在畫面上即只修改截止日，起日沿用欄位當時的值。
- **匯出**：在報表及列表頁提供匯出按鈕，建立匯出後轉到匯出記錄頁。匯出記錄頁以`GET /ap-exports`取得自己建立的匯出（DES-026），顯示狀態（處理中、已完成、失敗）、列數及到期時間；只有已完成而未到期的可下載。「只列出自己的」由伺服器的查詢條件決定，不是前端從全部記錄中過濾。
- **匯出建立的回應不明**：建立匯出同樣按DES-031在送出前保存intent（位置「建立匯出」）。回應不明時，以原`eventId`及原內容重送建立請求取回該記錄，不另建一筆匯出（DES-020、DES-027）。匯出記錄頁的列表只供查看，不取代以原請求鍵查回：列表上出現一筆相似的匯出，不代表它就是這次請求的結果。
- **Audit**：按時間、Supplier、操作者、動作及結果篩選的列表；`detail`以純文字顯示。

### Rationale
FR-034～FR-037、FR-041～FR-043。畫面、列印及匯出使用伺服器的同一個計算結果（DES-017、DES-018），前端不另行計算。

### Failure behavior
報表載入失敗時顯示錯誤，不顯示零或空白的結果。下載已到期或已失敗的匯出時顯示對應訊息。

## DES-034 — 期初匯入的畫面

### Decision
- **上傳**：選擇CSV檔，提交後顯示預檢結果：每筆記錄的類型、Supplier、來源識別、金額及預檢錯誤（行號及欄位）。檔案不合規時整個被拒絕並顯示原因。
- **確認**：前端逐筆送出，一次只送一個請求（DES-013的一個請求一個文件）；畫面顯示進度及伺服器回傳的摘要（確定成功、確定未入帳、尚未處理或待查明，三類分列，DES-013）。使用者可暫停，其後繼續。只有`PENDING`的文件會被送出。
- **每一筆的intent**：送出一個文件的確認之前，先按DES-031保存intent，位置是該批次；因為一次只送一個請求，一個批次在一個分頁內最多只有一個未確認的intent。保存失敗即不送出，並停止逐筆送出。
- **結果不明**：停止逐筆送出，對該筆以原event重試查回；取得明確結果後才繼續下一筆。
- **回到頁面時**：先讀取該批次的intent。有intent時，畫面指出是哪一個文件的結果未能確認，只提供該文件的「重試查回」；「繼續」及「取消批次」在本分頁停用，直至取得明確結果。`PENDING`同時包含從未送出及已送出而待查明的文件（DES-013），所以不能只憑`PENDING`就為該文件產生新的event。
- **沒有intent的`PENDING`文件**（例如原分頁已關閉）：可以新的event確認。這依靠伺服器的檢查而不是畫面的判斷：確認在批次文件的鎖下驗證仍是`PENDING`，來源列在財務效果之前仲裁（DES-013）；先前的確認若已commit，新的event得到`AP_STATE_CONFLICT`，重新載入後顯示`SUCCEEDED`，不會有第二筆財務效果。這是期初文件的確認這一個命令的特定保護（同一份不可變的文件內容），不是找回了原event，也不適用於付款的建立或核銷。沒有intent不是修改內容、重新開啟已取消的文件或把來源當作未入帳的理由；原結果已成功或來源已有相同內容時，畫面顯示伺服器的文件及來源結果。
- **被拒絕的記錄**：顯示原因。只有`REJECTED`的文件可以「重新處理」（先重新開啟為`PENDING`，再確認；這是兩個請求：重新開啟不claim event，其後的確認使用新的event，原先被拒絕的event已是終態，不能重用）。`INVALID`的文件不能確認，也不能重新開啟，只能在新批次以修正後的內容上傳。
- **重新開啟不保存intent**：重新開啟是對批次文件狀態的條件更新（只把`REJECTED`改為`PENDING`），不claim event，也沒有財務效果。結果不明時重新載入該文件：已是`PENDING`即已生效，仍是`REJECTED`可再按一次。遲到的原請求最多把一個`REJECTED`的文件改為`PENDING`，不影響已成功或已取消的文件。
- **取消批次**：只把`PENDING`的文件標為已取消；已成功、已由先前批次入帳、被拒絕及預檢不通過的文件不受影響。
- **上傳的結果不明**：上傳的內容是檔案，不保存intent。回應遺失時，先在批次列表核對是否已出現該批次，再決定是否重新上傳；列表只供核對，一個相似的批次不代表就是原上傳的結果。重複上傳只會多出一個仍在預檢狀態的批次（其文件可以是`PENDING`、`INVALID`或已由先前批次入帳），沒有財務效果，同一來源也不會入帳兩次（DES-013）；多出的批次須取消，否則會阻擋推進關帳日。
- **下載**來源檔及結果檔：只對批次的建立者顯示。
- 批次列表顯示每個批次的摘要及是否完成；未完成指仍有`PENDING`的文件，不是指有文件沒有成功。未完成的批次會阻擋推進關帳日，設定頁在被阻擋時列出這些批次。

### Rationale
FR-038～FR-040、DES-013。逐筆送出並由伺服器回傳摘要，使畫面顯示的數字與伺服器一致，不由前端累計。

### Failure behavior
離開頁面即停止送出：從未送出的文件維持`PENDING`，回到頁面可繼續；離開時正在送出的那一筆結果未確定，其intent保留，回到頁面須先以原event查回，才可繼續其他文件。任何一筆被明確拒絕不影響其他記錄。

## DES-035 — 無障礙、回應式、文案及共用檔案的改動

### Decision
- 遵循`docs/frontend-design.md`：頁面結構（§2.2）、`DataTable`／`EllipsisCell`／`FormPanel`／`PageHeader`／`PasswordReasonDialog`／`notify`（§3）、無障礙（§6）、回應式（§7）、繁體中文及錯誤訊息對照（§9）、新頁面檢查清單（§10）。不新增第二套表格、對話框或HTTP client。
- 回應式以375、768、1024及1440像素檢查；窄畫面時表格可橫向捲動並固定操作欄，但金額、Currency、狀態及到期日不可被隱藏。
- 供應商名稱、發票號、描述、原因及備註一律以文字插值顯示，不使用未消毒的HTML（DES-022）。
- AP需要改動的共用檔案只有三處，均須按模組邊界取得批准：`client/config/menu.js`（新增選單群組）、`client/src/framework/http/errorMessages.js`（新增AP錯誤代碼的中文訊息）、伺服器的權限目錄（DES-026）。
- 畫面的實際驗證（Playwright）屬實作及測試階段；把任何測試加入例行CI須按AGENTS.md事先取得Sam批准，不在本設計內。

### Rationale
SEC-004、SEC-007、NFR-002。沿用現有的元件及規範，是為了不增加另一套要維護的介面寫法。

### Failure behavior
N/A：本項是規範及改動清單；不合規的頁面在檢查清單及評審中處理。

## Detailed cross-cutting design

DES-001～DES-035只涵蓋下列部分；其餘在其後的交付補上。

| 範疇 | 本交付的內容 |
| --- | --- |
| 授權 | 每個命令在交易內當時驗權，並在HTTP回放前再驗（DES-004）。權限名稱沿用需求的建議值，定案及權限目錄的修改留待其後。 |
| 重新認證 | 作廢、沖銷、關帳日變更使用現有的`jwt-password`認證。 |
| Audit | 成功的命令在同一交易寫入；被拒絕的命令在rollback之後寫入（DES-004）。欄位細節留待其後。 |
| 驗證及錯誤 | 本文使用的錯誤名稱（`AP_EVENT_CONFLICT`、`AP_OUTCOME_UNKNOWN`）是暫定；完整錯誤碼表留待API交付。 |
| 性能及容量 | 沒有採用任何未確認的數字。上限以具名參數表示（DES-012）。性能及容量驗證按AGENTS.md在功能完成UAT後另行批准。 |
| 備份及復原 | 無AP專屬設計；AP的表及私有檔案隨系統備份。復原目標是否適用於AP待核對（OI-008）。 |
| 對賬 | 以ledger重算文件數額及帳戶列並比較，只報告（DES-007）。排程及報告形式留待其後。 |
| 查詢及報表 | 列表、詳情、As-of、Aging及Statement的計算口徑（DES-016～DES-018）；SQL及索引留待其後。 |
| 檔案 | 匯出檔、期初檔的私有保存、下載授權及清理（DES-020、DES-021、DES-023）。 |
| 輸入輸出的安全 | schema驗證、純文字呈現、CSV處理及上傳檢查（DES-022）。 |
| 資料及migration | 表的欄位、鍵及約束（DES-024）；六個分片，序號在實作時決定（DES-025）。 |
| API及錯誤 | 路徑、動作及權限（DES-026）；錯誤代碼及結果不明的查回（DES-027）。請求及回應的欄位schema留待其後。 |
| Audit | 欄位、寫入時點、動作及內容白名單（DES-028）。 |
| 畫面 | 路由及選單、列表及詳情、命令流程、表單及核銷、報表及檔案、期初匯入、無障礙及回應式（DES-029～DES-035）。各頁面的欄位清單及版面稿留待其後。 |
| 部署、回滾、可觀察性、收貨發票 | 尚未涵蓋。 |

## Assumptions, open issues and human decisions

### 本設計作出、需要評審確認的技術選擇

| ID | 選擇 | 替代做法 |
| --- | --- | --- |
| T-01 | 與關帳有關的AP業務寫入都取得期間界線的共享鎖：產生財務效果的命令、Draft的建立及修改、期初來源及批次狀態的寫入（含重新開啟、拒絕及取消）。只寫Audit、匯出記錄及檔案清除標記的寫入不在此列（T-11）。 | 只有產生Effect的命令取得；則推進關帳日時對Draft的檢查只是提示。 |
| T-02 | 以帳戶列作為同一Supplier＋Currency內的序列化點。 | 只鎖文件根列；須逐命令證明不會倒序。 |
| T-03 | AP自備金額工具（DES-002做法a）。 | 與Purchasing共用。 |
| T-04 | 期初匯入一個請求確認一個文件；以來源列作仲裁，來源結果與批次文件分開。 | 一個請求帶固定的文件集合及逐文件event。 |
| T-05 | 以「一筆付款的有效核銷數量上限」界定付款沖銷的工作量。 | 無上限而依賴時限；評審已指出不可拆分沖銷。 |
| T-06 | 供應商發票號的唯一性以資料庫唯一鍵保證。 | 應用層檢查。 |
| T-07 | `ap_operation_requests`以`event_id`單獨作唯一鍵。 | 沿用Purchasing以來源文件＋event為鍵；則同一event換目標不會衝突。 |
| T-08 | 每個涉及Supplier的AP命令先取Supplier列的鎖。 | 只在需要驗證Supplier時取得；會與Supplier的封存次序相反。 |
| T-09 | 發票根列保存有效貸項的數目，作廢時檢查。 | 作廢時以鎖定讀取查詢其貸項。 |
| T-10 | 歷史As-of由ledger事件即時加總，跨Supplier時設發票數量上限（DES-017）。 | 定期保存餘額快照；增加一張表及其維護。 |
| T-11 | 匯出、列印的Audit及檔案清理不是業務寫入，不取期間界線及帳戶列（DES-019、DES-020、DES-023）。 | 一律取期間界線；會令唯讀操作與關帳互相等待。 |
| T-12 | 匯出沿用Customer匯出的次序，在請求內同步完成（DES-020）。 | 背景工作；已按A-008排除。 |
| T-13 | 期初預付款是`OPENING`類型的付款，期初Credit Balance是沒有原發票的`OPENING`類型貸項（DES-024）。 | 另設期初餘額的表；會令核銷及應用多一種來源。 |
| T-14 | 匯出的狀態資料與完成結果分為兩個路徑（DES-026）。 | 單一路徑；查回處理中或失敗的狀態時會被「須已完成」的條件擋住。 |
| T-15 | 不另設查詢操作結果的介面，結果不明時以原event重送（DES-027）。 | 另設查詢介面；多一個要授權及維護的入口。 |
| T-16 | 前端在第一次送出之前把命令的intent（原event、HTTP key、原內容及版本）保存到`sessionStorage`，按操作者隔離、以分頁為範圍；保存失敗即不送出；重新整理或離頁後由使用者以原event重送（DES-031）。不保存密碼、token及完整銀行帳號。 | 只放在記憶體：評審指出文件的現況不能代替遺失的event（AP-D8-R1）。`localStorage`：可跨分頁及關閉分頁後保留，但須處理多分頁協調及登出後殘留在共用電腦的內容。伺服器的操作查詢介面：T-15已排除。 |
| T-17 | AP在自己的目錄備有自己的composable（DES-031）。它與Purchasing的`useCommandEvent`不同：保存intent，並採用DES-027的結果分類；保存及按操作者作鍵的做法參照`useSalesCommandEvent.js`及Fulfillment的面板，不修改這些檔案。 | 把現有的composable移到共用位置並擴充；要改其他模組的檔案。 |
| T-18 | 期初匯入由前端逐筆送出、一次一個請求，摘要以伺服器回傳為準（DES-034）。 | 前端並行送出或自行累計；與DES-013的一個請求一個文件及摘要口徑不符。 |
| T-19 | Statement的請求一律帶起日及截止日，As-of日期即截止日；伺服器不設預設，畫面預填本月第一日至今日，使用者可改；輸出維持DES-018的完整內容（DES-026、DES-033）。 | 伺服器在沒有起日時自行推定期間：會加入一條需求沒有訂明的規則。只給As-of時減少輸出：會刪減FR-036的輸出，不採用。 |
| T-21 | claim之後的業務拒絕，在業務交易rollback後以附屬交易為該event寫入拒絕的終態（DES-004的拒絕收口）；client重送時只憑終態移除intent（DES-027）。 | 拒絕不留記錄：遲到的原請求仍可執行，client只能一直保留intent，使用者無法修正後繼續。在同一交易內撤回業務變更而保留claim：須逐個命令證明沒有殘留的財務效果。 |
| T-20 | 匯出記錄的列表由伺服器按建立者查詢（DES-026）。 | 前端取回後過濾；會把別人的記錄送到瀏覽器。 |

### 評審記錄

第一版（blob `86ceb829…`）的非作者評審：`.worktrees/tl-ap-review-20261117/AP-design-d1-source-review.md`，sha256 `64cca418bdf42e429ddaf5b5066dca6fc54d895004b0c0f4e40fdee0634144fb`，六項Required。本版的修訂：

| Required | 內容 | 修訂位置 |
| --- | --- | --- |
| AP-D1 | 三個扣減額為零不代表沒有有效貸項；貸項確認須重驗原發票 | DES-005（發票根列）、DES-008、DES-009 |
| AP-D2 | event唯一鍵不能實現跨命令及目標的衝突 | DES-004步驟3及結果表 |
| AP-D3 | 期初來源的嘗試互斥及跨批次完成 | DES-013、DES-001、DES-005鎖表 |
| AP-D4 | Supplier外鍵的隱含鎖與下游檢查的次序 | DES-005步3b及兩個時序、DES-015第2項、DES-014 |
| AP-D5 | 交易時限短於請求時限不保證先取得結果 | DES-012 |
| AP-D6 | 金額工具須區分無號及有號 | DES-002 |

第二版（blob `6cc157fe…`）的窄覆核：`AP-design-d2-source-review.md`，sha256 `f3ae52e9821bad5b3074fc0b1c4b149b03fc66685e35bb4c65aee08a24d23f88`。AP-D1、D2、D4、D5、D6在設計層面關閉；AP-D3的來源仲裁及跨批次完成獲接受，剩下批次摘要分類一項（MEDIUM）。本版就該項的修訂：

- DES-013：只有`PENDING`可確認，重試`REJECTED`須先重新開啟；摘要三類的對應及`CANCELLED`的歸類；兩個紙上例；來源鎖的保證範圍限縮為已進入仲裁的嘗試；附屬寫入的共同約束。
- DES-012：「財務效果不跨交易」；附屬寫入只在確定rollback後進行；上傳的解析與保存分開說明。
- DES-005：鎖表加入重新開啟及取消批次。

第三版（blob `7e601d6b…`）的收口：`AP-design-d3-source-closeout.md`，sha256 `a12124295950d80d8459db3f96ebb413e76f30a31cebf88796d1b43074e525c4`。AP-D3關閉；DES-001～DES-015的六項Required在設計層面全部關閉。收口報告要求保留的解讀（`PENDING`在文件鎖下驗證、成功的event先回放、`PENDING`不是租約）已寫入DES-013。

這個接受只綁定被覆核的內容，不是完整AP設計、實作或任何測試的接受。

第二個交付（DES-016～DES-023，blob `ed5e8c93…`，commit `767e88a6`）的非作者評審：`AP-design-d4-source-review.md`，三項Required。本版的修訂：

| Required | 內容 | 修訂位置 |
| --- | --- | --- |
| AP-D4-R1（HIGH） | 補記只驗目前的數額，可令歷史日期的發票未付額及付款可用額為負 | DES-007新增「歷史餘額檢查」及走查；DES-017；DES-012加入`maxBackdatedCheckEvents` |
| AP-D4-R2（HIGH） | `ap.export`不等於資料查看權；下載須重驗 | DES-020「授權」及四個情況；DES-021 |
| AP-D4-R3（MEDIUM） | 匯出完成的提交也可能結果不明；不能保證逾時即未完成 | DES-020「時限及結果不明」及結果表；DES-023的清理條件；DES-012加入`exportAbandonAfterMs` |

另按報告的非Required意見：DES-018寫明Statement各部分使用同一個讀取交易；CSV的處理保留前置空白及引號轉義；T-01限定為與關帳有關的業務寫入。

補記的處理採用保留合法補記的做法，沒有禁止Effect Date早於其他事件，因此沒有收緊業務規則。

上述修訂（blob `109e2433…`）的窄覆核：`AP-design-d5-source-review.md`，sha256 `7a5071c967f5c91769e4aee58a08122772e1100b57b3d9b7f85f1b1a843fcf6b`。AP-D4-R1、R2在設計層面關閉；R3只剩清理與晚到的完成及檔案寫入之間的仲裁。本版就該項的修訂：

- DES-020：檔案位置由匯出記錄推導；完成與清理在匯出記錄上仲裁（完成只可由`PROCESSING`轉移，`FAILED`不得復活，雙方檢查更新結果，結果不明不刪檔）；`exportAbandonAfterMs`只挑選候選；三個交錯（完成先贏、清理先贏、檔案寫入晚到）。
- DES-023：清理以實際存在的檔案為準，每次重新檢查；「檔案已清除」只供顯示，不用來略過。

上述修訂（blob `5144afcb…`）的收口：`AP-design-d6-source-closeout.md`，sha256 `a54c39ea94f90c68d0e7384a613c9721ee02c6dd6609133f5ed84dcc0cbc8b59`。R3關閉；DES-016～DES-023的三項Required在設計層面全部關閉。收口報告要求保留的解讀已寫入DES-020及DES-023：更新成功指交易已確定commit；放棄的仲裁以記錄為對象、不取決於是否已有檔案；先刪暫存檔不是晚到寫入已停止的證明。私有儲存的現成介面（特別是列出目錄）未核對，留待實作時核對，本設計不聲稱已有AP的儲存接線。

`maxBackdatedCheckEvents`的數值及其對可接受補記的影響仍待owner提出、有業務影響的交Sam確認。這些接受只綁定被覆核的內容，不是實作或任何測試的接受。

第三個交付（DES-024～DES-028，blob `8ef94e64…`，commit `1474fa0d`）的非作者評審：`AP-design-d7-source-review.md`，sha256 `ac199deb06856aba4fa42b8969987676bfa17877998afd6707c57c2da92f074a`。兩項Required；T-13的期初資料形狀獲接受，視為已批准需求的技術實現。本版的修訂：

| Required | 內容 | 修訂位置 |
| --- | --- | --- |
| AP-D7-R1（MEDIUM） | 貸項行的複合外鍵與父表唯一鍵的欄位次序不一致 | DES-024：外鍵改為（`invoice_id`,`invoice_line_id`）指向`ap_invoice_lines(invoice_id,id)` |
| AP-D7-R2（MEDIUM） | 未取得匯出ID時，原請求鍵沒有可達的查回路徑 | DES-020「請求鍵及重送」及四步走查；DES-024的`request_key`及`request_hash`；DES-026；DES-027；DES-033 |

另按報告的非Required意見寫入：期初類型的界線及按狀態表達的`CHECK`（DES-024）；ledger的外鍵與分片次序、trigger的重跑（DES-025）；整張付款沖銷不可拆分（DES-027）。上述兩項修訂（blob `30eb30f1…`）的窄覆核見下一份報告的附錄：AP-D7-R1、AP-D7-R2在設計層面關閉。

第四個交付（DES-029～DES-035，blob `6b0ae9ec…`）的非作者評審：`AP-design-d8-source-review.md`，sha256 `6e47ca951dd31bb7c42df7260e2e59e888748e999f06fa9b465c0f5b52d5d055`（含上述窄覆核的附錄）。一項Required；路由及選單、權限矩陣、未儲存變更、期初的狀態及摘要、報表及列印、共用檔案的改動等方向獲接受。本版的修訂：

| Required | 內容 | 修訂位置 |
| --- | --- | --- |
| AP-D8-R1（HIGH） | event只在記憶體，重新整理或離頁後遺失；文件的現況不能識別原命令的結果，建立、核銷及期初確認尤其如此 | DES-031：送出前保存intent、保存失敗不送出、恢復後由使用者以原event重送、操作者隔離、不保存密碼／token／完整銀行帳號、保證的範圍及六個走查；DES-027「重送時的結果分類」；DES-032；DES-034；T-16、T-17 |

另按報告的小幅對齊：匯出記錄的列表介面，由伺服器按建立者查詢，不取代以請求鍵查回（DES-026、DES-033、T-20）；Statement的日期預設（DES-026、DES-033、T-19）；期初畫面的按鈕與狀態對齊，只有`REJECTED`可重新開啟、取消只改`PENDING`、未完成指仍有`PENDING`（DES-034）。

本版沒有新增背景工作、佇列或查詢介面，也沒有放寬當時驗權。DES-027已獲接受的文字有以下改動，都是為了與首次送出及重送的區分一致：表頭註明「Client的處理」一欄是首次送出時的處理；`AP_DEADLINE_INSUFFICIENT`及`CONCURRENT_OPERATION`兩格的「沿用原event」改為按結果分類決定；`CONCURRENT_OPERATION`的意義一格加上「這次的」三字；「一律視為結果不明」的清單補上沒有AP代碼的5xx、逾時及`IDEMPOTENCY_IN_PROGRESS`；「重送的結果只有三種」改為四種，加入「仍然未確定」。錯誤代碼及HTTP狀態沒有改變。上述修訂（blob `ac673d66…`）的窄覆核：`AP-design-d10-source-review.md`，sha256 `d828ae883331603fb9c55942d87cb6ed099a5ca035d61b42aa525685d1b0a40a`。送出前保存、保存失敗不送出、同操作者及位置恢復、人工重送、操作者隔離、不保存敏感資料、同分頁的保證範圍、匯出列表及Statement的可修改預填獲接受。AP-D8-R1仍未關閉，另有一項Statement的更正。本版的修訂：

| 項目 | 內容 | 修訂位置 |
| --- | --- | --- |
| AP-D8-R1（HIGH，餘下部分） | claim之後被拒絕並rollback不留event，遲到的原請求仍可執行；不能憑錯誤代碼移除intent | DES-004：拒絕收口（為event留下拒絕的終態）及三個交錯；DES-024的`result_summary`；DES-027：移除intent以終態為依據，回應的`eventOutcome`；DES-031：走查、移除失敗及遲到原請求的處理；DES-013；T-21 |
| 失去event後的保證範圍 | 核銷、應用及建立不是一次性的轉換，不能說靠狀態及版本便不會重複 | DES-031「保證的範圍」 |
| 期初及上傳的文字 | 沒有intent時以新event確認是該命令的特定保護；重複上傳的批次是「仍在預檢狀態」 | DES-034 |
| Statement | 只給As-of時刪去期初及期內交易不是既定需求的解讀 | DES-026、DES-033、T-19：請求一律帶起日及截止日，輸出維持DES-018的完整內容 |

DES-004已獲接受的「被拒絕的命令不留operation列」因此有一個例外：claim之後的業務拒絕留下拒絕的終態。成功的重送、當時驗權、身分及內容的比較、原請求的時限都沒有改變；沒有新增背景工作、佇列或查詢介面。

上述修訂（blob `0ce03ad8…`）的收口：`AP-design-d11-source-closeout.md`，sha256 `b96be665dd318938fb0321ab59555461b355d6ad8d5659661dc302ede19d7018`。AP-D8-R1及Statement的對齊在設計契約層面關閉，沒有新增Required；DES-029～DES-035的Required全部關閉。收口報告列出三處例行的文字對齊，本版已寫入，語義不變：

- DES-012：「沒有財務效果」只指這一次已rollback的業務交易，不指整個event。
- DES-027：`AP_OUTCOME_UNKNOWN`的意義是尚未確認該event的終態，包括拒絕收口未能確認；HTTP狀態不變。
- DES-034：重新開啟不claim event；「重新處理」是兩個請求，只有其後的確認使用新的event。

另按報告要求保留的解讀，在DES-004拒絕收口的第4步寫明：回既有終態時不另寫Audit或改動文件，並在唯一鍵等待之後以鎖定讀取讀出現況。

這個接受只綁定被覆核的內容：是設計的窄審，不是畫面的驗收；瀏覽器的保存及恢復、真實資料庫的鎖競爭都沒有實測。整份AP設計仍未完成，不授權實作、新的CI案例或非功能驗證。

### 未定數值

- DES-012的全部上限。
- 每月Supplier Invoice及付款筆數（OI-001）、回應時間（OI-007）、復原目標（OI-008）。

### 待確認的契約

- DES-014的九項（Purchasing）。
- DES-015的五項（Supplier、Business Master）。

### 未驗證

- 本設計只對照了文中引用的來源檔案；沒有執行任何程式、測試或資料庫操作。
- route授權是否讀取資料庫現況沒有核實；DES-004因此不依賴它。
- `FOR SHARE`鎖定讀取在REPEATABLE READ下讀到最新已提交資料，是MySQL的既定行為，沒有在本專案內實測。
- DES-007的走查是紙上算術，不是測試結果。
- DES-031的保存及恢復是紙上設計：`sessionStorage`在各瀏覽器的配額、私密模式及複製分頁的行為沒有實測；現有Sales及Fulfillment的同類做法只閱讀了來源，沒有執行。
- 密碼不計入HTTP idempotency指紋，是按`IdempotencyService.js:157–176,202–216`及`passwordReauth.js`的來源閱讀得出的，以AP的`idempotencyPreparation`不把密碼放入input為前提；沒有執行。
- 失敗的請求會釋放HTTP key、讓重試重新執行（`IdempotencyService.js:330–338`），所以HTTP層不保存拒絕；拒絕的終態由DES-004的拒絕收口保存。其三個交錯是紙上推演，沒有執行。
- 拒絕收口及回應的`eventOutcome`欄位是對實作的要求，尚無程式可核對。
- DES-020不以時間推定原請求、其交易或其檔案寫入已經結束；`exportAbandonAfterMs`只挑選候選，數值待定。完成與清理的三個交錯是紙上推演，沒有執行。
- DES-020及DES-023假設私有儲存支援「不存在才建立」的開啟、改名及刪除，並可列出目錄內的檔案；前三項是Customer匯出現用的操作（`CustomerImportStorage.js:80–92,127–163`），列出目錄是否已有現成的做法沒有核對。
