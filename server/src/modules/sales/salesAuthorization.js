import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
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
