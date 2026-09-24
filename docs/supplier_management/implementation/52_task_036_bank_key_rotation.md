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

## 7. REV-051 remediation

REV-051 報 0 Critical、0 High、**3 Medium**、7 Low、5 Info。三條 Medium 全部真，
而第一條我原本個掃描**結構上捉唔到**。

### F-M1 —— blind index 經 MySQL 嘅錯誤訊息漏入 report

我轉發咗 `error.message`，理由寫住「crypto 拋嘅訊息唔含密文或者 key」。**嗰句對
crypto 係啱嘅**（七個 throw site 都查過），但個 `catch` 同時包住 `connection.execute`
—— 而 MySQL 喺 `ER_DUP_ENTRY` 嘅訊息入面會**嵌住撞咗嗰個 key 嘅值**。對
`uq_supplier_bank_blind_index` 嚟講，嗰個值就係 **blind index**。

我自己喺真 MySQL 上重現咗個形狀：

```
Duplicate entry '\xC0\x18\x83D\xAA\xBB\xCC\xDD…' for key 'dup_probe.uq_k'
```

**而我個掃描係捉唔到嘅** —— 佢揾 base64 同 43 字元 base64，而呢個係逐 byte 轉義
走出嚟。個掃描本身冇錯（負控制證過佢揾得返種落去嘅 key），錯嘅係我由佢推出嚟嗰個
結論窄過事實：「掃唔到 base64」唔等於「冇祕密」。

修法：唔轉發任何驅動程式訊息。新嘅 `safeReason()` 只出 `DUPLICATE_KEY` ＋
**constraint 名**（schema，唔係資料）、或者一個固定識別碼、或者 `UNKNOWN`。

### F-M2 —— `--limit` 限成功數而唔係工作量

`processed` 只喺成功先加，所以 `room` 永遠唔縮而 `lastId` 照行 —— `--limit=2` 落去
一張全部會失敗嘅表，會掃晒成張表，每行一條 `failures`。一個謹慎嘅試探性 run 唔應該
咁樣變成全表掃描。加咗 `attempted`。

### F-M3 —— 防並發覆寫嗰個 guard 係啱嘅、要緊嘅，但冇嘢測

`WHERE ... AND encryption_key_id = ?` 擋住「SELECT 同 UPDATE 之間有人改咗嗰行」。
REV-051 喺真 MySQL 上證明咗佢真係做嘢；但**兩個 `OR 1 = 1` mutant 喺單元同整合
suite 都生還**。原因：我個 double 讀咗 `SET` 但**冇讀 `WHERE`** —— 而呢個 task
兩樣最要緊嘅嘢（續跑嘅過濾、同呢個 guard）**兩個都住喺 `WHERE` 入面**。

**而我第一次修都仲係測唔到。** 我加咗個並發測試，但個 double 個 `SELECT` 回嘅係
**live reference**，所以我改 table 就連手上嗰行都改埋，個 guard 無論啱定錯都會通過。
真 MySQL 回嘅係脫離咗表嘅資料。改成回副本之後，encryption 嗰個 mutant 死;
lookup 嗰個仲生還，因為我個測試淨係試咗 encryption 一邊 —— 兩邊都補咗先兩個都死。

### 另外兩個記錄唔準

- 「ring limit off by one KILLED」對 `3→4` 同 `> n+1` 係真，但 **`>` 改 `>=` 生還**
  —— 冇測試砌過一個**啱啱三條** key 嘅 ring，而嗰個正正係設計容許嘅上限同過渡期
  嘅正常狀態。我喺 30／31 日嗰度收咗呢條邊界，喺呢度冇。
- 拆走 `ringWarnings` 個 **lookup 半邊**，成套測試照綠。

### Mutation：十一個，十一個殺到

```
F-M1 forward the driver message   KILLED   drop the from-key filter       KILLED
F-M2 limit counts successes       KILLED   safeToRemove ignores failures  KILLED
F-M3 encryption guard vacuous     KILLED   --to not validated             KILLED
F-M3b lookup guard vacuous        KILLED   transition limit off by one    KILLED
ring limit > becomes >=           KILLED   reindex: key id not written    KILLED
drop the lookup half of warnings  KILLED
```

356/356 supplier server suite、lint exit 0。

## 8. 順帶加咗兩個 getter

