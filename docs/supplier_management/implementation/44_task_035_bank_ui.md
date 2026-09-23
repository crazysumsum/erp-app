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
| `supplier-phase-001-client` | **PASS**（呢個 suite 係 supplier 子集，唔係成個 client） | 最新一次見 §11 |
| `supplier-phase-001-server` | **PASS** 395/395 | 見 §11 |
| `lint` | **PASS** | 見 §11 |
| `client-build` | **PASS** | 見 §11 |
| 成個 client vitest | **PASS** | 本機，唔係 profile suite；最新數字見 §11 |
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

最新數字見 §11。

## 11. REV-047 remediation，同一個我自己整出嚟嘅覆蓋率黑洞

REV-047 報 CHANGES_REQUESTED：0 Critical、1 High、2 Medium、3 Low、7 Info。

### F-H1 —— 我 merge 嗰陣加嘅 watcher，喺程式入面由頭到尾冇行過，仲遮住咗三個 mutant

Merge `main` 之後我加咗 `watch(() => props.supplierId, ...)`，理由係 `bank.test.js` 度到
`list()` 叫咗 7 就冇再叫 8。**嗰個度量係啱嘅，但佢度嘅係測試宿主，唔係個程式。**

真嘅 `SupplierDetailPage` 個 `load()` 一開頭就 `loading.value = true`，而 template 係
`v-if="loading"` ／ `v-else-if="supplier"` —— 即係成個子樹（連個 panel）會拆走再起過。
我自己行真頁面度過：**panel instance uid 48 → 77**（重新 mount 咗），而 `list()` 叫咗
**7 同 8**。拆走個 watcher，真頁面照樣叫 `list(8)`，照樣冇顯示過 7 號嘅行。

而個 watcher 喺測試宿主入面**會**行（嗰個宿主綁 `$route.params.id` 落 prop 並且保住
同一個 instance），一行就搶先清晒嘢。後果：

```
H-1 drop onBeforeRouteUpdate    SURVIVED   595 passed (595)
F-M1 route update: reveal only  SURVIVED   595 passed (595)
```

**`onBeforeRouteUpdate` 可以整條刪走，595 條全綠。** 嗰個就係 REV-044 揾到漏咗、
再用咗兩輪先至整啱嘅 guard —— 佢嘅覆蓋率俾我一行「修正」遮走咗。§10 嗰句「十二個
mutant，十二個殺到」喺 `551e249` 係真嘅，喺呢個 merge candidate 就唔係。

（REV-047 話 `M-2b` 都生還；我當時實測 KILLED 就照記低咗「唔跟」。**我錯，佢啱** ——
見 §12。我度嘅係另一個 mutant：我掏空咗 `forgetFormSecrets` 個 function body，佢拆嘅係
`forgetEverything()` 入面嗰個 **call**。兩個唔同，而佢嗰個生還。）

收法：
- **刪走個 watcher。** 佢唔係安全控制，而佢唔存在喺程式度呢點係實測過嘅。
- **刪走綁住個宿主嗰條測試**，換成一條**行真 `SupplierDetailPage`** 嘅測試，斷言換咗
  id 之後個銀行 tab 顯示新 Supplier 嘅遮罩清單。度個程式，唔度個宿主。
- `bank.test.js` 個宿主**特登同真程式唔同**呢一點，寫咗落個註解度：保住 instance 係
  為咗令 `onBeforeRouteUpdate` 有嘢測（今日佢係縱深防禦，因為 unmount 已經清咗），
  而嗰個分別正正就係呢次出事嘅地方。

### 其餘

| # | 收法 |
| --- | --- |
| **F-M1** watcher 個 `load()` 冇 supersede guard | 隨住 watcher 一齊刪走 |
| **F-M2** `/suppliers/<非數字>` 永遠留喺 loading skeleton（`NaN !== NaN` 令 `superseded()` 永遠 true） | **唔喺呢個 PR 修** —— 佢已經喺 `main`（PR #127 帶入），REV-047 自己都話唔應該擋住呢個 PR。開咗一個 task |
| **F-L1** reveal 嘅重入 guard 冇嘢斷言 | 加咗測試。**注意**：兩下撳要喺同一個 tick 發 —— 中間 `await` 一次 Vue 就會 re-render，個掣 `:loading` 之後 Quasar 攔住第二下，個測試就分辨唔到。第一次寫錯咗，mutant 生還，改成同 tick 之後先殺到 |
| **F-L2** `submitConfirm` `finally` 入面個 `confirm.password = ""` 冇嘢斷言（錯誤路徑個 dialog 係開住嘅） | 加咗測試 |
| **F-L3** ledger 最新嘅 evidence 比 remediation 同 merge 都舊；§7 數字過時 | §7 唔再寫死數字，evidence 喺最終 head 重跑 |

