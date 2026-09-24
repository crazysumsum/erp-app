import assert from "node:assert/strict";
import test from "node:test";
import { UserAdminService } from "../src/modules/user/UserAdminService.js";
import { hashPassword } from "../src/modules/user/passwordHash.js";
import { createTestTime } from "../test-support/createTestTime.js";

/**
 * 這裡測的是寫入路徑（create／update／disable／enable／assignRoles／
 * resetPassword）——四道提權防護、compare-and-set、稽核在同一個交易裡這幾件
 * 事的分岔全部住在這裡，快、也測得到窮舉邊界。
 *
 * 用一個關聯式的記憶體替身，不是逐句 mock 回傳值：這支 service 的正確性建立
 * 在好幾句 SQL 對同一份資料的結果彼此一致上（例如 assignRoles 裡，
 * currentRoleNames 與 currentPermissionNames 必須是同一份 user_roles 算出來
 * 的），mock 個別回傳值測不出「兩句查詢對不上」這種錯。
 *
 * `list()` 與 `getById()` 的動態 SQL、以及真正的並行安全（LAST_ADMIN_PROTECTED
 * 那句原子 UPDATE 在兩個並行請求下的行為），交給對真 MySQL 的整合測試——那才
 * 是唯一能真的證明「SQL 語法對、而且在並行下正確」的地方。
 */

