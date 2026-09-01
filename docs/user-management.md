# 用戶體系設計：用戶、角色與權限管理

目標：讓 `system-admin` 能在系統裡自行維護**用戶**與**角色**，而**權限目錄本身維持不可變**——`permissions` 表只由投產腳本（migration）改動，沒有任何 API、任何角色、任何介面寫得到它。

三層的分工在這次設計之後固定下來：

| 層 | 誰能改 | 改動途徑 |
| --- | --- | --- |
| `permissions`（權限目錄） | **沒有人** | 只有 migration。加一個權限＝出一次版 |
| `roles` + `role_permissions`（角色持有哪些權限） | 持有 `role.mgmt` 的角色 | 角色管理頁 |
| `users` + `user_roles`（誰是誰、誰有哪些角色） | 持有 `user.mgmt` 的角色 | 用戶管理頁 |

這個分層是整份設計的骨架：權限是程式碼的一部分（它的名字寫死在 handler 的 `authorizationPolicies` 與頁面的 `page.requires` 裡），所以它跟著程式碼一起投產；角色與用戶是營運資料，所以它們在系統裡維護。中間那條線就是「要不要出版」的分界線。

---

## 已確認的決定

| 決定 | 選擇 | 主要影響 |
| --- | --- | --- |
| 新增的權限 | **`user.mgmt`**、**`role.mgmt`** | 各自涵蓋一整組 CRUD 加一項配置動作，不再細分 read/write |
| `device.approve` | **改名為 `device.mgmt`** | 純改名（`UPDATE permissions SET name`），權限 id 與既有 `role_permissions` 關聯全部保留 |
| `system-admin` 起始權限 | `user.mgmt` + `role.mgmt` + `device.mgmt` | 由 migration 種入 |
| 用戶「刪除」 | **停用（`status = 'disabled'`）** | 不做硬刪除；保留稽核關聯與 `user_devices.reviewed_by` |
| 新增用戶的密碼 | **管理員設初始密碼 + 強制首次改** | `users` 加 `must_change_password` 欄；改密碼前後端都硬擋 |
| 自助改密碼 | **做**，任何時候都可以改 | 與強制首次改共用同一支 API |
| 角色／權限變更生效時機 | 管理功能**即刻**（管理端點重讀 DB）；一般業務頁面等續期（最多 15 分鐘） | 不做全面撤銷；續期本來就會重讀 roles/permissions，見 §1.5 |
| 停用帳號 | **即刻撤銷該用戶所有 token** | 與 `revokeDevice` 同一個手法 |
| HTTP 動詞 | **只用 `GET` 與 `POST`**，動作寫在 URL 上 | 不用 `PUT`／`DELETE`；沿用設備審批已經在用的 `/bindings/:id/approve` 那種寫法 |
| 密碼政策 | 最短 **12** 字元，且必須同時含大寫與小寫英文字母 | 三條設定密碼的路徑共用同一個檢查函式 |
| 稽核 | **新增 `user_audit_logs` 表 + 查詢頁** | 與變更同一個交易寫入；高風險動作強制填原因 |
| `permissions` 唯讀的落實 | **程式碼層不提供寫入 API + 啟動時自檢** | 不動部署與 DB 帳號 |
| 守衛規則 | `system-admin` 角色不可改不可刪；最後一個 admin 不可停用 | 「不能停用自己」「角色有人掛住不能刪」明確**不加**——前者有最後一個 admin 那條兜著，後者由 UI 顯示人數警告 |
| 用戶清單 | **server-side 分頁 + 搜尋** | 順帶定下之後所有列表 API 的慣例 |
| `username` | **建立後不可修改**，只能改 `display_name` | 帳號名會留在稽核記錄、日誌與設備審批佇列裡，可改的話那些歷史會指向一個查不到的名字 |
| 管理員重設密碼後 | **即刻撤銷該用戶所有 token** | 重設的前提通常是舊密碼不再可信；不撤銷的話對方（或攻擊者）手上的 session 還能再活 15 分鐘 |
| 稽核查詢頁的權限 | `user.mgmt` **或** `role.mgmt`（`match: "any"`） | 不另開 `audit.view`——多一個權限要多一次投產，而看得到用戶管理的人本來就看得到這些資料 |
| 稽核記錄保留 | **不清理**，沒有清理 job | 它是給人事後追查用的；年限該由法規決定，不該由磁碟空間決定 |
| 提權防護 | **授予範圍包含規則**：授不出自己沒有的權限；管理端點**即時從 DB 重讀**操作者權限 | 堵死「`user.mgmt` 把 `system-admin` 指派給自己」這條路，見 §1.4 |
| 最後一個管理員 | **不可停用、不可移除其 `system-admin` 角色**（並發安全） | 另加 `scripts/grantRole.js` 緊急腳本，見 §1.4 與 §5.1 |
| 再確認的分層 | 能提權的四支＝**`jwt-device-password`**（JWT + 已核准設備簽章 + 密碼）；只斷存取的四支＝**`jwt-password`**；其餘一般 `jwt` | 判準與完整清單見 §5.2。現有簽章已涵蓋 method／path／body hash／timestamp／nonce，所以這一層是接線不是新建 |
| 初始／重設密碼 | **72 小時有效期** | `users` 加 `temporary_password_expires_at`；過期後要管理員重設 |
| 角色名參與授權 | **不參與**：禁止任何 route 使用 `hasRole` | 約定測試釘住；授權一律走 permission |
| 部署方式 | **單節點／排空後重啟** | 改名與 `mcp` claim 一步到位，不做兩階段相容遷移 |

---

## 一、權限模型

### 1.1 三個權限

| 權限 | 涵蓋的動作 | 掛在哪些 route |
| --- | --- | --- |
| `user.mgmt` | 新增、修改、查詢、停用／啟用用戶；為用戶配置角色；重設用戶密碼 | `/api/v1/users*` |
| `role.mgmt` | 新增、修改、查詢、刪除角色；為角色配置權限；讀取權限目錄 | `/api/v1/roles*`、`GET /api/v1/permissions` |
| `device.mgmt` | 審批、拒絕、撤銷設備綁定申請 | `/api/v1/device/bindings*`（既有） |

**權限的粒度是「一個管理功能」而不是「一個動作」。** 分成 `user.read` / `user.write` / `user.role.assign` 這種切法，換來的是一份沒有人配得對的權限清單——實務上會發生的事情是所有人都被配上全部三個，只是多花了三倍的維護成本。要細分的時機是「真的有一個角色只該看不該改」出現的那一天，不是現在。

`GET /api/v1/permissions` 掛 `role.mgmt` 而不是自己一個權限：讀權限目錄唯一的用途就是「為角色配權限」那個畫面上的勾選清單，兩者永遠一起出現。

### 1.2 `device.approve` → `device.mgmt`（純改名）

現有的三支審批 handler（approve / reject / revoke）與審批佇列，全部共用 `deviceBindingSchemas.js` 裡的同一個授權政策常數（改名後叫 `DEVICE_MGMT_POLICY`）。也就是說「審批」「拒絕」「撤銷」本來就是同一個權限，這次只是把名字改成與實際涵蓋範圍相符的 `device.mgmt`，**授權行為完全沒有變化**。

改名用 `UPDATE permissions SET name = 'device.mgmt' WHERE name = 'device.approve'`（**Phase 0 已完成**，見 `0005_rename_device_permission.js`），不是「刪掉舊的、插入新的」：

- 權限 id 不變，`role_permissions` 裡既有的關聯原封不動——刪除會被 `ON DELETE CASCADE` 連帶清掉，然後要靠 migration 自己重建，多一個會出錯的步驟。
- migration 可重複執行：`device.approve` 不在了就什麼都不做，`device.mgmt` 已經在了也什麼都不做。

**投產當下已經簽發的 token 帶的仍然是 `device.approve`。** 這些 token 最多再活 15 分鐘，而每次續期都會從資料庫重讀 roles/permissions（見 `refreshTokenHandler.js`），所以最壞情況是某個審批者在投產後的一次續期週期內，設備審批頁短暫變成 403。不做任何補償：它會自己好，而為了它去撤銷全體 token 反而會把所有人踢出去一次。投產步驟（§9）會把這一點寫進去，以免有人在那 15 分鐘裡開票。

### 1.3 `permissions` 表唯讀怎麼落實

兩道，都不動部署與 DB 帳號：

**第一道：沒有寫入路徑。** `permissions` 只有一支 `GET /api/v1/permissions`。不存在任何會寫入這張表的 handler，前端也沒有任何新增或編輯權限的入口。角色管理頁的權限清單是一組唯讀的勾選框——勾的是 `role_permissions`（關聯），不是 `permissions`（目錄本身）。

**第二道：啟動時自檢。** 權限目錄的正本寫在程式碼裡：

```js
// server/src/modules/authorization/permissionCatalogue.js
export const PERMISSION_CATALOGUE = Object.freeze([
  Object.freeze({ name: "user.mgmt", description: "管理用戶與用戶的角色" }),
  Object.freeze({ name: "role.mgmt", description: "管理角色與角色的權限" }),
  Object.freeze({ name: "device.mgmt", description: "審批、拒絕或撤銷設備綁定申請" })
]);
```

啟動時（一個 eager service 的 `initialize()`，見 §3.7）拿它跟資料庫比對：

| 情況 | 處置 | 理由 |
| --- | --- | --- |
| 目錄裡有、資料庫缺 | **拒絕啟動** | 代表 migration 沒跑完。這個狀態下 handler 要求的權限沒有人配得到，系統會用一種「登得進去、但功能一個都用不了」的方式壞掉——那是最花時間查的一種壞法 |
| 資料庫有、目錄裡沒有 | 記一筆 `warn`，照常啟動 | 多出來的權限不會讓任何 route 開放（route 只認自己宣告的名字），但它代表有人手動改過表，值得留下痕跡。拒絕啟動會讓「上一版還有、這一版移除了」的正常演進變成一次停機 |
| 名字對、`description` 不同 | 記一筆 `warn` | `description` 只給人看，不參與任何判斷 |

**這是自檢，不是自動修復。** 缺了就自己補進去的話，`permissions` 就變成一張程式碼可以寫的表了，這份設計的第一條規則會在第一次啟動時就被自己違反。

### 1.4 提權防護：四道

`user.mgmt` 與 `role.mgmt` 這兩個權限本身就有能力製造更高的權限——這是這份設計裡最容易被低估的一件事。單靠「保護 `system-admin` 角色不可改」擋不住它：**角色不能改，不代表這個角色不能被指派給別人。** 一個只有 `user.mgmt` 的人，可以把 `system-admin` 指派給自己，一步拿齊全部權限。

四道合起來把這條路封死，每一道各自都不夠：

**（一）`system-admin` 角色不可改不可刪。** 角色管理的所有寫入路徑（改名、改描述、刪除、配權限）第一件事就是檢查目標角色名是否為 `system-admin`，是的話回 409 `ROLE_PROTECTED`。前端把那一列的操作按鈕換成一個鎖的圖示——但只靠前端隱藏不算數，後端那道才是真的。它持有的權限清單同樣只由 migration 改。

**（二）授予範圍包含規則：授不出自己沒有的權限。**

配角色（`users/:id/roles/assign`）與配權限（`roles/:id/permissions/assign`）在執行前，先算出「這次操作會讓對方新增哪些權限」，再要求那個集合是**操作者自己權限集合的子集**。不是的話回 403 `PERMISSION_ESCALATION_DENIED`。

- 只檢查**新增**的部分，不檢查移除的：一個 `user.mgmt` 管理員應該有能力把某個人的角色全部拔掉（那是降權，不是提權），即使那個角色帶著他自己沒有的權限。
- 對 `system-admin` 自然成立：他持有全部三個權限，所以什麼都授得出去。
- 對只有 `user.mgmt` 的人，效果是他只能指派「權限集合 ⊆ {user.mgmt}」的角色——`system-admin` 帶著另外兩個權限，於是指派不出去，包括指派給自己。
- 不需要任何權限層級或 `iam.grant` 這種新概念。層級要維護一張「誰高於誰」的表，而那張表本身又會變成一個要保護的東西；包含規則只用已經存在的資料就答得出來。

