# 用戶、角色與權限管理測試案例

## 文件資訊

| 項目 | 內容 |
| --- | --- |
| 需求來源 | `docs/user_management/design_spec.md` |
| 測試階段 | 測試設計，尚未執行 |
| 初始狀態 | 所有案例均為 `NOT RUN` |
| 目標環境 | 待執行前確認；交易、外鍵、migration 與並發案例須使用隔離的真實 MySQL 測試環境 |
| Build / Commit | 待執行前記錄 |

> 本文件只定義測試案例，不代表功能已通過驗證。涉及停用、刪除、提權、migration、資料庫故障與 break-glass 的案例，禁止對正式環境或共用真實帳號執行。

## 測試資料基線

| 代號 | 測試資料 |
| --- | --- |
| A0 | 啟用中的 `system-admin`；擁有 `user.mgmt`、`role.mgmt`、`device.mgmt`；設備已核准；密碼有效 |
| A1 | 啟用中的管理員；只有 `user.mgmt`；設備已核准；密碼有效 |
| A2 | 啟用中的管理員；只有 `role.mgmt`；設備已核准；密碼有效 |
| A3 | 啟用中的一般用戶；沒有管理權限 |
| U1 | 啟用中的一般用戶；至少有兩個來自不同設備的有效 token |
| U2 | 已停用用戶；`failed_login_attempts > 0`、`locked_until` 非 NULL |
| U3 | 臨時密碼未過期且 `must_change_password = 1` 的用戶 |
| R0 | 受保護的 `system-admin` 角色 |
| R1 | 權限集合 `{user.mgmt}` 的一般角色，至少一名用戶持有 |
| R2 | 權限集合 `{role.mgmt}` 的一般角色 |
| R3 | 無權限、無持有人的一般角色 |
| PWD-VALID | 12–200 字元，至少含一個大寫與一個小寫英文字母，例如 `ValidPassword` |
| REASON | 5–190 字元，例如 `QA permission change verification` |

## 需求追蹤矩陣

| Requirement / Risk | Priority | Test Case IDs | Latest Result | Defect IDs | Coverage Note |
| --- | --- | --- | --- | --- | --- |
| RQ-01 權限目錄唯讀且程式、DB、route 與 page 必須一致 | P0 | IAM-001～IAM-006 | NOT RUN | — | migration、啟動守衛、寫入入口與約定 |
| RQ-02 管理端點須依即時權限與正確認證層級授權 | P0 | AUTH-001～AUTH-007 | NOT RUN | — | 未登入、權限矩陣、stale claim、設備撤銷 |
| RQ-03 不得授出自身沒有的權限，且不可失去最後管理員 | P0 | GUARD-001～GUARD-010 | NOT RUN | — | 提權、降權、受保護角色、CAS 與並發 |
| RQ-04 用戶管理須保持狀態、憑證與資料一致 | P1 | USER-001～USER-012 | NOT RUN | — | CRUD、唯一性、停用、啟用、角色覆蓋 |
| RQ-05 角色管理須符合保護、覆蓋與級聯規則 | P1 | ROLE-001～ROLE-008 | NOT RUN | — | CRUD、空角色、唯一性、CASCADE 與陣列限制 |
| RQ-06 密碼、臨時密碼、首次改密碼及設備簽章正確生效 | P0 | PWD-001～PWD-012 | NOT RUN | — | 三條密碼路徑、72 小時、mcp gate、重放 |
| RQ-07 稽核須原子提交、可查詢且不得洩漏憑證 | P0 | AUD-001～AUD-009 | NOT RUN | — | 交易、欄位、截斷、篩選、保留與敏感資訊 |
| RQ-08 分頁、搜尋與排序正確且不形成 SQL 注入 | P1 | LIST-001～LIST-006 | NOT RUN | — | 邊界、total、跳脫、白名單與已知限制 |
| RQ-09 前端須正確呈現權限、風險、強制改密碼及衝突 | P1 | UI-001～UI-010 | NOT RUN | — | 路由、菜單、對話框、提示與 service 翻譯 |
| RQ-10 migration、部署及 break-glass 可重跑與復原 | P1 | OPS-001～OPS-007 | NOT RUN | — | 半途失敗、重跑、單節點部署、救援與回滾 |

