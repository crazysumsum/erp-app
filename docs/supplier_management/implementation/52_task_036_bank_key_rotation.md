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

## 4. 「呢張表掃乾淨未」嘅條件

`supplierRowsDrained = remaining === 0 && failures.length === 0`。

第二個條件唔係多餘。一個**寫咗之後先死**嘅行（例如 commit 階段出事）會令
`remaining` 變 0 而同時留低一個未解釋嘅失敗 —— 嗰種狀態唔應該當成掃乾淨。
單元測試特登造咗呢個情況（`failAfterWrite`），而拆走第二個條件佢會紅。

> **呢一節本來叫「剷舊 key 嘅條件」，而個欄位本來叫 `safeToRemoveFromKey`。**
> 兩樣都改咗：REV-054 H-1 之後，呢個 module 唔再發出「可以剷 key」呢個授權 ——
> 佢只數得到 `supplier_bank_accounts` 一張表，而同一個 key ring 綁住
> `customer_bank_accounts`。見 §11。（REV-055 M-2）

## 5. 一個意外做到嘅 fail-closed 示範

人手驗證途中我為咗重跑，直接 `UPDATE ... SET encryption_key_id='rot-old'`，令個
key id 講大話（行本身已經用新 key 加密咗）。結果：

```json
{ "kind": "encryption", "from": "rot-old", "to": "rot-new",
  "processed": 0, "attempted": 5, "declined": 0, "failed": 5,
  "failures": [ { "id": 804, "reason": "BANK_ACCOUNT_TAMPERED" },
                { "id": 805, "reason": "BANK_ACCOUNT_TAMPERED" },
                … 806, 807, 808 … ],
  "lastId": 808, "remaining": 5, "supplierRowsDrained": false,
  "warnings": [ { "code": "RING_SHARED_WITH_OTHER_TABLES",
                  "scope": "supplier_bank_accounts",
                  "message": "supplierRowsDrained covers supplier_bank_accounts only. …" } ],
  "startedAt": 1790302436642, "endedAt": 1790302436649 }        exit=1
```

> 呢段引過兩次錯嘅嘢。第一次引嘅係一個 pipe 分隔嘅摘要同一句 `Supplier bank
> account failed authentication: …`，**兩句喺當時份 code 度都出唔到**（REV-053
> L-4）。第二次（REV-053 remediation 嗰次）係真嘅，但佢引住 `safeToRemoveFromKey`
> 同埋冇 `warnings` —— 而 REV-054 H-1 之後嗰個形狀又唔同咗（REV-055 M-2）。上面
> 呢段係喺**呢一版 code** 上面重跑同一個情境嘅實際輸出，`exit=1`。
>
> 一份實作報告引用輸出，就要同引用一個測試結果一樣：每次改完都要重跑。

即係一個 key id 同密文對唔上嘅行，唔會被「重新加密」成一堆垃圾 —— GCM 個 auth tag
擋住咗，逐行記低 id，唔授權剷 key，exit code 1。呢個唔係我特登設計嘅測試，但佢示範咗
嗰條路係 fail closed 嘅。

## 6. 驗證

| | |
| --- | --- |
| `server/test/supplierBankKeyRotation.test.js` | **8/8** |
| `server/test/integration/supplierBankRotation.integration.test.js` | **4/4**（真 MySQL） |
| Supplier server suite（兩個 glob 已經覆蓋新檔案，profile 唔使改） | **407/407** |
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

411/411 supplier server suite、lint exit 0。

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

414/414 supplier server suite、646/646 client、lint exit 0。`main` merge 咗（15 個
commit），順帶確認咗 `TC-001` 嗰個 flake 已經喺 `main` 修好（本機 `pass 1 / fail 0`）
—— 之前擋住呢個 PR 嘅就係佢。

## 10. REV-053 remediation

REV-053（`f0bc0de`）報 **0 Critical、0 High、4 Medium、9 Low、5 Info**。佢逐條跑過
REV-051 同 REV-052 六條 Medium —— 五條 CLOSED，一條 PARTIALLY CLOSED —— 亦都重跑咗
§9 十四個 mutant，十四個確認死。佢自己開咗一個私人 MySQL 26.7.0 實例去驗，所以
「真 MySQL 上面係點」嗰啲句唔係讀返嚟嘅。

