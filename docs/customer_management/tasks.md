# Customer Management 開發任務分解

## 0. 文件資訊

| 項目 | 內容 |
| --- | --- |
| 文件版本 | 0.1 Draft |
| 文件日期 | 2026-09-07 |
| Requirement | `docs/customer_management/requirement.md` 0.1 Draft |
| Design | `docs/customer_management/design_spec.md` 0.1 Draft |
| 任務狀態 | 尚未開始；待人工review／批准後執行 |
| Task list target | 本文件；不另建`tasks/plan.md`或`tasks/todo.md` |
| 技術基線 | Node.js 26、Express 5、MySQL 5.7、Vue 3、Quasar 2、Pinia |

本文件把`CUS-CAP-00～05`拆成49個可分派、可驗證的XS／S／M任務。每項限定單一主要成果，包含需求追溯、驗收、驗證、依賴及主要檔案；不得把多個任務合成難以review的XL change，也不得只完成程式而省略測試與文件同步。

---

## 1. 執行策略

### 1.1 交付原則

- 嚴格使用獨立worktree及`codex/`feature branch；不得在local main直接工作。
- 先凍結migration分配及shared foundation，再按「schema／pure rules → service → API → client／UI → integration gate」垂直交付。
- `CUS-CAP-01 Core`先完成；Approval與Bank/Files在Core contract穩定後可平行；Bulk Draft模式依賴Core，activate模式另依賴Approval。
- UI、API、CSV、worker及downstream lookup必須重用同一domain rule，不建立第二套validation/state machine。
- 每個business write與Customer audit同transaction；所有update用optimistic version；unique/FK/generated slot是競態最後防線。
- 銀行明文、密碼、key、Bank Sensitive檔案內容／路徑不得進log、audit、CSV、URL、notification、test snapshot或task evidence。
- 所有UI/UX必須遵守`docs/frontend-design.md`，不可另造表格、表單、確認dialog或視覺規則。

### 1.2 Migration allocation gate

Design暫定Customer使用`0027～0041`，但T01執行前不能建立任何DDL檔。T01必須fetch最新main、掃描實際migration及已批准的Item/Supplier配額；若碰撞，整組Customer migration順延並同步design/tasks。既有migration內容與checksum永不修改。

Logical順序固定：CUST-M01 permissions → M02 Business Master → M03 classifications → M04 customers → M05 addresses → M06 contacts → M07 identifiers → M08 credit → M09 settings → M10 approvals → M11 banks → M12 attachments → M13 audit → M14 import jobs → M15 import rows。若Phase PR要求audit先可用，可把M13在實際編號中提前，但依賴及文件必須同步。

### 1.3 依賴圖

```text
T01 Migration allocation
 ├─ T02 Permission/delegation
 ├─ T03 Business Master
 └─ T04 Config/storage/security ─→ T05 Shared crypto/scanner

T02–T05 ─→ T06–T11 Persistence/rules/audit
T06–T11 ─→ T12–T26 Core vertical slices
T26 Core gate ─┬→ T27–T32 Approval/Settings
               ├→ T33–T39 Bank/Attachments
               ├→ T40–T46 Bulk（activate mode also needs T32）
               └→ T47 Downstream contracts（bank consumers also need T36）

T32 + T36 + T39 + T46 + T47 ─→ T48 Performance/observability ─→ T49 Release
```

### 1.4 可平行及shared hotspots

- 可平行：T03/T04；T06與T07～09的migration準備；Core完成後T27～32、T33～39、T40～42。
- 必須順序：T01先於所有migration；T05先於bank service；schema先於對應integration；server contract先於client；precheck先於worker execute。
- Shared hotspots：`permissionCatalogue.js`、`applicationConfiguration.js`、`server/config/logging.js`、`client/config/menu.js`、`errorMessages.js`、migration integration suite。同一時間只由一個task修改，其他分支先rebase。
- T47只能改已存在的consumer模組；若Sales/Fulfillment/AR/Payment尚未落地，先交付CustomerLookup service與consumer contract fixtures，不虛構交易tables。

### 1.5 每個Task的Definition of Done

- [ ] Acceptance criteria全部滿足，新增行為有先失敗後通過的success、reject、edge及rollback tests。
- [ ] Focused tests、受影響workspace regression及`npm run lint`通過；有client改動時`npm run build --workspace client`通過。
- [ ] DB constraint／locking／migration行為以`DB_INTEGRATION_TESTS=1`真MySQL驗證，不用mock SQL字串冒充證據。
- [ ] 新API有request/response schema、後端permission、stable public error及繁中client mapping。
- [ ] 無敏感資料洩漏、debug output、dead code、無關refactor或需求外的預留功能。
- [ ] 相關design、task、README/runbook及rollback/backward compatibility已同步。
- [ ] Checkpoint前執行`npm run test:coverage`，不得降低現有coverage floor。

### 1.6 Checkpoints

| Checkpoint | Tasks | Gate |
| --- | --- | --- |
| A | T01–T05 | Migration、permission delegation、catalog、config、crypto/scanner foundation |
| B | T06–T11 | Core tables、rules與audit可供垂直切片使用 |
| C | T12–T16 | Root create/read/update及主要頁面 |
| D | T17–T23 | Address、Contact、Identifier、Credit完整切片 |
| E | T24–T26 | Lifecycle、lookup、Core integration與CAP-01驗收 |
| F | T27–T32 | Settings、Approval、Block完整驗收 |
| G | T33–T36 | Encrypted Bank完整驗收及rotation |
| H | T37–T39 | General/Bank Sensitive attachments及cleanup |
| I | T40–T46 | Import/Export、resume、10k容量 |
| Final | T47–T49 | Downstream contracts、全量NFR、部署與release evidence |

---

## 2. 任務索引

### Phase 0：CUS-CAP-00 Foundation

- [ ] T01 凍結migration編號及跨模組配額
- [ ] T02 建立Customer權限與敏感權限委派模型
- [ ] T03 建立共用Currency／Payment Term foundation
- [ ] T04 建立Customer config、private storage及logging redaction
- [ ] T05 建立共用Sensitive Data crypto、masking及scanner基礎

### Phase 1A：CUS-CAP-01 Core foundations

- [ ] T06 建立Customer分類目錄切片
- [ ] T07 建立Customer root與audit schema
- [ ] T08 建立Address／Contact及purpose schema
- [ ] T09 建立Identifier／Credit schema
- [ ] T10 建立Customer constants、normalization、validation及projection
- [ ] T11 建立Customer Audit service與查詢API

### Phase 1B：CUS-CAP-01 Core vertical slices

- [ ] T12 完成Customer建立與直接啟用後端
- [ ] T13 完成duplicate check、列表及詳情後端
- [ ] T14 完成導航、Customer建立頁及列表頁
- [ ] T15 完成root更新、Code特批及完整度後端
- [ ] T16 完成Customer詳情及一般編輯UI
- [ ] T17 完成Address後端切片
- [ ] T18 完成Address UI切片
- [ ] T19 完成Contact後端切片
- [ ] T20 完成Contact UI切片
- [ ] T21 完成Identifier後端及UI切片
- [ ] T22 完成Credit Policy後端切片
- [ ] T23 完成Credit Policy UI切片
- [ ] T24 完成Customer生命週期及reference guard後端
- [ ] T25 完成生命週期操作UI
- [ ] T26 完成CustomerLookup及Core整合驗收

### Phase 2A：CUS-CAP-02 Approval & Settings

- [ ] T27 完成Customer Settings persistence及API
- [ ] T28 完成Settings與classification catalog UI
- [ ] T29 建立Activation Approval domain
- [ ] T30 完成Approval API與queue
- [ ] T31 完成Approval UI
- [ ] T32 完成Block／Unblock及Approval整合驗收

### Phase 2B：CUS-CAP-03 Bank & Files

- [ ] T33 建立Bank schema及domain service
- [ ] T34 完成Bank API與敏感投影
- [ ] T35 完成Bank UI
- [ ] T36 完成Bank key rotation、reindex及安全驗收
- [ ] T37 建立Attachment schema、storage及domain service
- [ ] T38 完成Attachment API與安全stream
- [ ] T39 完成Attachment UI、cleanup jobs及整合驗收

### Phase 3：CUS-CAP-04 Bulk

- [ ] T40 建立Import persistence、config及scheduler基線
- [ ] T41 完成CSV template與streaming precheck
- [ ] T42 完成Import job查詢及控制API
- [ ] T43 完成逐列原子執行、result及purge
- [ ] T44 完成Import UI
- [ ] T45 完成安全Customer Export
- [ ] T46 完成Bulk整合、resume及容量驗收

### CUS-CAP-05及Release