## 一、權限目錄與啟動守衛

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IAM-001 | P0 | RQ-01；權限改名不得破壞授權關聯 | Migration/DB | 舊 DB 含 `device.approve` 與既有 role 關聯 | 舊 permission id、關聯列數 | 執行 `0005` 後查 permission 與關聯 | 名稱為 `device.mgmt`；id、關聯數與指向不變 | migration 輸出、前後 SQL 快照 | — | NOT RUN |
| IAM-002 | P1 | RQ-01；改名 migration 冪等 | Migration/DB | `0005` 已執行 | 已含 `device.mgmt` 的 DB | 再執行 `0005` | 成功收斂；無重複 permission；關聯不變 | 第二次輸出、SQL 快照 | — | NOT RUN |
| IAM-003 | P0 | RQ-01；目錄缺項不可帶病啟動 | Startup | DB 缺 catalogue 項目 | 缺 `user.mgmt` | 啟動 application | 啟動失敗且指出缺項；不自動補資料 | 日誌、exit code、DB 前後快照 | — | NOT RUN |
| IAM-004 | P1 | RQ-01；DB 多餘權限只警告 | Startup | DB 多 catalogue 未定義項目 | `legacy.permission` | 啟動 application | 啟動成功並 warn；DB 不變 | 日誌、DB 快照 | — | NOT RUN |
| IAM-005 | P2 | RQ-01；description 差異只警告 | Startup | 同名 permission 描述不同 | `user.mgmt` 不同描述 | 啟動 application | 啟動成功並 warn；授權仍按 name；不自動修復 | 日誌、DB 快照 | — | NOT RUN |
| IAM-006 | P0 | RQ-01；不得存在 permission 寫入入口或授權字串漂移 | Contract/Security | 可列舉 routes/pages | 全部 handlers/pages | 檢查 permissions route、permission 字串、`hasRole`、`requires.roles`、豁免路徑 | 只有 GET permissions；字串都在 catalogue；不以角色名授權；四條豁免對應真實 route | route 清單、約定測試輸出 | — | NOT RUN |

## 二、認證與授權矩陣

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-001 | P0 | RQ-02；管理 API 不得匿名存取 | API/Security | 無 token | 規格的 16 支 API | 對每支送出最小合法 request，不帶 JWT | 全部拒絕且無 DB、token、audit 副作用 | request/response、DB 快照 | — | NOT RUN |
| AUTH-002 | P0 | RQ-02；`user.mgmt` 權限邊界 | API/Security | A1 token 有效 | 用戶、角色、permission、audit API | A1 逐一呼叫 | 用戶與 audit 端點依額外認證通過；角色與 permission 端點 403 | request/response、授權日誌 | — | NOT RUN |
| AUTH-003 | P0 | RQ-02；`role.mgmt` 權限邊界 | API/Security | A2 token 有效 | 同上 | A2 逐一呼叫 | 角色、permission、audit 依額外認證通過；用戶端點 403 | request/response、授權日誌 | — | NOT RUN |
| AUTH-004 | P0 | RQ-02；audit 使用 `match:any` | API/Security | A1、A2、A3 token 有效 | 三類操作者 | 分別 GET audit/logs | A1、A2 可讀；A3 為 403 | request/response | — | NOT RUN |
| AUTH-005 | P0 | RQ-02；管理權限收回即刻生效 | API/Security | token 帶舊 claim；DB 已移除 permission | A1 或 A2 舊 token | 呼叫對應管理端點 | 403 `PERMISSION_STALE`；無業務及 audit 變更 | response、DB/audit 快照 | — | NOT RUN |
| AUTH-006 | P0 | RQ-02；各端點認證層級不可配置錯誤 | API/Contract | 可取得 route metadata | §3.1 matrix | 驗證每支 route authType | 四支提權為 jwt-device-password；四支斷存取為 jwt-password；其餘 jwt | route metadata、認證測試輸出 | — | NOT RUN |
| AUTH-007 | P0 | RQ-02；設備撤銷後不得提權 | API/Security | A0 設備已撤銷；JWT/密碼有效 | 四支提權端點 | 以撤銷設備簽章呼叫 | 全部拒絕並辨識為設備問題；無副作用 | response、device/DB/audit 快照 | — | NOT RUN |

