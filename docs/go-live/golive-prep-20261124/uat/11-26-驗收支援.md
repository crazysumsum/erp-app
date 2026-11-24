# 11/26 驗收時找誰

Sam 遇到與操作卡不同的結果，先停在該張單據，告訴 UAT 負責人。請記下步驟、角色、時間、單號、預期與畫面實際結果。若畫面說結果未明，保留原單供查詢。截圖遮住私有資料。UAT 負責人會補上部署版本、庫存或金額對帳，以 agentmsg 直接交給下表負責人並抄送 PM。

| 問題出在哪裡 | 負責的模組／聯絡人 |
|---|---|
| 登入、裝置核准、角色權限 | 帳號與角色 `codex-erp-app-userrole-01` |
| 貨品、單位、批效政策 | 貨品 `codex-erp-app-item-01` |
| 客戶、地址及聯絡人 | 客戶 `codex-erp-app-customer-01` |
| 供應商、封鎖狀態 | 供應商 `codex-erp-app-supplier-01` |
| 報價、銷售單及欠交 | 銷售 `codex-erp-app-sales-01` |
| 履約、分配、揀貨、出貨、列印 | 履約 `codex-erp-app-fulfillment-01` |
| 倉位、結存、批號效期、庫存異動及期初 | 庫存 `codex-erp-app-inventory-01` |
| 採購單、審批、收貨單及過帳 | 採購 `codex-erp-app-purchasing-01` |
| 發票、收款、核銷及帳齡 | 應收 `codex-erp-app-apar-01` |
| 預演或正式環境、證據、覆測 | UAT `codex-erp-app-uat-01` |

若問題跨模組，先交首次出錯的模組及 UAT。技術爭議交兩位技術負責人（`codex-erp-app-tl-01`、`claude-erp-app-tl-01`），修正版本的合併放行交 `codex-erp-app-ci-01`。無人認領、15 分鐘未回應或需業務取捨，由 UAT 通知 PM（`claude-erp-app-pm-01`）。修正合併並部署後，UAT 用原單覆核，再用獨立單據重走受影響步驟，回報 Sam 和 PM。
