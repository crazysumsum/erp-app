# 上線資料準備：整合索引

日期：2026-11-24。整理：`claude-erp-app-pm-01`。各份指引由所屬模組的負責人撰寫，內容以各份原文為準；這份索引只排次序、指出缺口及互相矛盾之處。
全部範本只含合成資料。正式清冊、匯出、對帳及例外紀錄放公司受控位置，不放入這個公開倉庫。

要業務回答的問題另見 [QUESTIONS-FOR-BUSINESS.md](QUESTIONS-FOR-BUSINESS.md)。整體時程見 `../golive-gap-20261123/GO-LIVE-PLAN-DRAFT.md`。

## 1. 載入次序

次序來自各指引的前置條件及 [tech-lead/切換日核對.md](tech-lead/切換日核對.md)。前一步未核對簽認，不做後一步。

| 步 | 內容 | 方式 | 指引 | 操作卡 |
| --- | --- | --- | --- | --- |
| 0 | 正式庫 migration、首位管理員、設備核准、角色 | CLI 及畫面 | [userrole/account-preparation.md](userrole/account-preparation.md) | [userrole/cutover-and-device-recovery.md](userrole/cutover-and-device-recovery.md) |
| 1 | 幣別、付款條款、計量單位、倉庫及庫位、商品分類、品牌 | 畫面逐筆（沒有匯入） | 各指引的「先建主資料」段落 | — |
| 2 | 使用者帳號（約 20 人，分四批） | 畫面逐筆 | 同第 0 步 | 同第 0 步 |
| 3 | 貨品（約 2,000 個 SKU） | CSV「只新增」，其後畫面補換算、條碼、效期、多規格 | [item/01-貨品資料準備.md](item/01-貨品資料準備.md) | [item/02-切換日操作卡.md](item/02-切換日操作卡.md) |
| 3 | 客戶 | CSV「僅新增」，其後畫面補其他地址及聯絡人 | [customer-management/customer-data-guide.md](customer-management/customer-data-guide.md) | [customer-management/customer-cutover-card.md](customer-management/customer-cutover-card.md) |
| 3 | 供應商 | CSV「只新增」，其後畫面補銀行資料及供貨關係 | [supplier/資料準備指引.md](supplier/資料準備指引.md) | [supplier/切換及例外操作卡.md](supplier/切換及例外操作卡.md) |
| 4 | 兩倉期初庫存 | CSV，逐檔預檢及入帳 | [inventory/資料準備指引.md](inventory/資料準備指引.md) | [inventory/切換與例外操作卡.md](inventory/切換與例外操作卡.md) |
| 5 | 兩倉對帳、Sam 簽核、期初結案（單向，不能重開） | 畫面 | 同上 | 同上 |
| 6 | 期初應收（約 100 張舊發票） | 畫面逐張登記 | [ar/02-期初應收資料準備指引.md](ar/02-期初應收資料準備指引.md) | — |
| 6 | 未交付銷售單 | CSV | [sales/資料準備指引.md](sales/資料準備指引.md) | [sales/切換日與例外操作卡.md](sales/切換日與例外操作卡.md) |
| 6 | 在途採購單 | 畫面逐張重建（沒有匯入） | [purchasing/01-data-preparation.md](purchasing/01-data-preparation.md) | [purchasing/02-cutover-card.md](purchasing/02-cutover-card.md) |
| 7 | 首批出貨、收貨、開票及列印的核對，然後開放 | 畫面 | [fulfillment/01-data-preparation.md](fulfillment/01-data-preparation.md)、[ar/01-發票列印部署說明.md](ar/01-發票列印部署說明.md) | [fulfillment/02-cutover-and-exceptions.md](fulfillment/02-cutover-and-exceptions.md) |

第 3 步的三項可並行。第 6 步的期初應收可與庫存組並行，但未交付銷售單要排在第 5 步之後，因為確認匯入會預留庫存。

## 2. 各檔案的上限及範本驗證