**（三）最後一個 `system-admin` 不能被停用，也不能被移除角色。**

判斷與寫入必須是同一句 SQL，不能「先 count 再 update」——兩個管理員同時停用最後兩個 admin 帳號，兩邊都會查到「還有另一個」然後各自放行：

```sql
UPDATE users SET status = 'disabled', updated_at = ?
WHERE id = ? AND status = 'active'
  AND (
    -- 自己不是 system-admin，或者除了自己以外還有別的 active system-admin
    NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = users.id AND r.name = 'system-admin')
    OR EXISTS (
      -- 這裡多包一層 derived table，理由見下面「對真資料庫的修正」。
      SELECT 1 FROM (
        SELECT u2.id AS id FROM user_roles ur2
          JOIN roles r2 ON r2.id = ur2.role_id
          JOIN users u2 ON u2.id = ur2.user_id
         WHERE r2.name = 'system-admin' AND u2.status = 'active' AND u2.id <> ?
      ) AS other_active_admins
    )
  );
```

`affectedRows === 0` 就是「停不了」，回 409 `LAST_ADMIN_PROTECTED`。InnoDB 會對這一列的寫入序列化，兩個並行請求只有一個過得了。移除角色（`roles/assign` 送上來的清單不含 `system-admin`，而對方是最後一個 admin）套同一條規則。

> **對真資料庫的修正（Phase 2 實作時發現）**：第二個 `EXISTS` 子查詢要判斷「除了這一列以外還有沒有別的 active admin」，需要 `JOIN` 到 `users` 本身——但 MySQL 不允許在 `UPDATE` 的子查詢裡以任何別名直接讀被更新的那張表，會拋 `ER_UPDATE_TABLE_USED`（"You can't specify target table 'users' for update in FROM clause"）。這一版設計文件最初寫的 SQL（少了外層那個 `SELECT 1 FROM (...) AS other_active_admins` 包裝）在單元測試裡看起來完全合理，只有對著真 MySQL 才會炸——這正是 §7 每個 Phase 都要求整合測試對真資料庫驗收的理由。外層再包一次子查詢會讓 MySQL 先把裡面的結果物化成一張暫存表，之後的讀取就不再算是「直接讀目標表」，繞過這個限制。第一個 `NOT EXISTS` 不需要這個包裝，因為它的子查詢沒有 `JOIN users`，只是拿外層那一列的 `id` 當常數比對，不受這條限制。上面的程式碼區塊已經是修正後、通過整合測試的版本。

> 上一輪你選的是不加這條守衛。改的理由是審閱報告點出的那件事：**沒有守衛、又沒有復原工具**，兩者同時成立才是真正的問題。現在兩樣都補上（守衛在這裡，緊急腳本在 §5.1）。

**（四）管理端點即時從資料庫重讀操作者的權限。**

`hasPermission` 策略讀的是 JWT claims，那是簽發當下的快照，最舊可以是 15 分鐘前的（§1.5）。所以每一支管理類端點在 handler 開頭多做一次：照 `req.auth.claims.sub` 重讀這個人**現在**的角色與權限，與 claims 不符就回 403 `PERMISSION_STALE`（訊息：權限已變更，請重新整理）。

- 這一次重讀同時餵給第（二）道的包含規則——本來就要知道操作者現在有什麼，兩件事共用同一次查詢。
- 只落在管理類端點（十幾支、低頻）。一般業務端點維持讀 claims，不為了這件事讓每個請求都多三次 join——那正是當初把 claims 寫進 token 的理由。
- 因此「收權要等 15 分鐘」這件事，對**管理功能**是即刻生效的；剩下的延遲只影響一般業務頁面。

### 1.5 權限變更幾時生效

角色與權限在**登入當下**寫進 JWT claims，請求路徑上不再查資料庫（見 `0003_add_auth_tables.js` 開頭的說明）。加上 §1.4 第（四）道的即時重讀之後，生效時機分成兩欄看：

| 動作 | 對管理功能 | 對一般業務頁面 |
| --- | --- | --- |
| 為用戶加／減角色 | **即刻**（管理端點重讀 DB） | 下一次續期，最多 15 分鐘 |
| 為角色加／減權限 | **即刻**（同上） | 下一次續期，最多 15 分鐘 |
| 停用帳號 | 即刻（撤銷 token，§3.6） | 即刻 |
| 管理員重設密碼 | 即刻（同上） | 即刻 |
| 改顯示名稱 | — | 下一次續期（純顯示，沒有安全含意） |

換句話說：**被收掉 `user.mgmt` 的人，下一個請求就建不了用戶了**；他手上的 token 在那 15 分鐘裡還能用的，只有他原本就看得到的一般頁面。

續期會重讀資料庫並用新的 roles/permissions 重簽 token（`refreshTokenHandler.js` 已經是這樣做的，`stores/session.js` 的 `refresh()` 也會順手更新 `session.user`），所以權限變更會在一次續期之內反映到畫面上——菜單、`v-can`、route guard 全部跟著更新，使用者不需要重新登入。

**這件事要在介面上講出來。** 配角色與配權限的對話框在成功之後顯示：「已儲存。管理權限即時生效；一般頁面的顯示最遲 15 分鐘內（下一次背景續期）跟上。」

---

## 二、資料模型（需簽核）

**三支 migration，不是一支。** 一支加欄位、一支建稽核表、一支種權限。（Phase 0 的改名是第四支 `0005_rename_device_permission.js`，已經投產，所以下面三支從 `0006` 起算——**已經套用過的 migration 不能事後改內容**，runner 只認檔名，改了也不會重跑。）

拆這麼細不是潔癖，是因為 runner 只在整個 `up()` 成功之後才寫 `fr_schema_migrations`（見 `scripts/migrate.js`），而**MySQL 的 DDL 會隱式提交**：`ADD COLUMN` 成功、後面的 `CREATE TABLE` 失敗的話，這一支 migration 沒有被記錄成已套用，但它的前半段已經真的改了資料庫；重跑會炸在「欄位已存在」上，然後整條部署流程卡死在一個要人手動判斷的狀態。一支 migration 只做一次 DDL，這個問題就不存在。

同一個理由，`ADD COLUMN` 之前仍然查一次 `information_schema`（`0003_add_auth_tables.js` 的 `columnsOf()` 已經有這個手法可以直接用），建表一律 `CREATE TABLE IF NOT EXISTS`。**每一支都必須真的可以重跑**，而且要有一個測試證明它——不是「應該可以」。

### 2.1 `0006_add_user_password_columns.js`（DDL）

```sql
ALTER TABLE users
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN temporary_password_expires_at BIGINT UNSIGNED NULL;
```

| 欄位 | 型別 | 用途 |
| --- | --- | --- |
| `must_change_password` | `TINYINT(1) NOT NULL DEFAULT 0` | 1 = 這個帳號在改密碼之前不能用系統。管理員建立帳號或重設密碼時設 1，使用者改完密碼後設 0 |
| `temporary_password_expires_at` | `BIGINT UNSIGNED NULL` | 管理員設的那個密碼到什麼時候為止有效（epoch 毫秒，預設 72 小時）。NULL = 不是臨時密碼，永遠有效 |

- **對既有資料的影響**：兩欄都有安全的預設（`0` 與 `NULL`），既有的列不受影響，不需要回填。MySQL 8（CI 用的版本）加一欄是 INSTANT DDL；README 宣告的下限 5.7 會複製整張表——`users` 是個位數到數百列，兩種情況都是毫秒級。
- **為什麼不用 `BOOLEAN`**：MySQL 的 `BOOLEAN` 就是 `TINYINT(1)` 的別名，寫成別名只會讓 schema dump 與 DDL 看起來不一樣。
- **為什麼臨時密碼的到期時間是一欄，而不是一套 activation token**：審閱建議的做法（DB 只存 token hash、使用者自己設密碼）更好，但它換掉的是你已經拍板的整條流程。加一欄能拿到那套方案八成的效果——過期的臨時密碼登不進來——而且不必改任何既有的登入路徑。真的要走 activation token，那是一次獨立的設計。
- **為什麼不做成 `password_changed_at`（記時間，靠比較判斷）**：那是「密碼每 90 天要換」的資料模型；這裡要的是一次性旗標加一個死線。日後真要做密碼過期再加那一欄，三者不衝突。

### 2.2 `0007_add_user_audit_logs.js`（DDL）

```sql
CREATE TABLE IF NOT EXISTS user_audit_logs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- 事件發生時間（epoch 毫秒），與其他表一致，來源是 time service 的 nowMs()。
  occurred_at    BIGINT UNSIGNED NOT NULL,
  -- 操作者。帳號日後若真的被硬刪除，這裡變 NULL 但記錄本身留著。
  actor_user_id  BIGINT UNSIGNED NULL,
  -- 操作者當下的帳號名，冗餘保存。沒有它的話，改名或刪帳號會讓整段歷史指向
  -- 一個查不到的 id——稽核記錄的價值就是它在事後還讀得懂。
  actor_username VARCHAR(190)    NOT NULL,
  -- user.create | user.update | user.disable | user.enable | user.roles
  -- | user.password.reset | user.password.change
  -- | role.create | role.update | role.delete | role.permissions
  action         VARCHAR(60)     NOT NULL,
  -- user | role
  target_type    VARCHAR(20)     NOT NULL,
  target_id      BIGINT UNSIGNED NULL,
  -- 對象當下的名字（username 或角色名），理由同 actor_username。
  target_label   VARCHAR(190)    NOT NULL,
  -- 操作者填的原因。高風險動作必填（見 §3.1），其餘留空字串。
  reason         VARCHAR(190)    NOT NULL DEFAULT '',
  -- 變更前後的值，例如 {"roles":{"before":["staff"],"after":["staff","admin"]}}。
  -- 密碼、雜湊、token、Authorization header 永遠不會出現在這裡；改密碼類的
  -- 動作只記「改過」這件事。寫入前檢查序列化後的長度，超過 4KB 就截成一個
  -- {"truncated":true} 的摘要——稽核記錄不該因為某次塞了一個巨大的 payload
  -- 而讓整個交易失敗。
  detail         JSON            NULL,
  -- 對得回請求日誌（logs/requests-*.log）的那一次請求。
  request_id     VARCHAR(64)     NOT NULL DEFAULT '',
  ip             VARCHAR(45)     NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  -- 稽核頁的預設查詢：照時間倒序翻頁。
  KEY idx_user_audit_logs_time (occurred_at),
  -- 「這個帳號被誰動過什麼」——事後追查最常問的一句。
  KEY idx_user_audit_logs_target (target_type, target_id, occurred_at),
  -- 「這個人做過什麼」。
  KEY idx_user_audit_logs_actor (actor_user_id, occurred_at),
  CONSTRAINT fk_user_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
);
```

- **命名**：`user_` 前綴，與 `user_devices`、`user_device_nonces` 同族；不是 `fr_`，因為「要不要留稽核」是業務政策。
- **`ON DELETE SET NULL` 而不是 `CASCADE`**：稽核記錄不能因為操作者的帳號沒了就跟著消失——那正好是最需要它的情況。
- **對既有資料的影響**：純新增，不動任何既有表。
- **保留**：不清理，也不寫清理 job。一次用戶維護才一列，量級與 `user_devices` 相當——後者需要清理是因為它會累積從來沒被批准過的申請，稽核沒有這種垃圾。真要設年限時再加一個 job（比照 `LogRetentionJob`），那是一次獨立的決定。

### 2.3 `0008_seed_user_management_permissions.js`（DML）

