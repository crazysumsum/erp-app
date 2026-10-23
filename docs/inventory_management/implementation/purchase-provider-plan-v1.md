# Inventory Purchasing provider v1 — 驗證與交付計劃候選

與 `purchase-provider-contract-v1.md` 一併審閱。所有新案例 NOT_RUN；這是獨立交付，不是 P4／正式TC-UAT完成。

## PHASE-007 — 採購整張收貨 provider（PR-A）

### Objective
交付可由Purchasing caller同交易呼叫的200行batch receipt；依賴main既有Inventory P1–P3及Item committed receipt contract，不依賴PHASE005／TASK041。

### Entry criteria
Sam批准精確契約及本計劃；新main隔離worktree；consumer提供confirmed-row proof責任已明確。新source及migration scope按契約§5，不更動P4未合併來源。

### Acceptance criteria
所有source先claim，所有庫存鎖全批排序，同transaction中逐行結果一一對應；錯誤、重送、撤權及caller後段故障都由真DB證據證明。沒有inventory.view授權擴張或generic existing-commitment開關。

### Verification / merge trigger
TASK052全部檢查與consumer ABI檢查通過；現有Inventory receipt／generic reversal／Reservation native回歸及main既有coverage全部通過。當前候選所有mandatory CI、實際獨立review及Sam精確來源審閱，合併前fetch最新main並整合所有移動。依既有合併授權合併；保留實際merge SHA才宣稱provider A已交付。清除已合併分支及worktree。P4完整容量／soak不在此merge group。

### Rollback
尚無新schema；停用consumer接入／正常revert代碼。已寫Inventory Operation／Movement／Audit永不刪除。存在已提交新來源時不能令replay失去支援，故優先關閉新寫入、保留查詢／回執讀取，回滾須列明consumer影響。

## TASK-052 — 原子 purchase receipt 與可信 context

### Approach
先確定性單元RED→GREEN，再1–4明細真MySQL／真auth fixture；完成後跑200明細最大規模。每次變更先記影響範圍與測試理由。同一天本機隔離資源沿用Sam授權；版本須實測26.7.0，敏感資料不匯出。

### 必需案例
單元最少24例：strict schema／200上限／重複source／safe integer；none、batch、expiry；日期矛盾／expired／minimum life max；override reason／權限；PO snapshot binding／actor／tx／route／intent；所有claim先於lock；全域排序；重複Bucket順序；membership conflict／all-replay／mixed replay；scalar receipt／結果集合；generic caller拒絕。

真MySQL最少20例：1與200行成功；跨倉／多Bucket／相同Bucket不同PO行；共用Lot及DB collation等價Lot；第二行無效；Lot／Balance／Movement／第二Audit／completion故障；caller寫入後失敗；exact replay及改payload／membership衝突；並發相同event；反向行序並發／實際鎖等待；等待後撤權／位置變更；inactive或flag改變＋合法承諾；無效快照；真實allocator／Reservation回歸。每例查完整受影響表及original immutable rows，不能只查status/count。

context／真認證專用suite：PR-A至少8個receipt案例；PR-B擴充後總計至少12例。真JWT有效／失效／revoked／過期；wrong route／URL resource ID／actor／tx／intent／fake capsule；receipt權限等待後撤銷；真password＋device策略成功、bad password／device拒絕（reversal組在PR-B啟用）；尚未有consumer route時使用測試專用app route掛既有真auth middleware，明示不是已完成Purchasing正式HTTP/UI。

### Definition of Done
上述PR-A適用案例全部零skip、native26.7、ABI套件最少8例、lint／build／audit／coverage／現有native regression通過；來源hash與原始證據可追溯。不得用未執行reversal案例填A測試數，A auth suite至少8個實際receipt案例；B補齊至少12總案例。不是正式驗收。

## PHASE-008 — 採購多次部分反向 provider（PR-B）

### Objective / dependencies
依賴已合併PHASE007；自最新main建立新分支。一次transaction支援1–200行，並發累計不超原量，generic full reversal舊語義保持。

### Entry criteria
PR-A實際merge SHA；0101號碼與shared migration ownership重新核對；Sam已批准link schema／新receipt專屬反向ownership。若migration號碼被其他已合併工作占用，以新main下一空號作機械調整並記錄精確檔案／來源，不覆寫別人檔案。

### Verification / merge trigger
TASK053、A回歸、現有generic full reversal／Reservation／收貨測試通過；當前mandatory CI／review及最新main整合通過後依授權合併。Purchasing consumer以實際ABI／migration／tests／merge SHA交接，不以本機未合併代碼解鎖。

### Rollback
新表是additive且不可變，運維回滾保留資料／舊唯一鍵；不自動drop已使用table。關閉consumer新反向寫入，保留結果與link查詢。已寫partial來源只能由相容provider處理，不能fallback到generic。

## TASK-053 — partial reversal links 與並發保護