- [ ] T47 完成下游Customer／Address／Contact／Credit／Bank contracts
- [ ] T48 完成整體效能、容量、可觀測性與復原驗證
- [ ] T49 完成部署、Smoke、回歸及Release Gate

---

## 3. 詳細任務

### T01：凍結migration編號及跨模組配額

**Description：** 在建立任何Customer migration前fetch最新main，核對實際檔案與Item/Supplier文件配額，凍結CUST-M01～15的無衝突實際編號。

**Capability：** CUS-CAP-00

**Traceability：** NFR-006、NFR-009、design §5.18／§13.1

**Acceptance criteria：**

- [ ] 主分支每個四位前綴唯一；既有migration檔名、內容、checksum不變。
- [ ] Customer 15支logical migrations有連續或明確依賴安全的實際編號；Item `0014～0026`配額及已存在`0024`被保留。
- [ ] Customer design/tasks及受影響的Item/Supplier migration說明同步，不留下重複宣稱。

**Verification：**

- [ ] `find server/database/migrations -maxdepth 1 -type f -print | sort`
- [ ] `rg -n '001[0-9]|002[0-9]|003[0-9]|004[0-9]' docs/*_management/{design_spec,tasks}.md`
- [ ] Technical Lead人工確認allocation後才開始T02/T03/T06～09。

**Dependencies：** None

**Files likely touched：** `docs/customer_management/design_spec.md`、`docs/customer_management/tasks.md`及真正衝突的其他模組文件。

**Estimated scope：** S

### T02：建立Customer權限與敏感權限委派模型

**Description：** 新增六項Customer permissions及seed；system-admin只自動取得四項非銀行權限，並以窄delegation guard讓其可明確委派catalogue權限而不自動通過Bank route。

**Capability：** CUS-CAP-00／所有capabilities

**Traceability：** SEC-001～009、SEC-012、AC-036～038、AC-047、AC-051

**Acceptance criteria：**

- [ ] Catalogue精確加入view/mgmt/approval/bank.view/bank.mgmt/settings，沒有inheritance。
- [ ] Seed冪等；system-admin沒有bank.view/mgmt，但有其餘四項。
- [ ] Fresh DB角色含system-admin才可在既有device＋password＋reason＋audit流程委派自己未持有的catalogue權限；一般actor仍拒絕提權。
- [ ] Role配權與User配角色兩條路徑使用同一guard；委派能力不讓system-admin直接通過Bank handler。

**Verification：**

- [ ] `npm test --workspace server -- test/adminGuard.test.js test/roleAdminService.test.js test/userAdminService.test.js test/permissionCatalogueConventions.test.js test/permissionCatalogueStartupGuard.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/roleManagement.integration.test.js test/integration/migrations.integration.test.js`

**Dependencies：** T01

**Files likely touched：** `permissionCatalogue.js`、`adminGuard.js`、`RoleAdminService.js`、`UserAdminService.js`、CUST-M01 migration及tests。

**Estimated scope：** M

### T03：建立共用Currency／Payment Term foundation

**Description：** 建立可由Customer先部署的`currencies`／`payment_terms`schema、HKD seed、shape compatibility guard及read/validate service/API。

**Capability：** CUS-CAP-00

**Traceability：** FR-CREATE-006、FR-EDIT-001/004、BR-014/015/041、NFR-013、AC-029/030

**Acceptance criteria：**

- [ ] CUST-M02按design §5.3建立兩表及索引，HKD active seed可重跑。
- [ ] 已有相容table時收斂；不相容shape明確fail，不用`IF NOT EXISTS`掩蓋。
- [ ] Customer只提供active list與validate；inactive舊值仍可按ID顯示，不提供Currency／Term write。
- [ ] Service不import Supplier，Supplier日後可改用同一foundation。

**Verification：**

- [ ] `npm test --workspace server -- test/businessMasterCatalogService.test.js test/customerCatalogHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/businessMasterMigrations.integration.test.js`

**Dependencies：** T01

**Files likely touched：** CUST-M02 migration、`BusinessMasterCatalogService.js`、normalization/errors、Customer catalog handlers及tests。

**Estimated scope：** M

### T04：建立Customer config、private storage及logging redaction

**Description：** 落實Customer attachment/import容量、private roots、retention、reveal TTL、audit detail上限及全logger敏感欄位遮罩。

**Capability：** CUS-CAP-00／03／04

**Traceability：** FR-BANK-007、FR-FILE-003/004、FR-AUDIT-003/004、SEC-010～014、NFR-009/010

**Acceptance criteria：**

- [ ] Config normalizer驗證20MiB、10k rows、batch、365日、private root互不重疊且不在static root。
- [ ] 所有logger profile大小寫不敏感遮罩account/IBAN/cipher/IV/tag/blind-index/key/password及敏感filename欄位。
- [ ] `.env.example`只有範例，不含真secret/path credential；SecretValue inspect安全。
- [ ] Config錯誤在startup一次列清並fail，不等到upload/import時才失敗。

**Verification：**

- [ ] `npm test --workspace server -- test/customerConfig.test.js test/configuration.test.js test/configSecrets.test.js test/bodyLoggingPolicy.test.js`
- [ ] `npm run lint -- server/config server/src/framework/configuration server/src/modules/customer`

**Dependencies：** T01

**Files likely touched：** `server/config/customer.js`、`applicationConfiguration.js`、`normalizeCustomerConfig.js`、`server/config/logging.js`、`.env.example`及tests。

**Estimated scope：** M

### T05：建立共用Sensitive Data crypto、masking及scanner基礎

**Description：** 建立不認識Customer/Supplier domain的AES-GCM、HMAC blind index、masking、key-ring validation及ClamAV scanner service。

**Capability：** CUS-CAP-00／03

**Traceability：** FR-BANK-002/006/007、FR-FILE-002～004、SEC-005/010/011/013、AC-036/037/043

**Acceptance criteria：**

- [ ] AES-256-GCM使用隨機12-byte IV、16-byte tag、versioned AAD；owner/context改變即fail。
- [ ] Encryption與lookup key rings分離，支援active write/all-key read；未知key、wrong length、duplicate ID startup fail。
- [ ] Mask對長度≤4全部遮蔽，較長只尾四；API不取得lastFour原值欄位。
- [ ] Scanner timeout/error/rejected皆fail closed；service沒有generic decrypt HTTP入口。

**Verification：**

- [ ] `npm test --workspace server -- test/sensitiveDataCrypto.test.js test/sensitiveDataConfig.test.js test/sensitiveDataMasking.test.js test/clamAvScanner.test.js`
- [ ] Manual secret scan：test output及logger fixtures沒有key/plaintext。

**Dependencies：** T04

**Files likely touched：** `SensitiveDataCryptoService.js`、`SensitiveDataMasking.js`、`normalizeSensitiveDataConfig.js`、`ClamAvScannerService.js`、`server/config/sensitiveData.js`及tests。

**Estimated scope：** M

## Checkpoint A：T01～T05

- [ ] Migration配額、permission seed/delegation、Business Master及config startup tests全綠。
- [ ] Security review確認system-admin不自動取得Bank、key rings/AAD/masking/scanner設計。
- [ ] `npm run lint && npm run test:coverage --workspace server`通過。

### T06：建立Customer分類目錄切片

**Description：** 建立Category、Industry、Territory三張明確表及設定權限下的CRUD API，不引入generic catalog engine。

**Capability：** CUS-CAP-01／02

**Traceability：** FR-LIST-004、FR-EDIT-001/004/006、FR-SET-001/002/006、BR-016/041、NFR-013

**Acceptance criteria：**

- [ ] CUST-M03欄位、unique code key、status/version/index/FK符合design §5.4並可重跑。
- [ ] GET使用customer.view；write使用view＋settings＋device/password/reason；`:catalog`只接受固定allowlist。
- [ ] 被引用值可停用不可刪；inactive不可新指派但歷史仍顯示。

**Verification：**

- [ ] `npm test --workspace server -- test/customerClassificationService.test.js test/customerCatalogHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerCatalog.integration.test.js`

**Dependencies：** T01、T02、T03

**Files likely touched：** CUST-M03 migration、classification service/handlers/schemas、errors及tests。

**Estimated scope：** M

### T07：建立Customer root與audit schema

**Description：** 依design §5.5及§5.16建立`customers`與append-only`customer_audit_logs`，含硬唯一鍵、FK、索引與delete-history語意。

**Capability：** CUS-CAP-01

**Traceability：** FR-CREATE-001～006、FR-AUDIT-001～007、BR-001～009、BR-029/033/034/038、AC-001～008/019/020/050

**Acceptance criteria：**

- [ ] CUST-M04/M13完整建立table、FK、unique/index；Audit target/customer logical IDs不設target FK。
- [ ] Code與Legal Name unique涵蓋所有status；default currency Draft可null；ever_activated_at可阻止delete。
- [ ] Audit detail為JSON且DB schema不包含bank plaintext欄位；migration重跑收斂。

