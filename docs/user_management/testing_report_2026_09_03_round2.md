# 用戶、角色與權限管理測試報告（Round 2）

## 文件資訊

| 項目 | 內容 |
| --- | --- |
| 測試案例 | `docs/user_management/test_case.md` |
| 測試日期 | 2026-09-03（Asia/Hong_Kong） |
| 分支 / Commit | `main` / `a9625e198842bad04a492c34d564a32a1e4c14b5` |
| 測試範圍 | Round 1 的 25 個 `NOT RUN` 案例 |
| Node.js / npm | Node.js `v26.6.0` / npm `11.18.0` |
| 資料庫 | 本機 MySQL `127.0.0.1:3306`，使用者確認為測試專用 DB |
| 案例檔 SHA-256（前／後） | `1dba198611536f848d7c4af44fdaf66f2a73d29d3634d535665837b3ea4cc340`（一致） |
| 執行原則 | 未修改 `test_case.md`；不修產品程式碼；測試資料均清理 |

## 結果摘要

### Round 2 本輪

| Metric | Result |
| --- | --- |
| Planned | 25 |
| Executed | 25 |
| Passed | 24 |
| Failed | 1 |
| Blocked | 0 |
| Not run | 0 |
| New product defects | 1（S3） |

### 與 Round 1 合併後

| Metric | Result |
| --- | --- |
| Planned / Executed | 87 / 87 |
| Passed | 82 |
| Failed | 4 |
| Blocked | 1（`UI-006`，仍被 `DEF-003` 阻塞） |
| Not run | 0 |
| Open product defects | 4（S2 × 2、S3 × 2） |
| Open security findings | 1（S2 dependency finding） |
| Recommendation | **NO-GO** |

本輪把 Round 1 的 25 個 `NOT RUN` 全部執行。24 項通過；`PWD-002` 重現外圍空白密碼未按規格 trim 的缺陷。Round 1 的 `USER-003`、`AUD-001`、`UI-001` 與 dependency finding 沒有程式碼修正，因此維持 open。`UI-006` 的 A1 UI 部分仍受 `UI-001` 缺陷阻塞。

## 主要執行證據

| Check | Result | Evidence |
| --- | --- | --- |
| IAM-002～005 真 DB / startup | PASS | 0005 重跑保留 permission id/role links；缺 `user.mgmt` 拒絕 application startup；extra permission 與 description drift 只 warn 且不自修 |
| AUTH-002/003 完整矩陣 | PASS | 真 HTTP + MySQL；A1 的 8 個 user endpoints 與 audit 成功、6 個 role/permission endpoints 為 403；A2 反向矩陣全部符合 |
| GUARD-006/007 | PASS | DB 原有 active `system-admin` 為 0；建立唯一 QA system-admin 後，disable/remove-R0 均 409 `LAST_ADMIN_PROTECTED`，token/DB/audit 無副作用 |
| PWD-002/004/012 | 2 PASS / 1 FAIL | 真 API/MySQL；expiry-1ms 成功、expiry 當刻 `TEMPORARY_EXPIRED`；self-change/admin-reset audit failure 均回滾且可重試；外圍空白缺陷見 `DEF-004` |
| AUD-004 | PASS | 唯一敏感 marker 掃描 response、system log、request log、audit；原始 password/hash/token/Authorization 均未出現 |
| AUD-006 | PASS | 6 類高風險動作 × reason missing/null/4/5/190/191，共 36 組；5/190 成功，其餘 400 |
| AUD-009 / OPS-007 | PASS | 實跑 `scripts/grantRole.js`；disabled 帳號恢復 active、R0 存在、鎖定清除、CLI audit 正確、可呼叫管理 API |
| UI-004/007/008/009/010 | PASS | 57 個指定 client component/contract tests 中原 suite 全通過；另補 truncated/password audit row；搭配真 API password revocation 與 CAS evidence |
| OPS-002 | PASS | 移除 0006/0007 ledger 記錄但保留已套用 schema，再跑正式 migrate；兩支收斂並重新寫 ledger |
| OPS-003 | PASS | system-admin 僅保留部分 0008 permission links，再跑 0008；三 permission 與三 link 各一份 |
| OPS-004 | PASS | 真 DB 暫缺 `user.mgmt` 時新版 application 在 HTTP start 前拒絕啟動，訊息指出缺項與 migrate；DB 未被自修 |
| OPS-005 | PASS | 正式 `npm run migrate` 全部安全 skip；7 個 login/refresh/device 真 MySQL smoke tests 全通過；指定 user/role/audit UI component tests 通過 |
| OPS-006 | PASS | 舊 token 含 `device.approve` 時管理 API 403；一次 signed refresh 後新 token 含 `device.mgmt`、不含舊 claim，API 恢復 200 |
| Test data cleanup | PASS | users=2、roles=2、permissions=3、user_roles=2、role_permissions=3、audit=0、devices=0、nonces=0；`qa-r2-*` / `it-*` user/role 均為 0 |
| Test case immutability | PASS | 執行前後 SHA-256 相同 |

