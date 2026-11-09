# TASK-036 Inventory owner：事件准入與零效果增量

2026-11-09。Sam PM真人 `01a1bed1-3a14-7db1-9e9e-ecbc10aa93fe`／`call_1501354670804769a0f370fc4e9223f7` item1批准限定真Shipment/event准入及本地候選；PM依TL具體邊界派本owner。僅IMPLEMENT本地source/docs/source review；**無新增測試來源、parser/import、lint/build/validator、DB/app/browser、CI、push或公開啟用**。BinMove候選及待批九情境不動。

## 固定來源及唯一差額

fresh main `06caf9119d72d940d88192d6ebc1cd6eb065847c`；PM指定共同實際介面 `b0c2c907242218fbd467fb0a6142a029f4127997`／tree `89c07b1747de56358d96d3d33bf0c95a1df24458`，包含Fulfillment作者的DB option、classifier及真caller。Inventory產品候選 `7fb93911c8f80aaf01036d99d1b1ba238638b8c9`／tree `f506ff3adc14d4fc4565180c7a9cb63839752398`。本文件後續commit不改該產品來源。

獨立worktree `/Users/sam/Documents/workspace/erp-app/.worktrees/inventory-task036-admission`，branch `codex/inventory-task036-admission`。9檔212+/42-；不修改sharedDB、Fulfillment、Sales、migration、tests、package／workflow。TL已針對精確`7fb93911`／tree`f506ff3a`作獨立component SOURCE ACCEPT、0 Required；該實際評審與先前自己的SELF_REVIEW分開，不是runtime PASS。

| 實際檔案／caller | 精確行為差額及來源限制 |
| --- | --- |
| InventoryOperationService | 唯一generic `claim`在第一INSERT及duplicate read前驗真early marker／owner分類；MANAGED再比event、真Shipment、actor、REVERSE root/member/leg類別，constructor verifier只來同owner instance。原command/source/hash/INSERT/replay不改。bulk claimReallocationChildren只PICK/PICK_LEG，不可能進受保護tuple、不改 |
| InventoryPostingService | 六個public outer receipt/adjustment/status/binmove/reverse/issue只為受保護tuple帶eventAdmissionId；default operations持同database。caller-owned InTransaction不晚取gate、不另開tx；無marker受控拒絕 |
| Reservation／Transfer／Stocktake三service | 僅default operations database及各真正寫入outer同一option傳參；原業務SQL、guard、case不改 |
| StocktakeWriteHandler.execute | 真HTTP繞過service outer，自開tx後叫InTransaction；故只新增同selector import及execute的event option。signal/current auth/commit前guard、準備／cached replay不改 |
| InventoryFulfillmentService | 真ISSUE/REVERSE入口先要求owner分類；REVERSE需同實例私有MANAGED及event/Shipment/fulfillment/actor對上。原payload只有fulfillmentId/shipmentId/lines，不發明SO/customer/warehouse欄位；SO/Warehouse與既有scope解析結果比對，customer權威由owner verifier承擔。用同database/constructor verifier建立operation實例 |
| InventoryLookupService | 真PhaseA consumer已在基線呼叫 `readShipmentEventAdmissionInTransaction`，轉接actual fulfillment instance；同一實例另轉三個已定zero read/verify ABI，不複製classifier SQL或簽token |
| inventoryFulfillmentOutcome＋service私有binding | 全event SHIPMENT/SHIPMENT_LEG查詢不按caller documentId濾；CLEAR只是PhaseA准入，不是零效果。zero context/proof用私有WeakMap綁tx/session/原遞迴frozen source與專用purpose/phases，fresh原actor view+reverse及真event marker每階段重驗；不造不存在的舊Inventory/Sales hash |

## 零效果的具體來源核對