const NOW_MS = 1_700_000_000_000;
const SYSTEM_ADMIN = { id: 1, name: "system-admin" };
const STAFF = { id: 2, name: "staff" };

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
    nextUserId: users.reduce((max, u) => Math.max(max, u.id), 0) + 1
  };

  function roleIdsOfUser(userId) {
    return [...state.userRoles]
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => Number(key.split(":")[1]));
  }

  function permissionNamesForRoleIds(roleIds) {
    const permIds = new Set();
    for (const key of state.rolePermissions) {
      const [roleId, permId] = key.split(":").map(Number);
      if (roleIds.includes(roleId)) {
        permIds.add(permId);
      }
    }
    return [...permIds].map((id) => state.permissions.get(id).name).sort();
  }

  function otherActiveAdminCount(excludeUserId) {
    let count = 0;
    for (const user of state.users.values()) {
      if (user.id === excludeUserId || user.status !== "active") continue;
      if (roleIdsOfUser(user.id).includes(SYSTEM_ADMIN.id)) count += 1;
    }
    return count;
  }

  async function run(sql, params = []) {
    if (sql.includes("SELECT username FROM users WHERE id = ? AND status = 'active'")) {
      const user = state.users.get(params[0]);
      return [user && user.status === "active" ? [{ username: user.username }] : []];
    }

    if (sql.includes("FROM roles r JOIN user_roles ur")) {
      const roleIds = roleIdsOfUser(params[0]);
      const rows = roleIds
        .map((id) => state.roles.get(id))
        .filter(Boolean)
        .map((r) => ({ id: r.id, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [rows];
    }

    if (sql.includes("JOIN user_roles ur ON ur.role_id = rp.role_id")) {
      const roleIds = roleIdsOfUser(params[0]);
      return [permissionNamesForRoleIds(roleIds).map((name) => ({ name }))];
    }

    if (sql.includes("FROM roles WHERE id IN")) {
      const rows = params
        .map((id) => state.roles.get(id))
        .filter(Boolean)
        .map((r) => ({ id: r.id, name: r.name }));
      return [rows];
    }

    if (sql.includes("WHERE rp.role_id IN")) {
      return [permissionNamesForRoleIds(params.map(Number)).map((name) => ({ name }))];
    }

    if (sql.includes("COUNT(*) AS count")) {
      return [[{ count: otherActiveAdminCount(params[0]) }]];
    }

    if (sql.includes("SELECT id, username, display_name, status, created_at FROM users WHERE id = ?")) {
      const user = state.users.get(params[0]);
      return [user ? [{ ...user }] : []];
    }

    if (sql.includes("password_hash FROM users WHERE id = ?")) {
      const user = state.users.get(params[0]);
      return [user ? [{ id: user.id, username: user.username, password_hash: user.password_hash }] : []]; // already a fresh object literal
    }

    if (sql.includes("SELECT role_id FROM user_roles WHERE user_id = ? FOR UPDATE")) {
      return [roleIdsOfUser(params[0]).map((role_id) => ({ role_id }))];
    }

    if (sql.includes("INSERT INTO users")) {
      const [username, passwordHash, displayName, expiresAt, nowMs] = params;
      if ([...state.users.values()].some((u) => u.username === username)) {
        const error = new Error("Duplicate entry");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      const id = state.nextUserId++;
      state.users.set(id, {
        id,
        username,
        password_hash: passwordHash,
        display_name: displayName,
        status: "active",
        must_change_password: 1,
        temporary_password_expires_at: expiresAt,
        failed_login_attempts: 0,
        locked_until: null,
        created_at: nowMs,
        updated_at: nowMs
      });
      return [{ insertId: id }];
    }

    if (sql.includes("INSERT INTO user_roles")) {
      const [userId, roleId] = params;
      state.userRoles.add(`${userId}:${roleId}`);
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("DELETE FROM user_roles")) {
      const [userId] = params;
      for (const key of [...state.userRoles]) {
        if (key.startsWith(`${userId}:`)) state.userRoles.delete(key);
      }
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("SET display_name = ?")) {
      const [displayName, nowMs, id] = params;
      const user = state.users.get(id);
      if (user) {
        user.display_name = displayName;
        user.updated_at = nowMs;
      }
      return [{ affectedRows: user ? 1 : 0 }];
    }

    if (sql.includes("SET status = 'disabled'")) {
      const [nowMs, id] = params;
      const user = state.users.get(id);
      if (!user || user.status !== "active") return [{ affectedRows: 0 }];

      const isAdmin = roleIdsOfUser(id).includes(SYSTEM_ADMIN.id);
      const guardPasses = !isAdmin || otherActiveAdminCount(id) > 0;

      if (!guardPasses) return [{ affectedRows: 0 }];

      user.status = "disabled";
      user.updated_at = nowMs;
      return [{ affectedRows: 1 }];
    }

    if (sql.includes("SET status = 'active', failed_login_attempts")) {
      const [nowMs, id] = params;
      const user = state.users.get(id);
      if (user) {
        user.status = "active";
        user.failed_login_attempts = 0;
        user.locked_until = null;
        user.updated_at = nowMs;
      }
      return [{ affectedRows: user ? 1 : 0 }];
    }

    if (sql.includes("SET password_hash = ?")) {
      const [passwordHash, expiresAt, nowMs, id] = params;
      const user = state.users.get(id);
      if (user) {
        user.password_hash = passwordHash;
        user.must_change_password = 1;
        user.temporary_password_expires_at = expiresAt;
        user.updated_at = nowMs;
      }
      return [{ affectedRows: user ? 1 : 0 }];
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

/**
 * 讓 `sqlSubstring` 匹配到的那句查詢，前 `failTimes` 次呼叫拋出一個
 * `ER_LOCK_DEADLOCK`，之後恢復正常——用嚟測 UserAdminService.disable() 的
 * 死結重試邏輯，唔使真係接真 MySQL 先整得出死結。
 */
function withDeadlockInjected(database, { sqlSubstring, failTimes }) {
  let remaining = failTimes;

  function wrap(run) {
    return async (sql, params) => {
      if (remaining > 0 && sql.includes(sqlSubstring)) {
        remaining -= 1;
        const error = new Error("Deadlock found when trying to get lock; try restarting transaction");
        error.code = "ER_LOCK_DEADLOCK";
        throw error;
      }
      return run(sql, params);
    };
  }

  const wrappedQuery = wrap(database.query);
  const wrappedExecute = wrap(database.execute);

  return {
    ...database,
    query: wrappedQuery,
    execute: wrappedExecute,
    withTransaction: async (work) => work({ query: wrappedQuery, execute: wrappedExecute })
  };
}

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };
  return { entries, debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

function fakeTokenRevocation() {
  const revoked = [];
  return {
    revoked,
    revoke: async (subject, options) => {
      revoked.push({ subject, options });
    }
  };
}

function createService({ database, tokenRevocation = fakeTokenRevocation(), logger = collectingLogger() } = {}) {
  const time = createTestTime({ clock: () => new Date(NOW_MS) });
  const service = new UserAdminService({ database, logger, time, tokenRevocation });
  return { service, tokenRevocation, logger, time };
}

const ADMIN_ACTOR = { actorId: 10, claimedRoles: ["system-admin"], claimedPermissions: ["user.mgmt", "role.mgmt", "device.mgmt"] };

function seedWithAdmin(overrides = {}) {
  return createFakeDatabase({
    users: [
      { id: 10, username: "admin", password_hash: "irrelevant", display_name: "Admin", status: "active", created_at: 1 }
    ],
    permissions: [
      { id: 100, name: "user.mgmt" },
      { id: 101, name: "role.mgmt" },
      { id: 102, name: "device.mgmt" }
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

// --- constructor ---------------------------------------------------------

test("constructor requires database, logger, time and tokenRevocation", () => {
  assert.throws(() => new UserAdminService({}), TypeError);
  assert.throws(() => new UserAdminService({ database: {}, logger: {}, time: {} }), TypeError);
});

// --- create ---------------------------------------------------------------

test("create makes a user with must_change_password set and a 72h deadline", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  const result = await service.create({
    ...ADMIN_ACTOR,
    username: "new.hire",
    displayName: "New Hire",
    password: "Correct-Horse-Battery-1",
    roleIds: [STAFF.id]
  });

  assert.equal(result.username, "new.hire");
  const stored = [...database.state.users.values()].find((u) => u.username === "new.hire");
  assert.equal(stored.must_change_password, 1);
  assert.equal(stored.temporary_password_expires_at, NOW_MS + 72 * 60 * 60 * 1000);
});

test("create rejects a duplicate username with USERNAME_TAKEN", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "Admin", status: "active", created_at: 1 },
      { id: 11, username: "taken", password_hash: "x", display_name: "Taken", status: "active", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.create({
        ...ADMIN_ACTOR,
        username: "taken",
        displayName: "",
        password: "Correct-Horse-Battery-1",
        roleIds: []
      }),
    { code: "USERNAME_TAKEN" }
  );
});

test("create rejects a weak password before touching the database", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.create({ ...ADMIN_ACTOR, username: "x", displayName: "", password: "short", roleIds: [] }),
    { code: "PASSWORD_TOO_WEAK" }
  );
  assert.equal(database.state.users.size, 1, "no user should have been inserted");
});

test("create rejects an unknown role id", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.create({
        ...ADMIN_ACTOR,
        username: "x",
        displayName: "",
        password: "Correct-Horse-Battery-1",
        roleIds: [999]
      }),
    (error) => {
      assert.equal(error.code, "UNKNOWN_ROLE");
      // errorHandler.js only serializes publicDetails into the HTTP response
      // body, not .details (see framework/middleware/errorHandler.js), and
      // FormPanel.vue reads response.error.details to highlight the roleIds
      // field — so this must be set too, not just .details.
      assert.deepEqual(error.publicDetails, { roleIds: [999] });
      return true;
    }
  );
});

test("create denies an actor granting permissions they do not hold themselves", async () => {
  // 演練 §1.4 舉的那個例子：actor 只有 user.mgmt，要建一個持有 system-admin
  // 的新用戶（連帶拿到 role.mgmt / device.mgmt）。system-admin 自己的三個
  // 權限要保留在 override 裡——它們是 next 那一邊算出「新增了什麼」的依據。
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "limited", password_hash: "x", display_name: "", status: "active", created_at: 1 }
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
      service.create({
        actorId: 20,
        claimedRoles: ["staff"],
        claimedPermissions: ["user.mgmt"],
        username: "escalated",
        displayName: "",
        password: "Correct-Horse-Battery-1",
        roleIds: [SYSTEM_ADMIN.id]
      }),
    { code: "PERMISSION_ESCALATION_DENIED" }
  );
  assert.equal(database.state.users.size, 2, "no user should have been inserted");
});

test("assignRoles lets a fresh protected admin delegate a Customer bank role without receiving route access", async () => {
  const bankRole = { id: 3, name: "customer-bank-viewer" };
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "viewer", password_hash: "x", display_name: "", status: "active", created_at: 1 }
    ],
    roles: [SYSTEM_ADMIN, STAFF, bankRole],
    permissions: [
      { id: 100, name: "user.mgmt" },
      { id: 101, name: "role.mgmt" },
      { id: 102, name: "device.mgmt" },
      { id: 103, name: "customer.bank.view" }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id], [20, STAFF.id]],
    rolePermissions: [
      [SYSTEM_ADMIN.id, 100],
      [SYSTEM_ADMIN.id, 101],
      [SYSTEM_ADMIN.id, 102],
      [bankRole.id, 103]
    ]
  });
  const { service } = createService({ database });

  await service.assignRoles({
    ...ADMIN_ACTOR,
    id: 20,
    roleIds: [bankRole.id],
    expectedRoleIds: [STAFF.id],
    reason: "委派銀行資料查閱職責"
  });

  assert.ok(database.state.userRoles.has(`20:${bankRole.id}`));
  assert.equal(ADMIN_ACTOR.claimedPermissions.includes("customer.bank.view"), false);
});

