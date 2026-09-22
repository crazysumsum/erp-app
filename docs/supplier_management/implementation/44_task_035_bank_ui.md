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

清除有五個觸發點，全部行同一個 `forgetPlaintext()`：手動收起、30 秒到、unmount、
route change、session 失效。

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

## 5. 一個我殺唔到嘅 mutant，記低咗冇扮

拆走 `onBeforeRouteLeave(() => { forgetPlaintext(); })` 之後，**全部瀏覽器測試照綠**。

原因：今日每一條離開呢一頁嘅路徑都會 unmount 個 panel，而 `onUnmounted` 已經清咗。
佢守嘅唔係嗰條路，係 Vue Router **重用 component instance** 嗰條 —— `/suppliers/7` 去
`/suppliers/8` 係同一個 route record，唔會 unmount。今日冇任何頁面連結去嗰度（唯一去
`/suppliers/:id` 嘅入口係列表，而經列表就一定 unmount 過），所以我寫唔出一個殺得到佢
嘅測試。

我試過一個，用 `history.pushState` 扮 route change —— **嗰個唔會驅動 Vue Router**，
所以佢乜都冇測到，而佢喺 mutant 之下一樣綠。已經刪咗：一個斷言唔到自己標題嗰件事嘅
測試，比冇嗰條測試更差。

**留返個 guard。** CLAUDE.md 講明安全控制唔可以因為「而家用唔著」就簡化走，而一個
「下一個供應商」掣就會令呢條路存在 —— 嗰陣個漏洞係 7 號嘅帳號明文留喺一個 URL 已經
寫住 8 號嘅畫面上面。一行換呢個，唔值得慳。

## 6. 順手揾到、**冇**喺度改嘅嘢

`SupplierDetailPage` 只喺 `onMounted` load，冇 watch `route.params.id`。即係同一個
重用路徑之下，換咗 id 啲資料根本唔會重載 —— 7 號嘅資料會留喺一個寫住 8 號嘅 URL
下面。同上面個 guard 係同一個成因，但佢係 detail page 自己嘅問題，唔喺 T35 scope 入面，
所以淨係記低，冇喺呢度改。

## 7. Developer self-test

| Suite | 結果 | Evidence |
| --- | --- | --- |
| `supplier-phase-001-client` | **PASS** 84/84（呢個 suite 係 supplier 子集，唔係成個 client） | `evidence/20260922T024325-ba84acad575d/run.json` |
| `supplier-phase-001-server` | **PASS** 395/395 | `evidence/20260922T024327-d465987adeb0/run.json` |
| `lint` | **PASS** | `evidence/20260922T024331-3bf826929656/run.json` |
| `client-build` | **PASS** | `evidence/20260922T024334-c4ad32cc1a1a/run.json` |
| 成個 client vitest | **PASS** 582/582 | 本機，唔係 profile suite |
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
