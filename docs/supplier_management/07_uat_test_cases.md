# Supplier Management User Acceptance Test Specification

## 0. 文件控制

| 項目 | 內容 |
| --- | --- |
| Requirement | `01_requirement_spec.md` 1.0 Aligned |
| Design | `03_design_spec.md` 1.0 Aligned |
| Development plan | `05_development_tasks.md` 1.0 Aligned |
| Technical tests | `06_technical_test_cases.md` 1.0 Aligned |
| 日期 | 2026-09-11 |
| 狀態 | 所有案例`NOT_RUN`；本次只設計，不執行 |

## 1. 驗收目標與邊界

UAT由Supplier Clerk、Supplier Manager、Approver、Bank Officer、Settings Administrator、Buyer、Viewer及System Administrator，以實際頁面與業務可理解輸出驗證Supplier建檔、啟用、維護、狀態、審批、銀行資料、SKU關係、匯入／匯出及下游選擇流程。

UAT只採用使用者可觀察證據：畫面、提示、前後狀態、Audit頁、下載檔及下游選擇結果。Migration、FK／unique constraint、加密演算法、lock order、故障注入、worker lease及真MySQL並發由`06_technical_test_cases.md`證明，業務使用者不直接操作資料庫。

範圍外包括採購定價、付款執行、AP對賬、資格文件、供應商評分、多公司及銀行CSV導入。

## 2. 角色與資料基線

| 代號 | 說明 |
| --- | --- |
| CLERK | `supplier.view`＋`supplier.mgmt`，沒有approval、bank或settings |
| VIEWER | 只有`supplier.view` |
| APPROVER-A／B | `supplier.view`＋`supplier.approval`，與建檔人不同 |
| BANK-READER | `supplier.view`＋`supplier.bank.view` |
| BANK-OFFICER | `supplier.view`＋`supplier.bank.view`＋`supplier.bank.mgmt`，使用approved device |
| SETTINGS-ADMIN | `supplier.settings`，使用approved device |
| SYSTEM-ADMIN | 受保護的最高權限break-glass角色；銀行操作仍需同等重新認證、稽核及告警 |
| BUYER | Purchasing授權使用者，只透過正式Supplier lookup選擇供應商 |
| S-DRAFT／S-ACTIVE／S-SUSP／S-BLOCK／S-ARCH | 各狀態Supplier；另準備未引用及已引用資料 |
| CSV-MIXED | 含合法、錯誤、警告、重複及銀行欄位的10列小型CSV |

所有人名、地址、證號、銀行帳號及聯絡資料均使用虛構值。每次驗收記錄build、環境、actor、時間及Correlation ID；完整銀行帳號不可放入截圖、缺陷標題或附件。

## 3. 進入、完成與停止準則

- 進入：對應Phase已部署；Technical P0 gate通過；Business Master Currency／Payment Term及需要的Item／Purchasing providers為READY；測試角色及虛構資料完成。
- 完成：所有P0通過，沒有未關閉S1／S2；所有P1已執行或有Product Owner書面例外；每項FAIL有缺陷ID及重測結果。
- 停止：發現銀行明文外洩、越權、不可逆資料損失、錯誤Supplier可供新交易使用或環境已不可信時立即停止該批次並隔離證據。
- 狀態只可為`NOT_RUN`、`PASS`、`FAIL`、`BLOCKED`或`NOT_APPLICABLE`；未執行前`Actual Evidence`固定為`—`。

## 4. 詳細UAT案例

### 4.1 建檔、搜尋與一般維護

