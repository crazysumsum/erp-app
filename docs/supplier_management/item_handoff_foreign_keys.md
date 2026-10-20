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

## 3. 已驗證可行的修法

以下是 Supplier 在 0087 用的修法：

1. 先查孤兒資料（子表指向不存在的父表資料）。
2. 刪除外鍵，再刪除那個多欄 index。
3. 新增只有外鍵欄位的 index，例如 `(item_id)`。
4. 加回多欄 index。
5. 加回外鍵。這一步用 COPY 重建表，server 會逐行檢查；如果有孤兒資料就會失敗。

以下做法**無效**：

- 只在後面加 `(item_id)` index：多欄 index 仍然排在前面。
- 只刪除外鍵再加回。

參考：

- `server/database/migrations/0087_fix_supplier_sku_refs_sku_foreign_key.js`
- `server/test/integration/supplierSkuForeignKeyMigration.integration.test.js`：用複製表測試，包括對照、重跑、做到一半、孤兒資料和 lock 等待的情況。

`uq_item_skus_item_variant` 是 UNIQUE。可以照原樣加回，但要由 Item 確認重建期間的寫入鎖可以接受：`item_skus` 比 `supplier_sku_refs` 大得多。

## 4. 對 Supplier 的影響

沒有。Supplier 只經 `ItemLookupService` 讀 Item，而 `supplier_sku_refs.sku_id` 指向的是 `item_skus.id`（0087 之後已經生效）。
