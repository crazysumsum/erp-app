import assert from "node:assert/strict";
import test from "node:test";
import { requireSalesActor } from "../../src/modules/sales/salesAuthorization.js";

function connection({ active = true, roles = [], permissions = [] } = {}) {
  return { query: async (sql) => [sql.includes("SELECT username") ? (active ? [{ username: "synthetic-actor" }] : []) :
    (sql.includes("SELECT DISTINCT") ? permissions : roles).map((name) => ({ name }))] };
}

test("TC-008 Sales fresh actor rejects inactive empty claims and does not inherit permissions", async () => {
  const input = { actorId: 1, claimedRoles: [], claimedPermissions: [] };
  await assert.rejects(requireSalesActor(connection({ active: false }), input, "sales.view"), { code: "FORBIDDEN" });
  await assert.rejects(requireSalesActor(connection({ permissions: ["sales.mgmt"] }), { ...input, claimedPermissions: ["sales.mgmt"] }, "sales.view"), { code: "FORBIDDEN" });
  await assert.rejects(requireSalesActor(connection({ roles: ["system-admin"] }), { ...input, claimedRoles: ["system-admin"] }, "sales.import"), { code: "FORBIDDEN" });
  await assert.rejects(requireSalesActor(connection(), { ...input, claimedPermissions: ["sales.view"] }, "sales.view"), { code: "PERMISSION_STALE" });
  const actor = await requireSalesActor(connection({ permissions: ["sales.view"] }), { ...input, claimedPermissions: ["sales.view"] }, "sales.view");
  assert.equal(actor.id, 1);
  await assert.rejects(requireSalesActor(connection(), input, "unknown"), TypeError);
});