| ID | Priority | Phase | Role | Requirement / AC | Preconditions | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-001 | P0 | PHASE-001 | CLERK | FR-016～FR-023；AC-001 | Business Master有Active Currency | 以唯一Code、名稱、幣別建立Draft，再開詳情及Audit | Draft可搜尋；三個值正確；Create事件可追溯 | 建立成功、詳情、Audit、Correlation ID | — | NOT_RUN |
| UAT-002 | P0 | PHASE-001 | CLERK | FR-017；AC-002 | 已有`SUP-001` | 輸入`sup-001`建立 | 明確拒絕；沒有半完成Supplier | 錯誤提示、列表搜尋前後 | — | NOT_RUN |
| UAT-003 | P1 | PHASE-001 | CLERK | FR-018；AC-003 | 已有相同／相似名稱 | 建立不同Code同名Supplier，檢查候選並確認原因 | 先警告候選；有原因可繼續；不自動合併 | 警告、確認、建立結果、Audit | — | NOT_RUN |
| UAT-004 | P0 | PHASE-001 | CLERK | FR-043；AC-004 | 已有同類型／地區證號 | 以不同格式輸入同一證號 | 明確拒絕且不暴露其他敏感資料 | 錯誤、原Supplier未變 | — | NOT_RUN |
| UAT-005 | P0 | PHASE-001 | CLERK | FR-025；AC-005 | Supplier已被交易引用 | 嘗試修改Code | UI不可用或後端拒絕；舊Code保留 | 畫面、錯誤、重新載入結果 | — | NOT_RUN |
| UAT-006 | P1 | PHASE-001 | CLERK | FR-025～FR-028；AC-006 | 未引用Draft | 重新認證、填原因後改成唯一Code | 新Code保存；before／after及原因可查 | 詳情、Audit | — | NOT_RUN |
| UAT-007 | P1 | PHASE-001 | VIEWER | FR-001～FR-015 | 有多狀態及大量Supplier | 搜尋Code／名稱／聯絡資料，篩選、排序、翻頁、開詳情 | 結果準確、預設不含Archived、頁面總數一致，無銀行明文 | URL filters、列表、詳情 | — | NOT_RUN |
| UAT-008 | P1 | PHASE-001 | CLERK | FR-024～FR-030；NFR-007；AC-038 | 兩個browser讀同一版本 | A保存後B再保存 | B收到衝突且不覆蓋；可重載及複製輸入 | 兩畫面、最終詳情、Audit | — | NOT_RUN |

### 4.2 啟用、審批與狀態

| ID | Priority | Phase | Role | Requirement / AC | Preconditions | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-009 | P0 | PHASE-001 | CLERK | FR-023；AC-007 | Approval OFF；最低欄位完整 | 啟用Draft | 直接成為Active；有啟用Audit | 前後狀態、Audit | — | NOT_RUN |
| UAT-010 | P0 | PHASE-002 | CLERK | FR-052～FR-058；AC-008 | Approval ON；APPROVER-A有效 | 選APPROVER-A提交 | Supplier成為Pending；指定人看到queue | 提交結果、queue、Audit | — | NOT_RUN |
| UAT-011 | P0 | PHASE-002 | CLERK | FR-052；AC-009 | Approval ON | 選自己、無權或停用user逐一提交 | 每次拒絕；Supplier保持Draft | 每種錯誤、狀態 | — | NOT_RUN |
| UAT-012 | P0 | PHASE-002 | APPROVER-A | FR-055；AC-010 | 合法Pending且assigned | 檢查diff後批准 | Supplier Active；提交及批准資訊完整 | queue、詳情、Audit | — | NOT_RUN |
| UAT-013 | P1 | PHASE-002 | APPROVER-A | FR-055；AC-011 | 合法Pending | 輸入原因拒絕 | Supplier回Draft；建檔人可見原因 | 兩角色畫面、Audit | — | NOT_RUN |
| UAT-014 | P0 | PHASE-002 | CLERK/APPROVER-A | FR-057；AC-012 | Pending | CLERK改Code／名稱／幣別，APPROVER-A批准舊申請 | 原申請失效；不能批准；需重新提交 | 修改、失效提示、狀態、Audit | — | NOT_RUN |
| UAT-015 | P1 | PHASE-002 | SETTINGS-ADMIN | FR-063；AC-013 | 有既存Pending | 將Approval ON改OFF並保存原因 | 既存Pending不自動批准；新Supplier走直接啟用 | 設定、兩Supplier狀態、Audit | — | NOT_RUN |
| UAT-016 | P0 | PHASE-001 | CLERK/BUYER | FR-031；AC-014 | Active Supplier | 填原因暫停，再到Purchasing搜尋 | Supplier為Suspended；新採購清單不再顯示；歷史可查 | 狀態、Buyer清單、歷史 | — | NOT_RUN |
| UAT-017 | P0 | PHASE-001 | CLERK | FR-034～FR-035；AC-015 | Blocked Supplier；無approval | 直接解除Block | 後端拒絕；狀態不變 | 錯誤、重新載入狀態 | — | NOT_RUN |
| UAT-018 | P0 | PHASE-001 | APPROVER-A | FR-035；AC-016 | Blocked Supplier | 填原因解除Block | 成為Suspended而非Active | 前後狀態、Audit | — | NOT_RUN |
| UAT-019 | P1 | PHASE-001 | CLERK | FR-036～FR-037；AC-017 | Archived Supplier | 還原，再執行明確啟用 | 先成為Suspended；第二步才可Active | 每一步狀態及Audit | — | NOT_RUN |
| UAT-020 | P0 | PHASE-001 | CLERK | FR-038；AC-018 | 從未啟用且未引用Draft | 重新認證並確認永久刪除 | Supplier不可再查；必要刪除事件可追溯 | 確認、搜尋結果、Audit | — | NOT_RUN |
| UAT-021 | P0 | PHASE-001 | CLERK | FR-038；AC-019 | 曾啟用或已引用 | 嘗試永久刪除 | 拒絕並提示暫停／封鎖／封存選項 | 錯誤、狀態 | — | NOT_RUN |