沿用 `0004` 的 `ensureRow()`（先查再寫、以名稱為準、有就跳過），順序：

1. `ensureRow` 種入 `user.mgmt`、`role.mgmt`，以及 `device.mgmt`——最後這個在正常路徑上已經由 `0005` 改名改出來了，這裡只是給「`permissions` 被人手動清過」那種資料庫一條回得去的路。
2. 確保 `system-admin` 角色存在（`0004` 已種，這裡照 `ensureRow` 再確認一次）。
3. 確保三個 `role_permissions` 關聯存在。

`device.approve` → `device.mgmt` 的改名**不在這一支**：它是 Phase 0 獨立投產的 `0005_rename_device_permission.js`。兩者分開是因為改名對舊程式碼是破壞性的（舊版找的是舊名），而種新權限不是——分開才能讓改名先單獨上線、單獨觀察、單獨回滾。

這一支完全沒有 DDL，所以它是三支裡唯一一支「跑到一半失敗，重跑一定收斂」的——它的每一步本來就是冪等的。

**不動 `roles`、`user_roles`、`role_permissions`、`permissions` 的結構**——這次要的功能，現有的四張表全部支援得了。特別是**不加 `roles.slug`**：審閱建議用不可變的 slug 把「角色改名影響授權」這條路封死，但那條路在這個專案根本沒有打開過——`hasRole` 全專案零使用（`grep` 只在 `loginHandler.js` 的一句註解裡出現），而唯一可能被它引用的 `system-admin` 已經不可改名。加一欄要連 UI、種子資料、既有的 `0003`／`0004` 一起動，換來的保護是零。改用一個約定測試把門鎖上（§3.7）。

## 三、後端設計

### 3.1 端點一覽

**只用 `GET` 與 `POST`，動作寫在 URL 的最後一段。** `GET` 讀、`POST` 寫，沒有第三種。

| Method | Path | authType | 授權 | 原因 | 說明 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/users` | jwt | `user.mgmt` | — | 分頁清單，可搜尋、可篩狀態 |
| GET | `/api/v1/users/:id` | jwt | `user.mgmt` | — | 單一用戶，含角色 |
| POST | `/api/v1/users/create` | **jwt-device-password** | `user.mgmt` | — | 新增；帶初始密碼與角色，建立即 `must_change_password = 1` |
| POST | `/api/v1/users/:id/update` | jwt | `user.mgmt` | — | 改 `displayName`（`username` 不可改） |
| POST | `/api/v1/users/:id/disable` | jwt-password | `user.mgmt` | **必填** | 停用；同時撤銷該用戶所有 token |
| POST | `/api/v1/users/:id/enable` | jwt-password | `user.mgmt` | **必填** | 啟用；清掉鎖定與失敗計數 |
| POST | `/api/v1/users/:id/roles/assign` | **jwt-device-password** | `user.mgmt` | **必填** | 整組覆蓋該用戶的角色 |
| POST | `/api/v1/users/:id/password/reset` | **jwt-device-password** | `user.mgmt` | **必填** | 管理員重設密碼，設 `must_change_password = 1` 與 72 小時死線 |
| GET | `/api/v1/roles` | jwt | `role.mgmt` | — | 全部角色（含權限名與持有人數），不分頁 |
| POST | `/api/v1/roles/create` | jwt | `role.mgmt` | — | 新增角色（建出來是空的，沒有任何權限） |
| POST | `/api/v1/roles/:id/update` | jwt | `role.mgmt` | — | 改名稱／描述 |
| POST | `/api/v1/roles/:id/delete` | jwt-password | `role.mgmt` | **必填** | 刪除角色 |
| POST | `/api/v1/roles/:id/permissions/assign` | **jwt-device-password** | `role.mgmt` | **必填** | 整組覆蓋該角色的權限 |
| GET | `/api/v1/permissions` | jwt | `role.mgmt` | — | 權限目錄，唯讀 |
| POST | `/api/v1/user/password/change` | jwt-password | 已登入即可 | — | 使用者改自己的密碼 |
| GET | `/api/v1/audit/logs` | jwt | `user.mgmt` 或 `role.mgmt` | — | 稽核查詢，分頁 |

**`jwt-device-password`（新的認證策略）** 用在四支能提權的端點上：JWT + **已核准設備的簽章** + 當下的密碼，三者齊備才放行。

這一層加得起，是因為機制本來就在：現有的簽章輸入已經涵蓋 method、path、body hash、access token hash、timestamp 與 nonce（`DeviceBindingService.signingInput()`），nonce 表擋重放，前端 `httpClient` 的 `signed: true` 可以套在任何一個請求上——登入與續期已經在用。所以要寫的只有一個 strategy 類別（繼承 `JwtDeviceAuthStrategy`，再做一次 `verifyPasswordById()`）與前端那四支呼叫多一個參數。

擋的是這件事：**偷到 token 又偷到密碼（例如側錄），仍然提不了權**，因為簽名要用的私鑰是 IndexedDB 裡的 non-extractable `CryptoKey`，XSS 帶不走它、離開那台機器就簽不出來。剩下三支寫入（`disable`、`enable`、`roles/:id/delete`）維持 `jwt-password`：它們只斷存取、不製造權限，多一層簽章換不到相稱的好處。

**高風險動作必填原因。** `reason` 是 body 的必填欄位（`minLength: 5`、`maxLength: 190`），直接寫進 `user_audit_logs.reason`。schema 擋在最前面，handler 不必自己檢查。強制而不是選填是你的決定；代價是日常維護多一個必填欄，換到的是三個月後回頭看那一列稽核時，「為什麼」不必靠猜。

**整組覆蓋要帶上你看到的那一組（compare-and-set）。** `roles/assign` 與 `permissions/assign` 的 body 除了 `roleIds` / `permissionIds`，還要帶 `expectedRoleIds` / `expectedPermissionIds`——前端載入畫面時看到的那一組。伺服器在交易裡比對：與資料庫現值不符就回 409 `ASSIGNMENT_STALE`，要前端重載再做一次。

沒有它的話就是「最後寫入者勝出」：A 移除了某個高權限角色，B 拿著舊畫面按下儲存，那個角色會被安靜地加回去——而兩個人都覺得自己成功了。這個做法比在 `roles` 加版本號欄便宜（不動 schema），保護一樣：比對的就是那組值本身。

**為什麼不用 `PUT` / `DELETE`。** 這套介面本來就不是資源導向的：`disable`、`roles/assign`、`password/reset` 都是動作，硬要套 `PUT /users/:id` 只會逼人去猜「這次 PUT 是改名字還是改狀態」，而答案藏在 body 裡。動詞寫在 URL 上之後，一條路徑就是一個動作、一組 schema、一條授權規則——`authorizationPolicies` 與 `authType` 也才能逐個動作分開掛（同一條路徑做不到「`roles/assign` 要設備簽章、`update` 不要」）。設備審批那三支（`/bindings/:id/approve`、`/reject`、`/revoke`）已經是這個寫法，這裡只是把它變成全站慣例。

代價有兩個，都認得清楚：

- **語意上的冪等性不見了。** `PUT` 重送兩次的結果與一次相同是協定給的保證，`POST` 沒有。這裡不靠協定拿這個保證：兩支 `assign` 是帶著 expected 值的整組覆蓋（重送第二次會回 409，那正是要的），`disable` / `enable` 是設定成某個狀態（不是切換），`create` 靠 `uq_users_username` 擋重複。真的需要嚴格一次性的端點，框架有現成的 idempotency（route 的 `api.idempotency.enabled`），逐支開就行。
- **中間層（快取、反向代理）看不出這是寫入。** 影響不大：所有寫入都在 `Authorization` header 之後，本來就不會被快取。但反過來有一條硬規則：**`GET` 永遠不准有副作用**，包括「順手更新 `last_used_at`」這種。要寫就開一支 `POST`。

**`username` 建立之後不可修改**：`POST /users/:id/update` 的 `requestSchema` 只有 `displayName` 一個欄位，而 route 的 schema 一律 `additionalProperties: false`——帶了 `username` 上來的請求會在驗證那一步被退回 400，不是被安靜地忽略。要「改帳號名」就是停用舊帳號、建一個新的，稽核記錄上這兩件事各自留痕。

順帶把命名規則寫死，免得日後各處各自解釋：`username` 收進來先 `trim()`，不做大小寫轉換；**唯一性本來就是不分大小寫的**——資料庫是 `utf8mb4_unicode_ci`（見 `database/init.sql`），`Sam` 與 `sam` 會撞同一個唯一鍵，這是好事，要在 UI 的錯誤訊息裡講清楚（「這個帳號名已被使用（不分大小寫）」）。長度 3–190，字元集限 `[A-Za-z0-9._-]`：`username` 會出現在日誌、稽核與 URL 裡，允許任意 Unicode 只會換來一堆同形異碼的假帳號。

**停用與啟用是兩支端點，不是一支帶 `status` 參數的。** 兩者的後果完全不對稱——一支會把人從所有設備踢出去，另一支只是把門打開——而動詞寫在 URL 上的好處正是這種不對稱看得見：日誌、稽核與權限規則裡它們是兩件事，不是同一件事的兩個參數值。啟用時一併把 `failed_login_attempts` 歸零、`locked_until` 設回 NULL：管理員按下啟用，意思就是「這個人現在應該用得了」，留著一個十分鐘後才自動解除的鎖只會換來一通電話。

**陣列參數的形狀**：`roleIds` / `permissionIds` / `expected*` 一律 `maxItems: 50`、`uniqueItems: true`、元素是 `integer minimum 1`。空陣列是合法的（＝一個角色都不給），`null` 不是。
### 3.2 模組劃分

沿用 `UserService` 已經確立的分法——業務模組住 `src/modules/`，不進 service container，依賴由呼叫端以參數傳入（見 `UserService.js` 開頭的說明）。

| 檔案 | 負責 |
| --- | --- |
| `src/modules/user/UserAdminService.js` | 用戶的查詢、新增、修改、狀態切換、角色覆蓋、密碼設定 |
| `src/modules/role/RoleAdminService.js` | 角色的查詢、新增、修改、刪除、權限覆蓋；權限目錄查詢 |
| `src/modules/audit/AuditLogService.js` | 寫入與查詢稽核記錄 |
| `src/modules/authorization/permissionCatalogue.js` | 權限目錄的正本（純資料，無邏輯） |
| `src/modules/authorization/adminGuard.js` | §1.4 的四道守衛：重讀操作者權限、包含規則、最後一個 admin 的判斷 |

`UserService`（登入驗證那個）**不動**。它現在的責任是「這組帳密對不對、這個人有什麼角色與權限」，把管理功能塞進去只會讓登入路徑上最敏感的那個檔案愈長愈大。兩者共用的只有 `passwordHash.js`。

三個 admin 模組都吃 `{ database, logger, time }`，與 `UserService` 一致，測試不需要容器也不需要真資料庫。

**稽核寫入與變更在同一個交易裡。** `AuditLogService.record(connection, entry)` 接受一個連線而不是自己拿一條——分開兩個交易的話，變更成功而稽核失敗會留下一筆查不到來源的改動，那正是稽核要防的事。

**`adminGuard` 是一個純函式模組，不是類別**：它要的東西（操作者現在的權限、目標的角色、這次要授予什麼）全部由呼叫端查好傳進去，它只回答「可不可以」。這樣每一條守衛都測得動，不必先架一個資料庫——而這幾條規則正是最需要窮舉邊界的地方（自己授給自己、最後一個 admin、空集合、超集合）。

### 3.3 列表分頁與搜尋慣例

後端目前沒有分頁慣例（`DataTable.vue` 的註解也是這樣寫的）。這次定下來，之後所有列表 API 照抄：

**Query**：`page`（≥1，預設 1）、`pageSize`（1–100，預設 20）、`q`（選填，搜尋字串）、其餘是各自的篩選欄位（用戶清單是 `status`）、`sortBy` + `descending`（選填）。

**回應**：

```json
{ "items": [ ... ], "total": 137, "page": 1, "pageSize": 20 }
```

- `total` 是套用篩選後的總數，前端 `DataTable` 的 `rowsNumber` 直接吃它。
- `pageSize` 上限 100 寫進 schema（`maximum: 100`），不是靠 handler 自己夾——超出就回 400，而不是安靜地給你 20 筆然後讓前端以為只有這些。
- `sortBy` 只接受白名單內的欄位（用戶：`username` / `displayName` / `status` / `createdAt`），對應到寫死的 SQL 片段。**任何情況下都不把 `sortBy` 的值拼進 SQL**——那是這支 API 上唯一一個能變成注入的洞。
- `q` 走 `LIKE ?` 配 `%q%`，比對 `username` 與 `display_name`，並先跳脫 `%`、`_`、`\`。前置萬用字元用不到索引，是一次全表掃描；在用戶數幾千的量級這完全不是問題，值得為此加全文索引的那一天會很明顯。

**稽核清單用同一套 offset 分頁，這是一個已知的取捨。** 稽核表照 `occurred_at DESC` 排又持續有新列寫進來，所以翻頁期間新增的記錄會把後面的內容往後推，第 2 頁可能重覆看到第 1 頁尾巴那一列。cursor 分頁（`(occurred_at, id)` 往後帶）沒有這個問題，但它與 `DataTable` 的頁碼模式對不上，等於為了一頁唯讀的畫面另開一套前端元件。接受這個偏移：查稽核的人是照時間範圍與操作者篩選著看，不是靠頁碼記位置。真的要精準時，用時間範圍把區間收窄。

### 3.4 密碼的三條路徑

| 路徑 | 端點 | 誰打自己的密碼 | 結果 |
| --- | --- | --- | --- |
| 建立帳號 | `POST /api/v1/users/create` | 管理員（`jwt-device-password`） | 管理員設初始密碼，`must_change_password = 1`，72 小時死線 |
| 管理員重設 | `POST /api/v1/users/:id/password/reset` | 管理員（`jwt-device-password`） | 設新密碼，`must_change_password = 1`，72 小時死線，撤銷對方 token |
| 使用者自己改 | `POST /api/v1/user/password/change` | 使用者自己（`jwt-password`） | 設新密碼，`must_change_password = 0`，清掉死線，**撤銷自己所有 token** |

`jwt-password` 這個 strategy 從 body 的 `password` 欄位讀「現在的密碼」（見 `jwtPasswordAuthStrategy.js`），所以自助改密碼的 body 是 `{ password, newPassword }`——`password` 是舊的、`newPassword` 是新的。不另外發明 `currentPassword` 欄位名：那會讓這支 API 與其他 `jwt-password` 端點的形狀不一致，而 strategy 讀的欄位名是固定的。

**改完自己的密碼之後強制重新登入。** 改密碼成功 → `tokenRevocation.revoke(自己)` → 回 200 → 前端清 session、導去登入頁，附一句「密碼已更新，請用新密碼登入」。

這樣做的理由有兩個，而且兩個都不便宜地繞過：

1. 舊密碼可能已經外洩，而外洩者手上的 session 還活著。改密碼卻不把那條 session 殺掉，等於改了個寂寞。
2. 強制首次改密碼的旗標寫在 JWT 的 claim 裡（見 §3.5）。不重簽 token 的話，改完密碼手上那個 token 仍然帶著「必須改密碼」的標記，使用者會被卡在改密碼頁最多 15 分鐘。要就地重簽一個新 token 也做得到，但那要在改密碼 handler 裡重做一次登入的簽發流程（版本號、`auth_time`、設備 claim），為了省一次登入而複製那一段，不划算。

**臨時密碼 72 小時後失效。** 管理員設的那個密碼（建立帳號或重設）會寫一個 `temporary_password_expires_at = now + 72h`；使用者自己改完密碼之後這一欄設回 NULL。

登入時的判斷放在 `UserService.#checkPassword()` 裡，緊接在密碼比對成功之後：`temporary_password_expires_at` 不是 NULL 且已經過去，就回一個新的失敗原因 `TEMPORARY_EXPIRED`，對外是 401 `TEMPORARY_PASSWORD_EXPIRED`（訊息：初始密碼已逾期，請聯絡管理員重設）。這是少數幾個**不該**收斂成籠統「帳號或密碼錯誤」的失敗——它對正常使用者是一句可行動的話，而攻擊者從中學到的東西是零（他得先猜對密碼才看得到這個訊息）。