## 三、提權防護與並發

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GUARD-001 | P0 | RQ-03；A1 不可把自己升為 system-admin | API/Security | A1、R0、核准設備 | 自己 user id、現有角色 | assign R0 給自己 | 403 `PERMISSION_ESCALATION_DENIED`；角色不變 | response、user_roles/audit 快照 | — | NOT RUN |
| GUARD-002 | P0 | RQ-03；A1 不可替他人授予超範圍角色 | API/Security | A1、目標用戶、R2 | expected 與新角色集合 | assign R2 給目標 | 403 `PERMISSION_ESCALATION_DENIED`；資料不變 | response、DB/audit 快照 | — | NOT RUN |
| GUARD-003 | P0 | RQ-03；A2 不可替角色加自身沒有的權限 | API/Security | A2 持有一般角色 | 新增 `user.mgmt` | permissions/assign | 403 `PERMISSION_ESCALATION_DENIED`；資料不變 | response、DB/audit 快照 | — | NOT RUN |
| GUARD-004 | P1 | RQ-03；降權不受包含規則誤擋 | API/Security | 目標持有 A1 沒有的 R2 | 移除 R2 | A1 覆蓋目標角色集合 | 成功移除；audit before/after 正確 | response、user_roles/audit | — | NOT RUN |
| GUARD-005 | P0 | RQ-03；system-admin 角色不可改或刪 | API/Security | A0、R0 | update/delete/assign requests | 對 R0 改名、描述、刪除、覆蓋權限 | 全部 409 `ROLE_PROTECTED`；無變更 | responses、roles/permissions/audit 快照 | — | NOT RUN |
| GUARD-006 | P0 | RQ-03；最後 active admin 不可停用 | API/DB | 隔離資料只剩一名 active admin | 最後 admin、REASON | disable | 409 `LAST_ADMIN_PROTECTED`；仍 active；token 不被撤銷 | response、users/revocation/audit | — | NOT RUN |
| GUARD-007 | P0 | RQ-03；最後 admin 不可移除 R0 | API/DB | 隔離資料只剩一名 active admin | 新集合不含 R0 | roles/assign | 409 `LAST_ADMIN_PROTECTED`；關聯不變 | response、user_roles/audit | — | NOT RUN |
| GUARD-008 | P0 | RQ-03；最後管理員保護需並發安全 | Concurrency/DB | 恰兩名 active admin；真 MySQL | 同步 barrier | 同時停用兩人 | 只能一個成功；另一個 409；最終仍有一名 active admin | responses、交易日誌、最終 SQL | — | NOT RUN |
| GUARD-009 | P0 | RQ-03；用戶角色 CAS 防止舊畫面覆蓋 | Concurrency/API | 兩 session 載入同一用戶 | 相同 expected、不同新集合 | A 先儲存，B 用舊 expected 儲存 | A 成功；B 409 `ASSIGNMENT_STALE`；DB 為 A 完整集合 | responses、DB/audit | — | NOT RUN |
| GUARD-010 | P0 | RQ-03；角色權限 CAS 防止遺失更新 | Concurrency/DB | 兩 session 載入同一角色；真 MySQL | 相同 expected、不同新集合 | 送出兩次覆蓋 | 一個成功；另一個 409；DB 無混合集合 | responses、交易與 DB/audit | — | NOT RUN |