### 4.3 Children、共用目錄與銀行資料

| ID | Priority | Phase | Role | Requirement / AC | Preconditions | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-022 | P1 | PHASE-001 | CLERK | FR-039～FR-044；AC-020 | 只有最低三欄 | 查看完整度並啟用 | 地址、聯絡人、Term、Identifier、Bank均非必填；只提示不阻擋 | 完整度、啟用結果 | — | NOT_RUN |
| UAT-023 | P1 | PHASE-001 | CLERK | FR-040；AC-021 | 同用途已有primary contact | 將另一聯絡人設primary | 同一用途恰一個primary；舊標記同步取消 | 前後聯絡人列表、Audit | — | NOT_RUN |
| UAT-024 | P1 | PHASE-001 | CLERK/BUYER | FR-020；AC-022 | Payment Term空白 | 啟用後由Buyer選擇 | 啟用成功；Purchasing收到「未設定」而非假預設 | Supplier詳情、Buyer提示 | — | NOT_RUN |
| UAT-025 | P0 | PHASE-003 | VIEWER | FR-046；AC-023 | Supplier有虛構Bank | 查看Bank並嘗試直接完整查看 | 只顯示遮罩；完整查看拒絕且無明文洩漏 | 遮罩畫面、拒絕提示 | — | NOT_RUN |
| UAT-026 | P0 | PHASE-003 | BANK-READER | FR-046, FR-050；AC-024 | Supplier有Bank | 重新認證後主動Reveal | 短暫顯示完整值；30秒／離頁清除；Reveal Audit可查 | 遮罩證據、計時清除、Audit（不得截完整值） | — | NOT_RUN |
| UAT-027 | P0 | PHASE-003 | CLERK/BANK-READER | FR-045；AC-025 | Supplier有Bank | 嘗試新增／修改Bank | 後端拒絕；資料不變 | 錯誤、遮罩列表前後 | — | NOT_RUN |
| UAT-028 | P0 | PHASE-003 | BANK-OFFICER | FR-048；AC-026 | 已有default Bank | 將另一帳戶設為default | 同一操作取消舊default；只剩一個有效default | 前後遮罩列表、Audit | — | NOT_RUN |
| UAT-029 | P1 | PHASE-003 | CLERK/BUYER | FR-051；AC-027 | Supplier無Bank | 啟用並在Purchasing選擇 | 不被Supplier模組阻擋；付款資料缺少只由下游提示 | 啟用、Buyer結果 | — | NOT_RUN |
| UAT-030 | P0 | PHASE-003 | SYSTEM-ADMIN | SEC-005～SEC-014；HD-001 | Break-glass帳號及approved device | 一般查看、Reveal及Bank修改各一次 | 具最高權限；一般畫面仍遮罩；Reveal／write仍重新認證、Audit及告警，不能繞過安全控制 | permission、遮罩、Audit、alert（不得含明文） | — | NOT_RUN |
| UAT-031 | P1 | PHASE-001 | CLERK | FR-020, FR-024；HD-002 | Business Master有Active及inactive值 | 建立／編輯時選值；前往Supplier Settings | 只可選Active；舊inactive值可顯示；Supplier Settings沒有目錄寫入控制 | 表單、詳情、Settings、network | — | NOT_RUN |