**Verification：**

- [ ] `npm test --workspace server -- test/migrate.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerCoreMigrations.integration.test.js`

**Dependencies：** T01、T02、T03、T06

**Files likely touched：** CUST-M04/M13 migrations及Customer migration integration tests。

**Estimated scope：** M

### T08：建立Address／Contact及purpose schema

**Description：** 建立四張party child tables，以composite ownership FK及generated unique slot保證每用途最多一個default。

**Capability：** CUS-CAP-01

**Traceability：** FR-PARTY-001～007、BR-010～013/041/042、AC-021～028、NFR-007

**Acceptance criteria：**

- [ ] CUST-M05/M06的欄位、owner composite FK、purpose PK、default unique slot、status/version/index符合design §5.6～9。
- [ ] 兩connection競爭同Customer/用途default時DB不容許雙default。
- [ ] Root合法永久刪除可cascade；被下游FK引用時RESTRICT由consumer migration保證。

**Verification：**

- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerPartyMigrations.integration.test.js`
- [ ] Manual schema inspection：generated expression及composite FK與design一致。

**Dependencies：** T07

**Files likely touched：** CUST-M05/M06 migrations及integration tests。

**Estimated scope：** M

### T09：建立Identifier／Credit schema

**Description：** 建立全公司Identifier唯一及Customer 0..1 Credit Policy表，保留未設定、零額度、On Hold三種語意。

**Capability：** CUS-CAP-01

**Traceability：** FR-PARTY-008、FR-CREDIT-001～007、BR-007/017～020/041、AC-005/029～035

**Acceptance criteria：**

- [ ] CUST-M07的unique(type,country,key)不因inactive／archived釋放。
- [ ] CUST-M08以customer_id作PK/FK；DECIMAL(19,4)；limit null/0無精度損失；currency FK RESTRICT。
- [ ] 無row代表not_configured，table status只保存normal/on_hold。

**Verification：**

- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerIdentifierCreditMigrations.integration.test.js`

**Dependencies：** T07

**Files likely touched：** CUST-M07/M08 migrations及integration tests。

**Estimated scope：** S

### T10：建立Customer constants、normalization、validation及projection

**Description：** 建立所有channels共用的pure domain rules、狀態機、用途、allowlists、normalization及安全response projections。

**Capability：** CUS-CAP-01／所有capabilities

**Traceability：** FR-CREATE-002～006、FR-EDIT-002～006、BR-005～008/036/039/040、NFR-011/014

**Acceptance criteria：**

- [ ] Code/Legal Name/Trading Name/Identifier normalization完全符合design §4.2且不過度合併法人。
- [ ] 六種status及允許轉換、purpose codes、sort/filter allowlists只有一個source。
- [ ] CustomerSummary/Detail/Lookup/Credit/MaskedBank/Audit projection採explicit allowlist，永不spread DB row。
- [ ] Application errors有stable code且不含SQL、constraint、bank、path或stack。

**Verification：**

- [ ] `npm test --workspace server -- test/customerNormalization.test.js test/customerValidation.test.js test/customerProjections.test.js test/customerErrors.test.js`
- [ ] `npm run lint -- server/src/modules/customer`

**Dependencies：** T02、T03、T06～T09

**Files likely touched：** `customerConstants.js`、`customerNormalization.js`、`customerValidation.js`、`customerProjections.js`、`customerErrors.js`及tests。

**Estimated scope：** M

### T11：建立Customer Audit service與查詢API

**Description：** 實作action-specific allowlisted audit writer、8192-byte bounded detail及customer.view查詢API。

**Capability：** CUS-CAP-01／所有capabilities

**Traceability：** FR-VIEW-004、FR-AUDIT-001～007、SEC-011/014、NFR-006、KPI-05

**Acceptance criteria：**

- [ ] Writer只接受design §8.8 action及相應detail shape；bank/file敏感內容永不接受。
- [ ] 過大集合轉count/sample/truncated，仍超限令business transaction失敗。
- [ ] Audit API按time/id穩定分頁及filters；一般使用者沒有update/delete路徑。
- [ ] Writer使用caller connection，audit失敗使domain write rollback。

**Verification：**

- [ ] `npm test --workspace server -- test/customerAuditLogService.test.js test/customerAuditHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerAudit.integration.test.js`

**Dependencies：** T07、T10

**Files likely touched：** `CustomerAuditLogService.js`、customer audit handlers/schemas、tests及client audit service。

**Estimated scope：** M

## Checkpoint B：T06～T11

- [ ] 19-table設計中的Core tables、constraints及audit已由真MySQL證明。
- [ ] Pure rules/projections對所有channels可重用，無bank/plaintext leak。
- [ ] `npm run lint && DB_INTEGRATION_TESTS=1 npm test --workspace server`通過受影響suites。

### T12：完成Customer建立與直接啟用後端

**Description：** 實作Customer aggregate create、optional初始Address/Contact/Identifier/Credit、Draft保存及Approval OFF直接啟用。

**Capability：** CUS-CAP-01

**Traceability：** FR-CREATE-001～009、BR-005～009/014/015/022/036、AC-001～006/009/029/030

**Acceptance criteria：**

- [ ] Create schema拒絕unknown fields；一個transaction寫root/optional children/credit/audit，全有或全無。
- [ ] unique/catalog/format由service＋DB驗證；duplicate constraint映射安全錯誤。
- [ ] `activate=true`在setting OFF且最低資料完整時Active並設定ever_activated_at；設定ON先回明確approver flow（正式request由T29）。
- [ ] Idempotency-Key重送不建立第二個Customer或audit。

**Verification：**

- [ ] `npm test --workspace server -- test/customerService.test.js test/customerHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerCreate.integration.test.js`

**Dependencies：** T03、T06～T11

**Files likely touched：** `CustomerService.js`、create/activate handlers、customer schemas、tests。

**Estimated scope：** M

### T13：完成duplicate check、列表及詳情後端

**Description：** 提供hard duplicate預檢、server-paged Customer list及安全detail projection。

**Capability：** CUS-CAP-01

**Traceability：** FR-LIST-001～010、FR-VIEW-001/004/006、FR-CREATE-003～005、NFR-001～003、AC-002～005

**Acceptance criteria：**

- [ ] Exact Code優先；Code/Legal/Trading/Identifier/phone/email/address partial search安全escape且不因child join重複row/count。
- [ ] Filters/sorts/completeness全部allowlist，Archived預設排除，pageSize上限100。
- [ ] Duplicate check對Code/Legal/Identifier hard conflict；Trading Name最多10筆safe warning，不自動合併。
- [ ] Detail inline child上限100；projection沒有normalized/crypto/storage內部欄位。

**Verification：**

- [ ] `npm test --workspace server -- test/customerReadService.test.js test/customerReadHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerRead.integration.test.js`
- [ ] `EXPLAIN`證明exact key及主要filters使用design indexes。

**Dependencies：** T12

**Files likely touched：** `CustomerService.js`、list/get/duplicate handlers/schemas、tests。

**Estimated scope：** M

### T14：完成導航、Customer建立頁及列表頁

**Description：** 按frontend-design建立Customer menu、create form及server-paged list，連接T12/T13 API。

**Capability：** CUS-CAP-01

**Traceability：** FR-LIST-001～010、FR-CREATE-001/002/006/009、BR-040、AC-001/006

**Acceptance criteria：**

- [ ] Menu/page metadata按customer.view/mgmt；直接URL無權限進403。
- [ ] Create使用FormPanel，HKD明確default、optional sections、duplicate提示及Draft/activate結果文案。
- [ ] List使用PageHeader、DataTable sticky-actions、EllipsisCell；filter/page/sort存URL，四種load state分明。
- [ ] 375/768/1024/1440px與keyboard/error focus符合frontend-design。

**Verification：**