四條 Medium 入面三條係同一個病，而嗰個病我喺呢個 task 已經見咗第五、第六次：
**要緊嗰樣嘢由測試替身講，唔係由 code 講。**

### M-1 —— cursor 嘅方向仲係 double 供嘅

REV-052 M-2 原文喺**同一句**入面點咗兩樣嘢：double「硬寫 `r[column] === params[0]
&& r.id > params[1]`，**而且無條件 sort**」。我修咗前半 —— 教識佢讀 `WHERE`，所以
`AND id > ?` 而家真係由被測 SQL 釘住 —— 然後冇掂後半。

```
[SURV-1 ORDER BY id DESC] unit:  SURVIVED exit=0     15/15
[SURV-1 ORDER BY id DESC] integ: SURVIVED exit=0     4/4，真 MySQL
```

真 MySQL 上面，五行全壞、`batchSize: 2`：

```
正確   {"verdict":"terminated","attempted":5,"failed":5,"order":[59,60,61,62,63]}
DESC   {"verdict":"terminated","attempted":3,"failed":3,"order":[63,62,63]}
```

五行掃三行，59／60／61 由頭到尾冇睇過，63 掃咗兩次，而個 run 報 `attempted: 3` 就
算數。`remaining` 係另一條 `COUNT(*)`，所以 `safeToRemoveFromKey` 唔會講大話 ——
呢個係佢 Medium 唔係 High 嘅原因。

修法：double 照住 SQL 讀 `ORDER BY (\w+)( DESC)?`，冇 `ORDER BY` 就拒絕答。

### M-2 —— `safeToRemoveFromKey` 個 lookup 分支冇人測過

`remainingRows` 揀邊個欄位係一條三元式，而嗰條三元式就係 `safeToRemoveFromKey` 嘅
全部。全個 repo 冇一條測試喺 lookup 輪替之後睇過一個**非零**嘅 `remaining`：

- lookup 輪替測試把每一行都換晒 → 兩邊都係 0；
- lookup guard 測試收尾兩行都喺新 key → 兩邊都係 0；
- duplicate 測試係唯一一個有行留低嘅 lookup 情境，而佢淨係睇 `failed`／`reason`／
  `constraint`，冇睇過 `remaining`；
- integration 嗰個做咗一半嘅測試用自己一句 raw `COUNT(*)` 去數，由頭到尾冇讀過個
  report。

所以 `const column = "encryption_key_id"` 咁一個 token 嘅改動，令一個做咗一半嘅
lookup 輪替報 `remaining: 0, safeToRemoveFromKey: true`，而三行仲喺 `look-old`
上面，兩套測試照綠、exit 0。Operator 照 runbook 剷走 `look-old`，嗰三行嘅 blind
index 就再冇得比對 —— 正正係設計 §5.8 靠嗰條路。

呢個 mutation 嘅形狀值得記低：佢係 copy-paste，而且**同 double 自洽** —— double 係
靠 `sql.includes("encryption_key_id")` 揀欄位嘅，所以一個改咗嘅 SQL 字串會令 double
跟住個 mutant 一齊錯。

修法：duplicate 測試釘 `remaining` 同 `safeToRemoveFromKey`；integration 嗰個做咗
一半嘅測試要求個 report 同佢自己嗰句 raw `COUNT(*)` 講同一件事。兩套都殺到。

### M-3 —— F-M1 嗰三句掃描係捉唔到嘢嘅

兩個獨立問題。

**(a) 喺會出事嗰次，佢哋一句都冇行過。** `constraint` 嗰句 `assert.equal` 喺佢哋
前面，F-M1 個 mutant 一放落去就係佢先炸，成條測試即刻停。三句掃描淨係喺乾淨嗰次
行過 —— 而嗰次本來就冇嘢俾佢捉。