過期之後管理員重設一次就是新的 72 小時。三天沒去用的臨時密碼，本來就該當成流出來處理。

**密碼政策**：最短 12 字元，且必須同時含至少一個大寫與一個小寫英文字母。三條路徑共用一個函式，寫在 `passwordHash.js` 隔壁的 `passwordPolicy.js`——三處各寫一次的話，遲早有一處會漏（而漏掉的那一處一定是管理員設初始密碼那一條）。

檢查同時在前端做一次（即時提示）與後端做一次（`PASSWORD_TOO_WEAK`）。前端那次是為了不讓人填完整張表才被退回，不是防線；後端那次才算數。錯誤訊息要指名差在哪（「至少 12 個字元」／「需要一個大寫字母」），而不是一句「密碼不符要求」——後者只會讓人一直試。

規則就這兩條，不加數字與符號的要求：再往上加只會把密碼推向 `Password123!` 這種同時滿足所有規則、又在每一份字典裡的寫法。長度是這裡真正承重的那一條。

另外三條與規則無關、但一定要做的：

- **新密碼欄的 schema 要有 `maxLength`（200）**，而且超過就回 400，不做無聲截斷——截斷會讓使用者記住的密碼與實際存的不一樣，而他要到下次登入才發現。登入的 `password` 欄已經有 1024 的上限（見 `loginHandler.js`：那是成本上限，不是政策）。
- **不擋貼上、不擋密碼管理器、不做 `autocomplete="off"`**：那些只會把人逼回「自己想得出來的密碼」。
- **允許空格與可列印字元**，只 trim 前後空白，中間原樣保留。

（審閱報告引 NIST 建議 15 字元、取消大小寫規則，並加「已洩漏密碼」黑名單。前兩點與你剛拍板的 12 + 大小寫衝突，照你的決定走；黑名單是純加法，日後想加的話 `passwordPolicy.js` 是唯一要改的地方。）

### 3.5 強制首次改密碼怎麼硬擋

**Claim**：`must_change_password = 1` 的使用者，登入與續期時簽出來的 token 多帶一個 `mcp: true`。為 false 時不帶這個 claim，不是帶 `mcp: false`——token 每個請求都在傳，沒有意義的欄位不放進去。

**擋在哪**：`src/services/auth/jwtAuthStrategy.js` 的 `authenticate()`，排在撤銷檢查之後。`claims.mcp === true` 且這次請求不在豁免清單裡，就拋 403 `PASSWORD_CHANGE_REQUIRED`。

- 擋在認證層而不是授權層，是因為授權策略是逐條 route 宣告的，而 handler 只要自己寫了 `authorizationPolicies` 就會整組取代預設值（見 `apiDefinitionResolver.js`）——設備審批那四支就是這樣。掛在預設值上的檢查會被它們安靜地繞過，而「安靜地繞過」正是這道門最不能有的失敗方式。
- `JwtPasswordAuthStrategy` 與 `JwtDeviceAuthStrategy` 都繼承自 `JwtAuthStrategy`，所以三種認證方式一起被擋住，不必各寫一次。
- 403 而不是 401：token 本身有效。前端把任何 401 都當成「session 已死」而清憑證（見 `HttpClient.js`），用 401 會讓使用者在改密碼之前先被踢回登入頁，然後登入、再被擋、再被踢——一個迴圈。`jwtPasswordAuthStrategy.js` 對 `PASSWORD_INVALID` 用 403 是同一個判斷。

**豁免清單**（`src/services/auth/passwordChangeGate.js`）：

```
POST /api/v1/user/password/change 改密碼本身
GET  /api/v1/user/me              前端開機還原 session 要用
POST /api/v1/user/token/refresh   讓使用者填表時 session 不會在中途死掉
POST /api/v1/user/logout          永遠要留得住的一條退路
```

四條全是靜態路徑（沒有 `:param`），所以比對 `` `${req.method} ${req.path}` `` 就夠，不需要 route 物件。

**`mcp` 這個 claim 一步到位，不做兩階段。** 審閱報告提醒的滾動部署問題是真的——舊節點不認識 `mcp`，過渡期間帶著旗標的 token 打到舊節點就完全不受擋。但這個系統的部署方式是**單節點／排空後重啟**（已確認），沒有新舊並存的窗，所以那條路不存在。前提要寫在這裡：哪天真的變成多節點滾動部署，這一條與 §1.2 的權限改名都要重新走一次兩階段（先讓所有節點認得，再啟用），而不是照現在的做法直接上。

**清單會不會跟著路徑改動而失效**：會，而且失效的方式很糟——某支端點改了路徑，清單卻沒跟著改，使用者就會被永久鎖在改密碼頁，連改密碼那一支都打不通。所以加一個約定測試（比照 `test/handlerConventions.test.js` 的做法）：把 handler 目錄掃一遍、解析出所有 route，斷言豁免清單裡的每一條都真的對得上一條已註冊的 route。改路徑而忘了改清單，CI 會擋下來。

不做成啟動時自檢，是因為認證策略拿不到 route 註冊表，要拿到就得改框架的 `authStrategyRegistry.authenticate()` 簽名——為了一個 CI 抓得到的錯而動框架的介面，不值得。

### 3.6 停用即刻撤銷

`POST /api/v1/users/:id/disable` 的順序與 `RevokeDeviceHandler` 一致：**先撤銷 token，再改狀態。**

```
1. tokenRevocation.revoke(String(userId), { reason: "user_disabled" })
2. UPDATE users SET status = 'disabled' ... （與稽核寫入同一個交易）
```

反過來的話，第二步失敗會留下一個狀態已經是 `disabled`、但 token 仍然有效到自己過期為止的帳號；而重試會因為狀態已經不對而回 409，那次漏掉的撤銷永遠不會被補做。照這個順序，每一種失敗都落在安全的一邊：第一步失敗＝什麼都沒發生，重試會完整重做；第二步失敗＝多撤銷了一次（那個人被登出，但帳號還在），重試同樣會完整重做。

啟用（`POST /api/v1/users/:id/enable`）不需要撤銷任何東西，所以它只有一次寫入。

**管理員重設密碼（`POST /api/v1/users/:id/password/reset`）走同一個順序**：先 `tokenRevocation.revoke(userId, { reason: "password_reset" })`，再寫新的雜湊與 `must_change_password = 1`。理由與失敗分析完全相同——重設密碼的前提通常是舊密碼已經不可信，那麼舊 session 也一樣不可信；而萬一第二步失敗，多撤銷一次（對方被登出、密碼沒變）是安全的那一邊，重試會完整重做。

使用者自己改密碼（§3.4）同樣撤銷，只是撤的是自己。三條路徑因此有一條共通規則：**密碼變了，舊 session 就不算數。**

撤銷是每個使用者一個版本號，所以停用會讓對方在**所有**設備上一起登出——那正是這個動作要的效果。

另外提醒一件已經成立的事：`/api/v1/user/me` 用 `findActiveById()` 重讀資料庫，停用的帳號會拿到 401（`USER_INACTIVE`）；續期同樣會擋。也就是說即使撤銷那一步出了問題，被停用的人最遲也只能撐到下一次續期。

### 3.7 啟動自檢與約定測試

**（一）目錄與資料庫的比對**，放在一個 eager 的 application service：