test("assignRoles refuses the protected exception when the admin targets themselves", async () => {
  const bankRole = { id: 3, name: "customer-bank-viewer" };
  const database = seedWithAdmin({
    roles: [SYSTEM_ADMIN, STAFF, bankRole],
    permissions: [
      { id: 100, name: "user.mgmt" },
      { id: 101, name: "role.mgmt" },
      { id: 102, name: "device.mgmt" },
      { id: 103, name: "customer.bank.view" }
    ],
    rolePermissions: [
      [SYSTEM_ADMIN.id, 100], [SYSTEM_ADMIN.id, 101], [SYSTEM_ADMIN.id, 102], [bankRole.id, 103]
    ]
  });
  const { service } = createService({ database });

  await assert.rejects(
    () => service.assignRoles({
      ...ADMIN_ACTOR,
      id: 10,
      roleIds: [SYSTEM_ADMIN.id, bankRole.id],
      expectedRoleIds: [SYSTEM_ADMIN.id],
      reason: "不得藉委派替自己加權"
    }),
    { code: "PERMISSION_ESCALATION_DENIED" }
  );
});

test("create writes exactly one audit row on success, and none on failure", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await service.create({
    ...ADMIN_ACTOR,
    username: "ok",
    displayName: "",
    password: "Correct-Horse-Battery-1",
    roleIds: []
  });
  assert.equal(database.state.auditRows.length, 1);
  assert.equal(database.state.auditRows[0][3], "user.create");

  await assert.rejects(() =>
    service.create({ ...ADMIN_ACTOR, username: "ok", displayName: "", password: "Correct-Horse-Battery-1", roleIds: [] })
  );
  assert.equal(database.state.auditRows.length, 1, "the failed duplicate attempt must not leave a row");
});

