# TASK-035 — Bank UI

**Task:** TASK-035 (T35) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Traceability:** FR-VIEW-002、FR-BANK-001、FR-BANK-002、FR-BANK-003、FR-BANK-006、FR-BANK-007、AC-023～AC-026
**Files:** `client/src/services/supplierBank.js`、`client/src/components/suppliers/SupplierBankPanel.vue`、
`client/src/pages/suppliers/SupplierDetailPage.vue`、`client/test/services/supplierBank.test.js`、
`client/test/pages/suppliers/bank.test.js`、`client/e2e/supplier-management/supplier-bank.spec.js`

## 1. 明文住喺邊，同點樣消失

帳號明文淨係住喺 `SupplierBankPanel` 兩個 local ref：`revealed.accountNumber`（睇）同
`form.accountNumber`（寫）。**唔入** Pinia、唔入 localStorage／sessionStorage、唔入 URL、
唔入 toast、唔入驗證訊息。

清除有兩層，**唔係**之前寫嗰句「五個觸發點全部行同一個 `forgetPlaintext()`」——
嗰句講得闊過實情（REV-045 F-M1）：

- `forgetPlaintext()` —— 收起已展開嗰個帳號。手動收起、倒數到、以及下面嗰個。
- `forgetEverything()` —— 連埋**寫入 form** 入面打咗一半嘅帳號同密碼，同埋閂晒三個
  dialog。unmount、route change（兩個 guard）、session 失效行呢個。

點解要分：一個開住嘅新增／編輯 dialog 入面，`form.accountNumber` 一樣係使用者打落去
嘅明文。之前 route change 同 session 失效兩個都淨係行 `forgetPlaintext()`，即係個
dialog 會繼續開住、繼續 render 喺新嗰個 URL 底下。

展開用 `v-if` **唔係** `v-show`。呢個唔係風格問題：`v-show` 會留低一個
`display: none` 嘅節點，即係明文仲喺頁面度，devtools、screen reader、`innerHTML`
全部攞得返。瀏覽器測試特登驗咗呢件事（見 §4）。

## 2. 30 秒係客戶端嘅數，而且係有意咁

伺服器 reveal 回 `{ id, accountNumber, revealedAt }`，**冇** `expiresInSeconds` ——
嗰個就係 T34 記低嘅偏離 `DEV-T34-EXPIRES-IN`：伺服器冇任何 server-side 狀態同一個
到期時間對應，所以佢俾個數字出嚟就係講緊一件冇發生過嘅事。幾時清係呢一層嘅責任，
而個 `REVEAL_SECONDS = 30` 就喺 panel 度。兩份記錄對得上，唔使人再推一次。

## 3. 一個順手揾到嘅假嘢

`SupplierDetailPage` 個銀行 tab 之前寫住 `銀行資料 (${supplier.bankAccounts.length})`，
而 `toSupplierDetailResponse` 個 `bankAccounts` 有一個 default `[]` **而冇任何 caller
傳嘢俾佢**。即係嗰個 "(0)" 由頭到尾都係假嘅，永遠係 0。

順帶令 `detail.test.js` 一條斷言一直喺度靠一個伺服器永遠唔會填嘅欄位過關 —— 佢喺 mock
payload 度自己塞咗一行 bank 落去。已經改成由 `supplierBankService.list` 攞，同真嘢一致。
Tab 唔再顯示數字（真數量喺 panel 自己嗰個請求度）。

## 4. 瀏覽器驗證（T35 驗收嗰句 Manual browser check）

`client/e2e/supplier-management/supplier-bank.spec.js`，3 條全綠，真 Chromium、真時鐘。
jsdom 證唔到呢啲：佢喺 `about:blank` 係 opaque origin 冇真 storage、冇真 URL bar、
冇真 response header，亦都冇一個真嘅 30 秒。