**(b) 對住真 MySQL，三句入面兩句結構上唔可能 match。** 佢哋照住我個
`duplicateKeyError()` 校準，而嗰個 helper 每一個 byte 都寫成 `\xNN`、由 index 第
一個 byte 起頭。我喺 MySQL 26.7.0 起咗個私人實例，用同一條複合 UNIQUE 撞出真訊息：

```
Duplicate entry '26-look-new-\xFA\xA0\xD6tk\x0D#,(?\xF8\xE9fj\xB1\x16\xC9\xADB\x9' for key '…'
```

三個分別：個值係**成條複合鍵**，所以前面有 `26-look-new-`；**可印 byte 原樣出**，
得非可印嗰啲先變 `\xNN`；成個值喺**第 64 個字元硬切**，切到一半個 escape 都照切
（我用三組唔同資料量過，每次都啱啱 64）。

即係 `escaped.slice(0, 24)`（頭六個 byte 全部 escaped）要求六個連續非可印 byte ——
隨機 HMAC 大概 6% 機會；而 hex 嗰句永遠冇可能，MySQL 由頭到尾唔會連續出 hex。

呢個係 F-M1 本身嗰個錯，喺高一層重覆一次：F-M1 走甩，就係因為我個 base64 掃描
掃緊一個我自己諗出嚟嘅形狀。為咗防佢復發而寫嘅測試，掃緊另一個我自己諗出嚟嘅形狀。

修法三樣：`duplicateKeyError()` 出真形狀（複合前綴、可印原樣、64 字元硬切）；掃描
搬去**自己一條測試**，唔再企喺一句會先炸嘅 assert 後面；逐個編碼（latin1、hex、
HEX、base64、base64url、MySQL 渲染形）滑一個八字元窗，因為真訊息會切，「成個 index
有冇出現」係一個捉唔到嘢嘅問題。最後加一句**負控制**：同一個掃描行落一個真係漏咗
嘅 report 上面，一定要報 `["mysql"]`。冇呢句，「掃唔到」同「掃緊一個搵唔到嘅形狀」
係分唔開嘅。

### M-4 —— `--limit=0` 改寫成張表，`--batch-size=0` 一行都唔做

同一個 `0`，兩個相反意思，而且就喺嗰個「謹慎試探」用嘅旗上面（`limit = 0` 喺
`runRotation` 入面係「冇上限」，`batchSize = 0` 係 `LIMIT 0`）。真 CLI：

```
--limit=0       {"processed": 5, "attempted": 5, "remaining": 0, "safeToRemoveFromKey": true}
--batch-size=0  {"processed": 0, "attempted": 0, "remaining": 5, "safeToRemoveFromKey": false}
```

個 validator 特登擋負數，但收 `0`。加埋三樣：冇 `--help`；兩個 entry 嘅註解得
`--from` 同 `--to`；而 `parseArguments` export 咗但**成個 `server/test` 冇一個檔案
import 過佢** —— 旗解析、exit code 合約、進度列印，全部淨係靠 §6 一次手動 run 撐住。
REV-052 M-1 就係住喺呢一片無人測嘅面上。

修法：兩個旗都收 `>= 1`，`--limit` 嗰句錯誤講埋點樣做先啱（「唔好寫佢」）；加
`--help` 同 `USAGE`；兩個 entry 註解補齊；開 `test/supplierBankRotationCli.test.js`，
8 條。

### 順手收咗嘅 Low

