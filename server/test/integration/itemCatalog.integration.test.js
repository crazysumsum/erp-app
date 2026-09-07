/**
 * T07：Catalog（Category／Brand／UOM）端點對一個真的、已經 migrate 過的 MySQL
 * 驗收。設計說明見 docs/items_management/design_spec.md §6.4、§11.2、§11.4。
 *
 * 目的：itemCatalogHandlers.test.js／itemCatalogService.test.js 都只用假 DB，
 * 從未證明過這 24 支路由真的掛在真正的 Express app 上、真的接得到 MySQL、
 * 真的執行 optimistic lock 與 authorization policy——這支檔案補這一段。
 *
 * Token 直接用 jwt service 簽發，理由與 roleManagement.integration.test.js
 * 相同：這裡要驗的是 Catalog 端點本身，不是登入流程。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite (see README's CI section)";

async function startApplication() {
  const source = defaultConfigurationSource();
  return createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
}

async function seedUser(db, { username, password, roleId }) {
  const passwordHash = await hashPassword(password);
  const nowMs = Date.now();

  const [userResult] = await db.execute(
    `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, "Integration Test User", nowMs, nowMs]
  );
  const userId = userResult.insertId;

  if (roleId) {
    await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  }

  return { userId, username };
}

async function cleanupUser(db, userId) {
  await db.execute("DELETE FROM item_audit_logs WHERE actor_user_id = ?", [userId]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
  await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
}

/** 建一個只有指定權限的測試角色，回傳 { roleId, roleName, cleanup() }。 */
async function seedRole(db, { permissionNames = [] } = {}) {
  const nowMs = Date.now();
  const roleName = `it-role-${randomUUID().slice(0, 8)}`;
  const [roleResult] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [
    roleName,
    nowMs
  ]);
  const roleId = roleResult.insertId;

  for (const name of permissionNames) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [
      roleId,
      permission.id
    ]);
  }

  return {
    roleId,
    roleName,
    async cleanup() {
      await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM user_roles WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    }
  };
}

/**
 * 商品管理員自訂角色：item.view＋item.mgmt（design_spec.md §3「商品管理員自訂
 * 角色」那一列），而不是借用 system-admin。刻意不用 system-admin：這支檔案
 * 平行跑的時候（node --test 預設跨檔案平行），userManagement.integration
 * .test.js 有一支「只有一個 admin」的並行測試，靠「現在系統裡剛好幾個 active
 * admin」這個假設運作——另一個檔案這時再種一個 system-admin 角色的使用者，會
 * 撞壞那個假設，兩邊都變得不穩定。用專屬角色完全避開這個耦合，也更貼近這幾支
 * 端點實際會被哪一種角色呼叫。
 */
async function seedItemManagerRole(db) {
  return seedRole(db, { permissionNames: ["item.view", "item.mgmt"] });
}

function tokenIssuer(application) {
  const jwt = application.services.require("jwt");
  const tokenRevocation = application.services.require("tokenRevocation");
  const time = application.services.require("time");

  return async (userId, { roles, permissions }) => {
    const version = await tokenRevocation.currentVersion(String(userId));
    const authTime = Math.floor(time.nowMs() / 1000);
    return jwt.issue({ roles, permissions }, { subject: String(userId), version, authTime });
  };
}

function get(token) {
  return { headers: token ? { Authorization: `Bearer ${token}` } : {} };
}

