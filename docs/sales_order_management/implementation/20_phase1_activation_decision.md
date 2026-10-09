# P1 啟動與驗證契約 — DEC-015（待核准）

## 已確認的入場條件

P0 PR #174 實際 MERGED，main／工作樹起點 `bbb2383ab3be94e79cade34fc584f8e538ddcfaf`。P0 的 17 組 developer suites 437 PASS、Supplier 回歸 68 PASS、全部五项 CI 与 separate-agent review 均通過。4 個一次性 MySQL、P0 branch/worktree 已清理；最終私有紀錄保留於 `/private/tmp/sales-phase0-retained-evidence-hlnxwrb1/final-merge/`。P1 工作樹 `/private/tmp/erp-sales-p1`，branch `codex/sales-order-phase-1-draft`。

Customer／Item／Inventory provider、BusinessMasterProvider（Currency／PaymentTerm caller-owned transaction）、SchedulerService／JobLeaseStore 已有實際程式碼。第一個 TASK-012 的 P0 merge／operation schema 依賴已滿足。其餘 Task 逐一確認自己的依賴；不建立替代 master 或 production fake。

## 本次核准內容

採納 TASK-012～027／PHASE-002（原 P1）的既定計畫：Quotation persistence、lifecycle／conversion、人工 Draft SO、查詢／lookup、Quotation expiry 及 UI。Inventory commitment 仍屬 P2。核准此工作樹的可審查 manifest/profile/plan/ledger 提案差異，並以以下精確基準啟動 IMPLEMENT：

- DESIGN：`392a6fa2d020bb49c16c8d5a337f2c19cf1c4740f52ea45e0cefcc1cdfd6e132`
- PLAN：`1f55b21a394b90cebfaacfde07d5ec9e991fc8349cc60943c78f18b2189efd71`
- 程式來源 fingerprint：`25de0074c3963ab24f587e2c57f6db35e988c9accc9b03c2cbfabe825aee0266`（本次未改產品程式碼）

核准 8 種 migration 語意 scope（序號由實作前最新 main 分配，現在最大 0069，未預留）：

- `server/database/migrations/*_create_sales_quotations.js`
- `server/database/migrations/*_create_sales_quotation_lines.js`
- `server/database/migrations/*_create_sales_orders.js`
- `server/database/migrations/*_create_sales_order_lines.js`
- `server/database/migrations/*_create_sales_order_status_history.js`
- `server/database/migrations/*_create_sales_audit_logs.js`
- `server/database/migrations/*_create_sales_quotation_conversions.js`
- `server/database/migrations/*_create_sales_external_order_keys.js`

共享接線限定 `server/test/migrate.test.js`、`server/config/scheduler.js`、`client/config/menu.js`。Sales module/handlers/pages/components、既定 `client/src/services/sales.js` 及相關測試位置見 manifest diff。沒有授權其他 module rewrite、package／lockfile／CI 變更。新增 helper 或共享接線若超出此 scope，需提出實際必要性與 patch。

P1 新增 6 組 developer suites，連同全部 17 組 P0 回歸共 23 組：unit／native 各至少 8 個且有實際 TC-011～018 assertion；client 至少 8 個；真應用 Playwright 至少 8 個，追溯 TC-019；server/client 原 coverage commands。具測試報告者零失敗／skip／NOT_RUN。Native 必须驗证乾淨／升級 migration、rerun、FK／unique／decimal／append-only、sequence／conversion／version race、rollback、snapshot revalidation及 HTTP lifecycle。TC-017 的 P1 developer scope 僅 Draft-save concurrency，正式 P2 confirmation branch 保留；TC-018 的 P1 developer scope 僅 lookup／submit revalidation，不聲稱 P2 confirmation 已驗證。TC-020 為整個 Phase Gate，不能偽裝成一個 passing unit。

原 `sales-technical` 全 60 個正式案例、P2～P4 developer lists、正式驗收／UAT、coverage／memory thresholds、現有 mandatory CI 全部保留。NFR-014／015 僅原 business UAT N/A 分類沿用並绑定新基準，其技术 backup／restore／RTO／RPO 義務仍保留；此處不新增驗收豁免。