| 資料 | 每檔上限（各模組現行預設） | 範本 | 11-24 的驗證（各負責人自報） |
| --- | --- | --- | --- |
| 貨品 | 20 MB、10,000 列 | `item/item-import-template.csv`、`item/item-catalog-preparation-template.csv` | 預演環境預檢：3 列有效；未建立 |
| 客戶 | 20 MiB、10,000 列 | `customer-management/customer-import-template.csv` | 隔離環境預檢：2 列有效；未寫入 |
| 供應商 | 10 MiB、10,000 列 | `supplier/supplier-template.csv` | 隔離庫預檢：3 列有效；未確認匯入 |
| 期初庫存 | 10 MiB、5,000 列 | `inventory/期初庫存範本.csv` | 隔離庫：2 列可入帳；庫存仍為 0 |
| 未交付銷售單 | 50 MiB、100,000 明細、10,000 張 | `sales/sales-open-orders-template.csv` | 隔離庫預檢：3 列 2 張有效；未建單 |
| 在途採購單 | 沒有匯入；每張單最多 100 行 | `purchasing/open-po-register.template.csv`（人工建單用的交接表） | 本機核對 3 列的欄位及換算 |
| 期初應收 | 沒有匯入 | `ar/期初應收清單範本.xlsx` | — |
| 使用者 | 沒有匯入 | `userrole/role-mapping-template.csv` | 本機核對欄數及帳號格式 |

以上驗證做在 `c6df403e` 或 `80b54298`，都只到預檢為止，沒有任何一項做過正式資料量的匯入。

## 3. 人手工作量（估計，未實測）

| 項目 | 估計 |
| --- | --- |
| SKU 補包裝換算、條碼、效期 | 每個 2–4 分鐘；多規格另加 3–5 分鐘。2,000 個 SKU 若全部要補，約 70–130 小時 |
| 客戶補地址、聯絡人 | 地址 1–2 分鐘、聯絡人 1 分鐘 |
| 供應商補銀行資料、供貨關係 | 銀行每家 2–3 分鐘；每組 SKU 關係 1–2 分鐘 |
| 倉庫、庫位 | 每倉 2–3 分鐘；每庫位 30–60 秒 |
| 使用者開通 | 每批 5 人 10–15 分鐘；四批連等候 70–90 分鐘 |
| 期初應收登記 | 每張 1–1.5 分鐘；100 張約 2 小時 |
| 在途採購單重建 | 每張 3–5 分鐘，每多一行 30–60 秒 |

SKU 的補錄是最大的一項，也是最不確定的一項：要看 2,000 個 SKU 中有多少需要包裝換算、條碼及效期。

## 4. 互相矛盾或未定之處

1. **部分已出貨、部分已收貨的舊單。** Sales 及 Fulfillment 的操作卡寫成「整張留舊流程結清」；[tech-lead/切換日核對.md](tech-lead/切換日核對.md) 第 7 點指出這條界線仍要 Sam 確認。問題在於切換後庫存只存在於新系統，留在舊流程的餘量出貨時要從新系統的庫存扣減。PM 更正後的建議是餘量在新系統重建；尚未決定，見問題清單 D1。
2. **留在舊系統的採購單收貨怎樣只一次進入新庫存。** Purchasing 的指引列為待業務確認；Inventory 的操作卡說期初結案後只可走授權的庫存調整。兩者要對成同一個做法，見問題清單 D2。
3. **應付沒有期初資料要載入。** 上線前的舊供應商發票及付它們的款項都不進系統，所以應付沒有資料準備指引。上線後第一批發票及付款的做法、三類要在系統外記例外的情況（整單折扣或扣減、一張收貨分多張發票、日期打錯）見 [ap/切換及例外操作卡.md](ap/切換及例外操作卡.md)；入帳、付款、改價各需的權限見 [ap/應付角色配置.md](ap/應付角色配置.md)（應付負責人 11-24 補交）。這兩份按分支上的應付版本寫成，應付合併後要在凍結版本上核對一次。
4. **發票確認須有客戶的預設帳單地址。** Customer 的 CSV 已能帶入 `billing*`，但「沒有預設帳單地址的發票被拒」這個檢查在 G5 分支，要在上線版本驗證，不能以現有的 CSV 預檢代替。
5. **指引的驗證版本。** 各指引核對的是 `c6df403e` 或 `80b54298`。上線版本會多出六個分支及應付；G1（期初應收）、G3（期初結案）、G5（列印）的畫面步驟要在凍結版本上重新核對一次。
6. **列印用的瀏覽器。** 發票每頁的編號及頁碼只在 Chrome 及 Edge 出現。

## 5. 驗收及切換相關

- 11-26 驗收：[uat/11-26-驗收流程.md](uat/11-26-驗收流程.md)、[uat/11-26-驗收支援.md](uat/11-26-驗收支援.md)、[uat/兩倉批次出貨操作卡.md](uat/兩倉批次出貨操作卡.md)、[fulfillment/04-uat-two-warehouse-lot-shipment.md](fulfillment/04-uat-two-warehouse-lot-shipment.md)。
- UAT 後的合併次序：[ci/post-uat-merge-order.md](ci/post-uat-merge-order.md)。
- 切換日的先後及放行條件：[tech-lead/切換日核對.md](tech-lead/切換日核對.md)。
