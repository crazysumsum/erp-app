# TASK-033 — Bank domain service

**Task：** TASK-033（T33）・**Phase：** PHASE-003・**Capability：** SUP-CAP-03
**分支：** `claude/supplier-task-033`（由 main `5125f32` 切出）

## 0. 先收咗 DEF-021

T33 就係寫入 API，而 DEF-021（由 REV-034 M-2 帶落嚟）正正卡喺呢度，所以喺寫 service
之前先解決。**Product Owner 揀咗「剝排版，拒內容」（HD-029）。**

正規化而家分兩步，而兩步嘅**失敗方向唔同**：

1. 排版字元剝走 —— 空白、Unicode 格式／隱形字元（Cf）、Unicode 連字號（Pd）、
   U+2212、同印刷帳號上常見嘅 `.` `/` `_` `,` `·` `‧` `:`。呢步唔係方便係必須：
   設計 §6.6 個 create 範例本身就係 `"accountNumber": "123-456789-001"`。
2. 剝完之後仲有任何非 `[0-9A-Z]` 嘅嘢，**拒絕**，唔改寫。

第二步就係 DEF-021。之前兩步合埋做一步剝晒，結果 `ÅB12345`、`ÄB12345` 同 `B12345`
三個唔同輸入存成同一個帳號 —— 而個儲存值就係最終會俾錢嗰個，所以嗰條係錯收款人嘅路，
唔淨係一個查重嘅怪癖。NFKC 亦都喺白名單之前行，所以 `½` 會經 `1⁄2` 變成 `12`。

**點解呢個做法企得住：排版清單唔完整都冇所謂。** 一個我列唔到嘅新分隔符號會落入第二
步俾人**大聲拒絕**（用戶見到、改得到），而唔係靜靜哋改走個帳號。黑名單嘅不完整而家
fail closed。寫測試之前逐個核對過 reviewer 自己嗰批 case：REV-033 十個繞得過嘅排版
字元全部塌埋，REV-034 三個會撞埋一齊嘅輸入全部被拒。

## 1. Service

六個操作，三條貫穿成個檔案嘅規則：

- **讀路徑唔掂密文。** 每個 SELECT 明寫欄位，冇一個 `SELECT *`。BR-020 講明冇銀行查看
  權限嘅人唔可以透過列表、詳情、稽核、CSV、通知或者錯誤訊息攞到完整帳號 —— 而最穩陣
  嘅做法係啲密文根本冇離開過資料庫。
- **明文只喺 request-local memory 出現。** 佢淨係喺 create／update 嘅入口同 reveal 嘅
  出口存在；唔入 audit detail、唔入錯誤 details（設計 §6.6 明文禁止）。
- **permission freshness 每次寫入重驗。** `assertActorFresh` 只比對 claim 同現況，佢
  唔執行任何 permission，所以一個誠實地冇 `bank.mgmt` 嘅 caller 要喺第二層停低。

### 幾個值得單獨講嘅決定

**`reveal` 嘅次序就係佢全部重點。** 解密同稽核都喺交易入面，交易 commit 成功之後先至
回明文。一個「先回帳號、事後補 audit」嘅實作喺 audit 寫入失敗嗰陣會派咗個帳號出去而冇
任何紀錄 —— 而嗰個正正係最需要紀錄嘅情況。解密失敗亦都整個 rollback，唔會留低一筆
「有人睇過」但其實乜都冇睇到嘅稽核。兩個 case 都有測試。

**重新加密沿用同一個 `crypto_context`。** 佢係呢一行嘅身分，唔係呢一次加密嘅身分。換
咗佢，AAD 就綁去一個新身分，而個 `crypto_context` 欄位本身唔會被更新 —— 即係舊備份
入面嗰段密文再解唔返。

**跨 Supplier 重覆只係 warning。** 兩間公司共用一個收款帳號係合法嘅業務情況，唔應該喺
service 層封死。而冇 `supplier.view` 就連對方 Supplier Code 都唔回 —— 一個 code 已經足
夠辨認一間公司，唔應該靠「反正唔係帳號」就派出去。