// --- §1.4 第四道：actor 的權限跟 claims 對不上 --------------------------------

test("every write rejects with PERMISSION_STALE when the actor's permissions changed", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.create({
        actorId: 10,
        claimedRoles: ["system-admin"],
        claimedPermissions: ["user.mgmt"], // claims 只有一個，資料庫其實有三個
        username: "x",
        displayName: "",
        password: "Correct-Horse-Battery-1",
        roleIds: []
      }),
    { code: "PERMISSION_STALE" }
  );
});

test("PERMISSION_STALE also fires when the actor's own account is gone", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.update({
        actorId: 999,
        claimedRoles: ["system-admin"],
        claimedPermissions: ["user.mgmt"],
        id: 10,
        displayName: "x"
      }),
    { code: "PERMISSION_STALE" }
  );
});

// --- update -----------------------------------------------------------------

test("update changes displayName and records before/after in the audit detail", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "Admin", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: "x", display_name: "Old Name", status: "active", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service } = createService({ database });

  const result = await service.update({ ...ADMIN_ACTOR, id: 20, displayName: "New Name" });

  assert.equal(result.displayName, "New Name");
  assert.equal(database.state.users.get(20).display_name, "New Name");
  const detail = JSON.parse(database.state.auditRows[0][8]);
  assert.deepEqual(detail, { displayName: { before: "Old Name", after: "New Name" } });
});

