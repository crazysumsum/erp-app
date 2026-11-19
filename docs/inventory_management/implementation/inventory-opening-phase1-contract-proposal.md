# 首期期初 CSV 契約差異

候選基線 `db9d25d8498c5252a2fb31f82d86a564e629a5ce`。PM 2cef9b50 和 8153e132 給定單檔 5,000 列、多檔不重複、零列略過和批次欄位。Codex TL 接受同步預檢、確認後單一原子交易，並保留尚未過帳的取消入口。此文件供正本整合前核對，保留既有 Requirement／Design／Plan 的歷史版本。

| 正本位置 | 首期差異 |
| --- | --- |
| FR-105、§16.1、TASK-043 | 七個 v1 欄位。10 MiB 及 5,000 資料列為首期輸入限制，零列計入上限。語法有效的零數量列略過並保留列號。正數列使用 Base UOM 整數，依 Item tracking policy 核批次號與到期日，正規化後的批次號沿既有 Inventory 取鎖上限 100 UTF-8 bytes。none 的兩欄須空白，batch 必填批次號，batch_expiry 另必填到期日。 |
| FR-108、DES-008、TASK-043/044 | 同檔不得有相同倉／庫位／SKU／批次／Status 的重複正數列。不同 Status 是同一檔內的獨立 Bucket。已有正結存或任何歷史異動的倉／庫位／SKU／批次一律衝突，跨所有 Status。以已解析的 master 身份及既有批次等價規則核對，整檔回列號及欄位。已存在 Lot 的日期保持原值。 |
| DES-008、§4.18–4.20、TASK-042 | 0066 仍負責 singleton、匯入紀錄和列。保留不可逆狀態、檔案 SHA256／size、版本、安全錯誤、正規化列／零列結果、完整 Movement／Operation 關聯。刪除只為背景派工設計的 queue 狀態、lease、heartbeat、generation、takeover、retry 欄位與索引。 |
| §5.8、TASK-044/045 | Upload 即同步預檢；僅保存預檢結果，無庫存副作用。Confirm 使用既有 device-password、view＋mgmt、reason、job version 及可信原事件。獨立 detail 讀取持久結果。未過帳取消仍沿原 password／權限，列入後續交付。 |
| §7.7、TASK-046 | 首交付基本上傳、預檢錯誤／零列、確認結果查閱。確認前清楚顯示預檢版本和整批承諾。回應未知時先讀 detail。移除進度輪詢。匯出和範本下載另追。 |
| TC-008、TC-009、AC-044～046、原 Opening UAT | 以真同步 writer 驗證現有鎖拒絕、整批回滾、重送、權限、上線後禁新匯入。把 lease takeover／restart 的背景設計案例移出首期同步 scope。既有 10,000 列 NFR-004、容量和復原的後續驗證仍需獨立處置；首期 5,000 列不是非功能 PASS。正本沿用原 IDs，更新受影響定義及 ledger 關係後再重新產生矩陣。 |

預檢使用 `precheckInventoryOpeningCsv` 和現有 Item lookup，只讀 Inventory master、Lot、Balance 與 Movement。它發現當下衝突但不能授權入帳。成功預檢須將正規化業務資料、Warehouse／Bin 版本及影響入帳的 Item 資料（含正式 SKU 代碼）保存並綁定同一次匯入。保留原始 CSV 的 hash，不在 Audit 或 API 結果回傳原始檔、路徑或登入憑證。列級結果使用安全欄位及固定錯誤碼。

Confirm／Cancel／Go-Live 序列化在同一 singleton。Confirm 再鎖指定匯入，核輸入版本及結果，對原命令先處理 exact replay，新 event 遇已完成匯入一律拒絕。新命令驗 PRE_GO_LIVE，沿既有 Operation 與 Inventory 全域鎖序整批處理 warehouse／control／bin／active Stocktake lock／Lot／Balance。重驗權限、主檔、Lot 屬性和既有庫存／異動，使用等待後可見的當前資料；取得鎖後才能確定預檢仍有效。新 Lot 沿原 Opening 的 APP_TIME_ZONE 業務日期規則。所有 Movement、Balance、Lot 變更、Audit、匯入完成及 Operation 回執同提交。確認交易失敗保留可重新讀取的既有結果，不切批提交或自動重送。Go-Live 所核的對帳須涵蓋最後一次成功匯入。Production Go-Live 仍須依原營運簽核。

本次交付 parser、0066、預檢持久化、detail、高風險 Confirm 及基本操作頁。Cancel、Go-Live、範本下載及正式 UAT 分開追蹤。正式環境的期初匯入與營運切換須依已核准的上線流程。

兩個純單元檔沿用常規功能 CI。真 MySQL／HTTP 小型功能案例由 server workspace 明確執行：`node --test --import ./test-support/testEnv.js scripts/inventoryOpening.integration.js`。只使用新遷移的隔離 MySQL 26.7.0 schema，需設定 `DB_INTEGRATION_TESTS=1` 及 `INVENTORY_OPENING_TESTS=1`。