### 4.4 Supplier–SKU、Import、Export與權限

| ID | Priority | Phase | Role | Requirement / AC | Preconditions | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-032 | P0 | PHASE-004 | BUYER | FR-065～FR-070；AC-028 | Active Supplier B無SKU relation | 搜尋目標SKU的Supplier | B仍可選；沒有白名單式排除 | 選擇器、排序理由 | — | NOT_RUN |
| UAT-033 | P1 | PHASE-004 | BUYER | FR-067～FR-068；AC-029 | A有歷史／preferred relation | 開啟同SKU選擇器 | A優先顯示並有原因；其他Active仍可選 | 排序列表、理由 | — | NOT_RUN |
| UAT-034 | P0 | PHASE-004 | BUYER | FR-069；AC-030 | Preferred Supplier已Suspended | 開新採購並搜尋 | Supplier不可選，不因preferred繞過狀態 | 選擇器、拒絕提示 | — | NOT_RUN |
| UAT-035 | P1 | PHASE-004 | BUYER | FR-066；AC-031 | Active Supplier無relation | 完成一次採購並回到Supplier／SKU畫面 | 建立軟性relation／last supplied資訊；Supplier狀態不變 | PO結果、relation、Supplier狀態 | — | NOT_RUN |
| UAT-036 | P0 | PHASE-004 | CLERK/BUYER | FR-030；AC-032 | 已有PO快照 | 修改Supplier defaults後看舊PO | 舊PO保留原Currency／Term；新選擇帶新default | 舊／新文件對照 | — | NOT_RUN |
| UAT-037 | P0 | PHASE-004 | CLERK | FR-071～FR-079；AC-033 | CSV-MIXED | 上傳、預檢、確認、下載結果 | 合法列完整寫入；錯誤列不寫；逐列結果與總數一致 | 四步畫面、結果CSV、Supplier搜尋 | — | NOT_RUN |
| UAT-038 | P0 | PHASE-004 | CLERK | FR-073；AC-034 | CSV含Bank header/value | 預檢 | 明確拒絕敏感欄位；沒有Supplier Bank資料寫入 | 預檢錯誤、Bank遮罩列表 | — | NOT_RUN |
| UAT-039 | P0 | PHASE-004 | CLERK | FR-077；AC-035 | 已完成confirm | 雙擊或重送同一確認 | 只建立一次；回相同job outcome | 畫面、job結果、Supplier搜尋 | — | NOT_RUN |
| UAT-040 | P0 | PHASE-002 | CLERK | FR-059；AC-036 | 無settings權限 | 直接導航並嘗試更新setting | 頁面／API拒絕；值不變 | route、network、Settings由有權人核對 | — | NOT_RUN |
| UAT-041 | P1 | PHASE-002 | SETTINGS-ADMIN | FR-060～FR-064；AC-037 | approved device | 開啟approval，填原因保存，再建Supplier | 新提交走approval；設定before／after及原因可查 | Settings、提交、Audit | — | NOT_RUN |
| UAT-042 | P0 | PHASE-001 | VIEWER | SEC-001～SEC-009；AC-039 | 只有view／無Supplier權限兩種帳號 | 從UI及直接URL／request嘗試寫入 | 不能寫；無資料或Audit副作用；不洩漏目標存在性 | route、network、重新載入結果 | — | NOT_RUN |
| UAT-043 | P0 | PHASE-004 | VIEWER | FR-007, FR-080, FR-087；AC-040 | Supplier含Bank及CSV公式字首文字 | 匯出並以安全viewer開啟 | 不含完整Bank／內部密文；危險儲存格安全；Export Audit可查 | 欄位清單、redacted CSV、Audit | — | NOT_RUN |

