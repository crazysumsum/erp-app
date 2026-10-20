# 交給 Item 模組負責人：兩條沒有生效的外鍵

- **由：** Supplier 模組（`supplier-management`）
- **交給：** Item 模組負責人（`item-management`）
- **日期：** 2026-10-20
- **決定：** HD-113 A。Supplier 用 migration 0087 修自己的 `supplier_sku_refs`（DEF-029）；Item 這兩條外鍵不屬 Supplier，交由 Item 決定怎樣處理。

## 1. 問題

在 MySQL 26.7.0（CI 和目標環境的版本）上，下面兩條外鍵在**寫子表**（INSERT／UPDATE）時不檢查：指向不存在的 `items.id` 的資料可以寫入。刪除父表的資料則照常按規則處理。

| 外鍵 | 子表欄位 | InnoDB 用來檢查的 index | 刪除規則 |
| --- | --- | --- | --- |
| `fk_item_skus_item` | `item_skus.item_id` → `items.id` | `uq_item_skus_item_variant (item_id, variant_signature)` | CASCADE |
| `fk_item_media_item` | `item_media.item_id` → `items.id` | `idx_item_media_item_sku_kind (item_id, sku_id, media_kind, sort_order)` | CASCADE |

## 2. 原因（在 scratch schema 重現）

InnoDB 用第一個以外鍵欄位開頭的 index 來做外鍵檢查。當那個 index 有多欄，而後面的欄可以是 NULL 時，寫子表時就不檢查。`supplier_sku_refs.sku_id` 是同一個問題（DEF-029）。

全庫 250 條外鍵逐條試寫（寫完即 rollback）：只有上面兩條和 `fk_supplier_sku_refs_sku` 不生效。

## 3. 修法（在複製表上驗證）

規則：InnoDB 揀第一個以外鍵欄位開頭的 index。MySQL 一定把 UNIQUE index 排在普通 index 前面，所以兩條外鍵的修法不同。

**`item_media.item_id`：** 那個多欄 index 是普通 index，可以照 Supplier 0087 的做法（REV-100 之後的版本）。

- 用一句 `ALTER TABLE … ADD INDEX (item_id), DROP INDEX idx_item_media_item_sku_kind, ADD INDEX idx_item_media_item_sku_kind (…), ALGORITHM=INPLACE, LOCK=NONE`。
- 外鍵不用刪，期間讀寫照常。
- 之後要查孤兒資料。
- 已在 `item_media` 的複製表上驗證：修之前孤兒資料寫得入，修之後被拒絕（ER_NO_REFERENCED_ROW_2）。

**`item_skus.item_id`：** 同一做法**無效**（REV-100 M-2，已驗證）。新加的普通 `KEY (item_id)` 一定排在 UNIQUE 的 `uq_item_skus_item_variant (item_id, variant_signature)` 後面，在複製表上孤兒資料照樣寫得入。

有效的做法（在複製表上驗證）：加一個沒有可為 NULL 欄的 UNIQUE index，例如 `UNIQUE (item_id, id)`，用 INPLACE 加，不用刪外鍵。它排在 `uq_item_skus_item_variant` 前面，孤兒資料即被拒絕。

另一個選擇是把 `variant_signature` 改為 NOT NULL。用哪一個由 Item 決定。

**以下做法無效：**

- 只在後面加一個普通 index：多欄 index 仍然排在前面。
- 只刪除外鍵再加回。

**參考：**

- `server/database/migrations/0087_fix_supplier_sku_refs_sku_foreign_key.js`
- `server/test/integration/supplierSkuForeignKeyMigration.integration.test.js`：用複製表測試，包括對照、重跑、孤兒資料、會搶先負責外鍵的 UNIQUE index，以及 lock 等待。

## 4. 對 Supplier 的影響

沒有。Supplier 只經 `ItemLookupService` 讀 Item，而 `supplier_sku_refs.sku_id` 指向的是 `item_skus.id`（0087 之後已經生效）。