**查重用晒成個 lookup ring。** 輪替期間同一個帳號喺新舊 key 之下計出唔同 index，淨係查
active key 就變成一條繞過重覆檢查嘅路。

**停用清埋 `is_default`。** Generated slot 喺 status 唔係 active 嗰陣本身就變 NULL，但
`is_default` 要一齊清，否則個 row 重新啟用嘅時候會靜靜哋搶返個 slot。

**Service 冇 crypto 就起唔到。** 冇「冇 key 就唔加密」嘅後備路徑 —— 咁樣一個忘記配置
key ring 嘅環境會靜靜哋用明文寫入，而嗰個環境唔會有任何嘢出聲。

**冇 `delete`。** FR-BANK-005 講被引用之後只可停用；而引用擋嘅係硬刪，**唔係**停用 ——
一個已經停用嘅帳戶仍然解釋得返歷史付款，所以 `deactivate` 唔會因為有引用而拒絕。

## 2. 三條 Acceptance 逐條

| Acceptance | 證據 |
| --- | --- |
| List 不 select encrypted columns | 單元測試逐個禁忌欄位名掃過成串 SQL，兼證冇 `SELECT *` |
| create／account-change 才 encrypt | `update` 只喺帳號真係有改嗰陣先將四個密文欄位放入 SET 清單；兩邊都有測試同變異 |
| same-Supplier duplicate 阻擋、cross-Supplier 只回必要 warning | 單元同整合各一組；warning 唔含帳號，冇 `supplier.view` 連 code 都冇 |
| Default 切換原子清舊設新 | 單元證鎖序（先鎖晒 active rows 再清再設）；整合證真 row 同 generated slot；另有兩條連線同時撳嘅併發測試 |
| deactivate 清 default 且尊重 Payment reference | 整合證停用之後個 slot 放返出嚟、第一個帳戶可以重新做預設 |
| 沒有 Bank 仍不阻止 Supplier | FR-BANK-004／AC-027 —— 本 task 冇加任何會擋住啟用嘅嘢；Supplier 啟用路徑完全冇 import 呢個 service |
| Reveal 先成功寫 audit／commit 才回明文 | 單元證「audit 係交易最後一件事」同「audit 失敗唔回帳號」；整合打真 MySQL round trip |
| 任何 audit／decrypt 失敗不回帳號 | 竄改密文嘅測試證解密失敗之後**零** audit row |

## 3. 最重要嗰個整合測試：明文掃描

T33 個驗收條件原本寫「**Manual DB check**：fixture 明文在 Bank table、audit 及 system
log 搜尋結果為 0」。人手做嘅檢查唔會每次都做，所以改成自動：逐個欄位由
`information_schema` 攞返個欄位名單，然後掃 `supplier_bank_accounts` 同
`supplier_audit_logs` 每一行每一個欄位（binary 欄位當 latin1 睇），揾嗰個獨特嘅 fixture
明文。

嗰個測試**自己帶對照組**：掃完之後種一個明文入 `account_holder_name`，再掃一次，要求
今次揾得到。冇呢一步，前面兩句「邊度都冇」可能只係因為個掃描器壞咗。

## 4. Developer self-test

| Suite | 結果 | Evidence |
| --- | --- | --- |
| `supplier-phase-001-server` | **PASS** 367/367（原 338，+29） | `evidence/20260921T025754-3addc84b03e6/run.json` |
| `supplier-phase-001-client` | **PASS** 71/71 | `evidence/20260921T025758-273c5b3043d2/run.json` |
| `lint` | **PASS** | `evidence/20260921T025802-2b5dbb2878bb/run.json` |
| `client-build` | **PASS** | `evidence/20260921T025806-2b462a3bf35f/run.json` |

**冇跑 Playwright**：T33 淨係 server，冇任何 UI 改動。Bank UI 喺 T35。

## 5. 變異測試

十四個（十一個 service + 三個正規化），全部 RED。