### 4.5 營運品質與復原

| ID | Priority | Phase | Role | Requirement / AC | Preconditions | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-044 | P1 | PHASE-004 | 營運代表 | NFR-001～NFR-005 | Technical performance report已通過 | 在代表資料量下執行搜尋、SKU選擇及10k import | 畫面可持續操作；一般及精確查詢p95<2秒；10k import≤10分鐘 | 使用者畫面＋已簽 technical report | — | NOT_RUN |
| UAT-045 | P0 | PHASE-004 | 營運／DR owner | NFR-009, NFR-011 | 隔離restore完成 | 登入restore環境，抽查Supplier、Bank遮罩、Audit及Import結果 | 資料一致；RTO≤4小時、RPO≤15分鐘；缺key時不得宣稱成功 | timestamp、對賬、redacted smoke | — | NOT_RUN |
| UAT-046 | P1 | PHASE-004 | 各業務角色 | NFR-006～NFR-010 | 候選build | 重送主要操作、模擬依賴不可用後重試 | 無重複／矛盾結果；不錯誤開放Supplier；恢復後可繼續 | Correlation IDs、前後狀態、營運提示 | — | NOT_RUN |
| UAT-047 | P1 | PHASE-001～004 | 鍵盤使用者 | NFR-006；frontend-design | 375／768／1440px | 僅鍵盤完成各Phase happy path並檢查loading/empty/error | Focus可見、label／error可理解、狀態不只靠顏色、無阻擋性console／network錯誤 | Playwright screenshots/trace、console/network | — | NOT_RUN |

### 4.6 主資料維護、控制與稽核補充

