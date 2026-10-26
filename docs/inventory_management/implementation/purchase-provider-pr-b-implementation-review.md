# PR-B — Partial purchase reversal 精確來源審閱

Status: DEVELOPER_VERIFIED／CURRENT_CI_AND_SAM_SOURCE_REVIEW_PENDING。此文件為發布前快照；當前PR head及其實際CI結果以PR與後續Harness observation為準，不能從此處的PENDING推定已批准。TASK053仍IN_PROGRESS，TASK041/P4獨立。

## 精確來源與範圍

- Source fingerprint：`b77b0468e6d9b3f2239490c7be8e0e3fb5f14f9e2af4bc747361cfb6bd418273`。
- 已批准DESIGN：`a0e8e789cdbf9431c24fcc859b20a39cb1ba6a924aca2d51363349e058860687`；PLAN：`1e9cdb380f31153173dab9b4959dcd274665107b3d0435dad37a2ddcdc09b7c7`。
- [十八檔source／canonical增量patch（gzip）](purchase-provider-pr-b-source.patch.gz)，解壓SHA256 `32da2f839a93d15e625786b3f4f1342d7bc50c721a636c5ec52a3aca634c5dfe`。原raw patch保留本機，完整PR另含狀態、交接及最小化驗證文件；不將raw logs／XML／credentials／browser traces公開。
- 已整合main `1e57380e9df8fb7c0563a176921b86fb6e81682b`；本機整合commit `01780e8dc54cc9a77051ab3d074211158206e96b`。源碼fingerprint可支持後續內容／spec完全相同的提交，但CI與Sam來源批准仍須綁實際候選head。

只新增partial Purchase reversal、0101 additive immutable links、可信強認證context、scalar replay/query及相應測試；四檔原GR proof修訂為Sam已實際批准的精確候選。Receipt1.0、generic full reversal、Item來源、InventoryLockService、共享transaction/auth framework及原DDL不改。完整ABI及consumer順序見[正式契約](purchase-provider-contract-v1.md)與[交接](purchase-provider-handoff.md)。

## 實作與風險控制

整批1–200行先claim全部source，再依現有全域鎖序處理Warehouse／Control／Bin-lock／Lot／Balance／原Movement及current links。每原Movement累計不得超量，逐Bucket守allocated底線，整張最終效果不得惡化Reserved覆蓋；missing Balance不重建，持久receipt tracking/UOM及原事實不變。每行Movement／link／Audit與scalar結果均在同一caller交易，任何後段失敗全回滾；Inventory不替consumer commit。

來源固定原GR＋reversal event＋原GR Detail；同意圖重送保留event，回原scalar結果並重查真JWT／password/device策略與current authority。proof只能由consumer同交易已鎖原rows投影，不能來自browser body。新consumer rows在真Inventory ID回傳後才INSERT正式NOT NULL FK；GR已REVERSED只允許exact replay。Inventory不能證明任意同process惡意caller誠實，consumer TASK008仍須用真實production接入驗證ownership／tx及錯誤傳播。

真實新增Lot在Warehouse等待後commit、但舊RR快照缺Lot facts時，不能當成無效期而錯算ATP；目前fail closed為CONCURRENT_OPERATION、整批回滾並保留原event重試。joined locking read限制實體目標，避免額外Operation X鎖及其他Lot晚到S鎖；實際P_S鎖觀察與原不安全POSTED反例保留，未虛稱已重現完整deadlock循環。

## 實際驗證

[最小化摘要](purchase-provider-pr-b-validation-summary.json)列25/25必需開發組PASS，全部專用組零skip，包括B35真MySQL、真auth每runner21子案例（A8＋B13，不重複計成42個獨特案例）、A32、Purchase90、Inventory207、原Receipt／Reservation／lock、Movement48／Transfer32／P2與P3 API、Sales48、server單元2426／client940、真Playwright16與明示mock18及lint/build/audit。十張當前圖片已實際檢視，console／network沿原oracle核對；仍LOCAL_ONLY。

完整native採現有四分片及官方V8 merge，所有原native案例合計3715 PASS／0 FAIL／207 guarded skips；後者不算正式驗收。全局95.59／87.34／94.17高於原92／83／90，39個當前floors通過，原Harness floors再執行PASS。未重跑來源、命令、依賴、環境與語義均未受影響的24組；所有結果保留原source／spec身份，不用舊PASS冒充新候選。

原wrong-prefix全庫run3643 PASS／72 FAIL／207 guarded skips保留FAIL，72個錯誤均來自現有Fulfillment owned-runtime guard；[環境preflight](purchase-provider-pr-b-environment-preflight.md)核對互斥namespace及必要provider/key-ring名稱，最小正確prefix真MySQL場景先1/1通過，再完成上述四片。原缺報告目錄、單元LCOV缺native floors、TDD、fixture、認證及故障注入失敗亦保留；不改guard、資料量、skip或期限。

## 評審真實性與SELF處置

各增量使用實際獨立agent與精確scope/hash：validator/schema/ledger、1.1 context、partial provenance／locking、原生oracles、真auth及新增R25–R35；沒有宣稱最終十八檔同時獲新agent全綠，也沒有第四輪。最後R33測試缺口以真第二Bin庫存隔離Reserved／allocated，被限定第二輪審閱；刻意移除allocated guard時R15/R33確實失敗，產品逐byte還原。

root SELF_REVIEW核對五軸、完整source映射及最後文件／機械處理：原approval record漏module-qualified subject，保留原記錄並從同一實際Sam決定新增明確module-ID對照，不擴張批准；四個metadata recorder自身在native manifest之後產生的V8物料只含recorder及官方merge腳本，已逐一分類並原byte保存到私有recovery map，不放入native aggregate。沒有刪改任何native test report、原manifest、案例或threshold，三個確定性分類斷言通過。上述SELF處置請在最終Sam來源審閱中一併確認；跨模型依Sam全面略過，不重問。

## 合併與交付條件

目前未取得此完成實作的Sam獨立來源批准，亦未觀察最終head當前mandatory CI；不能TASK053 DONE或合併。全部當前CI成功、合併前fresh main必要整合及Sam精確來源審閱後，才依既有授權正常合併，不用admin／CI bypass。合併後記錄真merge SHA並更新Issue267／交接，consumer TASK008仍須真實採用、same-tx passing、unknown commit、dependency unavailable與全projection rollback證據；未有該證據只稱PROVIDER_DELIVERED，不稱Purchasing整體解鎖。

P4完整容量／soak及未合併真Stocktake Start聯測不綁此provider，也不以main reader fixture假充已執行。所有本次owned SQL／schema／交易／app／daemon及合成憑證均已精確清理；原始資料留本機不公開。
