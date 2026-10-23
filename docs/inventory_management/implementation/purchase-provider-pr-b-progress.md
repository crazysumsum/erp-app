# PR-B — 部分反向 provider 實作紀錄

## 已交付 A／B 入口

PR-A #275實際合併於 `5c055d79e94c74e58ccb27afe0fc3e0bd3edf151`。精確整合head `cf202bb9dac0d410e58115867d2a04fe67862e46`的十三項CI全部SUCCESS；真merged coverage 95.78／87.26／94.27、現行39 floors通過。

Sam實際批准原27bf來源／SELF及Supplier-only整合的新head／限定證據適用性處置。二十一份未受影響的原developer報告保持原fingerprint，新lint真實重跑PASS；通用whole-repository MERGE_READY的BLOCKED原報告保留，未改成PASS，未豁免CI／coverage／repository protection。本次限定處置不延伸至PR-B產品變更。

已合併A本機／遠端分支及worktree已移除。所有本機資料（不含可重建node_modules及Git指標）已先封存、解壓逐檔比較一致；私有封存 `/private/tmp/erp-inventory-purchase-a-archive.lWG8g3/worktree.tar.gz` SHA256 `0a1d6fbf1a02af24c8b9d3d872e74f1de3148a6272ee20175a5e61ddc0d580c0`，仍LOCAL_ONLY。原511個run refs及檔案另於B本機保留，不冒充B驗證。

B在 `/private/tmp/erp-inventory-purchase-reversal`／`codex/inventory-purchase-reversal`，從fresh main上述merge commit建立，不stack未合併A／P4。DESIGN／PLAN維持已批准版本；0101 migration號碼目前空閒。TASK-053 IN_PROGRESS，TASK-041／P4未改。沒有啟動B的MySQL或HTTP runtime。

## 增量一：輸入及業務 identity

修改前範圍：只增量 `inventoryPurchaseValidation.js` 的reversal normalization／business payload與hash、`inventoryConstants.js`兩個已批准command、新 `inventoryPurchaseReversal.test.js`。不改既有receipt normalizer、Item、鎖序、Audit、交易或認證來源。

重驗理由：新strict ABI與hash會成為所有claims/context的安全輸入；先確定性測試，並回歸既有A的37個單元／ABI案例，尚不啟動MySQL大型fixture。

實際TDD：初始新24例全部FAIL（API尚不存在）；新增normalizer後59 PASS／2 FAIL（real Operation hash拒絕尚未註冊的兩個新command）；補齊既定command名稱後新24＋原A37＝61/61 PASS、零skip。只證明正規化／業務identity與A相容，不代表部分反向交易、schema、HTTP、並發或PR-B已完成。完整新原生／認證／回歸／CI及Sam最終來源審閱仍待完成。

第一輪獨立唯讀評審 `/root/purchase_b_validation_review` 指出P3 sparse Array缺口，已核對成立：新增案例先1 FAIL，再僅將新reversal的map改為Array.from，62/62（新25＋原37）通過。第二輪針對此修訂未發現剩餘可操作問題；不是完整B／DB評審。刻意移除originalMovementId去重guard的mutation被具名案例捕獲（Missing expected exception），隨後完整還原product SHA256 `49a94117517975f5379893e4c18ce845acfecdb5f41658a53b1a1bbedc448264`，lint／diff hygiene通過。新單元的正式Harness報告在目前來源另行記錄；舊24例報告仍保留原來源。跨模型按Sam全面略過，沒有第四輪或未知來源批准。

## 下一個增量及完成條件

先TDD不可變reversal-link migration／replay ledger與強認證context，再同交易部分反向／allocated及Reserved保護。依批准計劃先最小真MySQL，再200行／並發超量／跨明細全回滾及既有generic reversal／Receipt／Reservation／Bin-lock回歸；不改原10／20／30秒期限、數量或門檻。Purchasing仍NOT_UNLOCKED，B provider合併及consumer實際採用分開追蹤。

## 增量二：不可變 links schema

修改前範圍：已批准且未占用的0101 migration、新reversal unit及native檔；不改通用Movement reversal唯一鍵或既有產品。重驗理由：DDL必須先證明完整約束、安全重跑及不覆寫不相容schema，才能讓B交易使用其累計資料。schema3例先RED（migration未存在），實作後unit28 PASS。獨立唯讀審查指出P2工具缺證，已增加三個FK／lookup index的DDL斷言及九種不相容metadata的「拒絕前不改DDL」案例；unit37 PASS，第二輪未發現剩餘可操作問題，未聲稱fake transport是真DB證據。

固定來源最小真MySQL26.7.0的R01–R03為3/3 PASS、零skip：fresh/rerun、generic舊唯一鍵、positive／unique／FK與不可變UPDATE／DELETE。R02／03使用明示schema-only FK fixture，不宣稱B provider過帳已完成。原始XML `/private/tmp/purchase-provider-diagnostics/pr-b-schema-minimal-02.xml` SHA256 `4f3e9c07bbb5a3e153ca18e2df8645b7859cd999776a6c4b0f356301b0f8106c`。第一次診斷命令少一個reporter destination，在Node參數解析即FAIL、零案例執行；修正命令後才有上述真DB結果，不覆蓋歷史。

本次socket-only runtime `/private/tmp/erp-inventory-purchase-b-mysql.QdV8f3`已確認無test schema殘留／連線／交易，精確刪除bootstrap schema、正常shutdown且daemon session exit0，socket/pid/process均不存在。MySQL原始日誌保留於私有diagnostics，最後只移除這次datadir與合成0600 credential檔。完整reversal native最低24例及auth最低12例仍未完成，這3例不代表完整Gate PASS。
