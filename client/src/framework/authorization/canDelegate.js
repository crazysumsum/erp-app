// The server checks catalogue membership and the final role combination on every write.
// The role and permission pickers only receive names from that catalogue.
export function canDelegate(session, permission, targetIsActor) {
  return session.permissions.includes(permission) || (
    session.roles.includes("system-admin") && !targetIsActor &&
    !["user.mgmt", "role.mgmt", "device.mgmt"].includes(permission)
  );
}