| | |
| --- | --- |
| L-1 | `startedAt` 同 `endedAt` 之前係同一個 `now`，elapsed 結構上永遠 0。加 `clock` 參數：`now` 繼續定住警告算術，計時用真時間。 |
| L-2 | `rotateRow` 唔睇 `affectedRows`，所以 guard 一響嗰行照計入 `processed` —— 即係冇咗唯一一個講得出 guard 響過嘅訊號。而家分開報 `declined`。（double 都要跟住修：mysql2 寫到嘢嗰次一樣回 `[ResultSetHeader, fields]`，唔係 `undefined`。） |
| L-3 | 進度列印 gate 喺 `processed % 100`，而 `processed` 喺啲行一路壞嗰陣唔郁，`0 % 100 === 0` —— 一張壞表變成一行 stdout 一行資料。改用單調遞增嘅 `attempted`。 |
| L-4 | §5 引嘅輸出喺呢份 code 度出唔到。已經換成真 CLI 重跑嘅實際輸出。 |
| L-5 | §6／§7／§9 三個 suite 數（352／356／359）每個都比 ledger 同一個 run 記低嘅細 55。已經改成 ledger 嗰組（407／411／414）。 |
| L-6 | 唔前進嘅 cursor 係**掛死**唔係 fail，而 `node --test` 冇 timeout。上限放喺 double 度（第 51 個 SELECT 就拒絕答），唔放喺一條測試度 —— 因為第一條撞到嘅測試先係掛死嗰條，而佢唔一定有 wrapper。 |
| L-7 | `after` 冇 caller 冇測試，剷咗。 |
| L-8 | Operator 打錯嘢之前收到成個 Node stack trace。`main` 頭尾兩截都包住咗：打錯旗印一句人話加 usage（exit 2），打錯 `--from`／`--to` 亦都係。錯誤訊息唔再回顯 raw argv。 |
| L-9 | `--to=e2=x` 之前靜靜雞截成 `e2`（base64 key material 本身帶 `=`）；`--json=false` 之前等於 `--json`。兩個都收緊咗。 |

冇收嘅：**L-6 冇做成 CI 全域 `--test-timeout`**。個上限係呢個檔案自己嘅 double，
所以呢個檔案任何唔終止嘅 mutant 都變成一句 assertion；但第二個檔案將來寫一個唔終止
嘅迴圈，`npm test` 仍然會掛。全域加 timeout 會改變成個 server suite 嘅行為（有啲
integration 測試本身就慢），我唔喺呢個 PR 度冒嗰個 flake 險。

### Mutation：十六個，十六個殺到，冇一個掛死

```
M-1  ORDER BY id DESC              KILLED   L-9 split('=') truncates again    KILLED
M-1b drop ORDER BY                 KILLED   L-8 unknown flag echoes argv      KILLED
M-2  remainingRows always enc      KILLED   L-2 rotateRow always claims write KILLED
M-3  safeReason forwards message   KILLED   L-1 endedAt is startedAt          KILLED
M-3b safeReason forwards a slice   KILLED   drop AND id > ?                   KILLED（之前掛死）
M-4  --limit accepts 0 again       KILLED   F-M3 encryption guard vacuous     KILLED
M-4b --json accepts a value        KILLED   F-M3b lookup guard vacuous        KILLED
REV-052 M-1 drop --from check      KILLED   safeToRemove ignores failures     KILLED
```

`M-3b` 係新加嘅一個：只轉發訊息**中間三十個字元**嘅洩漏。舊嗰三句捉唔到（連
`"Duplicate entry"` 嗰句都唔喺嗰個切片入面），新嗰個滑窗掃描捉到。

### 驗證

| | |
| --- | --- |
| `server/test/supplierBankKeyRotation.test.js` | **17/17** |
| `server/test/supplierBankRotationCli.test.js`（新） | **8/8** |
| `server/test/integration/supplierBankRotation.integration.test.js` | **4/4**，真 MySQL 26.7.0 |
| Profile suite `supplier-phase-001-server`（原本 argv） | **424/424**，0 fail 0 skipped |
| Client | **646/646**（呢次冇掂過 client） |
| lint | exit 0 |

真 CLI 亦都行過：fail-closed 示範（上面 §5）、`--limit=0` 拒絕、`--help`、打錯嘅
`--from`、`--to` 唔係 active。

全套 `npm test`（server）係 2002 pass／1 fail／2 skipped，而嗰條 fail 係
`TC-016 adapter verifies a separately restored schema`，佢要 `DB_ADMIN_USER`／
`DB_ADMIN_PASSWORD`，喺 GitHub Actions 之外要自己俾。我喺**未改過嘅 `f0bc0de`**
上面用同一個環境跑同一條測試，一模一樣咁紅 —— 即係我部機個 MySQL setup，唔係呢個
改動。CI 嗰邊嗰條有 root/root，照跑。