```js
// server/src/services/authorization/PermissionCatalogueService.js
static service = Object.freeze({
  name: "permissionCatalogue",
  lifecycle: "singleton",
  dependencies: ["mysqldatabase", "logging"],
  eager: true
});
```

`initialize()` 裡做 §1.3 那張表的比對，缺項就 `throw`——容器初始化失敗會讓 `createApplication()` 失敗，`src/index.js` 的 `bootstrap().catch()` 會把它記成 `application.startup_failed` 並以非零碼結束。與 idempotency、tokenRevocation 的啟動守衛是同一個模式。

放在 `src/services/` 而不是 `src/modules/`，理由與 `deviceBinding` 相同：它需要參與容器的生命週期（要有人在啟動時叫它），而 `src/modules/` 底下的東西沒有生命週期。純資料的那份目錄仍然放 `src/modules/authorization/`，這個 service 只是讀它。

**（二）程式碼裡的權限字串也要對得上目錄。** 只比對資料庫是不夠的——`hasPermission` 的 options 裡打成 `uesr.mgmt`，資料庫那邊完全正常，而那條 route 會變成**沒有人通得過**（或更糟，如果打錯的是別的方向）。加一個約定測試（比照 `handlerConventions.test.js`）掃兩處：

- 後端所有 handler 的 `static api.authorizationPolicies` 裡出現的 permission 字串；
- 前端所有 `page.requires.permissions`（`client/` 那邊一個對應的測試）。

每一個都必須在 `PERMISSION_CATALOGUE` 裡找得到，否則測試失敗並指名是哪個檔案。這比啟動自檢更早抓到問題，而且它抓的是啟動自檢抓不到的那一半。

**（三）禁止任何 route 使用 `hasRole`。** 同一支測試多一條斷言：沒有任何 handler 的 `authorizationPolicies` 用 `hasRole`，也沒有任何頁面用 `page.requires.roles`。

理由是審閱報告點出的那個風險——角色名可以被管理員改，而 `hasRole` 讓角色名變成授權判準，兩者合起來等於「改個名字就能改變授權結果」。這個專案目前零使用（`grep` 只在一句註解裡命中），所以現在把門鎖上的成本是零；等到有人某天順手用了它，成本就變成一次事故。策略本身留在框架裡不動（那是框架的通用能力），這條規則只約束這個專案。

**（四）豁免清單對得上實際 route**（§3.5）也在同一支測試裡。四條規則放在一起，因為它們是同一類東西：**都在防「程式碼與程式碼之間安靜地對不上」**。
### 3.8 錯誤碼

| code | HTTP | 什麼時候 |
| --- | --- | --- |
| `PASSWORD_CHANGE_REQUIRED` | 403 | 帶著 `mcp` claim 打了豁免清單以外的端點 |
| `USERNAME_TAKEN` | 409 | 新增用戶時撞上 `uq_users_username` |
| `ROLE_NAME_TAKEN` | 409 | 新增／改名角色時撞上 `uq_roles_name` |
| `ROLE_PROTECTED` | 409 | 試圖修改或刪除 `system-admin` |
| `UNKNOWN_ROLE` | 400 | 配角色時給了不存在的 role id |
| `UNKNOWN_PERMISSION` | 400 | 配權限時給了不存在的 permission id |
| `PASSWORD_TOO_WEAK` | 400 | 新密碼不符政策；訊息要講清楚差在哪 |
| `PASSWORD_UNCHANGED` | 400 | 新密碼與舊密碼相同 |
| `USER_NOT_FOUND` / `ROLE_NOT_FOUND` | 404 | 目標不存在 |
| `PERMISSION_ESCALATION_DENIED` | 403 | 這次授予會給出操作者自己沒有的權限（§1.4 第二道） |
| `PERMISSION_STALE` | 403 | 操作者的權限在簽發 token 之後被改過，這次操作已經不被允許（§1.4 第四道） |
| `LAST_ADMIN_PROTECTED` | 409 | 這一步會讓系統剩不下任何 active 的 `system-admin` |
| `ASSIGNMENT_STALE` | 409 | `expectedRoleIds` / `expectedPermissionIds` 與資料庫現值不符，畫面是舊的 |
| `TEMPORARY_PASSWORD_EXPIRED` | 401 | 管理員設的臨時密碼過了 72 小時死線（登入路徑上回這個） |

唯一鍵的衝突靠**捕捉 `ER_DUP_ENTRY`**，不是「先查再寫」：先查再寫在併發下仍然會撞，而且會撞成一個 500。`DeviceBindingService.requestBinding()` 已經是這個處理方式。

---

## 四、前端設計

### 4.1 頁面一覽

全部沿用 Phase 4 的自動發現慣例：`src/pages/` 底下一個 `.vue` 檔案 `export const page`，路由、菜單、權限過濾自動生成。

| 檔案 | path | 標題 | `requires` | 菜單 |
| --- | --- | --- | --- | --- |
| `pages/system/UsersPage.vue` | `/system/users` | 用戶管理 | `{ permissions: ["user.mgmt"] }` | system / 20 |
| `pages/system/RolesPage.vue` | `/system/roles` | 角色管理 | `{ permissions: ["role.mgmt"] }` | system / 30 |
| `pages/system/AuditLogsPage.vue` | `/system/audit` | 變更紀錄 | `{ permissions: ["user.mgmt", "role.mgmt"], match: "any" }` | system / 40 |
| `pages/ChangePasswordPage.vue` | `/password/change` | 修改密碼 | 不設（＝登入即可） | 不進菜單 |

`DeviceApprovalsPage.vue` 的 `requires` 由 `device.approve` 改成 `device.mgmt`；菜單 order 10 維持不變，所以系統管理群組的順序是設備審批 → 用戶管理 → 角色管理 → 變更紀錄。

修改密碼頁不設 `requires`：`validatePages.js` 允許不宣告 `requires`，而 `routeGuard.js` 對「非 public 且沒有 `meta.requires`」的頁面只要求已登入——正是要的語意。

**沒有「用戶詳情頁」。** 新增、編輯、配角色、重設密碼全部是清單頁上的對話框（`q-dialog` 包 `FormPanel`）。管理十來個欄位的實體不需要換頁；換頁反而讓「改完回到第幾頁」這種事變成要處理的狀態。

### 4.2 service 層

| 檔案 | 對應 |
| --- | --- |
| `src/services/user.js` | `/api/v1/users*` 與 `/api/v1/user/password/change` |
| `src/services/role.js` | `/api/v1/roles*` 與 `/api/v1/permissions` |
| `src/services/audit.js` | `/api/v1/audit/logs` |

`user.js` 的 `list()` 直接吃 `DataTable` 傳來的參數形狀（`page` / `rowsPerPage` / `sortBy` / `descending` / `filter`），翻成後端的 query（`page` / `pageSize` / `sortBy` / `descending` / `q`），再把回應翻成 `{ rows, rowsNumber }`。這層翻譯只寫在 service 裡——`DataTable` 完全不理 HTTP，頁面也不該理。

`create` / `update` / `delete` 三個方法名照 `useCrud` 的固定慣例，用戶管理頁才用得上 `useCrud`。角色管理頁同理。

### 4.3 用戶管理頁

```
[搜尋框            ] [狀態: 全部 ▾]                    [+ 新增用戶]
┌────────────────────────────────────────────────────────────────┐
│ 帳號     顯示名稱   角色              狀態    建立時間   操作     │
│ sam      Sam Wong  system-admin      啟用    08-01     ⋮       │
│ amy      Amy Chan  staff, purchaser  啟用    08-14     ⋮        │
│ bob      Bob Lee   staff             已停用  08-15     ⋮        │
└────────────────────────────────────────────────────────────────┘
                                        每頁 20 ▾   ‹ 1 2 3 ›
```

`⋮` 選單：編輯、配置角色、重設密碼、停用／啟用。

五個對話框：

| 對話框 | 欄位 | 密碼 | 原因 | 設備簽章 |
| --- | --- | --- | --- | --- |
| 新增用戶 | 帳號、顯示名稱、初始密碼（＋確認）、角色（多選）、你的密碼 | 是 | — | `signed: true` |
| 編輯用戶 | 顯示名稱（帳號唯讀顯示） | 否 | — | — |
| 配置角色 | 角色多選框、原因、你的密碼 | 是 | **必填** | `signed: true` |
| 重設密碼 | 新密碼（＋確認）、原因、你的密碼 | 是 | **必填** | `signed: true` |
| 停用／啟用 | 確認訊息、原因、你的密碼 | 是 | **必填** | — |

設備簽章那一欄不需要使用者做任何事——`httpClient` 的 `signed: true` 會自己用 IndexedDB 裡的私鑰簽名（登入與續期已經在用同一條路）。它只會在一種情況下失敗：這台設備的綁定被撤銷了，那時錯誤訊息要講清楚是設備的問題，不是密碼打錯。

停用／啟用是純確認加兩個欄位，仍然用一個小對話框（`promptPassword()` 要擴成收「原因 + 密碼」兩欄）；其餘本來就有自己的表單，密碼與原因欄直接放在表單最下面——**同一個對話框同時做確認與收密碼，不要連開兩個**，先填完一張表再跳出另一個密碼框，只會讓人以為自己被登出了。

密碼欄一律放最後、標成「你的密碼」而不是「密碼」：新增用戶那張表上同時有「初始密碼」（給對方的）與「你的密碼」（證明是你），這兩個欄位擺在一起而標籤含糊的話，一定會有人把自己的密碼設成別人的初始密碼。

**新增用戶成功之後顯示一段可複製的文字**：「帳號 amy 已建立，初始密碼為 ⋯⋯，對方首次登入時必須修改。」初始密碼是管理員自己設的，這裡只是把「要把它交給本人，而且對方一定會被要求改掉」講清楚。

**配置角色的對話框要顯示每個角色帶來的權限**（`GET /api/v1/roles` 已經回權限名），否則勾選的人在猜。**操作者自己授不出去的角色（權限不是自己的子集，§1.4 第二道）在清單上直接停用並附一句「這個角色帶著你沒有的權限」**——不能讓人勾完、填完原因、打完密碼，才收到一個 403。後端那道仍然要有：前端只是把它講在前面。

**停用自己不被擋，但最後一個 `system-admin` 會被擋**（§1.4 第三道）。前端在自己那一列把「停用」標成紅色並寫明「這會立即把你自己登出」；後端回 `LAST_ADMIN_PROTECTED` 時，訊息要直接說「系統至少要保留一個啟用中的 system-admin」，而不是一句籠統的衝突。

**成功之後那句話**：配角色與配權限顯示「已儲存。管理權限即時生效；一般頁面的顯示最遲 15 分鐘內跟上」（§1.5）。

**收到 `ASSIGNMENT_STALE`（409）時不要只彈一個錯誤**：自動重載那一列的現值，把「你看到的」與「現在的」並排列出來，再讓人決定要不要重做。這個錯誤的意思是「有人在你之前改過」，而使用者需要看到的正是那個差異。

### 4.4 角色管理頁

```
                                                      [+ 新增角色]
┌────────────────────────────────────────────────────────────────┐
│ 角色名        描述          權限                用戶數  操作     │
│ system-admin  System Admin  user.mgmt +2       1      🔒       │
│ staff         一般同事      （無）              12     ⋮        │
└────────────────────────────────────────────────────────────────┘
```

- 角色不多，一次回全部（上限 200），不分頁。
- `system-admin` 那一列：操作欄是一個鎖的圖示配 tooltip「由投產腳本維護」，沒有任何可按的東西。
- 刪除角色的對話框要帶用戶數：「刪除「staff」？目前有 **12** 個用戶持有這個角色，他們會失去這個角色帶來的權限。」後端不擋（照你的決定），所以這句話是唯一一道防止誤刪的東西，它必須把後果講在前面。這個對話框同樣有密碼欄與必填的原因欄。
- 配置權限的對話框裡，**操作者自己沒有的權限不能勾**（§1.4 第二道），顯示成停用狀態加一句「你自己沒有這個權限」。對 `system-admin` 來說全部可勾，所以他看不到這個狀態——這是對的，他本來就授得出全部。
- 新增角色與改名稱／描述不需要密碼，配置權限與刪除需要——判準是「這個動作改不改得動任何人的權限」（§5.2）。
- 配置權限的對話框：權限清單來自 `GET /api/v1/permissions`，一組勾選框，每個權限顯示 `name` 與 `description`。清單旁邊一句「權限目錄由投產腳本維護，這裡只決定這個角色持有哪幾個」。

