# Supplier Bank 運維 Runbook：金鑰、輪替、備份與還原

**適用範圍：** SUP-CAP-03 Bank Security（`supplier_bank_accounts`）。
**依據：** `03_design_spec.md` §2.7、§3.3、§14；TASK-036 輪替工具；TASK-037 驗收證據。
**讀者：** 負責部署、金鑰管理與災難復原的 operator。

> 本文件每一條命令、每一個錯誤訊息，都在 2026-09-28 以一個與 CI 相同權限模型的 MySQL 26.7.0
> 實際執行過（應用帳號只持有 `erp_dev.*`，另有獨立 admin 帳號）。**只由讀程式碼得出、未實際
> 執行的陳述，會明確標示為「未執行驗證」。** 驗證紀錄見 §10。

---

## 1. 金鑰放在哪裡

Bank 資料使用兩組互相獨立的 key ring：

| Ring | 用途 | 環境變數 |
| --- | --- | --- |
| Encryption | AES-256-GCM 加密帳號 | `SUPPLIER_BANK_ENCRYPTION_KEYS`、`SUPPLIER_BANK_ACTIVE_KEY_ID` |
| Lookup | HMAC-SHA-256 blind index，用於查重 | `SUPPLIER_BANK_LOOKUP_KEYS`、`SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID` |

`*_KEYS` 是 JSON 物件，鍵為 key ID，值為 32 bytes 的 base64 key material：

```text
SUPPLIER_BANK_ENCRYPTION_KEYS={"enc-2026-09":"<base64 32 bytes>"}
SUPPLIER_BANK_ACTIVE_KEY_ID=enc-2026-09
```

**三條硬性規則，違反任何一條應用程式都拒絕啟動（§2）：**

1. **Supplier 與 Customer 必須使用完全相同的 key ring。** `CUSTOMER_BANK_*` 四個變數的值必須與
   `SUPPLIER_BANK_*` 逐字相同，包括 active key ID。這是 `checkSharedBankKeyRings` 的要求；兩個
   module 以 owner 區隔 AAD，但共用同一批 key material。**這表示同一條 key 同時保護
   `supplier_bank_accounts` 與 `customer_bank_accounts` 兩張表**，§5 的移除條件由此而來。
2. **Encryption 與 lookup 不得共用 key material。** 新增 key 時，兩個 ring 各自產生新值。
3. **兩個 ring 都必須存在。** 缺任何一個都不能啟動。

Key material 只存在部署 secret store／環境變數，不得進入資料庫、日誌、錯誤訊息或 repository
（設計 §3.3）。§7 已驗證資料庫備份中不含任何 key material，因此 **key ring 必須另外備份到
secret store**；只有資料庫備份而沒有 key 的備份等於無法還原（§8，TC-077 已驗證）。

產生一條新 key：

```bash
node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
```

---

## 2. 啟動自我檢查與排錯

應用程式在啟動時驗證 key ring；不合格即拒絕啟動（exit code 1），不會以缺 key 狀態提供服務。

| 啟動日誌中的訊息（`application.startup_failed`） | 原因 | 處理 |
| --- | --- | --- |
| `supplier: Supplier config must provide both bankEncryption and bankLookup key rings` | 缺 `SUPPLIER_BANK_*` 其中一組 | 補回缺少的 ring 與 active key ID |
| `customer: Customer and Supplier bank capabilities must use the same key rings with owner-separated AAD` | Supplier 與 Customer 的 ring 不一致 | 令 `CUSTOMER_BANK_*` 與 `SUPPLIER_BANK_*` 四個值逐字相同 |
| `customer: Customer bank encryption and lookup must use independent key material` | Encryption 與 lookup 用了同一條 key | 為其中一個 ring 產生新 key |

**對照：** 四個 ring 齊全且一致時，應用程式正常啟動，`GET /api/v1/health` 回 200。

