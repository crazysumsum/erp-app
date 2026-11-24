# 採購單報表與匯出

在「採購與收貨 → 採購單」按供應商、訂單起訖日期搜尋。套用後按「匯出 CSV」，下載所有符合已套用條件的採購單，沿用列表排序。日期包含首尾兩天。草稿、取消等狀態可用既有狀態篩選控制。沒有符合條件時仍可下載欄名。

每張採購單一列。CSV 使用 UTF-8 BOM，欄位順序如下。

| 欄位 | 內容 |
| --- | --- |
| `purchaseOrderNumber` | 採購單編號 |
| `orderDate` | 訂單日期，格式 `YYYY-MM-DD` |
| `supplierCode`、`supplierName` | 採購單保存的供應商代碼與名稱 |
| `status` | 匯出時的採購單狀態代碼 |
| `currencyCode`、`totalAmount` | 原單幣別及總金額，按原幣別的小數位顯示 |

`GET /api/v1/purchase-orders/export` 使用與列表相同的篩選和排序參數，權限為 `purchasing.view`。每次最多 50,000 列，超過時縮小篩選範圍。下載回應使用 `private, no-store`。可能被試算表解讀為公式的欄值以安全文字輸出。成功產生報表時在既有稽核表記錄操作者及列數。