1. `reversal.zero.inventory.prepare`用現存有效PICK_SCOPE及E_R event集合，缺scope不INSERT補建；整個event類別任何其他target/root/member/leg／pending列都保守UNKNOWN。
2. `finish`沿既有Warehouse→Controls→Bins/持久鎖→Lots→Balances→Reservations→Allocations，重用原conservation讀取。原內部readAnchors只額外回balanceMap給新分支，舊success branches/receipt parser不變。
3. decode真原E_S完整batch ISSUE，逐line/Claim/Reservation/member及每Allocation leg數量／原operation／原Movement與完整reference集合相等。各bucket維度與原snapshot對上，Allocation仍CONSUMED、outstanding0、consumed量及原allocationVersion對上，Reservation version不倒退且consumed足夠。
4. 每原Movement查**任何event/target**的 `reversal_of_movement_id`；有一筆即UNKNOWN。核原Balance allocated與全部其Allocation outstanding總和、既有Control Reserved總和。仍持domain與event屏障後再查完整E_R journal，才可回ABSENT。
5. `verify`核同owner instance、active RC tx、真session/source identity及fresh authority；inspection proof不能換write grant或直接takeover。錯誤/partial/缺schema/來源無法對上保持UNKNOWN，真撤權不吞為業務零效果。

## 保留legacy的實際論證與明示接受變化

不是以opaque／非numeric documentId排除。受保護範圍是0056實際ascii_bin的FULFILLMENT及SHIPMENT/SHIPMENT_LEG source類別，且事件可能與原UUID碰撞；options與claim共用selector。0056 VARCHAR collation可能PAD SPACE；尾ASCII空白剝除僅作分類，若剝除後命中protected UUID但原bytes含padding則claim前SOURCE_CONFLICT，不修改stored source/hash、不Unicode normalize。TL已來源核定此窄處置。PhaseA及zero SQL沒有exact-JS後濾，歷史padded/SQL等價列只要SQL命中就UNKNOWN。

真正不與UUID字面event的SQL比較域重疊（排除上述padding等價）的nonUUID事件，且不可能以generic/purchase receipt反向原batch ISSUE者保留原行為：generic full reversal要求MOVEMENT_GROUP，而原batch member為FULFILLMENT_ISSUE_MEMBER；purchase reversal要求PURCHASING_RECEIVING/GOODS_RECEIPT RECEIPT。其他source類別亦只在journal identity及原Movement效果均可排除時保留。這是來源／原policy論證，不是已跑collation或legacy runtime回歸。

原 `SHIP-42`／`posted-1`等非UUID事件仍走原分支；randomUUID documentId配UUID事件**不能**因此自動排除，必須早取gate並作current owner分類。已有MANAGED事件、晚到caller-owned tx／欠marker、未驗明mapping都受控拒絕；這是Sam限定契約批准的接受範圍變動，實際部署caller/mixed versions仍未確認，不宣稱無相容風險。

## 評審、整合及未驗證界線

TL先核必要三outer、Stocktake handler及PAD SPACE分類；其後已實讀全部九檔delta、既有scope、原ISSUE decoder／receipt producer及generic MOVEMENT_GROUP guard，回覆精確產品component SOURCE ACCEPT、0 Required。Fulfillment可整合產品commit `7fb93911`及此文件commit；只接受這個component，不冒稱聯合Recovery完成或最終樹全部獨立全綠。sharedDB lifecycle／classifier本身仍由Fulfillment/TL修其已發現問題，Inventory不代改。原success readers的SUCCEEDED／UNKNOWN不改成ABSENT。

PhaseA caller是實際基線接線；完整Zero proof的真正Recovery Job／durable loader／purpose／all-attempt fence consumer由Fulfillment在同一candidate續接，不能用方法存在宣稱端到端完成。當前所有parser/lint/build/TC/UAT/DB/CI均NOT_RUN，未獲新案例／執行批准。

其後已只讀實核Fulfillment consumer `7143e060d4dec2c0a5bf2979e37f0f0e710b971e`：`ShipmentReversalService`用同database真pair＋constructor callbacks，實際呼叫三個Inventory zero ABI／三個`reversal.zero.inventory.*` phase；`shipmentReversalRecoverySource.shipmentReversalZeroEffectSource`的frozen purpose、欄位及originalIssue reference shape與本候選相符。因此沒有為該consumer新增Inventory adapter，不整合／覆寫其他owner檔。這次只是來源接線相容性觀察，該consumer仍待TL完整審查，不代表其loader/counters/下游/fence已被Inventory驗真或runtime PASS。原首組sharedDB/classifier兩Required仍由Fulfillment/TL處置。

單MySQL cooperative全writer參與、retention/archive/maintenance、downstream membership及部署版本均是未驗activation依賴；私有caller/fence若不能證明就不發可信source，不能拿constructor boolean當部署證據。TASK036、Inventory P4及TASK041均不由本增量宣告DONE；NFR仍UAT後。
