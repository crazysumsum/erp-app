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

## 4. 「Manual header check」：`private` 未達成（DEV-T34-CACHE-PRIVATE）

T34 驗收寫住「Manual header check：reveal 含 `Cache-Control: no-store, private` 及
`Pragma: no-cache`」。**呢個條件未達成，而我原本報告話達成咗。**

`private` 去唔到線上。`sendSuccess` 第一句就係
`res.setHeader("Cache-Control", "no-store")`（`framework/http/apiResponse.js:21`，錯誤路徑
`:46` 一樣），喺 handler 之後行，而 `setHeader` 係覆寫唔係附加。REV-039 喺真 HTTP 上量到
實際值：

```
PROBE reveal(view+bank.view) : 200 | Cache-Control: "no-store" | Pragma: "no-cache"
```

我原本嗰個測試捉唔到，而且係**結構上**捉唔到：佢用一個假 `res` 直接行 `handler.execute`，
停咗喺框架覆寫之前一步。即係一個特登寫嚟代替人手檢查嘅自動檢查，喺個 header 真係錯嘅時候
**冇可能紅**。呢個同本模組反覆揾到嘅係同一類缺陷 —— 斷言「我打算做乜」而唔係「發生咗乜」。

Product Owner 2026-09-21 揀咗**記錄偏離，唔掂框架**。理由：`no-store` 本身已經禁止任何快取
（共用或私有）儲存個 response（RFC 9111 §5.2.2.5），`private` 只係「共用快取唔可以儲」，
係較弱嗰個 —— 所以實際保護冇缺口；而為咗一個 token 去改一個**所有**模組都經嘅 response
路徑，而嗰個路徑喺本模組 `allowed_write_paths` 以外，代價同收益唔成比例。

已做嘅嘢：
- Handler 唔再設一個會被抹走嘅 `Cache-Control` —— 一行冇作用嘅 code 本身就係個問題。
  `Pragma: no-cache` 框架唔掂，所以留低。
- 真正嘅斷言搬咗去整合測試嗰個成功 reveal，讀 `response.headers`：
  `assert.equal(ok.headers.get("cache-control"), "no-store")`。用 `equal` 而唔用 `match`
  係特登 —— 有一日有人改咗框架，佢會紅，而嗰陣個偏離應該係被人有意識咁收咗。
- 偏離記錄喺 `00_harness_state.json`（`DEV-T34-CACHE-PRIVATE`），唔淨係喺呢份報告。

## 5. 一個記錄低嘅偏離

設計 §6.6 個 reveal 範例有 `expiresInSeconds`。**冇做。** 嗰個數字暗示伺服器會過期一啲嘢，
但實際上冇任何 server-side 狀態同佢對應 —— 明文淨係活喺嗰一個 response 入面。一個講緊一件
冇發生嘅事嘅欄位，比冇嗰個欄位更差。UI 幾時清 component memory 係 T35 嘅事。

REV-039 L-4 講得啱：呢個偏離原本淨係活喺呢份敘述文件度，讀 ledger 或者 traceability 嘅人
唔會知 FR-BANK-006 個設計形狀冇照字面做。已經補咗一條 `DEV-T34-EXPIRES-IN` 落
`00_harness_state.json`。

## 6. Baseline 移位 —— 連我自己講錯咗嘅嗰句

Harness 個 evidence runner 只傳 profile `env_keys` 列明嗰啲環境變數
（`harness_runner.py:146`），而 supplier 嗰堆 suite 只列咗 `DB_*`。由呢個 task 起 app 冇
Bank key 就起唔到，**所以每一個 evidence run 都會 fail closed**。

加四條 key 落 profile 就解決到，但 profile hash 落 PLAN baseline。移位嘅代價喺決定之前
數清楚咗：**83 條 observation、6 條 approval（包括 HD-027 同 HD-030 自己）、78 份 evidence**
綁嘅係舊 hash。

