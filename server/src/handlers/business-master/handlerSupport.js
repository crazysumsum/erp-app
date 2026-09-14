import { createHash } from "node:crypto";
import { createBusinessMasterAdminService } from "../../modules/businessMaster/businessMasterFactory.js";

export function actorInput(req) {
  const rawKey = req.get?.("Idempotency-Key") ?? "";
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions,
    correlationId: req.requestId ?? "",
    idempotencyKeyHash: rawKey ? createHash("sha256").update(rawKey).digest("hex") : null
  };
}

export function adminService(services) { return createBusinessMasterAdminService(services); }