| # | 變異 | 結果 |
| --- | --- | --- |
| D1 | 拆走拒絕步驟（回復靜靜哋剝） | **RED** |
| D2 | 排版集合回復「剝晒所有非字母數字」 | **RED** |
| D3 | 排版集合收窄到只剩空白 | **RED** |
| T1 | `list` 改用 `SELECT *` | **RED** |
| T2 | 拆走寫入 permission 檢查 | **RED** |
| T3 | 查重只用 active key | **RED** |
| T4 | 跨 Supplier 重覆改成擋 | **RED** |
| T5 | warning 不論權限都回對方 Supplier Code | **RED** |
| T6 | `update` 永遠重新加密 | **RED** |
| T7 | `deactivate` 唔清 `is_default` | **RED** |
| T8 | `setDefault` 跳過鎖 active rows | **RED** |
| T9 | `reveal` 吞咗 audit 失敗 | **RED** |
| T10 | 拆走 crypto 型別檢查 | **RED** |
| T11 | 重新加密時換新 `crypto_context` | **第一次 GREEN — 見下** |

**T11 活咗，係我個測試寫錯。** 我原本斷言 UPDATE 嘅參數入面冇舊 context —— 但
`crypto_context` 根本唔喺 SET 清單入面，所以無論用新定舊 context 加密，個參數清單都
唔會有佢。個斷言喺兩邊都成立，即係乜都冇分辨到；同 REV-030／REV-034 抓到嗰幾個
vacuous assertion 係同一個形狀。改成證真正嘅性質：**重新加密之後嗰段密文，要用行入面
存住嗰個 context 解得返**。修完之後 RED。

（順帶：第一版嘅修法都唔啱 —— 我揀嘅測試帳號係十二位，而 GCM 密文長度等於明文 byte
數，所以段密文同個 IV 一樣長，個 buffer 揀錯咗。改用一個長度唔撞嘅帳號。）

## 6. 未做嘅

- **HTTP handlers 唔喺 T33 嘅 scope。** 設計 §6.6 六條 route 屬於後續 task；呢個
  service 而家仲未有任何 production caller。
- **Bank capability 未接 registry**，所以「部署後兩組 key ring 為無條件 startup
  requirement」仍然未生效。
- **輪替腳本**（`supplier:bank:rotate-encryption`、`supplier:bank:reindex-lookup`）。
- REV-034 帶落嚟嘅 L-3（`VIRTUAL` 收咗）、L-4（`CHECK` 冇讀）、L-6（解密 catch 將設定
  錯誤報成資料完整性錯誤），同埋 trigger 檢查冇測試嗰個缺口 —— 全部仍然開住。

## 7. REV-035 及其修補

獨立 security review **REV-035** 判 **CHANGES_REQUESTED**（head `8718fa7`）：三個 H、
四個 M、五個 L。完整報告喺 `34_rev_035_independent_review.md`。

Reviewer 講得好準：加密、AAD、blind index 同鎖序本身冇問題，三個 H 全部喺**邊界** ——
service 拒絕啲乜、佢點樣正規化、以及佢拒絕嗰陣同 caller 講乜。

### H-2 係最重要嗰個，而且佢令 §0 寫錯咗

分類之前行 `NFKC` 係**相容性**折疊，佢會將一大堆內容字元變成純 `[0-9A-Z]`，於是佢哋
喺第二步望落好似冇問題咁過咗。實測 U+0080–U+1FFFF：**1225 個碼位**係咁。

```
"12²345" -> "122345"    多咗一個數字
"ᴮ12345" -> "B12345"    同 "B12345" 撞成同一個帳號
"Ⓑ12345" -> "B12345"    同上
"ß…"     -> "SS…"       仲要變長
```

即係 REV-034 M-2 嗰個「三個唔同輸入存成同一個帳號」**根本冇收到** —— 佢只係由 `Å`／`Ä`
嗰批搬咗去 `ᴮ`／`Ⓑ` 嗰批。而 HD-029 揀嗰個做法嘅全部理由就係「列唔到嘅字元會大聲
拒絕」，NFKC 令嗰 1225 個做咗**相反**嘅事。