function authed(token, body) {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function cleanupCatalogAudit(db, { targetType, targetId }) {
  await db.execute("DELETE FROM item_audit_logs WHERE target_type = ? AND target_id = ?", [
    targetType,
    targetId
  ]);
}

test("Category 完整生命週期經真實 HTTP＋MySQL：建立、stale version 409、更新、啟用/停用、封存/恢復、刪除，每步都有 audit", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-1!";

  const role = await seedItemManagerRole(db);
  const actor = await seedUser(db, {
    username: `it-catalog-${randomUUID().slice(0, 8)}`,
    password,
    roleId: role.roleId
  });
  let categoryId = null;

  t.after(async () => {
    if (categoryId !== null) {
      await cleanupCatalogAudit(db, { targetType: "category", targetId: categoryId });
      await db.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
    }
    await cleanupUser(db, actor.userId);
    await role.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });
  const name = `it-category-${randomUUID().slice(0, 8)}`;

  const createResponse = await fetch(
    `${url}/api/v1/catalog/categories/create`,
    authed(token, { name, parentId: null, sortOrder: 0 })
  );
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, JSON.stringify(created));
  categoryId = created.data.id;
  assert.equal(created.data.status, "active");
  assert.equal(created.data.version, 1);

  const treeResponse = await fetch(`${url}/api/v1/catalog/categories`, get(token));
  assert.equal(treeResponse.status, 200);
  const tree = (await treeResponse.json()).data.items;
  assert.ok(tree.some((node) => node.id === categoryId && node.name === name));

  const staleUpdate = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/update`,
    authed(token, { name: "renamed-while-stale", parentId: null, sortOrder: 0, version: 999 })
  );
  assert.equal(staleUpdate.status, 409);
  assert.equal((await staleUpdate.json()).error.code, "VERSION_CONFLICT");

  const [[stillOriginal]] = await db.query("SELECT name, version FROM item_categories WHERE id = ?", [
    categoryId
  ]);
  assert.equal(stillOriginal.name, name, "a rejected stale update must not have touched the row");
  assert.equal(stillOriginal.version, 1);

  const renamedName = `${name}-renamed`;
  const update = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/update`,
    authed(token, { name: renamedName, parentId: null, sortOrder: 5, version: 1 })
  );
  const updated = await update.json();
  assert.equal(update.status, 200, JSON.stringify(updated));
  assert.equal(updated.data.version, 2);

  const deactivate = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/deactivate`,
    authed(token, { reason: "整合測試：停用", version: 2 })
  );
  assert.equal(deactivate.status, 200);
  assert.equal((await deactivate.json()).data.status, "inactive");

  const activate = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/activate`,
    authed(token, { reason: "整合測試：重新啟用", version: 3 })
  );
  assert.equal(activate.status, 200);
  assert.equal((await activate.json()).data.status, "active");

  const archive = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/archive`,
    authed(token, { reason: "整合測試：封存", version: 4, password })
  );
  const archived = await archive.json();
  assert.equal(archive.status, 200, JSON.stringify(archived));
  assert.equal(archived.data.status, "archived");

  const restore = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/restore`,
    authed(token, { reason: "整合測試：恢復", version: 5, password })
  );
  const restored = await restore.json();
  assert.equal(restore.status, 200, JSON.stringify(restored));
  assert.equal(restored.data.status, "inactive", "restore 只回到 inactive，不自動 active");

  const del = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/delete`,
    authed(token, { reason: "整合測試：刪除", version: 6, password })
  );
  assert.equal(del.status, 200, await del.text());

  const [[gone]] = await db.query("SELECT COUNT(*) AS c FROM item_categories WHERE id = ?", [categoryId]);
  assert.equal(gone.c, 0);

  const [auditRows] = await db.query(
    "SELECT action FROM item_audit_logs WHERE target_type = 'category' AND target_id = ? ORDER BY id",
    [categoryId]
  );
  assert.deepEqual(
    auditRows.map((row) => row.action),
    ["category.create", "category.update", "category.status", "category.status", "category.status", "category.status", "category.delete"]
  );
});

test("Brand 建立、stale version 409、更新、狀態變更、刪除都經真實 HTTP＋MySQL，並各自寫入 audit", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-2!";

  const role = await seedItemManagerRole(db);
  const actor = await seedUser(db, {
    username: `it-catalog-${randomUUID().slice(0, 8)}`,
    password,
    roleId: role.roleId
  });
  let brandId = null;

  t.after(async () => {
    if (brandId !== null) {
      await cleanupCatalogAudit(db, { targetType: "brand", targetId: brandId });
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
    }
    await cleanupUser(db, actor.userId);
    await role.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });
  const name = `it-brand-${randomUUID().slice(0, 8)}`;

  const create = await fetch(
    `${url}/api/v1/catalog/brands/create`,
    authed(token, { name, officialName: "Official Co.", description: "整合測試品牌" })
  );
  const created = await create.json();
  assert.equal(create.status, 201, JSON.stringify(created));
  brandId = created.data.id;

  const staleUpdate = await fetch(
    `${url}/api/v1/catalog/brands/${brandId}/update`,
    authed(token, { name, officialName: "", description: "", version: 999 })
  );
  assert.equal(staleUpdate.status, 409);
  assert.equal((await staleUpdate.json()).error.code, "VERSION_CONFLICT");

  const update = await fetch(
    `${url}/api/v1/catalog/brands/${brandId}/update`,
    authed(token, { name, officialName: "Renamed Official Co.", description: "改過", version: 1 })
  );
  assert.equal(update.status, 200);
  assert.equal((await update.json()).data.version, 2);

  const deactivate = await fetch(
    `${url}/api/v1/catalog/brands/${brandId}/deactivate`,
    authed(token, { reason: "整合測試：停用", version: 2 })
  );
  assert.equal(deactivate.status, 200);

  const archive = await fetch(
    `${url}/api/v1/catalog/brands/${brandId}/archive`,
    authed(token, { reason: "整合測試：封存", version: 3, password })
  );
  assert.equal(archive.status, 200);

  const del = await fetch(
    `${url}/api/v1/catalog/brands/${brandId}/delete`,
    authed(token, { reason: "整合測試：刪除", version: 4, password })
  );
  assert.equal(del.status, 200, await del.text());

  const [auditRows] = await db.query(
    "SELECT action FROM item_audit_logs WHERE target_type = 'brand' AND target_id = ? ORDER BY id",
    [brandId]
  );
  assert.deepEqual(
    auditRows.map((row) => row.action),
    ["brand.create", "brand.update", "brand.status", "brand.status", "brand.delete"]
  );
});

test("UOM 建立（code 建立後不可修改）、stale version 409、更新、生命週期、刪除都經真實 HTTP＋MySQL", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-3!";

  const role = await seedItemManagerRole(db);
  const actor = await seedUser(db, {
    username: `it-catalog-${randomUUID().slice(0, 8)}`,
    password,
    roleId: role.roleId
  });
  let uomId = null;

  t.after(async () => {
    if (uomId !== null) {
      await cleanupCatalogAudit(db, { targetType: "uom", targetId: uomId });
      await db.execute("DELETE FROM item_uoms WHERE id = ?", [uomId]);
    }
    await cleanupUser(db, actor.userId);
    await role.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });
  const code = `IT-${randomUUID().slice(0, 8)}`;

  const create = await fetch(
    `${url}/api/v1/catalog/uoms/create`,
    authed(token, { code, name: "Integration Each", symbol: "ea" })
  );
  const created = await create.json();
  assert.equal(create.status, 201, JSON.stringify(created));
  uomId = created.data.id;
  assert.equal(created.data.code, code);

  const staleUpdate = await fetch(
    `${url}/api/v1/catalog/uoms/${uomId}/update`,
    authed(token, { name: "Renamed", symbol: "ea", version: 999 })
  );
  assert.equal(staleUpdate.status, 409);
  assert.equal((await staleUpdate.json()).error.code, "VERSION_CONFLICT");

  const update = await fetch(
    `${url}/api/v1/catalog/uoms/${uomId}/update`,
    authed(token, { name: "Renamed Each", symbol: "pc", version: 1 })
  );
  const updated = await update.json();
  assert.equal(update.status, 200, JSON.stringify(updated));
  assert.equal(updated.data.code, code, "code 不接受修改，即使冇喺 update body 出現過");

  const deactivate = await fetch(
    `${url}/api/v1/catalog/uoms/${uomId}/deactivate`,
    authed(token, { reason: "整合測試：停用", version: 2 })
  );
  assert.equal(deactivate.status, 200);

  const archive = await fetch(
    `${url}/api/v1/catalog/uoms/${uomId}/archive`,
    authed(token, { reason: "整合測試：封存", version: 3, password })
  );
  assert.equal(archive.status, 200);

  const restore = await fetch(
    `${url}/api/v1/catalog/uoms/${uomId}/restore`,
    authed(token, { reason: "整合測試：恢復", version: 4, password })
  );
  assert.equal(restore.status, 200);
  assert.equal((await restore.json()).data.status, "inactive");

  const del = await fetch(
    `${url}/api/v1/catalog/uoms/${uomId}/delete`,
    authed(token, { reason: "整合測試：刪除", version: 5, password })
  );
  assert.equal(del.status, 200, await del.text());

  const [auditRows] = await db.query(
    "SELECT action FROM item_audit_logs WHERE target_type = 'uom' AND target_id = ? ORDER BY id",
    [uomId]
  );
  assert.deepEqual(
    auditRows.map((row) => row.action),
    ["uom.create", "uom.update", "uom.status", "uom.status", "uom.status", "uom.delete"]
  );
});

test("只有 item.view 可讀 Catalog GET；只有 item.mgmt 而沒有 item.view 一律 403（沒有 permission inheritance）", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);

  const viewRole = await seedRole(db, { permissionNames: ["item.view"] });
  const mgmtRole = await seedRole(db, { permissionNames: ["item.mgmt"] });
  const viewActor = await seedUser(db, {
    username: `it-view-${randomUUID().slice(0, 8)}`,
    password: "unused-password-1!",
    roleId: viewRole.roleId
  });
  const mgmtActor = await seedUser(db, {
    username: `it-mgmt-${randomUUID().slice(0, 8)}`,
    password: "unused-password-2!",
    roleId: mgmtRole.roleId
  });
  let createdByMgmtId = null;

  t.after(async () => {
    if (createdByMgmtId !== null) {
      await cleanupCatalogAudit(db, { targetType: "category", targetId: createdByMgmtId });
      await db.execute("DELETE FROM item_categories WHERE id = ?", [createdByMgmtId]);
    }
    await cleanupUser(db, viewActor.userId);
    await cleanupUser(db, mgmtActor.userId);
    await viewRole.cleanup();
    await mgmtRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const viewToken = await issueToken(viewActor.userId, { roles: [viewRole.roleName], permissions: ["item.view"] });
  const mgmtToken = await issueToken(mgmtActor.userId, { roles: [mgmtRole.roleName], permissions: ["item.mgmt"] });

  for (const path of ["/api/v1/catalog/categories", "/api/v1/catalog/brands", "/api/v1/catalog/uoms"]) {
    const response = await fetch(`${url}${path}`, get(viewToken));
    assert.equal(response.status, 200, `item.view 應該讀得到 ${path}`);
  }

  const viewCreate = await fetch(
    `${url}/api/v1/catalog/categories/create`,
    authed(viewToken, { name: `it-blocked-${randomUUID().slice(0, 8)}`, parentId: null, sortOrder: 0 })
  );
  assert.equal(viewCreate.status, 403, "item.view 不可以寫入");

  const mgmtRead = await fetch(`${url}/api/v1/catalog/categories`, get(mgmtToken));
  assert.equal(mgmtRead.status, 403, "只有 item.mgmt 而沒有 item.view 不可以讀 GET");

  const mgmtCreate = await fetch(
    `${url}/api/v1/catalog/categories/create`,
    authed(mgmtToken, { name: `it-mgmt-only-${randomUUID().slice(0, 8)}`, parentId: null, sortOrder: 0 })
  );
  const mgmtCreated = await mgmtCreate.json();
  assert.equal(mgmtCreate.status, 201, JSON.stringify(mgmtCreated));
  createdByMgmtId = mgmtCreated.data.id;
});

test("未登入或持有無關權限時，Catalog 寫入端點回 401／403", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);

  const unrelatedRole = await seedRole(db, { permissionNames: ["user.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-unrelated-${randomUUID().slice(0, 8)}`,
    password: "unused-password-3!",
    roleId: unrelatedRole.roleId
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await unrelatedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, { roles: [unrelatedRole.roleName], permissions: ["user.mgmt"] });

  const anonymousResponses = await Promise.all([
    fetch(`${url}/api/v1/catalog/categories`, get(null)),
    fetch(
      `${url}/api/v1/catalog/categories/create`,
      authed("not-a-real-token", { name: "x", parentId: null, sortOrder: 0 })
    ),
    fetch(`${url}/api/v1/catalog/brands/create`, authed("not-a-real-token", { name: "x" })),
    fetch(`${url}/api/v1/catalog/uoms/create`, authed("not-a-real-token", { code: "X", name: "x" }))
  ]);
  for (const response of anonymousResponses) {
    assert.equal(response.status, 401, response.url);
  }

  const forbiddenResponses = await Promise.all([
    fetch(
      `${url}/api/v1/catalog/categories/create`,
      authed(token, { name: "x", parentId: null, sortOrder: 0 })
    ),
    fetch(`${url}/api/v1/catalog/brands/create`, authed(token, { name: "x" })),
    fetch(`${url}/api/v1/catalog/uoms/create`, authed(token, { code: "X", name: "x" }))
  ]);
  for (const response of forbiddenResponses) {
    const body = await response.json();
    assert.equal(response.status, 403, JSON.stringify(body));
  }
});