### Mutation：十三個，十三個殺到

```
REV-046 M  silent discard       KILLED    F-M1b session watch: reveal only  KILLED
REV-046 X5 confirm secrets      KILLED    H-1   drop onBeforeRouteUpdate    KILLED  ← 之前生還
REV-046 X11 system-clock        KILLED    M-2a  drop onUnmounted clear      KILLED
REV-046 X12 bogus handle        KILLED    M-2b  drop forgetFormSecrets      KILLED
F-H1  drop generation check     KILLED    M-3   widen row controls          KILLED
F-H1b generation never bumped   KILLED    NEW   page stops reloading on id  KILLED
F-M1  route update: reveal only KILLED  ← 之前生還
```

加埋 `Y6`（reveal 重入 guard）同 `Y7`（confirm password）兩個新嘅，兩個都殺到。

### 驗證

**597/597** client vitest、**23/23** 瀏覽器（成個 `technical` project，包括 merge 帶入
嗰條 `supplier-detail-route-reuse.spec.js` —— 兩條 spec 唔會互相干擾）、lint 乾淨。

### 一句總結呢次出錯嘅形狀

我度量咗一件真嘢（`list()` 冇叫過 8），但係喺一個同程式唔同嘅宿主入面度。個修正因此
修緊一個唔存在嘅問題，而副作用係遮走咗一個真守衛嘅覆蓋率。**下次喺加修正之前，
先喺真嘅組合度重現一次。**

## 12. REV-048 remediation

REV-048 報 CHANGES_REQUESTED：**0 Critical、0 High**、1 Medium、2 Low、5 Info，並且確認
REV-047 個 High 真係收咗（佢重跑咗成張 mutation 表：`H-1` 而家紅 4 條、`F-M1` 紅 2 條，
上一輪兩個都係 595/595 生還）。**八輪以嚟第一輪，remediation 冇整出下一個 finding。**

### 兩件佢判我錯，而我覆核之後確認佢啱

**一、`M-2b` 生還，而我 §11 記咗「十三個殺到」。** 我當時度嘅係**另一個 mutant** ——
我掏空 `forgetFormSecrets` 個 body，佢拆嘅係 `forgetEverything()` 入面嗰個 **call**。
我自己重做佢個版本：**597/597 全綠**。所以係**十二個殺到，唔係十三個**。

再查落去：嗰兩個祕密有**三個**清除機制（呢個 call、dialog 個 `@hide`、同
`openCreate()` 重設），而我當時叫佢哋「互相冗餘」，結論係「**性質**釘住咗，
**機制**冇」。

> **再更正（REV-050 F-L2）。** 「互相冗餘」本身都係錯 —— 而且錯嘅方向令我低估咗
> 自己個 code。實測：單獨拆嗰個 **call** → **紅**；單獨拆 `@hide` → **綠**。
> 原因係 `@hide` 要等 Quasar 個 leave transition 行完先觸發（約 400ms），而
> `forgetEverything()` 一設 `open = false` 就返咗 —— 中間嗰段時間，兩個祕密仲喺
> component state 度。所以 route change 同 session 失效嗰陣，**個 call 係唯一一個
> 同步清除**，唔係三個之一。`openCreate()` 只覆蓋「下次再開」，唔係呢條路上面嘅防線。
>
> 同一句「兩個機制覆蓋呢條路」我喺三份文件度寫過。全部更正咗。

> **更正（REV-049）。** 嗰個結論係一個**合理化**。REV-049 用六行就寫到嗰個機制層
> 嘅斷言 —— 直接讀 component state（`wrapper.findComponent(...).vm.form`）。我之前
> 以為 `<script setup>` 攞唔到，冇試過。
>
> 而且我嗰個「三個一齊拆就紅」嘅論證本身都係錯嘅：佢紅，係因為我順手改咗
> `openCreate()` 令佢唔再重設 —— 即係我釘住咗**錯嗰個機制**。真正覆蓋呢條路嘅只有
> 兩個（call 同 `@hide`），而**淨係拆嗰兩個，634 條照綠**。
>
> 仲有，我當時寫落測試註解嘅「`openCreate()` 唔會清」係**假**嘅 —— 佢
> `Object.assign` 入面就有 `accountNumber: ""` 同 `password: ""`，而同一個 commit
> 入面另外三處（commit message、§12、panel 自己個註解）都同佢矛盾。

