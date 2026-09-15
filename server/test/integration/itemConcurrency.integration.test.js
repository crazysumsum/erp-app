/**
 * T22 嘅並發驗證：version、SKU Code、Barcode、Base UOM 及 last-active 呢幾條
 * race，喺真 MySQL 底下靠 InnoDB 嘅列鎖／unique key，唔係靠應用層自己諗住冇
 * 事就得。設計說明見 docs/items_management/design_spec.md §11.3。
 *
 * 每個測試都用 `Promise.all` 真係同時發兩個 HTTP request，等兩個交易喺真
 * 資料庫入面實際競爭緊同一組列，而唔係順序執行兩次（順序執行測唔到race，
 * 只測到「第二次操作見到第一次已經 commit 嘅結果」）。
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

const PASSWORD = "Integration-Test-Pass-1!";

async function seedUser(db, { username, roleId }) {
  const passwordHash = await hashPassword(PASSWORD);
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

async function seedRole(db, { permissionNames = [] } = {}) {
  const nowMs = Date.now();
  const roleName = `it-role-${randomUUID().slice(0, 8)}`;
  const [roleResult] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, nowMs]);
  const roleId = roleResult.insertId;
  for (const name of permissionNames) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
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

function post(url, token, body) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

async function withManager(t, application) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames: ["item.view", "item.mgmt"] });
  const actor = await seedUser(db, { username: `it-item-cc-${randomUUID().slice(0, 8)}`, roleId: role.roleId });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: ["item.view", "item.mgmt"] });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, actorId: actor.userId };
}

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
  const [uomA] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITCA${suffix}`, "Integration Test Unit A", nowMs, nowMs]
  );
  const [uomB] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITCB${suffix}`, "Integration Test Unit B", nowMs, nowMs]
  );

  return {
    categoryId: category.insertId,
    brandId: brand.insertId,
    uomIdA: uomA.insertId,
    uomIdB: uomB.insertId,
    async cleanup() {
      await db.execute("DELETE FROM item_uoms WHERE id IN (?, ?)", [uomA.insertId, uomB.insertId]);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brand.insertId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [category.insertId]);
    }
  };
}

async function seedItemWithSkus(db, catalog, { itemStatus = "active", skuStatuses = ["active"] } = {}) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [item] = await db.query(
    `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'standard', ?, ?, ?)`,
    [`it-item-${suffix}`, catalog.categoryId, catalog.brandId, itemStatus, nowMs, nowMs]
  );
  const itemId = item.insertId;

  const skus = [];
  for (const [index, skuStatus] of skuStatuses.entries()) {
    const [sku] = await db.query(
      `INSERT INTO item_skus
         (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked,
          suggested_price_amount, status, created_at, updated_at)
       VALUES (?, ?, ?, 'none', 1, 1, 1, '100.0000', ?, ?, ?)`,
      [itemId, `IT-SKU-${suffix}-${index}`, `Integration test SKU ${index}`, skuStatus, nowMs, nowMs]
    );
    const skuId = sku.insertId;
    const [skuUomA] = await db.query(
      `INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, is_default_sale, created_at, updated_at)
       VALUES (?, ?, 1, 1, 1, ?, ?)`,
      [skuId, catalog.uomIdA, nowMs, nowMs]
    );
    await db.query(
      `INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, created_at, updated_at)
       VALUES (?, ?, 12, ?, ?)`,
      [skuId, catalog.uomIdB, nowMs, nowMs]
    );
    skus.push({ id: skuId, skuUomIdA: skuUomA.insertId });
  }

  return {
    itemId,
    skuId: skus[0].id,
    skus,
    async cleanup() {
      const ids = skus.map((s) => s.id);
      const placeholders = ids.map(() => "?").join(",");
      await db.execute(`DELETE FROM item_sku_barcodes WHERE sku_id IN (${placeholders})`, ids);
      await db.execute(`DELETE FROM item_sku_uoms WHERE sku_id IN (${placeholders})`, ids);
      await db.execute(
        `DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id IN (${placeholders})`,
        ids
      );
      await db.execute(`DELETE FROM item_skus WHERE item_id = ?`, [itemId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
  };
}

function statusCounts(results) {
  return results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
}

// --- Version race：Item update ------------------------------------------------

test("TC-004 Version race：兩個並行 update 撞同一個 version，只有一個贏，輸嗰個 409", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const [resultA, resultB] = await Promise.all([
    post(`${url}/api/v1/items/${fixture.itemId}/update`, token, {
      name: "並行改名 A",
      categoryId: catalog.categoryId,
      brandId: catalog.brandId,
      version: 1
    }),
    post(`${url}/api/v1/items/${fixture.itemId}/update`, token, {
      name: "並行改名 B",
      categoryId: catalog.categoryId,
      brandId: catalog.brandId,
      version: 1
    })
  ]);

  const counts = statusCounts([resultA, resultB]);
  assert.deepEqual(counts, { 200: 1, 409: 1 }, JSON.stringify([resultA, resultB]));

  const [[row]] = await db.query("SELECT name, version FROM items WHERE id = ?", [fixture.itemId]);
  assert.equal(row.version, 2);
  assert.ok(row.name === "並行改名 A" || row.name === "並行改名 B");
});

// --- SKU Code race：create ----------------------------------------------------

function itemCreateBody({ categoryId, brandId, uomId, skuCode, barcode }) {
  return {
    item: { name: `it-race-item-${randomUUID().slice(0, 8)}`, categoryId, brandId },
    skus: [
      {
        skuCode,
        skuName: "Race test SKU",
        suggestedPriceAmount: "10.0000",
        uoms: [{ uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: barcode ? [{ barcode, barcodeType: "internal", uomId, isPrimary: true }] : []
      }
    ]
  };
}

test("SKU Code race：兩個並行 create 撞同一個 skuCode，只有一個成功", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const sharedCode = `IT-RACE-CODE-${randomUUID().slice(0, 8)}`;
  const createdItemIds = [];
  t.after(async () => {
    for (const itemId of createdItemIds) {
      await db.execute("DELETE FROM item_sku_uoms WHERE sku_id IN (SELECT id FROM item_skus WHERE item_id = ?)", [
        itemId
      ]);
      await db.execute(
        "DELETE FROM item_audit_logs WHERE target_type IN ('sku','item') AND target_id IN (SELECT id FROM item_skus WHERE item_id = ?) OR (target_type='item' AND target_id = ?)",
        [itemId, itemId]
      );
      await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const [resultA, resultB] = await Promise.all([
    post(`${url}/api/v1/items/create`, token, itemCreateBody({ ...catalog, uomId: catalog.uomIdA, skuCode: sharedCode })),
    post(`${url}/api/v1/items/create`, token, itemCreateBody({ ...catalog, uomId: catalog.uomIdA, skuCode: sharedCode }))
  ]);

  const counts = statusCounts([resultA, resultB]);
  assert.deepEqual(counts, { 201: 1, 409: 1 }, JSON.stringify([resultA, resultB]));

  const winner = resultA.status === 201 ? resultA : resultB;
  const loser = resultA.status === 201 ? resultB : resultA;
  createdItemIds.push(winner.body.data.id);
  assert.equal(loser.body.error.code, "SKU_CODE_TAKEN");

  const [[{ count }]] = await db.query("SELECT COUNT(*) AS count FROM item_skus WHERE sku_code = ?", [sharedCode]);
  assert.equal(count, 1);
});

// --- Barcode race：create ------------------------------------------------------

test("Barcode race：兩個並行 create 撞同一個條碼，只有一個成功", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const sharedBarcode = `IT-RACE-BC-${randomUUID().slice(0, 8)}`;
  const createdItemIds = [];
  t.after(async () => {
    for (const itemId of createdItemIds) {
      await db.execute(
        "DELETE FROM item_sku_barcodes WHERE sku_id IN (SELECT id FROM item_skus WHERE item_id = ?)",
        [itemId]
      );
      await db.execute("DELETE FROM item_sku_uoms WHERE sku_id IN (SELECT id FROM item_skus WHERE item_id = ?)", [
        itemId
      ]);
      await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const [resultA, resultB] = await Promise.all([
    post(
      `${url}/api/v1/items/create`,
      token,
      itemCreateBody({
        ...catalog,
        uomId: catalog.uomIdA,
        skuCode: `IT-RACE-BC-SKU-A-${randomUUID().slice(0, 8)}`,
        barcode: sharedBarcode
      })
    ),
    post(
      `${url}/api/v1/items/create`,
      token,
      itemCreateBody({
        ...catalog,
        uomId: catalog.uomIdA,
        skuCode: `IT-RACE-BC-SKU-B-${randomUUID().slice(0, 8)}`,
        barcode: sharedBarcode
      })
    )
  ]);

  const counts = statusCounts([resultA, resultB]);
  assert.deepEqual(counts, { 201: 1, 409: 1 }, JSON.stringify([resultA, resultB]));

  const winner = resultA.status === 201 ? resultA : resultB;
  const loser = resultA.status === 201 ? resultB : resultA;
  createdItemIds.push(winner.body.data.id);
  assert.equal(loser.body.error.code, "BARCODE_TAKEN");

  const [[{ count }]] = await db.query("SELECT COUNT(*) AS count FROM item_sku_barcodes WHERE barcode = ?", [
    sharedBarcode
  ]);
  assert.equal(count, 1);
});

// --- Base UOM race：update -----------------------------------------------------

test("Base UOM race：兩個並行 update 撞同一個 SKU version，各自想換去唔同 Base UOM，只有一個贏", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const baseUomPayload = (uomId, reasonSuffix) => ({
    skuName: "Integration test SKU 0",
    trackingPolicy: "none",
    purchasable: true,
    sellable: true,
    inventoryTracked: true,
    suggestedPriceAmount: "100.0000",
    uoms: [{ uomId, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
    barcodes: [],
    reason: `並行換 Base UOM ${reasonSuffix}`,
    version: 1
  });

  const [resultA, resultB] = await Promise.all([
    post(`${url}/api/v1/skus/${fixture.skuId}/update`, token, baseUomPayload(catalog.uomIdA, "A")),
    post(`${url}/api/v1/skus/${fixture.skuId}/update`, token, baseUomPayload(catalog.uomIdB, "B"))
  ]);

  const counts = statusCounts([resultA, resultB]);
  assert.deepEqual(counts, { 200: 1, 409: 1 }, JSON.stringify([resultA, resultB]));

  const [baseRows] = await db.query(
    "SELECT uom_id FROM item_sku_uoms WHERE sku_id = ? AND is_base = 1",
    [fixture.skuId]
  );
  assert.equal(baseRows.length, 1, "唔可以出現零個或者多過一個 Base UOM");
});

// --- Last-active race：deactivate ----------------------------------------------

test("Last-active race：兩個並行 deactivate 想同時停用一個 Item 底下兩個 Active SKU，唔可以兩個都成功", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSkus(db, catalog, { itemStatus: "active", skuStatuses: ["active", "active"] });
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const [resultA, resultB] = await Promise.all([
    post(`${url}/api/v1/skus/${fixture.skus[0].id}/deactivate`, token, {
      reason: "並行停用 A",
      version: 1
    }),
    post(`${url}/api/v1/skus/${fixture.skus[1].id}/deactivate`, token, {
      reason: "並行停用 B",
      version: 1
    })
  ]);

  const counts = statusCounts([resultA, resultB]);
  assert.deepEqual(counts, { 200: 1, 409: 1 }, JSON.stringify([resultA, resultB]));

  const [[{ activeCount }]] = await db.query(
    "SELECT COUNT(*) AS activeCount FROM item_skus WHERE item_id = ? AND status = 'active'",
    [fixture.itemId]
  );
  assert.equal(activeCount, 1, "個 Item 唔可以喺呢個過程之後零個 Active SKU");
});