## 四、用戶管理

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| USER-001 | P1 | RQ-04；建立用戶完整寫入初始狀態 | API/DB | A0 已登入且設備核准 | 合法 username/displayName/PWD/roles | POST users/create | active；username trim；角色完整；只存 hash；mcp=1；到期約 now+72h；有 audit | response、users/roles/audit SQL | — | NOT RUN |
| USER-002 | P1 | RQ-04；username 唯一性不分大小寫 | API/DB | 已有 `Sam` | `sam` | 建立第二名 | 409 `USERNAME_TAKEN`；無新資料/audit | response、DB 快照 | — | NOT RUN |
| USER-003 | P1 | RQ-04；username 邊界與字元限制 | Validation | A0 | 長度 2/3/190/191；外圍空白；Unicode/非法符號 | 逐組建立 | 3、190 合法；2、191、非法字元拒絕；只 trim 外圍 | responses、成功 DB 值 | — | NOT RUN |
| USER-004 | P1 | RQ-04；username 建立後不可修改 | Validation | U1 存在 | update 帶 username | POST users/:id/update | 400；username/displayName 不變；無 audit | response、DB/audit 快照 | — | NOT RUN |
| USER-005 | P2 | RQ-04；displayName 可更新並稽核 | API/DB | A1、U1 | 新 displayName | update | 僅 displayName 更新；audit before/after 正確 | response、users/audit | — | NOT RUN |
| USER-006 | P1 | RQ-04；不存在用戶固定錯誤 | API | A1 | 不存在 id | 查、改、停/啟用、配角色、重設 | 相關端點 404 `USER_NOT_FOUND`；無副作用 | responses、DB/audit 快照 | — | NOT RUN |
| USER-007 | P0 | RQ-04；停用立即撤銷全部 token 且不硬刪除 | API/DB/Security | U1 有兩 token | REASON、A0 密碼 | disable 後用兩 token 呼叫受保護 API | user 保留但 disabled；全部 token 即刻失效；一筆 audit | responses、users/revocation/audit | — | NOT RUN |
| USER-008 | P0 | RQ-04；撤銷失敗不可改狀態 | Failure/Transaction | 可注入 revoke failure | U1 | disable 並令 revoke 失敗 | 請求失敗；U1 仍 active；無 audit；可重試 | error、DB/audit、重試證據 | — | NOT RUN |
| USER-009 | P1 | RQ-04；撤銷成功但 DB 失敗落在安全側 | Failure/Transaction | revoke 成功；DB/audit 寫入失敗 | U1 | disable；修復後重試 | 第一次 user 仍 active、token 已撤銷、交易回滾；重試成功 | logs、DB/revocation/audit | — | NOT RUN |
| USER-010 | P1 | RQ-04；啟用清鎖定與失敗次數 | API/DB | U2 | REASON、A0 密碼 | enable | active；attempts=0；locked_until=NULL；audit 正確；不額外 revoke | response、users/audit/revocation | — | NOT RUN |
| USER-011 | P1 | RQ-04；角色覆蓋支援空集合及未知角色錯誤 | API/DB | A0、U1 | `[]`、不存在 id、null、重複 id | 分別 assign | 空集合可清空；未知 id 400 `UNKNOWN_ROLE`；null/重複 400；無部分寫入 | responses、user_roles/audit | — | NOT RUN |
| USER-012 | P1 | RQ-04；角色陣列數量與元素邊界 | Validation | A0、U1 | 50/51 項；0/負數/非整數 | roles/assign | 50 可進業務驗證；51 或非正整數 400；無部分寫入 | responses、DB 快照 | — | NOT RUN |

## 五、角色與權限配置

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ROLE-001 | P1 | RQ-05；角色清單含權限與持有人數 | API/DB | A2、R0～R3 | 已知關聯 | GET roles | 回全部角色（上限 200），權限集合與 user count 正確，不分頁 | response、對照 SQL | — | NOT RUN |
| ROLE-002 | P1 | RQ-05；新角色初始無權限 | API/DB | A2 | 合法唯一名稱/描述 | roles/create | 建立成功；role_permissions 空；audit 正確 | response、DB/audit | — | NOT RUN |
| ROLE-003 | P1 | RQ-05；角色名稱唯一衝突 | API/DB | 已有 R1 | 相同名稱及大小寫變體 | create 及 update | 409 `ROLE_NAME_TAKEN`；原資料不變 | responses、DB/audit | — | NOT RUN |
| ROLE-004 | P2 | RQ-05；一般角色可改名稱/描述 | API/DB | A2、R3 | 新名稱/描述 | update | 指定欄位更新；授權不依角色名；audit 正確 | response、roles/audit | — | NOT RUN |
| ROLE-005 | P1 | RQ-05；刪除有人角色 cascade 關聯 | API/DB | R1 有持有人 | REASON、A2 密碼 | delete R1 | role 與 user_roles 關聯刪除；users 保留；audit 保留 label/reason | response、相關表 SQL | — | NOT RUN |
| ROLE-006 | P1 | RQ-05；不存在角色固定錯誤 | API | A2 | 不存在 id | update/delete/permissions assign | 404 `ROLE_NOT_FOUND`；無副作用 | responses、DB/audit | — | NOT RUN |
| ROLE-007 | P1 | RQ-05；權限覆蓋支援空集合及未知權限錯誤 | API/DB | A0、R1 | `[]`、不存在 id、null、重複 id | 分別 assign | 空集合可清空；未知 id 400 `UNKNOWN_PERMISSION`；其餘 schema 400；不部分寫入 | responses、DB/audit | — | NOT RUN |
| ROLE-008 | P1 | RQ-05；權限陣列數量與元素邊界 | Validation | A0、一般角色 | 50/51 項；0/負數/非整數 | permissions/assign | 50 可進業務驗證；51/非法元素 400；無部分寫入 | responses、DB 快照 | — | NOT RUN |

