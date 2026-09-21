# TASK-032 — Bank persistence 與 crypto primitives（PHASE-003 開局）

**Task：** TASK-032（T32）・**Phase：** PHASE-003・**Capability：** SUP-CAP-03
**分支：** `claude/supplier-task-032`（由 main `087b268` 切出）
**Schema 批准：** HD-027・**Plan baseline：** `a0d41e31…`・**Design baseline：** `e4083319…`

## 0. 兩件開局就要講清楚嘅事

**分支前綴改咗。** Product Owner 2026-09-21 指示用 `claude/<name>`，唔再用 `codex/`。
`05_development_tasks.md` 嘅 PHASE-003 段落寫住「一個獨立 `codex/` 分支」，呢度**刻意
唔改嗰份文件** —— 佢 hash 落 PLAN baseline，改佢會令所有綁住嗰個 baseline 嘅
approval、review 同 observation 一次過失效。偏離已記錄喺 revision 142。

**Migration 編號 0037。** main 上面 36 個 migration 去到 `0036_create_supplier_settings.js`，
所以 0037 係下一個空號。已知風險：未 merge 嘅 `codex/customer-management-phase-001`
亦都定義緊 0035／0036（同 main 撞緊），所以佢本身一定要重新編號；兩條分支之中後
merge 嗰條要讓路。呢個唔係 T32 製造嘅，但佢而家多咗一個持份者。

## 1. Scope

| 檔案 | 性質 |
| --- | --- |
| `server/database/migrations/0037_create_supplier_bank_accounts.js` | 新 migration（approval-required path，由 HD-027 授權） |
| `server/src/modules/supplier/SupplierBankCrypto.js` | 新 module |
| `server/test/supplierBankCrypto.test.js` | 新，16 個測試 |
| `server/test/integration/supplierCoreMigrations.integration.test.js` | +2 個測試 |

`server/config/supplier.js`、`server/.env.example` 同 `normalizeSupplierConfig.js`
**冇改**：四個 `SUPPLIER_BANK_*` 變數同 key ring 驗證喺 T18／T24 已經存在。核實過一個
未配置 key 嘅環境仍然正常 —— `normalizeSupplierConfig({})` 兩組都回 `null`，唔拋錯。
T32 冇動搖呢個性質。

## 2. 三個 AC 逐條

### AC1 — 每列 random 96-bit IV、128-bit tag，AAD 綁 supplierId ＋ cryptoContext；tamper／搬 row 驗證失敗

IV 每次 `randomBytes(12)`。GCM 喺同一條 key 之下重用 IV 唔係「弱少少」，係直接洩漏
明文異或值同 authentication key，所以唔可以用 counter 或者由資料衍生。

AAD 綁兩樣：`supplierId` 令一行密文搬去另一個 Supplier 之下解唔開；`crypto_context`
令同一個 Supplier 之內兩行都對調唔到。格式用**長度前綴**而唔係單純夾個分隔符號。

測試：round trip、IV 唔重複、搬 Supplier 失敗、對調 context 失敗、ciphertext／tag／IV
各翻一個 bit 都失敗、AAD 邊界移位失敗。

### AC2 — Lookup ring 可計算全部 candidate indexes，write 只用 active key 並回 key ID；一般 SHA-256 不處理帳號

`blindIndex()` 只用 active key 並回個 ID；`candidateBlindIndexes()` 行晒成個 ring。
淨係用 active key 查重係會漏嘅 —— 輪替途中同一個帳號喺新舊 key 之下計出唔同 index，
「換咗 key ID」就變成一條繞過重覆檢查嘅路。

「一般 SHA-256 不處理帳號」用**負面對照**證：測試真係計一次 `createHash("sha256")`
出嚟，斷言個 index 唔係佢。帳號嘅可能空間細到可以直接窮舉，所以一個冇 key 嘅 digest
等於明文。

### AC3 — Mask 短帳號不洩漏完整值；所有 error／inspect／test output 不含明文、key 或 ciphertext

`maskBankAccount` 喺長度 ≤ 4 時全部星號。連「有人錯手將短帳號全值放咗入 `lastFour`」
都測咗 —— 遮罩唔可以原樣吐返出嚟。

洩漏面逐個封：`SupplierBankCrypto` 有 `[inspect.custom]` 同 `toJSON`，所以一個
`console.log(service)` 或者一個將 service 整個寫落 error context 嘅 logger 都攞唔到嘢；
解密失敗嘅訊息刻意唔帶任何輸入（一個講得出「邊一段唔啱」嘅訊息就係一個 oracle）；
測試本身斷言錯誤訊息入面冇帳號、冇密文、冇任何 40 字元以上嘅 base64 團。

測試檔**唔會出現真 key**：每次跑即場 `randomBytes(32)`。一條 commit 咗入 repo 嘅測試
key，就算註明「僅供測試」，都係一條可以貼去別處用嘅 32 bytes。

### AC4 — Bank table 沒有 plaintext 欄位，具 key IDs、唯一 default 及 duplicate constraints；既存 table 必須通過完整 schema compatibility assertion

表照 design §5.8。三個保證由資料庫執行：冇明文欄位；`default_slot` generated stored
配 UNIQUE（MySQL 冇 partial index，而 UNIQUE 唔比較 NULL）；查重 UNIQUE 包住
`blind_index_key_id`，否則輪替途中會爆假 duplicate。

