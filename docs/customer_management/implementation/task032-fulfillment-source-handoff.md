# TASK-032 · 第一個客戶引用來源

2026-11-05。基線 `d65051a3`（已含 #336）。Fulfillment 擁有履約及出貨資料；Tech Lead 交付本機唯讀 adapter，Customer 擁有 `customer.references` 的組裝。PM 負責核實目標環境的資料來源及採用版本。

## Customer 需要的完整清單

依 [OI-004](../01_requirement_spec.md) 固定五個責任域。以下是待部署組裝核對的介面版本。Sales 與 AR 沿用既有 registry 測試所用的名稱。

| 必要 id | contract | 涵蓋範圍 |
| --- | --- | --- |
| sales | sales-customer-references/v1 | 報價及訂單。草稿可更換客戶，現行表零筆不足以排除曾經引用。 |
| fulfillment | fulfillment-customer-references/v1 | 履約單及出貨單，包括歸檔。本候選唯一交付的 adapter。 |
| returns | returns-customer-references/v1 | 退貨、售後及實收記錄。 |
| receivables | ar-customer-references/v1 | 發票、貸項及應收來源。 |
| payment-refund | payment-refund-customer-references/v1 | 收款、退款及其結算來源。 |

Customer 的 trusted composition 必須把完整清單和已交付實例分開傳入同一個 #336 singleton。缺任何必要方時，整體啟動狀態為 `NOT_READY`，逐客戶判定為 `UNKNOWN`。保留現有空組裝的安全預設。第一個 adapter 的匯出為 [FulfillmentCustomerReferenceProvider](../../../server/src/modules/fulfillment/FulfillmentCustomerReferenceProvider.js)，以 `new FulfillmentCustomerReferenceProvider({database})` 建立；本候選未自動註冊服務。

## 本機可驗收的輸出

- `inspectReadiness()` 驗證同一資料庫能解析及讀取 0093、0096、0099 定義的四個 header 投影。資料 owner 須先確認該環境以這四個來源涵蓋其保留歷史，才可組裝這個 contract。資料保留與部署範圍仍由 PM 核實。
- `checkCustomerReferences(customerId)` 只接受正安全整數。單一 SQL 語句在同一讀取快照按客戶過濾四張表，以單據種類和 ID 識別，保留所有狀態。同 ID 的履約單及出貨單各計一次；同客戶同一單據同時位於現行及歷史表則回 `UNKNOWN`。零份回 `NO_REFERENCE/0`，一份以上回 `REFERENCE/n`。無法讀齊回 `UNKNOWN`。成功只帶計數及觀察用 watermark，無客戶名稱、地址或單據內容。
- #336 現有封存及刪除流程先查引用，再開始寫入交易。正式啟用前，Customer owner 需在客戶根鎖內重驗，並確認新增引用的 writer 與同一根鎖串行；封存另須按未完成業務判定。此 reader 單獨不能授權兩項操作。

Fulfillment owner 已在其項目 chat `01a15862-9933-7e50-8e10-4015cf35d078` 獨立覆核上述來源及 reader SHA-256 `5bfe1ff0dbd222f376b3708393d1c1d158776789ead58704d3566c82cb1868d8`，同意按此界線交 Customer，Critical／High／Medium 均為零。既有 TC-026 registry 測試 5/5、語法及 ESLint 通過；一次私有 SQLite 記憶體功能核對涵蓋零筆、兩類同 ID、跨客戶過濾、雙路重疊、搬至歸檔、缺表及全域 UNKNOWN。原生 MySQL driver、正式組裝、coverage 及部署驗收仍待交接後進行。TASK-034 的五案沒有執行這個 reader。

## 出貨沖銷的獨立依賴

S1 的沖銷另用設計基線 `6cc959d1:tasks/shipment-reversal-downstream-contract.md`。Returns 須交付每筆實收對原出庫 Issue 的分攤及其寫入入口；Invoicing／AR 須交付逐來源的開票 claim、有效貸項及待處理事項。兩個 owner 的 writer 及沖銷均取同一 Fulfillment 根、再取 S1 排他鎖，以同一 READ COMMITTED 交易查證。出兩件已實收一件要阻止全張回補；未貸清的 S1 發票來源亦要阻止。未能核實任何一方仍回 503。現行 Inventory 的客退入庫入口只接受 R1 來源，並無完整 S1 分攤；AR 在此基線只有規格。兩者待真來源及環境採用，公開沖銷保持關閉。