## 六、密碼、首次改密碼與設備簽章

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PWD-001 | P0 | RQ-06；三條設密碼路徑使用同一政策 | Validation | 可執行 create/reset/change | 11/12 字；缺大寫；缺小寫；200/201 字 | 三路徑逐組送出 | 結果一致；12–200 且有大小寫接受；其餘 400；訊息指出缺失；不截斷 | requests/responses、DB | — | NOT RUN |
| PWD-002 | P1 | RQ-06；中間空白與可列印字元可用，只 trim 外圍 | API/UI | 可改測試密碼 | 中間/外圍空白、符號 | 設定後登入 | 中間空白保留；外圍按規格 trim；UI 不擋貼上/密碼管理器 | response、登入、UI 證據 | — | NOT RUN |
| PWD-003 | P1 | RQ-06；新舊密碼不可相同 | API/Security | U1 知道舊密碼 | old=new | self change | 400 `PASSWORD_UNCHANGED`；hash/token/flag 不變；無 audit | response、DB/revocation/audit | — | NOT RUN |
| PWD-004 | P0 | RQ-06；臨時密碼 72 小時邊界 | Auth/Time | 可控 time | expiry-1ms、expiry | 建立/重設後在邊界登入 | 到期前可登入且 token mcp=true；等於到期時的行為符合實作已確認的比較規則 | time fixture、responses、claims | — | NOT RUN |
| PWD-005 | P0 | RQ-06；逾期臨時密碼不得登入 | Auth/Time | U3 已逾期 1ms | 正確臨時密碼 | login 及 password reauth | 401 `TEMPORARY_PASSWORD_EXPIRED`；不簽 token；不洩漏額外資訊 | responses、token/log | — | NOT RUN |
| PWD-006 | P0 | RQ-06；mcp 封鎖所有非豁免 API | Auth/Security | U3 以臨時密碼登入 | mcp=true token | 呼叫一般及自訂 auth policy 端點 | 403 `PASSWORD_CHANGE_REQUIRED`；session 不被當作 401 清除；無副作用 | responses、claims、DB | — | NOT RUN |
| PWD-007 | P0 | RQ-06；四條首次改密碼豁免可用 | Auth | mcp=true | change/me/refresh/logout | 逐一呼叫 | 不被 gate 擋；仍執行原端點認證/業務規則 | responses、route logs | — | NOT RUN |
| PWD-008 | P0 | RQ-06；自助改密碼清旗標並撤銷全部 token | API/DB/Security | U3 有多設備 token | 舊密碼、新 PWD | change；重用舊 token；新密碼登入 | mcp=0、expiry=NULL；舊 token/舊密碼失效；新登入 token 無 mcp；audit 無密碼 | responses、DB/revocation/audit/claims | — | NOT RUN |
| PWD-009 | P0 | RQ-06；管理員重設建立新臨時密碼狀態並撤銷 | API/DB/Security | A0、U1 多 token | 新 PWD、REASON | reset；驗證舊 token/密碼與新登入 | 舊 token/密碼失效；新密碼可登入且 mcp=true；expiry 約 +72h；audit 無密碼 | responses、DB/revocation/audit | — | NOT RUN |
| PWD-010 | P0 | RQ-06；缺少或錯誤設備簽章不得提權 | API/Security | A0 JWT/密碼正確 | 缺簽章、body/method/path 不符 | 四支提權端點逐組呼叫 | 全拒絕；無業務/audit 變更；錯誤不洩密 | responses、DB/audit | — | NOT RUN |
| PWD-011 | P0 | RQ-06；nonce 不可重放 | API/Security | A0 可產生有效簽章 | 同 nonce、相同 request | 首次送出後重放 | 重放拒絕；不重複建立/配置/重設 | responses、nonce/業務 DB/audit | — | NOT RUN |
| PWD-012 | P0 | RQ-06；密碼交易失敗不得留下不一致狀態 | Failure/Transaction | 可令 DB/audit 失敗 | self change、admin reset | 注入失敗後檢查並重試 | DB 與 audit 同步回滾；已撤銷 token 保持安全側；修復後可重試 | errors、DB/revocation/audit | — | NOT RUN |

