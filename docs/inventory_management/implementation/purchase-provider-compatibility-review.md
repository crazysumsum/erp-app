# PR-A — 集中相容性修訂候選

Status: DECISION_REQUIRED / NOT_APPLIED / runtime NOT_RUN。沒有變更目前受測來源；下列五檔修訂只存在私有候選及附錄 patch。先前四檔候選及其問題已撤回，未獲Sam回答，不可據其按鈕答案推定第五檔批准。

## 必須決定的範圍

PR-A 的既定 Gate 發現主線已有的 Item 接入相容性問題。最新 main `58322ba3d5b77aa1a6250be4b5055651c682a371` 的 GitHub CI success（run39891885374）不覆蓋本次全部獨立 P3 developer Gate。不是把原來綠燈當作這些場景通過。

1. Adjustment／generic Reversal 的 current-read adapter 會附加 FOR SHARE；ItemLookupService 的現行方法自己已有 FOR SHARE。真 HTTP 回500；同 request 堆疊定位到 Item UOM read，原 main 檔案與現在相同。隔離 MySQL26.7 實測重複子句回 `ERROR3569: Table item_uoms appears in multiple locking clauses`。此項不是新 receipt batch 的 posting failure。
2. 原 lookup API 的 DEV-029-LOOKUP-05 要求同一 RR 查詢快照：先讀到舊 Code，並發改名／停用後本次仍回舊200，下次新 transaction 才回舊Code404／新Code400。現在它在 findByCode 後再呼叫 Item 的 current-lock profile，混用不同讀取語義，原測試回400而非200。
3. 舊movement最小fixture缺少items.version／item_skus.version，現行Item方法需要兩欄。隔離原生schema直接SELECT已回ERROR1054；本候選只在兩個CREATE加入與現行Item migration相同的unsigned version default1，不新增測試資料量或改任何案例／斷言。

## 精確候選

[五檔完整 patch（無損gzip副本）](purchase-provider-compatibility-candidate.patch.gz)，解壓後SHA256 `691874a5450edfcca5c149afec620e35cdd77d20ed9fa7e719e829d31719a870`；`git apply --check`通過。原raw檔維持本機原路徑／bytes；壓縮只避免patch空白context被Git hygiene當成新增行尾空白，不改批准內容。舊四檔patch `0f259b32…` 與修訂前五檔 `752b43de…` 保留為已撤回歷史，不是待採用版本。

|額外路徑|最小修訂|候選SHA256|
|---|---|---|
|server/src/modules/inventory/inventoryAdjustmentPosting.js|直接把原tx交給Item current-profile／UOM方法，使用Item既有鎖，不重複附加SQL|cde22d309d3b16d03b49612e0de553b351bbd97cfe0c618490f7dae7e3405b6f|
|server/src/modules/inventory/inventoryReversalPosting.js|同樣交原tx給Item profile方法|88346bed2a96218e4f45c9adea773efa3d1d4cc7be1748de3fd6e4a74eb44c60|
|server/src/handlers/inventory/skuLookupHandlers.js|使用既有findByCode完整唯讀projection及相同Base UOM檢查，保留單一RR快照|92cb6deece71c820b59f441f42254b8e67c5264674705a39b19c63150654bd62|
|server/test/inventoryTransferHandlers.test.js|實作查詢數7→2、UOM查詢索引2→1；加強不得FOR SHARE，保留所有業務／回應／eligibility斷言|919d10b68ebff9c0f7c5407ded08871ae116b864ecc3ac295db9d71335dbab81|
|server/test/integration/inventoryMovement.integration.test.js|最小Item父表fixture補items.version及item_skus.version；既有items INSERT改具名欄位以用version預設值；所有case／斷言不變|c0c9b48ddfe5a112b5b92fd1276a781c7c9e00b312b97202f37b09d9af42ff18|

這是原收貨provider狹窄實作範圍的五檔例外，以及一個既有unit低階SQL觀測斷言的明確例外。已批准 DESIGN `7f09c816390b1d129bdb905566121b2000d04efca9c72e030f7772b1f1e10ded`／PLAN `ceb152c51c6a9cc4528d6ac8ef707902cdca7bd9c99989bf6679452f213283d9`的業務、安全、驗證命令／資料量／期限／門檻維持；採用時須記錄Sam實際SCOPE例外，不虛稱原窄範圍已涵蓋它。不修改Item來源或pin、不改migration／正式schema、不加route、不改auth或generic反向的完整一次語義。

## 驗證及評審

原P3真browser16例本輪11PASS／5FAIL；P3 API及movement Gate尚未通過。原18例明示mock browser、P2真DB/API、既有Receipt／Reservation／Lock、Transfer native、PR-A32例native及8例HTTP等各以實際報告追蹤；不將它們替代失敗Gate。

三輪實際唯讀候選評審：第一輪抓到移除adapter後一個UOM呼叫仍引用舊變數，已修正；亦抓到原unit對7個query的斷言必須明確納入範圍，故新增第四檔候選。第二輪對四檔及patch映射未發現可操作問題。root後續核對原native fixture缺version，加入第五檔；第三輪抓到既有positional items INSERT須改具名欄位，最後這一處機械修訂由root SELF_REVIEW處理，沒有第四輪agent背書。最小真MySQL探針確認新欄位default1／具名INSERT／SELECT FOR SHARE成功，探針schema已精確刪除；不是整個candidate runtime PASS。需Sam在本次一併處置最後SELF修訂。跨模型沿用全面略過。

採用後先確定性TDD／最小MySQL驗證，再重跑Adjustment／Reversal交易、原子回滾、原P3API及真Playwright、Receipt/Reservation/Lock和全部PR-A必要Gate／coverage／當前CI。舊fail保留；不刪測試、不減資料／門檻、不延時。當前已開始固定來源的測試先完成及精確清理，才可採用修訂。

## 選項、取捨及預設

A（建議）：批准以上精確五檔scope／低階unit斷言／最小fixture例外及最後具名INSERT的root SELF修訂，納入PR-A相容性修復並完成上述驗證。保留一條交付線，新增的風險是要驗證舊Adjustment／Reversal／lookup接入，因此保留所有既有Gate。最終仍交Sam審閱完整PR-A精確來源。

B：保持PR-A產品範圍，將同一修復作獨立前置PR；PR-A在相關Gate恢復前保持未就緒。可獨立回滾／審查，但多一組branch／CI／merge依賴，仍不等待TASK041。

未回答預設不採用這五檔、不更改舊unit斷言或fixture。這不是請求本機資源／跨模型／推送／合併許可，也不是TASK052／P4完成或Purchasing已解鎖。依已批准plan的精確來源範圍與Harness Major Impact Gate，需要這一次集中scope例外；沒有逐項工具方向決策。