改成 `NFC`（只做標準組合）再明確折疊全形 ASCII 三段。全域重掃之後淨低兩個會被折疊嘅
碼位，兩個都係**標準等價**（U+0387 → U+00B7、U+212A → `K`），即係 Unicode 定義佢哋同
目標本來就係同一個字元 —— 呢個正正係要嘅。

順帶捉到一個 reviewer 都冇提嘅：`toUpperCase()` 自己都會漂白，`ß` 變 `SS`。轉大寫收窄
到只限 ASCII `a-z`。

**一個要明講嘅記錄錯誤。** 上面 §0、`SupplierBankCrypto.js` 嘅註解、同 HD-029 喺 ledger
入面嘅問題描述，三個地方都用咗 `½ → 12` 做例子。**嗰個例子唔成立** —— `½` 喺 NFKC 之下
變 `1⁄2`，而 U+2044 FRACTION SLASH 係 `Sm`，唔喺排版集合入面，所以佢一直都喺被拒絕
嗰邊。即係我當時攞咗一個唔成立嘅例子去問 Product Owner，而真正會漏嗰批（`²`、`②`、
全形）冇擺出嚟過。決定本身仍然成立 —— 而且喺真例子之下更加成立 —— 但個記錄要更正。

### H-1：拒絕變成 500，而個測試睇唔到

`requireAccount` 拋 raw `TypeError`，而佢喺 `withTransaction` 入面拋，所以真嘅 database
wrapper 會包成 `DATABASE_TRANSACTION_FAILED`。HD-029 嘅理由係「用戶見到、改得到」；一個
500 兩樣都唔係。而且帳號欄位喺 service 層根本冇驗過 —— 連「完全冇帶帳號」都係 500。

**個測試當時過到，係因為 harness 嘅假 `withTransaction` 冇模仿真 wrapper 嗰層錯誤轉換。**
而家模仿咗，而佢即刻又揾到第二件事：一個竄改咗嘅行本來都係匿名 500，日誌分唔出「資料
被改過」同「條 key 唔喺 ring 入面」—— 兩者處理方法完全唔同。改成具名 422
`BANK_ACCOUNT_UNREADABLE`。

一個假嘢冇模仿到嘅行為，就係測試睇唔到嘅行為。

### H-3：查重同 unique index 講唔同嘢

Service 過濾 `status = 'active'`，但設計 §5.8 嗰條 UNIQUE 冇 status 謂詞。而「停用咗，
再加返同一個帳號」正正係使用者會行嘅路（FR-BANK-005 令停用係唯一嘅退役方式），結果由
一個清楚嘅 409 變成 `ER_DUP_ENTRY` 500。拆走個過濾；再按設計 §2.5 捉 `ER_DUP_ENTRY`
翻譯返做 409，順帶分開 default slot 撞車嗰條。

### 其餘

| findings | 處理 |
| --- | --- |
| **M-1** `list` 完全冇 permission 檢查 | 已修：加返 `supplier.view`（刻意唔係 `bank.view`，AC-023） |
| **M-2** `maskBankAccount` 冇 production caller，規則重覆實作 | 已修：拆走我嗰個孤兒，規則喺 `toMaskedBankResponse` 度測 |
| **M-3** 跨 Supplier warning 喺併發下消失 | **唔改**：佢本質上就係 advisory —— 一個 warning 唔係一條規則，而個 index 係 per-Supplier，冇嘢會 serialise 佢。記錄低 |
| **M-4** 掃描器對照組種落文字欄位，證唔到 binary 分支 | 已修：種落 `account_ciphertext` |
| **L** 403 唔係 409、帶空格嘅 error code、冇讀過嘅 `references` | 已修 |
| **L** `reveal` 冇 `expiresInSeconds`、`revealedAt` 喺 commit 之後先蓋 | **未改**：屬於 §6.6 嘅 HTTP contract，而 route 唔喺 T33 scope |

### 修補後重跑