## 七、稽核記錄

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-001 | P0 | RQ-07；每種狀態變更各有一列稽核 | API/DB | A0 可成功執行寫入 | 11 種 user/role action | 每種成功一次 | 每次恰一列；actor/target/time/request/IP/reason/detail 正確 | requests、request logs、audit SQL | — | NOT RUN |
| AUD-002 | P0 | RQ-07；變更與 audit 同一交易 | Failure/Transaction | 可令 audit insert 失敗 | 任一 user/role 變更 | 注入 audit failure | 業務變更回滾；無成功但無 audit 的狀態 | error、交易與 DB 快照 | — | NOT RUN |
| AUD-003 | P0 | RQ-07；失敗操作不可留下成功稽核 | API/DB | 可觸發 400/403/404/409/500 | 各代表一組 | 執行後查 audit | 無誤導性的成功 audit | responses、audit/log 快照 | — | NOT RUN |
| AUD-004 | P0 | RQ-07；回應、日誌、audit 不含憑證 | Security/Data | 敏感值帶唯一標記 | password/newPassword/token/Auth header | 成功與失敗後全域掃描 | 找不到原始密碼/hash/token/Auth；只記動作 | 掃描輸出、audit rows | — | NOT RUN |
| AUD-005 | P1 | RQ-07；detail 超 4KB 不使交易失敗 | API/DB | 可產生大 before/after | 4KB 邊界上下 | 執行變更 | 變更成功；超限寫 truncated 摘要；未超限保留內容 | response、audit JSON | — | NOT RUN |
| AUD-006 | P1 | RQ-07；高風險原因為 5–190 | Validation | A0 | 缺少/null/4/5/190/191 字 | 對六類高風險動作送出 | 5/190 可接受；其餘 400；失敗無副作用 | responses、DB/audit | — | NOT RUN |
| AUD-007 | P1 | RQ-07；audit 倒序、分頁與篩選正確 | API/DB | 多時間/actor/target/action rows | 各篩選及組合 | 查詢並翻頁 | 僅符合列；時間倒序；total/page/pageSize 正確；不接受 sortBy | responses、對照 SQL | — | NOT RUN |
| AUD-008 | P1 | RQ-07；actor 刪除後 audit 仍可追溯 | DB/Data | 隔離 actor 與 audit row | actor id/name | 刪除 actor | row 保留；actor id=NULL；username 原值保留 | SQL 前後快照 | — | NOT RUN |
| AUD-009 | P1 | RQ-07；CLI 救援 audit 可辨識 | Script/DB | disabled 測試用戶 | grantRole、reason、OS user | 執行腳本 | actor id NULL、username `cli:<user>`、action/detail/reason 正確 | CLI、audit row | — | NOT RUN |