| ID | Priority | Phase | Role | Requirement / AC | Preconditions | User Steps | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-048 | P1 | PHASE-001 | CLERK | FR-039～FR-042；AC-020～AC-021 | Active Supplier；已有一個primary address | 新增不同用途地址、設primary、調整順序，再停用其中一個 | 同用途可有多地址且恰一個有效primary；排序保存；停用保留歷史且不供新選擇 | Address列表前後、詳情、Audit | — | NOT_RUN |
| UAT-049 | P1 | PHASE-001 | CLERK | FR-039～FR-042, FR-044；AC-020～AC-021 | Active Supplier；已有採購聯絡人 | 新增同用途第二位聯絡人、切換primary並停用舊聯絡人 | 每用途可有多人；primary原子切換；停用資料保留但不再作預設 | Contact列表前後、詳情、Audit | — | NOT_RUN |
| UAT-050 | P0 | PHASE-001 | CLERK | FR-043～FR-044；AC-004 | Supplier各有一個未引用及已被交易引用的虛構Identifier | 建立及修改未引用Identifier，再刪除；嘗試刪除已引用Identifier；最後建立normalized duplicate | 未引用資料可受控刪除；已引用資料拒絕刪除並保留歷史；duplicate被拒絕且不洩漏其他Supplier資料 | Identifier前後、兩類錯誤／結果、Audit | — | NOT_RUN |
| UAT-051 | P0 | PHASE-001 | APPROVER-A | FR-032～FR-038；AC-015～AC-019 | Supplier有未完成採購或其他open matter | 填原因執行Block，再嘗試Archive；清除open matter後重試Archive | Block立即阻止新交易；第一次Archive列出具名阻擋，第二次成功且歷史仍可查 | 狀態、下游提示、阻擋清單、Audit | — | NOT_RUN |
| UAT-052 | P0 | PHASE-002 | CLERK/APPROVER-A | FR-056～FR-057；AC-012 | 一筆assigned Pending申請 | Requester撤回；重新提交後由有權人填原因重新指派，再由新assigned approver決定 | 撤回回Draft；reassign完整留痕；舊assigned不能決定，新assigned可合法完成 | Queue、詳情、權限錯誤、Audit | — | NOT_RUN |
| UAT-053 | P0 | PHASE-003 | BANK-OFFICER | FR-045～FR-051；SEC-005～SEC-013；AC-023～AC-027 | 已重新認證；Supplier有被付款流程引用及未引用Bank各一 | 新增、修改、設default、停用未引用帳戶，再嘗試刪除／停用被引用帳戶 | 所有明文只在必要輸入／Reveal短暫出現；合法操作成功；被引用資料不可永久刪除且歷史完整 | 遮罩列表、操作結果、拒絕提示、Audit（不得含明文） | — | NOT_RUN |
| UAT-054 | P1 | PHASE-001 | VIEWER | FR-001～FR-010 | 分別準備慢回應、零結果、依賴錯誤及無權帳號 | 開啟Supplier列表並依次觸發loading、empty、error、no-permission | 四種狀態文案與可行動項明確不同；error可安全重試；無資料外洩或假成功 | 每種畫面、console/network | — | NOT_RUN |
| UAT-055 | P1 | PHASE-001～004 | VIEWER/AUDITOR | FR-081～FR-087 | Supplier具有create、status、Bank reveal、approval及import audit | 依日期、actor、action及target篩選Audit並開啟詳情 | 篩選結果準確、可分頁追溯；敏感值保持redacted；每筆有request／correlation識別 | Filter URL、結果、Audit detail | — | NOT_RUN |

## 5. Canonical requirement coverage manifest

下列FR透過`01_requirement_spec.md`alias映射至上述AC／UAT及業務流程；每項FR至少由一個UAT案例覆蓋。SEC／NFR中純技術控制可由UAT觀察其結果，底層證據仍來自Technical Tests。

- FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087.
- NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011.
- SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014.

## 6. Phase驗收與簽核

| Batch | Scope | P0 core regression | Business sign-off |
| --- | --- | --- | --- |
| UAT Batch 1 | PHASE-001：UAT-001～009, UAT-016～024, UAT-042, UAT-047～051, UAT-054～055 | Code uniqueness、主資料子項、狀態資格、reference guard、越權、concurrency | Supplier Operations Owner |
| UAT Batch 2 | PHASE-002：UAT-010～015, UAT-040～041, UAT-052 | SoD、撤回／重新指派、stale approval、setting不追溯 | Supplier Operations＋Control Owner |
| UAT Batch 3 | PHASE-003：UAT-025～030, UAT-053 | 遮罩、Reveal、Bank lifecycle／reference guard、system-admin受控操作 | Finance/Bank Data Owner＋Security |
| UAT Batch 4 | PHASE-004：UAT-031～039, UAT-043～047, UAT-055及全回歸 | Active Supplier eligibility、Bank不外洩、Import重送、restore | Product Owner＋Operations＋QA |

每次簽核記錄build／commit、環境、執行日期、PASS／FAIL／BLOCKED統計、未關缺陷、例外接受人及最終GO／NO-GO。本文件沒有execution evidence，因此目前不能作任何release recommendation。


---

# Appendix A — Harness 2.0 Formal UAT Definitions

下列formal definitions與§4的55個使用者案例一對一；表格row仍是角色、步驟、預期及證據的完整來源。