372/372 server（原 367）、71/71 client、lint、build，四份 evidence 全部喺最終候選重新
跑過。九個針對修補嘅變異全部 RED。

## 8. REV-036（覆驗）及其修補

判 **CHANGES_REQUESTED**，一個 H —— 而佢係**同一個形狀嘅第三次**。

### H-1：個守衛喺生產環境永遠唔會行

`MySqlDatabaseExecutor.run()` 將**每一句** statement 錯誤包成
`MySqlDatabaseOperationError{ code: "DATABASE_OPERATION_FAILED", cause }`，所以 driver
嗰個 code 跌咗落 `error.cause.code`。我個守衛淨係睇 `error.code` —— 一個恆假嘅條件。
兩個並發 create 喺生產之下仍然係 500，而 driver 嗰句嘅第一個成分就係**重覆嗰個 blind
index 嘅原始 bytes**。

**而成套測試分辨唔到。** Reviewer 將守衛改到**啱**，56/56 照綠：單元 harness 直接拋一個
`code: "ER_DUP_ENTRY"` 嘅 raw error，而整合嗰個 `serviceOn` 傳緊一條 raw mysql2 連線。
兩個 fake 都冇做嗰層 per-statement wrapping。

**呢個係同一句話嘅第三次：一個假嘢冇模仿到嘅嗰層，就係測試睇唔到嘅嗰層。**

1. T33 原本嗰個 vacuous assertion —— `crypto_context` 唔喺 SET 清單，所以斷言兩邊都成立。
2. REV-035 H-1 —— 假 `withTransaction` 冇模仿真 wrapper 嘅錯誤轉換。
3. REV-036 H-1 —— 補咗嗰層之後，**再下面一層**仍然係假嘅。

修補：兩個 fake 都補（單元加 `wrappedDuplicate`，整合加 `executorLike` proxy），另加
一個整合測試叫真 MySQL 真係撞嗰條 UNIQUE，確認 errno 1062 出得嚟、而個 service 譯得返
409 兼唔帶走 driver 嗰句。

### 其餘

| findings | 處理 |
| --- | --- |
| **M-3** `message.includes()` 揀分支 | 已修：MySQL 嗰句第一個成分係**重覆嗰個值本身**，用 `includes` 等於攞使用者資料嚟掃；格式仲要跟版本唔同。改用 errno 1062 加錨定 regex |
| **M-2** 只有 create 個 INSERT 包咗 | 已修：預查正正就係輸競態嗰個，所以 update 同 setDefault 嘅 UPDATE 一樣要蓋 |
| **M-1** `logger.warn` arity 錯，payload 跌咗入 message 個位 | 已修，並且加咗第一個真係望個 log 嘅測試 —— 個 422 嘅全部理由就係「喺日誌分得出」 |
| **note** `BANK_ACCOUNT_DEFAULT_RACE` 今日到唔到 | 留住並且喺註解講明佢係一條冇覆蓋嘅防守分支（`suppliers FOR UPDATE` 已經排晒隊，但唔係每個未來 writer 都會攞嗰個鎖） |

### Reviewer 確認咗嘅嘢

H-2 佢掃咗**成個** Unicode 範圍到 U+10FFFF（我只掃到 U+1FFFF），確認除咗全形三段之外
淨低一個會折疊嘅碼位 U+212A，而佢同意嗰個標準等價論點：拒絕佢反而會將一個帳號變成
兩個，正正係 HD-029 要避免嗰件事嘅反面。**冇第三條漂白路徑** —— 佢用三個方向試過（組合
符號、完全消失嘅字元、操作次序）全部負面。佢亦都確認 `ß → SS` 係佢 REV-035 漏咗嘅一條
真路徑，同埋 REV-035 M-3（跨 Supplier warning）唔改係啱嘅取捨。

### 修補後重跑

376/376 server（原 372）、71/71 client、lint、build，四份 evidence 全部喺最終候選重新
跑過。五個針對修補嘅變異全部 RED。

## 9. REV-037 及一條應該留低嘅標準做法