- [ ] `npm test --workspace client -- test/services/customer.test.js test/pages/customers/customerCreate.test.js test/pages/customers/customersList.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T12、T13

**Files likely touched：** `client/config/menu.js`、`customer.js`、`CustomerCreatePage.vue`、`CustomersPage.vue`、client tests。

**Estimated scope：** M

### T15：完成root更新、Code特批及完整度後端

**Description：** 實作完整root replace、optimistic CAS、受控Code change及blocking/non-blocking completeness。

**Capability：** CUS-CAP-01

**Traceability：** FR-EDIT-001～008、FR-VIEW-006、BR-033～038、AC-007/008/030/050

**Acceptance criteria：**

- [ ] General update schema沒有customerCode；catalog/unique/cross-field重新驗證，critical fields要求reason。
- [ ] Code change固定jwt-device-password＋view/mgmt＋reason/version；歷史snapshot不回寫。
- [ ] CAS失敗回VERSION_CONFLICT且無domain/audit副作用。
- [ ] Completeness只把Code/Legal/active Currency列blocking，其餘列warning及action target。

**Verification：**

- [ ] `npm test --workspace server -- test/customerService.test.js test/customerUpdateHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerUpdate.integration.test.js`

**Dependencies：** T12、T13

**Files likely touched：** `CustomerService.js`、update/code/completeness handlers/schemas、tests。

**Estimated scope：** M

### T16：完成Customer詳情及一般編輯UI

**Description：** 建立detail tabs、狀態/completeness banner、一般編輯及Code特批dialog。

**Capability：** CUS-CAP-01

**Traceability：** FR-VIEW-001～006、FR-EDIT-002/003/005/007、AC-007/008/050

**Acceptance criteria：**

- [ ] Detail顯示Overview/party/defaults/credit/history占位並按權限lazy load；non-Active文字提示明確。
- [ ] Edit用FormPanel；Code readonly；特批用promptPassword且顯示Code/Legal/impact/reason。
- [ ] Dirty leave prompt；version conflict保留可複製輸入並要求reload，不自動覆蓋。
- [ ] 所有錯誤走`errorMessages.js`繁中mapping。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerDetail.test.js test/pages/customers/customerEdit.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T14、T15

**Files likely touched：** `CustomerDetailPage.vue`、root form/completeness/status components、customer client service、error mapping及tests。

**Estimated scope：** M

## Checkpoint C：T12～T16

- [ ] Draft create、direct activation、hard duplicates、list/detail/update/code/CAS端到端通過。
- [ ] Main pages在四斷點及keyboard-only smoke通過。
- [ ] Core read/write permissions與audit transaction證據完整。

### T17：完成Address後端切片

**Description：** 實作Address create/update/deactivate/reactivate/delete、multi-purpose replace及atomic default switch。

**Capability：** CUS-CAP-01／05

**Traceability：** FR-PARTY-001/002/005～007、BR-010～012/041/042、AC-021～026/028

**Acceptance criteria：**

- [ ] Child owner用customerId＋addressId查；wrong owner safe 404。
- [ ] Purpose array完整replace，default切換鎖同Customer/用途rows；inactive不能default，deactivate清default。
- [ ] Delete只限unreferenced Draft child；被引用只可停用，snapshot不改。
- [ ] 每command更新child/root version並同transaction audit。

**Verification：**

- [ ] `npm test --workspace server -- test/customerPartyService.test.js test/customerAddressHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerAddress.integration.test.js test/integration/customerConcurrency.integration.test.js`

**Dependencies：** T08、T10～T12

**Files likely touched：** `CustomerPartyService.js`、address handlers/schemas、reference guard及tests。

**Estimated scope：** M

### T18：完成Address UI切片

**Description：** 在Customer detail加入Address list/editor、multi-purpose及每用途default操作。

**Capability：** CUS-CAP-01

**Traceability：** FR-PARTY-001/002/005、FR-VIEW-001、AC-022/023/026

**Acceptance criteria：**

- [ ] 顯示用途、default、status、sort；超100筆走server pagination。
- [ ] Editor可多選purpose並逐用途設default；inactive row不提供default操作。
- [ ] 無shipping地址顯示non-blocking Customer warning及維護入口。
- [ ] Version conflict/owner errors不丟失表單輸入。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerAddresses.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T16、T17

**Files likely touched：** Address list/editor components、CustomerDetailPage、customer service及tests。

**Estimated scope：** S

### T19：完成Contact後端切片

**Description：** 實作Contact CRUD/status、multi-purpose、多名可選及每用途一個default。

**Capability：** CUS-CAP-01／05

**Traceability：** FR-PARTY-003～005/007、BR-013/041/042、AC-027/028

**Acceptance criteria：**

- [ ] 每用途允許多名active contacts但DB/service最多一名default。
- [ ] Email/phone只基本驗證，不自動改寫或unique；wrong owner safe 404。
- [ ] Deactivate清defaults，reactivate不自動恢復；delete遵守reference guard。
- [ ] Child/root version及audit同transaction。

**Verification：**

- [ ] `npm test --workspace server -- test/customerPartyService.test.js test/customerContactHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerContact.integration.test.js test/integration/customerConcurrency.integration.test.js`

**Dependencies：** T08、T10～T12

**Files likely touched：** `CustomerPartyService.js`、contact handlers/schemas及tests。

**Estimated scope：** M

### T20：完成Contact UI切片

**Description：** 在detail加入Contact list/editor、purpose/default/status操作及下游用途提示。

**Capability：** CUS-CAP-01

**Traceability：** FR-PARTY-003～005、FR-VIEW-001、AC-027

**Acceptance criteria：**

- [ ] 同用途多contacts全部顯示並default first；用途與status用文字標示。
- [ ] FormPanel逐欄錯誤、dirty prompt、version conflict處理符合frontend-design。
- [ ] customer.view只讀，view＋mgmt才顯示write controls；server拒絕仍有測試。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerContacts.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T16、T19

**Files likely touched：** Contact components、CustomerDetailPage、client service及tests。

**Estimated scope：** S

### T21：完成Identifier後端及UI切片

**Description：** 完成Identifier create/update/deactivate/reactivate/delete、全球scope uniqueness及detail editor。

**Capability：** CUS-CAP-01

**Traceability：** FR-PARTY-007/008、FR-EDIT-006、BR-007/041、AC-005

**Acceptance criteria：**

- [ ] type＋country＋normalized value重複硬拒絕，inactive仍占用；日期順序驗證。
- [ ] Identifier變更要求reason並audit before/after；wrong owner安全。
- [ ] UI顯示safe conflict，不揭露另一Customer完整證號；停用值歷史可見。

**Verification：**

- [ ] `npm test --workspace server -- test/customerIdentifierService.test.js test/customerIdentifierHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerIdentifier.integration.test.js`
- [ ] `npm test --workspace client -- test/pages/customers/customerIdentifiers.test.js`

**Dependencies：** T09、T10～T12、T16

**Files likely touched：** Party/Identifier service、handlers/schemas、Identifier components及tests。

**Estimated scope：** M

### T22：完成Credit Policy後端切片

**Description：** 實作optional Credit get/save/clear及精確decimal、version、reason/audit語意。

**Capability：** CUS-CAP-01／05

**Traceability：** FR-CREDIT-001～007、BR-017～020、AC-031～035

**Acceptance criteria：**

- [ ] 無row回configured=false/null/not_configured；0.0000保持0；negative拒絕。
- [ ] Limit非null要求active currency；status只normal/on_hold；notes不進一般lookup/export。
- [ ] 首建version null race只有一個成功；save/clear CAS，reason/audit同transaction。
- [ ] Service不計算AR exposure/available credit或override。

**Verification：**

- [ ] `npm test --workspace server -- test/customerCreditService.test.js test/customerCreditHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerCredit.integration.test.js`

**Dependencies：** T09～T12

**Files likely touched：** `CustomerCreditService.js`、credit handlers/schemas/projection及tests。

**Estimated scope：** M

### T23：完成Credit Policy UI切片

**Description：** 建立Credit read/editor，清楚區分未設定、零額度及On Hold。

**Capability：** CUS-CAP-01

**Traceability：** FR-CREDIT-001～004、FR-VIEW-001、AC-031～033

**Acceptance criteria：**

- [ ] Decimal以string處理，不經JS float；未設定不顯示0。
- [ ] Save/clear均要求reason；clear用password dialog；顯示mgmt不是override權限。
- [ ] Inactive currency舊值可見但不可新選，CAS conflict保留輸入。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerCredit.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T16、T22

**Files likely touched：** Credit components、CustomerDetailPage、customer service及tests。

**Estimated scope：** S

## Checkpoint D：T17～T23

- [ ] Party default races、ownership、Identifier unique及Credit semantics由unit＋真MySQL證明。
- [ ] Address/Contact/Identifier/Credit UI遵守permission及frontend-design。
- [ ] AC-021～035全部在test names中有獨立scenario。

### T24：完成Customer生命週期及reference guard後端

**Description：** 實作suspend/reactivate/archive/restore/delete及purpose-specific reference/open-flow guard；Block留T32由approval權限完成。

**Capability：** CUS-CAP-01／05

**Traceability：** FR-STATUS-001/002/004～008、BR-025/026/028/029/041、AC-015/018～020

**Acceptance criteria：**

- [ ] 每個action獨立handler/auth；reason/version/state/minimum fields重新驗證。
- [ ] Archive回open-flow blockers；checker unavailable fail closed，不無聲中斷交易。
- [ ] Restore固定到Suspended；曾Active或任何reference的Customer不可永久delete。
- [ ] Delete先寫無FK audit再cascade，未知commit outcome可用idempotency/audit對帳。

**Verification：**

- [ ] `npm test --workspace server -- test/customerLifecycle.test.js test/customerReferenceGuard.test.js test/customerStatusHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerLifecycle.integration.test.js`

**Dependencies：** T12、T15、T17～T22

**Files likely touched：** `CustomerService.js`、`customerReferenceGuard.js`、status/delete handlers/schemas及tests。

**Estimated scope：** M

### T25：完成生命週期操作UI

**Description：** 在Customer detail提供符合權限及狀態的activate/suspend/reactivate/archive/restore/delete操作。

**Capability：** CUS-CAP-01

**Traceability：** FR-STATUS-001/002/004～008、FR-VIEW-006、AC-015/018～020

**Acceptance criteria：**

- [ ] 操作dialog顯示Code、Legal Name、影響、reason及需要的password/device流程。
- [ ] Archive先顯示blockers；delete只在符合條件時呈現，但直接API仍由server防護。
- [ ] 成功toast包含Code及新status；狀態由文字＋icon＋badge呈現。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerLifecycle.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T16、T24

**Files likely touched：** lifecycle components、CustomerDetailPage、client service、error mappings及tests。

**Estimated scope：** S

### T26：完成CustomerLookup及Core整合驗收

**Description：** 建立purpose-specific Customer/Address/Contact/Credit lookup並完成CUS-CAP-01 API、DB、權限、併發及基本consumer contract驗收。

**Capability：** CUS-CAP-01／05

**Traceability：** FR-STATUS-001、FR-PARTY-006/007、FR-CREDIT-005～007、BR-004/011/012/019/025/035/042、AC-021～035/050/051

**Acceptance criteria：**

- [ ] new_sale只回Active；history保留非Active；shipment只回owner active shipping並default first。
- [ ] `assertAddressUsable/assertContactUsable`在submit時重驗，不接受自由文字／wrong owner。
- [ ] Credit lookup只有policy/version，無notes/exposure；consumer自行授權，Customer lookup無generic public write。
- [ ] Core AC-001～035、050～051、permission stale、IDOR、audit rollback、default/CAS race全綠。

**Verification：**

- [ ] `npm test --workspace server -- test/customerLookupService.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerManagement.integration.test.js test/integration/customerConcurrency.integration.test.js test/integration/customerLookup.integration.test.js`
- [ ] `npm run lint && npm run test:coverage`

**Dependencies：** T12～T25

**Files likely touched：** `CustomerLookupService.js`、lookup tests、integration suites、consumer contract fixtures及docs。

**Estimated scope：** M

## Checkpoint E：T24～T26

- [ ] CUS-CAP-01全部requirements/AC可追溯且測試通過。
- [ ] Sales只選Customer、Fulfillment之後選address的basic contract已證明。
- [ ] Product/Technical/QA review接受Core API與schema，才凍結供Approval/Bank/Bulk使用。

### T27：完成Customer Settings persistence及API

**Description：** 建立singleton setting migration、typed service及get/update API，預設approval OFF且不追溯改寫進行中流程。

**Capability：** CUS-CAP-02

**Traceability：** FR-SET-001～006、FR-APPROVAL-001、BR-022、AC-047～049

**Acceptance criteria：**

- [ ] CUST-M09只保存id=1、require_activation_approval、version/time/actor；seed OFF可重跑。
- [ ] GET/POST只允許view＋settings；update用jwt-device-password、reason、version及unknown-field reject。
- [ ] Setting改變只影響新submit；既有request不由setting service更新。
- [ ] Setting audit與row CAS同transaction。

**Verification：**

- [ ] `npm test --workspace server -- test/customerSettingsService.test.js test/customerSettingsHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerSettings.integration.test.js`

**Dependencies：** T02、T07、T10、T11、T26

**Files likely touched：** CUST-M09 migration、settings service/handlers/schemas及tests。

**Estimated scope：** M

### T28：完成Settings與classification catalog UI

**Description：** 建立Customer Settings頁，包含approval toggle及Category/Industry/Territory editors。

**Capability：** CUS-CAP-02

**Traceability：** FR-SET-001～006、BR-016、AC-047～049、NFR-012/013

**Acceptance criteria：**

- [ ] Page/menu只對view＋settings；toggle顯示影響與不追溯existing pending說明。
- [ ] Update用promptPassword、reason、version；成功顯示目前值/修改人/time。
- [ ] 三個catalog使用DataTable/FormPanel，active/inactive及被引用語意清楚。
- [ ] 未定義設定不顯示，client不使用generic key/value editor。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerSettings.test.js test/services/customerSettings.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T06、T27

**Files likely touched：** `CustomerSettingsPage.vue`、settings/catalog components、client service/menu及tests。

**Estimated scope：** M

### T29：建立Activation Approval domain

**Description：** 建立approval migration及submit/withdraw/approve/reject/reassign/invalidate domain rules、immutable snapshot與critical hash。

**Capability：** CUS-CAP-02

**Traceability：** FR-APPROVAL-001～007、BR-023/024、AC-010～014、NFR-007/008

**Acceptance criteria：**

- [ ] CUST-M10欄位、pending generated slot、FK/index/version符合design §5.14。
- [ ] Submit lock setting/customer，驗eligible other approver並保存setting snapshot、summary、critical hash。
- [ ] Critical update同transaction invalidates request並回Draft；歷史snapshot不可重寫。
- [ ] Decision鎖request/customer、重讀actor permission、assigned actor、version/hash/minimum fields；race只有一個terminal結果。

**Verification：**

- [ ] `npm test --workspace server -- test/customerApprovalService.test.js test/customerApprovalSnapshot.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerApprovalMigrations.integration.test.js test/integration/customerApprovalConcurrency.integration.test.js`

**Dependencies：** T15、T26、T27

**Files likely touched：** CUST-M10 migration、`CustomerApprovalService.js`、snapshot helper、CustomerService integration及tests。

**Estimated scope：** M

### T30：完成Approval API與queue

**Description：** 實作eligible approver lookup、submit/withdraw、approval queue/detail及decision/reassign handlers。

**Capability：** CUS-CAP-02

**Traceability：** FR-APPROVAL-001～007、SEC-004/009/012、AC-010～014/051

**Acceptance criteria：**

- [ ] Queue預設mine，all/unassigned及filters bounded；detail顯示immutable snapshot/current diff但不reveal bank/file。
- [ ] Eligible lookup只回id/username/displayName、active、有approval、最多100、可排exclude requester。
- [ ] Submit/withdraw用view＋mgmt；decisions/reassign用jwt-password＋view＋approval；schema/version/reason完整。
- [ ] Wrong approval/customer ID不洩漏；duplicate decision回terminal safe code，無第二次state audit。

**Verification：**

- [ ] `npm test --workspace server -- test/customerApprovalHandlers.test.js test/customerApproverLookup.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerApproval.integration.test.js`

**Dependencies：** T29

**Files likely touched：** approval/approver handlers/schemas、CustomerApprovalService query、projections及tests。

**Estimated scope：** M

### T31：完成Approval UI

**Description：** 建立My Approvals queue、request detail/diff、submit/withdraw及approve/reject/reassign dialogs。

**Capability：** CUS-CAP-02

**Traceability：** FR-APPROVAL-002～007、FR-VIEW-006、AC-010～014

**Acceptance criteria：**

- [ ] Queue使用DataTable，mine/all/unassigned、filter/page/sort；menu按view＋approval。
- [ ] Customer Draft activation在setting ON要求另一eligible approver；self/disabled不在選單且server仍驗。
- [ ] Decision dialog顯示Code/Legal/snapshot diff/password/reason；reject/reassign reason必填。
- [ ] Approval detail不自動載入bank明文或敏感filename；stale/terminal結果文案清楚。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerApprovals.test.js test/services/customerApproval.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T16、T28、T30

**Files likely touched：** `CustomerApprovalsPage.vue`、approval components/service、CustomerDetail/Create integration及tests。

**Estimated scope：** M

### T32：完成Block／Unblock及Approval整合驗收

**Description：** 實作approval權限下的Block/Unblock後端與UI，並完成CUS-CAP-02安全、併發及E2E gate。

**Capability：** CUS-CAP-02

**Traceability：** FR-STATUS-002/003、BR-027、SEC-004/012、AC-016/017、AC-047～049

**Acceptance criteria：**

- [ ] Block/Unblock獨立jwt-device-password handlers，view＋approval、reason/version；unblock只到Suspended。
- [ ] customer.mgmt不能操作；UI只按approval顯示並使用high-risk dialog。
- [ ] Approval setting、submit/decision/invalidation/reassign/block race及permission stale全部通過。
- [ ] AC-009～020、047～049在test names有獨立scenario，無自我審批或矛盾狀態。

**Verification：**

- [ ] `npm test --workspace server -- test/customerApprovalService.test.js test/customerStatusHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerApproval.integration.test.js test/integration/customerApprovalConcurrency.integration.test.js`
- [ ] `npm test --workspace client -- test/pages/customers/customerApprovals.test.js test/pages/customers/customerLifecycle.test.js`

**Dependencies：** T27～T31

**Files likely touched：** CustomerService/ApprovalService、block handlers、lifecycle UI及integration tests。

**Estimated scope：** M

## Checkpoint F：T27～T32

- [ ] Approval OFF/ON、setting non-retroactivity、self/stale/race、Block/Unblock全部驗收。
- [ ] Approval projection不繞過Bank/File權限。
- [ ] `npm run lint && npm run test:coverage`通過。

### T33：建立Bank schema及domain service

**Description：** 建立encrypted Customer Bank table及create/update/default/deactivate/reveal domain service，使用T05 shared crypto。

**Capability：** CUS-CAP-03

**Traceability：** FR-BANK-001～007、BR-030/031/041/042、SEC-005/006/010/011、AC-036～041

**Acceptance criteria：**

- [ ] CUST-M11所有crypto/default/version欄位、unique/index/FK/generated slot符合design §5.12；DB無plaintext。
- [ ] Same Customer duplicate在all-key rotation window硬拒絕；cross Customer只safe warning token＋新Idempotency-Key確認。
- [ ] Create/update/default/deactivate鎖Customer/banks、CAS、same-transaction redacted audit；deactivate default不自動另選。
- [ ] Reveal先成功寫audit再回plaintext；integrity/key error不回部分值並P1 log。

**Verification：**

- [ ] `npm test --workspace server -- test/customerBankService.test.js test/customerBankProjection.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerBankMigrations.integration.test.js test/integration/customerBankConcurrency.integration.test.js`

**Dependencies：** T05、T07、T10、T11、T26

**Files likely touched：** CUST-M11 migration、`CustomerBankService.js`、bank validation/projection/errors及tests。

**Estimated scope：** M

### T34：完成Bank API與敏感投影

**Description：** 實作masked list、bank write及reveal handlers，落實三權限、強認證、no-store與拒絕稽核。

**Capability：** CUS-CAP-03

**Traceability：** FR-VIEW-002、FR-BANK-001～007、SEC-002/005/006/009/012/014、AC-036～041

**Acceptance criteria：**

- [ ] List只需customer.view且對所有人只回masked projection；bank.view不自動reveal。
- [ ] Write固定jwt-device-password＋view/bank.view/bank.mgmt；reveal為jwt-password＋view/bank.view。
- [ ] Response no-store；request logger/validation/error/audit不含account/cipher/index/key。
- [ ] 未授權/owner替換/reveal denied留下可追蹤security audit，response不洩漏resource存在性。

**Verification：**

- [ ] `npm test --workspace server -- test/customerBankHandlers.test.js test/customerSensitiveLogging.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerBank.integration.test.js`

**Dependencies：** T02、T33

**Files likely touched：** bank handlers/schemas、sensitive access audit adapter、logging/error tests。

**Estimated scope：** M

### T35：完成Bank UI

**Description：** 建立masked bank list、create/edit/default/deactivate及30秒主動reveal UI，不持久化明文。

**Capability：** CUS-CAP-03

**Traceability：** FR-VIEW-002、FR-BANK-001～006、AC-036～041、NFR-010

**Acceptance criteria：**

- [ ] Bank tab預設只masked；無bank.view沒有reveal；無bank.mgmt沒有write controls。
- [ ] Edit明確「保持現有帳號／輸入新帳號」，普通form不回填明文。
- [ ] Reveal用password dialog、倒數30秒；dialog unmount/timeout清DOM local ref，不進store/URL/cache/analytics。
- [ ] Cross Customer warning只顯示safe訊息，確認使用server token及新Idempotency-Key。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerBank.test.js test/services/customerBank.test.js`
- [ ] `npm run lint && npm run build --workspace client`
- [ ] Browser devtools人工檢查Pinia/localStorage/history/cache無plaintext。