**二、`bank.test.js` 個註解講反咗。** 我寫咗個 `onBeforeRouteUpdate` 係「縱深防禦
（unmount 已經清咗）」、守住「有一日個 panel 真係被重用」。**兩句都錯。**

我 instrument 咗個 guard 再行真頁面：**`PANEL onBeforeRouteUpdate fired: 1 times`**。
佢喺 production 跑緊，而且喺**路由確認之前**跑 —— 即係喺 `route.params.id` 變之前、
喺 page 拆走個子樹之前。清明文嗰個係佢，unmount 先係冗餘嗰層。REV-048 量到嘅次序係
`guardUpdate:SupplierDetailPage → guardUpdate:SupplierBankPanel → list:8`。

呢個係我喺呢個 task 入面**第四次**把一句未執行過嘅機制陳述寫成肯定句。註解已經改返，
連埋量到嘅次序，等下一個人唔使再推一次。

### Medium：target 郁咗 24 個 commit，而且入面有一個新 CI gate

`origin/main` 由 merge base 起郁咗 **24 個 commit**，從來冇 merge 入嚟，而
`baseline.default_commit` 指住一個呢條分支根本冇嘅 commit。入面有兩樣直接打中呢條分支：

- 一個新 CI job **`Browser tests (Playwright)`**，令**本 task 自己條 `supplier-bank.spec.js`
  變成 per-PR blocking gate**。呢個 head 之前嗰個「四個 check 全綠」，係對住一個而家要
  五個 check 嘅 target 講嘅。
- `playwright.config.js` 由寫死 `/private/tmp` 改成 `os.tmpdir()` —— 而嗰個 fix 存在
  嘅原因就係前者喺 Linux 上面 EACCES。即係冇呢個 merge，新嗰個 job 喺 CI 上面會炸。

已經 merge：**乾淨、冇衝突**。`634/634` unit、`23/23` 瀏覽器（用 CI 自己嗰條
`npm run e2e:supplier-management`）、lint 乾淨。

### 兩條問咗三次先做嘅嘢

| # | |
| --- | --- |
| **I-1** | `let revealGeneration = 0;` 本來宣告喺 `forgetPlaintext()` **之後**，而後者讀寫佢。今日安全，但一個 `{ immediate: true }` 就會令一個安全控制喺 mount 掟 TDZ `ReferenceError`。移咗上去 |
| **I-2** | 註解寫住 `advanceTimersToNextTimer()`，而 code 係 `vi.advanceTimersByTime(1000)`。改返 |

REV-046 同 REV-047 都問過，而我兩次都靜靜雞跳過咗 —— 連「唔做，因為……」都冇寫。
REV-048 講得啱：**silently skipped twice is how a note becomes permanent。**

## 13. REV-049 remediation

REV-049 報 CHANGES_REQUESTED：**0 Critical、0 High**、1 Medium、3 Low、6 Info，並且確認
REV-048 四項全部做咗（佢自己拉咗個 browser job 嘅 log 落嚟，見到佢喺 `ubuntu-latest`
上面逐條點名跑咗本 task 三條 `supplier-bank.spec.js` 測試，`23 passed (59.8s)` ——
REV-048 對 Linux 嘅疑問用證據收咗）。

### Medium：我上一輪嗰個「性質釘住咗，機制冇」係合理化

三件事一次過：

1. **我做唔到嘅嘢，佢六行就做到。** 直接讀 component state
   （`wrapper.findComponent(SupplierBankPanel).vm.form.accountNumber`）。我之前假設
   `<script setup>` 攞唔到內部 state —— **冇試過**。
2. **我個論證本身錯。** 我話「三個一齊拆就紅」證明個性質有釘住。佢紅係因為我順手令
   `openCreate()` 唔再重設 —— 即係我釘住咗**錯嗰個機制**。真正覆蓋呢條路嘅只有兩個
   （`forgetEverything` 入面個 call 同 dialog 個 `@hide`），而**淨係拆嗰兩個，634 條
   照綠**。
3. **我寫落註解嗰句「`openCreate()` 唔會清」係假嘅**，而且同一個 commit 入面另外三處
   都同佢矛盾。

修法：三個祕密（`form` 兩個、`revealDialog.password`、`confirm.password`）全部改成
斷言 component state。

### 兩條九輪以嚟冇人提過嘅