> **只有 ring 本身不合格才會拒絕啟動。** 資料庫中有列使用的 key ID 已不在 ring 中時，應用程式
> **仍然正常啟動**（Product Owner 的決定：一列壞資料不應令整個 ERP 停機），但啟動時會寫一條
> error 級別的 `supplier.bank.keys_outside_ring` 日誌，內容只有 `kind`（`encryption`／`lookup`）
> 與列數，不含 key ID。若檢查本身無法執行，會寫 `supplier.bank.key_check_failed`。檢查跑完一定會寫
> 一條 info 級別的 `supplier.bank.key_check_completed`（兩個 kind 各自的列數）；**沒有這一行即代表
> 檢查沒有跑**（例如未配置 Bank key），不能當作通過。受影響的列：
>
> - Encryption key 缺失：該列 reveal 會被拒，不會洩漏明文，回應是 `503 BANK_KEY_UNAVAILABLE`，
>   並寫入一條 error 級別的 `supplier.bank.key_unavailable` 日誌（DEF-026）。
> - Lookup key 缺失：**該 Supplier** 的新增及修改帳號都回 `503 BANK_KEY_UNAVAILABLE`，並寫入
>   `supplier.bank.duplicate_check_unavailable` 日誌，因為重覆檢查無法涵蓋那一列（DEF-027）。
>   停用列一樣會擋（與唯一索引一致，停用列不計 status）。其他 Supplier 的寫入不受影響；只改銀行名等
>   欄位仍可進行。但其他 Supplier 新增同一帳號時，**跨 Supplier 的重覆提示對這些列失效**，且不會記錄。
>
> 找出是哪些列（把 `<…>` 換成目前 ring 中的 key ID）：
>
> ```sql
> SELECT id, supplier_id, status, encryption_key_id, blind_index_key_id FROM supplier_bank_accounts
>  WHERE encryption_key_id NOT IN ('<encryption key ids>') OR blind_index_key_id NOT IN ('<lookup key ids>')
>  ORDER BY supplier_id, id;
> ```
>
> 修復：
>
> 1. **首選：把該 key 補回 ring 並重新啟動**，然後照 §4 完成 lookup 輪替。
> 2. 重新輸入帳號**只在**以下條件全部成立時有效：該列是 active，而且是該 Supplier **唯一**一列缺
>    lookup key 的列。停用列會回 `409 BANK_ACCOUNT_INACTIVE`；有兩列或以上時會互相擋住，每一列都回 `503`。
> 3. **Lookup key material 已遺失**時：照 §4.1 以 `--from-lost` 重建。Encryption key 遺失則無法修復
>    （密文解不回），只能從備份補回 key（§7）。
>
> **§5 的移除前檢查仍然不可省略** —— 上述行為只是讓錯誤可被看見，不會把 key 找回來。

---

## 3. Encryption key 輪替

目的：把所有 Bank 資料由舊 key（下稱 `OLD`）重新加密到新 key（`NEW`），然後移除 `OLD`。

### 3.1 步驟

**步驟 1　把 `NEW` 加入兩個 module 的 ring，並設為 active，然後重新啟動。**

```text
SUPPLIER_BANK_ENCRYPTION_KEYS={"OLD":"…","NEW":"…"}    SUPPLIER_BANK_ACTIVE_KEY_ID=NEW
CUSTOMER_BANK_ENCRYPTION_KEYS={"OLD":"…","NEW":"…"}    CUSTOMER_BANK_ACTIVE_KEY_ID=NEW
```

`OLD` 此時必須仍在 ring 中：尚未輪替的列仍以 `OLD` 加密，移除它會令那些列無法解密。
新增與修改從此只使用 `NEW`。

**步驟 2　Supplier 輪替（一次執行完所有批次）：**

```bash
npm run supplier:bank:rotate-encryption --workspace server -- --from=OLD --to=NEW --json
```

`--to` 必須是 active key ID，`--from` 必須在 ring 中；兩者不符時工具拒絕執行（exit 2），不會
回報一個不可能發生過的輪替。其他旗標：`--help`。

完成條件是報告中 **`"supplierRowsDrained": true`** 且 exit code 為 0。報告同時一定帶有
`RING_SHARED_WITH_OTHER_TABLES` 警告 —— 這是刻意的，見 §5。

**步驟 3　Customer 輪替（每次執行只處理一批，需要重複執行）：**

```bash
npm run customer-bank:rotate --workspace server -- --after-id 0 --batch-size 100 --reason "rotate OLD to NEW"
```

輸出 `{"processed":…,"lastId":…,"remaining":…}`。以上一次的 `lastId` 作為下一次的 `--after-id`
重複執行，直到 `processed` 為 0；此時 `remaining` 必須為 0。

注意兩個與 Supplier 工具不同之處：

- **Customer 工具必須以與應用程式完全相同的環境執行**（包括 `JWT_SECRET` 等），因為它驗證的是
  整份應用程式設定。只給資料庫與 key 變數會以 `jwt: JWT_SECRET is required` 失敗。
- Customer 工具的 `remaining` 計算的是「**不在 active key 上**」的列，而 Supplier 工具的
  `remaining` 計算的是「**仍在 `--from` 上**」的列。兩者在只有兩條 key 時等價；ring 中若有第三條
  key，兩個數字的意義不同。

