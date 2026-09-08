/**
 * T22：Item Management 嘅核心端到端流程，對一個真的、已經 migrate 過的
 * MySQL 一次過走晒 Catalog → Item＋兩個 SKU → 搜尋 → 更新 → 生命週期 →
 * audit → cleanup。設計說明見 docs/items_management/design_spec.md §11.2。
 *
 * ⚠️ 範圍決定：用「Item＋兩個 SKU」代替 design_spec §11.2 原文寫嘅「Variant
 * Item＋兩個 SKU」。Variant 支援（`productType: "variant"`、Attribute
 * schema、variant signature）要等 T23 先建立——T14 當初已經因為呢個原因決定
 * `createItem()` 只做 Standard（一個 Item 恰好一個 SKU），呢個決定記喺
 * tasks.md 嘅 T14 條目。呢個 task 淨係測緊「一個 Item 底下有兩粒 SKU」呢種
 * 情況本身嘅行為（cascade、搜尋、audit），同「呢兩粒 SKU 係咪由 variant
 * attribute 組合出嚟」冇關係，所以用一個 Standard Item 建檔＋直接種多一粒
 * SKU（同 itemHighRisk／itemLifecycle 兩個 test 檔已經用緊嘅做法一致）一樣
 * 測得到呢個 task 真正想驗嘅嘢，唔使等 T23。
 *
 * 呢個檔案唔重複已經喺其他檔案驗過嘅嘢：
 * - LIKE 萬用字元跳脫、response 唔洩漏 DB 內部欄位、read API 嘅
 *   401／403／stale permission 矩陣 —— test/integration/itemRead.integration
 *   .test.js（T12）已經覆蓋。
 * - Child ownership／IDOR（SKU_CHILD_MISMATCH、跨 SKU barcode 404）——
 *   test/integration/itemUpdate.integration.test.js（T16）、
 *   itemHighRisk.integration.test.js（T20）已經覆蓋。
 * - Error response 唔洩漏 SQL／stack／檔案路徑——呢個係框架層跨模組保證
 *   （見 test/apiDispatcher.test.js、test/mysqlDatabaseFailureModes.test.js），
 *   唔係 Item 專屬行為，唔使每個模組各自重測一次。
 * - Version／SKU Code／Barcode／Base UOM／last-active 呢五種 race——
 *   test/integration/itemConcurrency.integration.test.js（呢個 task 新建）。
 *
 * 呢個檔案專門補嘅缺口：完整走一次嘅端到端敘事（證明成條鏈組合埋一齊冇問題，
 * 唔淨係每一截獨立啱），加埋 sort whitelist 拒絕同 XSS-as-text 呢兩個之前
 * 未有專門測試覆蓋嘅斷言。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { createTestDevice } from "../../test-support/testDevice.js";

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
  await db.execute("DELETE FROM user_devices WHERE user_id = ?", [userId]);
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

async function seedApprovedDevice(db, { userId, device }) {
  const nowMs = Date.now();
  await db.execute(
    `INSERT INTO user_devices
       (user_id, device_id, public_key, label, status, requested_at, requested_ip, requested_ua, reviewed_at)
     VALUES (?, ?, ?, '', 'approved', ?, '', '', ?)`,
    [userId, device.deviceId, device.publicKeyDer, nowMs, nowMs]
  );
}

function tokenIssuer(application) {
  const jwt = application.services.require("jwt");
  const tokenRevocation = application.services.require("tokenRevocation");
  const time = application.services.require("time");
  return async (userId, { roles, permissions, did }) => {
    const version = await tokenRevocation.currentVersion(String(userId));
    const authTime = Math.floor(time.nowMs() / 1000);
    const claims = { roles, permissions };
    if (did) {
      claims.did = did;
    }
    return jwt.issue(claims, { subject: String(userId), version, authTime });
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

function get(url, token) {
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (response) => ({
    status: response.status,
    body: await response.json()
  }));
}

async function signedPost(baseUrl, path, device, token, body) {
  const bodyText = JSON.stringify(body);
  const headers = await device.headers({ method: "POST", path, body: bodyText, token });
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: bodyText
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

test("端到端：Catalog → Item＋兩個 SKU → 搜尋 → 更新 → 生命週期 → audit → cleanup", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);

  const role = await seedRole(db, { permissionNames: ["item.view", "item.mgmt"] });
  const actor = await seedUser(db, { username: `it-e2e-${randomUUID().slice(0, 8)}`, roleId: role.roleId });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });
  const token = await issueToken(actor.userId, {
    roles: [role.roleName],
    permissions: ["item.view", "item.mgmt"],
    did: device.deviceId
  });

  const viewOnlyRole = await seedRole(db, { permissionNames: ["item.view"] });
  const viewOnlyActor = await seedUser(db, {
    username: `it-e2e-view-${randomUUID().slice(0, 8)}`,
    roleId: viewOnlyRole.roleId
  });
  const viewOnlyToken = await issueToken(viewOnlyActor.userId, {
    roles: [viewOnlyRole.roleName],
    permissions: ["item.view"]
  });

  let itemId = null;
  let skuId1 = null;
  let skuId2 = null;
  let categoryId = null;
  let brandId = null;
  let uomIdA = null;
  let uomIdB = null;

  t.after(async () => {
    if (skuId1 !== null || skuId2 !== null) {
      const ids = [skuId1, skuId2].filter((id) => id !== null);
      const placeholders = ids.map(() => "?").join(",");
      await db.execute(`DELETE FROM item_sku_barcodes WHERE sku_id IN (${placeholders})`, ids);
      await db.execute(`DELETE FROM item_sku_uoms WHERE sku_id IN (${placeholders})`, ids);
      await db.execute(
        `DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id IN (${placeholders})`,
        ids
      );
    }
    if (itemId !== null) {
      await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
    // Category／Brand／UOM 一定要喺 Item 刪咗之後先刪：items.category_id／
    // brand_id 同 item_sku_uoms.uom_id 都係 FK RESTRICT。
    if (categoryId !== null) {
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'category' AND target_id = ?", [categoryId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
    }
    if (brandId !== null) {
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'brand' AND target_id = ?", [brandId]);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
    }
    const uomIds = [uomIdA, uomIdB].filter((id) => id !== null);
    if (uomIds.length > 0) {
      const uomPlaceholders = uomIds.map(() => "?").join(",");
      await db.execute(
        `DELETE FROM item_audit_logs WHERE target_type = 'uom' AND target_id IN (${uomPlaceholders})`,
        uomIds
      );
      await db.execute(`DELETE FROM item_uoms WHERE id IN (${uomPlaceholders})`, uomIds);
    }
    await cleanupUser(db, actor.userId);
    await role.cleanup();
    await cleanupUser(db, viewOnlyActor.userId);
    await viewOnlyRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const suffix = randomUUID().slice(0, 8);

  // 1. Catalog：Category、Brand、兩個 UOM。
  const category = await post(`${url}/api/v1/catalog/categories/create`, token, {
    name: `it-e2e-cat-${suffix}`
  });
  assert.equal(category.status, 201, JSON.stringify(category.body));
  categoryId = category.body.data.id;

  const brand = await post(`${url}/api/v1/catalog/brands/create`, token, {
    name: `it-e2e-brand-${suffix}`
  });
  assert.equal(brand.status, 201, JSON.stringify(brand.body));
  brandId = brand.body.data.id;

  const uomA = await post(`${url}/api/v1/catalog/uoms/create`, token, {
    code: `ITEA${suffix}`,
    name: "Integration Test Each"
  });
  assert.equal(uomA.status, 201, JSON.stringify(uomA.body));
  uomIdA = uomA.body.data.id;

  const uomB = await post(`${url}/api/v1/catalog/uoms/create`, token, {
    code: `ITEB${suffix}`,
    name: "Integration Test Box"
  });
  assert.equal(uomB.status, 201, JSON.stringify(uomB.body));
  uomIdB = uomB.body.data.id;

  // 2. 原子建立 Item＋第一個 SKU（含 barcode），Draft。
  const itemName = `it-e2e-item-${suffix}`;
  const skuCode1 = `IT-E2E-SKU1-${suffix}`;
  const barcode1 = `IT-E2E-BC1-${suffix}`;
  const created = await post(`${url}/api/v1/items/create`, token, {
    item: { name: itemName, categoryId, brandId },
    skus: [
      {
        skuCode: skuCode1,
        skuName: "Integration test SKU 1",
        suggestedPriceAmount: "50.0000",
        uoms: [{ uomId: uomIdA, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
        barcodes: [{ barcode: barcode1, barcodeType: "internal", uomId: uomIdA, isPrimary: true }]
      }
    ]
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  itemId = created.body.data.id;
  skuId1 = created.body.data.skus[0].id;
  assert.equal(created.body.data.status, "draft");

  // ⚠️ 第二個 SKU：Variant 支援未存在，直接種一粒 Draft SKU 落去同一個
  // Item，模擬「一個 Item 底下有兩粒 SKU」呢個情況本身——見檔案頂部說明。
  const nowMs = Date.now();
  const skuCode2 = `IT-E2E-SKU2-${suffix}`;
  const [sku2Result] = await db.query(
    `INSERT INTO item_skus
       (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked,
        suggested_price_amount, status, created_at, updated_at)
     VALUES (?, ?, ?, 'none', 1, 1, 1, '80.0000', 'draft', ?, ?)`,
    [itemId, skuCode2, "Integration test SKU 2", nowMs, nowMs]
  );
  skuId2 = sku2Result.insertId;
  await db.query(
    `INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, is_default_sale, created_at, updated_at)
     VALUES (?, ?, 1, 1, 1, ?, ?)`,
    [skuId2, uomIdB, nowMs, nowMs]
  );

  // 3. 只有 item.view 冇 item.mgmt：可以睇，但活躍呢個高風險寫入動作要拒絕。
  const activateForbidden = await post(`${url}/api/v1/items/${itemId}/activate`, viewOnlyToken, {
    skuIds: [skuId1, skuId2],
    reason: "唔應該通過",
    version: 1
  });
  assert.equal(activateForbidden.status, 403, JSON.stringify(activateForbidden.body));

  // 4. item.mgmt：一齊啟用兩粒 SKU，Item 跟住轉 Active。
  const activated = await post(`${url}/api/v1/items/${itemId}/activate`, token, {
    skuIds: [skuId1, skuId2],
    reason: "整合測試：一齊啟用兩粒 SKU",
    version: 1
  });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  assert.equal(activated.body.data.status, "active");
  assert.ok(activated.body.data.skus.every((sku) => sku.status === "active"));

  // 5. 搜尋：Item 名、SKU Code 都搵得返，projection 冇洩漏內部欄位，RRP 固定
  //    HKD／tax_not_applicable。
  const itemSearch = await get(`${url}/api/v1/items?q=${encodeURIComponent(itemName)}`, token);
  assert.equal(itemSearch.status, 200);
  assert.ok(itemSearch.body.data.items.some((row) => row.id === itemId));

  const skuSearch = await get(`${url}/api/v1/skus?q=${encodeURIComponent(skuCode1)}`, token);
  assert.equal(skuSearch.status, 200);
  const foundSku = skuSearch.body.data.items.find((row) => row.id === skuId1);
  assert.ok(foundSku, "應該搵到 SKU1");
  assert.equal(foundSku.categoryName, `it-e2e-cat-${suffix}`);
  assert.equal(foundSku.brandName, `it-e2e-brand-${suffix}`);
  assert.equal(foundSku.suggestedRetailPrice.currency, "HKD");
  assert.equal(foundSku.suggestedRetailPrice.taxBasis, "tax_not_applicable");
  assert.equal(foundSku.primaryBarcode, barcode1);

  // 6. 更新 RRP，version 遞增，audit 記低 before／after。
  const rrpUpdate = await post(`${url}/api/v1/skus/${skuId1}/update`, token, {
    skuName: "Integration test SKU 1",
    trackingPolicy: "none",
    purchasable: true,
    sellable: true,
    inventoryTracked: true,
    suggestedPriceAmount: "65.0000",
    uoms: [{ uomId: uomIdA, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
    barcodes: [{ barcode: barcode1, barcodeType: "internal", uomId: uomIdA, isPrimary: true }],
    version: 2
  });
  assert.equal(rrpUpdate.status, 200, JSON.stringify(rrpUpdate.body));
  assert.equal(rrpUpdate.body.data.suggestedRetailPrice.amount, "65.0000");
  assert.equal(rrpUpdate.body.data.version, 3);

  // 7. Stale version：409，DB／audit 完全冇變。
  const staleUpdate = await post(`${url}/api/v1/skus/${skuId1}/update`, token, {
    skuName: "唔應該成功",
    trackingPolicy: "none",
    purchasable: true,
    sellable: true,
    inventoryTracked: true,
    suggestedPriceAmount: "999.0000",
    uoms: [{ uomId: uomIdA, toBaseFactor: 1, isBase: true, isDefaultSale: true }],
    barcodes: [{ barcode: barcode1, barcodeType: "internal", uomId: uomIdA, isPrimary: true }],
    version: 2
  });
  assert.equal(staleUpdate.status, 409, JSON.stringify(staleUpdate.body));
  assert.equal(staleUpdate.body.error.code, "VERSION_CONFLICT");
  const [[skuAfterStale]] = await db.query("SELECT sku_name, version FROM item_skus WHERE id = ?", [skuId1]);
  assert.notEqual(skuAfterStale.sku_name, "唔應該成功");
  assert.equal(skuAfterStale.version, 3);

  // 8. Item deactivate：cascade 兩粒 SKU 一齊轉 inactive。
  const deactivated = await post(`${url}/api/v1/items/${itemId}/deactivate`, token, {
    reason: "整合測試：停用",
    version: 2
  });
  assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));
  const [skuStatusesAfterDeactivate] = await db.query("SELECT status FROM item_skus WHERE item_id = ?", [itemId]);
  assert.ok(skuStatusesAfterDeactivate.every((row) => row.status === "inactive"));

  // 9. Item archive（password）：cascade 兩粒 SKU 一齊轉 archived。
  const archived = await post(`${url}/api/v1/items/${itemId}/archive`, token, {
    reason: "整合測試：封存",
    version: 3,
    password: PASSWORD
  });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));

  // 10. Item restore（password）：Item 變 inactive，但 SKU 唔會自動 Active
  //     （design_spec §4.2）——連 archived 都唔會，仍然要逐一 restore。
  const restored = await post(`${url}/api/v1/items/${itemId}/restore`, token, {
    reason: "整合測試：恢復",
    version: 4,
    password: PASSWORD
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.data.status, "inactive");
  const [skuStatusesAfterRestore] = await db.query("SELECT status FROM item_skus WHERE item_id = ?", [itemId]);
  assert.ok(skuStatusesAfterRestore.every((row) => row.status === "archived"));

  // 11. 逐一 restore SKU1。
  const skuRestored = await post(`${url}/api/v1/skus/${skuId1}/restore`, token, {
    reason: "整合測試：SKU 逐一恢復",
    version: 5,
    password: PASSWORD
  });
  assert.equal(skuRestored.status, 200, JSON.stringify(skuRestored.body));
  assert.equal(skuRestored.body.data.status, "inactive");

  // 12. SKU Code 特批修改（jwt-device-password）：真設備簽章＋密碼，audit
  //     記低 before／after。
  const newSkuCode1 = `IT-E2E-RENAMED-${suffix}`;
  const codeChangePath = `/api/v1/skus/${skuId1}/code/change`;
  const codeChanged = await signedPost(url, codeChangePath, device, token, {
    skuCode: newSkuCode1,
    reason: "整合測試：特批改 Code",
    version: 6,
    password: PASSWORD
  });
  assert.equal(codeChanged.status, 200, JSON.stringify(codeChanged.body));
  assert.equal(codeChanged.body.data.skuCode, newSkuCode1);

  // 13. Audit trail：完整走過嘅動作，順序同數量都啱。
  const [itemAuditRows] = await db.query(
    "SELECT action FROM item_audit_logs WHERE target_type = 'item' AND target_id = ? ORDER BY id",
    [itemId]
  );
  assert.deepEqual(
    itemAuditRows.map((row) => row.action),
    ["item.create", "item.activate", "item.deactivate", "item.archive", "item.restore"]
  );

  const [sku1AuditRows] = await db.query(
    "SELECT action FROM item_audit_logs WHERE target_type = 'sku' AND target_id = ? ORDER BY id",
    [skuId1]
  );
  assert.deepEqual(
    sku1AuditRows.map((row) => row.action),
    ["sku.create", "sku.activate", "sku.update", "sku.deactivate", "sku.archive", "sku.restore", "sku.code.change"]
  );

  // 14. XSS-as-text：商品名帶 <script> 只當純文字儲存及回傳，唔會喺 API 層
  //     被執行、清走或以其他形式改寫。
  const xssName = `<script>alert(1)</script>-${suffix}`;
  const xssUpdate = await post(`${url}/api/v1/items/${itemId}/update`, token, {
    name: xssName,
    categoryId,
    brandId,
    version: 5
  });
  assert.equal(xssUpdate.status, 200, JSON.stringify(xssUpdate.body));
  assert.equal(xssUpdate.body.data.name, xssName, "應該原封不動存返轉頭，唔會被過濾或轉義");
  const [[xssRow]] = await db.query("SELECT name FROM items WHERE id = ?", [itemId]);
  assert.equal(xssRow.name, xssName);

  // 15. Sort whitelist：唔喺白名單入面嘅 sortBy 值畀 schema 擋，唔會拼落 SQL。
  const badSort = await get(`${url}/api/v1/items?sortBy=${encodeURIComponent("id; DROP TABLE items;--")}`, token);
  assert.equal(badSort.status, 400, JSON.stringify(badSort.body));
});