### 使用的主要命令

```text
node --test --import ./test-support/testEnv.js <selected unit/service suites>
npx vitest run <selected UI/service suites>
DB_INTEGRATION_TESTS=1 node --env-file=.env --test --test-concurrency=1 <integration suites>
npm run migrate
node scripts/grantRole.js <qa-user> system-admin --reason <qa-reason>
```

補充 QA runner 均為臨時檔案，測試完成後已刪除，沒有納入產品工作樹。

## 25 個案例結果

| ID | Status | Actual evidence |
| --- | --- | --- |
| IAM-002 | PASS | 真 MySQL 重跑 0005；只有一筆 `device.mgmt`，id 與 role links 前後一致。 |
| IAM-003 | PASS | 暫缺 `user.mgmt` 時 application startup 明確失敗並提示 migrate；permission 未自動補回。 |
| IAM-004 | PASS | 插入 `legacy.permission` 後 application 成功初始化並記 warn；資料未被修改。 |
| IAM-005 | PASS | 修改 `user.mgmt` description 後 application 成功初始化並記 drift warn；仍按 name 授權且未自修。 |
| AUTH-002 | PASS | A1 完整呼叫 users、roles、permissions、audit 矩陣；user/audit 依額外認證通過，role/permission 全 403。 |
| AUTH-003 | PASS | A2 完整矩陣；role/permission/audit 依額外認證通過，全部 user endpoints 為 403。 |
| GUARD-006 | PASS | 唯一 active system-admin disable 回 409；仍 active，token version 與 audit 不變。 |
| GUARD-007 | PASS | 唯一 active system-admin 移除 R0 回 409；user_roles 關聯與 audit 不變。 |
| PWD-002 | **FAIL** | 內部空白與符號密碼可設定/登入；外圍空白只在強度驗證時 trim，實際 hash 保存原字串，trim 後密碼登入失敗。 |
| PWD-004 | PASS | 可控 time：expiry-1ms 登入成功且 mcp=true；expiry 當刻拒絕為 `TEMPORARY_EXPIRED`（實作為 `<= now`）。 |
| PWD-012 | PASS | self change 與 admin reset 均注入 audit insert failure；密碼/audit transaction 回滾，reset token 保持撤銷安全側，修復後重試成功。 |
| AUD-004 | PASS | 成功與失敗密碼 request 後掃描 response、兩類 log、audit；未找到原始憑證、hash、token 或 Authorization。 |
| AUD-006 | PASS | 六類動作 36 組 reason 邊界全部符合 5～190 規則；非法值 400。 |
| AUD-009 | PASS | CLI actor 為 `cli:<OS user>`、actor id NULL、action/reason/detail 正確；帳號可登入並具管理權限。 |
| UI-004 | PASS | component 提交後呼叫 change API、清 session、導 login、顯示成功；真 API 證明舊 token/舊密碼失效。 |
| UI-007 | PASS | users/roles component 收到 `ASSIGNMENT_STALE` 後重載並顯示目前差異；真 API CAS 保留先成功集合。 |
| UI-008 | PASS | component 驗證自停用即時登出警告、有持有人角色失權/人數提示，以及成功後「管理即時、一般頁最遲 15 分鐘」文案。 |
| UI-009 | PASS | component 呈現一般 +/−、密碼動作無 detail、truncated 提示、CLI badge、篩選與 DataTable 分頁；畫面唯讀。 |
| UI-010 | PASS | service spy 驗證 DataTable query 翻譯與 `{rows, rowsNumber}`；只有 create/roles-assign/password-reset/permission-assign 帶 `signed:true`；client source 無敏感 console 輸出。 |
| OPS-002 | PASS | 0006/0007 schema 已存在但 ledger 缺列時，正式 migration 重跑成功，schema 與 ledger 收斂。 |
| OPS-003 | PASS | 0008 部分 link 狀態重跑成功；三個 catalogue permission 與 system-admin links 各一份。 |
| OPS-004 | PASS | 新 application 配缺 permission 的舊狀態拒絕初始化，沒有部分 HTTP 服務。 |
| OPS-005 | PASS | 備份完成、migration 成功、單一新版 process smoke 的登入、user/role/audit、permissions、device 流程全部通過，無新舊節點並存。 |
| OPS-006 | PASS | 舊 claim 短暫 403；一次 refresh 取得新 claim 後恢復，未全面登出。 |
| OPS-007 | PASS | break-glass 復活唯一 QA admin、授予 R0、清鎖、留 CLI audit、可管理；清理後基線帳號未受影響。 |

