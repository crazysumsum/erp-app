# Decision Required — PR-B Reversal owner proof／source identity

Current disposition: Sam已實際批准精確四檔v2候選（原patch SHA256 `92441af3f95e459e0d8bf3b045e146b5434271c419d67c557566c2c27444bf79`），已採用於PR-B；目前為IMPLEMENTING，最終實作來源仍待獨立Sam審閱。下文與review JSON的NOT_APPLIED／PENDING／NOT_RUN是批准前歷史快照，不改寫原評審或舊驗證結果。公開patch採確定性gzip封裝，解壓內容與原SHA逐byte相同；原raw patch保留LOCAL_ONLY。

Status: CANDIDATE_NOT_APPLIED。PR-A已合併；只修訂未交付的PR-B，TASK-041獨立。

## 實際矛盾

原已批准provider §2要求issuer使用「已鎖定的新reversal header/detail rows」；同節要求Inventory source使用新header／detail PK。但Purchasing正式schema §4.12／4.13的新rows必填Inventory結果，尤其detail的`reversal_inventory_movement_id`／`reversal_inventory_operation_id`是NOT NULL FK，header的result亦不可空。因此不能既先有真實rows發行proof，又等Inventory執行後才取得它們的必要IDs。MySQL不會延後FK至commit；不能用fake／NULL／空回執或獨立預提交化解。

## A：建議的精確四檔候選

候選 [完整四檔patch v2（gzip）](purchase-provider-reversal-owner-proof-candidate-v2.patch.gz)，內容只改正式provider addendum、其Inventory provided pin、Purchasing設計§2.4／§2.6／§8.8／§8.9及其manifest的對應consumed／provided pin。canonical與產品尚未套用；[初版patch（gzip）](purchase-provider-reversal-owner-proof-candidate.patch.gz)原樣保留，不以新版覆寫歷史。

- DESIGN `a0e8e789cdbf9431c24fcc859b20a39cb1ba6a924aca2d51363349e058860687`
- PLAN `1e9cdb380f31153173dab9b4959dcd274665107b3d0435dad37a2ddcdc09b7c7`
- 四檔patch SHA256 `92441af3f95e459e0d8bf3b045e146b5434271c419d67c557566c2c27444bf79`
- Receipt 1.0及已合併PR-A完全不變；未交付Reversal定名`inventory-purchase-provider/1.1`。
- Reversal source.documentId固定原GR ID＝goodsReceiptId；sourceLineId＝originalSourceLineId＝原GR Detail ID。本次event區分不同部分反向，exact replay保持原event。新Purchasing header/detail PK不再作Inventory source，因此無需預先存在或預留。
- `options.ownerProof`精確為`{goodsReceiptId,status,details:[{sourceLineId,goodsReceiptId,originalMovementId}]}`。由同RR transaction已鎖定的原GR／原Details投影，逐項及完整集合核對；reject unknown／extra／missing／duplicate。Committed GR狀態可CONFIRMED／PARTIALLY_REVERSED／REVERSED；REVERSED只准fresh-auth exact replay，新執行明確拒絕。
- Inventory成功後，Purchasing在同transaction INSERT新header/details，直接填真實Movement／Operation ID及完整結果，再更新PO／GR及Audit。任何後段失敗仍包含Inventory全數rollback；不新增staging狀態、空FK、ID allocator或schema例外。
- 對賬逐原GR＋反向event＋原Detail連接已持久化的Reversal header／detail，核對每個Operation／Movement／原Movement／quantity；不比較新Detail PK，也不將多次部分反向按原Detail ID合併而遺失event。

取捨：改變尚未交付的Reversal source/query映射及consumer結果對應方式，必須採用1.1契約；好處是只需既有真實rows、保留正式FK並避免循環。原Lookup未知commit語義、claims先於全域鎖、累計current links保護、high-risk JWT/password/device、所有原timeout及1–200行均不變。新GR已REVERSED的重送仍能取回原結果，不會因目前剩餘0而誤拒絕；新event不能藉此加反向量。

## B：維持新Reversal PK來源語義，先另設完整staging／ID配置方案

不採用A；目前強認證／provider整合保持阻擋。需要另定安全的ID所有權或staging workflow、正式schema／FK／commit完整性與相容性，不能直接插占位rows或只放寬proof。優點是可維持舊candidate的PK來源對應；代價是新增架構／schema及更廣驗證，且目前沒有可直接採用的精確B patch。推薦A，因未交付Reversal尚無歷史資料需轉換，Receipt無需修改。

## 相同範圍及必要驗證

沿用已批准的PR-B來源／測試路徑，不擴改Item、auth framework、LockService、generic reversal或既有schema；0101保持已驗證原bytes。profile／命令／minimum／deadline／coverage／CI皆不改。新ownerProof、source identity、REVERSED replay/new-event分流及consumer後置INSERT的fault rollback補進既有單元／真DB／真認證與ABI套件；全部新語義目前NOT_RUN。固定最終候選仍完成原全部必需回歸、Gate／coverage／Playwright、當前CI、最新main及Sam精確來源審閱，不綁P4容量／soak。

原80個單元及schema最小3個真MySQL PASS只適用其已記錄的舊契約／來源，保留原報告；migration本身的DDL證據可保留原適用範圍，但不當作新1.1 provider已驗證。不存在B持久正式業務資料；本次schema-only runtime已清理。PR-A已於Issue267交接，不因本候選撤回。

未獲Sam實際A批准前不套用四檔、不改受影響產品，也不發行假proof；不推送／PR／merge未知B來源。選A將一次批准精確DESIGN／PLAN及同scope修訂，之後直接TDD／最小原生→完整必要Gate，再交最終來源審閱；不再逐個工具方向詢問。跨模型依站立授權全面略過。

## 真實評審與結構檢查

首輪獨立唯讀 `/root/purchase_b_owner_proof_contract_review` 核對四檔及schema，確認FK循環；另報P2：Purchasing §8.9仍以新Reversal Detail PK對賬，與新source映射不符。已最小修訂為逐event明確連接及逐行結果比對，更新Purchasing provided pin；Inventory DESIGN／PLAN不變。第二輪僅審§8.9、衍生pin及v2 patch映射，未發現剩餘可操作P0–P3；未改段落沿用首輪，沒有宣稱全部累積來源重新獨立全綠。跨模型依Sam全面略過；兩輪實際回覆與hash見 [評審紀錄](purchase-provider-reversal-owner-proof-reviews.json)。四檔patch可於當前canonical乾淨套用；所有新語義仍NOT_RUN，沒有runtime或最終實作批准。
