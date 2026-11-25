# 上線前新增功能：Sam 的批准記錄

記錄者：claude-erp-app-tl-01，2026-11-25。另立本檔，不改已批准的七份文件，使其指紋保持不變。

## 來源

- PM `claude-erp-app-pm-01` 訊息 `afb51b52`（2026-11-25），轉述 PM 工作階段約 08:40 的問答。
- PM 的問題：「新功能的決定和五份資料表是否都照建議批准？」
- Sam 的回覆，原話：「都照建議批准」（2026-11-25）。
- 依 Sam 2026-11-24 的指示「PM給你專發的信息不要再找我重新確認」，本記錄直接依 PM 轉述的原話，不再向 Sam 重新確認。下文「PM 的理解」不是 Sam 的原話。

## 批准綁定的版本

分支 `claude/golive-additions-scope`，commit `375b3a1bb41eb0b1a6bb12353a99fbd13853fc36`，目錄 `docs/golive_additions/scope-20261125/`。記錄者已在該 commit 重算 sha256，與 PM 列出的完全相同：

| 檔案 | sha256 | 內容 |
|---|---|---|
| TABLES-COST.md | e942f90cc157b345dfca4954ae19ae3c7308729df199c01cc8f0bbe77b2b96ee | 2 張新表 |
| TABLES-RECEIPT-REVERSAL.md | ded03165f64dba9dae9d5ded29bcd9ef16c23f7c9004a28a54b14e5a3b97795e | 2 張新表 |
| TABLES-RETURNS.md | 1cd4be1d999ec1b5a00ee9fdf70cde7cb9328258956d4c529af69c0e3d8583a3 | 5 張新表 |
| TABLES-AR-CREDIT.md | 08dbe5d8dbcd20afc4bbfaf76faa0c2c292adc693a2b8301f6fbeb18e5bad262 | 4 張新表＋2 個現有 CHECK 允許值 |
| TABLES-AP-CREDIT.md | 120a730989cb85cb4ff5153ec173853c1eb45e09e5eb9d72f8dcfc0f9bdaca74 | 4 張新表＋2 個現有 CHECK 允許值 |
| DECISIONS.md | eed1277b527270144a78a5a2d81f4436f89965eb92287c9518d8cd49aa681fd0 | 決定 A、B、D、E、F 均照「建議」一欄 |

合計 17 張新表、4 個現有 CHECK 的允許值變更，不加任何現有欄位。

毛利報表口徑（同批批准）：按發票及貸項單日期歸期，成本取對應出貨當時的成本，退款不重複扣收入；外幣銷售明示「未計入」，不當零、不換算。

## 批准範圍以外

- 實作時任何欄位、型別、預設、鍵、外鍵、CHECK、trigger 與上表檔案不同，都不在批准之內：先停，告訴 claude-erp-app-tl-01 及 PM，由 PM 再問 Sam。
- SCOPE.md（58ace2bc093e626d8bdec9510fc5795da05b20e5a158187163e02192ae20f2cb）§6.1 一段在批准時仍待 codex-erp-app-tl-01 核對；如核對要求改動任何表，須重新送批。

## PM 的理解及安排（不是 Sam 的原話，afb51b52 第三節）

- 決定 A：再加一人，由 Sam 指派是哪一位；指派前 returns-01 先做兩側實物退貨，退貨片先於兩個貸項片合併。
- migration 編號由 codex-erp-app-ci-01 指定。
- 各片負責人：成本 inventory-01；收貨沖銷 purchasing-01；退貨 returns-01；應收及應付貸項單與退款待 Sam 指派；毛利報表 sharedfeatures-01。出貨沖銷（fulfillment-01）及報表不需新表。
- 這幾片的非作者評審：claude-erp-app-tl-01。
