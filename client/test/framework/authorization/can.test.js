import { describe, expect, it } from "vitest";
import { can } from "@/framework/authorization/can.js";

function session({ authenticated = true, roles = [], permissions = [] } = {}) {
  return { isAuthenticated: authenticated, roles, permissions };
}

describe("can", () => {
  it("未登入永遠 false，唔理 requires 係咩", () => {
    expect(can(session({ authenticated: false }), {})).toBe(false);
    expect(can(session({ authenticated: false }), { permissions: ["order.read"] })).toBe(false);
  });

  it("冇 requires 就已登入即通過", () => {
    expect(can(session(), {})).toBe(true);
  });

  it("預設 match all：要求全部符合先算過", () => {
    const s = session({ permissions: ["order.read"] });

    expect(can(s, { permissions: ["order.read", "order.write"] })).toBe(false);
    expect(can(s, { permissions: ["order.read"] })).toBe(true);
  });

  it("match any：中一個就算過", () => {
    const s = session({ permissions: ["order.read"] });

    expect(can(s, { permissions: ["order.read", "order.write"], match: "any" })).toBe(true);
    expect(can(s, { permissions: ["order.write", "order.delete"], match: "any" })).toBe(false);
  });

  it("roles 同 permissions 兩組要求之間係 AND", () => {
    const s = session({ roles: ["admin"], permissions: [] });

    expect(can(s, { roles: ["admin"] })).toBe(true);
    expect(can(s, { roles: ["admin"], permissions: ["order.read"] })).toBe(false);
  });
});
