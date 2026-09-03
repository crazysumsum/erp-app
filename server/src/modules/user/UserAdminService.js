import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { AuditLogService } from "../audit/AuditLogService.js";
import {
  assertLastActiveAdminPreserved,
  assertNoPermissionEscalation,
  lastAdminProtectedError,
  newlyGrantedPermissions
} from "../authorization/adminGuard.js";
import { assertActorFresh, loadRoleNamesForUser } from "../authorization/directoryLookups.js";
import { hashPassword } from "./passwordHash.js";
import { assertPasswordChanged, assertPasswordStrength } from "./passwordPolicy.js";

/**
 * 用戶的查詢、新增、修改、狀態切換、角色覆蓋、密碼設定。
 * 設計說明見 docs/user_management/design_spec.md §3.1–§3.6。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與 UserService 同一個
 * 理由（見那個檔案開頭的說明）。多吃一個 `tokenRevocation`：停用與重設密碼都
 * 要在改資料庫之前先撤銷對方的 token（§3.6），這個能力只有它有。
 *
 * 每一支公開方法都以 `actorId` / `claimedRoles` / `claimedPermissions` 開頭——
 * 分別是 `req.auth.claims.sub`、`req.auth.claims.roles`、
 * `req.auth.claims.permissions`。方法內第一件事永遠是重讀操作者現在的角色與
 * 權限、跟這三個值比對（§1.4 第四道），不符就 403 `PERMISSION_STALE`。這個
 * reread 同時把操作者現在真正持有的權限交給需要判斷「授不出自己沒有的權限」
 * 的方法使用——兩者本來就要知道同一件事，共用一次查詢。
 */

const TEMPORARY_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

const SORT_COLUMNS = Object.freeze({
  username: "username",
  displayName: "display_name",
  status: "status",
  createdAt: "created_at"
});

function notFound(id) {
  return new ApplicationError(`User ${id} not found`, {
    code: "USER_NOT_FOUND",
    statusCode: 404,
    publicCode: "USER_NOT_FOUND",
    publicMessage: "找不到這個用戶"
  });
}

function usernameTaken() {
  return new ApplicationError("Username is already taken", {
    code: "USERNAME_TAKEN",
    statusCode: 409,
    publicCode: "USERNAME_TAKEN",
    publicMessage: "這個帳號名已被使用（不分大小寫）"
  });
}

function unknownRoles(roleIds) {
  return new ApplicationError(`Unknown role id(s): ${roleIds.join(", ")}`, {
    code: "UNKNOWN_ROLE",
    statusCode: 400,
    publicCode: "UNKNOWN_ROLE",
    publicMessage: "選擇的角色不存在",
    details: { roleIds }
  });
}

function assignmentStale() {
  return new ApplicationError("The role set changed since it was loaded", {
    code: "ASSIGNMENT_STALE",
    statusCode: 409,
    publicCode: "ASSIGNMENT_STALE",
    publicMessage: "畫面上的資料已過期，請重新整理後再試"
  });
}

function isDuplicateEntry(error) {
  return (error?.cause?.code || error?.code) === "ER_DUP_ENTRY";
}

/** `%`、`_`、`\` 是 LIKE 的萬用字元／跳脫字元，使用者輸入的字面值要先跳脫。
 * MySQL LIKE 預設的跳脫字元就是反斜線，所以不需要另外加 ESCAPE 子句。 */