test("token 宣稱的權限與資料庫現況不符時，Catalog 端點回 403 PERMISSION_STALE", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);

  const role = await seedItemManagerRole(db);
  const actor = await seedUser(db, {
    username: `it-stale-${randomUUID().slice(0, 8)}`,
    password: "unused-password-4!",
    roleId: role.roleId
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  // Claims 宣稱只有 item.mgmt，但資料庫裡呢個角色實際持有 item.view＋
  // item.mgmt 兩項——模擬「token 簽發之後，操作者的權限被改過」，跟
  // userManagement.integration.test.js 的 PERMISSION_STALE 測試同一個手法。
  const staleToken = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.mgmt"] });

  const write = await fetch(
    `${url}/api/v1/catalog/categories/create`,
    authed(staleToken, { name: "x", parentId: null, sortOrder: 0 })
  );
  assert.equal(write.status, 403);
  assert.equal((await write.json()).error.code, "PERMISSION_STALE");

  // GET 要求 item.view，claims 要滿足 authorizationPolicies 那道靜態檢查（否則
  // 連 assertActorFresh 都不會被呼叫到），所以這裡要另外簽一個宣稱只有
  // item.view 的 token——同樣跟資料庫現況（呢個角色其實持有兩項）兜不上。
  const staleViewToken = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view"] });
  const read = await fetch(`${url}/api/v1/catalog/categories`, get(staleViewToken));
  assert.equal(read.status, 403);
  assert.equal((await read.json()).error.code, "PERMISSION_STALE");
});