| 驗咗乜 | 點驗 |
| --- | --- |
| 初次 render 唔攞明文 | 記低所有 API call，斷言冇一個 `/reveal` |
| Network cache | 由真 `Response` 讀 `cache-control: no-store`、`pragma: no-cache` |
| URL | `page.url()` 唔含帳號 |
| Storage | 真 `localStorage` ／ `sessionStorage` 全部 entry |
| 倒數真係行緊 | 斷言個數字**跌緊**，唔係淨係斷言佢喺度 —— 一個凍結咗喺 30 嘅倒數一樣會令「睇得到倒數」過關，但佢代表 timer 冇行，即係亦都唔會清 |
| 30 秒清除 | 等真 30 秒，然後斷言 `page.content()` 搵唔返帳號 |
| 離開頁面 | 撳側欄真連結（唔係 `page.goto` —— 嗰個係 full reload，會清晒所有嘢，證明唔到咩） |

### Mutation：兩個都試過

- `v-if` → `v-show`（明文隱藏但留喺 DOM）：**紅**。個測試真係分得開「睇唔到」同「冇咗」。
- `onBeforeRouteLeave` 拆走：**綠** —— 見下面。

## 5. 一個我殺唔到嘅 mutant —— 而佢根本唔係 mutant，係一個真漏洞

**呢一節之前寫錯咗，而且錯得幾緊要。**

原本寫住：拆走 `onBeforeRouteLeave` 之後全部測試照綠，所以佢係一個 equivalent mutant；
佢守嘅係 Vue Router 重用 instance 嗰條（`/suppliers/7` → `/suppliers/8`）；我寫唔出一個
殺得到佢嘅測試。

**錯。** Vue Router 喺淨係換 param、重用同一個 instance 嗰陣行嘅係
**`onBeforeRouteUpdate`**，唔係 `onBeforeRouteLeave`。即係話我留低嗰個 guard，喺我親手
寫落註解嗰個場景入面**根本唔會行**。個漏洞係開住嘅：7 號供應商嘅帳號明文會留喺一個
URL 已經寫住 8 號嘅畫面上面。

REV-044 用十一行 `router.push("/suppliers/8")` 重現咗。我自己再驗一次先改：喺呢個 head
上面紅，加一行 `onBeforeRouteUpdate` 之後綠。

我個 `history.pushState` 探針**的確**唔驅動 Vue Router —— 嗰個診斷係啱嘅。錯嘅係我由
「呢個探針證唔到」跳去「冇嘢證得到」，然後把一個未驗證嘅機制寫成註解同報告裏面一句
肯定句。同一個模組入面，呢個係我第三次犯：頭兩次係 design digest 包唔包 manifest
`scope`、同 `redact()` 對住邊個 environment 解 key。

修法：兩個 guard 一齊要。`onBeforeRouteLeave` 留返（佢守去另一個 record 嗰條路，今日
冗餘，但冗餘同錯係兩件事），加 `onBeforeRouteUpdate`。測試搬咗入 `bank.test.js`，
route 定義用 `/suppliers/:id` —— 一個冇 param 嘅 `"/"` route 係測唔到重用嗰條路嘅。

## 6. 順手揾到、**冇**喺度改嘅嘢

`SupplierDetailPage` 只喺 `onMounted` load，冇 watch `route.params.id`。即係同一個
重用路徑之下，換咗 id 啲資料根本唔會重載 —— 7 號嘅資料會留喺一個寫住 8 號嘅 URL
下面。同上面個 guard 係同一個成因，但佢係 detail page 自己嘅問題，唔喺 T35 scope 入面，
所以淨係記低，冇喺呢度改。

## 7. Developer self-test

| Suite | 結果 | Evidence |
| --- | --- | --- |
| `supplier-phase-001-client` | **PASS** 87/87（呢個 suite 係 supplier 子集，唔係成個 client） | 最新一次喺 REV-044 remediation 之後重跑 |
| `supplier-phase-001-server` | **PASS** 395/395 | `evidence/20260922T024327-d465987adeb0/run.json` |
| `lint` | **PASS** | `evidence/20260922T024331-3bf826929656/run.json` |
| `client-build` | **PASS** | `evidence/20260922T024334-c4ad32cc1a1a/run.json` |
| 成個 client vitest | **PASS** 585/585 | 本機，唔係 profile suite |
| Playwright `supplier-bank.spec.js` | **PASS** 3/3 | §4 |