> **更正（REV-039 H-1）。** 上一句原本仲有「Review 綁 design hash，唔受影響」。嗰句喺
> profile 嗰次移位係啱嘅，但我跟住做咗第二次移位 —— 喺 manifest 嘅
> `scope.approval_required_paths` 宣告 `.github/workflows/ci.yml` —— 而我當時話佢「機械性、
> 同 design 無關」。**錯。** DESIGN digest =
> `digest({module_id, requirements, design, scope, contracts, risk})`
> （`harness_core.py:301-307`），而 `approval_required_paths` 就住喺 `scope` 裏面。嗰一行
> 令 design hash 由 `e4083319…` 移到 `77ab26aa…`，而 `harness_checks.py:276-289` 用
> **重算**嘅 design hash 去篩 review，所以 38 條 review 一次過全部落空 —— 包括把關 T33
> merge 嗰條 REV-038，同唯一一條 DESIGN approval `APPROVAL-HD-017-DESIGN`。
> `APPROVAL-HD-031-PLAN-FINAL` 個 `source_ref` 亦都寫住「No requirement, design, … changed」，
> 同樣係假。
>
> 更正方式：Product Owner 2026-09-21 揀咗**取消嗰個 manifest 宣告**。design hash 返回
> `e4083319…`，28 條 review 連 REV-038 繼續成立。代價係 boundary validator 會對
> `.github/workflows/ci.yml` 報一個 `OUTSIDE_MODULE` —— 一個本機 path 一致性檢查嘅發現
> （佢自己都寫明「Path consistency only」），而嗰個檔案 HD-030 已經明文批咗。用一個已知
> 而且有 approval 管住嘅本機發現，換 28 條 review 嘅有效性。
>
> 兩條 `-FINAL` approval 綁嘅 `f701e9b0…` 隨住取消宣告而唔再存在，所以佢哋一併失效；
> `APPROVAL-HD-031-PLAN` 綁嘅 `db5296…` 反而返嚟成為現行 PLAN baseline。原記錄全部保留
> 冇改寫，superseding 關係寫喺新記錄度。

Product Owner 按 HD-031 揀咗改 profile。舊記錄**冇改過** —— 佢哋內容全部仍然成立，只係名義上
唔再指向現行 baseline，而呢件事記低咗而唔係等人自己發現。同一個模組喺 HD-017 做過同樣嘅事，
當時亦都係先數清楚再改。

兩條帶 secret 嘅變數同時加咗入 `redaction_env_keys`。**核實過四份新 evidence 冇任何 key
material**：掃過每個檔案揾 44 字元 base64，零命中。（第一次掃嘅時候我用咗一個喺嗰個 shell
未 export 嘅變數，`grep ""` 匹配晒所有嘢，報咗四個假 LEAK —— 即係我個檢查本身冇喺度檢查。
重做咗。）

## 7. Developer self-test

REV-040 remediation 之後喺最終 baseline（PLAN `db5296…`）重跑：

| Suite | 結果 | Evidence |
| --- | --- | --- |
| `supplier-phase-001-server` | **PASS** 393/393（原 377） | `evidence/20260921T092633-da47e14aa790/run.json` |
| `supplier-phase-001-client` | **PASS** 71/71 | `evidence/20260921T092637-72e0ac3dcc33/run.json` |
| `lint` | **PASS** | `evidence/20260921T092639-09636037d93f/run.json` |
| `client-build` | **PASS** | `evidence/20260921T092642-790c4d498704/run.json` |

之前兩批（`20260921T0844*` 綁 `db5296`、`20260921T0912*` 綁 `ba636440`）**全部保留**，冇刪。
佢哋都係真跑過嘅真樹，唯一問題係綁嘅 baseline 唔再係現行嗰個。

**核實過四份新 evidence 冇任何 key material**：搵兩條測試 key 嘅字面值，同搵任何 43 字元
base64 加 `=`，兩樣都零命中。而且今次**驗證過個 sweep 分辨得到** —— 種一條 key 落一個臨時
檔案，同一條命令揾得返。一個從來未揾到過任何嘢嘅 sweep，證明唔到「揾唔到」。

**冇跑 Playwright**：T34 淨係 server。Bank UI 喺 T35。

## 8. REV-039 remediation

REV-039（`agent-skills:security-auditor`，獨立，非作者）喺 `64ef1fc` 上報 CHANGES_REQUESTED：
2 High、3 Medium、4 Low。**九條全部真**，冇一條係誤報。攻擊資料邊界嗰邊冇一個成功（N-1 到
N-4），壞嘅係呢個改動**周圍嗰啲 baseline 簿記**，同埋兩個唔會紅嘅測試。