### 4.5 修改密碼與強制首次改密碼

**入口**：`AppTopbar.vue` 現在只有顯示名稱加一個登出按鈕。改成一個 `q-btn-dropdown`：顯示名稱 → 修改密碼 / 登出。這是這次對既有版面唯一的改動。

**強制模式**：`session.user.mustChangePassword` 為 true 時（後端 `USER_SCHEMA` 加這個欄位，login / refresh / me 三支都回），

- router guard 在 `routeGuard.js` 的 `resolveNavigation()` 裡加一條：已登入 + `mustChangePassword` + 目標不是修改密碼頁 → 導去修改密碼頁。順序排在權限檢查之前。
- 修改密碼頁在強制模式下換一套文案（「首次登入必須修改密碼」），並且不顯示「取消」。
- 後端那道（§3.5）才是真的攔截；前端這一層只是讓使用者看到一個講得通的畫面，而不是滿屏 403。

**`HttpClient` 不需要為 `PASSWORD_CHANGE_REQUIRED` 加任何特例**：前端 guard 正常運作時根本打不出那種請求；真的出現了（例如某支 service 直接呼叫），`ApiError.code` 會照常帶著它，畫面顯示後端那句訊息。

**改密碼成功之後**：`session.clear()` → 導去登入頁 → `notifySuccess("密碼已更新，請用新密碼登入")`。理由見 §3.4。

### 4.6 變更紀錄頁

```
[時間範圍] [操作者] [對象] [動作 ▾]
┌────────────────────────────────────────────────────────────────┐
│ 時間         操作者  動作      對象        內容         原因     │
│ 08-21 14:02  sam    配置角色  user/amy    +purchaser   轉組     │
│ 08-21 13:58  sam    停用      user/bob                 離職     │
│ 08-20 09:11  sam    配置權限  role/staff  +device.mgmt 前線自助 │
└────────────────────────────────────────────────────────────────┘
```

- 照時間倒序，走 §3.3 的分頁慣例。
- 「內容」欄把 `detail` 的前後值渲染成 `+新增 / −移除` 的形式；改密碼類的只顯示動作本身（後端根本不記密碼）。被截斷過的那幾列（§2.2）顯示一句「內容過長，已截斷」。
- 「原因」欄是操作者當下填的那句話。命令列救援腳本寫進來的列，操作者顯示成 `cli:<系統帳號>`（§5.1）——那種列在清單上要一眼看得出與介面操作不同。
- 唯讀，沒有任何操作按鈕。

### 4.7 菜單

`config/menu.js` 的 `system` 群組已經存在，四頁全部掛在它底下，不新增群組。`buildMenu()` 本來就會照 `page.requires` 過濾，所以沒有 `user.mgmt` 的人不會看到用戶管理——不需要為此寫任何程式碼。

---

## 五、安全性分析與殘留風險

### 5.1 鎖死與復原（break-glass）

守衛擋掉了最容易發生的那一種：**最後一個 active `system-admin` 停不了、也拔不掉角色**（§1.4 第三道）。剩下的路徑仍然存在，只是都需要有人繞過應用程式：

- 直接對資料庫下 SQL 把帳號停掉；
- 三個權限被從 `system-admin` 以外的角色上全部收走，而 `system-admin` 帳號的密碼沒有人記得；
- 所有 `system-admin` 的設備綁定同時失效（換電腦、清瀏覽器資料），而沒有人能審批新設備——注意這一條與帳號狀態無關，是設備那一層。

所以復原工具是必要的，不是選配。兩支腳本，都比照 `approveDevice.js` 的形式（走原生連線、不啟動整個應用程式）：

| 腳本 | 做什麼 |
| --- | --- |
| `scripts/grantRole.js <username> <role>` | 把角色授予某個帳號；帳號是 `disabled` 就一併啟用，並清掉鎖定與失敗計數 |
| `scripts/approveDevice.js`（已存在） | 核准設備綁定，解決上面第三條 |

三個要求：

1. **必須被真的演練過一次**，而且寫進 §9 的投產步驟。一支從來沒跑過的救援腳本，在半夜第一次跑的時候幾乎一定會撞上某個環境問題。
2. **每次執行都寫一列 `user_audit_logs`**，`actor_user_id` 是 NULL、`actor_username` 是 `cli:<系統帳號名>`，`reason` 由命令列參數帶進來（必填）。從命令列動生產資料庫這件事，比從介面動更需要留痕。
3. **腳本本身沒有任何守衛**——它就是那個繞過守衛的東西。能跑它的人＝能連生產資料庫的人，那道門在部署層，不在這裡。

### 5.2 什麼動作要哪一層再確認

判準不是「這個動作叫什麼名字」，而是**它動不動得了誰能進來、誰能做什麼**。分三層：

| 層級 | 端點 | 為什麼 |
| --- | --- | --- |
| **JWT + 設備簽章 + 密碼** | `users/create`、`users/:id/roles/assign`、`roles/:id/permissions/assign`、`users/:id/password/reset` | 這四支能製造權限。私鑰在 IndexedDB 且不可匯出，所以偷到 token 又偷到密碼的人，離開那台已核准的機器仍然提不了權 |
| **JWT + 密碼** | `users/:id/disable`、`enable`、`roles/:id/delete`、`user/password/change` | 斷存取或換自己的憑證。值得再確認一次「現在仍然是你」，但不製造新的權限 |
| **JWT** | `users/:id/update`、`roles/create`、`roles/:id/update` | 做完之後沒有任何人多得到或少掉任何一項存取。新建的角色是空的，要它有用還得再走一次 `permissions/assign` |

`users/create` 必須落在最上面一層，是因為它同時設密碼與配角色：少了它，一個偷到 session 的攻擊者雖然不能把 `system-admin` 加到既有帳號（那條要密碼與簽章），卻可以直接建一個已經帶著 `system-admin` 的新帳號——同樣的結果，繞過同一道門。

日後新增端點時照這條走：**做完之後，有沒有人能做到他原本做不到的事？** 能製造權限的進第一層，只斷存取的進第二層，其餘第三層。

### 5.3 收權延遲：只剩一般業務頁面

管理功能是即刻的（§1.4 第四道：管理端點重讀資料庫）。剩下的延遲只影響一般業務頁面：「這個人剛剛被移出採購角色，他現在還能不能核銷」的答案仍然是「最多再 15 分鐘可以」。

要對所有頁面都立即生效的話，路仍然在：停用帳號（即刻撤銷）再啟用。這條路現在有代價——兩次操作都要填原因、都會留稽核——而那個代價是對的：把一個人踢出所有設備，本來就該留下記錄。

### 5.4 初始密碼經由管理員之手

管理員設定初始密碼，代表在使用者第一次登入之前，有第二個人知道那個密碼。三樣東西一起把這個窗收窄：`must_change_password`（第一次登入就得換掉）、72 小時死線（§3.4）、設備綁定（攻擊者即使拿到初始密碼，從自己的機器登入仍然要等一次審批）。

**仍然沒有解決的是交付方式**：密碼從管理員傳到本人的那一段（口頭、通訊軟體、便條）不在系統裡，系統也管不到。審閱建議的一次性 activation token 是這條的正解——DB 只存 token 的雜湊，密碼由本人自己設，管理員從頭到尾不知道它。那是一次獨立的設計，這一版沒有做；知道差在哪。

### 5.5 稽核：做到哪裡，以及刻意不做的

**做的**：與變更同一個交易寫入；`reason` 必填；記操作者、對象、前後值、`request_id`、IP；密碼、雜湊、token、`Authorization` header 永遠不入表；`detail` 超過 4KB 截成摘要（§2.2）。

**刻意不做的**（審閱報告有提，但這個規模不划算）：

- **外部 append-only／WORM 副本或 SIEM**。`user_audit_logs` 是同一個資料庫裡的一張普通表，握有 DB 帳號的人改得動它。要防這件事得把記錄送出系統之外，而那需要一個這個團隊現在沒有的收集端。
- **查閱稽核本身也寫稽核**。它會讓表裡多數的列都是「某某看過稽核」，把真正要找的東西淹掉。
- **獨立的 `audit.view` 權限**。這張表裡沒有使用者的個資，只有操作者的帳號名與 IP，而看得到用戶管理的人本來就看得到那些帳號。
- **高權限授予、密碼重設、最後管理員變更的即時告警**。值得做，但它要一個通知管道（email／webhook），而這個系統目前一個都沒有——設備審批也還是靠人自己去看佇列（見 `docs/device-binding-auth.md`）。要做就跟通知機制一起做，不要只為這一件事接一條線。

這幾條的共同點是：它們都不是「寫幾行程式」，而是「多養一個東西」。現在寫在這裡，是為了讓日後真的需要時，知道當初是決定不做而不是沒想到。
## 六、對現有程式碼的改動