| # | |
| --- | --- |
| **Z16／Z17** | 兩個 step-up dialog 各自嗰個密碼有同一個窿：拆走 `@hide` 同 `forgetEverything()` 嗰行，634 條照綠，而密碼喺 **session 失效之後仍然留喺 component state**（嗰陣個 panel 冇 unmount，所以 state 係唯一睇得出分別嘅地方）。REV-046 個 `X5` 淨係捉到「兩句一齊拆」嗰個變體 |
| **`holdPlaintext` 第一句** | 展開第二行從來冇測過。拆走佢，第一行個 interval 變孤兒。**我第一次寫嘅斷言（睇 `revealed.remaining`）捉唔到** —— 兩個 interval 各自由自己個 deadline 計，同一個 tick 內後寫嗰個贏，所以個數字可以完全正常而孤兒照樣存在。改成 spy 住 `clearInterval` 先至殺到 |

### Mutation

```
M   form secrets: call + @hide      KILLED
Z16 reveal password: both           KILLED
Z17 confirm password: both          KILLED
Z   holdPlaintext leading forget    KILLED（第一次嘅寫法生還，見上）
```

### 驗證

**636/636** client vitest、**23/23** 瀏覽器（CI 自己嗰條 script）、lint 乾淨。

（順帶：我今次又用咗 `cmd | tail; echo $?` 去睇 lint 結果 —— 嗰個 `$?` 係 `tail` 嘅，
唔係 lint 嘅，所以我一度報咗「lint 乾淨」而其實有一個 `no-unused-vars` error。
同一個 shell 陷阱我喺呢個 session 入面踩過兩次。已經修咗，而且今次係直接睇輸出。）

## 14. REV-050 — APPROVED

REV-050 判 **APPROVED**：0 Critical、0 High、0 Medium、4 Low、5 Info。**T35 第一條
APPROVED**，亦都係佢講嘅「四輪以嚟 product code 冇缺陷」同「作者嘅記錄四輪以嚟第一次
準確」。佢重現咗 §13 四個 mutation，四個都喺我講嗰條斷言度死。

批准條件係 `git merge origin/main` 再跑一次 CI —— 流程，唔係內容。

### 四條 Low，兩條係我自己

**F-L1 —— 我個 `clearInterval` spy 釘錯咗嘢。** 佢的確殺到 `Z10`（孤兒，冇叫
`clearInterval`），亦都唔係靠其他原因過關。但 **`Z10b`（照樣叫 `clearInterval`，
不過叫錯 handle）就生還**。我自己重現咗：生還。

而我上一輪寫嘅理由（「睇 `revealed.remaining` 捉唔到」）本身係真嘅，但 REV-049
**根本冇提議過**嗰個斷言 —— 佢提議嘅係一條**行為**探針：展開 A、行 5 秒、展開 B、
再行 26 秒、斷言 B 仲喺度。嗰條四行，**兩個變體都殺到**。又一次：我由一個「reviewer
冇提議過」嘅變體，推論到「冇嘢做得到」。

改咗用行為探針。實測 `Z10` 同 `Z10b` 而家都 KILLED。

**F-L2 —— 我個註解而家係可量度咁錯，而且方向係低估咗自己個 code。** 見上面 §12
嘅再更正：單獨拆個 call 會紅，單獨拆 `@hide` 會綠，因為 `@hide` 要等 Quasar 個
leave transition（約 400ms）。即係嗰個 call 係**唯一嘅同步清除**。我喺三份文件
講過「兩個機制覆蓋呢條路」，三處全部更正。

### F-L3 —— 十輪以嚟冇人接過嘅第六個觸發點

`session.refresh()`（由 session watchdog 自動行）係 `this.user = result.user` ——
**換一個新 object**，所以 `isAuthenticated` 一路都係 `true`，而我個 watch 永遠唔會行。
REV-050 量到：一次撤走 `supplier.bank.*` 嘅 refresh 之後，**明文仲喺畫面、倒數照行**，
開住嘅寫入 dialog 仲揸住帳號同 step-up 密碼。

範圍：同一個使用者、冇提權、30 秒封頂，而且伺服器每個請求都會重新驗
（`SupplierBankService.authorize` 對住 DB 重讀）。所以係 UI 同 client 記憶體陳舊，
唔係授權繞過。

呢度**收窄咗個 watch 去睇權限而唔係淨係睇登入狀態** —— 一行，而佢守嘅係本模組最敏感
嗰個表面。驗證過會紅（改返去只睇 `isAuthenticated` → 測試失敗）。但 REV-050 講得啱：
**冇一個頁面**喺 refresh 之後重新評估授權，所以個通用修法喺框架層。開咗 task。

### F-L4 —— `main` 又郁咗

`1ba8fb6`（PR #130，dev server `fs.allow`），只掂 `client/vite.config.js`。已經 merge，
冇衝突。

### 驗證

**637/637** client vitest、**23/23** 瀏覽器、lint exit 0 —— 今次三樣都係**讀個
process 自己個 exit status**，唔係讀 pipeline 尾嗰個。