| # | 收法 |
| --- | --- |
| **H-1** design baseline 被 manifest 一行推咗，而記錄講相反 | 取消嗰個 manifest 宣告（PO 決定）。design 返 `e4083319…`，28 條 review 連 REV-038 繼續成立。兩處假陳述已更正 —— 見 §6，同 ledger 嗰條 subject 叫「REV-039 H-1: a manifest edit moved the DESIGN baseline and two records said it did not」嘅 observation（呢個 schema 嘅 observation 冇 id，只有 subject）。 |
| **H-2** 四份 evidence 綁緊中間 PLAN hash | 取消宣告之後現行 PLAN hash 返回 `db5296…`，即係四份 evidence 一直綁住嗰個。但 source 之後又改過（M-2／M-3／L-1／L-2／L-3），所以四個 suite 照樣喺最終 commit 重跑咗一次 —— 見 §7。 |
| **M-1** `Cache-Control: private` 過唔到線 | 驗收條件未達成，PO 揀咗記錄偏離。詳見 §4 同 `DEV-T34-CACHE-PRIVATE`。 |
| **M-2** 403 分唔開「冇資格」同「錯密碼」（mutation 存活） | 斷言改為 `revealed.body.error.code === "Forbidden"`。REV-039 已經量過兩者過到線係分得開嘅（`Forbidden` vs `PASSWORD_INVALID`）。 |
| **M-3** 冇任何測試喺 HTTP 上做過一次成功 reveal | 加咗第二個 principal（`supplier.view + supplier.bank.view`）同第二個 token，做真 200 reveal：斷言 `data.accountNumber === SECRET`、斷言**實際 wire header**、斷言啱啱一條 `supplier.bank.reveal` 稽核。AC-025／026 因為 `DEVICE_SIGNATURE_REQUIRED` 喺 authorization 之前擋住，HTTP 層依然去唔到 —— 記低咗，見下面「仲未覆蓋」。 |
| **L-1** output validation 個 flag 冇人釘 | `supplierBankHandlers.test.js` 加咗兩句斷言釘住出貨設定。**驗證過佢分辨得到**：把 `validateInProduction` 改 false → 紅；改返 → 綠。 |
| **L-2** `command(req)` 最後先 spread body | Body 搬去最前，框架量到嗰啲擺後面。今日冇 body 進得到（五個 schema 都 `additionalProperties: false`），但呢條 route 寫緊銀行稽核記錄。 |
| **L-3** 兩個 browser suite 有 redaction 冇 `env_keys` | 揀咗**剝走嗰兩條 redaction**，唔係補 `env_keys`。今日冇 browser suite 起 Node app，補 `env_keys` 係一種「睇落已經 provision 咗」嘅假象 —— 而嗰個假象正正係 REV-039 指出嘅危害。T35 真係要嗰陣，佢會 fail closed 而唔係靜靜雞跑咗。 |
| **L-4** `expiresInSeconds` 偏離淨係喺報告 | 補咗 `DEV-T34-EXPIRES-IN` 落 ledger。 |

### 仲未覆蓋（記低，唔係靜靜雞漏低）

AC-025／AC-026 喺 HTTP 層冇測試。一個持有三個寫入權限之中兩個嘅呼叫者，會喺
`400 DEVICE_SIGNATURE_REQUIRED` 被 auth strategy 擋住，喺 authorization policy 行之前 ——
即係要測呢個，要一個 device-bound client，而嗰個係 T35 嘅事。今日呢兩條 AC 由兩層守住：
static metadata（`supplierBankHandlers.test.js` 宣告式釘住）同
`SupplierBankService.#assertMay`（喺 transaction 入面對住 DB 再 check 一次）。兩層都真，
但兩層都唔係 HTTP 層測試。

## 9. REV-040 remediation

