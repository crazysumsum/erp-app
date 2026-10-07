import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { assertActorFresh, loadRoleNamesForUser, loadPermissionNamesForUser } from "../authorization/directoryLookups.js";
import { SALES_PERMISSIONS } from "./salesConstants.js";

export async function requireSalesActor(connection, claims, permission) {
  if (!SALES_PERMISSIONS.includes(permission)) throw new TypeError("Unknown Sales permission");
  const actor = await assertActorFresh(connection, claims);
  if (!actor.username || !actor.permissions.includes(permission)) {
    throw new ApplicationError("Sales permission is required", { code: "FORBIDDEN", statusCode: 403, publicMessage: "沒有執行此銷售操作的權限" });
  }
  return actor;
}


export async function requireSalesWriteActor(connection, claims) {
  const actor = await requireSalesActor(connection, claims, "sales.mgmt");
  if (!actor.permissions.includes("sales.view")) throw new ApplicationError("Sales view permission is required", { code: "FORBIDDEN", statusCode: 403 });
  return actor;
}

export async function requireSalesRecoveryActor(connection, actorId) {
  if (!Number.isSafeInteger(actorId) || actorId < 1) throw new TypeError("Invalid recovery actor");
  const [[user]] = await connection.query("SELECT username FROM users WHERE id = ? AND status = 'active'", [actorId]);
  if (!user?.username) throw new ApplicationError("Original Sales actor is inactive", { code: "FORBIDDEN", statusCode: 403 });
  const roles = await loadRoleNamesForUser(connection, actorId);
  const permissions = await loadPermissionNamesForUser(connection, actorId);
  if (!["sales.view", "sales.mgmt"].every(name => permissions.includes(name)))
    throw new ApplicationError("Original Sales actor no longer has permission", { code: "FORBIDDEN", statusCode: 403 });
  return { id: actorId, username: user.username, roles, permissions };
}