test("update on a missing user throws USER_NOT_FOUND", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(() => service.update({ ...ADMIN_ACTOR, id: 404, displayName: "x" }), {
    code: "USER_NOT_FOUND"
  });
});

// --- disable ----------------------------------------------------------------

test("disable revokes the token before writing the status change", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: "x", display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service, tokenRevocation } = createService({ database });

  await service.disable({ ...ADMIN_ACTOR, id: 20, reason: "涉及異常存取，先行停用調查" });

  assert.equal(database.state.users.get(20).status, "disabled");
  assert.deepEqual(tokenRevocation.revoked, [{ subject: "20", options: { reason: "user_disabled" } }]);
  assert.equal(database.state.auditRows[0][3], "user.disable");
  assert.equal(database.state.auditRows[0][7], "涉及異常存取，先行停用調查");
});

test("disabling an already-disabled user is a no-op: no revoke, no audit row", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: "x", display_name: "", status: "disabled", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service, tokenRevocation } = createService({ database });

  const result = await service.disable({ ...ADMIN_ACTOR, id: 20, reason: "已經停用過了" });

  assert.equal(result.status, "disabled");
  assert.deepEqual(tokenRevocation.revoked, []);
  assert.equal(database.state.auditRows.length, 0);
});

test("disabling the last active system-admin is refused, and nothing is revoked", async () => {
  const database = seedWithAdmin(); // 只有 id 10 是 admin，且是唯一一個
  const { service, tokenRevocation } = createService({ database });

  await assert.rejects(
    () => service.disable({ ...ADMIN_ACTOR, id: 10, reason: "測試最後一個 admin 的保護" }),
    { code: "LAST_ADMIN_PROTECTED" }
  );
  assert.equal(database.state.users.get(10).status, "active");
  assert.deepEqual(tokenRevocation.revoked, [], "a rejected disable must not revoke the actor's own session");
});

test("disabling one of two admins succeeds, leaving the other untouched", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 11, username: "admin2", password_hash: "x", display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [
      [10, SYSTEM_ADMIN.id],
      [11, SYSTEM_ADMIN.id]
    ]
  });
  const { service } = createService({ database });

  await service.disable({ ...ADMIN_ACTOR, id: 11, reason: "只是眾多 admin 之一，可以停用" });

  assert.equal(database.state.users.get(11).status, "disabled");
  assert.equal(database.state.users.get(10).status, "active");
});