判 **CHANGES_REQUESTED**，一個 H。

### H-1：上一輪嘅修正自己整咗一個同樣形狀嘅新洞

`{ constraint: wantsDefault ? A : B }` —— 個約束由 caller 嘅**意圖**揀，但爆邊條係由
**資料**決定。一句帶 `is_default = 1` 嘅 INSERT 兩條約束都違反得到，所以「想做預設 +
帳號撞咗」嗰格走甩，變返 500 兼帶住 driver 嗰句（佢第一個成分就係重覆嗰個 blind index
嘅原始 bytes）。而一個 Supplier 嘅第一個銀行帳戶通常就係剔住「設為預設」 —— 即係
`create` 最常見嗰個形狀。

我原本測咗對角線兩格（`isDefault` 冇設 + blind index、`isDefault: true` + default slot），
啱啱好漏咗壞咗嗰格。改成收清單逐條問，三格全測。

### 第四層 —— reviewer 直接答咗我問佢嗰條

`MySqlDatabaseOperationError` **繼承 `ApplicationError`**，所以佢帶住 `statusCode: 500`。
我兩個 double 掟嘅係 plain `Error`，於是過唔到 `withTransaction` 嗰個 ApplicationError
測試，會**再包多一層**：

```
生產：   MySqlDatabaseOperationError(DATABASE_OPERATION_FAILED) → driver        兩節
假嘢：   Error(DATABASE_TRANSACTION_FAILED) → Error(DATABASE_OPERATION_FAILED) → driver   三節
```

今日冇嘢倚賴呢個分別 —— 但我個新整合測試喺 `cause` **同** `cause.cause` 兩處揾 driver
訊息，即係佢啱只係好彩，唔係設計。

修法拆嘅係成個**類別**，唔係一個實例：兩個 double 同佢哋模仿嗰樣嘢住喺同一個 repo，
所以直接 `import` 返真嗰個 class 掟，冇得再漂移。另外兩樣 reviewer 點名而我照做：兩個
double 都冇設 `REPEATABLE READ`（而呢個 task 花咗三輪 review 嘅查重競態行為正正倚賴
嗰個隔離級別之下嘅 snapshot 時序），同埋整合 double 喺 commit 失敗之後照 rollback，而
真嘅程式碼刻意唔做 —— 嗰陣個交易結果係未知嘅，rollback 會扮成「肯定冇入到」。

### 一個等價變異，唔係缺口

`find` 換 `findLast` 存活。呢個**唔係**測試缺口：一句 `ER_DUP_ENTRY` 只會點名一條 key，
而個 regex 錨定咗結尾嘅單引號，所以清單入面最多一條夾得到。實測確認過，並且喺註解講明
「first match」唔帶任何次序意義。分得清「等價變異」同「測試睇唔到」係重要嘅 —— 前者
唔應該逼一個扭曲嘅測試去殺佢。

### 應該留低嘅標準做法

呢個 task 一共**四次**出現「啱同錯喺測試眼中一模一樣」：

1. `crypto_context` 嗰個 vacuous assertion —— 斷言喺兩邊都成立
2. REV-035 H-1 —— 假 `withTransaction` 冇模仿真 wrapper 嘅錯誤轉換
3. REV-036 H-1 —— 補咗嗰層之後，再下面一層仍然係假嘅
4. REV-037 H-1 —— 修正本身缺一格，而 reviewer 將佢改到**啱**，60/60 照綠

前三次係**假嘢唔夠似**。第四次唔係 —— 個 double 已經夠似，但個測試矩陣缺一格。所以
兩條做法都要，唔可以只做一條：

