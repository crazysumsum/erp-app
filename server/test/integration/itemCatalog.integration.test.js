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

/** Category／Brand／UOM 三張表，供 T24 Attribute 測試建立一個真正嘅 Item 用
 * （同 itemCreate.integration.test.js 同名 helper 一致，這裡是這個檔案自己
 * 第一次需要真的建一個 Item，之前的測試都只碰 Catalog 本身）。 */
async function seedCatalog(db) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [category] = await db.query(
    "INSERT INTO item_categories (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-cat-${suffix}`, nowMs, nowMs]
  );
  const [brand] = await db.query(
    "INSERT INTO item_brands (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-brand-${suffix}`, nowMs, nowMs]
  );
  const [uom] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`IT${suffix}`, "Integration Test Unit", nowMs, nowMs]
  );

  return {
    categoryId: category.insertId,
    brandId: brand.insertId,
    uomId: uom.insertId,
    async cleanup() {
      await db.execute("DELETE FROM item_uoms WHERE id = ?", [uom.insertId]);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brand.insertId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [category.insertId]);
    }
  };
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

test("item.view 可唯讀 Catalog；item.mgmt 可讀寫所有 Catalog API", { skip }, async (t) => {
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

    const managerResponse = await fetch(`${url}${path}`, get(mgmtToken));
    assert.equal(managerResponse.status, 200, `item.mgmt 應該讀得到 ${path}`);
  }

  const viewCreate = await fetch(
    `${url}/api/v1/catalog/categories/create`,
    authed(viewToken, { name: `it-blocked-${randomUUID().slice(0, 8)}`, parentId: null, sortOrder: 0 })
  );
  assert.equal(viewCreate.status, 403, "item.view 不可以寫入");

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

// --- T24：Attribute ----------------------------------------------------------

/** 一個最小嘅 Item＋Variant SKU，唯一目的係俾 item_sku_attribute_values 有一
 * 條真嘅 row 指住指定嘅 attribute／option——用嚟驗 isVariant 鎖定同 option
 * 刪除擋（真正嘅建檔行為已經由 itemCreate.integration.test.js 覆蓋，呢度只
 * 係借用 createItem 產生一個「已被使用」嘅 fixture，唔重複驗 create 本身）。 */
async function seedVariantUsage(db, token, url, { categoryId, brandId, uomId, attributeId, optionId }) {
  const suffix = randomUUID().slice(0, 10);
  const options = authed(token, {
    item: { name: `it-variant-usage-${suffix}`, categoryId, brandId, productType: "variant" },
    skus: [
      {
        skuCode: `SKU-VU-${suffix}`,
        skuName: `it-variant-usage-${suffix}`,
        sellable: true,
        uoms: [{ uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [],
        variantValues: [{ attributeId, optionId }]
      }
    ]
  });
  options.headers["Idempotency-Key"] = randomUUID();
  const create = await fetch(`${url}/api/v1/items/create`, options);
  const body = await create.json();
  assert.equal(create.status, 201, JSON.stringify(body));
  const itemId = body.data.id;
  const skuId = body.data.skus[0].id;

  return {
    itemId,
    skuId,
    async cleanup() {
      await db.execute("DELETE FROM item_sku_attribute_values WHERE sku_id = ?", [skuId]);
      await db.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [skuId]);
      await db.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [skuId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id = ?", [skuId]);
      await db.execute("DELETE FROM item_skus WHERE id = ?", [skuId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
  };
}

test("Attribute 建立（連 options）、重複 code／option value 409、原子覆蓋 option 集合、狀態變更、刪除都經真實 HTTP＋MySQL", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-Attr!";

  const role = await seedItemManagerRole(db);
  const actor = await seedUser(db, {
    username: `it-attribute-${randomUUID().slice(0, 8)}`,
    password,
    roleId: role.roleId
  });
  let attributeId = null;
  // usage／catalog 係之後先種嘅 fixture（見下面），喺呢度一齊宣告係為咗俾
  // 呢一個 t.after 用同一個順序全部清埋，唔使搞多個 t.after 之間嘅執行次序
  // ——node:test 嘅 after hook 係跟註冊順序（FIFO）行，唔係 LIFO，用多個
  // t.after 分開註冊反而要操心邊個先執行；一個 hook、明確順序更直接。
  let catalog = null;
  let usage = null;

  // 呢個 t.after 一定要撐到 application.shutdown()：如果中間任何一步拋錯，
  // shutdown 冧咗都冧唔到，個 process 就會因為個 HTTP server／DB pool 仲開住
  // 而唔會結束。清理順序要跟返 FK 方向：先 usage（釋放
  // item_sku_attribute_values 對 attribute／option 嘅 RESTRICT）、
  // 再 catalog、先至到 attribute 本身。
  t.after(async () => {
    try {
      if (usage !== null) {
        await usage.cleanup();
      }
      if (catalog !== null) {
        await catalog.cleanup();
      }
      if (attributeId !== null) {
        await cleanupCatalogAudit(db, { targetType: "attribute", targetId: attributeId });
        await db.execute("DELETE FROM item_attribute_options WHERE attribute_id = ?", [attributeId]);
        await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [attributeId]);
      }
      await cleanupUser(db, actor.userId);
      await role.cleanup();
    } finally {
      await application.shutdown("integration_test_complete");
    }
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });
  const code = `it-attr-${randomUUID().slice(0, 8)}`;

  const create = await fetch(
    `${url}/api/v1/catalog/attributes/create`,
    authed(token, {
      code,
      name: "顏色",
      dataType: "single_option",
      isVariant: true,
      options: [
        { value: "red", label: "紅" },
        { value: "blue", label: "藍" }
      ]
    })
  );
  const created = await create.json();
  assert.equal(create.status, 201, JSON.stringify(created));
  attributeId = created.data.id;
  assert.equal(created.data.options.length, 2);
  const redOptionId = created.data.options.find((option) => option.value === "red").id;
  const blueOptionId = created.data.options.find((option) => option.value === "blue").id;

  const duplicateCode = await fetch(
    `${url}/api/v1/catalog/attributes/create`,
    authed(token, { code, name: "另一個顏色", dataType: "single_option", options: [{ value: "x", label: "x" }] })
  );
  assert.equal(duplicateCode.status, 409);
  assert.equal((await duplicateCode.json()).error.code, "ATTRIBUTE_CODE_TAKEN");

  const staleUpdate = await fetch(
    `${url}/api/v1/catalog/attributes/${attributeId}/update`,
    authed(token, {
      name: "顏色",
      isVariant: true,
      isFilterable: false,
      options: [{ id: redOptionId, value: "red", label: "紅" }],
      version: 999
    })
  );
  assert.equal(staleUpdate.status, 409, JSON.stringify(await staleUpdate.clone().json()));
  assert.equal((await staleUpdate.json()).error.code, "VERSION_CONFLICT");

  // 原子覆蓋：保留 red（改 label）、刪走 blue、新增 green。
  const update = await fetch(
    `${url}/api/v1/catalog/attributes/${attributeId}/update`,
    authed(token, {
      name: "顏色（修訂）",
      isVariant: true,
      isFilterable: true,
      options: [
        { id: redOptionId, value: "red", label: "大紅" },
        { value: "green", label: "綠" }
      ],
      version: 1
    })
  );
  const updated = await update.json();
  assert.equal(update.status, 200, JSON.stringify(updated));
  assert.deepEqual(updated.data.options.map((option) => option.value).sort(), ["green", "red"]);
  const [[blueGone]] = await db.query("SELECT id FROM item_attribute_options WHERE id = ?", [blueOptionId]);
  assert.equal(blueGone, undefined, "blue option 應該已經被刪走");

  const duplicateOptionValue = await fetch(
    `${url}/api/v1/catalog/attributes/${attributeId}/update`,
    authed(token, {
      name: "顏色（修訂）",
      isVariant: true,
      isFilterable: true,
      options: [
        { id: redOptionId, value: "red", label: "大紅" },
        { value: "red", label: "重複" }
      ],
      version: 2
    })
  );
  assert.equal(duplicateOptionValue.status, 409);
  assert.equal((await duplicateOptionValue.json()).error.code, "ATTRIBUTE_OPTION_VALUE_TAKEN");

  // 建一個真正用緊呢個屬性同 red option 嘅 Variant SKU，驗 isVariant 鎖定、
  // option 刪除擋，以及最終刪除屬性擋（design_spec.md §10.3：「Attribute
  // data type／variant flag 被 Active SKU 使用後不可破壞性修改」）。
  catalog = await seedCatalog(db);
  usage = await seedVariantUsage(db, token, url, {
    categoryId: catalog.categoryId,
    brandId: catalog.brandId,
    uomId: catalog.uomId,
    attributeId,
    optionId: redOptionId
  });

  const flipIsVariant = await fetch(
    `${url}/api/v1/catalog/attributes/${attributeId}/update`,
    authed(token, {
      name: "顏色（修訂）",
      isVariant: false,
      isFilterable: true,
      options: [{ id: redOptionId, value: "red", label: "大紅" }, { value: "green", label: "綠" }],
      version: 2
    })
  );
  assert.equal(flipIsVariant.status, 409, JSON.stringify(await flipIsVariant.clone().json()));
  assert.equal((await flipIsVariant.json()).error.code, "ATTRIBUTE_IN_USE");

  const removeUsedOption = await fetch(
    `${url}/api/v1/catalog/attributes/${attributeId}/update`,
    authed(token, {
      name: "顏色（修訂）",
      isVariant: true,
      isFilterable: true,
      options: [{ value: "green", label: "綠" }],
      version: 2
    })
  );
  assert.equal(removeUsedOption.status, 409, JSON.stringify(await removeUsedOption.clone().json()));
  assert.equal((await removeUsedOption.json()).error.code, "ATTRIBUTE_OPTION_IN_USE");

  const deactivate = await fetch(
    `${url}/api/v1/catalog/attributes/${attributeId}/deactivate`,
    authed(token, { reason: "整合測試：停用", version: 2 })
  );
  assert.equal(deactivate.status, 200, await deactivate.text());

  const deleteWhileUsed = await fetch(
    `${url}/api/v1/catalog/attributes/${attributeId}/delete`,
    authed(token, { reason: "整合測試：刪除", version: 3, password })
  );
  assert.equal(deleteWhileUsed.status, 409, JSON.stringify(await deleteWhileUsed.clone().json()));
  assert.equal((await deleteWhileUsed.json()).error.code, "CATALOG_IN_USE");

  await usage.cleanup();
  await catalog.cleanup();

  const del = await fetch(
    `${url}/api/v1/catalog/attributes/${attributeId}/delete`,
    authed(token, { reason: "整合測試：刪除", version: 3, password })
  );
  assert.equal(del.status, 200, await del.text());

  const [auditRows] = await db.query(
    "SELECT action FROM item_audit_logs WHERE target_type = 'attribute' AND target_id = ? ORDER BY id",
    [attributeId]
  );
  assert.deepEqual(
    auditRows.map((row) => row.action),
    ["attribute.create", "attribute.update", "attribute.status", "attribute.delete"]
  );

  attributeId = null;
});

// --- T24：Category attribute assignment ---------------------------------------

test("Category attribute assignment：expectedAttributeIds 過期時拒絕覆蓋，一致時原子覆蓋並可經 GET 讀返", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);

  const role = await seedItemManagerRole(db);
  const actor = await seedUser(db, {
    username: `it-cat-attr-${randomUUID().slice(0, 8)}`,
    password: "Integration-Test-Pass-CatAttr!",
    roleId: role.roleId
  });
  let categoryId = null;
  let attributeAId = null;
  let attributeBId = null;

  t.after(async () => {
    if (categoryId !== null) {
      await db.execute("DELETE FROM item_category_attributes WHERE category_id = ?", [categoryId]);
      await cleanupCatalogAudit(db, { targetType: "category", targetId: categoryId });
      await db.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
    }
    for (const id of [attributeAId, attributeBId]) {
      if (id !== null) {
        await cleanupCatalogAudit(db, { targetType: "attribute", targetId: id });
        await db.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [id]);
      }
    }
    await cleanupUser(db, actor.userId);
    await role.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });
  const suffix = randomUUID().slice(0, 8);

  const createCategory = await fetch(
    `${url}/api/v1/catalog/categories/create`,
    authed(token, { name: `it-cat-attr-${suffix}`, parentId: null, sortOrder: 0 })
  );
  categoryId = (await createCategory.json()).data.id;

  const createA = await fetch(
    `${url}/api/v1/catalog/attributes/create`,
    authed(token, { code: `it-catattr-a-${suffix}`, name: "口味", dataType: "single_option", options: [{ value: "sweet", label: "甜" }] })
  );
  attributeAId = (await createA.json()).data.id;

  const createB = await fetch(
    `${url}/api/v1/catalog/attributes/create`,
    authed(token, { code: `it-catattr-b-${suffix}`, name: "容量", dataType: "decimal" })
  );
  attributeBId = (await createB.json()).data.id;

  const emptyGet = await fetch(`${url}/api/v1/catalog/categories/${categoryId}/attributes`, get(token));
  assert.equal(emptyGet.status, 200);
  assert.deepEqual((await emptyGet.json()).data.assignments, []);

  const staleAssign = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/attributes/assign`,
    authed(token, {
      assignments: [{ attributeId: attributeAId, requiredForActivation: true, sortOrder: 0 }],
      expectedAttributeIds: [attributeBId]
    })
  );
  assert.equal(staleAssign.status, 409);
  assert.equal((await staleAssign.json()).error.code, "CATEGORY_ATTRIBUTES_STALE");

  const assign = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/attributes/assign`,
    authed(token, {
      assignments: [
        { attributeId: attributeAId, requiredForActivation: true, sortOrder: 0 },
        { attributeId: attributeBId, requiredForActivation: false, sortOrder: 1 }
      ],
      expectedAttributeIds: []
    })
  );
  const assigned = await assign.json();
  assert.equal(assign.status, 200, JSON.stringify(assigned));
  assert.deepEqual(
    assigned.data.assignments.map((a) => a.attributeId).sort((x, y) => x - y),
    [attributeAId, attributeBId].sort((x, y) => x - y)
  );

  const filledGet = await fetch(`${url}/api/v1/catalog/categories/${categoryId}/attributes`, get(token));
  const filled = await filledGet.json();
  assert.equal(filled.data.assignments.length, 2);

  // 用返讀到嘅現況做 expectedAttributeIds，移除其中一個。
  const remove = await fetch(
    `${url}/api/v1/catalog/categories/${categoryId}/attributes/assign`,
    authed(token, {
      assignments: [{ attributeId: attributeAId, requiredForActivation: true, sortOrder: 0 }],
      expectedAttributeIds: filled.data.assignments.map((a) => a.attributeId)
    })
  );
  const removed = await remove.json();
  assert.equal(remove.status, 200, JSON.stringify(removed));
  assert.deepEqual(removed.data.assignments.map((a) => a.attributeId), [attributeAId]);

  const [auditRows] = await db.query(
    "SELECT action FROM item_audit_logs WHERE target_type = 'category' AND target_id = ? AND action = 'category.attributes.assign' ORDER BY id",
    [categoryId]
  );
  assert.equal(auditRows.length, 2);
});
