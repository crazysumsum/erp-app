import { assertPermissionsCurrent } from "./adminGuard.js";

/**
 * 用戶／角色／權限之間的共用查詢，以及 §1.4 第四道守衛的完整流程。
 *
 * `UserAdminService`（Phase 2）與 `RoleAdminService`（Phase 3）都要在每一支
 * 寫入方法開頭做同一件事：重讀操作者現在的角色與權限，跟 token claims 比對。
 * 抽出來共用是因為兩邊原本各自長出一份幾乎一模一樣的私有方法——這是第二次
 * 真的需要同一段邏輯，不是預先猜測。
 *
 * 這裡會碰資料庫，所以不放進 adminGuard.js：那個檔案刻意保持純函式（見它開頭
 * 的說明），比對本身仍然呼叫 `assertPermissionsCurrent`，這裡只多了「去哪裡
 * 讀現況」那一半。
 */

export async function loadRoleNamesForUser(connection, userId) {
  const [rows] = await connection.query(
    `SELECT r.name
       FROM roles r JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
      ORDER BY r.name`,
    [userId]
  );

  return rows.map((row) => row.name);
}

export async function loadPermissionNamesForUser(connection, userId) {
  const [rows] = await connection.query(
    `SELECT DISTINCT p.name
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?
      ORDER BY p.name`,
    [userId]
  );

  return rows.map((row) => row.name);
}

/**
 * 重讀操作者現在的角色與權限，跟 claims 比對；不符就 403 PERMISSION_STALE
 * （`assertPermissionsCurrent` 拋出）。回傳操作者現在真正持有的角色與權限，
 * 餵給需要判斷提權的呼叫端。
 *
 * 找不到操作者（帳號被刪除或停用）時，直接把「現在」視為空集合——一個空集合
 * 幾乎必然跟 claims 對不上，會自然地被同一句比對擋下，不必另開一個錯誤碼。
 */
export async function assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions }) {
  const [rows] = await connection.query(
    "SELECT username FROM users WHERE id = ? AND status = 'active'",
    [actorId]
  );

  const roles = rows.length === 0 ? [] : await loadRoleNamesForUser(connection, actorId);
  const permissions =
    rows.length === 0 ? [] : await loadPermissionNamesForUser(connection, actorId);

  assertPermissionsCurrent({
    claimedRoles,
    claimedPermissions,
    currentRoles: roles,
    currentPermissions: permissions
  });

  return { id: actorId, username: rows[0]?.username ?? "", roles, permissions };
}
