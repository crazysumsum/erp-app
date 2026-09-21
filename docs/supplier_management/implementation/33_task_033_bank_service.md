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