## 新缺陷

### [S3] DEF-004 — 新密碼外圍空白只被用於驗證 trim，實際保存未 trim

- **Related case:** `PWD-002`
- **Reproducibility:** 1/1 真 API/MySQL；內部空白與符號對照組通過
- **Steps:** 自助改密碼送出一個符合政策、但頭尾各有空白的 `newPassword`；成功後以 trim 後密碼登入。
- **Actual:** change API 回 200；trim 後密碼登入失敗，帶原始外圍空白的字串才對得上保存的 hash。
- **Expected:** 外圍空白在驗證與保存前一致 trim；中間空白保持原樣。
- **Root-cause evidence:** `assertPasswordStrength()` 對 `String(password).trim()` 做政策檢查，但 change/create/reset 的 `hashPassword()` 使用未 trim 的原值。
- **Impact:** 使用者看到設定成功，之後以規格所述的 trim 值登入會失敗；貼上密碼時尤其容易發生。未觀察到提權或憑證洩漏。

## 仍開放的 Round 1 findings

| Finding | Severity | State |
| --- | --- | --- |
| DEF-001 username 外側空白在 schema trim 前被拒 | S3 | Open |
| DEF-002 audit 未保存 request ID / IP | S2 | Open |
| DEF-003 A1 (`user.mgmt` only) UsersPage 因無條件載入 roles 而 Forbidden | S2 | Open；仍阻塞 `UI-006` A1 UI 部分 |
| SEC-001 `fast-uri` high、`qs` moderate dependency advisories | S2 | Open；本輪未修改 lockfile |

## 測試過程中已排除的非產品失敗

- 第一批 integration command 漏載入 `.env`，25 個案例在 DB 初始化前以 root/no-password 失敗；修正命令後 25/25 通過，未計為產品結果。
- AUTH runner 的兩個合法 payload 欄位名不符 schema；修正 fixture 後完整矩陣通過。
- AUD-004 runner 把 password reauth 失敗預期成 401，但實作為 403；案例只要求失敗後掃描，修正斷言後掃描通過。
- UI-009 fixture 的 reason 自帶英文 `password`，觸發過寬 regex；改為唯一 raw-secret marker 後通過。
- 首次 GUARD 安全 runner 的 nonce cleanup 使用不存在的 `device_id` 欄位；依精確前置條件清理後改以實際 nonce key，重跑通過。

## Residual risk

- `UI-006` A1 的超範圍角色選項仍無法在完整 UsersPage 驗收，因 `DEF-003` 令頁面先失敗；後端繞過防護與 A2 UI 已通過。
- UI-004/007/008/009 本輪以 component-render + 真 API/DB 的分層組合證據執行，沒有另留 live-browser screenshot artifact。
- 本機 DB 的 `system-admin` 角色在測試前後均沒有 active 持有人；這不是本輪造成，但實際環境若依賴該 DB，應確認是否需要執行正式 break-glass 配置。
- 本輪只測試、不修復；所有 open defect/finding 仍會影響 release readiness。

## Recommendation

**NO-GO**

至少修復 `DEF-002`、`DEF-003` 與 `SEC-001`，加入 regression 後重跑；`DEF-001` 與 `DEF-004` 應統一所有 username/password 路徑的 trim 契約。修復 `DEF-003` 後需補跑 `UI-006` A1 UI 部分，才可解除最後一個 blocked case。
