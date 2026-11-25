# 應收帳齡 CSV

在應收帳齡表套用客戶與幣別篩選後，可下載同一篩選的今日帳齡。下載時以伺服器當日重新讀取資料，權限為 `ar.view`。檔名為 `ar-aging-YYYY-MM-DD.csv`。

| 順序 | 欄位 | 意義 |
| --- | --- | --- |
| 1–2 | `asOfDate`, `rowType` | 業務日期、明細 `detail` 或幣別合計 `currencyTotal` |
| 3–4 | `customerCode`, `customerName` | 已入帳發票的客戶快照。幣別合計留空 |
| 5–6 | `currencyCode`, `invoiceCount` | 幣別及仍有未收額的已確認發票數 |
| 7–12 | `notDue`, `days1To30`, `days31To60`, `days61To90`, `over90`, `total` | 未到期、四段逾期及總額，沿用畫面的分桶，輸出十進制數字 |

每個客戶及幣別一筆明細，後接各幣別合計。有篩選但無匹配資料時仍下載欄名。UTF-8 帶 BOM，文字欄位防止試算表將資料辨識為公式。
