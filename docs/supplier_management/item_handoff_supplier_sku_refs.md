# 交俾 Item 模組負責人：Supplier–SKU 關係需要嘅改動

- **由：** Supplier 模組（`supplier-management`）
- **交俾：** Item 模組負責人（`item-management`）
- **日期：** 2026-10-09
- **決定：** HD-081 B。Product Owner 決定由 Item 負責人改 Item 文件，Supplier 會等佢改好先開始 TASK-038。

## 1. 點解要改

- Supplier 下一步係 TASK-038：建立 Supplier 同 Item SKU 之間嘅「軟性對照」。內容包括供應商自己嘅商品代碼、採購單位、MOQ、交期、首選或後備。
  - 呢張表會叫 `supplier_sku_refs`，**由 Supplier 擁有**，定義喺 `docs/supplier_management/03_design_spec.md` §5.11。
  - Purchasing 嘅設計已經用緊呢個名：`docs/purchasing_receiving_management/03_design_spec.md` 嘅 `supplier_sku_ref_id`，FK 指向 `supplier_sku_refs`。
- 但係 Item 設計 `docs/items_management/03_design_spec.md` §5.14 仲寫住：「待 Supplier 模組確定後新增 `item_supplier_refs`」。
  - 即係話，而家兩份文件都話自己會建同一種關係表。
  - Supplier 設計 §5.11 規定只可以有一張表，而且要先經批准嘅跨模組文件改動，將 Item 嘅暫名對齊，Supplier 先可以寫 migration。
  - `docs/items_management/**` 屬於 Item 模組，Supplier 唔可以自己改。

## 2. Supplier 會建乜（供參考，Item 唔使建）

| 表 | 對 Item 嘅引用 |
| --- | --- |
| `supplier_sku_refs` | `sku_id` 用 FK 指向 `item_skus(id)`，ON DELETE RESTRICT。`(purchase_sku_uom_id, sku_id)` 用 composite FK 指向 `item_sku_uoms(id, sku_id)`，RESTRICT；呢欄可以係 NULL。 |
| `supplier_supply_events` | `sku_id` 用 FK 指向 `item_skus(id)`，RESTRICT。表係 append-only，記錄 Purchasing 收貨後更新嘅供貨紀錄。 |

- Supplier 透過現行嘅 `item-sku-uom-provider`（`aligned-design-v2`），即 `ItemLookupService`，讀取 SKU 同 UOM，**唔會直接寫 Item 嘅表**。
- 兩張表嘅 migration 由 Supplier 寫，寫之前會先由 Product Owner 批准 schema。

## 3. 要 Item 負責人做嘅嘢

### 3.1 文件（Supplier 開始 TASK-038 之前一定要完成）

1. **改寫 Item 設計 §5.14**（`docs/items_management/03_design_spec.md`，大約第 650 行），寫明以下各點：
   - Supplier 同 SKU 嘅關係由 Supplier 擁有，表名係 `supplier_sku_refs`，定義喺 Supplier 設計 §5.11。
   - Item **唔會**建 `item_supplier_refs`。
   - Item API 繼續唔接受 supplier 嘅 payload。
   - Item 係被引用嘅一方：`item_skus.id` 同 `item_sku_uoms(id, sku_id)` 會被 Supplier 用 RESTRICT FK 引用。
   - 第 97 行嘅版本歷史，即 0.2 版「移除…本期 Supplier reference」，係歷史紀錄，可以唔改。
2. **更新 Item 測試文件 OPEN-006**（`docs/items_management/06_technical_test_cases.md`，大約第 423 行）。
   - 寫明供應商對照改由 Supplier 嘅 `supplier_sku_refs` 提供。
   - 寫明 FR-UOM-005 涉及供應商對照嘅分支，喺 Supplier TASK-038 merge 之後就可以執行，並列出對應嘅測試案例。
3. **刷新 Item 自己嘅 contract 紀錄。**
   - `docs/items_management/00_module_manifest.json` 入面 `item-sku-uom-provider` 嘅 `sha256` 要刷新；consumers 已經包括 `supplier-management`，唔使改。
   - Item 嘅 traceability 同 ledger 入面，綁住舊設計 hash 嘅批准、review 或者 evidence，要按 Item 自己嘅流程處理。
   - 只有 Item 同 Supplier 兩個模組 pin 住呢份文件嘅 hash。

### 3.2 行為（可以喺 Supplier TASK-038 merge 之後做，但要排期）

1. **FR-UOM-005：刪 UOM 換算時要列出依賴類型。**
   - 要求原文：「刪除仍被條碼、供應商對照或交易使用的 UOM 換算時，系統須拒絕並列出依賴類型。」
   - 而家 `server/src/modules/item/ItemAdminService.js` 第 629–631 行，會將 `ER_ROW_IS_REFERENCED_2` 一律轉成 `UOM_CHANGE_BLOCKED`。
     - 佢嘅訊息係「已有庫存或交易記錄，無法直接修改單位」，冇列出依賴類型。
     - Supplier 嘅表建好之後，如果係供應商對照引用緊嗰個 UOM，呢個訊息嘅原因亦會錯。
   - 建議參考 `CATALOG_IN_USE.details.referenceTypes` 嘅做法，回報實際依賴，例如 `supplier_sku_refs`。
