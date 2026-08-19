function matchesClaim(required, actual, match) {
  if (!required || required.length === 0) {
    return true;
  }

  const actualSet = new Set(actual);
  return match === "any"
    ? required.some((value) => actualSet.has(value))
    : required.every((value) => actualSet.has(value));
}

/**
 * 同後端 hasRole / hasPermission 嘅比對邏輯一致（見
 * server/src/framework/authorization/authorizationPolicyRegistry.js 嘅
 * matchesClaim）：每種 claim 各自預設 match "all"，roles 同 permissions
 * 兩組要求之間係 AND（對應後端一條路由可以掛多個 policy，全部要過）。
 */
export function can(session, requires = {}) {
  if (!session.isAuthenticated) {
    return false;
  }

  const match = requires.match || "all";
  return (
    matchesClaim(requires.roles, session.roles, match) &&
    matchesClaim(requires.permissions, session.permissions, match)
  );
}