### Approach
先單元、最小真DB、再200明細／競爭；沿用same transaction及原10/20/30秒期限。每original先有current lock才算SUM links；所有受影響Bucket／Reserved以整批最終值檢查。

### 必需案例
單元至少24例：strict schema；來源／owner／receipt membership；同original重複；超量／safe integer；無足夠onHand／allocated底線／Reserved覆蓋；多Bucket；replay／不同quantity衝突；fresh auth／strongauth／device；完整global lock order；第二行／Audit／link rollback propagation；generic來源拒絕與result mapping。

真MySQL至少24例：schema fresh／rerun／FK／positive quantity／unique／immutability；連續部分3+2再剩餘；兩連線競爭各自可行但總和超量，只一勝；同event重送；不同payload；交叉多original順序；多行任一失敗全rollback；第二Movement／link／Audit／complete／caller故障；allocation和Reservation競爭；原Movement不變；現在lifecycle／tracking／baseUOM變更後仍按持久receipt policy驗證反向；不存在Balance拒絕；sameBucket累計；partial資料不影響舊generic一次完整反向；newreceipt不能generic反向；200行成功與結果逐項一致。

ABI最少8例包括獨立query的NOT_FOUND／COMPLETED精確映射、未知commit用同event找回、query撤權與corrupt／missing／extra member拒絕、以持久tuple重算membershipDigest；changed request correlation／輸入行序不改business replay，changed snapshot／membership／goodsReceiptId／reason拒絕。原生套件另含未提交時查詢NOT_FOUND、commit後新transaction取得完整結果、rollback後仍NOT_FOUND、可見未完成root拒絕；不把NOT_FOUND當新event重送許可。結果解碼使用real serializer/parser，不以fake operation繞過白名單。

### Definition of Done
上述新組零skip；原A、generic reversal、Receipt、Reservation及全repository必要CI／coverage通過。reversal auth suite在真JWT／password／device上驗證；依原操作最低權限而非fake trust欄位。實際merged SHA及可觀察consumer handoff完成，並確認consumer是否採用；不是P4或Purchasing整體DONE。

## Commands / evidence contract

精確argv／min／env／side effects已列在本候選的 `00_project_profile.json` 新增suite，cwd均為repo root，Node26；`{run_dir}`僅是Harness建立的本次私有報告目錄，不是任意shell字串。新native設 `DB_INTEGRATION_TESTS=1`及 `INVENTORY_PURCHASE_TESTS=1`，reversal auth另設 `INVENTORY_PURCHASE_REVERSAL_TESTS=1`，A不註冊B未實作案例、不以skip填數。各組少測試／任何skip失敗。新fixture只接受 `erp_inventory_purchase_*` owned schema；既有三組native維持各自原schema／flag／環境限制，不改舊測試。允許同一owned daemon建立各組隔離schema，工具除錯不得藉此啟動P4大型fixture。password及合成crypto keys不記argv或明文報告。單元coordinator600秒、native1200秒；不改product timeout。

PR-A四個新專用suite：receipt-unit≥24、receipt-database≥20、receipt-auth≥8、contract≥8；PR-B增加reversal-unit≥24、reversal-database≥24及reversal-auth≥12（包含A認證）。另新增三個既有native測試的精確runner，receipt／Reservation／lock各至少1個既有top-level測試，內含原子子案例不可刪改；並保留既有movement12及P2／P3 API／transfer／Sales回歸。正式TC011／012只增加既有formal suite case mapping，不改其命令或把developer結果當正式驗收。

每phase必要suite完整列在 `08_traceability.json`；包含原server/client coverage、floors、audit及實際Playwright回歸。現有suite的argv／minimum／timeout／env／stage均保持；formal suite只追加TC011／012 required IDs。現有profile的server coverage原命令未包含global thresholds，因此另要求現有 `npm run test:coverage --workspace server` 或相同當前CI的merged coverage gate實際通過（92/83/90及所有當前floors），不能只跑lcov就稱coverage達標。CI以workflow及branch protection確認，不只相信舊五項名稱；當前PR所有mandatory checks都須通過。

對現有main未合併的Stocktake：先驗既有Bin-lock reader的fail-closed路徑及main可用的native回歸；這類受控測試行需標明fixture。真正Start→receipt/reversal互斥聯合測試另記在P4整合清單，使用實際盤點程式及schema，不聲稱已執行、不作本兩PR前置。provider的實際庫存鎖／atomicity／Reservation／generic regression仍是各PR前置。

## Consumer handoff

以Issue #267與可追蹤文件交接：版本 `inventory-purchase-provider/1.0`、完整command/result/error ABI、caller-owned tx／proof及rollback責任、migration號碼、真測試case/result與實際合併commit。Purchasing TASK006／007以provider合併成果完成其依賴；TASK008仍要由consumer驗證projection／txpassing／dependency unavailable、禁止production fake及raw表fallback。未採用／未測試consumer前，狀態只能PROVIDER_DELIVERED，不能說Purchasing已實際解鎖。僅文件／Issue交接，不向其他chat發訊息。