REV-040（`agent-skills:security-auditor`，獨立，非作者）喺 `1de07da` 上報 CHANGES_REQUESTED：
1 High、2 Medium、5 Low。同時**逐條 mutation 殺過**，確認 REV-039 九條全部真係收咗，九比九。
佢攻擊 Bank HTTP 面嗰邊冇一樣爆：偽造 JWT claim 被 `403 PERMISSION_STALE` 擋（service 對住
DB 重讀 actor）、IDOR 回 404 唔漏嘢、step-up 五次鎖十五分鐘而鎖住期間啱密碼照樣
`PASSWORD_INVALID`、放鬆 route policy 兩次都被捉到而且 service 層仲係拒絕。

| # | 收法 |
| --- | --- |
| **H-1** 三條記錄講一個 ledger 入面冇嘅 PO 決定 | 決定係真嘅，喺對話入面做咗；**但 ledger 先係記錄，我個記憶唔係** —— 所以呢條成立。補咗 `HD-032`（取消 manifest 宣告）同 `HD-033`（cache 偏離），兩條都帶住當時擺喺你面前嘅代價。HD-017 係 HD-032 嘅同款先例，當年記得好好哋。 |
| **M-1** L-3 個修正建基於一個錯嘅前提 | **我做錯咗，已經 revert。** REV-039 話嗰兩個 browser suite「收唔到佢哋聲稱要遮罩嘅變數」，我照做剝走。但 `redact()`（`harness_runner.py:73-79`）係對住 **runner 自己個 `os.environ`** 解 key，同 `env_keys` 完全無關。我親手兩邊都試過：set 咗個變數之後，`redact(text,['SUPPLIER_BANK_ENCRYPTION_KEYS'])` 遮到，`redact(text,['DB_PASSWORD'])` 遮唔到。而且 `server/src/index.js` 經 dotenv 讀 `server/.env`，所以一個真係起 API 嘅 suite 點都攞到 key —— 正正就係 output 可能帶住 key 嗰個情況。剝走係淨蝕。Profile 還原，PLAN 返 `db5296`。 |
| **M-2** REV-039 冇入 `reviews` | REV-039 同 REV-040 都入咗，兩條都係 `CHANGES_REQUESTED` —— 佢哋本來就係。 |
| **L-1** cache 偏離淨係引 task 驗收條件 | 補引 design §6.6。 |
| **L-2** `supplierBankSchemas.js` 兩段註解仲講住 remediation 之前個故事 | 兩段都改咗，指返 ledger 嗰兩條記錄。 |
| **L-3** 報告引一個唔存在嘅 ledger id | 呢個 schema 嘅 observation 有 `subject` 冇 `id`。改成引 subject，並且講明點解。 |
| **L-4** `default_commit` 仲係 `ad21c1f` | 對齊到 `71616ec`。Boundary 輸出由 12 條別個模組嘅噪音，變返淨低一條預期之內嘅 `OUTSIDE_MODULE`。 |
| **L-5** `OUTSIDE_MODULE` 個代價講細咗 | **啱，而且係喺我更正緊「講細咗一個代價」嗰一頁上面。** 實際係：`validate_module_boundary` 由 `LOCAL_CHECKS_PASS` 變 `BLOCKED`；`check_boundary`（`harness_checks.py:118-124`）淨係為 match 到 `approval_required_paths` 嘅 path 查 approval，所以 approval 入面 `ci.yml` 嗰行由一條機器檢查得到嘅連結，變咗一句散文；而 `OUTSIDE_MODULE` 同一個未批嘅模組外寫入係同一個 code，即係由呢刻起每一條都要人手分。更正寫喺 `HD-032` 個 `answer_ref` 同 `APPROVAL-HD-030-SCOPE-REBIND-2`。REV-040 同我都仲係認為呢個 trade 啱 —— 一個活住嘅 DESIGN baseline 托住 28 條 review（包括把關 T33 merge 嗰條 REV-038），值過一條機器連結。 |

### 兩次被同一件事咬到

M-1 係我第二次**照單收下一個 reviewer 嘅推理，而冇去試佢建基嗰個機制**。第一次係 REV-039
H-1 嗰個 manifest 宣告 —— 我以為 design digest 唔包 manifest scope，冇查就寫落記錄。今次係
`redact()` —— 我以為佢對住 child env 解 key，冇查就剝走保護。兩次都係「我讀得明佢講乜」
當咗「我驗證過佢啱」。

## 10. REV-041 remediation

