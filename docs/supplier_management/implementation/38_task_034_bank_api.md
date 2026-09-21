# TASK-034 — Bank API 與敏感資料邊界

**Task：** TASK-034（T34）・**Phase：** PHASE-003・**Capability：** SUP-CAP-03
**分支：** `claude/supplier-task-034`（由 main `b1e3aa8` 切出）
**批准：** HD-030（部署 capability ＋ CI 注入測試 key）、HD-031（改 profile，重建 PLAN baseline）

## 0. 加呢六條 route，就係部署 Bank capability

Handler 喺 startup 即刻構造（`framework/api/handlerRegistry.js`），而 `SupplierBankService`
冇 crypto 就起唔到，`SupplierBankCrypto` 冇兩組 key ring 亦都起唔到。所以由呢個 task 起，
**兩組 key ring 係無條件嘅 startup requirement**。

設計 §1700 明文要求呢個：「Bank capability 已部署但缺 key 時應用 startup fail closed，
**不允許只關閉 bank endpoint 後照常啟動**，否則付款流程會在更晚時才失敗。」

**實測過佢真係生效**，唔係靠讀碼：拆走四個環境變數，`business-master/http.integration`
即刻死喺 `SupplierBankCrypto requires both the bankEncryption and bankLookup key rings` ——
**成個 app 起唔到**，唔係 bank route 壞。

代價喺提問嗰陣講明咗：任何冇配置 key 嘅環境（包括同事嘅本機）一 pull 就起唔到。所以
`server/.env.example` 嗰段改寫成明確講「唔再係選填」，連產生指令一齊寫。

## 1. 三層防線放喺 static metadata

| | |
| --- | --- |
| **遮罩清單** | 淨係要 `supplier.view`，而且**冇 query schema** —— 冇一個 flag 可以喺上面問 reveal（AC-023） |
| **Reveal** | 獨立 POST、`jwt-password`、`supplier.view` ＋ `supplier.bank.view`，**刻意唔要** `bank.mgmt`：睇同改係兩件事 |
| **寫入** | 三個 permission 一齊要，加 `jwt-device-password` |
| **Request** | 每個 schema `additionalProperties: false` |
| **Response** | **冇一個遮罩 schema 講得出帳號或者任何 crypto metadata**。就算 service 有日多回一個欄位，response validation 都會攔住佢 —— 呢個係結構性防線，唔靠每個 handler 記得投影 |

Reveal 係唯一講得出帳號嗰個，而佢淨係講得出三樣嘢。

## 2. 寫呢個 task 期間自己揾到一個真 bug

**五條 step-up route 嘅 body schema 全部漏咗宣告 `password`。**

`passwordReauth.js` 喺 schema 驗證**之前**由 `req.body.password` 讀佢，所以漏咗**唔會**
令個密碼消失 —— 佢會令成個請求死喺 `additionalProperties: false` 上面，變成一個講唔通嘅
400，而五條 route 全部用唔到。

而當時 handler 測試入面每一個宣告式斷言都係綠嘅：路徑啱、authType 啱、policy 啱、
`additionalProperties: false` 啱、`reason` 啱。冇一個望到「個請求根本過唔到驗證」。

**係對住 `approvalSchemas.js` 同 `supplierSchemas.js` 核對慣例先至揾到**，唔係測試揾到。
已加，並且加咗一條專門釘住佢嘅測試。

## 3. 收咗一個由 TASK-031 帶到而家嘅缺口

**REV-032 M-4**：呢個模組之前冇一層係由 dispatcher → handler → service → MySQL 行足全程
（handler 測試係宣告式，兩個 e2e spec 全部 `page.route` mock 咗 API）。

而家有：起真 app、發真 request，斷言

- 冇 token → 401
- 遮罩清單 200，而**成個 response body**（唔係淨係嗰個 item）冇帳號、冇 ciphertext／
  authTag／blindIndex／cryptoContext／encryptionKeyId／lastFour
- 一個只得 `supplier.view` 嘅人撳 reveal → **403**，用**真密碼 hash**，所以佢證到嘅係
  「過到密碼再確認，但冇資格」，唔係死喺密碼比對度

呢個測試同時證到一件 T34 先至存在嘅事：**個 app 起得到** —— 即係 HD-030 嗰個配置真係生效。

## 4. 「Manual header check」自動化咗

T34 驗收寫住「Manual header check：reveal 含 `Cache-Control: no-store, private` 及
`Pragma: no-cache`」。人手檢查唔會每次都做，所以直接行個 handler 嘅 `execute`，用一個記住
`setHeader` 嘅假 `res` 去斷言。

框架本身已經喺每個 API JSON response 加 `Cache-Control: no-store`。呢度**收窄**佢：`private`
明講連共用快取都唔可以掂，`Pragma` 係俾只識 HTTP/1.0 快取語意嘅中間件 —— 一個公司內部嘅
舊 proxy 就係最有可能坐喺呢條 route 前面嗰種嘢。

## 5. 一個記錄低嘅偏離

設計 §6.6 個 reveal 範例有 `expiresInSeconds`。**冇做。** 嗰個數字暗示伺服器會過期一啲嘢，
但實際上冇任何 server-side 狀態同佢對應 —— 明文淨係活喺嗰一個 response 入面。一個講緊一件
冇發生嘅事嘅欄位，比冇嗰個欄位更差。UI 幾時清 component memory 係 T35 嘅事。

## 6. PLAN baseline 移咗位

Harness 個 evidence runner 只傳 profile `env_keys` 列明嗰啲環境變數
（`harness_runner.py:146`），而 supplier 嗰堆 suite 只列咗 `DB_*`。由呢個 task 起 app 冇
Bank key 就起唔到，**所以每一個 evidence run 都會 fail closed**。

加四條 key 落 profile 就解決到，但 profile hash 落 PLAN baseline。移位嘅代價喺決定之前
數清楚咗：**83 條 observation、6 條 approval（包括 HD-027 同 HD-030 自己）、78 份 evidence**
綁嘅係舊 hash。Review 綁 design hash，唔受影響。

Product Owner 按 HD-031 揀咗改 profile。舊記錄**冇改過** —— 佢哋內容全部仍然成立，只係名義上
唔再指向現行 baseline，而呢件事記低咗而唔係等人自己發現。同一個模組喺 HD-017 做過同樣嘅事，
當時亦都係先數清楚再改。

兩條帶 secret 嘅變數同時加咗入 `redaction_env_keys`。**核實過四份新 evidence 冇任何 key
material**：掃過每個檔案揾 44 字元 base64，零命中。（第一次掃嘅時候我用咗一個喺嗰個 shell
未 export 嘅變數，`grep ""` 匹配晒所有嘢，報咗四個假 LEAK —— 即係我個檢查本身冇喺度檢查。
重做咗。）

## 7. Developer self-test

| Suite | 結果 | Evidence |
| --- | --- | --- |
| `supplier-phase-001-server` | **PASS** 392/392（原 377） | `evidence/20260921T084400-a77f159e6e84/run.json` |
| `supplier-phase-001-client` | **PASS** 71/71 | `evidence/20260921T084405-8292f30ec573/run.json` |
| `lint` | **PASS** | `evidence/20260921T084411-7bbcdc693840/run.json` |
| `client-build` | **PASS** | `evidence/20260921T084415-e2ffcea635ab/run.json` |

**冇跑 Playwright**：T34 淨係 server。Bank UI 喺 T35。
