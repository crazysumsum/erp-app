# TASK-036 — Bank encryption／lookup key 輪替工具

**Task:** TASK-036 (T36) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Traceability:** SEC-010、SEC-011、NFR-009、NFR-010 ・**Design:** §2.7、§5.8
**Files:** `server/src/modules/supplier/bankKeyRotation.js`（新）、
`server/src/modules/supplier/SupplierBankCrypto.js`（＋2 個 getter）、
`server/scripts/supplierBankRotationCli.js`、`server/scripts/rotateSupplierBankEncryption.js`、
`server/scripts/reindexSupplierBankBlindIndexes.js`（新）、`server/package.json`（＋2 行）、
`server/test/supplierBankKeyRotation.test.js`、
`server/test/integration/supplierBankRotation.integration.test.js`（新）

## 1. 邏輯唔住喺 script 度

`server/scripts/` **唔喺**本模組 scope 入面。HD-034 決定咗接受嗰個 `OUTSIDE_MODULE`
（換返 design baseline 唔郁 —— 33 條 review 綁住佢，包括 T35 唯一一條 APPROVED），
所以住喺嗰度嘅嘢愈少愈好。

結果：全部邏輯喺 `server/src/modules/supplier/bankKeyRotation.js`（scope 內、收
`database`／`crypto`／`clock` 做參數、單元測試唔使真 MySQL 都行得到），而
`server/scripts/` 三個檔案係外殼 —— 解 argv、駁 config 同資料庫、印 report。

Boundary validator 對住 merge-base 報**啱啱三條** `OUTSIDE_MODULE`，全部喺
`server/scripts/`。`server/package.json` **冇**出現，因為佢喺 `approval_required_paths`
入面而 `APPROVAL-HD-035-SCOPE` 蓋住佢 —— 即係兩條路徑各自行緊佢應該行嗰條 gate。

## 2. 續跑唔使進度檔案

兩條命令都係「揀 id 大過 `after` 而且**仲係舊 key** 嘅行，順住 id 做」。

**條件本身就係進度**：做完嘅行個 key id 已經唔再係 `from`，所以下次查根本揀唔中佢。
一個崩咗嘅 run 同一個做完一半嘅 run，喺呢個查詢眼中係同一件事 —— 唔使 checkpoint
檔案，亦都冇「進度檔案同資料庫講唔同嘢」嗰類失敗。

一行一個交易。全部一個交易會令大 ring 嘅輪替鎖住成張表幾分鐘；而「中途死咗會留低
做咗一半嘅狀態」喺呢度唔係代價 —— 每行自己一致，未做嘅行仲係舊 key。

## 3. `--to` 係確認，唔係選擇器

`encryptAccountNumber` 同 `blindIndex` **一定**用 active key（設計 §5.8：新增／修改
只用 active），冇參數揀得到第二條。所以 `--to` 唔可能係一個目標選擇器。

佢係一個**確認**：如果 caller 心目中嘅目標同 active 唔同，就係佢對緊一個唔存在嘅輪替
落命令 —— 嗰陣停，唔係靜靜雞寫入 active key 然後回報成功。`--from === --to` 一樣拒。

## 4. 剷舊 key 嘅條件

`safeToRemoveFromKey = remaining === 0 && failures.length === 0`。

第二個條件唔係多餘。一個**寫咗之後先死**嘅行（例如 commit 階段出事）會令
`remaining` 變 0 而同時留低一個未解釋嘅失敗 —— 嗰種狀態唔應該授權剷走一條 key。
單元測試特登造咗呢個情況（`failAfterWrite`），而拆走第二個條件佢會紅。

## 5. 一個意外做到嘅 fail-closed 示範

人手驗證途中我為咗重跑，直接 `UPDATE ... SET encryption_key_id='rot-old'`，令個
key id 講大話（行本身已經用新 key 加密咗）。結果：

```
processed 0 | failed 5 | remaining 5 | safeToRemove false   exit=1
failure reason: Supplier bank account failed authentication:
                the row, its context or its ciphertext was altered
```

即係一個 key id 同密文對唔上嘅行，唔會被「重新加密」成一堆垃圾 —— GCM 個 auth tag
擋住咗，逐行記低 id，唔授權剷 key，exit code 1。呢個唔係我特登設計嘅測試，但佢示範咗
嗰條路係 fail closed 嘅。

## 6. 驗證

| | |
| --- | --- |
| `server/test/supplierBankKeyRotation.test.js` | **8/8** |
| `server/test/integration/supplierBankRotation.integration.test.js` | **4/4**（真 MySQL） |
| Supplier server suite（兩個 glob 已經覆蓋新檔案，profile 唔使改） | **352/352** |
| lint | exit 0 |

### Mutation：八個，八個殺到

```
drop the from-key filter              KILLED    ring limit off by one          KILLED
reindex: key id not written           KILLED    transition limit off by one    KILLED
safeToRemove ignores failures         KILLED    encryption: ciphertext not rewritten  KILLED
--to not validated against active     KILLED    failures swallowed entirely    KILLED
```

**第一次跑呢八個，四個生還**，而其中兩個生還嘅原因係同一個：我個假資料庫按**參數位置**
派欄位，所以我改個 SQL 字串（例如剷走 `blind_index_key_id = ?`）佢照樣寫入。個 double
嗰陣唔係喺度扮 MySQL。改成**讀 SET 子句**決定邊個欄位收邊個參數之後先至殺到。

另外兩個生還係測試唔夠：`safeToRemove` 冇試過「remaining=0 但有失敗」，而過渡期警告
冇試過 30／31 日嘅邊界。兩樣都補咗。

### 人手中斷續跑（T36 驗收第三項）

真 CLI、真資料庫、五行：

```
rotate-encryption --limit=2   → processed 2, remaining 3, safeToRemove false   舊 key 3 行
rotate-encryption（續跑）      → processed 3, remaining 0, safeToRemove true    舊 key 0 行
reindex-lookup --limit=3      → processed 3, remaining 2                       舊 key 2 行
reindex-lookup（續跑）         → processed 2, remaining 0, safeToRemove true    舊 key 0 行
```

續跑冇傳任何進度參數。

### Report 唔含祕密（驗咗真輸出，唔淨係單元測試）

掃真 CLI 嘅 stdout＋stderr：兩條 key 嘅 base64、兩個帳號明文、任何 43 字元 base64
—— 全部零命中。**而且驗過個掃描分辨得到**：種一條 key 落一個檔案，同一條命令揾得返。

Report 有嘅係 `kind`、`from`／`to` 嘅 key **id**、數量、失敗行嘅 **id** 同 reason。
Key id 唔係祕密 —— 佢一行行寫咗喺 `encryption_key_id` 同 `blind_index_key_id` 度。

## 7. 順帶加咗兩個 getter

`SupplierBankCrypto` 加咗 `encryptionKeyIds` 同 `lookupKeyIds`（ring 大細警告要用）。
回 **id** 唔回 material；`toJSON` 同 inspect 仍然係 `[REDACTED]`，驗過。

呢個係我自己寫 `ringWarnings` 嗰陣先發現嘅 —— 我一開始用咗兩個唔存在嘅 getter，
`node -e` 一行就爆咗出嚟。
