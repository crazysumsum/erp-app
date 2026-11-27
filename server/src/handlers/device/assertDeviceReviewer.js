import { assertActorFresh } from "../../modules/authorization/directoryLookups.js";
import { ApplicationError } from "../../framework/errors/ApplicationError.js";

export async function assertDeviceReviewer(connection, claims) {
  const actor = await assertActorFresh(connection, {
    actorId: Number(claims.sub), claimedRoles: claims.roles, claimedPermissions: claims.permissions
  });
  if (!actor.permissions.includes("device.mgmt")) {
    throw new ApplicationError("Device management permission is required", {
      statusCode: 403, code: "PERMISSION_DENIED", publicCode: "PERMISSION_DENIED"
    });
  }
  return actor;
}