**步驟 4　確認兩張表都已清空，才移除 `OLD`（§5）。** 移除後重新啟動。

**步驟 5　驗證。** 重新啟動成功，並以一個已知帳號做一次 reveal，確認能解密。

### 3.2 已驗證的結果

以 5 列 Supplier 資料演練：步驟 2 回報 `processed 5 / failed 0 / remaining 0 /
supplierRowsDrained true`；移除 `OLD` 並重新啟動後，5 列全部解密回原本的帳號。**對照組：**
故意令其中一列仍指向 `OLD`，同一檢查立即回報該列 `BANK_KEY_NOT_IN_RING`。

---

## 4. Lookup key 輪替

目的：以新 lookup key 重建所有 blind index。程序與 §3 相同，改用：

```bash
npm run supplier:bank:reindex-lookup --workspace server -- --from=OLD --to=NEW --json
npm run customer-bank:reindex --workspace server -- --after-id 0 --batch-size 100 --reason "reindex OLD to NEW"
```

Ring 變數改為 `SUPPLIER_BANK_LOOKUP_KEYS`／`SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID` 及對應的
`CUSTOMER_BANK_LOOKUP_*`。重建 blind index 需要解密帳號，所以 **encryption ring 在此期間也必須
完整**。

**驗證：** 移除舊 lookup key 並重新啟動後，嘗試新增一個已存在的帳號，必須被拒為
`BANK_ACCOUNT_DUPLICATE`。已驗證：已存在的帳號被拒；**對照組**：一個不存在的帳號正常新增。
輪替期間（兩條 key 並存時）查重會同時計算所有 lookup key 的 candidate index，不會出現空窗
（設計 §3.3；由 `supplierBankCrypto.test.js` 的 ring 查重測試及
`supplierBankRotation.integration.test.js` 的「輪替一半時仍擋得住重覆」測試驗證）。

### 4.1 舊 lookup key 已遺失（HD-038）

情況：舊 lookup key 在重建完成前已從 secret store 移除，而且找不回來。受影響的 Supplier 新增／修改帳號
會回 `503`（§2）。重建 blind index 只需要 **encryption ring** 解密，不需要舊 lookup key，所以可以救：

```bash
npm run supplier:bank:reindex-lookup --workspace server -- --from=<遺失的 key id> --to=<active> --from-lost --json
```

- `--from-lost` 取代「`--from` 必須在 ring 中」的防打錯字檢查，改為要求**仍有列使用這個 key id**；
  沒有就拒絕（exit 2）。所以打錯字仍會被擋；已經跑完的再跑一次也會被拒，看到
  `no supplier_bank_accounts row uses lookup key id` 即表示已完成。
- key id 其實仍在 ring 中時拒絕（不需要這個旗）；用在 encryption 輪替時拒絕。
- **不需要**放假 key 進 ring，因此過程中查重沒有盲區：未重建的列仍令該 Supplier 回 `503`，重建完的列
  立即參與查重。
- 若某列回報 `DUPLICATE_KEY`，表示 key 遺失期間同一 Supplier 已經加入了同一個帳號（DEF-027 修正前的
  情況），要人手調查，不要重試了事。
- 完成後 `remaining` 為 0，並照 §5 處理 Customer 那一邊（本工具只處理 `supplier_bank_accounts`）。

已驗證（真 MySQL）：同一 Supplier 兩列在遺失的 key 下、其中一列已停用 —— 重建前新增回 `503`；
`--from-lost` 重建 2 列、0 失敗；之後兩個舊帳號（包括停用那列）都被拒為 `BANK_ACCOUNT_DUPLICATE`，
新帳號可以新增。

---

## 5. 何時可以移除舊 key

**兩張表都不再有任何一列使用舊 key，而且輪替沒有失敗列，才可以從 ring 移除舊 key。**

| 檢查 | 條件 |
| --- | --- |
| Supplier 報告 | `"supplierRowsDrained": true`（即 `remaining` 為 0 且沒有 failure） |
| Customer 最後一次輸出 | `"remaining": 0` |
| 直接查詢（建議） | 兩張表以舊 key ID 計數皆為 0 |

```sql
SELECT 'supplier', COUNT(*) FROM supplier_bank_accounts WHERE encryption_key_id = 'OLD'
UNION ALL
SELECT 'customer', COUNT(*) FROM customer_bank_accounts WHERE encryption_key_id = 'OLD';
```

（Lookup key 輪替改查 `blind_index_key_id`。）