另外四個 DEVELOPER-stage suite 記錄咗 **BLOCKED**，而且**照樣註冊咗**落 ledger ——
唔登記佢哋會令成套 evidence 睇落似係揀過。四個都唔係 T35 失敗：佢哋每個
`required_case_ids` 覆蓋成個模組嘅正式案例目錄（UI-001～007、TC-001 起、TC-062 起、
TC-111 起），全部仍然 NOT RUN，因為嗰啲係 TECHNICAL／REGRESSION stage、屬於 T37 之後。
`supplier-client-ui` 仲指住一個 repo 入面唔存在嘅
`client/test/supplier-management.vitest.config.js` —— 一個由 profile 寫落去就冇 run 過嘅
entry。呢個係既有缺口，T34 亦都係同一個原因淨係註冊嗰四個。**冇喺度修**：改 profile 會
再推 PLAN baseline，而為咗令一個唔屬呢個 stage 嘅 suite 跑到而去推 baseline，唔係
呢個 task 嘅事。

## 8. REV-044 remediation

REV-044（`agent-skills:security-auditor`，獨立，非作者）報 CHANGES_REQUESTED：
0 Critical、1 High、2 Medium、2 Low、2 Info。六條全部真。

| # | 收法 |
| --- | --- |
| **H-1** `onBeforeRouteLeave` 唔會喺 param-only change 行 | 見 §5。加 `onBeforeRouteUpdate`，測試搬入 `bank.test.js` 並且用 `/suppliers/:id` route。 |
| **M-1** reveal 喺 unmount 之後 resolve 會重新揸住明文兼開多個 interval | 加一個 `gone` flag，`holdPlaintext` 見到就唔做。 |
| **M-2** 三條清除斷言係 DOM 形狀，mutation 之下照綠 | 三條全部改成盯住**機制**：unmount 嗰條 spy `clearInterval`；late-reveal 嗰條 spy `setInterval`（數總 timer 數係捉唔到嘅 —— unmount 會清埋 Quasar 自己嗰堆，個數點都會跌）；`forgetFormSecrets` 嗰條搬咗去 **warning 路徑**，因為成功路徑個 dialog 會閂而 `@hide` 本身就會清欄位。 |
| **M-3** 每行嘅 edit／set-default／deactivate 掣冇任何權限斷言 | 加咗：`bank.view` 之下三個都要唔存在，`bank.mgmt` 之下三個都要存在。 |
| **L-1** 30 秒係 30 個 tick，唔係 30 秒 | 改成對住時鐘計 deadline。背景 tab 嘅 `setInterval` 會被節流到幾秒一次，數 tick 可以變成真實世界幾分鐘。測試用 `vi.setSystemTime` 跳 60 秒但只行一個 tick 去模擬節流。 |
| **L-2** ledger 講咗個靚啲但唔啱嘅理由 | 見下。 |

### Mutation：七個，六個殺到

```
H-1 drop onBeforeRouteUpdate     KILLED
M-1 drop the unmount flag        KILLED
M-2a drop onUnmounted clear      KILLED
M-2b drop forgetFormSecrets      KILLED
M-3 widen row controls           KILLED
L-1 count ticks not the clock    KILLED
v-if -> v-show                   （jsdom 編譯唔到，由瀏覽器測試殺 —— 見 §4）
```

第一次改完之後我再跑一次呢七個，**四個仲係生還**。當時我以為「加咗斷言」就等於
「斷言得到」，而嗰四條新斷言全部都係喺度睇 DOM 或者數 timer 總數 —— 兩樣都會因為
unmount／閂 dialog 而自動成立。改成 spy 住真正嗰個 call 之後先至殺得到。

### L-2：我個理由靚過事實

我原本寫四個 BLOCKED suite 純粹係 stage 唔夾（佢哋要嘅係 T37 之後先跑嘅正式案例）。
**呢個係真，但唔係佢哋第一樣衰嘅嘢。** 讀 stderr 唔讀 summary 就見到：

