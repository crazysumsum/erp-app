import { hashPassword, verifyPassword } from "./passwordHash.js";

/**
 * 使用者查詢與登入憑證驗證。
 *
 * 這是一個**業務模組**，不是框架的 service：它住在 src/module/ 而不是
 * src/services/，不宣告 static service metadata，也不參與 service container 的
 * 自動發現。需要它的 handler 直接 import 再自己建一個，把它要用的技術服務
 * （資料庫、日誌、時間）當參數傳進來。
 *
 * 這樣分是因為兩者的壽命不一樣：src/services/ 底下的東西換一個專案照樣適用，
 * 由框架負責發現、注入、排初始化順序；業務模組只在這個專案有意義，讓它走同一
 * 套註冊機制只會把業務邏輯綁進框架的生命週期，換來的好處是零。
 *
 * 只負責「這組帳密對不對，這個人有什麼角色與權限」。簽發 token 不在這裡：那需要
 * 同時持有 jwt 與 tokenRevocation 兩個 service，而登入 handler 本來就兩個都
 * 拿得到（見 JwtService.issue() 的註解）。
 */

// 連續失敗幾次之後鎖定帳號。
const MAX_FAILED_ATTEMPTS = 5;

// 鎖定多久（毫秒）。到期後自動解鎖，不需要人工介入——鎖定是為了讓線上暴力破解
// 慢到不可行，不是為了懲罰打錯密碼的人。
const LOCKOUT_MS = 15 * 60 * 1000;

// 使用者不存在時，仍然跑一次雜湊比對用的假雜湊。見 authenticate() 的說明。
const DUMMY_HASH_PASSWORD = "dummy-password-for-constant-time-comparison";

/**
 * 登入失敗的原因。一律不會出現在 API 回應裡——回應只有一句籠統的「帳號或密碼
 * 錯誤」，避免洩漏某個帳號是否存在。這個分類只寫進日誌，給防守方看。
 */
export const AUTH_FAILURE = Object.freeze({
  UNKNOWN_USER: "unknown_user",
  BAD_PASSWORD: "bad_password",
  LOCKED: "locked",
  DISABLED: "disabled"
});

export class UserService {
  /**
   * 依賴以參數傳入，不從 container 取：這個模組不知道 container 存在，所以測試
   * 直接給替身就好，不需要先架一個容器。
   */
  constructor({ database, logger, time } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("UserService requires database, logger and time");
    }

    this.database = database;
    this.logger = logger;
    this.time = time;
    this.dummyHash = null;
  }

  /**
   * 驗證一組帳密。
   *
   * 成功回傳 `{ ok: true, user }`，失敗回傳 `{ ok: false, reason }`——失敗不是
   * 例外，因為它是這條路徑上最尋常的結果，而且呼叫端對每一種原因的處理方式
   * 完全相同（回同一句錯誤）。真正的例外（資料庫掛了、雜湊壞了）照樣往上丟。
   */
  async authenticate(username, password) {
    const row = await this.#findByUsername(username);
    const nowMs = this.time.nowMs();

    if (!row) {
      // 使用者不存在時如果直接返回，這條路徑會比「使用者存在但密碼錯」快兩個
      // 數量級（scrypt 約 86ms），回應時間本身就成了帳號存在與否的探測器。
      // 跑一次同樣成本的比對把兩條路徑的時間拉平。
      await this.#burnPasswordComparison(password);
      return { ok: false, reason: AUTH_FAILURE.UNKNOWN_USER };
    }

    if (row.status !== "active") {
      await this.#burnPasswordComparison(password);
      return { ok: false, reason: AUTH_FAILURE.DISABLED };
    }

    if (row.locked_until !== null && Number(row.locked_until) > nowMs) {
      // 鎖定期間不比對密碼：比對是這個端點最貴的操作，而鎖定的用意正是讓
      // 攻擊者不能靠不停送密碼把它跑起來。
      return { ok: false, reason: AUTH_FAILURE.LOCKED };
    }

    if (!(await verifyPassword(password, row.password_hash))) {
      await this.#recordFailedAttempt(row, nowMs);
      return { ok: false, reason: AUTH_FAILURE.BAD_PASSWORD };
    }

    await this.#clearFailedAttempts(row.id, nowMs);

    return { ok: true, user: await this.#loadUser(row) };
  }

  /**
   * 依 id 載入使用者及其角色與權限。找不到或已停用回傳 null。
   *
   * /me 用它重新讀一次資料庫，而不是直接回 token 裡的 claims：claims 是簽發當下
   * 的快照，帳號在那之後可能已經被停用或改了權限。
   */
  async findActiveById(id) {
    const [rows] = await this.database.query(
      `SELECT id, username, display_name, status
       FROM users
       WHERE id = ? AND status = 'active'`,
      [id]
    );

    return rows.length === 0 ? null : this.#loadUser(rows[0]);
  }

  async #findByUsername(username) {
    const [rows] = await this.database.query(
      `SELECT id, username, password_hash, display_name, status,
              failed_login_attempts, locked_until
       FROM users
       WHERE username = ?`,
      [String(username ?? "")]
    );

    return rows.length === 0 ? null : rows[0];
  }

  /**
   * 載入角色與權限。權限是「使用者的角色所擁有的權限」的聯集。
   */
  async #loadUser(row) {
    const [roleRows] = await this.database.query(
      `SELECT r.name
       FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?
       ORDER BY r.name`,
      [row.id]
    );

    const [permissionRows] = await this.database.query(
      `SELECT DISTINCT p.name
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = ?
       ORDER BY p.name`,
      [row.id]
    );

    return {
      id: Number(row.id),
      username: row.username,
      displayName: row.display_name,
      roles: roleRows.map((role) => role.name),
      permissions: permissionRows.map((permission) => permission.name)
    };
  }

  async #recordFailedAttempt(row, nowMs) {
    const attempts = Number(row.failed_login_attempts) + 1;
    const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? nowMs + LOCKOUT_MS : null;

    await this.database.execute(
      `UPDATE users
       SET failed_login_attempts = ?, locked_until = ?, updated_at = ?
       WHERE id = ?`,
      [attempts, lockedUntil, nowMs, row.id]
    );

    if (lockedUntil !== null) {
      await this.logger.warn(
        "auth.login.locked",
        "The account was locked after repeated failed logins",
        { userId: Number(row.id), attempts, lockedUntilMs: lockedUntil }
      );
    }
  }

  async #clearFailedAttempts(userId, nowMs) {
    await this.database.execute(
      `UPDATE users
       SET failed_login_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      [nowMs, userId]
    );
  }

  /**
   * 花掉一次與真正比對相同成本的雜湊運算。假雜湊只算一次就快取起來——每次重算
   * 會讓這條路徑變成兩倍成本，反而又成了另一個方向的時間訊號。
   */
  async #burnPasswordComparison(password) {
    this.dummyHash ??= await hashPassword(DUMMY_HASH_PASSWORD);
    await verifyPassword(password, this.dummyHash);
  }
}
