import assert from "node:assert/strict";
import test from "node:test";
import { RoleAdminService } from "../src/modules/role/RoleAdminService.js";
import { createTestTime } from "../test-support/createTestTime.js";

/**
 * 同 userAdminService.test.js 的理由：用一個關聯式的記憶體替身，因為這支
 * service 的正確性建立在好幾句 SQL 對同一份資料的結果彼此一致上。
 *
 * `list()` 的動態聚合、以及 CASCADE 真的會不會清掉 user_roles，交給對真
 * MySQL 的整合測試——FK 的 ON DELETE 行為不是這裡的假連線該負責驗證的事。
 */

const NOW_MS = 1_700_000_000_000;
const SYSTEM_ADMIN = { id: 1, name: "system-admin", description: "System Admin" };
const STAFF = { id: 2, name: "staff", description: "" };

function createFakeDatabase({
  users = [],
  roles = [SYSTEM_ADMIN, STAFF],
  permissions = [],
  userRoles = [],
  rolePermissions = []
} = {}) {
  const state = {
    users: new Map(users.map((u) => [u.id, { ...u }])),
    roles: new Map(roles.map((r) => [r.id, { ...r }])),
    permissions: new Map(permissions.map((p) => [p.id, { ...p }])),
    userRoles: new Set(userRoles.map(([u, r]) => `${u}:${r}`)),
    rolePermissions: new Set(rolePermissions.map(([r, p]) => `${r}:${p}`)),
    auditRows: [],
    nextRoleId: roles.reduce((max, r) => Math.max(max, r.id), 0) + 1
  };

  function roleIdsOfUser(userId) {
    return [...state.userRoles]
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => Number(key.split(":")[1]));
  }

  function permissionIdsOfRole(roleId) {
    return [...state.rolePermissions]
      .filter((key) => key.startsWith(`${roleId}:`))
      .map((key) => Number(key.split(":")[1]));
  }

  async function run(sql, params = []) {
    if (sql.includes("SELECT username FROM users WHERE id = ? AND status = 'active'")) {
      const user = state.users.get(params[0]);
      return [user && user.status === "active" ? [{ username: user.username }] : []];
    }

    if (sql.includes("FROM roles r JOIN user_roles ur")) {
      const roleIds = roleIdsOfUser(params[0]);
      const names = roleIds.map((id) => state.roles.get(id)?.name).filter(Boolean).sort();
      return [names.map((name) => ({ name }))];
    }

    if (sql.includes("JOIN user_roles ur ON ur.role_id = rp.role_id")) {
      const roleIds = roleIdsOfUser(params[0]);
      const permIds = new Set(roleIds.flatMap((r) => permissionIdsOfRole(r)));
      const names = [...permIds].map((id) => state.permissions.get(id)?.name).filter(Boolean).sort();
      return [names.map((name) => ({ name }))];
    }

    if (sql.includes("(SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id)")) {
      const rows = [...state.roles.values()]
        .map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          user_count: [...state.userRoles].filter((key) => key.endsWith(`:${role.id}`)).length
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [rows];
    }

    if (sql.includes("SELECT rp.role_id, p.name")) {
      const rows = [...state.rolePermissions]
        .map((key) => {
          const [roleId, permId] = key.split(":").map(Number);
          return { role_id: roleId, name: state.permissions.get(permId)?.name };
        })
        .filter((row) => row.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      return [rows];
    }

    if (sql.includes("INSERT INTO roles")) {
      const [name, description, nowMs] = params;
      if ([...state.roles.values()].some((r) => r.name === name)) {
        const error = new Error("Duplicate entry");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      const id = state.nextRoleId++;
      state.roles.set(id, { id, name, description, created_at: nowMs });
      return [{ insertId: id }];
    }

    if (sql.includes("SELECT id, name, description FROM roles WHERE id = ?")) {
      const role = state.roles.get(params[0]);
      return [role ? [{ ...role }] : []];
    }

    if (sql.includes("UPDATE roles SET name = ?, description = ?")) {
      const [name, description, id] = params;
      const role = state.roles.get(id);
      if (!role) return [{ affectedRows: 0 }];
      if ([...state.roles.values()].some((r) => r.id !== id && r.name === name)) {
        const error = new Error("Duplicate entry");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      role.name = name;
      role.description = description;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("DELETE FROM roles WHERE id = ?")) {
      const [id] = params;
      state.roles.delete(id);
      // 模擬 ON DELETE CASCADE：user_roles 與 role_permissions 對 role_id 都設了它。
      for (const key of [...state.userRoles]) {
        if (key.endsWith(`:${id}`)) state.userRoles.delete(key);
      }
      for (const key of [...state.rolePermissions]) {
        if (key.startsWith(`${id}:`)) state.rolePermissions.delete(key);
      }
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("SELECT permission_id FROM role_permissions WHERE role_id = ? FOR UPDATE")) {
      return [permissionIdsOfRole(params[0]).map((permission_id) => ({ permission_id }))];
    }

    if (sql.includes("SELECT id, name FROM permissions WHERE id IN")) {
      const rows = params
        .map((id) => state.permissions.get(id))
        .filter(Boolean)
        .map((p) => ({ id: p.id, name: p.name }));
      return [rows];
    }

    if (sql.includes("SELECT name FROM permissions WHERE id IN")) {
      const rows = params.map((id) => state.permissions.get(id)).filter(Boolean).map((p) => ({ name: p.name }));
      return [rows];
    }

    if (sql.includes("DELETE FROM role_permissions WHERE role_id = ?")) {
      const [id] = params;
      for (const key of [...state.rolePermissions]) {
        if (key.startsWith(`${id}:`)) state.rolePermissions.delete(key);
      }
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("INSERT INTO role_permissions")) {
      const [roleId, permissionId] = params;
      state.rolePermissions.add(`${roleId}:${permissionId}`);
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("FROM permissions ORDER BY name")) {
      const rows = [...state.permissions.values()]
        .map((p) => ({ id: p.id, name: p.name, description: p.description }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [rows];
    }

    if (sql.includes("INSERT INTO user_audit_logs")) {
      state.auditRows.push(params);
      return [{ affectedRows: 1 }];
    }

    throw new Error(`Unhandled SQL in fake database: ${sql}`);
  }

  return {
    state,
    query: run,
    execute: run,
    withTransaction: async (work) => work({ query: run, execute: run })
  };
}

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };
  return { entries, debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

function createService({ database, logger = collectingLogger() } = {}) {
  const time = createTestTime({ clock: () => new Date(NOW_MS) });
  const service = new RoleAdminService({ database, logger, time });
  return { service, logger };
}

const ADMIN_ACTOR = {
  actorId: 10,
  claimedRoles: ["system-admin"],
  claimedPermissions: ["user.mgmt", "role.mgmt", "device.mgmt"]
};

function seedWithAdmin(overrides = {}) {
  return createFakeDatabase({
    users: [{ id: 10, username: "admin", status: "active" }],
    permissions: [
      { id: 100, name: "user.mgmt", description: "" },
      { id: 101, name: "role.mgmt", description: "" },
      { id: 102, name: "device.mgmt", description: "" }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]],
    rolePermissions: [
      [SYSTEM_ADMIN.id, 100],
      [SYSTEM_ADMIN.id, 101],
      [SYSTEM_ADMIN.id, 102]
    ],
    ...overrides
  });
}

test("constructor requires database, logger and time", () => {
  assert.throws(() => new RoleAdminService({}), TypeError);
});

// --- list -----------------------------------------------------------------

test("list returns every role with its permission names and holder count", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  const roles = await service.list(ADMIN_ACTOR);

  const admin = roles.find((r) => r.name === "system-admin");
  assert.deepEqual(admin.permissions, ["device.mgmt", "role.mgmt", "user.mgmt"]);
  assert.equal(admin.userCount, 1);

  const staff = roles.find((r) => r.name === "staff");
  assert.deepEqual(staff.permissions, []);
  assert.equal(staff.userCount, 0);
});

// --- create -----------------------------------------------------------------

test("create makes an empty role with no permissions", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  const role = await service.create({ ...ADMIN_ACTOR, name: "auditor", description: "唯讀稽核" });

  assert.equal(role.name, "auditor");
  const stored = database.state.roles.get(role.id);
  assert.equal(stored.name, "auditor");
  assert.equal([...database.state.rolePermissions].some((k) => k.startsWith(`${role.id}:`)), false);
  assert.equal(database.state.auditRows[0][3], "role.create");
});

test("create rejects a duplicate role name", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () => service.create({ ...ADMIN_ACTOR, name: "staff", description: "" }),
    { code: "ROLE_NAME_TAKEN" }
  );
});