- **可以刪走個 double 就唔好改善佢。** 呢條係 REV-038 教返轉頭嘅，而佢用嘅例子就係
  **寫低呢條規則嗰個 commit 本身**：我喺整合 double 入面將 `committed = true` 放咗喺
  `await commit()` **之後**，所以 commit 一失敗就永遠到唔到，個 double 照樣 rollback
  —— 即係做咗佢自己上面兩行註解話唔可以做嗰件事。真嘅程式碼喺 await **之前**設。
  一個講啱嘢嘅註解配一段做錯嘢嘅碼，係最難察覺嗰種。

  Import 返真嘅 class 拆走咗**值**嗰條軸（錯誤物件唔會再漂移），但拆唔走**決定**嗰條
  軸 —— 個 double 仍然抄住一堆分支，而抄嘅嘢會漂。呢個整合測試根本唔需要一個 double：
  佢已經接住真 MySQL，當初手寫 `withTransaction` 純粹係歷史。用一個真
  `MySqlDatabaseService` 接真 pool（約十五行，要設 `transactionTimeoutMs`）會一次過
  拆走 reviewer 數到嘅十三條差異，包括呢一條 —— 因為根本冇第二份抄本可以錯。
  **一條列舉式嘅規則，永遠會比下一個缺陷少一項。**

- 退而求其次，刪唔走嘅時候：**一個 double 要複製佢模仿嗰樣嘢真正交出乜。** 唔係
  「行為差唔多」，係「掟同一個 class、包同一層、設同一個隔離級別」。可以 import 返
  真嘢就唔好自己描述一次。
- **一個修正加咗個判別式之後，將佢變異成「正確」嗰個實作，確認有嘢變紅。** 平時嘅變異
  測試係將啱嘢改壞；呢一條係反方向 —— 如果將一個壞實作改到啱，成套測試照綠，咁佢由頭
  到尾都冇喺度測嗰樣嘢。

### 修補後重跑

377/377 server、71/71 client、lint、build，四份 evidence 全部喺最終候選重新跑過。


## 10. REV-038（第四輪覆驗）—— APPROVED

**四輪以嚟第一次冇揾到 production 缺陷。** 0 H，一個唔阻擋嘅 M，三個 note。

REV-037 H-1 佢用兩個方法核實：實跑嗰個 two-flag race（之前 `isDefault: true` 會出
`leaksDup: true` 嘅 500，而家兩格都係 409、零洩漏），再將個修正反向變異返做壞嗰個，紅。

### 第五層 —— 而佢就喺寫低嗰條規則嘅 commit 入面

我喺整合 double 將 `committed = true` 放咗喺 `await connection.commit()` **之後**，
所以 commit 一失敗就永遠到唔到，個 double 照樣 rollback —— **即係做咗佢自己上面兩行
註解話唔可以做嗰件事。** 真嘅程式碼喺 await **之前**設（`MySqlDatabaseService.js:513`）。
Reviewer 將佢搬去啱嗰邊做變異，61/61 存活，因為冇任何測試逼過一次 commit 失敗。

已修：變數改名做 `commitAttempted`（同真嘢一樣，令個對應睇得出），並且搬去 await 之前。

**個變異仍然殺唔到**，照講：要逼一次 commit 失敗需要接真 service，而嗰個正正就係下面
嗰個建議。我唔會為一個我建議刪走嘅 double 砌一套測試。

### Reviewer 對 §9 嘅修訂，我收咗

佢講得啱：import 返真 class 拆走嘅係**值**嗰條軸，唔係**決定**嗰條軸 —— 個 double 仍然
抄住分支，而抄嘅嘢會漂。所以 §9 第一條加咗「可以刪走個 double 就唔好改善佢」行先，
連埋佢個建議（真 `MySqlDatabaseService` 接真 pool，約十五行，一次過拆走十三條差異）。
**一條列舉式嘅規則，永遠會比下一個缺陷少一項** —— 呢個 task 四輪就係證明。

### `find`／`findLast`

佢核實咗我個等價論證，而且用嘅方法比我好：佢問「清單後面嗰啲元素究竟有冇被行過」。
`find → findLast` 綠、反轉次序綠，但「只睇 `constraints[0]`」**紅**。分別就喺呢度 ——
一個等價變異同一個測唔到嘅分支都會存活，分開佢哋嘅係**同一段碼上面一個非等價變異
會唔會紅**。會。