**Dependencies：** T16、T34

**Files likely touched：** bank components/service、CustomerDetailPage、error mapping及tests。

**Estimated scope：** M

### T36：完成Bank key rotation、reindex及安全驗收

**Description：** 建立可續跑的encryption rotation與blind-index reindex scripts，完成Bank security/backup/restore gate。

**Capability：** CUS-CAP-03

**Traceability：** FR-BANK-006/007、SEC-010/011/014、NFR-006/009/010、AC-036～041

**Acceptance criteria：**

- [ ] Scripts按ID bounded batch、CAS/version、可中斷續跑；output只有counts/IDs，不以CLI傳key。
- [ ] Old+new read/new write、rotation、duplicate report、zero old-key proof後才能移除old key。
- [ ] 備份還原後可decrypt，AAD owner/context防搬移；未知key/integrity failure立即告警。
- [ ] Permission matrix、IDOR、log/audit/error/CSV secret scan及system-admin非自動Bank access全綠。

**Verification：**

- [ ] `npm test --workspace server -- test/customerBankRotation.test.js test/sensitiveDataCrypto.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerBank.integration.test.js test/integration/customerBankRotation.integration.test.js`
- [ ] Security reviewer簽核rotation與restore evidence。

**Dependencies：** T33～T35

**Files likely touched：** rotation/reindex scripts、package scripts、BankService helpers、integration tests、runbook。