## UAT-001 — Detailed business scenario UAT-001

### Business objective and actor

由§4案例`UAT-001`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-001`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-001`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-001`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-002 — Detailed business scenario UAT-002

### Business objective and actor

由§4案例`UAT-002`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-002`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-002`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-002`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-003 — Detailed business scenario UAT-003

### Business objective and actor

由§4案例`UAT-003`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-003`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-003`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-003`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-004 — Detailed business scenario UAT-004

### Business objective and actor

由§4案例`UAT-004`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-004`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-004`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-004`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-005 — Detailed business scenario UAT-005

### Business objective and actor

由§4案例`UAT-005`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-005`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-005`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-005`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-006 — Detailed business scenario UAT-006

### Business objective and actor

由§4案例`UAT-006`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-006`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-006`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-006`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-007 — Detailed business scenario UAT-007

### Business objective and actor

由§4案例`UAT-007`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-007`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-007`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-007`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-008 — Detailed business scenario UAT-008

### Business objective and actor

由§4案例`UAT-008`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-008`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-008`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-008`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-009 — Detailed business scenario UAT-009

### Business objective and actor

由§4案例`UAT-009`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-009`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-009`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-009`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-010 — Detailed business scenario UAT-010

### Business objective and actor

由§4案例`UAT-010`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-010`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-010`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-010`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-011 — Detailed business scenario UAT-011

### Business objective and actor

由§4案例`UAT-011`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-011`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-011`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-011`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-012 — Detailed business scenario UAT-012

### Business objective and actor

由§4案例`UAT-012`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-012`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-012`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-012`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-013 — Detailed business scenario UAT-013

### Business objective and actor

由§4案例`UAT-013`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-013`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-013`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-013`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-014 — Detailed business scenario UAT-014

### Business objective and actor

由§4案例`UAT-014`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-014`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-014`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-014`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-015 — Detailed business scenario UAT-015

### Business objective and actor

由§4案例`UAT-015`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-015`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-015`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-015`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-016 — Detailed business scenario UAT-016

### Business objective and actor

由§4案例`UAT-016`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-016`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-016`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-016`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-017 — Detailed business scenario UAT-017

### Business objective and actor

由§4案例`UAT-017`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-017`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-017`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-017`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-018 — Detailed business scenario UAT-018

### Business objective and actor

由§4案例`UAT-018`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-018`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-018`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-018`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-019 — Detailed business scenario UAT-019

### Business objective and actor

由§4案例`UAT-019`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-019`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-019`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-019`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-020 — Detailed business scenario UAT-020

### Business objective and actor

由§4案例`UAT-020`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-020`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-020`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-020`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-021 — Detailed business scenario UAT-021

### Business objective and actor

由§4案例`UAT-021`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-021`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-021`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-021`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-022 — Detailed business scenario UAT-022

### Business objective and actor

由§4案例`UAT-022`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-022`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-022`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-022`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-023 — Detailed business scenario UAT-023

### Business objective and actor

由§4案例`UAT-023`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-023`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-023`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-023`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-024 — Detailed business scenario UAT-024

### Business objective and actor

由§4案例`UAT-024`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-024`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-024`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-024`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-025 — Detailed business scenario UAT-025

### Business objective and actor

由§4案例`UAT-025`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-025`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-025`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-025`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-026 — Detailed business scenario UAT-026

### Business objective and actor

由§4案例`UAT-026`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-026`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-026`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-026`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-027 — Detailed business scenario UAT-027

### Business objective and actor

由§4案例`UAT-027`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-027`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-027`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-027`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-028 — Detailed business scenario UAT-028

### Business objective and actor

由§4案例`UAT-028`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-028`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-028`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-028`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-029 — Detailed business scenario UAT-029

### Business objective and actor

由§4案例`UAT-029`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-029`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-029`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-029`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-030 — Detailed business scenario UAT-030

### Business objective and actor

由§4案例`UAT-030`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-030`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-030`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-030`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-031 — Detailed business scenario UAT-031