```
Could not find 'server/test/supplier-management'
Could not find 'server/test/supplier-management/bank'
Could not find 'server/test/supplier-management/security'
```

加埋 `supplier-client-ui` 指住嘅 `client/test/supplier-management.vitest.config.js`，
四條路徑一條都唔存在。即係 profile 宣告咗一整棵從來未起過嘅 technical／regression
測試樹，佢哋唔係「stage 唔夾」，係**根本跑唔到**。呢個缺口而家照實記咗落 ledger。

## 9. REV-045 remediation

REV-045 報 CHANGES_REQUESTED：0 Critical、1 High、1 Medium、1 Low、3 Info。三條全部真。
佢亦都逐個重跑咗我 §8 嗰張 mutation 表（唔係讀），確認七個都準。

### F-H1 —— 兩個 fix 各自啱，夾埋唔掂

`gone` flag 淨係喺 `onUnmounted` set。`onBeforeRouteUpdate` 同 session watch 都會清明文，
但**唔會** set 佢。所以一個仲喺路上嘅 `reveal`，喺換咗 param 之後 resolve，會把 7 號嘅
帳號**畫返出嚟**喺 8 號嘅畫面度，仲附送一個新嘅 30 秒倒數。

我改之前自己重現咗：

```
before late resolve: false   ← guard 做咗嘢
AFTER late resolve : true    ← 然後俾個遲到嘅 response 推翻
```

呢個就係 REV-044 唔肯 merge 嗰個漏洞，由另一道門入返嚟 —— **第五次**一個 remediation
自己開出下一個 finding。

修法用 REV-045 建議嗰個形狀，唔係逐個 guard 補 flag：所有清除觸發點本來就已經全部經過
`forgetPlaintext()`，所以喺嗰度撳大一個 `revealGeneration`，而 `confirmReveal` 攞住出發
嗰陣個號碼、返嚟之後對返。咁樣收嘅係成類問題 —— 將來加多個觸發點，唔使記得去 set 多個
flag。

### F-M1 / F-L1

- **F-M1**：§1 之前寫住五個觸發點全部覆蓋 `form.accountNumber`。**唔係。** 見 §1 改咗嘅
  版本，同上面個 `forgetEverything()`。又一次係「把一個機制寫得闊過實情」。
- **F-L1**：個 deadline 用咗 `Date.now()`，而 REV-044 本來就講明要 `performance.now()`
  同埋點解。系統時鐘向後跳一個鐘（NTP、使用者改時間、VM snapshot），`deadline - now`
  會變返一個大正數 —— 明文攞足一個鐘，介面顯示「3629 秒後自動隱藏」。改成單調時鐘，
  並且 `Math.min(left, REVEAL_SECONDS)` 封住個顯示值。

### Mutation：九個，九個殺到

```
F-H1  drop the generation check        KILLED
F-H1b generation never bumped          KILLED
F-M1  route update clears reveal only  KILLED
F-M1b session watch clears reveal only KILLED
F-L1  use the system clock             KILLED
H-1   drop onBeforeRouteUpdate         KILLED
M-2a  drop onUnmounted clear           KILLED
M-2b  drop forgetFormSecrets           KILLED
M-3   widen row controls               KILLED
```

兩條新時鐘測試要分開寫，因為 `vi.advanceTimersByTime` 會**同時**推單調時鐘同系統時鐘，
而 `vi.setSystemTime` 只推系統時鐘（實測：advance 5000 → perf +5000／date +5000；
setSystemTime +60000 → perf +0／date +60000）。所以節流嗰條要搬 `performance.now`
再放一個 tick，倒退時鐘嗰條要 `setSystemTime` 向後跳。

588/588 client vitest、3/3 瀏覽器、lint 乾淨。

## 10. REV-046 remediation

REV-046 報 CHANGES_REQUESTED：**0 Critical、0 High**、1 Medium、3 Low、7 Info。