**Estimated scope：** M

## Checkpoint G：T33～T36

- [ ] AC-036～041及Bank permission/crypto/rotation/restore全部通過。
- [ ] DB dump、logs、audit、errors、browser storage零明文。
- [ ] Bank keys安全provision前不開Bank roles。

### T37：建立Attachment schema、storage及domain service

**Description：** 建立General/Bank Sensitive attachment metadata、private storage lifecycle、scanner及受控delete/orphan語意。

**Capability：** CUS-CAP-03

**Traceability：** FR-FILE-001～007、BR-032/041、SEC-010～013、AC-042/043

**Acceptance criteria：**

- [ ] CUST-M12欄位/status/index/FK符合design §5.13，DB只存UUID relative key不存absolute path。
- [ ] Stream temp時計size/hash/signature並掃描；extension/MIME/magic/size全過才active，失敗清temp/metadata。
- [ ] DB commit後atomic move；move/delete失敗轉storage_error/delete_failed並可重試，不回假成功。
- [ ] Delete只限unreferenced Draft owner/attachment；Bank Sensitive使用獨立private root。

**Verification：**

- [ ] `npm test --workspace server -- test/customerAttachmentService.test.js test/customerAttachmentStorage.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerAttachmentMigrations.integration.test.js`

**Dependencies：** T04、T05、T07、T10、T11、T26

**Files likely touched：** CUST-M12 migration、`CustomerAttachmentService.js`、storage/reference helpers及tests。

**Estimated scope：** M

### T38：完成Attachment API與安全stream

**Description：** 實作upload/list/update/deactivate/delete/download/preview及按sensitivity分權的安全stream。

**Capability：** CUS-CAP-03

**Traceability：** FR-VIEW-002/003、FR-FILE-001～007、SEC-005/006/009/010/012/014、AC-042/043

**Acceptance criteria：**

- [ ] General view/mgmt與Bank Sensitive bank.view/bank.mgmt矩陣由server依DB metadata判斷；改sensitivity採最嚴權限。
- [ ] 無bank.view list只回restrictedCount，不回敏感filename/type/path。
- [ ] Download/preview先audit再open stream；no-store/nosniff/CSP sandbox/Content-Disposition正確，symlink/path traversal拒絕。
- [ ] Upload失敗無temp/orphan/metadata；所有view/download/write/delete attempt有安全證據。

**Verification：**

- [ ] `npm test --workspace server -- test/customerAttachmentHandlers.test.js test/customerAttachmentSecurity.test.js test/fileTransferFailureModes.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerAttachment.integration.test.js`

**Dependencies：** T02、T37

**Files likely touched：** attachment handlers/schemas、file response integration、security audit adapter及tests。

**Estimated scope：** M

### T39：完成Attachment UI、cleanup jobs及整合驗收

**Description：** 建立Attachment list/upload/preview/download UI、orphan/delete retry jobs，完成CUS-CAP-03 Files gate。

**Capability：** CUS-CAP-03

**Traceability：** FR-FILE-001～007、AC-042/043、NFR-006/009/010

**Acceptance criteria：**