另授權在全新 `/private/tmp` 自有目錄啟動 disposable MySQL 26.7.0、专用 schema/socket 與 HTTP/frontend ports，僅合成資料與測試 credentials。执行 empty／upgrade migrations、並發／rollback及真應用 Playwright；保留私有最小化報告後只清理本次自有資源。不得改用既有 DB，不執行 deployment／正式 UAT／release，不公開 raw logs／browser traces。原 commit／push／create PR／merge main 授權繼續有效，但須整個 P1 完成、實際 DoD／developer checks、最新 main 整合、精確版本 mandatory CI 及獨立 reviewer 通過後才合併。

## 選項與建議

1. **建議：核准此 P1 計畫、scope、developer 驗證契約與隔離 runtime。** 優點是按完整 P1 可交付切片推進，developer 不依賴尚未實作的 P2～P4；代價是明確增加 P1 profile 接線及一次性 DB／browser 驗證時間。正式 60 個案例與門檻保留。
2. 保持目前 P0-only 執行授權與原 all-60 P1 developer 設定。只保留啟動準備，TASK-012 未開始；無法宣告 P1 implementation ready。

默認建議為選項 1；目前提案未獲核准，不執行產品碼或 SQL。

## 決策依據

已讀 Harness `references/08-implement.md`：
> Do not silently change architecture, transaction semantics, security model, public interface, data ownership, acceptance criteria, or Phase boundaries.

已讀 `references/19-state-and-recovery.md`：
> Do not rewrite an old approval's hash to make it look current. Obtain a new decision, retain the old record, and explicitly dispose of obsolete evidence.

這次變更 P1 developer execution contract 及共享 scope，與已核准 P0 exact43paths 不同，需一次新決策；既有 P0 核准／失敗／證據不改寫。

## Review 修正與 stage 契約

P1 coverage gates 以 Harness 支援的 BUILD/EXIT_CODE 表示，只記原 npm coverage command 的 exit／門檻，不冒稱案例數。Node unit 使用 native quoted `*.test.js` glob；Playwright CLI 實際版本須為已安裝 1.63.0。Native argv 另包含 `salesOrderRead.integration.test.js`。

新增 P1 domain 寫入路徑包含 Design 指定的 `server/src/services/salesJobs/SalesJobRuntimeService.js`、`jobs/SalesQuotationExpiryJob.js`，以及 `server/src/handlers/sales/` 的 schemas／create／update／list／get／lookup 六個精確檔案；沒有授權 confirm handler。NFR-014／015 新基準的 prospective approval ID 是 `APR-PHASE1-UATNA-DEC015`，目前沒有核准紀錄；環境授權也明確標為 PENDING DEC-015。

PHASE-002 canonical Acceptance／Integration／Exit 已對齊 Harness IMPLEMENT：合併需要完整 developer Phase Gate、真應用 Playwright、mandatory CI 與 separate review；正式 TC-011～020／UAT-008～037 及 relevant AUTH/INQ 義務不刪除，於後續 TEST_AND_VERIFY／業務驗收實際執行。本次核准亦涵蓋此 stage 契約對齊；P1 合併不等於正式驗收或業務接受。

## 必要 schema 依賴調整（納入本次決策）

Design §4.8 要求 Sales Order.external_order_key_id FK RESTRICT，§4.22 已要求 External Keys 在 Orders 之前建立，但原 TASK-038/P3-T01 把 parent table 延至 P3。推薦只將 External Key parent persistence 建表前移至 TASK-013/P1-T02（該 Task 由兩支變三支 migration，schema 語意不變）；TASK-038 重用及驗證該表，unique/hash/routing／drift regression 仍保留。CSV／Channel claim、dedupe、Intake/API 的實作仍在 P3，P1 不提供相關入口。

此修正的代價是 P1 多一張必要 parent table／一支 migration，優點是初次建 SO 時即可保留設計要求的完整 FK；另一可行方案是 P3 才加 FK，但會產生暫時缺約束階段，需另外明確設計與核准，目前未採用。選項 1 的 P1 啟動核准包含這次表建立順序調整。
