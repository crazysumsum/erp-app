# TASK-048 — 限定 IMPLEMENT 進入方案（待核准）

2026-10-14；只處理 Item。這是執行方式／權限提案：provider DESIGN與profile／核心runner／gate／驗收標準不改，但限定 native 路由是實質執行變更，須納入 canonical PHASE-010／TASK-048，產生新的 PLAN 並另外核准（HD-014）。本文件完整版本 SHA 由 canonical PLAN pin 綁定；最新 PLAN hash 見規劃決策報告／state。現階段仍 DESIGN_AND_PLAN；未改產品、測試或執行 DB。

## 1. 根據與阻擋

- 已核准 DESIGN `3daef7460516dd7e24d5db5575a1b580dbc81f078d31a1c54867192bc1904a66`、原 PLAN `38b2a632f19a437c5b4b2040b39d60154c33df612fd651b515b978f05463901f`；APR-062／063 是原內容核准，不是新執行路由／IMPLEMENT／merge 授權。舊 PLAN／核准保留，不把 APR-063 改綁新 PLAN。
- 原內容核准後實際 `PLAN_READY` 只剩 DEF-107 HIGH／OPEN；加入新路由後還需新 PLAN 核准及 HD-014 決策。`harness_runner.run_suite()` 即使 DEVELOPER／IMPLEMENT 也會先執行全模組 PLAN_READY，所以換 mode 不等於 runner 可以執行；`MERGE_READY --phase PHASE-010` 也沒有 DEF-107 豁免。
- 最新 fetched main `fcfb172144f240db6a1d9b14cab1adbd0e4a597b` 相對規劃 entry `d9714a34` 只改 Supplier journal／SRE 文件，Item code／GR 接線未變。這不是新 baseline 已測試；開始開發前仍須再次 fetch／核對。
- TASK-048 的新唯讀 provider 不讀 GR／PO 正本或呼叫 verifier，不依賴 GR runtime 就能以真 MySQL 驗證自己的 current-facts 合約；這不能證明 completed GR 或收貨授權。

## 2. 建議：人類明確授權的本機限定開發／原樣命令

請另外批准本次新 canonical PLAN，及只對 PHASE-010／TASK-048 進入 IMPLEMENT／原樣命令直接執行／隔離資料與DDL的明確 scope，才允許下列本機開發與隔離測試。mode 可用 revision-checked checkpoint 改為 IMPLEMENT，但 overall status 留 BLOCKED、原 resume_status／歷史不改；不寫 PLANNED、IMPLEMENTING、MERGE_READY 或 READY_FOR_TESTING 假稱 gate 通過。這是一個明確批准、與 generic gate 分開的限定執行流程，並非 generic runner 的 partial gate 功能。