## 11. REV-054 remediation

REV-054（`98c72f4`）報 **0 Critical、1 High、4 Medium、8 Low、5 Info**。佢確認咗
REV-053 四條 Medium 入面兩條全閉、三條部分閉，亦都逐個重跑咗 §10 十六個 mutant ——
**十六個全部確認死，冇一個掛死**，包括嗰個由「掛死」變成「一秒內六句 assertion」
嘅 cursor mutant。佢自己另外跑咗二十一個 mutant，三個打真 MySQL。

### H-1（High）—— 個 report 授權剷一個第二張表仲用緊嘅 key

呢一條唔係測試質素問題，而且佢唔係我寫錯咗嘢 —— **佢係一個 merge 整出嚟嘅**。

呢個 candidate 本身包住一個 `origin/main` merge，而 `main` 帶咗
`checkSharedBankKeyRings` 入嚟：Customer 同 Supplier 兩個 bank key ring 必須**逐個
byte 一樣**，連 `activeKeyId` 都要。而 `customer_bank_accounts` 有自己嘅
`encryption_key_id` ／ `blind_index_key_id`。`remainingRows` 由頭到尾只數一張表。

即係 `safeToRemoveFromKey: true` —— 一個明文授權，exit 0 —— 可以喺 customer 仲有行
用緊嗰個 key 嘅時候出。我用真 `validateApplicationConfiguration` 量咗三個情況：

```
ACCEPTED  k-old 仲喺兩個 ring 入面（剷之前）
REFUSED   k-old 只喺 SUPPLIER ring 度剷走
          Customer and Supplier bank capabilities must use the same key rings with owner-separated AAD
ACCEPTED  k-old 兩個 ring 一齊剷走（即係個授權叫人做嗰樣嘢）
```

「剷」冇得剷一半。Operator 照住個 report 做，就會兩個 ring 一齊剷，而 customer
嗰啲行**永久解唔返**。全個 repo 得呢個 tool 會發出「可以剷」呢個授權 ——
`CustomerBankMaintenanceService` 只報 `{ processed, lastId, remaining }`，唔落判斷。

**最要緊嗰句唔係個缺陷本身。** REV-053 §7.2 特登查過「有冇第二張表帶
`encryption_key_id`」，當時答案係冇，而嗰個答案當時係啱嘅。**一個 merge 就令佢過咗
期，而冇任何嘢會再查一次。** 一個由人查一次就當真嘅性質，下一個 merge 一樣可以再
推翻佢。

**修法（HD：收窄個聲明，唔跨 module 查表）。** 呢個 module 唔會查另一個 module 嘅
表 —— HD-034 已經為呢個 task 食咗一個 `OUTSIDE_MODULE`，而「查多張表」會令兩個
module 直接耦合。所以答案係**唔再發出呢個授權**：

- `safeToRemoveFromKey` 改名做 `supplierRowsDrained`，佢而家只講得出一件事：
  `supplier_bank_accounts` 呢一張表掃乾淨未。
- 每一次 run **無條件**出一個 `RING_SHARED_WITH_OTHER_TABLES` 警告，講明同一個
  key id 亦都保護緊 `customer_bank_accounts`、兩張表都報零之前兩個 ring 邊個都唔
  可以剷，並且點名 customer 嗰兩個 tool。唔使條件判斷：`checkSharedBankKeyRings`
  要求兩個 capability 一齊開，所以只要呢個輪替行得起，第二張表就一定喺度。
- 兩個 entry script 個祈使句（「舊 key ... 先可以由 ring 度剷走」）剷咗。

而 REV-053 §7.2 嗰個性質而家係**一條測試**，唔再係一個 reviewer 睇過一次嘅事實：
個 report 唔准再有任何讀落似 ring-wide 授權嘅欄位（`/safe|removable|canRemove/i`），
而每個 run 都要帶住嗰個警告。一個唔授權嘅工具，冇得授權錯。

### M-1 —— 釘住咗方向，冇釘住欄位

