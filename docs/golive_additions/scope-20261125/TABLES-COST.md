# 片C 存貨成本：資料表說明（供Sam批准）

日期：2026-11-25（r2）。作者：`claude-erp-app-tl-01`。對應`SCOPE.md`第5節。**草稿；未獲批准前不寫migration。** 候選來自`inventory.md`，欄位、型別及約束由作者定。

共同慣例：ID為`BIGINT UNSIGNED`；時間為epoch毫秒；金額為`DECIMAL(19,4)`；「ascii」指`CHARACTER SET ascii COLLATE ascii_bin`。全部是新表，不修改現有的表。

## 1. `inventory_cost_pools` — 每個SKU的成本池

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `sku_id` | BIGINT UNSIGNED | 否 | 無 | 主鍵；SKU |
| `costed_quantity` | BIGINT UNSIGNED | 否 | 0 | 有已知成本的數量（基本單位），兩倉、所有狀態、在途合計；實物數量減它即未計價數量 |
| `value_hkd` | DECIMAL(19,4) | 否 | 0 | 港幣帳面金額 |
| `version` | INT UNSIGNED | 否 | 1 | 每次更新加1 |
| `updated_at` | BIGINT UNSIGNED | 否 | 無 | 最後更新時間 |

- 主鍵`sku_id`：一個SKU一列；過帳時在Inventory鎖序的最後按`sku_id`升序先插入後`FOR UPDATE`（`SCOPE.md` 5.2）。
- 外鍵：`sku_id`→`item_skus(id)` `ON DELETE RESTRICT`。
- `CHECK`：`value_hkd >= 0`；`costed_quantity = 0`時`value_hkd = 0`；`version >= 1`。
- 不另存單位成本：由`value_hkd ÷ costed_quantity`推得。

## 2. `inventory_cost_entries` — 成本流水（不可改）

| 欄位 | 型別 | NULL | 預設 | 用途 |
| --- | --- | --- | --- | --- |
| `id` | BIGINT UNSIGNED AUTO_INCREMENT | 否 | 自動 | 主鍵 |
| `movement_id` | BIGINT UNSIGNED | 否 | 無 | 對應的存貨異動；一筆異動最多一筆成本流水 |
| `sku_id` | BIGINT UNSIGNED | 否 | 無 | SKU |
| `entry_kind` | VARCHAR(30) ascii | 否 | 無 | `OPENING`、`RECEIPT`、`RECEIPT_REVERSAL`、`SUPPLIER_RETURN`、`ISSUE`、`ISSUE_REVERSAL`、`CUSTOMER_RETURN`、`ADJUSTMENT_IN`、`ADJUSTMENT_OUT` |
| `quantity_delta` | BIGINT | 否 | 無 | 有符號的數量變動（入正出負） |
| `value_delta_hkd` | DECIMAL(19,4) | 否 | 無 | 有符號的金額變動 |
| `original_entry_id` | BIGINT UNSIGNED | 是 | NULL | 沖銷及退回時，指向原收貨或原出貨的成本流水 |
| `original_value_hkd` | DECIMAL(19,4) | 是 | NULL | 按原值按比例應計的金額；與`value_delta_hkd`的絕對值不同時，差額即「池內金額不足」的部分（`SCOPE.md` 5.1） |
| `uncosted_quantity` | BIGINT UNSIGNED | 否 | 0 | 這筆異動中沒有成本的數量（`SCOPE.md` 5.1「未計價數量」）；池的計價數量只變動「數量變動的絕對值減這一欄」 |
| `pool_quantity_after` | BIGINT UNSIGNED | 否 | 無 | 過帳後池數量，供對帳 |
| `pool_value_after_hkd` | DECIMAL(19,4) | 否 | 無 | 過帳後池金額，供對帳 |
| `posted_at` | BIGINT UNSIGNED | 否 | 無 | 過帳時間（等於異動時間） |

- 主鍵`id`。`UNIQUE(movement_id)`：同一異動重送不會寫兩筆成本。
- `KEY(sku_id, posted_at, id)`：按SKU查歷史；`KEY(original_entry_id, id)`：求同一原流水已回沖的累計。
- 外鍵：`movement_id`→`inventory_movements(id)`、`sku_id`→`item_skus(id)`、`original_entry_id`→`inventory_cost_entries(id)`，均`RESTRICT`。
- `CHECK`：`entry_kind`取值；`quantity_delta <> 0`；入的種類（`OPENING`、`RECEIPT`、`ISSUE_REVERSAL`、`CUSTOMER_RETURN`、`ADJUSTMENT_IN`）`quantity_delta > 0`而且`value_delta_hkd >= 0`，其餘`quantity_delta < 0`而且`value_delta_hkd <= 0`；`original_entry_id`只可用於四種沖銷及退回種類（原異動沒有成本流水時可為NULL，此時整筆未計價、`original_value_hkd`亦為NULL）；`uncosted_quantity`不大於數量變動的絕對值，兩者相等時`value_delta_hkd = 0`；`pool_value_after_hkd >= 0`。
- 兩個trigger拒絕`UPDATE`及`DELETE`。
- 調撥、移位、狀態轉換的異動沒有成本流水。

## 3. 期初成本

不加資料欄：期初CSV加`unitCostHkd`，存在現有預檢紀錄的`normalized_input` JSON（`inventory.md`）。這個CSV改動隨成本片交付，不改G3分支，所以G3可照合併次序先合併；正式環境的期初過帳要等成本片合併之後（`DECISIONS.md`決定B）。

## 影響

- 現有資料：沒有改動。成本表建立時，已存在的庫存沒有成本；所以**正式環境的期初過帳必須在成本片合併之後執行**，或另批一次性補成本的方案（`inventory.md`；`DECISIONS.md`第4節）。
- 鎖：新增一個每SKU的列鎖，位置見`SCOPE.md` 5.2。
- 權限：不新增。
- 回滾：空表可刪；有流水後不可刪表回滾。