// --- update -----------------------------------------------------------------

test("update renames a role and audits before/after", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  const result = await service.update({
    ...ADMIN_ACTOR,
    id: STAFF.id,
    name: "customer-service",
    description: "客服"
  });

  assert.equal(result.name, "customer-service");
  const detail = JSON.parse(database.state.auditRows[0][8]);
  assert.deepEqual(detail.name, { before: "staff", after: "customer-service" });
});

test("update refuses to touch system-admin", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () => service.update({ ...ADMIN_ACTOR, id: SYSTEM_ADMIN.id, name: "renamed", description: "" }),
    { code: "ROLE_PROTECTED" }
  );
  assert.equal(database.state.roles.get(SYSTEM_ADMIN.id).name, "system-admin");
});

test("update on a missing role throws ROLE_NOT_FOUND", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () => service.update({ ...ADMIN_ACTOR, id: 404, name: "x", description: "" }),
    { code: "ROLE_NOT_FOUND" }
  );
});

test("update rejects renaming into an existing name", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () => service.update({ ...ADMIN_ACTOR, id: STAFF.id, name: "system-admin", description: "" }),
    { code: "ROLE_NAME_TAKEN" }
  );
});

// --- delete -----------------------------------------------------------------

test("delete removes the role and its role_permissions", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await service.delete({ ...ADMIN_ACTOR, id: STAFF.id, reason: "不再需要這個角色" });

  assert.equal(database.state.roles.has(STAFF.id), false);
  assert.equal(database.state.auditRows[0][3], "role.delete");
});

