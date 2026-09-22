import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { AuditLogService } from "../audit/AuditLogService.js";
import {
  assertNoPermissionEscalation,
  assertRoleNotProtected,
  newlyGrantedPermissions
} from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";

/**
 * 角色的查詢、新增、修改、刪除、權限覆蓋；權限目錄查詢。
 * 設計說明見 docs/user_management/design_spec.md §3.1–§3.2、§1.4。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與 UserAdminService
 * 同一個理由。不需要 `tokenRevocation`：角色與權限的變更本來就要等 token
 * 過期或被撤銷才對一般業務端點生效（§1.5），這裡沒有「立即踢人下線」這件事
 * ——那是帳號層級的動作，屬於 UserAdminService。
 */

function notFound(id) {
  return new ApplicationError(`Role ${id} not found`, {
    code: "ROLE_NOT_FOUND",
    statusCode: 404,
    publicCode: "ROLE_NOT_FOUND",
    publicMessage: "找不到這個角色"
  });
}

function roleNameTaken() {
  return new ApplicationError("Role name is already taken", {
    code: "ROLE_NAME_TAKEN",
    statusCode: 409,
    publicCode: "ROLE_NAME_TAKEN",
    publicMessage: "這個角色名稱已被使用"
  });
}

function unknownPermissions(permissionIds) {
  return new ApplicationError(`Unknown permission id(s): ${permissionIds.join(", ")}`, {
    code: "UNKNOWN_PERMISSION",
    statusCode: 400,
    publicCode: "UNKNOWN_PERMISSION",
    publicMessage: "選擇的權限不存在",
    details: { permissionIds },
    publicDetails: { permissionIds }
  });
}

function assignmentStale() {
  return new ApplicationError("The permission set changed since it was loaded", {
    code: "ASSIGNMENT_STALE",
    statusCode: 409,
    publicCode: "ASSIGNMENT_STALE",
    publicMessage: "畫面上的資料已過期，請重新整理後再試"
  });
}

function isDuplicateEntry(error) {
  return (error?.cause?.code || error?.code) === "ER_DUP_ENTRY";
}

function sameIdSet(a, b) {
  const setA = new Set(a.map(Number));
  const setB = new Set(b.map(Number));
  return setA.size === setB.size && [...setA].every((id) => setB.has(id));
}

export class RoleAdminService {
  constructor({ database, logger, time } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("RoleAdminService requires database, logger and time");
    }