- [ ] UI按sensitivity/permission顯示；敏感preview/download每session re-auth；restricted files不洩漏名稱。
- [ ] Upload progress/retry使用Idempotency-Key；格式/掃描錯誤繁中可定位。
- [ ] Orphan cleanup只刪超grace且無active metadata；delete_failed安全重試，scheduler lease/stats生效。
- [ ] General/Bank Sensitive backup/restore、malware fail-closed、path/symlink、AC-042/043 E2E通過。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerAttachments.test.js test/services/customerAttachment.test.js`
- [ ] `npm test --workspace server -- test/customerAttachmentJobs.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerAttachment.integration.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T35、T38

**Files likely touched：** attachment components/service、CustomerDetailPage、cleanup jobs/scheduler、tests及runbook。

**Estimated scope：** M

## Checkpoint H：T37～T39

- [ ] AC-042/043、permission matrix、scanner、stream headers、orphan/delete retry、restore全部通過。
- [ ] CAP-03完整security review簽核；未provision keys/scanner/storage則不可release。

### T40：建立Import persistence、config及scheduler基線

**Description：** 建立Import jobs/rows migrations、RFC4180 dependencies、private storage及scheduler lease基礎。

**Capability：** CUS-CAP-04

**Traceability：** FR-IMPORT-001～010、NFR-004/006/008/009、AC-044～046

**Acceptance criteria：**

- [ ] CUST-M14/M15欄位、unique/index/FK/status/version符合design §5.17，row terminal marker可支援resume。
- [ ] 若dependency未存在只加入一組parser/stringifier；不使用`split(',')`。
- [ ] Source/result roots private；20MiB/10k rows/batch/365日config有startup validation。
- [ ] Worker/purge jobs沿用SchedulerService/lease/abort/stats，尚未實作execute前不claim production jobs。

**Verification：**

- [ ] `npm test --workspace server -- test/customerImportConfig.test.js test/customerImportJobs.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerImportMigrations.integration.test.js`

**Dependencies：** T01、T04、T07、T26

**Files likely touched：** CUST-M14/M15 migrations、package/lock、config/scheduler、worker/job skeleton及tests。

**Estimated scope：** M

### T41：完成CSV template與streaming precheck

**Description：** 實作v1 template、stream parser、header/row validation及safe precheck results，預檢不寫Customer資料。

**Capability：** CUS-CAP-04

**Traceability：** FR-IMPORT-001～003/006/008、BR-036/037/040、AC-044/045

**Acceptance criteria：**

- [ ] Template欄位/說明/version符合design §6.9；一列一Customer，update child fields明確unsupported。
- [ ] RFC4180 quotes/comma/newline/BOM/UTF-8及bounded streaming正確；unknown/duplicate headers安全報錯。
- [ ] Bank、Bank Sensitive、file content、creditNotes及常見敏感alias明確`IMPORT_SENSITIVE_FIELD_FORBIDDEN`，不保存原值。
- [ ] 每row重用Customer normalization/validation，輸出operation/warnings/errors；precheck對Customer tables零write。

**Verification：**

- [ ] `npm test --workspace server -- test/customerImportParser.test.js test/customerImportPrecheck.test.js test/customerImportHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerImportPrecheck.integration.test.js`

**Dependencies：** T10、T12、T40

**Files likely touched：** `CustomerImportService.js`、CSV schema/template/precheck、upload/template handlers及tests。

**Estimated scope：** M

### T42：完成Import job查詢及控制API

**Description：** 實作jobs list/detail、confirm/cancel及setting/approver snapshot，不執行row mutation。

**Capability：** CUS-CAP-04

**Traceability：** FR-IMPORT-002/003/005/007/010、FR-APPROVAL-001/002、AC-044/046

**Acceptance criteria：**

- [ ] Job/row pagination及summary bounded；owner/permission/IDOR安全。
- [ ] Confirm用jwt-password＋view/mgmt、Idempotency-Key、CAS ready→queued並保存setting snapshot。
- [ ] activate＋approval ON要求eligible other approver；OFF拒絕approver；Draft mode不依賴Approval capability。
- [ ] Cancel只限未running/terminal；重送不造第二job/approval。

**Verification：**

- [ ] `npm test --workspace server -- test/customerImportService.test.js test/customerImportHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerImportControl.integration.test.js`

**Dependencies：** T27、T29、T41；Draft-only confirm可先於T29交付但activate route不可註冊。

**Files likely touched：** ImportService、list/get/confirm/cancel handlers/schemas、approval lookup integration及tests。

**Estimated scope：** M

### T43：完成逐列原子執行、result及purge

**Description：** 實作worker claim/resume、每row aggregate transaction、safe result CSV及source/result retention purge。

**Capability：** CUS-CAP-04

**Traceability：** FR-IMPORT-004/005/007/008/010、FR-AUDIT-001/005、BR-036/037、NFR-006/008/009、AC-044～046

**Acceptance criteria：**

- [ ] Worker鎖row，terminal不重做；Customer aggregate＋audit＋row applied同commit。
- [ ] Row失敗rollback aggregate，再以短transaction標failed；其他合法row繼續。
- [ ] Crash/lease expiry可resume；job counts由row terminal states重算，沒有memory-only真相。
- [ ] Result streaming CSV防formula injection且無bank/file/creditNotes；purge只刪files並標files_purged_at，保留job/rows/audit。

**Verification：**

- [ ] `npm test --workspace server -- test/customerImportWorker.test.js test/customerImportResult.test.js test/customerImportPurgeJob.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerImportExecution.integration.test.js test/integration/customerImportResume.integration.test.js`

**Dependencies：** T12、T24、T32、T42

**Files likely touched：** WorkerService/jobs、ImportService、result handler、CustomerService import adapter及tests。

**Estimated scope：** M

### T44：完成Import UI

**Description：** 建立template/upload/precheck/confirm/progress/result四步UI及job history。

**Capability：** CUS-CAP-04

**Traceability：** FR-IMPORT-001～010、AC-044～046

**Acceptance criteria：**

- [ ] Menu/page只對view＋mgmt；10k rows server-paged，不一次載入browser。
- [ ] Invalid rows不能強制寫入；summary清楚顯示total/success/failed/skipped/warnings。
- [ ] Activate mode按setting顯示approver；confirm高強度且重送idempotent。
- [ ] Result expired 410、worker failed、partial success有不同繁中狀態及修正入口。

**Verification：**

- [ ] `npm test --workspace client -- test/pages/customers/customerImports.test.js test/services/customerImport.test.js`
- [ ] `npm run lint && npm run build --workspace client`

**Dependencies：** T41～T43

**Files likely touched：** `CustomerImportsPage.vue`、import components/service、menu/error mapping及tests。

**Estimated scope：** M

### T45：完成安全Customer Export

**Description：** 實作按目前filters的一般Customer export、同步/async邊界、safe CSV及export audit。

**Capability：** CUS-CAP-04

**Traceability：** FR-IMPORT-008/009、FR-AUDIT-001/002、SEC-014、AC-052

**Acceptance criteria：**

- [ ] POST create使用jwt-password＋view/mgmt；server重新套filter/permission，不信任client row IDs。
- [ ] CSV不含bank、Bank Sensitive、file bytes/path、creditNotes、normalized keys；公式注入安全。
- [ ] Export event保存actor、filters、count、time/result，不保存整份資料；大型export使用job/file retention。
- [ ] List頁export UI顯示範圍與敏感排除，下載按當前filter。

**Verification：**

- [ ] `npm test --workspace server -- test/customerExportService.test.js test/customerExportHandlers.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerExport.integration.test.js`
- [ ] `npm test --workspace client -- test/pages/customers/customerExport.test.js`

**Dependencies：** T13、T40、T43、T44

**Files likely touched：** export service/handlers、Customer list/import UI service、audit/error tests。

**Estimated scope：** M

### T46：完成Bulk整合、resume及容量驗收

**Description：** 完成Import/Export security、partial success、idempotency、resume及10k-row性能gate。

**Capability：** CUS-CAP-04

**Traceability：** FR-IMPORT-001～010、SEC-013/014、NFR-004/006/008/009/011、AC-044～046/052

**Acceptance criteria：**

- [ ] Mixed create/update/invalid檔案的每row all-or-none及counts正確。
- [ ] Upload/confirm重送、worker crash/lease reclaim、version conflict不重複Customer/child/approval/audit。
- [ ] 10,000-row precheck＋execute在正式基準環境<10分鐘，heap/DB pool/queue受控。
- [ ] Source/result/log/audit/error全量secret scan零bank/file內容；365日purge演練通過。

**Verification：**

- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerImport.integration.test.js test/integration/customerImportResume.integration.test.js test/integration/customerExport.integration.test.js`
- [ ] `npm run test:coverage && npm run lint`
- [ ] 保存10k performance及purge evidence。

**Dependencies：** T40～T45

**Files likely touched：** Import/Export integration/performance suites、fixtures、metrics/runbook及必要修正。

**Estimated scope：** M

## Checkpoint I：T40～T46

- [ ] AC-044～046/052、10k性能、resume/idempotency、CSV security全部通過。
- [ ] Draft及activate/approval import語意均與UI create一致。
- [ ] CAP-04 release evidence由QA/Technical Lead確認。

### T47：完成下游Customer／Address／Contact／Credit／Bank contracts

**Description：** 把CustomerLookup接入已存在的Sales/Fulfillment/Invoicing/AR；Payment/Refund存在時才加入purpose-specific Bank resolver，並證明submit revalidation及snapshot。

**Capability：** CUS-CAP-05

**Traceability：** OBJ-02/09、FR-STATUS-001、FR-PARTY-006/007、FR-CREDIT-005～007、FR-BANK-005、BR-004/011/012/019/025/026/035/042、AC-021～035/040

**Acceptance criteria：**

- [ ] Sales create只選Customer，不要求address；submit重新驗Active並保存code/name/default snapshots。
- [ ] Fulfillment列owner active shipping、default first；no address/wrong owner/inactive/free text拒絕，confirm保存address/contact snapshot。
- [ ] Invoice null payment term不猜值；AR取得latest policy/version並區分null/0/on_hold，override仍由consumer permission。
- [ ] Payment/Refund若存在，使用`resolveForRefund()`等purpose method及audit，不直呼crypto/generic reveal；若不存在只交contract tests，不造fake tables。
- [ ] Master data後改不回寫existing transaction snapshots。

**Verification：**

- [ ] `npm test --workspace server -- test/customerLookupService.test.js test/customerConsumerContracts.test.js`
- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/customerDownstream.integration.test.js`
- [ ] Consumer owner逐一review contract及snapshot欄位。

**Dependencies：** T26；Approval-sensitive flow需T32；Bank consumer需T36。

**Files likely touched：** `CustomerLookupService.js`、已存在consumer services/handlers、consumer migrations/contracts及tests。

**Estimated scope：** M per consumer；不得把所有尚未存在模組放同一PR。

### T48：完成整體效能、容量、可觀測性與復原驗證

**Description：** 在design基準資料下執行50-user混合負載、索引/lock分析、metrics/alerts及DB/files/keys restore drill。

**Capability：** Cross-cutting

**Traceability：** KPI-01～09、NFR-001～010、SEC-010/014

**Acceptance criteria：**

- [ ] 100k Customers及指定children量，exact/list/shipping/contact p95<2s、error<1%，無unbounded queue。
- [ ] EXPLAIN證明主要search/filter/completeness使用index/EXISTS，無child cartesian count；default/approval races invariant零違反。
- [ ] Metrics/alerts覆蓋latency/error、approval age、bank integrity/denied、file orphan、import lease、audit failure且無高基數敏感labels。
- [ ] 同一恢復點還原DB、keys、General及Bank Sensitive files；抽樣decrypt/integrity/audit chain成功。

**Verification：**

- [ ] `DB_INTEGRATION_TESTS=1 npm test --workspace server`
- [ ] `npm run verify`
- [ ] 保存dataset version、EXPLAIN、p50/p95/p99、throughput/error/CPU/memory/locks、restore evidence。

**Dependencies：** T32、T36、T39、T46、T47

**Files likely touched：** performance harness/fixtures、metrics/alerts config、operations runbooks及必要的focused query修正。

**Estimated scope：** M

### T49：完成部署、Smoke、回歸及Release Gate

**Description：** 按design §13執行production-like部署、最小角色配置、smoke、全回歸、rollback rehearsal及簽核。

**Capability：** 所有

**Traceability：** OBJ-01～09、AC-001～052、SEC-001～014、NFR-001～014

**Acceptance criteria：**

- [ ] 最新main reconcile後migration/schema/index/seed hash正確，重跑no-op；startup self-check全過。
- [ ] 由system-admin明確委派獨立Bank role，不把bank權限加回system-admin；一般/approval/bank/settings角色最小化。
- [ ] Smoke涵蓋Draft、direct/approval activate、unique、defaults、credit、status/block、masked/reveal、attachments、import/export及downstream rejects。
- [ ] Forward-only rollback rehearsal成功；Bank問題不解密匯出、Import問題停止claim且不重做applied rows。
- [ ] Requirement/design/test evidence、known limitations、runbooks、backup/restore、Security/QA/Product approvals齊全。

**Verification：**

- [ ] `DB_INTEGRATION_TESTS=1 npm run verify`
- [ ] `npm run build --workspace client`
- [ ] Production-like smoke checklist及rollback drill全部簽名；未通過任一security/DB gate即No-Go。

**Dependencies：** T01～T48

**Files likely touched：** README/deployment/runbooks、release checklist、smoke/e2e suites及必要的最後修正。

**Estimated scope：** M

## Final Checkpoint：T47～T49

- [ ] 49個Task全部DoD完成，沒有跳過的Must需求或應執行測試。
- [ ] 263個正式requirement IDs在實作測試/evidence可追溯；AC-001～052逐項有結果。
- [ ] Migration、schema、permissions、security、performance、backup/restore、rollback、UI accessibility全部簽核。
- [ ] 未完成Business seed、key/scanner/storage或consumer dependency清楚標為release blocker，不以假資料／繞過方式放行。

---

## 4. 建議PR切分與執行紀律

### 4.1 PR原則

- 一個Task原則上一個PR；只有同一Checkpoint內互相不可運行的XS migration＋service可合併，仍須保留Task ID commit/PR標記。
- PR標題格式：`[Customer][Txx] <outcome>`；描述列Traceability、acceptance、verification output、schema/security/rollback impact。
- 每個PR由最新main建立獨立worktree；merge前fetch目標main。若main已移動，先在feature worktree rebase/merge main並解conflict、重跑affected gates，不能blind merge。
- Migration PR merge後不得改檔；發現錯誤加forward migration。共享hotspot由一名owner串行合併。
- Merge後按AGENTS.md清除已合併worktree及feature branch，不留孤兒。

### 4.2 建議review ownership

| 範圍 | 必要reviewer |
| --- | --- |
| Migration／index／locking | Backend Lead＋DB reviewer |
| Permission delegation／Bank／Bank Sensitive files | Security＋Backend Lead |
| Credit／Payment Term／downstream snapshots | Finance/AR＋Sales/Fulfillment owner |
| UI/UX/accessibility | Frontend Lead＋QA |
| Import/Export/retention | Data migration owner＋Security＋Operations |
| Performance/backup/rollback/release | SRE/Operations＋QA＋Product Owner |

### 4.3 任務狀態規則

- 只在Acceptance及Verification全部有證據後把索引勾為`[x]`。
- 外部依賴未完成時保持`[ ]`並寫blocker，不用mock/fake production integration標完成。
- Scope變更先更新requirement/design，再調整本文件的Task、依賴及traceability；不可只在PR描述改語意。
- 文件任務完成不等於功能完成；本文件生成時所有49個Task均保持未開始。

---

## 5. 完整需求覆蓋摘要

此表補充各Task內的細項Traceability，作自動coverage及Checkpoint核對；它不以range取代每個test name中的完整requirement／AC ID。

| Requirement range | Tasks／Gate |
| --- | --- |
| OBJ-01～09 | T12～T49；Final Checkpoint |
| KPI-01～09 | T13、T17～T26、T32、T36、T39、T46、T48～T49 |
| FR-LIST-001～010 | T13～T14、T48 |
| FR-VIEW-001～006 | T13～T16、T18、T20～T23、T31、T34～T35、T38～T39 |
| FR-CREATE-001～009 | T10、T12、T14、T29～T31 |
| FR-EDIT-001～008 | T06、T10、T15～T23 |
| FR-STATUS-001～008 | T24～T26、T32、T47 |
| FR-PARTY-001～008 | T08、T17～T21、T26、T47 |
| FR-CREDIT-001～007 | T09、T22～T23、T26、T47 |
| FR-BANK-001～007 | T05、T33～T36、T47 |
| FR-FILE-001～007 | T04～T05、T37～T39 |
| FR-APPROVAL-001～007 | T27、T29～T32、T42～T43 |
| FR-SET-001～006 | T06、T27～T28、T32 |
| FR-IMPORT-001～010 | T40～T46 |
| FR-AUDIT-001～007 | T07、T11～T49各適用寫入／查詢 |
| BR-001～042 | T03、T06～T47；Core/Approval/Bank/Bulk Checkpoints |
| SEC-001～014 | T02、T04～T05、T10～T11、T26、T32、T34～T39、T45～T49 |
| NFR-001～014 | T03～T05、T10、T13～T14、T26～T28、T32、T36、T39～T49 |
| AC-001～052 | T12～T49；每項在對應integration/E2E test使用完整ID |
| DEC-001～023 | T01～T49；scope/architecture review及Final Checkpoint |
