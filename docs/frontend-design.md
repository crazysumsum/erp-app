# 前端設計風格規範

本文件記錄呢個 ERP 系統前端**現時實際採用**嘅視覺與互動設計慣例，唔係願景文件。內容全部對應到已經落地嘅程式碼（每一節都附實際檔案路徑）。**之後所有 UI/UX 設計、新頁面、新元件都要跟返呢份規格**——加咗新慣例，記得同步更新呢份文件，唔好令佢同程式碼漂移。

技術棧：**Vue 3 + Quasar 2**（Material Design 元件庫），冇用 Tailwind／shadcn。所有樣式慣例都建立喺 Quasar 既有嘅 utility class 同元件之上，唔重新發明一套。

---

## 一、色彩系統

### 1.1 品牌色 token

集中定義喺 [`client/src/css/theme.css`](../client/src/css/theme.css)，用 CSS variable 覆蓋 Quasar 內建色，唔使裝 SASS 工具鏈：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--q-primary` | `#155e75`（深藍青色） | 主色，按鈕、連結、focus outline、sidebar 選中狀態 |
| `--app-bg` | `#f5f7fa` | 頁面背景（比 Quasar 預設 `bg-grey-2` 稍為冷色） |
| `--app-border` | `#e2e8f0` | 分隔線（例如 `PageHeader` 底部） |
| `--app-radius` | `10px` | 卡片圓角統一值 |
| `--app-primary-tint` | `color-mix(in srgb, var(--q-primary) 10%, white)` | 主色淡化版，用喺選中狀態嘅背景（見 `.app-active-tint`） |

**規則**：新增品牌相關顏色一律加喺呢個檔案嘅 `:root` 底下，唔好喺個別頁面 inline 寫 hex 值。改色只需要改呢一個地方，成個 app 會跟住變。

### 1.2 語意色（狀態徽章）

用 Quasar 內建語意色（`positive` / `negative` / `warning` / `grey`），但**淨係用喺 `q-badge`**——Quasar 嘅 `q-badge` 底層寫死白色文字（`.q-badge{color:#fff}`），而 `positive`／`warning`／`grey` 三種背景本身夠淺，配白字對比度**唔夠 WCAG AA 嘅 4.5:1**（實測：positive `#21BA45`=2.57:1、warning `#F2C037`=1.70:1、grey `#9E9E9E`=2.68:1，全部 fail；negative `#C10015`=6.41:1 本身已經夠深）。

已經喺 `theme.css` 修正呢三種嘅徽章文字色（唔係改 `--q-positive` 等變數本身，避免影響按鈕等其他用緊呢幾種顏色嘅地方）：

```css
.q-badge.bg-positive,
.q-badge.bg-warning,
.q-badge.bg-grey {
  color: var(--q-dark);
}
```

**規則**：

- 狀態徽章一律用 `<q-badge :color="STATUS[value]?.colour">`，唔好自己另外拼 `bg-*`／`text-*` class——新增嘅狀態顏色如果都係淺色（例如 `info`），要記得檢查同白字嘅對比度，唔夠就加落呢條規則。
- 任何地方手動組合 `bg-warning`／`bg-positive` 等背景色 + `text-white` 都要先驗證對比度（例如 [`RolesPage.vue`](../client/src/pages/system/RolesPage.vue) 同 [`UsersPage.vue`](../client/src/pages/system/UsersPage.vue) 嘅錯誤 banner 已經改用 `text-dark`）。
- 唔好用色彩做唯一嘅狀態指示——徽章、badge 都必須連文字（例如「啟用」「已停用」），唔可以淨係一嚿顏色。

### 1.3 何時新增顏色

先搵現有 token／Quasar 語意色夠唔夠用。真係需要新顏色（例如新產品線嘅品牌色），先喺 `theme.css` 加一個新 `:root` variable，唔好喺元件入面 inline hex。

---

## 二、版面與間距

### 2.1 間距刻度

一律用 Quasar 嘅 spacing utility class（`q-pa-*`／`q-ma-*`／`q-gutter-*`，`xs`=4px、`sm`=8px、`md`=16px、`lg`=24px、`xl`=48px），**唔好寫死 px 值**（`style="padding: 13px"` 呢類）。唯一嘅例外係少數版面級容器（例如登入頁嘅 split-panel，見 §7）用 CSS 檔案入面嘅具體數值，因為嗰啲已經超出 Quasar utility 覆蓋嘅範圍。

