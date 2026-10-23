# PR-A — 精確實作來源審閱

Status: CI_PENDING / SAM_FINAL_REVIEW_REQUIRED。不是候選設計批准重問；尚未取得Sam完整實作批准，不得合併。

## 精確基線

- Product commit：`4b9802e4483f41c3b4bb28bce35295428417a7b1`；相容性獨立commit `8d25b2af`。
- Source fingerprint：`6022ff1a2dfb888c39d7a32642c8723ab587217d277f19ce2f2052216a3e4453`。
- [19檔完整來源／測試patch（無損gzip副本）](purchase-provider-pr-a-source.patch.gz)，解壓後SHA256 `43dbbe6116d38c7ce73f0a884dceeb564d43879333039ab1ac76138a9cfd5502`，相對已整合／最新fetch的main `58322ba3d5b77aa1a6250be4b5055651c682a371`。Raw原檔本機原位保留；壓縮不改任何source／patch bytes，避免patch空白context被Git diff hygiene誤當新增行尾空白。
- DESIGN `7f09c816390b1d129bdb905566121b2000d04efca9c72e030f7772b1f1e10ded`；PLAN `74cd59d2b4e2ee79518406ef85d31c610f4dca75a17adff6baa4db8ba058c79e`。

產品檔沒有因commit或後續本模組文件改動而變更；原run的code_commit仍保留741864…，其相同source／依賴／命令／環境適用性由上述指紋及精確patch核對，不改寫舊run為新commit。當前CI須對最後發布head重新執行；若main再前進先整合並分析實際影響。

## 交付與範圍

原子`postPurchaseReceiptBatchInTransaction()`：1–200行整批source先claim、Inventory全域鎖序、同一caller-owned RR transaction、真正Item committed-receipt投影及現在授權、逐detail持久scalar結果／Movement／Audit。任一行或caller後段故障全回滾；同event replay原持久結果。獨立read-only lookup支援未知commit核對，不把NOT_FOUND當換event許可。

`InventoryPurchaseContext`只接受同request／真active transaction、固定route／來源／完整server intent的一次性opaque capsule；不信任browser proof或claimed permission。Receipt caller用`purchasing.view`＋`receiving.operation`，不授予`inventory.view`。真JWT路由測試是test consumer，不是已完成Purchasing正式HTTP／production proof。

Sam精確批准的五檔相容性例外保持原hash：去除舊Adjustment／generic Reversal重複FOR SHARE、lookup保持單一RR讀快照、明列unit SQL觀測及movement最小fixture版本欄位／具名INSERT。Item來源／pin、migration、正式schema、共享auth及generic full reversal一次完整語義未改。PR-A無新migration；PR-B部分反向／link persistence尚未交付，不能以generic路徑替代。

## 驗證：不同Gate不混稱

[最小驗證摘要](purchase-provider-validation-summary.json)列22/22組原開發suite的最終source6022／PLAN74cd PASS，專用組零skip。包括Purchase unit28／contract9／真MySQL32／真HTTP8、Inventory207、Movement48／Transfer32／P3真API31、P2原生7＋API、原Receipt／Reservation／Lock，真Playwright16＋明示mock18、Sales48、client931及lint/build/audit。原server單元coverage命令2371 PASS不是完整native全局Gate。

實際完整本機native run保留 **FAIL**：3563 PASS／74 FAIL／171 guarded skips；31字元schema被既有30字元Sales provider fixture在產品邏輯前拒絕，73個明示setup拒絕加父案例失敗。約679.8秒完整執行後才清理；沒有中途換來源／提高期限。短名稱最小真provider1/1只支持環境診斷，不能替代完整native PASS。

該run全局數值95.59／87.11／93.58達原92／83／90，獨立floors Gate實際通過目前main的39個高風險檔案（包含原37個，不刪減）；它們不抵銷失敗。依原批准計劃，可由**最後PR head實際CI merged native coverage Gate**滿足整體要求；當前仍CI_PENDING，絕不說本機整體已通過，也不豁免CI或降低資料量／門檻。

所有本次隔離schemas／daemon／listeners已核對SQL／交易終止後精確清理；私有合成credential檔隨其owned runtime移除。原失敗、raw logs/XML、trace/video及本機證據保留LOCAL_ONLY；對外只提交程式／契約／最小合成摘要，無原始憑證或業務資料。

## 評審 provenance 與剩餘限制

實際context／receipt ledger／stock／lookup-auth分段唯讀review與修正歷史見[progress](purchase-provider-implementation-progress.md)。相容性三輪及最後具名INSERT root SELF處置由Sam實際批准；新Sales env候選單輪無可操作發現、Sam精確PLAN批准已記錄。最後Promise executor機械修正為root SELF，不宣稱另有第四輪或整份最終來源agent全綠。跨模型沿用Sam全面略過。

尚需：最後head當前mandatory CI全部PASS、最新main整合、Sam本文件與完整patch的實際獨立來源審閱。Sam未回答前不記錄TASK052 DONE／merge。PR-B依A實際merge SHA後啟動；Purchasing consumer仍需TASK008真proof／tx／projection rollback／dependency fail-closed接入測試。真正未合併Stocktake Start聯測仍另記P4，不用fake補PASS，也不綁P4容量／soak作provider前置；TASK041未被修改或關閉。
