# Fulfillment P1 — Developer 交付紀錄

本紀錄屬 IMPLEMENT / PHASE-002。TASK-012–023 的本機 developer DoD 已完成；Phase 的精確候選 CI Gate 尚待執行。通過 CI 後才建立 draft PR，不授權合併、正式 Technical Acceptance、業務 UAT 或發布。

## 可核對的基線

- 已驗證 source commit：`989fce938c843b7d94ce21a18bbc8589f754c7fc`。
- Source fingerprint：`6bbf59686c17482e07fe855a29616707e9d8531e6b2b7e48bbe6c38d0b034daf`。
- DESIGN：`d81d2f6c9962f4a8dee4fc6d8f188ccec19b8ff44bbf4173c3e86fe2b92e17ae`。
- PLAN：`117f92529d5098dd8175dd7cc3179e8c3cf1a83e4246047ba46ead4964d42285`。
- 已整合 main：`f104bd848b78b415595906f852962ae17dd3f7ba`。Sales TC-032 的 10 秒變更有獨立人類批准；Fulfillment 的 20 秒交易限制及其他原有要求不變。

最後文件 commit 不修改上述 source / DESIGN / PLAN。其實際 commit 與 CI run 由外部觀察及 PR 記錄綁定，避免在文件內建立不可能的自我引用。

## TASK 狀態

| TASK | Developer DoD |
|---|---|
| 012 Queue 查詢 | DONE |
| 013 DRAFT 建立及 Reservation Claim | DONE |
| 014 List、detail、versioned DRAFT update | DONE |
| 015 Allocation Candidates／推薦次序 | DONE |
| 016 批次 Allocation／FEFO、FIFO 例外控制 | DONE |
| 017 原子 Reallocation | DONE |
| 018 Pick Confirmation／Short Pick | DONE |
| 019 取消／釋放自身 Allocation | DONE |
| 020 Client services／stable errors | DONE |
| 021 Queue、Create、列表 UI | DONE |
| 022 詳情、Allocation、Reallocation、Pick UI | DONE |
| 023 A4 Pick List／列印頁 | DONE |

實際逐項來源、atomic commit、案例及獨立覆核對照，保存在本機 `independent-989-p1-native-dod-local-qualification.json`，SHA `e3ec7316fc5b9efb42a8cee46c772fb1b5eb8a0ff3720186a66a04fffdd8d725`。§1.1 與 TASK-022／023 的 DoD 不把 CI 改寫成單一 Task 的前置條件；CI 仍是獨立 Phase Gate。此解讀的實際覆核 SHA 為 `b819157d502ac375c99908e905abea3335ed51375dbe468e1a2e6e2234aaf46e`，不構成豁免。

## 本機必要驗證

| 契約 | 實際 run ID | 結果 |
|---|---|---|
| lint | `20261027T060618-54312575e151` | PASS |
| client-build | `20261027T060618-aefb293cac7a` | PASS |
| security-audit | `20261027T060614-db54880f2c99` | PASS，保留原 high 門檻 |
| fulfillment-p1-developer | `20261027T061002-a7868011afe4` | 542 PASS，零失敗／跳過 |
| fulfillment-p0-developer | `20261027T062608-03060d12c14f` | 542 PASS，零失敗／跳過 |
| fulfillment-p1-browser | `20261027T060504-f258870ae8db` | 2 PASS，零失敗／跳過 |
| fulfillment-p0-browser | `20261027T060618-d86631c5cb81` | 2 PASS，零失敗／跳過 |

兩個 developer 契約目前共用底層案例集合，各含 132 個 unit-path 與 410 個 integration-path JUnit leaves，不能宣稱為 1,084 個不同 DB 情境。全部上述 run 的 source / spec 在執行期間不變；各原件與 hash 已核對並保留。先前準備／報告失敗、瀏覽器同步失敗及其修正仍在原 run 與報告 58，不追溯改為 PASS。

P1 真瀏覽器案例涵蓋 Queue→Create→Allocate 提交成功後丟失回應→刷新並以原 event／body 重播→Pick→當前 A4，以及另一個唯讀使用者。重播前後 17 張 domain table 相同；Pick 不改 SO fulfilled、Reservation outstanding 或 OnHand。實際 PDF 為一頁 A4，已獨立 render／目視核對；原 5,000 筆／366 頁 PDF 證據另行保留。

P1 production / test / UI 實際獨立覆核為 0 C/H/M，receipt SHA `e171f64335b910422a7984d51267a80714327c3b907a02f2b1f19c0874a8e8c9`；75 個 production blobs 的 ordered subset 仍為 `4dd57bda5ceb4bde82c6e261d77a87a86eba09581300ce4d6b177032e86edd17`。當前本機與受影響的 scoped unit／UI 證據支援 developer DoD；較早的完整 client run 保留其原基線，不冒充當前全 workspace 執行。全域／client coverage 仍須由當前候選 CI 證實。

Audit 仍列出 1 low／4 moderate findings；原 high gate 通過，不代表無漏洞。Vite chunk warning 保留。DEF-020／021 的程式與本機驗證已修正，仍 OPEN 等待 CI 確認，不能提前宣稱 Phase Gate 通過。

## 保留的界線

100 行／每行 50／合計 5,000 member、20 秒交易、四條可信 2MiB 路由、其他 API 100KB、全域 100 並行、10 秒收包，以及權限、鎖序、版本、來源、數量及原子 rollback 檢查全部保留。

最大容量樣本的 20 秒完成證據不等於 NFR-003 的 3 秒 P95 驗收，也不證明其失敗。正式 TC-012 的 730 萬筆／50 人指定混合負載、完整 NFR／還原驗收仍為 NOT_EXECUTED / NOT_PROVEN，保留在原計劃後續 Gate。原 NFR-023 UAT 不適用理由與 TC-010 mandatory／blocking 要求均未降低。

本機測試結束後，精確 synthetic base schema 已刪除、專用 MySQL 已正常關閉，兩個 web ports 可用；datadir、所有證據與其他資源保留。完整清理 receipt 為本機 `final-local-runtime-cleanup-989.json`。