**為甚麼比設計更嚴格。** 設計 §3.3 寫的是「舊 key ID row count=0 且 rotation report 通過後才可
移除舊 key」，以單一資料表為準。自 Customer module 上線後，§1 的共用 ring 規則令同一條 key
同時保護兩張表；只清空 Supplier 表就移除 key，會令 Customer 表中仍用舊 key 的列**永久無法解密**。
而且只從其中一個 ring 移除是不可能的 —— 應用程式會因 ring 不一致而拒絕啟動（§2），所以移除
一定是兩邊同時進行。REV-054 H-1 記錄了這個風險；Supplier 工具因此不再輸出任何「可以移除 key」
的判斷。設計文件的該段文字仍未更新，這是經人工決定保留的已知差異（修改設計文件會移動 DESIGN
baseline hash）。

**絕對不要**以移除 encryption key 作為 Bank 功能的回滾手段（設計 §14.3）。

---

## 6. 輪替失敗時

### 6.1 Supplier 工具的 exit code

| Exit code | 意義 | 處理 |
| --- | --- | --- |
| 0 | 輪替完成，每一列成功，且能讀取剩餘列數 | 繼續 §5 |
| 1 | 輪替有執行，但有列失敗，**或**無法讀取剩餘列數 | 查看報告的 `failures` 與 `warnings`，處理後重新執行 |
| 2 | 根本沒有執行：旗標錯誤、key ring 無效、連不上資料庫 | 按錯誤訊息修正後重新執行 |

輪替可續跑：已完成的列不再使用 `--from`，重新執行只會處理剩下的列。報告只含列 ID、數量與
key ID，**不含**帳號、密文或 blind index。

`failures` 中常見的 `reason`：

| `reason` | 意義 |
| --- | --- |
| `BANK_ACCOUNT_TAMPERED` | 該列的密文、IV、tag 或 context 與 key 對不上；**不會**被重新加密成垃圾，列保持原狀 |
| `DUPLICATE_KEY`（附 `constraint`） | 重建 blind index 時撞上唯一約束；報告只給約束名稱，不含 index 值 |
| `ER_LOCK_DEADLOCK` | 與應用程式同時寫入同一列時發生死鎖，見 §6.3。*未執行驗證：* 由 `safeReason` 對帶 `code` 的錯誤原樣回報其 code 推斷得出，未在輪替中實際製造過死鎖 |

若 `warnings` 中出現 `REMAINING_UNKNOWN`，表示輪替完成但最後的計數查詢失敗；此時 exit code 為 1，
`supplierRowsDrained` 為 false。**不要**據此移除 key，重新執行一次以取得計數。

### 6.2 Customer 工具

任何錯誤都印出訊息並以 exit code 1 結束。以同一個 `--after-id` 修正原因後重新執行。

*未執行驗證：* 依 `CustomerBankMaintenanceService` 的程式碼，每一批在同一個 transaction 中處理，
批內任何一列失敗會令整批回滾；即 Customer 工具無法「跳過」壞列，而 Supplier 工具是逐列處理並
記錄失敗列。本次演練中 Customer 表沒有資料，故只驗證了命令格式與迴圈結束條件。Customer 輪替
本身的正確性由 customer module 自己的測試負責。

### 6.3 死鎖（DEF-024）

InnoDB 的 `ER_LOCK_DEADLOCK` 會原樣傳回呼叫端，應用程式不會自動重試。在輪替期間，這表示某一列
與線上寫入撞上：

- Supplier 工具：該列記為失敗（`reason: ER_LOCK_DEADLOCK`），其餘列照常處理；exit code 1。
  **重新執行即可**，該列仍在 `--from` 上，會被再次選中。
- Customer 工具：整批回滾，exit code 1；以同一個 `--after-id` 重新執行。

輪替工具以逐列 transaction 並帶 key ID guard 更新，不會覆蓋線上寫入的新值：guard 由 REV-051 F-M3
的單元測試固定，REV-054 §8.1 與 REV-056 以真實 MySQL 上的並發寫入驗證過 —— 該列回報為
`declined`，線上寫入保留。
建議在寫入量低的時段執行，並用 `--batch-size` 控制每批大小。

---

## 7. 備份

```bash
mysqldump --single-transaction --hex-blob --routines --triggers <database> > backup.sql
```

| 旗標 | 為甚麼 |
| --- | --- |
| `--single-transaction` | InnoDB 一致性快照，不鎖表 |
| `--hex-blob` | 密文、IV、auth tag、blind index 都是 VARBINARY；以十六進位輸出避免編碼損壞密文 |
| `--routines --triggers` | Inventory module 的表帶有 trigger，還原時需要 |