### 2.2 頁面結構慣例

每一個受保護頁面（喺 `AppShell` 之內）遵循固定結構：

```html
<div>
  <PageHeader />                          <!-- 頁面標題 + 麵包屑 + 右側操作按鈕 -->
  <div class="q-px-md q-pb-md">           <!-- 內容容器：只有左右／底部 padding -->
    <!-- 頁面內容 -->
  </div>
</div>
```

**`PageHeader` 自己帶 `q-mb-md`（見 [`PageHeader.vue`](../client/src/framework/layout/PageHeader.vue)），所以下面嘅內容容器唔使、亦都唔應該再加頂部 padding**——呢一步統一控制標題分隔線同內容之間嘅距離，等所有頁面用返同一個間距，唔使逐頁記得加。（呢條規則之前漏咗，[`ProfilePage.vue`](../client/src/pages/ProfilePage.vue) 一度自己加咗 `q-pa-md` 做成上下唔一致，已經修正做 `q-px-md q-pb-md`。）

有篩選列嘅頁面（例如 [`UsersPage.vue`](../client/src/pages/system/UsersPage.vue)），篩選列同表格分別包喺自己嘅 `q-px-md q-pb-md` div，兩者唔會疊加 padding。

### 2.3 卡片

`q-card`（非 `flat`）統一用 `theme.css` 嘅輕陰影 + `var(--app-radius)` 圓角（見 §一 1.1），唔使個別頁面自己指定 `box-shadow`／`border-radius`。

### 2.4 表格橫向捲動：sticky actions column

窄螢幕或者欄位多嘅表格，最後一欄（通常係操作按鈕）容易捲出畫面外，用戶未必知道要拉去最右先見到。有操作按鈕嘅表格一律喺 `<DataTable sticky-actions>` 加呢個 prop（見 §三 3.1），`theme.css` 嘅 `.q-table--sticky-actions` 規則會將最後一欄釘死喺右邊，唔會跟住橫向捲動走。

---

## 三、元件慣例

### 3.1 DataTable（[`framework/ui/DataTable.vue`](../client/src/framework/ui/DataTable.vue)）

全站表格一律經呢個共用元件，**唔好直接用 raw `<q-table>`**——之前 `RolesPage` 一度自己用 raw `q-table`，導致佢冇跟到 `rows-per-page-options` 設定，揀「全部」會直接撞後端 `pageSize` 上限報錯。改用 `DataTable` 之後所有表格自動共用同一套設定，唔會再有個別頁面漏配置嘅情況。

兩種模式，二揀一：

| 模式 | 用法 | 適用情境 |
| --- | --- | --- |
| 伺服器分頁 | 傳 `fetch` prop（形狀同 QTable 原生 `@request` 一致：`page`/`rowsPerPage`/`sortBy`/`descending`/`filter`，回傳 `{ rows, rowsNumber }`） | 清單可能好長，靠後端分頁（Users、AuditLogs、DeviceApprovals） |
| 客戶端分頁 | 傳 `rows` prop（已經攞好嘅完整陣列），唔傳 `fetch` | 清單本身唔大，一次過攞晒落嚟（Roles） |

固定行為（兩種模式共用）：

- `:rows-per-page-options="appConfig.pageSizeOptions"`（見 [`config/app.js`](../client/config/app.js)：`[10, 20, 50, 100]`，**冇 0／「全部」選項**）——呢個係單一設定來源，唔好喺個別頁面覆寫。
- 有操作欄就加 `sticky-actions` prop（見 §2.4）。
- 冇資料就顯示「冇資料」（可用 `#no-data` slot 覆寫）。
- 伺服器模式 fetch 失敗會顯示錯誤 banner + 重試按鈕；loading 狀態帶 `aria-busy`。

### 3.2 EllipsisCell（[`framework/ui/EllipsisCell.vue`](../client/src/framework/ui/EllipsisCell.vue)）

