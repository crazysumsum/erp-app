# Customer Management 測試規格入口

## 1. 正式測試基線

Harness Review後，Customer Management測試案例分為兩份互不混淆的正式規格：

- [`06_technical_test_cases.md`](06_technical_test_cases.md)：Technical／SIT測試，涵蓋API、服務、MySQL、權限、安全、並發、故障恢復、效能及災難復原；`TC-001`～`TC-090`初始狀態均為`PLANNED`。
- [`07_uat_test_cases.md`](07_uat_test_cases.md)：使用者驗收測試，涵蓋業務角色可觀察流程及證據；`UAT-001`～`UAT-058`初始狀態均為`NOT_RUN`，Actual Evidence均為`—`。

本文件只作正式入口，不把Technical Test與UAT合併成同一結果表，也不代表任何案例已被執行。執行測試時不得修改案例意圖或預期結果；實際證據、結果及缺陷應記錄在獨立的測試報告。

## 2. 追溯與驗收規則

- [`08_traceability_matrix.md`](08_traceability_matrix.md)是Requirement → Design → Phase／Task → Technical Test → UAT的正式追溯矩陣。
- P0技術風險必須由Technical／SIT測試證明，不要求業務使用者直接操作資料庫、故障注入或並發barrier。
- UAT只使用頁面、提示、前後資料、下載文件及稽核記錄等使用者可觀察證據。
- 所有P0案例須通過、不得有未關閉S1／S2缺陷；P1案例須已執行或取得Product Owner書面例外，才可進入業務簽核。
- 目前只完成文件對齊，尚未執行應用CI、Technical Test或UAT。

## 3. 執行順序

1. 先按[`tasks.md`](tasks.md)完成對應Phase的實作與Developer Gate。
2. 執行該Phase的Technical／SIT案例並生成獨立測試報告。
3. Technical Gate通過後執行相應UAT案例。
4. 更新追溯與缺陷狀態，完成Phase簽核；高風險核心案例在後續Phase重跑回歸。