已驗證：備份成功，含全部 71 張表、4 個 trigger 及 Bank 資料；**備份內不含任何 key material**
（以演練中實際使用的 key 值掃描整份備份，結果為 0；對照組確認掃描器能找到一條被植入的 key）。

**所以 key ring 必須另外備份**，與資料庫備份分開存放、分開授權。兩者缺一，都無法還原 Bank 資料。

---

## 8. 還原與驗證

**還原必須以 admin 帳號執行。** 以應用程式帳號還原會失敗：

```text
ERROR 1419 (HY000): You do not have the SUPER privilege and binary logging is enabled
```

原因是 Inventory module 的 trigger 需要建立 trigger 的權限；這與 CI 曾因同一原因失敗是同一件事。

```bash
mysql -u<admin> -p -e "CREATE DATABASE <restore_db> CHARACTER SET utf8mb4"
mysql -u<admin> -p <restore_db> < backup.sql
```

若把備份還原到**同一個** MySQL 實例（例如還原演練），備份時需加 `--set-gtid-purged=OFF`，否則
載入時會因 GTID 衝突失敗（`ERROR 3546`）。還原到另一台伺服器則不需要。

**還原後的驗證：**

1. 以原本的 key ring 啟動應用程式，必須成功（§2），而且啟動日誌中**不得**出現
   `supplier.bank.keys_outside_ring`；出現即表示還原的資料用了 ring 中沒有的 key。同時**必須看到**
   `supplier.bank.key_check_completed`（兩個列數都是 0），且沒有 `supplier.bank.key_check_failed` ——
   沒有 completed 那一行，代表檢查沒有跑，不算通過。
2. 以一個已知帳號做 reveal，必須取回原帳號。
3. **缺 key 或 key 錯誤時必須 fail closed**，而不是回傳亂碼：已由 TC-077 驗證 —— 還原後以正確
   ring 可取回帳號；ring 中缺該 key ID 時回 `503 BANK_KEY_UNAVAILABLE`；同一 key ID 但 key 值錯誤時
   在 GCM tag 驗證失敗，回通用 `500`（不說明原因），並寫入 `supplier.bank.integrity_failed` 日誌；
   三種情況下錯誤訊息都不含帳號，還原後的密文一個 byte 都沒有改變。
   **看到 503 → 補回 key；看到 integrity_failed → 資料可能被竄改，要調查，不要重試了事。**

自動化的還原演練：

```bash
DB_INTEGRATION_TESTS=1 npm test --workspace server -- test/integration/supplierBankRestore.integration.test.js
```

*未涵蓋：* 異地／另一台主機的還原、作業系統層級的還原、以及全模組還原演練（OPS-006／TC-133，
仍未有 harness）。

---

## 9. 回滾原則（設計 §14.3）

- **絕不**以移除 encryption key 作為 Bank 功能回滾。
- Bank 權限只在 key 已安全 provision 且 security smoke 通過後才開放（設計 §14.2）。
- 回滾 client 或 server 不刪除已建立的 Bank 資料。

---

## 10. 驗證紀錄

**執行環境：** `main` @ `980bcc5`；MySQL 26.7.0，權限模型與 CI 相同（應用帳號僅 `erp_dev.*`、
獨立 admin 帳號）；Node v26.6.0。

| 陳述 | 如何驗證 |
| --- | --- |
| §2 三條啟動拒絕及其訊息 | 實際啟動應用程式；對照組（四個 ring 齊全）正常啟動、health 200 |
| §3 encryption 輪替全程 | 以 5 列資料執行步驟 1–5；對照組證明解密檢查會失敗 |
| §3 Customer 工具需要完整環境 | 實際執行，缺 `JWT_SECRET` 時失敗 |
| §4 lookup 輪替及查重 | 實際執行；對照組證明查重能區分存在與不存在的帳號 |
| §6.1 exit code 0／1／2 | `test/supplierBankRotationCli.test.js` 及整合測試（TASK-036） |
| §6.3 並發寫入不被覆蓋 | REV-056 以真實並發寫入驗證 |
| §7 備份內容及不含 key | 實際備份並掃描；對照組證明掃描有效 |
| §8 admin 才能還原 | 以應用帳號還原實際失敗（ERROR 1419），以 admin 還原成功 |
| §8 缺／錯 key fail closed | TC-077（CI 上執行） |

**未執行驗證的陳述**已在內文標示（§6.1 死鎖的 reason 字樣；§6.2 Customer 批次回滾；§8 異地還原）。