REV-041（`agent-skills:security-auditor`，獨立，非作者）喺 `80bbb95` 上報
CHANGES_REQUESTED：**0 Critical、0 High、1 Medium、4 Low** —— 第四輪，第一輪冇 High。

佢獨立驗過 REV-040 M-1 嗰個 revert，包括**我冇做嗰個 negative control**（一條列咗喺
`redaction_env_keys` 但喺 runner 環境度唔存在嘅 key，唔會產生任何遮罩），確認 profile 對
`64ef1fc` 嘅 diff 係空，三條引用嘅 observation subject 逐個 byte 對得上。六個 mutation
全部殺到，包括迫個遮罩投影漏帳號（response validation 喺過線之前用 500 拒咗 —— schemas
檔案嗰句「結構性防線」第一次真係喺漏嘅方向上量過）同埋食咗 reveal 嘅稽核失敗。十一個
reveal 邊界 HTTP probe 全部被拒。Server suite 1937，三條 pre-existing items 模組失敗，
冇 regression。CI `35583404210` 佢自己驗過。

| # | 收法 |
| --- | --- |
| **M-1** 我把 REV-039 記咗喺一個佢從來冇 review 過嘅 design hash 上 | **同佢收緊嗰條係同一類。** 為咗收 REV-040 M-2，我加 REV-039 入 `reviews` 嗰陣寫咗 `e4083319`（現行）。REV-039 review 嘅係 `64ef1fc`，嗰度 design 係 `77ab26aa` —— 即係 REV-039 自己 H-1 揾到嗰個 stranded hash。條記錄同佢自己個 `reviewer` 欄互相矛盾。REV-040 明明白白寫過 `77ab26aa` 同點解緊要，我靜靜雞換咗個值。親手喺 detached worktree 逐個 head 重算確認：`64ef1fc`→`77ab26aa`、`1de07da`→`e4083319`、`80bbb95`→`e4083319`。改返 `77ab26aa`。 |
| **L** 兩輪都冇 `PR_REVIEW` observation | REV-039／040／041 三條都補咗。`status: PASS` 意思係「review 真係做過、provenance 睇過」，唔係「批咗」—— 三條都冇批。 |
| **L** HD-032 話 `APPROVAL-HD-017-DESIGN` 係「本模組唯一一條 DESIGN approval」 | 有七條，佢係唯一一條綁住現行 baseline 嗰條。改咗，並且喺 `answer_ref` 講明原文寫過乜。順帶更正個 review 數：決定嗰陣係 **28** —— 而呢個先係應該記低嗰個數。（我第一次更正寫咗
「而家 29」，但 REV-041 自己條 review 喺同一個 commit 加咗落去，即刻變 30。REV-042 L-1 捉到。
一個每輪都會郁嘅數唔應該住喺一條決定記錄度。） |
| **L** `ci.yml` 個註解叫committed key 做「即場產生」 | 誤導。佢哋係**一次產生就 commit 咗**嘅字面值，住喺一個 public repo 入面，所以佢哋唔係 secret，亦都唔可以喺 CI 以外用。照咁寫返。 |
| **L** Schema 淨係 shallow freeze | `MASKED_BANK_SCHEMA.properties.accountNumber = {...}` 喺 runtime 做得到 —— 即係打穿咗上面講嗰道「結構性防線」。改成逐層凍，並且用一條**真係試加一個帳號欄位落遮罩 schema** 嘅測試釘住。驗證過佢分辨得到：拆走 deepFreeze 個遞迴 → 紅。順帶揾到一條就地 `params.required.sort()` 嘅舊測試 —— 佢本來就唔應該改一個共用 schema，凍咗之後先暴露出嚟。 |

### REV-041 講明佢冇查嘅嘢

HD-032／HD-033 背後嗰段對話；一個 runtime schema mutation 會唔會真係放寬一個 live
response（標咗 **PLAUSIBLE**）；RFC 9111 嗰個讀法；`SupplierBankCrypto` round-trip 以下
嘅原語；client 側；同埋 AC-025／AC-026 喺 HTTP 層 —— 最後嗰樣 §8 已經自己講咗未覆蓋。

## 11. REV-042 remediation

REV-042（`agent-skills:security-auditor`，獨立，非作者）喺 merge candidate `70344c5` 上報
CHANGES_REQUESTED：**0 Critical、0 High、1 Medium、4 Low**。五條全部真。

