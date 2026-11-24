【Item Management｜12 月中上線差距】只讀核對 origin/main c6df403e（11/23），下列天數為估計。

1｜已可用（兩條閉環以外）
• Category／Brand／UOM／Attribute 維護、EA／BOX 換算、內部條碼。真瀏覽器：首版 Catalog 與 24 EA 換算已驗（UAT-014）。
• Standard／Variant 建檔、既有 Variant 加 SKU、SKU／條碼搜尋、編輯／啟停、受控刪除與封存。真瀏覽器：UAT-003/004/015 與既有開發煙測。
• CSV 範本、Standard 匯入預檢→確認→背景執行→結果下載，以及篩選後 SKU 匯出。真瀏覽器：UAT-009/015。
• 複製成草稿、同名提示、每批最多 100 筆狀態操作、圖片上傳。真瀏覽器：既有 T20/T32/T33/T36 煙測。
• 管理／唯讀權限及稽核查詢。真瀏覽器：UAT-002/010/011/016。以上為既有 Item 證據，本輪無重跑。

2｜首日差距與替代做法
A. 正式約 2,000 SKU 開帳。既有證據是合成資料；未見全量正式清冊與開帳庫存 SKU／基本單位／批號／效期對帳。用現有 CSV 建 Standard 草稿，UI 補 Variant、包裝換算、條碼及效期欄位再啟用；開帳前和 Inventory 對帳。估 2–4 個 Item 工作天，視需手補筆數而定；依賴業務、Inventory、驗收；不用改表。上線前另由營運確認實際目標的備份／可還原和核對回滾步驟（估 0.5–1 天，不改表）。
B. FR-LIST-004/005 部分條件在現有 UI 無法直接篩：分類／品牌、追蹤政策、採購／銷售旗標、日期；分類／品牌／狀態排序亦未見。先用 SKU／條碼／名稱及狀態定位，按現有匯出欄位做 Excel 篩選，其餘查詳情。估 2–4 天；Item；不用改表。
C. TASK-043／DEF-107：GR 正本、確認入庫及 Item provider 已接通；Supplier 商品供應歷史仍不能由正式 GR 自動更新、重送及補漏。以已確認 GR 明細／入庫紀錄逐筆對帳，手動查供應紀錄。估 Item 2–4 天（GR-01/02/03、TC-004/005、UAT-005/013；上游工期另估）；依賴 Purchasing／Supplier verifier、提交後投影及補漏；Item 不改表，上游待設計確認。
D. 完整度儀表板／更進階重複偵測未見。以現有同名提示、建檔驗證及匯出抽核替代；估 3–5 天；Item；最小方案不用改表。

3｜已知限制
CSV v1 僅 Standard、按 SKU ID＋版本更新、全批原子；不含包裝換算、條碼及效期欄。預設 10,000 列，首日難點是資料補齊。Serial 可設於主檔，但交易查找／收貨不支援；首期使用 batch／batch_expiry。封存後恢復 Item 只變停用，SKU 需另恢復。Recovery 仍沿用 APR-025 owner waiver，TC-016 NOT_RUN。未見其他已確認的首日 Item 產品缺陷。

4｜建議分級
• 上線前必須：A。確認真實貨品及開帳關聯可用，否則可直接卡住採購、銷售、庫存；用現有功能即可，先按正式清冊估手補量。
• 上線後首月：B（2,000 SKU 以代碼操作仍可完成，先觀察查找成本）；C（維持二期，人工對帳可過渡，無礙首日確認入庫）。
• 可以不做：D、Variant／完整欄位進階匯入（有現成 CSV＋UI；只有 A 證實人手不足才重評）、額外大規模容量、歸檔分層、背景恢復框架及 serial 擴展（首期批次不依賴）。本次清單完成，無新 Item 阻斷待修，11/26 可喚醒。

依據：Item 01_requirement_spec §8.1/16.3/17、05_development_tasks、testing/08_uat_closeout_20260922、item_handoff_authoritative_gr；itemCsvSchema.js、ItemsPage.vue、GoodsReceiptPostingService.js、SupplierRelationService.js；Purchasing HD006 greenfield。