任何表格欄位嘅內容係**用戶自己打嘅自由文字**（顯示名稱、裝置名稱、描述……）或者**組合出嚟可能好長**（例如審批頁嘅 User Agent），一律用 `<EllipsisCell :text="..." :tooltip="..." max-width="...px" />` 包住，唔好直接輸出裸文字：

```html
<template #body-cell-displayName="{ value }">
  <EllipsisCell :text="value" max-width="200px" />
</template>
```

長內容截斷做一行（CSS ellipsis），完整內容用 hover tooltip 顯示——唔截斷嘅話會逼到成張表寬過螢幕。`tooltip` prop 開放俾「畫面顯示」同「hover 應該睇到」唔一樣嘅情況用（例如角色頁嘅權限摘要顯示「A +3」，tooltip 要列晒全部）。

固定長度嘅識別碼（例如設備 id）保留自己嘅截斷邏輯（頭 16 字元 + `…`），但要記得加 `<q-tooltip>` 顯示完整值。

### 3.3 FormPanel（[`framework/ui/FormPanel.vue`](../client/src/framework/ui/FormPanel.vue)）

所有表單（新增／編輯對話框、修改密碼等）一律經呢個共用元件：

```html
<FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitFn" @success="afterSuccess">
  <q-input :error="!!fieldError('name')" :error-message="fieldError('name')" ... />
  <q-btn type="submit" :loading="submitting" />
</FormPanel>
```

- 後端 validation 錯誤（`error.details`，`requestValidator` 格式）自動拆做逐欄位錯誤，經 `fieldError(name)` 傳落去對應輸入框嘅 `:error`／`:error-message`。
- 提交失敗（無論係逐欄位錯誤定係總體錯誤）會顯示一個 **`role="alert" tabindex="-1"`** 嘅錯誤總覽 banner，並且**自動將焦點移過去**——冇呢一步嘅話，screen reader 用戶完全唔會知道個表單提交失敗咗（畫面冇跳走，冇任何嘢會宣讀）。呢個係無障礙嘅硬性要求，唔係裝飾，**唔好自己另外寫一套表單提交邏輯繞過佢**。

### 3.4 PageHeader（[`framework/layout/PageHeader.vue`](../client/src/framework/layout/PageHeader.vue)）

頁面標題一律用 `<PageHeader />`，標題預設由路由 `meta.title` 讀出（頁面 `export const page` 嘅 `title` 欄位），唔使自己再傳一次。需要覆寫或者加副標題先傳 `title`／`subtitle` prop：

```html
<PageHeader title="設備審批" subtitle="每一台新設備都要經人手批准先可以使用系統" />
```

右側操作按鈕（例如「新增」）用 `#actions` slot。標題本身係真正嘅 `<h1>`（唔係 styled `<div>`，見 §五 5.1）。

### 3.5 PasswordReasonDialog（[`framework/ui/PasswordReasonDialog.vue`](../client/src/framework/ui/PasswordReasonDialog.vue)）+ `confirm.js`

需要「輸入密碼確認」嘅高風險操作（核准／拒絕設備、停用／啟用帳號）一律用 `promptPassword()`（`framework/ui/confirm.js`），唔好自己砌一個 dialog。

### 3.6 提示訊息（`framework/ui/notify.js`）

操作結果一律用 `notifySuccess(message)` / `notifyError(message)`（底層係 Quasar `Notify`，成功綠色、失敗紅色、統一浮喺頂部），唔好自己另外組 `Notify.create(...)`。

---

## 四、圖示

用 **Material Icons**（`@quasar/extras/material-icons`，喺 `main.js` 全域載入），寫法係 `<q-icon name="person" />` 或者 `q-btn`／`q-item` 嘅 `icon` prop。**唔好用 emoji 做圖示**。

純裝飾、旁邊已經有文字講同一件事嘅圖示（例如登入頁品牌徽章嗰個「M」），加 `aria-hidden="true"`。

---

## 五、字體與標題階層

### 5.1 標題一定係真正嘅 heading 元素

Quasar 嘅 `text-h1`～`text-h6` 淨係管字體大小／粗幼，同 HTML tag 語意完全無關。**畫面上睇落係標題嘅內容，一定要用返 `<h1>`～`<h6>`，唔可以淨係 `<div class="text-h6">`**——之前成個 app 一個真正嘅 heading 都冇，screen reader 用戶用「跳去下一個標題」導覽會搵唔到任何嘢，已經全部修正。