function escapeLikeTerm(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function sameIdSet(a, b) {
  const setA = new Set(a.map(Number));
  const setB = new Set(b.map(Number));
  return setA.size === setB.size && [...setA].every((id) => setB.has(id));
}

export class UserAdminService {
  constructor({ database, logger, time, tokenRevocation } = {}) {
    if (!database || !logger || !time || !tokenRevocation) {
      throw new TypeError(
        "UserAdminService requires database, logger, time and tokenRevocation"
      );
    }

    this.database = database;
    this.logger = logger;
    this.time = time;
    this.tokenRevocation = tokenRevocation;
    this.auditLog = new AuditLogService({ database, logger, time });
  }

  async list({
    actorId,
    claimedRoles,
    claimedPermissions,
    page = 1,
    pageSize = 20,
    q = "",
    status,
    sortBy = "username",
    descending = false
  }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const term = String(q ?? "").trim();
    if (term) {
      const escaped = `%${escapeLikeTerm(term)}%`;
      conditions.push("(username LIKE ? OR display_name LIKE ?)");
      params.push(escaped, escaped);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sortColumn = SORT_COLUMNS[sortBy] ?? SORT_COLUMNS.username;
    const direction = descending ? "DESC" : "ASC";
    const offset = (page - 1) * pageSize;

    const [totalRows] = await this.database.query(
      `SELECT COUNT(*) AS total FROM users ${whereClause}`,
      params
    );
    const [rows] = await this.database.query(
      `SELECT id, username, display_name, status, created_at
         FROM users ${whereClause}
        ORDER BY ${sortColumn} ${direction}
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      items: rows.map((row) => this.#toSummary(row)),
      total: Number(totalRows[0].total),
      page,
      pageSize
    };
  }

  async getById({ actorId, claimedRoles, claimedPermissions, id }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const [rows] = await this.database.query(
      `SELECT id, username, display_name, status, created_at, must_change_password
         FROM users WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      throw notFound(id);
    }

    const roles = await this.#rolesForUser(this.database, id);

    return {
      ...this.#toSummary(rows[0]),
      mustChangePassword: Boolean(rows[0].must_change_password),
      roles
    };
  }

  async create({
    actorId,
    claimedRoles,
    claimedPermissions,
    username,
    displayName,
    password,
    roleIds = [],
    requestId,
    ip
  }) {
    const normalizedUsername = String(username ?? "").trim();
    const normalizedPassword = assertPasswordStrength(password);

    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, {
        actorId,
        claimedRoles,
        claimedPermissions
      });

      const roles = await this.#rolesByIds(connection, roleIds);
      const nextPermissionNames = await this.#permissionNamesForRoleIds(connection, roleIds);
      const granted = newlyGrantedPermissions([], nextPermissionNames);
      assertNoPermissionEscalation({ actorPermissions: actor.permissions, grantedPermissions: granted });

      const passwordHash = await hashPassword(normalizedPassword);
      const nowMs = this.time.nowMs();
      const expiresAt = nowMs + TEMPORARY_PASSWORD_TTL_MS;

      let userId;
      try {
        const [result] = await connection.execute(
          `INSERT INTO users
             (username, password_hash, display_name, status, must_change_password,
              temporary_password_expires_at, failed_login_attempts, created_at, updated_at)
           VALUES (?, ?, ?, 'active', 1, ?, 0, ?, ?)`,
          [normalizedUsername, passwordHash, String(displayName ?? ""), expiresAt, nowMs, nowMs]
        );
        userId = result.insertId;
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw usernameTaken();
        }
        throw error;
      }

      for (const role of roles) {
        await connection.execute(
          "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
          [userId, role.id]
        );
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "user.create",
        targetType: "user",
        targetId: userId,
        targetLabel: normalizedUsername,
        detail: { roles: roles.map((role) => role.name) },
        requestId,
        ip
      });

      return {
        id: Number(userId),
        username: normalizedUsername,
        displayName: String(displayName ?? ""),
        roles: roles.map((role) => role.name)
      };
    });
  }

  async update({ actorId, claimedRoles, claimedPermissions, id, displayName, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, {
        actorId,
        claimedRoles,
        claimedPermissions
      });
      const target = await this.#requireUser(connection, id);
      const nowMs = this.time.nowMs();

      await connection.execute(
        "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
        [String(displayName ?? ""), nowMs, id]
      );

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "user.update",
        targetType: "user",
        targetId: id,
        targetLabel: target.username,
        detail: { displayName: { before: target.display_name, after: String(displayName ?? "") } },
        requestId,
        ip
      });

      return this.#toSummary({ ...target, display_name: String(displayName ?? "") });
    });
  }

  /**
   * 停用。先撤銷 token，再改狀態（§3.6）——反過來的話，改狀態失敗會留下一個
   * 帳號已停用、token 卻還活著的狀態；照這個順序，任何失敗都落在安全的一邊。
   *
   * 已經是停用狀態的帳號視為冪等：回傳現況，不撤銷、不寫稽核——POST 沒有協定
   * 保證的冪等性，這裡是自己選擇讓這支端點的行為看起來像有（見 §3.1）。
   */
  async disable({ actorId, claimedRoles, claimedPermissions, id, reason, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, {
        actorId,
        claimedRoles,
        claimedPermissions
      });
      const target = await this.#requireUser(connection, id);

      if (target.status !== "active") {
        return this.#toSummary(target);
      }

      // 純函式的預檢查用「這個帳號現在還算不算 active admin」建模成一次角色
      // 變更：currentRoleNames 是他現在的角色，nextRoleNames 給空陣列——停用
      // 之後他不再能以任何身份行動，效果等同角色被拔光。
      const currentRoleNames = await loadRoleNamesForUser(connection, id);
      const otherActiveAdminCount = await this.#otherActiveAdminCount(connection, id);
      assertLastActiveAdminPreserved({
        currentRoleNames,
        nextRoleNames: [],
        otherActiveAdminCount
      });

      // 通過預檢查之後才撤銷：被擋下的停用不該先把人踢下線。
      await this.tokenRevocation.revoke(String(id), { reason: "user_disabled" });

      const nowMs = this.time.nowMs();
      // 第二個 EXISTS 子查詢要判斷「除了這一列以外還有沒有別的 active admin」，
      // 需要 JOIN 到 users 本身——但 MySQL 不允許在 UPDATE 的子查詢裡以任何別名
      // 直接讀被更新的那張表（ER_UPDATE_TABLE_USED: "You can't specify target
      // table 'users' for update in FROM clause"），設計文件 §1.4 給的原始 SQL
      // 在真資料庫上會直接炸掉，這裡用一個外層再包一次 derived table 的寫法
      // 繞過限制：MySQL 會先把子查詢物化成一張暫存表，之後的讀取就不再算是
      // 「直接讀目標表」。第一個 NOT EXISTS 不需要這個包裝，因為它的子查詢本身
      // 沒有 JOIN users，只是拿外層那一列的 id 當常數比對，不受這條限制。
      const [result] = await connection.execute(
        `UPDATE users SET status = 'disabled', updated_at = ?
         WHERE id = ? AND status = 'active'
           AND (
             NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                         WHERE ur.user_id = users.id AND r.name = 'system-admin')
             OR EXISTS (
               SELECT 1 FROM (
                 SELECT u2.id AS id FROM user_roles ur2
                   JOIN roles r2 ON r2.id = ur2.role_id
                   JOIN users u2 ON u2.id = ur2.user_id
                  WHERE r2.name = 'system-admin' AND u2.status = 'active' AND u2.id <> ?
               ) AS other_active_admins
             )
           )`,
        [nowMs, id, id]
      );

      if (result.affectedRows === 0) {
        // 通過預檢查之後，唯一還能讓這句影響 0 列的原因是同一個交易之外、在
        // 預檢查與這句 UPDATE 之間發生的並行變更——極窄的競態窗。這個分支下
        // token 已經撤銷；接受這個代價（多撤銷一次，帳號仍是 active，下一次
        // 停用會完整重做），理由與 §3.6 對技術性失敗的分析相同。
        throw lastAdminProtectedError();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "user.disable",
        targetType: "user",
        targetId: id,
        targetLabel: target.username,
        reason,
        requestId,
        ip
      });

      return this.#toSummary({ ...target, status: "disabled" });
    });
  }

  /**
   * 啟用。不需要撤銷任何東西——這是打開一扇門，不是關上一扇。一併把
   * `failed_login_attempts` 歸零、`locked_until` 設回 NULL：管理員按下啟用，
   * 意思就是「這個人現在應該用得了」。
   */
  async enable({ actorId, claimedRoles, claimedPermissions, id, reason, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, {
        actorId,
        claimedRoles,
        claimedPermissions
      });
      const target = await this.#requireUser(connection, id);

      if (target.status === "active") {
        return this.#toSummary(target);
      }

      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE users
         SET status = 'active', failed_login_attempts = 0, locked_until = NULL, updated_at = ?
         WHERE id = ?`,
        [nowMs, id]
      );

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "user.enable",
        targetType: "user",
        targetId: id,
        targetLabel: target.username,
        reason,
        requestId,
        ip
      });

      return this.#toSummary({ ...target, status: "active" });
    });
  }

  /**
   * 整組覆蓋該用戶的角色（compare-and-set + 提權防護第二、三道）。
   */
  async assignRoles({
    actorId,
    claimedRoles,
    claimedPermissions,
    id,
    roleIds = [],
    expectedRoleIds = [],
    reason,
    requestId,
    ip
  }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, {
        actorId,
        claimedRoles,
        claimedPermissions
      });
      const target = await this.#requireUser(connection, id);

      // 鎖住這個使用者現有的角色列——compare-and-set 的「compare」與後面的
      // 「set」必須是同一個交易看到的同一份現況，否則兩個並行請求各自比對
      // 通過、各自覆蓋，跟完全沒有 compare-and-set 沒有兩樣。
      const [currentRows] = await connection.query(
        "SELECT role_id FROM user_roles WHERE user_id = ? FOR UPDATE",
        [id]
      );
      const currentRoleIds = currentRows.map((row) => Number(row.role_id));

      if (!sameIdSet(currentRoleIds, expectedRoleIds)) {
        throw assignmentStale();
      }

      const roles = await this.#rolesByIds(connection, roleIds);
      const nextRoleNames = roles.map((role) => role.name);
      const currentRoleNames = await loadRoleNamesForUser(connection, id);

      const currentPermissionNames = await this.#permissionNamesForRoleIds(
        connection,
        currentRoleIds
      );
      const nextPermissionNames = await this.#permissionNamesForRoleIds(connection, roleIds);
      const granted = newlyGrantedPermissions(currentPermissionNames, nextPermissionNames);
      assertNoPermissionEscalation({ actorPermissions: actor.permissions, grantedPermissions: granted });

      const otherActiveAdminCount = await this.#otherActiveAdminCount(connection, id);
      assertLastActiveAdminPreserved({ currentRoleNames, nextRoleNames, otherActiveAdminCount });

      await connection.execute("DELETE FROM user_roles WHERE user_id = ?", [id]);
      for (const roleId of roleIds) {
        await connection.execute(
          "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
          [id, roleId]
        );
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "user.roles",
        targetType: "user",
        targetId: id,
        targetLabel: target.username,
        reason,
        detail: { roles: { before: currentRoleNames, after: nextRoleNames } },
        requestId,
        ip
      });

      return { id: Number(id), roles: nextRoleNames };
    });
  }

  /**
   * 管理員重設密碼。先撤銷 token，再寫新的雜湊（§3.6，理由與停用相同）。
   */
  async resetPassword({
    actorId,
    claimedRoles,
    claimedPermissions,
    id,
    newPassword,
    reason,
    requestId,
    ip
  }) {
    const normalizedPassword = assertPasswordStrength(newPassword);

    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, {
        actorId,
        claimedRoles,
        claimedPermissions
      });
      const target = await this.#requireUserWithHash(connection, id);

      await assertPasswordChanged(normalizedPassword, target.password_hash);

      // 重設密碼的前提通常是舊密碼已經不可信，那麼舊 session 也一樣不可信。
      await this.tokenRevocation.revoke(String(id), { reason: "password_reset" });

      const passwordHash = await hashPassword(normalizedPassword);
      const nowMs = this.time.nowMs();
      const expiresAt = nowMs + TEMPORARY_PASSWORD_TTL_MS;

      await connection.execute(
        `UPDATE users
         SET password_hash = ?, must_change_password = 1, temporary_password_expires_at = ?, updated_at = ?
         WHERE id = ?`,
        [passwordHash, expiresAt, nowMs, id]
      );

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "user.password.reset",
        targetType: "user",
        targetId: id,
        targetLabel: target.username,
        reason,
        requestId,
        ip
      });

      return { id: Number(id) };
    });
  }

  // --- 內部 ------------------------------------------------------------------

  async #requireUser(connection, id) {
    const [rows] = await connection.query(
      "SELECT id, username, display_name, status, created_at FROM users WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      throw notFound(id);
    }

    return rows[0];
  }

  async #requireUserWithHash(connection, id) {
    const [rows] = await connection.query(
      "SELECT id, username, password_hash FROM users WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      throw notFound(id);
    }

    return rows[0];
  }

  async #rolesForUser(connection, userId) {
    const [rows] = await connection.query(
      `SELECT r.id, r.name
         FROM roles r JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
        ORDER BY r.name`,
      [userId]
    );

    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  /** 給定一組候選的角色 id（不一定是任何人現有的角色），算出它們聯集的權限。 */
  async #permissionNamesForRoleIds(connection, roleIds) {
    if (roleIds.length === 0) {
      return [];
    }

    const placeholders = roleIds.map(() => "?").join(",");
    const [rows] = await connection.query(
      `SELECT DISTINCT p.name
         FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id IN (${placeholders})`,
      roleIds
    );

    return rows.map((row) => row.name);
  }

  /** 驗證一組角色 id 全部存在，否則指名缺哪幾個。 */
  async #rolesByIds(connection, roleIds) {
    if (roleIds.length === 0) {
      return [];
    }

    const placeholders = roleIds.map(() => "?").join(",");
    const [rows] = await connection.query(
      `SELECT id, name FROM roles WHERE id IN (${placeholders})`,
      roleIds
    );

    const found = new Set(rows.map((row) => Number(row.id)));
    const missing = roleIds.filter((id) => !found.has(Number(id)));

    if (missing.length > 0) {
      throw unknownRoles(missing);
    }

    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  async #otherActiveAdminCount(connection, excludeUserId) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id
        WHERE r.name = 'system-admin' AND u.status = 'active' AND u.id <> ?`,
      [excludeUserId]
    );

    return Number(rows[0].count);
  }

  #toSummary(row) {
    return {
      id: Number(row.id),
      username: row.username,
      displayName: row.display_name,
      status: row.status,
      createdAt: Number(row.created_at)
    };
  }
}