1. **先保全文件再從 fresh main 開發。** 本機 commit 目前已核准的 Item 規劃文件／真實 state，保留恢復點；不推送或合併規劃分支。重新 fetch／核對 default main，建立新的 DEFAULT Item worktree／`codex/` branch，再套用已核准的 Item-only 文件變更（不是從舊 topic branch 建 STACKED 分支）。若 main 的 Item 合約／規格已變、文件有衝突或新 DESIGN／PLAN hash 不一致，先停下重新審查／取得決策，不能盲目套用舊核准。無法安全保全／重建 exact 文件時同樣停下，不 reset 任何使用者修改。
2. **僅四個產品／測試檔。** `server/src/modules/item/ItemLookupService.js`、`server/src/modules/item/itemConstants.js`（僅實際使用的 warning constant）、`server/test/itemLookupService.test.js`、`server/test/integration/itemLookup.integration.test.js`；另允許 Item documents／本機 evidence。測試先定義 TC-019 的每個 leaf／expected behavior，執行 red，再實作／green／regression；只做已核准的 named method，不改現有 purchase／inventory／Sales／generic rules。不得寫 Supplier／Purchasing／Inventory source、schema／migration／permissions／CI／core tools；任何超出這四檔的產品／test 修復另請批准。
3. **真隔離 runtime。** 建立此 task 獨佔、只用合成資料的本機 MySQL instance／schema、socket/ports、media/import roots 及 process owner；不使用或重設共享 `erp_dev`、舊 runtime lease、正式資料或其他模組 DB。需要另明確批准：只在該新私有 instance/schema 建立測試 schema、套用 repository 現有 migrations，並允許已審查 Item suite 的暫存表 CREATE／DROP／fixture teardown；不新增或改 migration、不執行任何共享／正式 DDL。使用隔離帳號、原 env allowlist／redaction，密碼不放 argv／文件／輸出。原 suite 有其他模組 fixture/migration 依賴，只是重用隔離測試依賴，不是開發其他模組。清理只停自己 process／刪自己有 ownership 證據的 synthetic fixtures；保留 datadir/證據供恢復，不無限擴大刪除範圍。
4. **直接執行原樣 DEVELOPER 命令。** 不使用會被 PLAN_READY 拒絕的 `run_check --execute`，不修改／monkey-patch runner、過濾 DEF-107、複製一份削弱 gate 的 context 或偽造 run.json。依下表原 profile argv/cwd/timeout/tool probes/env allowlist/result adapters/required case mappings/minimum/zero-skip/cap 執行；只有 `{run_dir}` 展開為每次新的私有 evidence 路徑。Red 是預期失敗的測試先行證據；完整四套 final green checks 仍必須全部實際通過，red 不算 final gate credit。
5. **先保留本機成果，不交付合併。** source review／完整四套 developer checks 完成後，可以建立本機 candidate commit；只標示 scoped developer verified（如果真的通過），不宣告 TASK-048／PHASE-010 全部 DoD/exit、full TC-019 acceptance 或整個 Item ready。這次授權不包含 push／PR／merge／部署／raw evidence export；要發佈 candidate、CI／PR 或安排 merge，再提出目前實際 gate／證據／授權情況。即使未來 CI 全綠，DEF-107 仍不會因此被移除或當作 MERGE_READY。

## 3. Frozen command contracts

命令權威仍是 `00_project_profile.json`，此表列出目前原 suite contract SHA-256（完整 suite JSON，含原 argv、env、tool、adapter、case mapping、timeout／skip 等）。不得自行替換命令、刪測試或降門檻。

| Suite | cwd | timeout | Adapter／skip | Contract SHA-256 |
| --- | --- | --- | --- | --- |
| lint | repo root | 600s | EXIT_CODE／0 | `d9b002f5b56a257ac2f45384ae4c8a35adf99e52ecc80d9bc2a9d8c6460b8e07` |
| client-build | repo root | 900s | EXIT_CODE／0 | `6c93f2b0ad4edee06fbef51a3028f476695c6716f11bdd4a85edeae6b1a4fb09` |
| item-server-technical | server | 3600s | JUNIT／0 | `2e1f25a5eea21d72e9b44728d547bb2e3dccae238d4cfdb4039fe87f6a40ff2e` |
| item-client-technical | repo root | 1800s | JUNIT／0 | `3aab64f1e11788965f2bec72865bacc1e9bdbf7d371835270d796ebe600f6c36` |

Server command 已包含既有 Item unit／real-MySQL/reference suites、Sales UOM compatibility 以及會新增 TC-019 的上述兩個既有 lookup 檔；不是只跑兩個 focused 檔冒充完整四套。新測試寫好後、執行前，固定本次預期 leaf names/數量與 required mappings；真實 JUnit leaf 必須涵蓋全部預先定義的新案例及原 required-case IDs、0 skip／0 NOT_RUN。Profile min_tests=1 本身不證明完整發現，不能以空結果／parents 充數。保持原 coverage thresholds；merge 用的五項 CI 是未來另外的 gate，不由這四套本機測試替代。

## 4. 證據、校驗與停止條件