test("disable retries once when the protective UPDATE deadlocks, and still succeeds", async () => {
  const database = withDeadlockInjected(
    seedWithAdmin({
      users: [
        { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
        { id: 20, username: "bob", password_hash: "x", display_name: "", status: "active", created_at: 1 }
      ],
      userRoles: [[10, SYSTEM_ADMIN.id]]
    }),
    { sqlSubstring: "SET status = 'disabled'", failTimes: 1 }
  );
  const { service, tokenRevocation } = createService({ database });

  await service.disable({ ...ADMIN_ACTOR, id: 20, reason: "第一次撞死結，重試後成功" });

  assert.equal(database.state.users.get(20).status, "disabled");
  // 重試代表整個交易（含撤銷 token）重跑一次：第一次因為死結被 InnoDB 整個
  // 回滾，第二次才真的落地——見 UserAdminService.js#disable 開頭的註解，這是
  // 已經接受的代價，不是這支測試意外發現的行為。
  assert.equal(tokenRevocation.revoked.length, 2);
  assert.equal(database.state.auditRows.length, 1, "只有成功那次交易寫入稽核");
});

test("disable gives up after repeated deadlocks and surfaces the error", async () => {
  const database = withDeadlockInjected(
    seedWithAdmin({
      users: [
        { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
        { id: 20, username: "bob", password_hash: "x", display_name: "", status: "active", created_at: 1 }
      ],
      userRoles: [[10, SYSTEM_ADMIN.id]]
    }),
    { sqlSubstring: "SET status = 'disabled'", failTimes: 10 }
  );
  const { service } = createService({ database });

  await assert.rejects(
    () => service.disable({ ...ADMIN_ACTOR, id: 20, reason: "持續撞死結，重試耗盡" }),
    { code: "ER_LOCK_DEADLOCK" }
  );
  assert.equal(database.state.users.get(20).status, "active", "重試耗盡後帳號狀態必須維持不變");
});

test("disable on a missing user throws USER_NOT_FOUND", async () => {
  const database = seedWithAdmin();
  const { service } = createService({ database });

  await assert.rejects(() => service.disable({ ...ADMIN_ACTOR, id: 404, reason: "找不到這個人" }), {
    code: "USER_NOT_FOUND"
  });
});

// --- enable -------------------------------------------------------------

test("enable clears the lockout and does not touch tokenRevocation", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      {
        id: 20,
        username: "bob",
        password_hash: "x",
        display_name: "",
        status: "disabled",
        failed_login_attempts: 5,
        locked_until: NOW_MS + 1000,
        created_at: 1
      }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service, tokenRevocation } = createService({ database });

  await service.enable({ ...ADMIN_ACTOR, id: 20, reason: "確認身份後恢復存取" });

  const user = database.state.users.get(20);
  assert.equal(user.status, "active");
  assert.equal(user.failed_login_attempts, 0);
  assert.equal(user.locked_until, null);
  assert.deepEqual(tokenRevocation.revoked, []);
});

test("enabling an already-active user is a no-op: no audit row", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: "x", display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service } = createService({ database });

  await service.enable({ ...ADMIN_ACTOR, id: 20, reason: "已經是啟用狀態" });

  assert.equal(database.state.auditRows.length, 0);
});

// --- assignRoles --------------------------------------------------------

test("assignRoles overwrites the role set and audits before/after", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: "x", display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service } = createService({ database });

  const result = await service.assignRoles({
    ...ADMIN_ACTOR,
    id: 20,
    roleIds: [STAFF.id],
    expectedRoleIds: [],
    reason: "分配到客服團隊"
  });

  assert.deepEqual(result.roles, ["staff"]);
  assert.ok(database.state.userRoles.has(`20:${STAFF.id}`));
  const detail = JSON.parse(database.state.auditRows[0][8]);
  assert.deepEqual(detail, { roles: { before: [], after: ["staff"] } });
});

test("assignRoles rejects a stale expected set (compare-and-set)", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: "x", display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [
      [10, SYSTEM_ADMIN.id],
      [20, STAFF.id]
    ]
  });
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.assignRoles({
        ...ADMIN_ACTOR,
        id: 20,
        roleIds: [],
        expectedRoleIds: [], // 畫面上看到的是空的，但實際上 bob 已經有 staff 了
        reason: "畫面資料過期"
      }),
    { code: "ASSIGNMENT_STALE" }
  );
  assert.ok(database.state.userRoles.has(`20:${STAFF.id}`), "the mismatched write must not have happened");
});

test("assignRoles denies an actor granting a permission they do not hold", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "limited", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 30, username: "target", password_hash: "x", display_name: "", status: "active", created_at: 1 }
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
      service.assignRoles({
        actorId: 20,
        claimedRoles: ["staff"],
        claimedPermissions: ["user.mgmt"],
        id: 30,
        roleIds: [SYSTEM_ADMIN.id],
        expectedRoleIds: [],
        reason: "試圖自我提權"
      }),
    { code: "PERMISSION_ESCALATION_DENIED" }
  );
  assert.equal(database.state.userRoles.has(`30:${SYSTEM_ADMIN.id}`), false);
});