test("delete cascades: a user holding the deleted role loses it (CASCADE, not blocked)", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", status: "active" },
      { id: 20, username: "bob", status: "active" }
    ],
    userRoles: [
      [10, SYSTEM_ADMIN.id],
      [20, STAFF.id]
    ]
  });
  const { service } = createService({ database });

  await service.delete({ ...ADMIN_ACTOR, id: STAFF.id, reason: "刻意不擋，測 CASCADE" });

  assert.equal(database.state.userRoles.has(`20:${STAFF.id}`), false);
});

test("delete refuses to touch system-admin", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () => service.delete({ ...ADMIN_ACTOR, id: SYSTEM_ADMIN.id, reason: "測試保護" }),
    { code: "ROLE_PROTECTED" }
  );
  assert.equal(database.state.roles.has(SYSTEM_ADMIN.id), true);
});

// --- assignPermissions -------------------------------------------------------

test("assignPermissions overwrites the permission set and audits before/after", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  const result = await service.assignPermissions({
    ...ADMIN_ACTOR,
    id: STAFF.id,
    permissionIds: [100],
    expectedPermissionIds: [],
    reason: "客服需要查得到用戶"
  });

  assert.deepEqual(result.permissions, ["user.mgmt"]);
  assert.ok(database.state.rolePermissions.has(`${STAFF.id}:100`));
});

test("assignPermissions rejects a stale expected set", async () => {
  const database = seedWithAdmin({
    rolePermissions: [
      [SYSTEM_ADMIN.id, 100],
      [SYSTEM_ADMIN.id, 101],
      [SYSTEM_ADMIN.id, 102],
      [STAFF.id, 100]
    ]
  });
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.assignPermissions({
        ...ADMIN_ACTOR,
        id: STAFF.id,
        permissionIds: [],
        expectedPermissionIds: [], // 畫面上看到的是空的，但實際上 staff 已經有 100
        reason: "畫面資料過期"
      }),
    { code: "ASSIGNMENT_STALE" }
  );
  assert.ok(database.state.rolePermissions.has(`${STAFF.id}:100`));
});