| 檔案 | 改動 |
| --- | --- |
| `server/database/migrations/0005_rename_device_permission.js` | **新增（Phase 0，已完成）**：`device.approve` → `device.mgmt` 改名 |
| `server/database/migrations/0006_add_user_password_columns.js` | **新增**：`users.must_change_password`、`users.temporary_password_expires_at`（各自一句 DDL，前面查 `information_schema`） |
| `server/database/migrations/0007_add_user_audit_logs.js` | **新增**：`user_audit_logs` |
| `server/database/migrations/0008_seed_user_management_permissions.js` | **新增**：種入 `user.mgmt` / `role.mgmt`、授予 `system-admin` |
| `server/src/handlers/device/deviceBindingSchemas.js` | `DEVICE_APPROVE_POLICY` → `DEVICE_MGMT_POLICY`，權限字串改 `device.mgmt` |
| `server/src/handlers/user/loginHandler.js` | `USER_SCHEMA` 加 `mustChangePassword`；簽發時視情況加 `mcp` claim |
| `server/src/handlers/user/refreshTokenHandler.js` | 同上（重讀資料庫時一併帶出旗標） |
| `server/src/modules/user/UserService.js` | `#loadUser()` 多回 `mustChangePassword`；`#checkPassword()` 加臨時密碼死線的判斷（新的 `AUTH_FAILURE.TEMPORARY_EXPIRED`） |
| `server/src/services/auth/jwtAuthStrategy.js` | 加 `mcp` claim 的檢查與豁免清單 |
| `server/src/services/auth/jwtDevicePasswordAuthStrategy.js` | **新增**：`jwt-device-password`（繼承 `JwtDeviceAuthStrategy`，再驗一次密碼） |
| `server/src/services/auth/passwordReauth.js` | **新增**：`JwtPasswordAuthStrategy` 與 `JwtDevicePasswordAuthStrategy` 共用的密碼再確認邏輯 |
| `server/src/services/auth/jwtPasswordAuthStrategy.js` | 改用 `passwordReauth.js`，原本內嵌的密碼檢查整段移出去 |
| `server/src/services/auth/passwordChangeGate.js` | **新增**：豁免清單 |
| `server/src/handlers/users/createUserHandler.js`、`assignUserRolesHandler.js`、`resetUserPasswordHandler.js`、`server/src/handlers/roles/assignRolePermissionsHandler.js` | `authType` 由 `jwt-password` 換成 `jwt-device-password`（Phase 2、3 的暫時做法在這裡補上） |
| `server/test-support/testDevice.js` | **新增**：`createTestDevice()` 從 `authFlow.integration.test.js` 搬過來，供多個整合測試檔案共用 |
| `server/src/modules/authorization/permissionCatalogue.js` | **新增**：權限目錄正本 |
| `server/src/modules/authorization/adminGuard.js` | **新增**：§1.4 的包含規則與最後一個 admin 的判斷（純函式） |
| `server/src/services/authorization/PermissionCatalogueService.js` | **新增**：啟動自檢 |
| `server/src/modules/user/UserAdminService.js` | **新增** |
| `server/src/modules/role/RoleAdminService.js` | **新增** |
| `server/src/modules/audit/AuditLogService.js` | **新增** |
| `server/src/modules/user/passwordPolicy.js` | **新增**：新密碼的共用檢查（長度、大小寫、`maxLength`、不得與舊密碼相同） |
| `server/src/handlers/users/*.js`、`roles/*.js`、`permissions/*.js`、`audit/*.js` | **新增**：§3.1 的端點，一個動作一支 handler（目錄名對應 URL 前綴，見 `handlerConventions.test.js`） |
| `server/src/handlers/user/changePasswordHandler.js` | **新增**：`POST /api/v1/user/password/change` |
| `server/scripts/createUser.js` | 註解與輸出裡的 `device.approve` 改成 `device.mgmt`；提及新的兩個權限 |
| `server/scripts/grantRole.js` | **新增**：break-glass——授予角色、啟用帳號、清鎖定，並寫一列稽核（§5.1） |
| `server/test/permissionCatalogueConventions.test.js` | **新增**：§3.7 的約定（權限字串、禁用 `hasRole`、種子與目錄一致；豁免清單那條在 Phase 4 補上） |
| `server/test/permissionCatalogueStartupGuard.test.js` | **新增**：自檢的三種處置，含「它從不寫入」那條斷言 |
| `server/test/integration/migrations.integration.test.js` | **新增**：三支 migration 對真 MySQL 的驗收與重跑收斂 |
| `server/test/adminGuard.test.js` | **新增**：四道守衛的純函式測試，含每一條規則的邊界 |
| `server/test/passwordPolicy.test.js` | **新增** |
| `server/test/auditLogService.test.js` | **新增**：含「用呼叫端給的連線，不是自己的」那條斷言 |
| `server/test/userAdminService.test.js` | **新增**：關聯式記憶體替身，寫入路徑的分岔與 §3.8 錯誤碼 |
| `server/test/integration/userManagement.integration.test.js` | **新增**：對真 MySQL 的端到端走查、提權防護、並行停用最後兩個 admin |
| `server/src/modules/authorization/directoryLookups.js` | **新增**：§1.4 第四道的共用查詢，`UserAdminService` 與 `RoleAdminService` 都用 |
| `server/src/modules/role/RoleAdminService.js` | **新增** |
| `server/src/handlers/roles/*.js`、`permissions/listPermissionsHandler.js` | **新增**：角色的五支端點 + `GET /api/v1/permissions` |
| `server/test/directoryLookups.test.js` | **新增** |
| `server/test/roleAdminService.test.js` | **新增**：關聯式記憶體替身，含 CASCADE 的模擬 |
| `server/test/integration/roleManagement.integration.test.js` | **新增**：對真 MySQL 的 `ROLE_PROTECTED`、提權防護、`ASSIGNMENT_STALE`、CASCADE 驗收 |
| `client/test/framework/authorization/permissionConventions.test.js` | **新增**：頁面 metadata 的權限字串與禁用 `requires.roles` |
| `server/test/userService.test.js` | 新增 `mustChangePassword`／`TEMPORARY_EXPIRED` 的測試，既有兩處回傳值斷言補上新欄位 |
| `server/test/jwtDevicePasswordAuthStrategy.test.js` | **新增**：設備先、密碼後的疊層順序 |
| `server/test/passwordReauth.test.js` | **新增**：密碼再確認的錯誤碼映射，兩個 strategy 共用 |
| `server/test/jwtAuthStrategyPasswordGate.test.js` | **新增**：mcp claim 的擋、豁免清單、跟撤銷檢查的順序 |
| `server/test/passwordChangeGateConventions.test.js` | **新增**：豁免清單每一條都對得上一個已註冊的 route |
| `server/test/authHandlers.test.js` | 「每種失敗同一句話」的測試排除 `TEMPORARY_EXPIRED`，另加一支測它自己的訊息 |
| `server/test/serviceContainer.test.js` | 服務發現清單加 `auth.jwtDevicePassword` |
| `server/test/applicationFactory.test.js` | 限縮版的 `serviceDiscoveryOptions.moduleUrls` 補上 `jwtDevicePasswordAuthStrategy.js` |
| `server/test/integration/passwordChange.integration.test.js` | **新增**：Phase 4 的驗收條件，含一次真的登入＋改密碼＋重新登入全流程 |
| `server/test/integration/userManagement.integration.test.js`、`roleManagement.integration.test.js` | 四支端點升級後改走真設備簽章（`signedAuthed()`），並各修一個真的會 flaky 的斷言 |
| `server/test/integration/migrations.integration.test.js` | 修同一個 flaky 斷言（見上方的說明） |
| `server/test-support/fakeMySqlPool.js` | 回答權限目錄那一句查詢——啟動自檢是 eager 的，每個測試用應用都會經過它 |
| `server/scripts/checkCoverageFloors.js` | 加 `PermissionCatalogueService.js` 的 per-file 下限 |
| `client/src/pages/device/DeviceApprovalsPage.vue` | `requires` 改 `device.mgmt` |
| `client/src/services/device.js` | 註解 |
| `client/src/framework/auth/routeGuard.js` | 加「必須改密碼」的重導 |
| `client/src/framework/layout/AppTopbar.vue` | 顯示名稱改成下拉選單（修改密碼／登出） |
| `client/src/framework/ui/confirm.js` | `promptPassword()` 擴成可收「原因 + 密碼」兩欄 |
| `client/src/pages/system/*.vue`、`ChangePasswordPage.vue` | **新增**：§4.1 的四頁 |
| `client/src/services/user.js`、`role.js`、`audit.js` | **新增**（四支提權端點帶 `signed: true`） |
| `docs/device-binding-auth.md` | 把提到 `device.approve` 的段落改成 `device.mgmt`，並註明改名發生在哪一支 migration |
| `README.md` | 權限清單、bootstrap 說明、break-glass 腳本 |
## 七、分階段實作計劃

每一階段結束時系統都應該是可跑、測試全綠的。驗收條件寫成「跑什麼、看到什麼」，不是「做完了」。

### Phase 0 — 權限改名（可獨立投產）✅ 已完成

範圍最小、風險最低的一刀，先切乾淨。

1. `0005_rename_device_permission.js`——**只有改名**，不種 `user.mgmt` / `role.mgmt`。獨立成一支而不是併進後面那支種子 migration，是因為 Phase 0 會先單獨投產：套用過的 migration 事後改內容不會重跑，所以「先寫一半、之後補上」在這裡是行不通的。
2. `deviceBindingSchemas.js`、`DeviceApprovalsPage.vue`、`createUser.js`、測試、`docs/device-binding-auth.md` 裡的字串。

**驗收**：`npm test`（前後端）全綠；跑完 migration 後 `SELECT * FROM permissions` 只看到 `device.mgmt`，而 `role_permissions` 的列數不變；用 `system-admin` 登入仍然進得了設備審批頁。

### Phase 1 — 資料模型、權限目錄與約定測試 ✅ 已完成

1. `0006`（兩個欄位）、`0007`（稽核表）migration，各自帶 `information_schema` 守衛。
2. `permissionCatalogue.js` + `PermissionCatalogueService.js`。
3. `0008` 種入 `user.mgmt` / `role.mgmt` 並授予 `system-admin`。
4. §3.7 的約定測試（權限字串、前端 metadata、禁用 `hasRole`）。

**驗收**：三支 migration 跑完啟動成功；**任何一支中途失敗後重跑都會收斂**（測試要真的模擬：第一次跑到一半拋錯，第二次跑完成功）；手動 `DELETE FROM permissions WHERE name = 'user.mgmt'` 之後啟動**失敗**且訊息指名缺哪一個；把某支 handler 的權限字串改成 `uesr.mgmt` 之後約定測試失敗。

> **實作時多出來的三件事**（都不改設計，只是設計沒寫到）：
>
> 1. **「跑到一半失敗」用假連線模擬，不用真資料庫。** 要在真資料庫上精準地製造「第一句 `ALTER` 成功、第二句沒有」，就得先 `DROP` 掉一欄——而整合測試也會在開發者自己的 `erp_dev` 上跑。改成 `migrate.test.js` 用假連線把那個中間狀態直接擺出來（破壞不到任何東西），真資料庫那邊則證明 DDL 合法、重跑收斂。
> 2. **`PermissionCatalogueService` 是 eager 的，所以每一個「啟動一個測試用應用」的測試都會經過它。** `test-support/fakeMySqlPool.js` 因此要回答權限目錄那一句查詢——那個替身代表的本來就是一個已經 migrate 過的資料庫。順帶把 `applicationFactory.test.js` 釘住的啟動查詢次數由 3 改成 4，並在註解裡寫明第四次是誰。
> 3. **前端的約定測試直接 import 後端那份目錄**（`server/src/modules/authorization/permissionCatalogue.js`，純資料、零依賴），不在前端再抄一份。抄一份的話，兩份分岔的症狀會是「前端說你看不到這一頁，後端卻放行」——而那正是這條測試要防的事。

### Phase 2 — 後端：守衛與用戶管理 ✅ 已完成

1. `adminGuard.js`（四道守衛，純函式，先寫測試）。
2. `UserAdminService` + `AuditLogService`（含交易共用連線、`reason`、`detail` 截斷）。
3. `passwordPolicy.js`（含臨時密碼死線）。
4. 用戶的八支端點（§3.1 前八列），含 compare-and-set 與即時重讀。
5. 停用即刻撤銷（§3.6）。

**驗收**：單元測試涵蓋 §3.8 每一個錯誤碼；整合測試（真資料庫）走一次「建帳號 → 配角色 → 停用 → 用舊 token 打任一端點被擋 → 啟用 → 重新登入」；**只有 `user.mgmt` 的帳號把 `system-admin` 指派給自己會回 403**；**兩個請求同時停用最後兩個 admin，只有一個成功**；`user_audit_logs` 對每一次變更各有一列（`reason` 有值），且 handler 拋錯的那次沒有留下任何列。

> **實作時發現、且已修正的一件事：guard 3 的 SQL 在真 MySQL 上跑不動。** §1.4 原本給的那句 `UPDATE` 在單元測試（假連線）上看起來完全合理，對著真 MySQL 才會拋 `ER_UPDATE_TABLE_USED`——第二個 `EXISTS` 子查詢用不同別名 `JOIN` 了正在被更新的 `users` 表本身，MySQL 不允許這樣寫。修法是在那個子查詢外面再包一層 `derived table`，逼 MySQL 先把結果物化成暫存表。§1.4 的 SQL 範例已經同步改成修正後的版本，並附上這個限制的說明。這正是「每個 Phase 都要求整合測試對真資料庫驗收」存在的理由——這個錯誤在假連線的單元測試裡完全不會出現。
>
> **實作時多出來的三件事**（都不改設計，只是設計沒寫到）：
>
> 1. **三支提權端點（`create`、`roles/assign`、`password/reset`）暫時掛 `jwt-password`，不是終態的 `jwt-device-password`。** 後者要到 Phase 4 才存在（`jwtDevicePasswordAuthStrategy.js` 是 Phase 4 的產物）。每支 handler 上都留了註解指向這件事，Phase 4 落地時把 `authType` 換掉即可，這是唯一要改的地方。
> 2. **`GET /api/v1/audit/logs` 這支端點沒有在 Phase 2 做。** Phase 2 的範圍明確寫的是「§3.1 前八列」，稽核查詢是第 16 列；`AuditLogService` 本身（寫入那一半）已經在用了，讀取的 HTTP 端點留給之後——它與 Phase 6 的前端稽核頁天生綁在一起，屆時一起做。
> 3. **`UserAdminService` 的 constructor 多吃一個 `tokenRevocation`**，不是文件寫的「三個 admin 模組都吃 `{database, logger, time}`」。停用與重設密碼都要在改資料庫之前先撤銷對方的 token（§3.6），這個能力只有 `tokenRevocation` 有——`RoleAdminService`（Phase 3）不需要它，所以這個差異只在 `UserAdminService` 上。