## 八、列表、搜尋與排序

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIST-001 | P1 | RQ-08；用戶清單預設分頁/形狀 | API | 至少 25 用戶 | 無 query | GET users | page=1、pageSize=20、items≤20、total 為篩選後總數 | response、SQL count | — | NOT RUN |
| LIST-002 | P1 | RQ-08；分頁邊界不可靜默夾值 | Validation | A1 | page 0/1；size 0/1/100/101 | 逐一 GET | 合法邊界成功；非法 400；不靜默套預設 | responses | — | NOT RUN |
| LIST-003 | P1 | RQ-08；q 搜 username/displayName | API/DB | 可辨識資料 | 大小寫/部分字串 | 搜尋 | 兩欄任一命中即回；total/items 一致 | response、對照 SQL | — | NOT RUN |
| LIST-004 | P0 | RQ-08；LIKE 特殊字元須跳脫 | API/Security | 可辨識資料 | `%`、`_`、`\\` | q 搜尋 | 按字面匹配；不擴大查詢；使用參數化 SQL | response、SQL trace | — | NOT RUN |
| LIST-005 | P0 | RQ-08；sortBy 僅白名單 | API/Security | 多筆資料 | 四個合法值與 SQL payload | 正反排序並送惡意值 | 合法排序正確；非法 400；payload 不進 SQL；DB 完整 | responses、SQL trace、DB | — | NOT RUN |
| LIST-006 | P2 | RQ-08；audit offset 分頁已知重複風險 | API/UX | 至少兩頁 audit | 翻頁間新增一列 | 讀 page1、新增、讀 page2 | 邊界重複符合已知行為；時間範圍可縮窄重現結果 | responses、時間線、SQL | — | NOT RUN |

## 九、前端與端到端

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-001 | P1 | RQ-09；菜單與 route 依 permission 保護 | UI/Security | A0～A3 各登入 | 四類 session | 查看菜單並直接導航 users/roles/audit | 顯示與 requires 一致；無權限導 `/403`；audit 對 A1/A2 可見 | 截圖、route、claims | — | NOT RUN |
| UI-002 | P2 | RQ-09；system 菜單順序 | UI | A0 | 四頁 | 展開菜單 | 設備、用戶、角色、變更紀錄；改密碼不在菜單 | 截圖 | — | NOT RUN |
| UI-003 | P0 | RQ-09；首次改密碼不得離開頁面 | UI/E2E | U3 登入 | URL/refresh/back/forward | 嘗試離開 `/password/change` | 全導回；強制文案且無取消；四豁免可用 | 畫面、network、route state | — | NOT RUN |
| UI-004 | P1 | RQ-09；改密碼後清 session 並重新登入 | UI/E2E | 已登入 | 舊/新密碼 | topbar 修改並提交 | 清 session、導 login、顯示成功文案；不再用舊 token | 畫面、storage/network | — | NOT RUN |
| UI-005 | P1 | RQ-09；五種用戶對話框欄位及再確認正確 | UI | A0 在 UsersPage | create/update/roles/reset/status | 逐一開啟 | 欄位、reason、你的密碼、初始/新密碼、signed 符合 §4.3；同一對話框完成 | 截圖、遮罩後 payload | — | NOT RUN |
| UI-006 | P1 | RQ-09；不可授予項目前置停用 | UI/Security | A1/A2 | 超出自身 permission 選項 | 開啟配置對話框並繞過 UI | UI disabled 且說明；後端仍拒絕繞過請求 | 截圖、API response | — | NOT RUN |
| UI-007 | P1 | RQ-09；CAS 衝突重載並顯示差異 | UI/Concurrency | 兩 session 編輯同一對象 | 舊 expected | A 先存，B 再存 | B 409 後重載並列出舊/現值；不自動覆蓋 | 畫面、network、DB | — | NOT RUN |
| UI-008 | P1 | RQ-09；高風險後果與生效延遲提示 | UI/UX | A0 | 自停用、有持有人角色、配置成功 | 操作確認與完成 | 自停用警告；刪角顯示人數/失權；提示管理即時、一般頁≤15 分鐘 | 截圖 | — | NOT RUN |
| UI-009 | P1 | RQ-09；audit 畫面正確呈現特殊列 | UI | 一般/密碼/truncated/CLI rows | 各類 detail | 開頁、篩選、翻頁 | +/− 正確；密碼只顯示動作；截斷提示；CLI 可辨識；唯讀 | 畫面、API response | — | NOT RUN |
| UI-010 | P1 | RQ-09；service 參數翻譯及 signed 標記 | Client/Contract | 可 spy HttpClient | DataTable 參數、四提權動作 | 呼叫 services | 翻成後端 query 並回 `{rows,rowsNumber}`；只有四提權帶 signed；console 無敏感值 | spy/network/console | — | NOT RUN |