最後嗰句 —— 既存表要通過 assertion —— 係一個純 DDL 讀取證明唔到嘅嘢，所以用行為證：
`inspectSupplierBankAccountSchema` 收一個 `table` 參數，測試喺一張 probe 表上面逐樣整
歪（VARCHAR 嘅 IV、短咗嘅 ciphertext、可寫嘅 slot、同名但非唯一嘅索引、多咗個明文
欄位），每樣都要拋錯。另加一個**對照組**：未整歪嗰張複製表要啱啱好喺 FK 檢查度停低
—— 冇呢一步，下面每個 case 嘅紅都可能只係嚟自「複製表本身就過唔到」。

（`table` 參數係為咗測試而加嘅，講清楚：另一個做法係將真表 RENAME 走再改返，但
`erp_dev` 係共用嘅，咁樣會拆咗並行跑緊嘅其他檔案。）

## 3. 變異測試 —— 兩個活咗，兩個都係真問題

十七個變異，逐個獨立套用、即刻還原、每次都核實 `git status` 乾淨。

| # | 變異 | 結果 |
| --- | --- | --- |
| B1 | 固定 IV | **RED** |
| B2 | 加密唔落 AAD | **RED** |
| B3 | AAD 冇長度前綴 | **第一次 GREEN — 見下** |
| B4 | blind index 改用一般 SHA-256 | **RED** |
| B5 | 查重淨係用 active key | **RED** |
| B6 | 解密用 active key 而唔係行本身嗰個 | **RED** |
| B7 | 短帳號遮罩回 `lastFour` | **RED** |
| B8 | 拆走 `[inspect.custom]` | **RED** |
| B9 | 正規化唔移除分隔符號 | **RED** |
| S1 | 拆走二進位欄位型別檢查 | **RED** |
| S2 | 拆走 `default_slot` generated 檢查 | **RED** |
| S3 | 拆走 UNIQUE 索引核實 | **RED** |
| S4 | 拆走 FK 名檢查 | **RED** |
| S5 | 拆走 `FORBIDDEN_COLUMNS` 檢查 | **GREEN — 見下** |
| S6 | 拆走欄位集合相等檢查 | **RED**（S5 修正之後） |
| S7 | `default_slot` UNIQUE 變普通 KEY | **RED** |
| S8 | 查重 UNIQUE 唔包 `blind_index_key_id` | **RED** |

**B3 活咗，係我個測試寫錯。** 原本用 supplierId `1` / ctx `"2x"` 對 `12` / `"x"`，但
中間有個 `|ctx:` 分隔符號，嗰兩對根本唔會撞 —— 所以拆走長度前綴佢照綠。改成真正嘅
碰撞（值本身含住分隔符號：`sup "1|ctx:2" + ctx "3"` 對 `sup "1" + ctx "2|ctx:3"`）
之後 RED。順帶講清楚：呢兩個輸入今日到唔到，supplierId 係數字而 crypto_context 係
server 出嘅 UUID，所以呢條測試證嘅係個格式本身冇歧義，唔係一條而家行得通嘅攻擊路徑。

**S5 活咗，係我寫咗段死碼。** `FORBIDDEN_COLUMNS` 個名單永遠行唔到：上面嗰個欄位集合
相等比較已經擋死咗任何帶明文欄位嘅表 —— 多一個 `account_number` 就數目唔啱，改名做
`account_number` 就少咗個預期欄位。已經拆走。一個永遠唔會觸發嘅守衛比冇守衛更差，
因為佢讀落似有保護。順手修埋個 probe 嘅期望：原本寫 `/A|B/`，兩邊都過，即係乜都冇
分辨到 —— 同 REV-030 抓到嗰幾個 vacuous assertion 係同一個形狀。

## 4. Developer self-test

| Suite | 結果 | Evidence |
| --- | --- | --- |
| `supplier-phase-001-server` | **PASS** 332/332（原 314，+18） | `evidence/20260921T012622-ac0749bc394b/run.json` |
| `supplier-phase-001-client` | **PASS** 71/71 | `evidence/20260921T012625-ab61b8906643/run.json` |
| `lint` | **PASS** | `evidence/20260921T012630-2ffaee4d1e99/run.json` |
| `client-build` | **PASS** | `evidence/20260921T012632-8a25265f3d51/run.json` |

Migration 喺真 MySQL 上面實跑過（`npm run migrate`），`SHOW CREATE TABLE` 逐行核對過
同設計 §5.8 一致，再跑一次確認收斂。

**冇跑 Playwright，講清楚點解：** T32 淨係 server 同 migration，冇任何 UI 改動，冇一段
新程式碼係瀏覽器行得到嘅。CLAUDE.md §9 要求嘅係前端／使用者體驗受影響嘅改動；Bank 嘅
UI 喺 T35。呢度唔係跳過驗證，係冇對應嘅驗證對象。

## 5. 仲未做嘅（唔屬於 T32）

- **Bank capability 部署後兩組 key ring 為無條件 startup requirement** —— T32 只建表同
  primitive，未接 capability registry。今日一個未配置 key 嘅環境照樣起得到，而呢個性質
  T32 有核實過冇打爛。
- **輪替腳本**（`supplier:bank:rotate-encryption`、`supplier:bank:reindex-lookup`）喺
  設計 §2.6 有定義，但唔喺 T32 嘅 scope。`SupplierBankCrypto` 嘅形狀（逐行記 key ID、
  `candidateBlindIndexes` 行晒成個 ring）就係為咗佢哋可以逐行推進、中斷、續跑。
- **Bank domain service** 係 T33。
