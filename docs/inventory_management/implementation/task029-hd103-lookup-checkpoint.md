# TASK-029 — HD103 lookup increment / historical HD104 boundary blocker

HD104已由Sam實際A回答，APR133將原樣0064 scope綁现PLAN；真13 API／27 unit及適用developer checks已通過。見[現行HD104結果](task029-hd104-lookup-verified.md)；以下保留批准前的觀察與原生blocker歷史，不代表當前仍待決策。

Sam實際「同意」批准HD103精確五文件patch／DESIGN／PLAN，已原樣套用及記錄APR128–132、REV080 HUMAN（未提供逐項review findings）。現行DESIGN `de32a25f52faeddc65234963935f44a4e73a6a505f44f52dca2283f5e6913f93`、PLAN `41949846cafde277c6887a7b572e0b3f945425d9a16f1b96517d99ca1674617c`。

## 實際變更與developer觀察

新增Inventory-owned `skuLookupHandlers.js`及既有schema內的query／response白名單；JWT＋inventory.view、raw string guard（既有框架開啟query coercion）、Item normalizer、同一交易executor的Item findByCode／inventory profile。沒有Item source、permission、migration、dependency或共用框架修改，沒有庫存資格查詢或業務寫入。

TDD RED：`node --test server/test/inventoryTransferHandlers.test.js` 實際ERR_MODULE_NOT_FOUND（未有lookup handler，exit1）；新增handler後，`node --test server/test/inventoryTransferHandlers.test.js server/test/inventoryTransferService.test.js` 實際27 PASS／0 FAIL／0 SKIP（exit0）。5個lookup tests驗證strict contracts／raw types、minimal response、同executor read-only Item reuse、資格及Base UOM錯誤；原22項保留。這是直接developer單元執行，非native套件或正式TC PASS。

其後在既有real API integration file加入5項lookup案例（總13）：Inventory-only／Item-only／撤權、無Balance Draft與Dispatch不足庫存、輸入邊界／literal %_／collation、資格及stale寫入、deterministic兩連線改碼／停用snapshot。尚未執行；單元27執行後增加了API tests，因此不可宣稱整體現source有完整native PASS。client／UI／Playwright尚未變更或驗證；正式TC006／UAT060仍NOT_RUN。

## 門檻結果與停點

第一次PLAN_READY實際因APR128/129的subject用TASK路徑而BLOCKED；檢查native has_approval發現它需module ID。保留原紀錄，APR131/132僅正規化同一Sam DESIGN／PLAN批准的subject，沒有增加產品範圍或更改hash；[修正後PLAN_READY](task029-hd103-plan-ready.json)在revision590實際LOCAL_CHECKS_PASS／0 issues，之後revision591恢復IMPLEMENTING。

真API controller在任何state／runtime建立前的whole-branch boundary precheck停止，實際 `SCOPE_APPROVAL_REQUIRED` 指向既有 `server/database/migrations/0064_create_inventory_transfers.js`。重現見[原生boundary blocker](task029-hd103-boundary-blocker.json)。原因：APR122只綁舊PLAN；HD103要求批准精確文檔／lookup/UI，並未明確重新綁定0064 sensitive-path批准。不得自己添加新的migration scope或放寬gate，也不以HEAD-only boundary替代原whole-branch檢查。

沒有MySQL初始化、schema、port lease、migration／HTTP／native suite執行；111 native evidence refs保留，未新增或改標新PLAN。Head仍`869ac07abdd3879254c351d857be911d71e68b6b`；現source `f58603c7911f24a18547254c097190eb3f6b18d66496ff14f7f8945a47e33f95`。0064 SHA256仍`07653bb700a40b026e8bb46b538e0e31b112d6c20010af45b4cc71a6ff7ac143`，byte-identical，沒有新DDL。TASK029 IN_PROGRESS／BLOCKED；無CI／commit／push／PR／merge或formal acceptance／UAT／release。容量4項仍NOT_EXECUTED，適用full-P3/release門檻不變。

## HD104 — Decision Required

Context：新DESIGN／PLAN批准已取得，lookup已依契約實作；原0064屬同分支既有TASK026且內容不變，但Harness要求shared/sensitive path的scoped批准與現PLAN一致，才能執行真API及后續本機驗證。

A（推薦）：批准將原APR122的**同一0064檔案及上述SHA256原樣納入新PLAN41949846**，新增基線綁定scope紀錄而保留原歷史；允許既有owned本機MySQL26.7.0流程原樣執行已存在migrations／合成fixtures／聚焦13 API、27 unit及適用developer regression，精確清理owned resources。沒有0064內容修改權限；若SHA改變，立即停止另問。既有HD103 TASK029 lookup／UI實作範圍沿用，無需再批准相同UI。

B：暫不重新綁定0064。保留已做lookup與測試，真DB/API驗證及TASK029完成保持BLOCKED；不繞過shared-path gate或靜默改查核base。

Trade-off／recommendation：A僅恢復既有、不變DDL的baseline-bound scope，不新增架構、schema或權限，可完成真API／DB及UI驗證；B不授予新增scope，但不能證明新契約的交易／auth或完成TASK029。Default：等Sam精確答覆，不再執行或擴張scope。選A也不授權publication／CI／main整合／merge、later Tasks、未來head independent review、formal acceptance／UAT／release或capacity豁免。