test("assignRoles allows removing a role the actor does not hold themselves (de-escalation is fine)", async () => {
  // §1.4：「只檢查新增的部分，不檢查移除的」。一個只有 user.mgmt 的操作者，
  // 應該有能力把某個人身上的 system-admin 拔掉，即使他自己沒有 role.mgmt。
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 11, username: "admin2", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "limited", password_hash: "x", display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [
      [10, SYSTEM_ADMIN.id],
      [11, SYSTEM_ADMIN.id],
      [20, STAFF.id]
    ],
    rolePermissions: [
      [SYSTEM_ADMIN.id, 100],
      [SYSTEM_ADMIN.id, 101],
      [SYSTEM_ADMIN.id, 102],
      [STAFF.id, 100]
    ]
  });
  const { service } = createService({ database });

  await service.assignRoles({
    actorId: 20,
    claimedRoles: ["staff"],
    claimedPermissions: ["user.mgmt"],
    id: 11,
    roleIds: [],
    expectedRoleIds: [SYSTEM_ADMIN.id],
    reason: "撤銷這個人的管理員身份"
  });

  assert.equal(database.state.userRoles.has(`11:${SYSTEM_ADMIN.id}`), false);
});

test("assignRoles refuses to strip the last admin's role", async () => {
  const database = seedWithAdmin({
    users: [{ id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 }],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.assignRoles({
        ...ADMIN_ACTOR,
        id: 10,
        roleIds: [],
        expectedRoleIds: [SYSTEM_ADMIN.id],
        reason: "測試最後一個 admin 的保護"
      }),
    { code: "LAST_ADMIN_PROTECTED" }
  );
});

test("assignRoles rejects an unknown role id", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: "x", display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service } = createService({ database });

  await assert.rejects(
    () =>
      service.assignRoles({ ...ADMIN_ACTOR, id: 20, roleIds: [999], expectedRoleIds: [], reason: "x" }),
    { code: "UNKNOWN_ROLE" }
  );
});

// --- resetPassword --------------------------------------------------------

test("resetPassword revokes the token, sets must_change_password and a new deadline", async () => {
  const targetHash = await hashPassword("Old-Password-123");
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: targetHash, display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service, tokenRevocation } = createService({ database });

  await service.resetPassword({
    ...ADMIN_ACTOR,
    id: 20,
    newPassword: "Brand-New-Password-9",
    reason: "使用者忘記密碼"
  });

  const user = database.state.users.get(20);
  assert.equal(user.must_change_password, 1);
  assert.equal(user.temporary_password_expires_at, NOW_MS + 72 * 60 * 60 * 1000);
  assert.deepEqual(tokenRevocation.revoked, [{ subject: "20", options: { reason: "password_reset" } }]);
});

test("resetPassword rejects setting the same password again", async () => {
  const targetHash = await hashPassword("Same-Password-123");
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: targetHash, display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service, tokenRevocation } = createService({ database });

  await assert.rejects(
    () =>
      service.resetPassword({ ...ADMIN_ACTOR, id: 20, newPassword: "Same-Password-123", reason: "重設密碼" }),
    { code: "PASSWORD_UNCHANGED" }
  );
  assert.deepEqual(tokenRevocation.revoked, [], "a rejected reset must not revoke the target's session");
});

test("resetPassword rejects a weak new password", async () => {
  const database = seedWithAdmin({
    users: [
      { id: 10, username: "admin", password_hash: "x", display_name: "", status: "active", created_at: 1 },
      { id: 20, username: "bob", password_hash: "x", display_name: "", status: "active", created_at: 1 }
    ],
    userRoles: [[10, SYSTEM_ADMIN.id]]
  });
  const { service } = createService({ database });

  await assert.rejects(
    () => service.resetPassword({ ...ADMIN_ACTOR, id: 20, newPassword: "weak", reason: "重設密碼" }),
    { code: "PASSWORD_TOO_WEAK" }
  );
});