    this.database = database;
    this.logger = logger;
    this.time = time;
    this.auditLog = new AuditLogService({ database, logger, time });
  }

  /**
   * 全部角色，含各自的權限名與持有人數，不分頁——角色的數量級是十位數，不是
   * 用戶那種量級，分頁只會讓管理員多按幾次下一頁。
   */
  async list({ actorId, claimedRoles, claimedPermissions }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const [roleRows] = await this.database.query(
      `SELECT r.id, r.name, r.description,
              (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
         FROM roles r
        ORDER BY r.name`
    );

    const [permissionRows] = await this.database.query(
      `SELECT rp.role_id, p.name
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        ORDER BY p.name`
    );

    const permissionsByRole = new Map();
    for (const row of permissionRows) {
      const roleId = Number(row.role_id);
      const names = permissionsByRole.get(roleId) ?? [];
      names.push(row.name);
      permissionsByRole.set(roleId, names);
    }

    return roleRows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      description: row.description,
      userCount: Number(row.user_count),
      permissions: permissionsByRole.get(Number(row.id)) ?? []
    }));
  }

  /** 建出來是空的，沒有任何權限——不需要提權檢查：新角色的權限集合是空集合。 */
  async create({ actorId, claimedRoles, claimedPermissions, name, description, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();
      const normalizedName = String(name ?? "").trim();

      let roleId;
      try {
        const [result] = await connection.execute(
          "INSERT INTO roles (name, description, created_at) VALUES (?, ?, ?)",
          [normalizedName, String(description ?? ""), nowMs]
        );
        roleId = result.insertId;
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw roleNameTaken();
        }
        throw error;
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "role.create",
        targetType: "role",
        targetId: roleId,
        targetLabel: normalizedName,
        requestId,
        ip
      });

      return { id: Number(roleId), name: normalizedName, description: String(description ?? "") };
    });
  }

  async update({ actorId, claimedRoles, claimedPermissions, id, name, description, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const target = await this.#requireRole(connection, id);
      assertRoleNotProtected(target.name);

      // roles 沒有 updated_at 欄位（見 0003_add_auth_tables.js），所以這裡不像
      // UserAdminService 的其他寫入方法那樣需要先讀一次 this.time.nowMs()。
      const normalizedName = String(name ?? "").trim();

      try {
        await connection.execute(
          "UPDATE roles SET name = ?, description = ? WHERE id = ?",
          [normalizedName, String(description ?? ""), id]
        );
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw roleNameTaken();
        }
        throw error;
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "role.update",
        targetType: "role",
        targetId: id,
        targetLabel: normalizedName,
        detail: {
          name: { before: target.name, after: normalizedName },
          description: { before: target.description, after: String(description ?? "") }
        },
        requestId,
        ip
      });

      return { id: Number(id), name: normalizedName, description: String(description ?? "") };
    });
  }

  /**
   * 刪除角色。`role_permissions` 與 `user_roles` 都對 `role_id` 設了
   * `ON DELETE CASCADE`（見 0003_add_auth_tables.js），所以持有這個角色的用戶
   * 會連帶失去它——刻意不擋這件事：先停用角色再手動清所有持有人的成本，遠高於
   * CASCADE 直接做掉，而且管理員刪角色的意圖本來就是「這個角色不該再存在」。
   */
  async delete({ actorId, claimedRoles, claimedPermissions, id, reason, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const target = await this.#requireRole(connection, id);
      assertRoleNotProtected(target.name);

      await connection.execute("DELETE FROM roles WHERE id = ?", [id]);

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "role.delete",
        targetType: "role",
        targetId: id,
        targetLabel: target.name,
        reason,
        requestId,
        ip
      });

      return { id: Number(id) };
    });
  }

  /** 整組覆蓋該角色的權限（compare-and-set + 提權防護第一、二道）。 */
  async assignPermissions({
    actorId,
    claimedRoles,
    claimedPermissions,
    id,
    permissionIds = [],
    expectedPermissionIds = [],
    reason,
    requestId,
    ip
  }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const target = await this.#requireRole(connection, id);
      assertRoleNotProtected(target.name);

      // 鎖住這個角色現有的權限列——compare-and-set 的「compare」與「set」必須
      // 是同一個交易看到的同一份現況，理由與 UserAdminService.assignRoles 相同。
      const [currentRows] = await connection.query(
        "SELECT permission_id FROM role_permissions WHERE role_id = ? FOR UPDATE",
        [id]
      );
      const currentPermissionIds = currentRows.map((row) => Number(row.permission_id));

      if (!sameIdSet(currentPermissionIds, expectedPermissionIds)) {
        throw assignmentStale();
      }

      const permissions = await this.#permissionsByIds(connection, permissionIds);
      const nextPermissionNames = permissions.map((permission) => permission.name);
      const currentPermissionNames = await this.#permissionNamesByIds(connection, currentPermissionIds);

      const granted = newlyGrantedPermissions(currentPermissionNames, nextPermissionNames);
      assertNoPermissionEscalation({
        actorRoles: actor.roles,
        actorPermissions: actor.permissions,
        grantedPermissions: granted
      });

      await connection.execute("DELETE FROM role_permissions WHERE role_id = ?", [id]);
      for (const permissionId of permissionIds) {
        await connection.execute(
          "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
          [id, permissionId]
        );
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "role.permissions",
        targetType: "role",
        targetId: id,
        targetLabel: target.name,
        reason,
        detail: { permissions: { before: currentPermissionNames, after: nextPermissionNames } },
        requestId,
        ip
      });

      return { id: Number(id), permissions: nextPermissionNames };
    });
  }

  /** 權限目錄，唯讀。 */
  async listPermissions({ actorId, claimedRoles, claimedPermissions }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const [rows] = await this.database.query(
      "SELECT id, name, description FROM permissions ORDER BY name"
    );

    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      description: row.description
    }));
  }

  // --- 內部 --------------------------------------------------------------

  async #requireRole(connection, id) {
    const [rows] = await connection.query(
      "SELECT id, name, description FROM roles WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      throw notFound(id);
    }

    return rows[0];
  }

  /** 驗證一組權限 id 全部存在，否則指名缺哪幾個。 */
  async #permissionsByIds(connection, permissionIds) {
    if (permissionIds.length === 0) {
      return [];
    }

    const placeholders = permissionIds.map(() => "?").join(",");
    const [rows] = await connection.query(
      `SELECT id, name FROM permissions WHERE id IN (${placeholders})`,
      permissionIds
    );

    const found = new Set(rows.map((row) => Number(row.id)));
    const missing = permissionIds.filter((id) => !found.has(Number(id)));

    if (missing.length > 0) {
      throw unknownPermissions(missing);
    }

    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  /** 已知存在的一組權限 id（例如剛鎖住的現況），取它們的名字，不再驗證存在性。 */
  async #permissionNamesByIds(connection, permissionIds) {
    if (permissionIds.length === 0) {
      return [];
    }

    const placeholders = permissionIds.map(() => "?").join(",");
    const [rows] = await connection.query(
      `SELECT name FROM permissions WHERE id IN (${placeholders})`,
      permissionIds
    );

    return rows.map((row) => row.name);
  }
}