**條連勝喺最緊要嗰條軸上面斷咗。** 跨 Supplier 明文外洩，喺佢去得到嘅每一條路上面
都關咗。佢由六個方向攻擊個新 generation counter，亦都行過我冇諗過去查嗰四條 async
路徑（`create`／`update`／`setDefault`／`deactivate`／`load`）—— 冇一條會把資料落錯
Supplier。我上一輪九個 mutation 佢逐個重現，全部喺我聲稱嗰條斷言度死。

### Medium：靜靜雞丟棄一個伺服器已經稽核咗嘅 reveal

呢一輪**仲係**整出咗一個新缺陷（第六次），但今次佢係 **fail closed**。

`forgetPlaintext()` 撳大 generation，而**倒數 tick 都會叫佢**。所以另一行嘅 30 秒啱啱
喺另一個 reveal 嘅來回中間到期，就會令一次完全正常嘅 reveal 落到「丟棄」嗰條路：冇
明文、**冇錯誤訊息**、dialog 開住。而伺服器嗰邊已經解咗密、已經寫咗一條
`supplier.bank.reveal` 稽核。

即係個稽核紀錄會對應住一次**根本冇出現過喺螢幕上**嘅披露 —— 而嗰條稽核正正係呢個功能
嘅設計所倚靠嘅嘢（FR-BANK-006）。修法：唔再 bare `return`，改為講返俾使用者知，並且
明講「呢次查看已經記錄咗稽核」。

### 三條 Low，三條都係「個測試睇唔到嘅嘢」

| # | 收法 |
| --- | --- |
| **X5** 第三個 dialog（設為預設／停用）嘅密碼**一個斷言都冇** —— 由 `forgetEverything()` 剝走嗰兩行，19 條全綠，而打咗一半嘅密碼會跨 Supplier 同跨 session 留低 | 加咗兩邊都試嘅測試 |
| **X11 / X7** `?? Date.now()` 個 fallback 嘅內容，就係啱啱先俾人拒絕咗**兩次**嗰個行為；而個 `Math.min` clamp 冇測試，佢唯一嘅作用係喺倒數卡住嗰陣用一個安詳嘅「30 秒」遮住佢 | Fallback 剝走（`performance.now` 由 IE10 起都有；真係冇就寧願即刻爆 —— 爆咗睇得見，靜靜雞退化做壞版本睇唔見）。Clamp 剝走 |
| **X12** 清一個**唔相干**嘅 handle，19 條照樣全綠 —— 即係我個 `clearInterval` spy 根本冇盯住佢聲稱盯住嗰個 handle | 改成喺 arm 嗰陣記低真個 handle，再斷言 `clearInterval` 收過**佢** |

### Mutation：十二個，十二個殺到

```
REV-046 M  silent discard            KILLED      F-M1  route update: reveal only  KILLED
REV-046 X5 confirm secrets kept      KILLED      F-M1b session watch: reveal only KILLED
REV-046 X11 system-clock fallback    KILLED      H-1   drop onBeforeRouteUpdate   KILLED
REV-046 X12 clear a bogus handle     KILLED      M-2a  drop onUnmounted clear     KILLED
F-H1  drop the generation check      KILLED      M-2b  drop forgetFormSecrets     KILLED
F-H1b generation never bumped        KILLED      M-3   widen row controls         KILLED
```

`v-if` → `v-show` 喺 jsdom 編譯唔到，要靠瀏覽器殺。REV-046 老實講咗佢今輪因為自己個
環境爛咗（mutation hot-reload 入咗 live Vite server、兩個 run 爭同一個 outputDir）
驗唔到呢個，所以**我自己行返一次**：改成 `v-show` → 紅；還原 → 綠（32.4s）。

### main 郁咗

`origin/main` 去咗 `bd8cc21`（PR #126，item-management UAT closeout）。CLAUDE.md §6
要求 merge 之前 fetch target、郁咗就先 merge 返入嚟。已經做咗 —— 檔案集合完全唔相交
（嗰邊全部 `docs/items_management/**`），冇衝突。`baseline.default_commit` 一併更新。

590/590 client vitest、3/3 瀏覽器、lint 乾淨。
