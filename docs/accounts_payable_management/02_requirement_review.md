# Accounts Payable Management 需求評審

## 1. 作者自查（歷史記錄）

| 項目 | 內容 |
| --- | --- |
| review_method | `SELF_REVIEW` |
| reviewer | `claude-erp-app-tl-01`（與作者相同） |
| author | `claude-erp-app-tl-01` |
| reviewed_baseline | commit `80554505`；`01_requirement_spec.md` blob `b9b4bdff6d2a86b550d7849247785f53bf1c13eb`（0.1 Draft） |
| 日期 | 2026-11-17 |

這是作者自查，不是獨立評審。

自查時已釐清的項目：

| 項目 | 結果 | 來源 |
| --- | --- | --- |
| 發票對什麼匹配 | 已確認收貨行，可跨收貨及PO，數量上限為已收未開票 | Sam D1 |
| 價格偏離PO | 允許，須專門權限及原因 | Sam D2 |
| 無PO發票 | 納入 | Sam D3 |
| 付款深度 | 只記錄及核銷；無審批、無銀行檔 | Sam D4 |
| 供應商貸項 | 做，只影響應付 | Sam D5 |
| 關帳日 | AP獨立 | Sam D6 |
| A-001～A-010 | Sam回覆「全部接受」 | Sam，2026-11-17 |

自查時補入的情境：收貨沖銷與開票互斥（FR-020）、重送時仍須驗權（FR-017、SEC-008）、關帳日與進行中命令並發（FR-003）、期初匯入中斷再確認（FR-039）、供應商停用後的既有應付（FR-045）。

更正：自查曾把「貸項作廢的邊界（FR-025）」列為已補情境。獨立評審指出該條的驗收準則本身是錯的（AP-R1），自查沒有發現。

## 2. 獨立評審

| 項目 | 內容 |
| --- | --- |
| review_method | `SEPARATE_AGENT` |
| reviewer | `codex-erp-app-tl-01` |
| reviewed_baseline | commit `8055450518b00de8fe514c0bdf4e99c16945d2da` |
| 報告 | `.worktrees/tl-ap-review-20261117/AP-requirements-review-80554505.md`，sha256 `1a4753df1c098ce0232e11edfdb66818c77dbbfa9bb31af6420261bcf23f678c` |
| 結論 | 範圍及簡化方向合理；四項Required須收口；`NOT_READY_FOR_DESIGN` |
| r2增量覆核 | `.worktrees/tl-ap-review-20261117/AP-requirements-r2-source-review.md`，sha256 `484074a378fd8fc9da59e58528eb33049fcad388d412d2614b0c1d957f4b1c2f`；綁定未commit的`01` blob `78e922dd…`及`02` blob `28c34965…`。R1、R2的CLOSED只適用於該等bytes及需求缺口，不代表程式或實測通過。 |

| Required | 內容 | 狀態（0.2 Draft） |
| --- | --- | --- |
| AP-R1 | 貸項作廢應只反向該貸項的效果，不恢復歷史餘額 | 已修訂FR-025，加入兩個紙上例；r2覆核**CLOSED（需求來源層）** |
| AP-R2 | 發票未付額須區分原發票沖減、Credit Balance應用及付款核銷 | 已加入「餘額口徑」，修訂FR-023、FR-024、FR-034、NFR-003，加入七步紙上例；r2覆核**CLOSED（需求來源層）** |
| AP-R3 | 期初防重須涵蓋三類文件及跨批次的穩定來源身分；釐清匯入金額口徑 | 已修訂FR-038～FR-040；r2覆核PARTIALLY RESOLVED；其後按r2要求補上已成功／確定未入帳／結果不明三種來源的分界、失敗修正例，並還原「100筆／99成功／1失敗」例；r3覆核**CLOSED（需求來源層）**，報告sha256 `a83c399defd62f6f78c5e7ea47458c8eecf1abba49a9c39ba6e3618df49dcd81` |
| AP-R4 | 收貨沖銷是按未佔用數量還是整行阻擋 | Sam於2026-11-17決定按未佔用數量（D8）；FR-020已改為單一語意，加入「佔用60沖銷20可行、沖銷50拒絕」及並發例；R4覆核**CLOSED（需求來源層）**，報告sha256 `5ad5dcfafa470f55de43ada2af00b82bae5efdfc8670e33901929b88effb7112`。Purchasing owner已按來源確認收貨行與明細的數量口徑（agentmsg `3a316de6`）；其後只把該確認的事實寫入FR-020及Dependencies，沒有改變業務語意 |

評審另外要求的文件更正，已處理：Purchasing依賴的狀態（TASK-028～033、TASK-035／036、交易內讀取）；Supplier依賴（lookup不含銀行資料）；A-001～A-003的依據不再寫「未提出異議」。

評審接受而不需修改的方向：按實際收貨數量含超收計價（FR-005、FR-009）；重送驗權（FR-017、SEC-008）；關帳日（FR-003）；銀行帳戶（FR-027）。這些在系統設計須按報告的承接要求處理。

## 3. 未決

- OI-001：AP每月單量，Sam未答。
- OI-007：NFR-002的回應時間數字未向Sam列出，待確認。
- OI-008：NFR-006的RTO／RPO未向Sam提出，待PM核對。
- 收貨沖銷時AP檢查的位置、讀取介面及錯誤碼，留待系統設計；作者的P1／P2只是方案，未獲批准。

已由Sam決定（2026-11-17，「六題都照建議」）：OI-002不記錄公司付款帳戶（D10）；OI-004按未佔用數量沖銷（D8）；OI-005超收可開票（D9）；OI-006只帶未清餘額（D11）。
- Purchasing的交易內讀取及沖銷檢查只是作者方案，未獲批准。

## 4. 已知不足

- 上游Purchasing的收貨行、確認及沖銷未在main；相關需求無法對照實際契約核實。
- 沒有與財務使用者訪談。
- Harness追溯驗證器結果為`BLOCKED`：設計、計劃及測試尚未產出，屬預期，不代表通過。
- FR-020的修訂及D8～D11的記錄（0.3）未經獨立評審。

## 5. 就緒狀態

非作者評審的四項Required已全部在需求來源層關閉。PM（`8c0cc79c`）已容許整理下一階段的系統設計範圍；正式進入系統設計由PM按原gate收口。每月單量、回應時間及復原目標的數字仍未定，不得自訂驗收數字或據此擴大規模。
