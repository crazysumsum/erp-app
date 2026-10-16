# Sales Order Management — 測試問題清單

跨模組通報保留來源 module-qualified ID，不與 Sales 既有 DEF-001 等本地編號混用。
本清單的新增紀錄不代表修復、風險豁免、正式測試通過或 Sales 已接單；Sales owner
接手後可建立本地 typed record 並保留雙向對照，不覆寫來源缺陷或歷史證據。

## DEF-033001 — 100 行訂單確認與另一張 Draft 新增形成 Warehouse／Lines 死鎖

| 欄位 | 登記內容 |
| --- | --- |
| 來源識別 | `customer-management:DEF-033001` |
| 嚴重性／優先級 | HIGH／P1 |
| 狀態 | OPEN；待 Sales 接手及修復，非 deferred／waived |
| 修復責任 | Sales Order Management；Customer 修復範圍不擴大 |
| 分類 | IMPLEMENTATION_DEFECT：實際取鎖範圍違反既定 record-lock 意圖；既有一行案例存在覆蓋缺口 |
| 來源案例 | Sales TC-042 混合匯入／前景負載；Sales TC-021 的 100 行診斷重現 |
| 相關需求／設計 | Sales NFR-003／004／005；DES-004／005／019；既有 §2.8 全域鎖序 |
| 相關工作 | Sales PHASE-002／TASK-030（Phase B）、PHASE-003／TASK-049（容量）；Customer TASK-033／TC-081 |
| 合併阻塞 | [Customer PR #244](https://github.com/crazysumsum/erp-app/pull/244) 必須保持 Draft／BLOCKED，不能以本紀錄或其他 green checks 解除 |
| 人工處置 | HD-017：Sam「維持 PR 阻塞，另由 Sales 工作處理；不擴大目前範圍」；本次僅授權登記與通知 |

### 環境與實際結果

- 發現日期：2026-10-16（香港時間）；Node26.6.0／MySQL26.7.0，獨立 synthetic DB，非正式營運環境。
- 最新 main 基準：`089dd45b6ca5558511ae6396a88f732d5df43927`；Customer 整合提交
  `26ed9a6e8b951cbd585cf74f0a2eb00031a3e337`；發布候選 `83603aeb059f4c6a067814d467dcf209f06d7957`。
- 執行來源 fingerprint：`397e161701b2e6af7a3dd7be702d4d48c057f49c1d2d9aed6f62ecbf606c8510`。
  SalesOrderService 及原 TC-042 腳本與上述 main 相同；不表示新增 catalog shared-lock 並行與暴露時機無關。
- 串行完整後端覆蓋率：3,441 tests，3,304 PASS、1 FAIL、136 既有 SKIP、0 cancelled，585928.640416ms。
  唯一失敗是 TC-042（34722.812459ms）：`CONCURRENT_OPERATION`／`No foreground dependency failure is excluded`，
  發生於 import READY 前；該次沒有其他本機 CPU-heavy 測試並跑。
- 100 行最小診斷兩次 FAIL；第二次 0 PASS／1 FAIL／0 SKIP，5944.703583ms。
  既有一行 TC-021 PASS 不足以覆蓋此案例。完整覆蓋率門檻與38個高風險檔案 floors 達標也不抵銷 FAIL。
- 曾有隔離 TC-042 PASS，不能替代本次有效失敗；最初背景負載不符的失敗亦保留，不拿來當容量 PASS。

### 重現步驟及預期結果

前置：Sales owner 依自己的已審核設定建立隔離 DB、完成遷移及測試 key-ring／權限設定。
不要使用已清理的舊 DB13369、私密憑證或重設共用 MySQL。

1. 使用 `server/test/sales/phase2/fixtures.js` 的 `setup`／`stock`，建立同一 Warehouse、
   100 個有效且相異的 SKU／SKU-UOM，及一張100行 Draft；經真實 SalesOrderService 建立，不模擬 SQL。
2. 用 `secondCustomer` 建立另一位 Customer 及另一種有效 Currency；競爭的新 Draft 使用相同 Warehouse。
3. 沿用 `salesConfirmation.integration.test.js` 既有 TC-021 的 `newOrderInsideInventory` barrier，
   包裝真實 InventoryReservationService 的 `reserveAvailableForSalesBatchInTransaction`。
4. 真實服務對100行訂單執行 `startConfirmation`／`completeConfirmation`；在進入 Inventory 前，
   barrier 啟動另一 Customer 的 `createOrder`，待新 Draft header 已寫入、即將 INSERT 第一行時放行。
5. 保留原 probe invariant：確認仍持 Sales line locks 時，新 Draft 第一行應能在既有5秒 bound內完成，
   然後確認才進入 Inventory。預期 `probe.state.inserted === true`，確認與新 Draft 都成功，無死鎖／部分效果。
6. 實際：`probe.state.inserted === false`，assertion `new Order insert must not wait on unrelated100-line confirmation`
   失敗；收集 native deadlock 及 EXPLAIN，不用固定 sleep 取代 barrier，也不要放寬 assertion／timeout。

完整負載復驗沿用原檔 `server/test/integration/salesImportCapacity.integration.test.js` 的
`TC-042 actual10000-order50000-line streaming HTTP CSV with50 foreground users and fixed scheduled workers`：
10,000單／50,000行、50前景使用者、pool10、worker batch50／interval2000ms／timeout30000ms。
固定30分鐘及前景p95≤3000ms等原門檻不變，所有 dependency failures 計入，不能排除失敗取得 PASS。

### Native 死鎖及 query-plan 證據

原 MySQL 診斷摘錄（synthetic IDs，非業務資料）：

```text
TRANSACTION 194464: INSERT INTO sales_order_lines (...)
  holds: inventory_warehouses PRIMARY id358, lock mode S locks rec but not gap
  waits: sales_order_lines uq_sales_order_line_sku_uom,
         lock_mode X insert intention waiting, supremum
TRANSACTION 194463:
  SELECT * FROM inventory_warehouses WHERE id IN (358) ORDER BY id FOR UPDATE
  holds: sales_order_lines uq_sales_order_line_sku_uom, lock_mode X, supremum
  waits: Warehouse358 exclusive lock
```

即 Warehouse S → line INSERT 與 line-index X／supremum → Warehouse X 構成循環。
100行實際 EXPLAIN：先 `Index lookup ... using uq_sales_order_line_sku_uom (sales_order_id = 15169)`，
再 filter `line_no IN (1..100)`，最後 sort `id`；並非註解預期的完整 `(sales_order_id,line_no)` point locks。
鎖定入口為 `SalesOrderService.lockSalesOrderLines`；後續 InventoryReservationService／InventoryLockService
取得 Warehouse X。Currency／Payment Term 不在此捕捉到的等待環內。

### 可追溯證據與交接

- [Customer 驗證報告及 HD-017](../../customer_management/implementation/hd016-implementation-report.md#serial-full-run-failure-supersedes-the-pending-checkpoint)。
- [PR #244 實測阻塞 receipt](https://github.com/crazysumsum/erp-app/pull/244#issuecomment-6206523801)。
- [Sam 保持阻塞／不擴範圍的處置](https://github.com/crazysumsum/erp-app/pull/244#issuecomment-6209135911)。
- 本機保留 `/private/tmp/customer-hd016.qWNdul/`：`sales-lock-probe.mjs`、
  `sales-lock-probe-explain.log`、`server-coverage-final.log`、`mysql.log`；暫存資料可能失效，不是共享永久附件。
  原執行 helper 的 ephemeral administrator 已刪除，不能直接重用；Sales 應以自己的隔離 runtime 執行。

| 原始證據 | SHA256 |
| --- | --- |
| sales-lock-probe.mjs | 99ddebef81b818ee283ba462d9697c514edbd515625097923d609dd846e947e8 |
| sales-lock-probe-explain.log | 60a81ab71df17d87422ce4336ac0b510a92fdfda338a568ceb5e3c90c2526289 |
| server-coverage-final.log | 0fc84ddffc86b3507558de0dd33d5d1da90553e2e73402ca0ff6f87f9b87885c |
| mysql.log 診斷時、清理前快照 | 15e9340492ff199a1266f6b5c25b73e4adf99d3f20639d0b606e7e5cc36dd492 |

獨立 reviewer `/root/customer_task011_review`：CHANGES_REQUESTED，確認此有效 HIGH blocker；不是豁免或修復批准。
MySQL shutdown 後 log 已追加關閉訊息，故清理前快照 hash 不是當前整個 mysql.log 的 hash。

### 修復交付與解除阻塞條件

Sales 自行依其批准範圍處理鎖定入口與100行回歸，保持既定鎖序、交易原子性、權限及錯誤處理。
Customer 不修改 Sales 產品程式、不退回會使 SELECT-only runtime 失敗的 catalog exclusive reads。
Sales 交付可驗證修復提交／PR及原100行重現、既有 TC-021、未放寬 TC-042、影響回歸的實測結果後，
Customer 才整合最新 main、重跑完整覆蓋率與同一候選提交的 CI／獨立審查，再考慮 PR244 合併。
通知或單一案例 PASS 本身不能關閉缺陷／解除阻塞；完整下游整合驗收另保持 BLOCKED。