2. **永久刪除 Draft SKU 或 Draft Item 時，要處理 FK 錯誤。**
   - 位置：`ItemAdminService.js` 大約第 1046–1047 行同第 1464–1466 行。
   - 呢兩段會直接刪 `item_sku_uoms` 同 `item_skus`。
   - 如果有供應商對照引用嗰個 SKU，RESTRICT FK 會令 `ER_ROW_IS_REFERENCED_2` 冇被轉換，變成 500。
   - 處理方法：轉成公開嘅「使用中」錯誤；或者按第 4 節問題 1 嘅答案，由 Supplier 保證唔會引用 Draft SKU。
3. **保留以下兩點，唔好改（呢個係約束，唔使做嘢）：**
   - 更新 SKU 時，`item_sku_uoms` 要繼續原地更新，保留 `id`。如果改成「刪晒再插入」，有供應商對照嘅 SKU 每次編輯都會被 FK 擋住。
   - `item_sku_uoms` 嘅 `UNIQUE(id, sku_id)` 要保留，因為佢係 composite FK 嘅目標。

## 4. 想 Item 負責人答嘅問題

1. **Draft SKU 可唔可以被供應商對照引用？**
   - 如果唔可以，Supplier 會喺建立同更新對照時檢查 SKU 狀態。Item 都係要將 FK 錯誤轉做公開錯誤，作為第二道防線。
   - 如果可以，Item 一定要做 3.2 第 2 項。
2. **停用或者封存嘅 SKU，已經存在嘅對照應該點處理？**
   - Supplier 嘅預設做法：保留對照並顯示 SKU 狀態，唔准新增指向停用 SKU 嘅對照。
   - 如果 Item 有唔同嘅語意，請話我哋知。

## 5. Item 唔使做嘅嘢

- 唔使建表，亦唔使寫 migration。
- 唔使改 Item API。
- ~~唔使改 `ItemLookupService` 嘅現行 contract。~~ **更正（2026-10-13，HD-093）：** 呢句係錯嘅。TASK-039 需要採購用嘅 SKU 搜尋同 UOM mapping ID，詳見 `item_handoff_purchase_lookup.md`。
- 對照嘅 CRUD API、UI、採購用嘅 for-SKU 查詢，同 Purchasing 嘅 `recordSupply`，全部由 Supplier 負責（TASK-038 至 TASK-040）。

## 6. 完成條件，同 Supplier 之後會做乜

**Item 嘅部分完成條件：**
- 3.1 嘅改動已經 merge 入 main；
- 3.2 已經完成，或者有排期，即有 task ID；
- 第 4 節兩條問題已經答咗。

**Supplier 之後會做：**
1. 刷新 Supplier 對 Item 設計嘅 pin。
   - Supplier 而家 pin 住 `5c193e20…`，Item 而家已經係 `a058ede4…`，所以本身已經過期。
   - Supplier 會喺 Item 改完之後一次過刷新，呢一步要 Product Owner 批准。
2. 開始 TASK-038：先喺 chat 逐欄解釋兩張表嘅 schema，等 Product Owner 批准先寫 migration。

有問題請喺 Supplier 模組嘅 PR 留言，或者直接搵 Product Owner。

## 7. TASK-038 merge 之後新發現：供應商關係會擋 SKU 單位同追蹤方式修改（HD-092）

**來源：** PR #198（Item TASK-043）將 `ItemAdminService#referenceTypes()` 的過濾條件，由 `sales_%`／`inventory_%` 放寬為「所有非 `item_` 開頭、有 FK 指向 `id` 的表」。PR #201（Supplier TASK-038，merge commit `6ab2fb04`）新增了以下三條 FK，全部會被這個過濾條件掃到：

- `supplier_sku_refs.sku_id` → `item_skus.id`
- `supplier_sku_refs.purchase_sku_uom_id` → `item_sku_uoms.id`
- `supplier_supply_events.sku_id` → `item_skus.id`

**行為：** 一個 SKU 只要有任何一筆供應商關係（包括沒有採購單位的 `alternative`），`updateSku` 就會被擋：

- 修改換算或基本單位 → `UOM_CHANGE_BLOCKED`，`referenceTypes` 包含 `supplier_sku_refs`。
- 修改 tracking policy → `trackingPolicyChangeBlocked`。

移除一個被用作採購單位的 mapping 也會被擋；不過這一項本來就會被 FK RESTRICT 擋住，現在只是錯誤訊息更清楚。

封存不受影響：`#archiveReferenceTypes()` 用的是一份明確列出的清單，不包括 supplier 表。

**Supplier 一方的立場：**

- 供貨關係屬軟性主檔；MOQ 只是參考值（FR-SKU-003），是否強制以採購交易為準。
- 供應事件只記錄 ID 和時間，沒有數量或單位。
- 所以修改換算不會令 Supplier 的數據失真。唯一受影響的是：設了 `purchase_sku_uom_id` 的關係，其參考 MOQ 換算成基本單位後的數值會跟着改變。

**需要 Item 負責人決定：** 保持現狀（任何供應商關係都會擋），還是在 `#referenceTypes()` 排除 `supplier_` 開頭的表（或者只保留 `purchase_sku_uom_id` 這一項）。

證據：以上結論來自閱讀 `origin/main` 的代碼，以及在已跑 0081 的資料庫上查 `information_schema.key_column_usage`；未有端到端測試證明。

Supplier 一方不會修改 Item 的代碼。