## 十、Migration、部署與復原

| ID | Priority | Requirement/Risk | Area | Preconditions | Test Data | Steps/Input | Expected Result | Required Evidence | Actual Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OPS-001 | P1 | RQ-10；0006/0007/0008 可重跑 | Migration/DB | 乾淨與部分演進 DB | 三支 migration | 各執行兩次 | 第二次成功；schema、permissions、關聯無重複/遺失 | outputs、schema/data 快照 | — | NOT RUN |
| OPS-002 | P1 | RQ-10；DDL 半途失敗後安全重跑 | Migration | 隔離 DB 或安全 fake | 0006/0007 | 製造中途失敗後重跑 | 收斂；已存在物件不永久卡死；ledger 與 schema 一致 | outputs、ledger/schema | — | NOT RUN |
| OPS-003 | P1 | RQ-10；DML 半途失敗後安全重跑 | Migration/DB | 隔離 DB | 0008 | 部分 seed 後失敗，再跑 | 三 permissions 與 system-admin 關聯各一份 | outputs、DB | — | NOT RUN |
| OPS-004 | P0 | RQ-10；新程式配舊 schema 拒絕啟動 | Deployment | DB 缺必要 migration | 缺欄位/表/permission | 啟動新版 | 明確失敗且不可部分提供服務 | log、exit code、health | — | NOT RUN |
| OPS-005 | P1 | RQ-10；排空部署後核心 smoke | Deployment | 備份、排空、migration 成功 | A0 | 啟動、登入、查三頁/permissions/device | 全部可用；三 permission 正確；無新舊節點並存 | logs、API/UI、SQL | — | NOT RUN |
| OPS-006 | P1 | RQ-10；舊 device claim 於一次 refresh 後恢復 | Deployment/Auth | 改名前 token | 舊/新 token | 部署後開頁並 refresh | 舊 token 可短暫 403；≤15 分鐘新 token 含 device.mgmt 並恢復；不全面登出 | claims、時間線、responses | — | NOT RUN |
| OPS-007 | P0 | RQ-10；break-glass 可救援且留痕 | Recovery/Script | 隔離唯一 admin 由 SQL 停用 | grantRole、reason | 救援、驗證、登入查 audit、清理 | active、R0 存在、鎖定清除、CLI audit 完整、可管理；清理不影響既有帳號 | CLI/SQL/API 與清理快照 | — | NOT RUN |

## 需求疑義與執行前確認

1. `PWD-004` 的精確到期邊界需以實作的比較運算確認：規格只明示「已經過去」為逾期。
2. 除自助改密碼明示 200 外，規格未逐一指定成功 HTTP status 與完整 response schema；執行前須以 handler/request schema 補齊精確斷言。
3. 角色名稱與 display name 的長度、字元集未完整定義；目前不自行推定邊界。
4. 角色清單提到上限 200，但超過 200 個角色時的預期行為未定義。
5. audit 篩選參數名稱與邊界未完整列出；執行前須依 request schema 補齊。
6. 瀏覽器相容性、無障礙等級與效能 SLA 未指定，因此未設定其通過門檻。

## 已知未測範圍與殘留風險

- 本次只建立案例，全部尚未執行，沒有任何 PASS 證據。
- 一般業務頁面收權最多延遲 15 分鐘是已接受風險；管理功能、停用與重設密碼仍須即刻生效。
- 初始密碼交付管道不在系統控制範圍；強制改密碼、72 小時期限與設備綁定只能縮短風險窗口。
- audit 與業務資料位於同一 DB，沒有外部 append-only/WORM/SIEM 副本。
- 未定義高權限授予、密碼重設與最後管理員異動的即時告警。
- 設計假設單節點排空重啟；若改成多節點滾動部署，permission rename 與 `mcp` claim 需重新設計兩階段相容測試。