test("assignPermissions denies an actor granting a permission they do not hold", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", status: "active" },
      { id: 20, username: "limited", status: "active" }
    ],
    userRoles: [
      [10, SYSTEM_ADMIN.id],
      [20, STAFF.id]
    ],
    rolePermissions: [
      [SYSTEM_ADMIN.id, 100],
      [SYSTEM_ADMIN.id, 101],
      [SYSTEM_ADMIN.id, 102],
      [STAFF.id, 100] // staff 只有 user.mgmt
    ]
  });
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.assignPermissions({
        actorId: 20,
        claimedRoles: ["staff"],
        claimedPermissions: ["user.mgmt"],
        id: STAFF.id,
        permissionIds: [100, 101], // 想順便給自己的角色加 role.mgmt
        expectedPermissionIds: [100],
        reason: "試圖自我提權"
      }),
    { code: "PERMISSION_ESCALATION_DENIED" }
  );
  assert.equal(database.state.rolePermissions.has(`${STAFF.id}:101`), false);
});

test("assignPermissions lets a fresh protected admin delegate Customer bank permissions without receiving them", async () => {
  const database = seedWithAdmin({
    permissions: [
      { id: 100, name: "user.mgmt", description: "" },
      { id: 101, name: "role.mgmt", description: "" },
      { id: 102, name: "device.mgmt", description: "" },
      { id: 103, name: "customer.bank.view", description: "" }
    ]
  });
  const { service } = createService({ database });

  await service.assignPermissions({
    ...ADMIN_ACTOR,
    id: STAFF.id,
    permissionIds: [103],
    expectedPermissionIds: [],
    reason: "委派銀行資料查閱職責"
  });

  assert.ok(database.state.rolePermissions.has(`${STAFF.id}:103`));
  assert.equal(ADMIN_ACTOR.claimedPermissions.includes("customer.bank.view"), false);
});

test("assignPermissions refuses to touch system-admin's permissions", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.assignPermissions({
        ...ADMIN_ACTOR,
        id: SYSTEM_ADMIN.id,
        permissionIds: [100],
        expectedPermissionIds: [100, 101, 102],
        reason: "測試保護"
      }),
    { code: "ROLE_PROTECTED" }
  );
  assert.equal(database.state.rolePermissions.size, 3);
});

test("assignPermissions rejects an unknown permission id", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.assignPermissions({
        ...ADMIN_ACTOR,
        id: STAFF.id,
        permissionIds: [999],
        expectedPermissionIds: [],
        reason: "x"
      }),
    (error) => {
      assert.equal(error.code, "UNKNOWN_PERMISSION");
      // errorHandler.js only serializes publicDetails into the HTTP response
      // body, not .details (see framework/middleware/errorHandler.js), and
      // FormPanel.vue reads response.error.details to highlight the
      // permissionIds field — so this must be set too, not just .details.
      assert.deepEqual(error.publicDetails, { permissionIds: [999] });
      return true;
    }
  );
});

// --- listPermissions ----------------------------------------------------------

test("listPermissions returns the read-only catalogue", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  const permissions = await service.listPermissions(ADMIN_ACTOR);

  assert.deepEqual(
    permissions.map((p) => p.name).sort(),
    ["device.mgmt", "role.mgmt", "user.mgmt"]
  );
});

// --- §1.4 第四道 ---------------------------------------------------------------

test("every write rejects with PERMISSION_STALE when the actor's permissions changed", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.create({
        actorId: 10,
        claimedRoles: ["system-admin"],
        claimedPermissions: ["user.mgmt"], // claims 只有一個，資料庫其實有三個
        name: "x",
        description: ""
      }),
    { code: "PERMISSION_STALE" }
  );
});