規則：

- 每一頁**一個** `<h1>`：由 `PageHeader` 提供（見 §3.4）；冇用 `PageHeader` 嘅獨立頁面（登入、404、403、設備待審批、修改密碼）自己嘅標題就係嗰頁嘅 `<h1>`。
- 對話框標題、頁面入面嘅子區塊標題（例如首頁嘅「系統狀態」卡片）用 `<h2>`。
- 原生 heading 有瀏覽器預設 margin，`<div>` 冇——改用真正 tag 嗰陣**一定要加 `q-ma-none`** 抵消，唔係會偷偷谷開版面：

  ```html
  <h1 class="text-h6 q-ma-none">{{ resolvedTitle }}</h1>
  ```

### 5.2 字級對應

| Class | 用途 |
| --- | --- |
| `text-h5` | 獨立頁面（登入）嘅主標題 |
| `text-h6` | `PageHeader` 標題、對話框標題 |
| `text-body2` | 一般內文、說明文字 |
| `text-caption` | 次要資訊、hint、表格內嘅輔助文字 |

唔好跳級（例如 `<h1>` 之後直接 `<h3>`），亦唔好將 heading class 用喺唔係標題嘅內容上。

---

## 六、無障礙規範（WCAG 2.1 AA）

呢啲係已經落地嘅硬性要求，新元件／新頁面一律要跟：

| 項目 | 規則 | 參考實作 |
| --- | --- | --- |
| Focus 可見 | 鍵盤 focus 一定要睇得見落喺邊，用品牌色 outline | `theme.css` 嘅 `:focus-visible` |
| 標題階層 | 見 §5.1 | `PageHeader.vue` |
| 圖示按鈕 | 冇文字標籤嘅按鈕一定要有 `aria-label` | `AppTopbar.vue` 嘅選單按鈕 |
| 表格 loading | `:aria-busy="loading"` | `DataTable.vue` |
| 表單提交失敗 | 錯誤總覽 + 移動焦點（見 §3.3） | `FormPanel.vue` |
| 文字對比度 | 一般文字 ≥4.5:1，大字（18pt+/14pt 粗體）≥3:1 | 見 §1.2 徽章對比度修正 |
| 觸控／點擊範圍 | Web 最少 24×24 CSS px（已驗證 Quasar `dense round` icon button 實測 33.6px，合格） | — |
| 色彩唔係唯一指示 | 狀態一定連文字，唔淨係顏色 | 狀態徽章都帶文字標籤 |

新增元件前檢查有冇類似元件已經處理咗呢啲項目（例如任何表單都應該經 `FormPanel`），唔好每次重新發明。

---

## 七、回應式設計

Mobile-first，測試斷點：**375px（手機）、768px（平板）、1024px、1440px（桌面）**。

一般頁面（表格、表單）跟 Quasar 預設 grid／breakpoint 系統。特殊版面（例如登入頁 split-panel，見 [`LoginPage.vue`](../client/src/pages/LoginPage.vue)）用自訂 media query，**斷點要有根據，唔好隨手揀一個數字**——登入頁用 `920px`，係按兩欄各自嘅最小舒適闊度（品牌欄 ~480px + 表單欄 ~420px）加返少少邊界計出嚟，避免中間尺寸兩欄都窄得核突。新增類似版面時用同一個方法算斷點，並且喺瀏覽器實測過渡點前後嘅畫面（例如 900px、920px、960px）冇「唔上唔落」嘅尷尬狀態。

Sidebar（`AppShell.vue`）用 Quasar 內建 `show-if-above`：闊畫面常駐顯示，窄畫面收埋做浮動抽屜，唔使自己寫 breakpoint 判斷。

---

## 八、品牌識別

### 8.1 「M」花體徽章

改編自公司官網（f-m.com.hk）嘅深色徽章 + 花體「M」標誌，重新設計（唔係直接複製佢哋個 bitmap 檔案）嚟融入呢個 ERP 嘅視覺：