REV-053 教識個 double 讀 `ORDER BY (\w+)( DESC)?`，所以 `DESC` 死得。但個**欄位**
冇人釘：`ORDER BY supplier_id` 喺真 MySQL 會跳行（cursor 係 `AND id > ?`，排序一旦
唔跟 `id`，一批返嚟嘅最大 id 就會永遠掃走細 id 嘅行），而單元測試殺到佢純粹因為
「cursor advances」嗰條測試個 wrapper sniff 緊字串 `"ORDER BY id"` —— 即係釘住佢嘅
係個 harness，唔係一句 assertion。

第四輪連續：修正收咗被點名嗰個，留低佢兄弟。

修法：wrapper 改成 sniff `"ORDER BY"`，再加一條六行、`supplier_id` 次序同 `id`
次序**相反**嘅測試，要求每行都掃到。舊嗰條測試睇唔到，係因為佢五行同一個
supplier_id —— 排序穩定，次序一樣。

### M-2 —— 用未逃逸嘅針，掃逃逸咗嘅草堆

REV-053 把 `duplicateKeyError()` 改成 MySQL 真形狀（複合前綴、可印 byte 原樣、64
字元硬切），啱嘅。但個掃描係咁樣比：

```js
const serialised = JSON.stringify(report);
leakedEncodings(serialised, index)
```

MySQL 個訊息帶住 `\xFA` 咁嘅**兩個字元** —— 一個反斜線加一個 x —— 而
`JSON.stringify` 會把嗰個反斜線變成兩個。針同草堆永遠對唔上。我自己用兩萬個隨機
index 量過，一個**完整嘅真洩漏**擺喺 report 入面：

```json
{"samples":20000,"missed_scanning_JSON":"59.6%","missed_scanning_strings":"0.0%"}
```

（REV-054 量到 55.2%，同一個數量級，另一批隨機數。）個 fixture 係固定嘅，所以今日
嗰條測試唔算 flaky、兩個 `safeReason` mutant 都照殺 —— 但佢聲稱建立嗰個性質（「任何
編碼都漏唔出去」）根本冇建立到。

修法：攤平個 report 啲字串嚟掃，唔再掃佢個 JSON 編碼；負控制跑三個唔同帳號，因為
一個固定 fixture 之下「呢次啱」同「每次都啱」係兩件事。

### M-3 —— `main()` 仍然冇一個測試 import 過

REV-053 M-4 嗰句點名咗四個冇人睇嘅面：旗解析、exit code 合約、進度列印、pool 接線。
Remediation 測咗第一個。REV-054 把 REV-053 喺 `main` 入面嗰個修正（`processed % 100`
→ `attempted % 100`）**原封不動 revert 返**，25 條測試全綠。一個冇嘢睇住嘅修正，同
冇修過係同一件事。

修法：抽 `progressReporter` 出嚟做一個 export，直接測「每行都失敗嗰陣唔可以一行
資料一行 stdout」；另外加一條直接 import `main` 嘅測試 —— 壞旗要 exit **2**（唔係
1，1 係留返俾「輪替行過，有行失敗」）、唔准出 stack trace、唔准回顯嗰個值，而
`--help` 要 exit 0。兩條路都喺開 pool 之前就返，唔使資料庫。

### M-4 —— 個 catch 中間有十二行冇包到

`main` 個 top-level catch 一頭包住 `parseArguments`，一尾包住 `runRotation`，中間
`dotenv.config`、五個 dynamic import、`normalizeSupplierConfig`、
`new SupplierBankCrypto`、`createMySqlDatabasePool` —— 一句都冇包。而一個爛咗嘅
`SUPPLIER_BANK_ENCRYPTION_KEYS` **正正就係輪替期間最容易犯嗰個錯**。實測（修之前）：
原裝 Node stack trace，exit **1** —— 即係呢個 CLI 自己個合約留返俾「有行失敗」嗰個
code，一個 runbook 會照讀錯。

修完之後：

```
$ SUPPLIER_BANK_ENCRYPTION_KEYS='{"rot-old": "not-base64-at-all!!"' \
    node scripts/rotateSupplierBankEncryption.js --from=rot-old --to=rot-new
Supplier config "bankEncryption.keyRing" must be a valid JSON object
exit=2
```

