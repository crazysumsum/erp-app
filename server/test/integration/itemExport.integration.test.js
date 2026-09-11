/**
 * T31 的 SKU export 端點，對一個真的、已經 migrate 過的 MySQL 驗收。要嘅係
 * 假連線給不了嘅嘢：filter 組合出嚟嘅 SQL 是不是真係得返符合條件嘅 SKU、
 * CSV 內容係咪固定 HKD／tax_not_applicable 同 ISO 8601＋offset 時間、
 * audit 係咪真係寫咗一筆但冇保存成份 CSV。設計說明見
 * docs/items_management/design_spec.md §6.8。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
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

async function seedUser(db, { username, roleId }) {
  const passwordHash = await hashPassword("unused-password!");
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

async function withActor(t, application, permissionNames) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames });
  const actor = await seedUser(db, { username: `it-export-${randomUUID().slice(0, 8)}`, roleId: role.roleId });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: permissionNames });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, actorId: actor.userId };
}

async function seedFixture(db) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);

  const [category] = await db.query("INSERT INTO item_categories (name, created_at, updated_at) VALUES (?, ?, ?)", [
    `it-export-cat-${suffix}`,
    nowMs,
    nowMs
  ]);
  const categoryId = category.insertId;
  const [brand] = await db.query("INSERT INTO item_brands (name, created_at, updated_at) VALUES (?, ?, ?)", [
    `it-export-brand-${suffix}`,
    nowMs,
    nowMs
  ]);
  const brandId = brand.insertId;

  const itemIds = [];
  const skuIds = [];

  return {
    categoryId,
    brandId,
    suffix,
    async seedItem() {
      const [item] = await db.query(
        `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
         VALUES (?, ?, ?, 'standard', 'draft', ?, ?)`,
        [`it-export-item-${randomUUID().slice(0, 8)}`, categoryId, brandId, nowMs, nowMs]
      );
      itemIds.push(item.insertId);
      return item.insertId;
    },
    async seedSku(
      itemId,
      { skuCode, skuName = `Export 測試 SKU ${skuCode}`, suggestedPriceAmount = "88.0000", status = "active" } = {}
    ) {
      const [sku] = await db.query(
        `INSERT INTO item_skus
           (item_id, sku_code, sku_name, suggested_price_amount, purchasable, sellable, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)`,
        [itemId, skuCode, skuName, suggestedPriceAmount, status, nowMs, nowMs]
      );
      skuIds.push(sku.insertId);
      return sku.insertId;
    },
    async cleanup() {
      for (const skuId of skuIds) {
        await db.execute("DELETE FROM item_skus WHERE id = ?", [skuId]);
      }
      for (const itemId of itemIds) {
        await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
      }
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
    }
  };
}

function getCsv(url, token) {
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (response) => ({
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    text: await response.text()
  }));
}

test("GET /item-exports/skus：按 categoryId 篩選匯出，固定 HKD／tax_not_applicable，updatedAt 係 ISO 8601＋offset", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withActor(t, application, ["item.mgmt"]);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const itemId = await fixture.seedItem();
  const skuCode = `IT-EXPORT-${fixture.suffix}`;
  await fixture.seedSku(itemId, { skuCode, suggestedPriceAmount: "168.5000" });

  const result = await getCsv(`${url}/api/v1/item-exports/skus?categoryId=${fixture.categoryId}`, token);
  assert.equal(result.status, 200, result.text);
  assert.match(result.contentType, /text\/csv/);

  const records = parse(result.text, { bom: true, columns: true });
  const record = records.find((row) => row.skuCode === skuCode);
  assert.ok(record, "匯出結果要包含啱啱建立嘅 SKU");
  assert.equal(record.suggestedPriceAmount, "168.5000");
  assert.equal(record.currency, "HKD");
  assert.equal(record.taxBasis, "tax_not_applicable");
  assert.equal(record.status, "active");
  assert.match(record.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "updatedAt 要係無歧義 ISO 8601＋offset");
});

test("GET /item-exports/skus：SKU 名稱開頭係 =／+／-／@ 會加單引號，防試算表當公式執行（CSV injection）", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withActor(t, application, ["item.mgmt"]);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const itemId = await fixture.seedItem();
  const skuCode = `IT-EXPORT-CSVI-${fixture.suffix}`;
  await fixture.seedSku(itemId, { skuCode, skuName: '=cmd|"/c calc"!A1' });

  const result = await getCsv(`${url}/api/v1/item-exports/skus?categoryId=${fixture.categoryId}`, token);
  assert.equal(result.status, 200, result.text);

  const records = parse(result.text, { bom: true, columns: true });
  const record = records.find((row) => row.skuCode === skuCode);
  assert.ok(record);
  assert.equal(record.skuName, '\'=cmd|"/c calc"!A1', "開頭嘅 = 前面要加咗單引號，試算表先會當純文字");
});

test("GET /item-exports/skus：預設唔包含 archived，明確 status=archived 先見到", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withActor(t, application, ["item.mgmt"]);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const itemId = await fixture.seedItem();
  const skuCode = `IT-EXPORT-ARCH-${fixture.suffix}`;
  await fixture.seedSku(itemId, { skuCode, status: "archived" });

  const defaultResult = await getCsv(`${url}/api/v1/item-exports/skus?categoryId=${fixture.categoryId}`, token);
  const defaultRecords = parse(defaultResult.text, { bom: true, columns: true });
  assert.ok(!defaultRecords.some((row) => row.skuCode === skuCode), "預設匯出唔應該包含 archived SKU");

  const archivedResult = await getCsv(
    `${url}/api/v1/item-exports/skus?categoryId=${fixture.categoryId}&status=archived`,
    token
  );
  const archivedRecords = parse(archivedResult.text, { bom: true, columns: true });
  assert.ok(archivedRecords.some((row) => row.skuCode === skuCode), "明確 status=archived 要見返個 SKU");
});

test("GET /item-exports/skus：只有 item.mgmt 先匯出得；item.view 403；冇 token 401", { skip }, async (t) => {
  const application = await startApplication();
  const { token: viewerToken } = await withActor(t, application, ["item.view"]);
  t.after(async () => {
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const forbidden = await getCsv(`${url}/api/v1/item-exports/skus`, viewerToken);
  assert.equal(forbidden.status, 403);

  const anonymous = await getCsv(`${url}/api/v1/item-exports/skus`, null);
  assert.equal(anonymous.status, 401);
});

test("GET /item-exports/skus：寫一筆 item.export audit，記篩選同筆數，唔保存成份 CSV 內容", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, actorId } = await withActor(t, application, ["item.mgmt"]);
  const fixture = await seedFixture(db);
  t.after(async () => {
    await fixture.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const itemId = await fixture.seedItem();
  const skuCode = `IT-EXPORT-AUDIT-${fixture.suffix}`;
  await fixture.seedSku(itemId, { skuCode });

  const result = await getCsv(`${url}/api/v1/item-exports/skus?categoryId=${fixture.categoryId}`, token);
  assert.equal(result.status, 200, result.text);

  const [auditRows] = await db.query(
    "SELECT action, target_type, target_id, target_label, detail FROM item_audit_logs WHERE actor_user_id = ? AND action = 'item.export'",
    [actorId]
  );
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].target_type, "export");
  assert.equal(auditRows[0].target_id, null);
  assert.equal(auditRows[0].detail.rowCount, 1);
  assert.equal(auditRows[0].detail.filters.categoryId, fixture.categoryId);
  assert.ok(!JSON.stringify(auditRows[0].detail).includes(skuCode), "audit detail 唔應該保存成份 CSV 內容（逐 SKU 資料）");
});