- 用**真正文字**（`font-family: Georgia, "Times New Roman", "Noto Serif TC", serif; font-style: italic; font-weight: 700;`）畫「M」，唔係點陣圖或者 SVG path——任何尺寸都清晰，唔使額外圖片資源。
- 兩個變體，按背景揀：

  | 變體 | 徽章背景 | 用喺邊 | 參考 |
  | --- | --- | --- | --- |
  | 半透明（translucent） | `rgba(255,255,255,.14)` | 深色／漸層背景（登入頁品牌欄） | `LoginPage.vue` 嘅 `.login-card__brand-mark` |
  | 實心（solid） | `var(--q-primary)` | 白色／淺色背景（頂部工具列） | `AppTopbar.vue` 嘅 `.app-topbar__brand-mark` |

  半透明版本喺白底度會睇唔清，白底一定要用實心版。

- 徽章本身係裝飾性，旁邊一定有 `F&M ERP` 文字講同一件事，所以徽章要加 `aria-hidden="true"`。

### 8.2 系統名稱

全站一律用 **F&M ERP**（`config/app.js` 嘅 `appConfig.title`），唔好再出現舊嘅「ERP System」placeholder。改呢個名淨係要改 `config/app.js` 一個地方（+ `index.html` 嘅 `<title>`，因為嗰個係靜態 HTML，冇同呢個 config 連動）。

---

## 九、語言與文案

- 使用者可見文字一律**繁體中文**。
- 錯誤訊息**唔可以直接顯示後端原文**——後端 `ApplicationError` 嘅 `message`／`publicMessage` 好多時係俾開發者睇嘅英文 debug 字串（例如 `"Invalid username or password"`），唔係設計俾用戶睇。前端經 [`framework/http/errorMessages.js`](../client/src/framework/http/errorMessages.js) 呢個 `code → 中文訊息` 對照表統一翻譯（見 `HttpClient.js` 點用呢個表）。新增一個會俾用戶睇到嘅錯誤 code，記得喺呢個表加對應嘅中文句——唔好期望前端每個呼叫點自己執手尾。
- 已經係中文嘅後端訊息（業務邏輯層，例如用戶／角色管理嗰啲）唔喺呢個表入面嘅 code 會原樣顯示，唔使重複翻譯。

---

## 十、新頁面／新元件檢查清單

出街前用呢張清單走一次：

- [ ] 表格用 `<DataTable>`（唔係 raw `q-table`），有操作欄加 `sticky-actions`
- [ ] 表格內自由文字／可能過長嘅欄位用 `<EllipsisCell>`
- [ ] 表單用 `<FormPanel>`
- [ ] 頁面用 `<PageHeader>`（或者獨立頁面自己有 `<h1>`）；對話框標題係 `<h2>`
- [ ] 顏色用 `--q-primary` 等 token 或者 Quasar 語意色，冇 inline hex
- [ ] 新狀態顏色（徽章）驗證過同白字嘅對比度 ≥4.5:1
- [ ] Icon-only 按鈕有 `aria-label`；純裝飾圖示有 `aria-hidden="true"`
- [ ] 錯誤訊息經 `errorMessages.js` 翻譯，唔會直接漏英文原文
- [ ] `npx eslint src/ test/` 通過
- [ ] `npx vitest run` 通過（新元件／新行為有對應測試）
- [ ] 響應式：375px／768px／1024px／1440px 睇過，冇橫向捲動
- [ ] Console 冇 error／warning

---

## 十一、有意識咁保留嘅唔一致

- **ChangePasswordPage** 冇用 `PageHeader`（喺 `AppShell` 之內但自己做置中卡片版面）——刻意設計，因為呢頁冇入菜單，入口喺 `AppTopbar` 落拉選單，唔需要麵包屑。
- **登入頁**（`LoginPage.vue`）用自己一套 split-panel 版面，冇用共用嘅 `AuthLayout`——登入係成個系統嘅第一印象，值得額外設計；`AuthLayout` 保留俾 404／403／設備待審批呢類單純訊息頁，套用大幅品牌欄會顯得小題大做。
- 404／403／設備待審批頁**未加**「M」徽章（仍然係通用建築物圖示）——如果之後想全站一致，記得同步呢份文件。