`pool` 而家喺 try 外面宣告，`finally` 要 `if (pool)` —— 因為佢可能根本未起得成。

### 順手收咗嘅 Low

| | |
| --- | --- |
| L-3 | `--batch-size` 之前淨係封低唔封高，而隔籬 `rotateCustomerBankEncryption.js` 兩頭都封。補返上限 1000，usage 寫埋。 |
| L-4 | `--from=` 空值之前報「both --from and --to are required」—— operator 明明打咗。而家分開報。 |
| L-5 | 最尾嗰句 `COUNT(*)` 死咗之前會連成份 report 一齊掟走（做咗幾多行、邊幾行失敗、cursor 去到邊，全部冇埋）。而家記低做一個失敗，`remaining` 留 `null`，於是 `supplierRowsDrained` 自動 false —— 唔知等於唔可以當掃乾淨。 |
| L-6 | 冇任何嘢睇住 `processed + declined + failed === attempted`。補咗一條。 |

冇收嘅兩條，同 REV-053 一樣理由：**L-8 冇做成 CI 全域 `--test-timeout`**（個上限住
喺呢個檔案自己個 double，第二個檔案將來寫個死循環仍然會掛 `npm test`；全域加
timeout 會改變成個 server suite 行為，唔喺呢個 PR 冒嗰個 flake 險）；**L-7 進度列印
喺一百行以下嘅 run 一句都唔出**（嗰種 run 一兩秒收工，個 report 本身就係輸出）。

### Mutation：二十三個，二十三個殺到，冇一個掛死

```
H-1  report re-authorises removal   KILLED   L-5 COUNT failure discards report KILLED
H-1b drop the shared-ring warning   KILLED   L-2 rotateRow always claims write KILLED
M-1  ORDER BY supplier_id           KILLED   L-1 endedAt is startedAt          KILLED
M-1b ORDER BY id DESC               KILLED   drop AND id > ?                   KILLED
M-1c drop ORDER BY                  KILLED   F-M3 encryption guard vacuous     KILLED
M-2  remainingRows always enc       KILLED   F-M3b lookup guard vacuous        KILLED
M-3  safeReason forwards message    KILLED   REV-052 M-1 drop --from check     KILLED
M-3b safeReason forwards a slice    KILLED   safeToRemove ignores failures     KILLED
M-3c progress gate back to processed KILLED  M-4 --limit accepts 0 again       KILLED
L-3  drop batch-size upper bound    KILLED   M-4b --json accepts a value       KILLED
L-4  empty --from reports required  KILLED   L-9 split('=') truncates again    KILLED
L-8  unknown flag echoes raw argv   KILLED
```

### 驗證

| | |
| --- | --- |
| `server/test/supplierBankKeyRotation.test.js` | **22/22** |
| `server/test/supplierBankRotationCli.test.js` | **11/11** |
| `server/test/integration/supplierBankRotation.integration.test.js` | **4/4**，真 MySQL 26.7.0 |
| Profile suite `supplier-phase-001-server`（原本 argv） | **434/434**，0 fail 0 skipped |
| Client | **665/665** |
| lint | exit 0 |

全套 `npm test`（server）：2168 條，2164 pass、3 skipped、**1 fail**，而嗰條仍然係
`TC-016`（要 `DB_ADMIN_USER`／`DB_ADMIN_PASSWORD`，GitHub Actions 以外要自己俾）。
我喺未改過嘅 code 上面用同一個環境跑過同一條，一模一樣咁紅。

> **§10 嗰組數係喺 `7cd42e3` 度量嘅，即係 merge `main` 之前。**（REV-054 L-1／L-2）
> 同一個 profile suite 喺 merge 之後係 426，而家係 434；全套 server suite 喺 merge
> 之後係兩千一百幾條，唔再係兩千零幾。兩組數各自喺自己嗰個 commit 度啱，冇改
> §10 —— 一個歷史記錄唔應該扮自己係喺第二個 commit 度量嘅。