`SupplierBankCrypto` 加咗 `encryptionKeyIds` 同 `lookupKeyIds`（ring 大細警告要用）。
回 **id** 唔回 material；`toJSON` 同 inspect 仍然係 `[REDACTED]`，驗過。

呢個係我自己寫 `ringWarnings` 嗰陣先發現嘅 —— 我一開始用咗兩個唔存在嘅 getter，
`node -e` 一行就爆咗出嚟。

## 9. REV-052 remediation

REV-052 報 0 Critical、0 High、**3 Medium**、7 Low、5 Info。

**佢確認咗 REV-051 三條 Medium 全部真係收咗**，逐個重現而唔係讀。而且 —— 值得記低 ——
**佢係第一輪確認我張 mutation 表準確嘅 review**：十一個佢自己逐個貼過，十一個都死。

三條新 Medium 全部係冇人睇過嘅地方。

### M-1 —— `--from` 由頭到尾冇驗證過

REV-051 把 `--to` 由每個角度睇過，確立咗佢係確認而唔係選擇器。**冇人睇過 `--from`。**

一個從來冇存在過嘅 `--from`，喺真 CLI 上面會回
`processed 0 / failed 0 / remaining 0 / safeToRemoveFromKey true`，**exit 0** ——
形狀同一個做完咗嘅輪替**一模一樣**。即係 operator 打錯一個字，會收到「做完，可以剷
key」，然後去剷一條仲有行用緊嘅 key。

而最諷刺嗰點 REV-052 亦都指咗出嚟：我喺呢個 PR 為咗 ring 大細警告而加嘅
`encryptionKeyIds` getter，**正正就係查呢樣嘢嘅工具，而我從來冇叫過佢去查**。

### M-2 —— 令個迴圈會停嘅嗰一句，由 double 自己補返

我修咗三次 `execute`（按位置派欄位 → 唔讀 `WHERE` → 回 live reference），**但由頭到尾
冇掂過 `db.query`**。佢一直硬寫住 `r[column] === params[0] && r.id > params[1]`。

即係 `AND id > ?` —— **令輪替會終止嘅嗰一句** —— 由個 double 提供，唔係由被測嘅 SQL
提供。我自己驗咗：剷走佢，**356 條測試全部照綠**，包括每一條真 MySQL 測試。

**呢個係呢個 task 第四個 double 失真**，而且就喺我三次都冇掂過嗰一個 method 度。
修咗之後，同一個 mutation 而家**直接令測試掛死**（冇終止）—— 即係真實症狀。

### M-3 —— 我個 F-M1 修正嘅代價

`safeReason` 個註解寫住「crypto 自己嘅錯誤有 publicCode／code」。**假嘅。** 我查咗
四條 crypto 失敗路徑：全部掟純 `Error`／`TypeError`，冇 `code`、冇 `publicCode`、
冇 `errno`。所以嗰條 `named` 分支對 crypto 嚟講係**死**嘅，而每一個 crypto 失敗都報
`UNKNOWN` ——

**而嗰個正正就係 §5 我當成特點嚟寫嘅 fail-closed 情境。** 我為咗堵一個洩漏，順手抹走咗
同一條路徑嘅診斷價值，仲喺註解度寫咗一句唔成立嘅理由去支持佢。

修法：俾 crypto 嗰幾個失敗帶一個**穩定嘅 `code`**（`BANK_ACCOUNT_TAMPERED`、
`BANK_KEY_NOT_IN_RING`、`BANK_ACCOUNT_<rejection>`），咁分類就係真嘅而唔係靠彩數。

### Mutation：十四個，十四個殺到

```
M-1 drop the --from ring check   KILLED   F-M3b lookup guard vacuous      KILLED
M-2 drop the cursor clause       KILLED（掛死）  ring limit > becomes >=  KILLED
M-3 crypto loses its code        KILLED   drop the lookup half of warnings KILLED
F-M1 forward the driver message  KILLED   safeToRemove ignores failures   KILLED
F-M2 limit counts successes      KILLED   --to not validated              KILLED
F-M3 encryption guard vacuous    KILLED   transition limit off by one     KILLED
drop the from-key filter         KILLED   reindex: key id not written     KILLED
```

### 驗證

359/359 supplier server suite、646/646 client、lint exit 0。`main` merge 咗（15 個
commit），順帶確認咗 `TC-001` 嗰個 flake 已經喺 `main` 修好（本機 `pass 1 / fail 0`）
—— 之前擋住呢個 PR 嘅就係佢。