### Phase 3 — 後端：角色與權限目錄 ✅ 已完成

1. `RoleAdminService`。
2. 角色的五支端點 + `GET /api/v1/permissions`。
3. `system-admin` 的保護（§1.4 第一道）。

**驗收**：對 `system-admin` 做四種寫入動作都回 409 `ROLE_PROTECTED`；只有 `role.mgmt` 的帳號替某角色加上 `user.mgmt` 會回 403；用舊的 `expectedPermissionIds` 送出會回 409 `ASSIGNMENT_STALE`；刪除一個有用戶持有的角色會成功，且那些用戶的 `user_roles` 列跟著消失（`CASCADE` 的行為要有測試釘住，因為我們刻意不擋它）。

> **實作時多出來的一件事：§1.4 第四道的重讀邏輯抽成共用模組。** `UserAdminService`（Phase 2）與 `RoleAdminService` 原本會各自長出一份幾乎一模一樣的「重讀操作者現況、跟 claims 比對」私有方法——這是第二次真的需要同一段邏輯，所以抽成 `server/src/modules/authorization/directoryLookups.js`（會碰資料庫，所以不放進刻意保持純函式的 `adminGuard.js`）。`UserAdminService.js` 同步改用它，原本的私有方法整段刪掉；既有的 Phase 2 測試全部重跑過，行為不變。
>
> **`roles/:id/permissions/assign` 同樣暫時掛 `jwt-password`**，終態的 `jwt-device-password` 要 Phase 4 才存在——與 Phase 2 那三支的理由完全相同（見 `assignRolePermissionsHandler.js` 的註解）。

### Phase 4 — 後端：密碼、強制改密碼與設備簽章 ✅ 已完成

1. `POST /api/v1/user/password/change`。
2. `mcp` claim（login / refresh）+ `jwtAuthStrategy` 的擋 + `passwordChangeGate.js`。
3. `jwtDevicePasswordAuthStrategy.js`，四支提權端點改掛它。
4. `USER_SCHEMA` 加 `mustChangePassword`。

**驗收**：整合測試——管理員建帳號 → 新帳號登入 → 打 `/api/v1/users` 得 403 `PASSWORD_CHANGE_REQUIRED` → 打 `/api/v1/user/me` 得 200 → 改密碼 → 舊 token 全部失效 → 用新密碼登入 → 這次打 `/api/v1/users` 通過（權限足夠時）。另外：**沒有帶簽章的請求打提權端點會被擋**；**用過的 nonce 重放會被擋**；臨時密碼過了 72 小時之後登入回 `TEMPORARY_PASSWORD_EXPIRED`。

> **實作時多出來的三件事**（都不改設計，只是設計沒寫到）：
>
> 1. **密碼再次確認的邏輯抽成 `passwordReauth.js`。** `JwtPasswordAuthStrategy` 與新的 `JwtDevicePasswordAuthStrategy` 都需要一模一樣的「讀 body 的 `password`、呼叫 `verifyPasswordById`、把失敗原因映射成對外錯誤碼」——這是第二次真的需要同一段邏輯（跟 Phase 3 把 §1.4 第四道抽成 `directoryLookups.js`是同一個判斷），所以抽出來共用，並在這裡順便把 `TEMPORARY_PASSWORD_EXPIRED` 也接進去：密碼再確認時遇到一支已過期的臨時密碼，回應跟登入時遇到的是同一個錯誤碼，不必另外決定一次。`JwtPasswordAuthStrategy.js` 同步改用它，既有測試全部重跑過，行為不變。
> 2. **`createTestDevice()`（整合測試裡簽真設備簽章用的那個 helper）從 `authFlow.integration.test.js` 搬到 `test-support/testDevice.js`。** 四支提權端點升級成 `jwt-device-password` 之後，`userManagement.integration.test.js`、`roleManagement.integration.test.js`、新增的 Phase 4 整合測試都需要它——第三個真的要用的地方，不是預先抽的。
> 3. **既有的兩支整合測試（Phase 1 的 `migrations.integration.test.js`、Phase 3 新增的一支）各修了一個真的會 flaky 的斷言**：兩者都對 `permissions` 表做「剛好只有這幾項」的 `deepEqual`，而 `node --test` 預設跨檔案平行跑，這句偶爾會夾在另一個整合測試檔案（`authFlow.integration.test.js` 的 `seedUser()`）暫時種下的一次性權限中間。改成「這幾項都在」的子集檢查——這才是那兩支測試真正該保證的事，不該連帶保證資料庫裡沒有別人手動加的東西。

### Phase 5 — 前端：用戶與角色管理

1. `services/user.js`、`services/role.js`（四支提權端點帶 `signed: true`）。
2. `UsersPage.vue`、`RolesPage.vue` 與各自的對話框（原因欄、密碼欄、授不出去的選項停用）。
3. `AppTopbar.vue` 的下拉選單、`ChangePasswordPage.vue`、`routeGuard.js` 的重導。
4. `promptPassword()` 擴成收「原因 + 密碼」。

**驗收**：`npm test`（client）綠；沒有 `user.mgmt` 的帳號在菜單裡看不到用戶管理，直接打 `/system/users` 會被導去 `/403`；帶著 `mustChangePassword` 的 session 不管導去哪一頁都會回到修改密碼頁；`ASSIGNMENT_STALE` 會觸發重載並列出差異。

### Phase 6 — 前端：變更紀錄；以及 break-glass 演練

1. `services/audit.js` + `AuditLogsPage.vue`。
2. `scripts/grantRole.js`，並**在測試環境真的跑一次**（停用最後一個 admin → 用腳本救回來）。

**驗收**：頁面能翻頁、能按操作者與動作篩選；`detail` 的前後值渲染正確；救援演練的每一步都寫進 §9 的 runbook。
## 八、測試計劃

沿用現有的分層與涵蓋率門檻（`scripts/checkCoverageFloors.js`）。

**後端單元**：`adminGuard` / `UserAdminService` / `RoleAdminService` / `AuditLogService` 用 `fakeMySqlPool` 與 `createTestTime`，不碰真資料庫。重點：唯一鍵衝突翻成 409、覆蓋是全成或全不成、`system-admin` 保護、密碼政策與臨時密碼死線的邊界、稽核內容（尤其是「密碼、token、`Authorization` header 永遠不出現在 `detail` 或訊息裡」）。

**授權矩陣**（每支端點各一組）：有權限、沒權限、權限已過期（`PERMISSION_STALE`）、未登入。這是最容易漏測又最容易寫錯的一塊，所以用資料驅動的表格跑，不是每支端點各寫一段。

**提權的負面測試**（明確列出來，因為它們是這次設計的重點）：

- 只有 `user.mgmt` 的人把 `system-admin` 指派給自己 → 403；
- 只有 `user.mgmt` 的人指派一個帶 `role.mgmt` 的角色給別人 → 403；
- 只有 `role.mgmt` 的人替自己的角色加上 `user.mgmt` → 403；
- 移除對方一個「自己也沒有的權限」的角色 → **允許**（降權不受包含規則限制）；
- 操作者的權限在簽 token 之後被收走，他再打管理端點 → 403 `PERMISSION_STALE`。

**並發測試**（真資料庫）：

- 兩個請求同時停用最後兩個 `system-admin` → 只有一個成功，另一個 409；
- 兩個管理員同時覆蓋同一個角色的權限 → 後者回 409 `ASSIGNMENT_STALE`，資料庫是前者的完整結果，不是兩者的混合。

**部署與遷移**：三支 migration 各自「跑到一半失敗 → 重跑 → 收斂」；`device.approve` 尚未改名的舊資料庫配新程式 → 啟動自檢失敗且訊息說得清楚。

**約定測試**（§3.7）：權限字串（後端 + 前端）、禁用 `hasRole`、豁免清單、handler 目錄與 URL 前綴（既有）。

**啟動守衛測試**：權限目錄缺項時 `createApplication()` 失敗（比照 `test/idempotencyStartupGuards.test.js`）。

**設備簽章**：提權端點少了簽章、簽章對不上 body、nonce 重放、設備已被撤銷——四種各一。

**憑證不外洩**：一支專門的測試掃過所有回應、日誌與稽核列，斷言裡面不含任何密碼欄位的值。

**前端**：`services/*.js` 的參數翻譯（`DataTable` 形狀 ↔ 後端 query）與 `signed: true` 有沒有掛對；`routeGuard` 的強制改密碼分支；四頁的權限 metadata（比照 `client/test/services/device.test.js`）。
## 九、投產步驟

部署方式是**單節點／排空後重啟**（已確認），所以不需要新舊並存的相容窗。這個前提如果變了，§1.2 的權限改名與 §3.5 的 `mcp` claim 都要改成兩階段。

以下是 Phase 1–6 一起投產的步驟。**Phase 0 自己投產時走的是同一套，只是第 3 步只有 `0005`、第 5 步只驗設備審批頁。** 那一次要特別留意的是第 6 步：改名當下已經簽發的 token 帶的仍然是舊的 `device.approve` claim。

1. **備份資料庫。** 這次有兩支 DDL 與一支種子 migration，備份是回滾的唯一保證。
2. **排空舊節點**（停止進新請求，等現有請求結束），確認沒有舊版程式還在跑。
3. **跑 migration**：`node scripts/migrate.js`——`0006` 加欄位、`0007` 建稽核表、`0008` 種入權限（`0005` 的改名已經在 Phase 0 跑過了）。三支都可以重複執行；中途失敗就修完再跑一次，不要手動補 SQL。
4. **啟動新版程式。** 順序不能反：舊版程式配新 schema 沒問題（多兩欄、多一張表它不看），但新版程式配舊 schema 會在啟動自檢那一步直接拒絕啟動——那是刻意的。
5. **驗收**：用 `system-admin` 登入，確認菜單出現用戶管理、角色管理、變更紀錄；`GET /api/v1/permissions` 回三個權限；設備審批頁仍然進得去。
6. **告知使用者**（這一步屬於 Phase 0 那一次投產）：改名前簽發的 token 帶的仍然是舊的 `device.approve` claim，設備審批頁在一次背景續期（最多 15 分鐘）之內可能回 403，重新整理即可。刻意不做補償——它會自己好，而為了它撤銷全體 token 反而會把所有人踢出去一次。
7. **演練一次 break-glass**（第一次投產時做，之後每次改動 IAM 相關程式時重做）：在測試環境停用最後一個 admin，用 `scripts/grantRole.js` 救回來，把每一步的實際指令記進 runbook。

**回滾**：

- `0006`、`0007` 是純新增（兩欄、一張表），舊版程式不會讀它們，程式碼回滾即可，不必回滾 schema。
- `0008` 種的 `user.mgmt` / `role.mgmt` 留著無害：舊版程式不認得，也不會用到。
- 要**回滾到 Phase 0 之前**才是不對稱的那一步：`0005` 的改名對舊版程式是破壞性的（它找的是 `device.approve`），所以回滾程式碼之後設備審批會失效，必須一併 `UPDATE permissions SET name = 'device.approve' WHERE name = 'device.mgmt'`。
- 這一條寫在這裡，是為了讓決定回滾的人當下就看得到，而不是回滾完才發現審批頁壞了。