### Business objective and actor

由§4案例`UAT-031`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-031`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-031`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-031`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-032 — Detailed business scenario UAT-032

### Business objective and actor

由§4案例`UAT-032`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-032`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-032`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-032`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-033 — Detailed business scenario UAT-033

### Business objective and actor

由§4案例`UAT-033`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-033`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-033`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-033`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-034 — Detailed business scenario UAT-034

### Business objective and actor

由§4案例`UAT-034`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-034`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-034`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-034`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-035 — Detailed business scenario UAT-035

### Business objective and actor

由§4案例`UAT-035`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-035`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-035`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-035`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-036 — Detailed business scenario UAT-036

### Business objective and actor

由§4案例`UAT-036`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-036`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-036`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-036`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-037 — Detailed business scenario UAT-037

### Business objective and actor

由§4案例`UAT-037`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-037`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-037`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-037`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-038 — Detailed business scenario UAT-038

### Business objective and actor

由§4案例`UAT-038`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-038`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-038`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-038`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-039 — Detailed business scenario UAT-039

### Business objective and actor

由§4案例`UAT-039`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-039`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-039`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-039`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-040 — Detailed business scenario UAT-040

### Business objective and actor

由§4案例`UAT-040`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-040`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-040`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-040`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-041 — Detailed business scenario UAT-041

### Business objective and actor

由§4案例`UAT-041`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-041`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-041`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-041`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-042 — Detailed business scenario UAT-042

### Business objective and actor

由§4案例`UAT-042`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-042`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-042`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-042`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-043 — Detailed business scenario UAT-043

### Business objective and actor

由§4案例`UAT-043`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-043`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-043`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-043`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-044 — Detailed business scenario UAT-044

### Business objective and actor

由§4案例`UAT-044`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-044`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-044`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-044`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-045 — Detailed business scenario UAT-045

### Business objective and actor

由§4案例`UAT-045`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-045`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-045`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-045`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-046 — Detailed business scenario UAT-046

### Business objective and actor

由§4案例`UAT-046`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-046`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-046`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-046`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-047 — Detailed business scenario UAT-047

### Business objective and actor

由§4案例`UAT-047`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-047`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-047`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-047`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。


## UAT-048 — Detailed business scenario UAT-048

### Business objective and actor

由§4案例`UAT-048`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-048`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-048`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-048`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-049 — Detailed business scenario UAT-049

### Business objective and actor

由§4案例`UAT-049`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-049`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-049`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-049`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-050 — Detailed business scenario UAT-050

### Business objective and actor

由§4案例`UAT-050`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-050`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-050`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-050`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-051 — Detailed business scenario UAT-051

### Business objective and actor

由§4案例`UAT-051`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-051`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-051`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-051`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-052 — Detailed business scenario UAT-052

### Business objective and actor

由§4案例`UAT-052`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-052`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-052`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-052`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-053 — Detailed business scenario UAT-053

### Business objective and actor

由§4案例`UAT-053`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-053`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-053`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-053`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-054 — Detailed business scenario UAT-054

### Business objective and actor

由§4案例`UAT-054`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-054`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-054`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-054`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。

## UAT-055 — Detailed business scenario UAT-055

### Business objective and actor

由§4案例`UAT-055`指定的業務角色，驗收該row的Requirement／AC所代表的使用者成果。

### Preconditions and data

使用`UAT-055`row的Preconditions及§2虛構資料基線；Technical readiness未滿足時標記BLOCKED。

### Steps

完整執行`UAT-055`row的User Steps；UI_BROWSER案例依AGENTS.md使用Playwright保存可重現證據。

### Expected business result

以`UAT-055`row的Expected Result判定，並從頁面、提示、下游結果、文件或Audit等使用者可觀察證據核對。

### Acceptance criteria

- Required Evidence完整且不含銀行明文；結果由實際業務驗收者綁定candidate簽核，automation PASS不代替business acceptance。