佢確認咗 REV-041 五條全部收得啱（design digest 喺每個 head 重算過，唔係讀），而且**行咗
REV-041 標咗 PLAUSIBLE 又冇行嗰一步** —— 把一個放寬咗嘅 response schema 真係推過一個 HTTP
response。結論見下面 L-4。

| # | 收法 |
| --- | --- |
| **M-1** 三條新 `PR_REVIEW` observation 裏面兩條綁一個從來未存在過嘅 triple | **同我喺同一個 commit 上面四行更正緊嗰條，係同一類。** 我喺 `code_commit` 寫咗被 review 嘅 head（`64ef1fc`／`1de07da`），但 `spec_baseline` 同 `source_fingerprint` 寫嘅係落筆嗰刻嘅值。`64ef1fc` 嗰陣 plan 係 `f701e9b0`、fingerprint 係 `acaa7efb`，所以呢個組合喺 repo 歷史上**任何一刻都唔成立**。之前五條 `PR_REVIEW` 全部係記「觀察嗰刻」嘅 commit，被 review 嗰個 head 擺喺 `subject` 同 `source_ref` —— 照返個 convention，兩條記錄各自寫明改過。REV-042 自己驗過呢個偏差喺任何 gate 上都唔使錢（`_observation` 要三個欄位一齊等於現行候選，而嗰兩個 commit 唔會再係現行），而且方向係令 gate **更嚴**唔係更鬆。 |
| **L-1** 更正完個 review 數又係錯 | 寫咗「而家 29」，但 REV-041 自己條 review 喺同一個 commit 加咗，即刻係 30。依家淨係記 **28** —— 你做決定嗰陣嗰個數 —— 並且寫明個 live count 每輪都郁，唔喺度追。 |
| **L-2** 我就地改咗 `HD-032` 個 `question` | 呢個模組嘅做法係 **supersede，唔 rewrite**（34 條被取代嘅 approval 全部原文留住）。`question` 係「當時擺咗乜喺你面前」嘅記錄，改佢就係削弱 `answer_ref` 唯一嘅憑據。原文還原，兩個更正全部放返 `answer_ref`。 |
| **L-3** `deepFreeze` 仲有一個節點凍唔到，而且就係跨 Supplier 披露嗰個 | 舊個守衛係 `!Object.isFrozen(value)`，撞正檔案裏面唯一一個**事先 `Object.freeze` 咗**嘅 `properties` 就短路，下面個 `MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings` 永遠掃唔到 —— 即係嗰個「**唔可以**回對方帳號」嘅 warning 元素。守衛改成 `WeakSet`（擋循環，但唔會遮住已凍節點下面未凍嘅仔），多餘嗰個內層 freeze 刪走。測試亦都唔再逐個節點點名，改成**行勻每個 export 每一層**。驗證過佢分辨得到：把舊守衛同內層 freeze 一齊放返，測試紅，而且直接叫出 `MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings`。舊測試喺個窿開住嘅時候係綠嘅，所以佢先走得甩。 |
| **L-4** 個 freeze 守住嘅範圍，比我個註解同 ledger 講嘅窄 | REV-042 量咗：`ResponseValidator.compile` 喺 route 註冊嗰陣 `ajv.compile(schema)` 一次（`apiDispatcher.js:296-299`），所以**註冊之後**改個 schema 完全冇作用；**註冊之前**改就真係漏得到落線上（佢喺真 HTTP 上量過）。即係個 freeze 守住嘅係 module load 到 `createApplication` 之間，唔係「runtime」。註解同 ledger 兩邊都照咁寫返。 |

### 第五輪，第五次

五輪入面每一輪都揾到**上一輪 remediation 自己整出嚟**嘅嘢。今次係 M-1：我一邊喺
`reviews` 度更正一個被錯置嘅 baseline，一邊喺隔籬 `observations` 度用另一個形式再犯一次，
同一個 commit，同兩條 review。走勢係 2H/3M/4L → 1H/2M/5L → 0H/1M/4L → 0H/1M/4L，
High 已經清咗兩輪，但係「記錄嘅形狀」呢一類仲未收斂。
