# 2026 年 11 月 ERP 使用者驗收預演

11/23 以全新預演庫從報價走到收款及核銷，並從採購單走到分批收貨。兩條流程在同一個版本完成 **17/17 步**。正式驗收預定在 11/26，由驗收人使用 11/25 另建的資料庫執行。

| 預演範圍 | 實際部署版本 | 實測結果 |
|---|---|---|
| S01–S07 銷售及出貨 | `d434d74c1f20ff707a8c9da1c4e1249930348359` | 銷售單 HKD 325，兩批出貨完成，A1 合計 48 EA、C1 合計 10 EA。 |
| S08–S12 發票、收款、核銷、帳齡 | 同上 | 發票 HKD 225 及 100，全數核銷至一筆 HKD 325 收款。帳齡查無未收款。[應收對帳](evidence/S10-S12-388-readback.json) |
| P01–P05 採購及收貨 | 同上 | PO-202611-000001 經另一帳號審批。兩批入庫，A1 合計 48 EA，B2 分批 60、40 EA。 [尾批對帳](evidence/390-P05-verified.json) |
| #391、#392 合併後再次執行 P01–P05 | `c6df403e10d9bca2964c83cc15c0e546a4d6912b` | 同庫另建 PO-202611-000003。GR-202611-000004、000005 各有兩筆入庫異動。兩次預期拒絕皆保持庫存及異動數量。[首批](evidence/final-smoke-P03-confirmed.json) · [尾批](evidence/final-smoke-P05-verified.json) |

#391 已透過實際瀏覽器核對供應商正式名稱、封鎖提示、更換供應商並儲存後提交。#392 的未完成採購查詢在部分收貨後仍依有未收量的明細交期篩選。無行交期時採用表頭交期。全部收貨、取消及關閉餘量後均排除。[部分收貨](evidence/final-smoke-392-partial.json) · [全部收貨](evidence/final-smoke-392-complete.json) · [取消](evidence/final-smoke-392-cancel.json) · [關閉餘量](evidence/final-smoke-392-close-remaining.json)

另已覆核短揀後補出貨、報價取消、採購撤回並再審、部分核銷、解除核銷後作廢重開、收貨批效及超收檢核，並以七個業務帳號抽查 61 項權限界線。UAT-001、002、003 已關閉。[已知限制及操作方式](known-limits.md)

## 重做預演

1. 在隔離的本機 UAT 目錄依八步清單建立資料庫、應用及私有檔案區。八個帳號各使用獨立瀏覽器設定檔。11/23 建立空庫至期初及備份共 4 分 30 秒，正式建庫及人工交接預留 45 分鐘。[建庫與登入操作卡](preparation/formal-20261125-checklist.md) · [空庫基線](evidence/acceptance-baseline.json) · [建庫時間戳](evidence/times.jsonl)
2. 將本目錄的 `preparation/` 複製至獨立預演環境，其上層包含應用副本 `app/`、私有設定 `private/` 和本次輸出的空 `evidence/`。服務管理腳本沿用預演路徑 `erp-uat/retests/full-d434d74c/`，將 `operations/uat-services.py` 放在該環境的 `erp-uat/preparation/`。應用依 lockfile 安裝依賴，本機使用 Chrome 與 Playwright。帳號檔和裝置設定在驗收機器建立及保管。
3. 依角色載入合成樣本。01 是貨品，02、03 是有效及無效期初檔，04、05 是客戶及供應商，06 是倉庫及庫位輸入清單。先驗證無效期初零異動，再驗證有效期初 8 筆、552 EA。[庫存操作](preparation/inventory-instructions.md) · [業務角色權限](preparation/roles.json)
4. 按操作卡逐步執行，記下本次單據編號並代入下一步。例如 `node preparation/order-steps.cjs S01` 建報價，再以本次報價 ID 執行 S02。首批 P03 依序以 `node preparation/receive.cjs new 1`、`post 1`、`check 1` 建立、過帳及對帳，P05 的批次參數為 2。腳本中的樣本 ID 與既有結果對應 11/23 指定的預演資料，重演前請先核對。[Playwright 操作卡](preparation/playwright-steps.md) · [實跑操作與時間戳](evidence/scenario-times.jsonl)

`evidence/` 保存合成測試單據的對帳結果及時間戳。每次重做預演時以新的證據目錄保存該次結果。正式驗收用當時部署的完整 SHA 及當次單據另行記錄。

11/24 在含 #393 的版本補驗兩倉批次出貨，並以貨品範本確認分類與品牌的建檔前置。兩倉另計，見 [補驗結果](20261124-rehearsal.md)。
