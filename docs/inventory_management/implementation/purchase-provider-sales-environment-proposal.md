# PR-A — Sales 原生 Gate 環境精確修訂

Status: PROPOSED / NOT_APPLIED。不是 PR-A 最終實作來源批准，也不是 TASK041 工作。

## 證據與原因

已批准五檔相容性修正後，source `d61831226863b95766949712d16e050280f96c72078ebc2e84e1ee8bdb7ac66a` 的 Inventory207、Movement真DB48、P3真API31、真Playwright16、Purchase單元28／契約9／真DB32／真HTTP8、舊Receipt／Reservation／Lock、server單元coverage命令2371、client coverage931及build通過，均以原始報告追蹤。這不是全局coverage及native floors全通過。

同來源的原Sales Gate `evidence/20261023T053803-afdeaff8de04/run.json` 為47/48 PASS、零skip；唯一失敗是取消流程的真 `SalesFulfillmentGuardService` 回 `SALES_DEPENDENCY_UNAVAILABLE`。完整migration已建立Fulfillment表，但預設off不載入provider，guard正確fail closed。現行`.github/workflows/ci.yml` native lane明定`FULFILLMENT_LIFECYCLE_ENABLED=true`。原Harness suite沒有允許該環境鍵，因此單在shell設定會被安全過濾，不能稱為同一Gate通過。

支持性對照使用同一三檔原argv、同一真MySQL完整schema及真provider，僅傳入上述現行CI值，48/48 PASS、零skip（私有原XML `/private/tmp/purchase-provider-diagnostics/sales-lifecycle-enabled.xml`）。不是原profile的Gate PASS；沒有fake、GITHUB_ACTIONS冒充、刪表或改權限。

另lint只發現新native測試一處Promise executor隱式回傳timer；已在既有批准測試路徑改statement block，不改期限／排程／斷言／產品。新source `6022ff1a2dfb888c39d7a32642c8723ab587217d277f19ce2f2052216a3e4453` 的lint支持性重驗通過；上述d618舊來源結果不冒充6022已重新執行。

## 精確差異與基線

只修改 `00_project_profile.json` 的 `inventory-p3-sales-compatibility.env_keys`，增加一個固定鍵 `FULFILLMENT_LIFECYCLE_ENABLED`，本機測試設`true`。其餘所有suite物件、argv、min/max skip、timeout、37 floors及CI不改。

[單檔完整patch](purchase-provider-sales-environment-candidate.patch)：SHA256 `8fff655c4f09bdaefbad2b6fcbd1ad20dd7a9780ded2436b00df91eb04cb37af`，`git apply --check`通過。

Profile候選檔SHA256：`84057d49277fa4188f39dcc0301040933532d09a0dc84fbd4e6ce1184abc421d`。

DESIGN保持 `7f09c816390b1d129bdb905566121b2000d04efca9c72e030f7772b1f1e10ded`；原PLAN `ceb152c51c6a9cc4528d6ac8ef707902cdca7bd9c99989bf6679452f213283d9`；精確新PLAN `74cd59d2b4e2ee79518406ef85d31c610f4dca75a17adff6baa4db8ba058c79e`。Canonical尚未套用，不能修改舊批准hash或舊run的PLAN。

## 收斂方式及取捨

A（建議）：批准此精確PLAN／單檔patch，沿用原來源範圍及五檔例外；以現行CI相同的真provider環境重新執行Sales Gate。保留已核對的未受影響證據／原始source與PLAN，不冒充新候選PASS；最終候選仍完成所有必要Gate、完整native全局coverage／37 floors、真Playwright、當前CI／最新main整合及Sam精確來源審閱。這是一次環境合約修復，不授權擴改產品或弱化Gate；若通用Harness不能接受未改命令的證據適用性，明示其機械限制，不重寫舊報告。

B：不採用，保留原Sales Gate FAIL及PR-A未就緒；不能靠停用真guard或消除Fulfillment表解鎖。代價是provider交付繼續阻擋。

這一環境鍵只讓完整本機fixture載入已存在的真provider，成本是增加原生測試依賴；不是部署啟用授權、不改production預設。原全局coverage允許由當前候選實際CI merged gate提供（原計劃已有），不增加CI豁免、不把單元coverage命令PASS等同全部floors。PR-A實作最終仍需Sam審閱；PR-B在A實際合併後；Purchasing尚未實際解鎖。

未獲實際回答預設不套用。跨模型依Sam全面略過，不再詢問；本次唯讀候選審查由 `/root/purchase_sales_env_contract_review` 實際執行，核對runner過濾、Fulfillment真provider、Sales guard、CI及兩份XML，無可操作發現。精確報告見[審查紀錄](purchase-provider-sales-environment-review.json)，不是完整PR-A最終來源獨立全綠。