每次直接執行保存獨立 `scoped-developer-execution.json`（不用／不登錄為 generic Harness `run.json`）與經驗證、大小受限、遮蔽並分類檢查的 JUnit/build/lint outcome／logs，只留本機 Item evidence。原命令產生的未遮蔽材料僅在 task-private transient capture 做大小／XML安全／原leaf/status檢查與SHA-256／byte count；完成遮蔽後重新解析，確認leaf identity/count/status及required IDs沒被篡改，才保留遮蔽版。未遮蔽版只保留hash／byte metadata，不長期保留／匯出plaintext；若含secret/PII、無法安全遮蔽、超cap或無法核對，只留hash及安全錯誤摘要、標BLOCKED，禁止輸出或提交材料，未遮蔽transient不作長期diagnostic retention。不能只遮蔽logs而留下未審查JUnit或build artifacts。明示 stage=DEVELOPER、execution=native-authorized、generic PLAN_READY/MERGE_READY=BLOCKED、TC/UAT acceptance=NOT_RUN。保存確切 argv/cwd、時間、exit/timeout、實際 leaves/fail/skip/NOT_RUN、tool probes、命令與文件/原輸出及遮蔽版hash、DESIGN／PLAN、HEAD、source fingerprint、runtime/fixture及清理觀察；執行前後比對 frozen source/spec/command，不以舊 run credit 代替。

可重用既有只讀 result parser／hash／redaction 方法作觀察，不呼叫修改過的 gate/runner；gate 結果不重寫。Built-in redaction不是完整機密檢查，JUnit/build/JSON/logs都需額外分類及secret檢查。Build/lint 只用 exit結果，不偽裝測試 leaf。完整成功必須滿足 profile及預先列明的 TC-019 developer expectations；建立新 test/script/source後先固定其 byte/hash再跑，測試期間不改自己baseline。檔案大小上限、timeout、skip、missing required cases、工具／環境不符、DB／應用錯誤都如實 FAIL/BLOCKED；不能靠縮小案例、重試或模糊狀態變PASS。

發現 scope/contract drift、無法證明 runtime ownership、非task資料／secret、不相關 regression failure、未知 commit outcome、source/spec drift或任何需新權限的修復，停受影響路徑並保全證據。不得為了 green 修改其他模組、產品規則、斷言、threshold、權限或新 fallback。全部40 historical generic-run pointers、failures／waiver及原 review 保留；不把本機四套 direct results 加入 generic evidence index 或當 formal TC-004/005／GR-positive PASS。

## 5. 不變事項及決策

DEF-107 維持 HIGH／OPEN、risk_approval_id=null、closure_evidence 空；TASK-043 IN_PROGRESS，GR-01/02/03 BLOCKED。既有 Recovery owner waiver／TC-016 NOT_RUN、全模組 PLAN_READY／MERGE_READY／READY_FOR_TESTING 的真實阻擋、required suites/CI/review/正式UAT/business/release接受均不改。這次不是風險 waiver、DEF close/defer/downgrade、generic gate exception、正式測試／UAT接受或release授權。

**選項A（建議）：** 批准包含本文件 exact SHA pin 的新 canonical PLAN，另明確授權以上限定 IMPLEMENT＋四檔測試先行/實作＋新私有 MySQL現有migrations/暫存DDL＋原四套命令直接執行＋本機candidate／獨立review；可先交出 Item provider 的實際開發證據，但需明確接受「本輪只有限定開發結果，整體仍BLOCKED，不能合併」的邊界。

**選項B：** 全部保持 DESIGN_AND_PLAN／NOT_RUN，等待權威 GR 就緒或由工具 owner 正式提供 partial-gate 能力；不寫產品／執行測試。其代價是獨立 provider 開發也等待外部依賴。

**預設：** 在收到新PLAN／本文件確切版本及明確執行scope的批准前，只保存／審查此方案；不改 mode、不 commit／push產品、不啟動 DB或執行測試。若想本輪 push/PR/merge/證據匯出，需另外決策，不包含於選項A。
