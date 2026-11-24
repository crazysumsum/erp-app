# 客戶正式資料準備指引

交一份 **客戶主檔 CSV**，一列代表一個客戶。以附檔 `customer-import-template.csv` 為起點，刪掉兩列「合成」資料，保留全部 44 欄表頭。首次交件用「僅新增」，新客戶不可重複代碼或法定名稱。系統會把大小寫及部分全半形差異視為相同。

**必填規則**：新客戶至少填 `customerCode`、`legalName`、`defaultCurrencyCode`。每個會被開票的客戶還須有一個**有效的預設帳單地址**。準備送貨的客戶也要有有效送貨地址及聯絡人。其他欄可留空；有填一組地址、聯絡人、識別資料或信用政策時，遵守下面的條件。

| 欄位 | 怎麼填／常見錯誤 |
|---|---|
| `customerId`、`customerCode`、`legalName`、`tradingName` | 新增時 ID 留空；修正既有資料才填本庫正整數 ID，如 `123`，與代碼必須對應。代碼必填，最多 64 字，如 `CUS-001`。法定名稱必填、別名選填，各最多 190 字。不要用舊系統 ID，也不要讓 Excel 去掉代碼開頭的零。 |
| `defaultCurrencyCode`、`paymentTermCode` | 幣別必填三碼，如 `HKD`／`USD`。條款填財務核定且已啟用的代碼，如 `NET30`；沒有約定才留空，開票時由財務手填到期日。勿填幣名、符號或「30天」。 |
| `accountManagerUsername`、`categoryCode`、`industryCode`、`territoryCode` | 選填已啟用的登入名稱、類別、行業、區域代碼，如 `demo-manager`、`wholesale`、`retail`、`hk`。勿填顯示名稱。 |
| `website`、`generalPhone`、`generalEmail`、`notes` | 選填。如 `https://example.invalid`、`55501000`、`demo@example.invalid`、`只收工作日貨件`。網址要有 http(s)，電話存純文字，備註勿放密碼或銀行資料。 |
| `addressLabel`、`addressRecipientCompanyDepartment`、`addressLine1`、`addressLine2`、`addressLine3` | 有地址時，標籤（如「總公司帳單」）及第一行（如「測試路 100 號」）必填。收件公司／部門（如「財務部」）和第 2、3 行（如「2 樓」「B 室」）選填，不要在單一欄輸入換行。 |
| `addressCity`、`addressStateRegion`、`addressPostalCode`、`addressCountryCode`、`addressPhone`、`addressNotes` | 選填城市、地區、郵編、兩碼大寫國家／地區、電話、備註，如「香港」「九龍」、`01234`、`HK`、`55501000`、「先聯絡收貨」。郵編用文字保留前導零；國家不用「Hong Kong」。 |
| `addressPurposes` | 有地址時必填用途。帳單預設填 **`billing*`**；同一處也送貨就填 **`billing*\|shipping*`**。其他可用 `registered`、`office`、`returns`、`other`。用途以直線符分隔，星號代表預設。只有 `billing`（沒有星號）不符合上線要求。 |
| `contactName`、`contactJobTitle`、`contactDepartment`、`contactEmail`、`contactPhone`、`contactMobile`、`contactPreferredLanguage`、`contactNotes`、`contactPurposes` | 有聯絡人時姓名與用途必填，如「測試聯絡人」、`shipping*\|billing_ar*`。其他用途 `general`、`ordering`、`returns`、`other`。職稱、部門、電郵、電話、手機、語言與備註選填，如「主管」「倉務」、`demo@example.invalid`、`55501000`、`55501001`、`zh-HK`、「先致電」。用途不可填中文或重複。 |
| `identifierType`、`identifierIssuerCountryCode`、`identifierValue`、`identifierValidFrom`、`identifierExpiresAt`、`identifierNotes` | 整組選填。有填則類型（`company_registration`／`business_registration`／`tax`／`other`）、兩碼國家及識別值必填，如 `tax`、`HK`、`DEMO-TAX-01`。起迄是毫秒時間戳，非日期文字。沒有已轉換的時間戳便留空，請資料負責人確認；到期須晚於起日。備註可填「已核對」。 |
| `creditLimit`、`creditCurrencyCode`、`creditStatus` | 不用信用政策就三欄留空。若有額度，填非負四位小數如 `1500.0000`，不加逗號／貨幣符號，並填啟用幣別 `HKD`；有政策時狀態填 `normal` 或 `on_hold`。留空與 `0.0000` 意思不同。 |

**格式與次序**：存為「CSV UTF-8（逗號分隔）」，每檔預設最多 10,000 資料列且不超過 20 MiB；如環境限制較低，以較低者為準。超過任一上限才分檔，每檔保留表頭，跨檔代碼仍要唯一。請管理員先建立啟用幣別／條款、所用分類與負責人帳號，確認匯入權限及背景工作正常。客戶資料在期初應收與在途銷售單前載入。

**畫面補錄**：首匯一客戶只帶一個地址、一個聯絡人及一筆識別資料。帳單與送貨地不同，CSV 放 `billing*`，另到詳情加「送貨」地址並選預設。補地址約 1–2 分鐘、聯絡人約 1 分鐘／筆，均為估計。既有客戶的地址、聯絡人及識別資料改用畫面，勿用 CSV 更新；銀行／附件不交 CSV，如有業務需要走授權畫面（估 2–3 分鐘／筆）。

**驗收及待確認**：預檢對總數，先處理無效列並確認警告，再依核定狀態匯入。下載結果，比對客戶代碼、啟用狀態、幣別、條款及有效預設帳單／送貨資料；差異清單只重做未成功項，別重匯整檔。請 Sam／業務先確認：代碼沿用或換碼、哪些會開票、各客戶的正式幣別／條款、預設帳單與送貨地址、誰核對及誰有啟用權。

**範本實測（11-24）**：在現行 main `c6df403e` 的獨立本機環境，用 Playwright 上傳此範本一次。先備妥合成用 USD、`DEMO-NET30`、`DEMO-DUE-NOW`；HKD 由初始化提供。工作 #1 到達「待確認」，**有效 2、警告 0、無效 0**。讀回預檢結果，兩筆均有正確幣別、條款及預設帳單用途，且可辨識送貨聯絡人。這次停在預檢，實際寫入客戶 **0 筆**。
