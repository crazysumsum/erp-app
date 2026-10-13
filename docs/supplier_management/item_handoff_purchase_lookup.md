# 交給 Item 模組負責人：採購用的 SKU 搜尋，以及 UOM 的 mapping ID

- **由：** Supplier 模組（`supplier-management`）
- **交給：** Item 模組負責人（`item-management`）
- **日期：** 2026-10-13
- **決定：** HD-093 A。Product Owner 決定由 Item 提供採購用的介面。Supplier TASK-039（Supplier–SKU 關係 UI）會等 Item 做好才開始，期間 Supplier 先做 TASK-040。

## 1. 為甚麼要改

Supplier TASK-039 要在供應商詳情頁加一個「供貨關係」面板，讓用戶揀 SKU 和採購單位（驗收標準寫明要「使用正式 Item selector 及 SKU UOM」）。按 DES-001，Supplier 只可以經 Item 提供的介面讀 Item 資料，不可以直接讀 Item 的表。

`server/src/modules/item/ItemLookupService.js` 現時的介面做不到這兩件事：

1. **沒有採購用的 SKU 搜尋。**
   - 唯一的搜尋是 `searchForSale()`。它只列出可銷售（sellable）、非 serial 的 SKU，所以採購不適用。
   - 採購 purpose 只有 `findById()`、`findByCode()`、`findManyByIds()` 三個，只能查單一 SKU，或者按代碼完全相符來查。
2. **採購 purpose 返回的 `uoms[]` 沒有 mapping ID。**
   - `#toProjection()` 返回的每個 UOM 只有 `uomId`、`uomCode`、`toBaseFactor`、`isBase`、`isDefaultPurchase`、`isDefaultSale`。
   - Supplier 的 `supplier_sku_refs.purchase_sku_uom_id` 存的是 `item_sku_uoms.id`，即是 mapping ID，並用 composite FK `(purchase_sku_uom_id, sku_id)` 指向 `item_sku_uoms(id, sku_id)`。
   - 沒有 mapping ID，前端就無法提供採購單位讓用戶揀選，關係列表亦只能顯示一個 ID，顯示不到單位名稱。
   - 銷售用的投影（`saleUomProjection()`）已經有 `skuUomId`、`uomName`、`status`，是當初 Sales 要求加入的。

**更正：** `item_handoff_supplier_sku_refs.md` 第 5 節寫了「唔使改 `ItemLookupService` 嘅現行 contract」，那句是錯的。本文件取代那一句。

## 2. 要求 Item 做的事

### 2.1 採購 purpose 的 `uoms[]` 加欄位（只加不改）

在 `findById()`、`findByCode()`、`findManyByIds()` 的投影裏，每個 UOM 加入以下欄位：

| 欄位 | 來源 | 用途 |
| --- | --- | --- |
| `skuUomId` | `item_sku_uoms.id` | 寫入 `purchase_sku_uom_id`；列表按這個 ID 找出對應的單位 |
| `uomName` | `item_uoms.name` | 顯示 |
| `status` | `item_uoms.status` | 停用的單位不讓用戶新揀；舊關係照樣顯示，並標示為停用 |

現有欄位不改名、不移除。這三個欄位的名稱與 `saleUomProjection()` 一致，方便共用。

### 2.2 新增 `searchForPurchase({ q, page, pageSize })`

- **篩選：** 沿用現時 `#evaluateUsability()` 的 purchase 規則，即是：
  - Item 和 SKU 都是 `active`；
  - `purchasable = 1`；
  - 在有效期內。

  另外加一條：至少有一個 active UOM。這條不在 purchase 規則之內，但 `searchForSale()` 有同樣的條件。
- **搜尋：** 與 `searchForSale()` 相同，用前綴匹配 SKU code、SKU name 和 Item name，並轉義 `%`、`_`、`!`。`q` 最長 190 字，不可含控制字元。
- **排序及分頁：** `ORDER BY s.sku_code, s.id`；`pageSize` 為 1 至 100。
- **返回：** `{ items, total, page, pageSize }`。每個 `items[]` 與 2.1 的採購投影相同，包括 `skuUomId`。
- **不需要做：** 鎖、transaction 版本，以及條碼搜尋。如果 Item 認為應該加條碼搜尋，也可以加，Supplier 會照用。

### 2.3 Contract 紀錄

- 更新 Item 設計中描述 `ItemLookupService` 的段落（§8.3 附近），寫明 2.1 和 2.2。
- 刷新 `docs/items_management/00_module_manifest.json` 中 `item-sku-uom-provider` 的 `sha256`。
- Supplier 收到新的 hash 後，會按自己的流程刷新 pin 及重新取得批准（需要 Product Owner 批准）。

## 3. Supplier 這邊會做的事（Item 不用做）

- 新增 `GET /api/v1/supplier-lookups/skus`（權限 `supplier.mgmt`），內部調用 `searchForPurchase()`。這是 Supplier 自己的 API，會先改 Supplier 設計 §6.8 並取得批准。
- 關係列表 API 加入採購單位的代碼和名稱，資料來自 2.1 的 `skuUomId`。
- 建立及修改關係時，會用 2.1 的 `status` 檢查採購單位是否 active。這一項就是 TASK-038 交接時記錄的未完成事項。
- 前端的供貨關係面板（TASK-039）。

## 4. 想 Item 負責人回答的問題

1. 2.2 的篩選規則是否正確？例如：`discontinued` 的 SKU 在採購時是否也不能揀選？現時 purchase 規則規定 SKU 必須是 `active`。
2. 預計甚麼時候可以完成？Supplier 會據此安排 TASK-039。

有問題請在 Supplier 模組的 PR 留言，或者直接找 Product Owner。