test("兩個並行的 category move 想互相移到對方底下，只有一個成功，資料庫不會出現環", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);

  const role = await seedItemManagerRole(db);
  const actor = await seedUser(db, {
    username: `it-cycle-${randomUUID().slice(0, 8)}`,
    password: "Integration-Test-Pass-Cycle!",
    roleId: role.roleId
  });
  let categoryAId = null;
  let categoryBId = null;

  t.after(async () => {
    // 不管最後哪一邊贏，其中一顆一定被移到另一顆底下——刪除前要先確認現況，
    // 照 FK RESTRICT（fk_item_categories_parent）的方向，子分類要先刪。
    if (categoryAId !== null && categoryBId !== null) {
      const [[a]] = await db.query("SELECT parent_id FROM item_categories WHERE id = ?", [categoryAId]);
      const childFirst = a && Number(a.parent_id) === categoryBId ? [categoryAId, categoryBId] : [categoryBId, categoryAId];
      for (const id of childFirst) {
        await cleanupCatalogAudit(db, { targetType: "category", targetId: id });
        await db.execute("DELETE FROM item_categories WHERE id = ?", [id]);
      }
    }
    await cleanupUser(db, actor.userId);
    await role.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });

  const createA = await fetch(
    `${url}/api/v1/catalog/categories/create`,
    authed(token, { name: `it-cycle-A-${randomUUID().slice(0, 8)}`, parentId: null, sortOrder: 0 })
  );
  categoryAId = (await createA.json()).data.id;
  const createB = await fetch(
    `${url}/api/v1/catalog/categories/create`,
    authed(token, { name: `it-cycle-B-${randomUUID().slice(0, 8)}`, parentId: null, sortOrder: 0 })
  );
  categoryBId = (await createB.json()).data.id;

  // A 想搬去 B 底下，B 同時想搬去 A 底下——兩顆都是根層級、都還沒有 child，
  // 各自單獨檢查都通過，但兩個都成功的話資料庫就會出現一個真正的環。
  const moveAUnderB = fetch(
    `${url}/api/v1/catalog/categories/${categoryAId}/update`,
    authed(token, { name: `it-cycle-A-renamed`, parentId: categoryBId, sortOrder: 0, version: 1 })
  );
  const moveBUnderA = fetch(
    `${url}/api/v1/catalog/categories/${categoryBId}/update`,
    authed(token, { name: `it-cycle-B-renamed`, parentId: categoryAId, sortOrder: 0, version: 1 })
  );
  const [responseA, responseB] = await Promise.all([moveAUnderB, moveBUnderA]);
  const [bodyA, bodyB] = await Promise.all([responseA.json(), responseB.json()]);

  const outcomes = [
    { status: responseA.status, code: bodyA?.error?.code },
    { status: responseB.status, code: bodyB?.error?.code }
  ];
  const successes = outcomes.filter((outcome) => outcome.status === 200);
  const losers = outcomes.filter((outcome) => outcome.status !== 200);

  assert.equal(successes.length, 1, `expected exactly one move to succeed, got ${JSON.stringify(outcomes)}`);
  assert.equal(losers.length, 1, `expected exactly one move to be rejected, got ${JSON.stringify(outcomes)}`);
  assert.equal(losers[0].status, 400);
  assert.equal(losers[0].code, "CATEGORY_CYCLE");

  const [[refreshedA]] = await db.query("SELECT parent_id FROM item_categories WHERE id = ?", [categoryAId]);
  const [[refreshedB]] = await db.query("SELECT parent_id FROM item_categories WHERE id = ?", [categoryBId]);
  const aUnderB = Number(refreshedA.parent_id) === categoryBId;
  const bUnderA = Number(refreshedB.parent_id) === categoryAId;
  assert.notEqual(aUnderB, bUnderA, "exactly one direction of the move must have actually landed, not both (that would be a cycle) or neither");

  // 真正的驗收：就算上面兩句斷言漏放過一個環，這裡也會抓到——有環的話
  // #buildTree 會做出循環物件圖，GET 就會在 JSON.stringify 炸掉。
  const tree = await fetch(`${url}/api/v1/catalog/categories`, get(token));
  assert.equal(tree.status, 200, await tree.text());
});
