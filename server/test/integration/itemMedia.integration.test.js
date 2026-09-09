/**
 * T25 嘅 Item／SKU media 端點，對一個真的、已經 migrate 過的 MySQL 驗收。
 * 設計說明見 docs/items_management/design_spec.md §5.11、§6.6、§8.5。
 *
 * 目的：`ItemMediaService`／upload middleware／`sendFileResponse()` 三者
 * 组合起來的行為（真正落盤、真正嘅 content-signature 校驗、真正嘅
 * generated column primary 唯一性、DB 失敗後 apiDispatcher 自動清走已落盤
 * 檔案）沒有任何假 DB 能證明——這支檔案專門補這一段。ItemMediaService 本身
 * 冇獨立嘅假 DB 單元測試檔（`test/itemMediaService.test.js` 從未存在），
 * 同 ItemAdminService 一路以嚟嘅慣例一致：呢個模組嘅方法幾乎全部係「交易＋
 * SQL」，唯一真正純邏輯嘅部分（symlink／grace period 判斷）已經喺
 * test/itemMediaCleanupJob.test.js 用假 DB＋真臨時目錄蓋到。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite (see README's CI section)";

const PASSWORD = "Integration-Test-Pass-1!";

// 真實嘅檔案位元組——content-signature 校驗需要，不能用假資料（同
// test/fileTransfer.test.js 同一個理由）。
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0x00)
]);
const WEBP = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
  Buffer.alloc(32, 0x00)
]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(32, 0x20)]);
const FAKE_SVG = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");

async function startApplication() {
  const source = defaultConfigurationSource();
  return createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
}

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

/** Draft Item＋一個 Draft SKU，直接種落 DB（media 上傳唔要求 Item／SKU 已啟用）。
 * `mediaDirectory` 俾 cleanup() 用嚟連測試期間上傳、但冇經 delete 端點清走嘅
 * 實體檔案一齊刪走，唔留低磁碟垃圾——DB 那半交由 CASCADE FK 處理。 */
async function seedItemWithSku(db, catalog, mediaDirectory) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const [item] = await db.query(
    `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'standard', 'draft', ?, ?)`,
    [`it-item-${suffix}`, catalog.categoryId, catalog.brandId, nowMs, nowMs]
  );
  const itemId = item.insertId;
  const [sku] = await db.query(
    `INSERT INTO item_skus
       (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked, status,
        created_at, updated_at)
     VALUES (?, ?, ?, 'none', 1, 1, 1, 'draft', ?, ?)`,
    [itemId, `IT-SKU-${suffix}`, `Integration test SKU`, nowMs, nowMs]
  );
  const skuId = sku.insertId;

  return {
    itemId,
    skuId,
    async cleanup() {
      const [mediaRows] = await db.query("SELECT id, stored_name FROM item_media WHERE item_id = ?", [itemId]);
      const mediaIds = mediaRows.map((row) => row.id);

      await db.execute("DELETE FROM item_media WHERE item_id = ?", [itemId]);
      await db.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [skuId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id = ?", [skuId]);
      await db.execute("DELETE FROM item_skus WHERE item_id = ?", [itemId]);
      await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [itemId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);

      if (mediaIds.length > 0) {
        const placeholders = mediaIds.map(() => "?").join(",");
        await db.execute(
          `DELETE FROM item_audit_logs WHERE target_type = 'media' AND target_id IN (${placeholders})`,
          mediaIds
        );
      }

      await Promise.all(
        mediaRows.map(({ stored_name: storedName }) =>
          unlink(path.join(mediaDirectory, storedName)).catch(() => {})
        )
      );
    }
  };
}

async function withRole(t, application, permissionNames) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames });
  const actor = await seedUser(db, { username: `it-media-${randomUUID().slice(0, 8)}`, roleId: role.roleId });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: permissionNames });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, actorId: actor.userId };
}

function mediaForm({ kind, isPrimary, sortOrder, version, bytes, fileName, mimeType }) {
  const data = new FormData();
  data.append("kind", kind);
  if (isPrimary !== undefined) {
    data.append("isPrimary", String(isPrimary));
  }
  if (sortOrder !== undefined) {
    data.append("sortOrder", String(sortOrder));
  }
  data.append("version", String(version));
  data.append("file", new Blob([bytes], { type: mimeType }), fileName);
  return data;
}

function upload(url, token, data) {
  return fetch(url, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: data }).then(
    async (response) => ({ status: response.status, body: await response.json() })
  );
}

function get(url, token) {
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

function post(url, token, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

async function fileExists(filePath) {
  return readFile(filePath)
    .then(() => true)
    .catch(() => false);
}

// --- Item 層級：完整生命週期 --------------------------------------------------

test(
  "Item 層級 media：上傳、下載、update、delete 全部經真實 HTTP＋MySQL＋檔案系統，每步都有 audit",
  { skip },
  async (t) => {
    const application = await startApplication();
    const mediaDirectory = application.services.config.item.mediaDirectory;
    const { db, token } = await withRole(t, application, ["item.view", "item.mgmt"]);
    const catalog = await seedCatalog(db);
    const fixture = await seedItemWithSku(db, catalog, mediaDirectory);
    t.after(async () => {
      await fixture.cleanup();
      await catalog.cleanup();
      await application.shutdown("integration_test_complete");
    });

    const { url } = await application.start();

    const uploaded = await upload(
      `${url}/api/v1/items/${fixture.itemId}/media/upload`,
      token,
      mediaForm({ kind: "image", isPrimary: true, sortOrder: 1, version: 1, bytes: PNG, fileName: "logo.png", mimeType: "image/png" })
    );
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    const media = uploaded.body.data;
    assert.equal(media.itemId, fixture.itemId);
    assert.equal(media.skuId, null);
    assert.equal(media.mediaKind, "image");
    assert.equal(media.originalName, "logo.png");
    assert.equal(media.mimeType, "image/png");
    assert.equal(media.isPrimary, true);
    assert.equal(media.sortOrder, 1);

    const [[dbRow]] = await db.query("SELECT stored_name, primary_scope FROM item_media WHERE id = ?", [media.id]);
    assert.match(dbRow.stored_name, /^[0-9a-f-]{36}\.png$/);
    assert.equal(dbRow.primary_scope, `${fixture.itemId}:0`);
    const storedPath = path.join(mediaDirectory, dbRow.stored_name);
    assert.ok(await fileExists(storedPath), "uploaded file should be written to the controlled media directory");

    const downloaded = await get(`${url}/api/v1/item-media/${media.id}/download`, token);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get("content-type"), "image/png");
    assert.match(downloaded.headers.get("content-disposition") || "", /filename="logo\.png"/);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), PNG);

    const updated = await post(`${url}/api/v1/item-media/${media.id}/update`, token, {
      displayName: "更新後的名稱.png",
      sortOrder: 5
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.data.originalName, "更新後的名稱.png");
    assert.equal(updated.body.data.sortOrder, 5);
    assert.equal(updated.body.data.isPrimary, true, "isPrimary omitted from the update body must stay unchanged");

    const deleted = await post(`${url}/api/v1/item-media/${media.id}/delete`, token, {
      reason: "整合測試：刪除已上傳嘅 media",
      password: PASSWORD
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.data.id, media.id);

    const [[gone]] = await db.query("SELECT COUNT(*) AS c FROM item_media WHERE id = ?", [media.id]);
    assert.equal(gone.c, 0);
    assert.equal(await fileExists(storedPath), false, "delete must unlink the physical file after commit");

    const [auditRows] = await db.query(
      "SELECT action FROM item_audit_logs WHERE target_type = 'media' AND target_id = ? ORDER BY id ASC",
      [media.id]
    );
    assert.deepEqual(auditRows.map((row) => row.action), ["media.upload", "media.update", "media.delete"]);
  }
);

// --- SKU 層級：item_id 由 SKU 解析 --------------------------------------------

test("SKU 層級 media：item_id 由目標 SKU 現在嘅 item_id 解析，唔接受 client 自己聲稱", { skip }, async (t) => {
  const application = await startApplication();
  const mediaDirectory = application.services.config.item.mediaDirectory;
  const { db, token } = await withRole(t, application, ["item.view", "item.mgmt"]);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, mediaDirectory);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const uploaded = await upload(
    `${url}/api/v1/skus/${fixture.skuId}/media/upload`,
    token,
    mediaForm({ kind: "attachment", version: 1, bytes: PDF, fileName: "spec.pdf", mimeType: "application/pdf" })
  );
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.data.itemId, fixture.itemId);
  assert.equal(uploaded.body.data.skuId, fixture.skuId);
});

// --- Primary 唯一性：真 generated column 保證 -------------------------------

test("上傳第二張 primary image：舊嗰張自動變返 0，同一時間只有一張 primary（靠真 MySQL 嘅 generated column）", { skip }, async (t) => {
  const application = await startApplication();
  const mediaDirectory = application.services.config.item.mediaDirectory;
  const { db, token } = await withRole(t, application, ["item.view", "item.mgmt"]);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, mediaDirectory);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const first = await upload(
    `${url}/api/v1/items/${fixture.itemId}/media/upload`,
    token,
    mediaForm({ kind: "image", isPrimary: true, version: 1, bytes: PNG, fileName: "one.png", mimeType: "image/png" })
  );
  assert.equal(first.status, 201, JSON.stringify(first.body));

  const second = await upload(
    `${url}/api/v1/items/${fixture.itemId}/media/upload`,
    token,
    mediaForm({ kind: "image", isPrimary: true, version: 1, bytes: WEBP, fileName: "two.webp", mimeType: "image/webp" })
  );
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const [rows] = await db.query(
    "SELECT id, is_primary FROM item_media WHERE item_id = ? ORDER BY id ASC",
    [fixture.itemId]
  );
  assert.deepEqual(
    rows.map((row) => ({ id: row.id, isPrimary: Boolean(row.is_primary) })),
    [
      { id: first.body.data.id, isPrimary: false },
      { id: second.body.data.id, isPrimary: true }
    ]
  );
});

// --- 型別／大小校驗 -----------------------------------------------------------

test("SVG 唔喺 route 嘅 allowlist 之內，415 UPLOAD_TYPE_NOT_ALLOWED，唔會落盤", { skip }, async (t) => {
  const application = await startApplication();
  const mediaDirectory = application.services.config.item.mediaDirectory;
  const { db, token } = await withRole(t, application, ["item.view", "item.mgmt"]);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, mediaDirectory);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const uploaded = await upload(
    `${url}/api/v1/items/${fixture.itemId}/media/upload`,
    token,
    mediaForm({ kind: "image", version: 1, bytes: FAKE_SVG, fileName: "icon.svg", mimeType: "image/svg+xml" })
  );

  assert.equal(uploaded.status, 415, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.error.code, "UPLOAD_TYPE_NOT_ALLOWED");

  const [[count]] = await db.query("SELECT COUNT(*) AS c FROM item_media WHERE item_id = ?", [fixture.itemId]);
  assert.equal(count.c, 0);
});

test("宣告 kind=image 但實際上傳 PDF：400 MEDIA_KIND_MISMATCH，已落盤嘅檔案由框架自動清走", { skip }, async (t) => {
  const application = await startApplication();
  const mediaDirectory = application.services.config.item.mediaDirectory;
  const { db, token } = await withRole(t, application, ["item.view", "item.mgmt"]);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, mediaDirectory);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const uploaded = await upload(
    `${url}/api/v1/items/${fixture.itemId}/media/upload`,
    token,
    mediaForm({ kind: "image", version: 1, bytes: PDF, fileName: "not-an-image.pdf", mimeType: "application/pdf" })
  );

  assert.equal(uploaded.status, 400, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.error.code, "MEDIA_KIND_MISMATCH");

  const [[count]] = await db.query("SELECT COUNT(*) AS c FROM item_media WHERE item_id = ?", [fixture.itemId]);
  assert.equal(count.c, 0, "a failed attach() must not leave a metadata row behind");
});

test("圖片超過圖片專屬上限（但喺 route 較寬鬆嘅上限之內）：400 MEDIA_FILE_TOO_LARGE，唔留 orphan 檔案", { skip }, async (t) => {
  const application = await startApplication();
  const mediaDirectory = application.services.config.item.mediaDirectory;
  const { db, token } = await withRole(t, application, ["item.view", "item.mgmt"]);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, mediaDirectory);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const { imageMaxBytes, attachmentMaxBytes } = application.services.config.item;
  assert.ok(imageMaxBytes < attachmentMaxBytes, "test assumes the image cap is the tighter one");

  const oversizedImage = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(imageMaxBytes - 8 + 1024, 0x00)
  ]);

  const uploaded = await upload(
    `${url}/api/v1/items/${fixture.itemId}/media/upload`,
    token,
    mediaForm({ kind: "image", version: 1, bytes: oversizedImage, fileName: "huge.png", mimeType: "image/png" })
  );

  assert.equal(uploaded.status, 400, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.error.code, "MEDIA_FILE_TOO_LARGE");

  const [[count]] = await db.query("SELECT COUNT(*) AS c FROM item_media WHERE item_id = ?", [fixture.itemId]);
  assert.equal(count.c, 0);
});

test("目標 Item 嘅 version 唔對版：409 VERSION_CONFLICT", { skip }, async (t) => {
  const application = await startApplication();
  const mediaDirectory = application.services.config.item.mediaDirectory;
  const { db, token } = await withRole(t, application, ["item.view", "item.mgmt"]);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, mediaDirectory);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const uploaded = await upload(
    `${url}/api/v1/items/${fixture.itemId}/media/upload`,
    token,
    mediaForm({ kind: "image", version: 999, bytes: PNG, fileName: "stale.png", mimeType: "image/png" })
  );

  assert.equal(uploaded.status, 409, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.error.code, "VERSION_CONFLICT");

  const [[count]] = await db.query("SELECT COUNT(*) AS c FROM item_media WHERE item_id = ?", [fixture.itemId]);
  assert.equal(count.c, 0);
});

// --- 權限矩陣 -----------------------------------------------------------------

test("只有 item.view 冇 item.mgmt：可以下載，但上傳／update／delete 一律 403；完全冇 token：401", { skip }, async (t) => {
  const application = await startApplication();
  const mediaDirectory = application.services.config.item.mediaDirectory;
  const { db, token: mgmtToken } = await withRole(t, application, ["item.view", "item.mgmt"]);
  const { token: viewToken } = await withRole(t, application, ["item.view"]);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, mediaDirectory);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const seeded = await upload(
    `${url}/api/v1/items/${fixture.itemId}/media/upload`,
    mgmtToken,
    mediaForm({ kind: "image", version: 1, bytes: PNG, fileName: "seed.png", mimeType: "image/png" })
  );
  assert.equal(seeded.status, 201, JSON.stringify(seeded.body));
  const mediaId = seeded.body.data.id;

  const viewerUpload = await upload(
    `${url}/api/v1/items/${fixture.itemId}/media/upload`,
    viewToken,
    mediaForm({ kind: "image", version: 1, bytes: PNG, fileName: "denied.png", mimeType: "image/png" })
  );
  assert.equal(viewerUpload.status, 403, JSON.stringify(viewerUpload.body));

  const viewerUpdate = await post(`${url}/api/v1/item-media/${mediaId}/update`, viewToken, { sortOrder: 2 });
  assert.equal(viewerUpdate.status, 403, JSON.stringify(viewerUpdate.body));

  const viewerDelete = await post(`${url}/api/v1/item-media/${mediaId}/delete`, viewToken, {
    reason: "整合測試：view-only 唔應該可以刪",
    password: PASSWORD
  });
  assert.equal(viewerDelete.status, 403, JSON.stringify(viewerDelete.body));

  const viewerDownload = await get(`${url}/api/v1/item-media/${mediaId}/download`, viewToken);
  assert.equal(viewerDownload.status, 200);

  const anonymousDownload = await get(`${url}/api/v1/item-media/${mediaId}/download`, null);
  assert.equal(anonymousDownload.status, 401);
});

test("delete 密碼錯：403 PASSWORD_INVALID，metadata 同檔案都唔會被刪", { skip }, async (t) => {
  const application = await startApplication();
  const mediaDirectory = application.services.config.item.mediaDirectory;
  const { db, token } = await withRole(t, application, ["item.view", "item.mgmt"]);
  const catalog = await seedCatalog(db);
  const fixture = await seedItemWithSku(db, catalog, mediaDirectory);
  t.after(async () => {
    await fixture.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const uploaded = await upload(
    `${url}/api/v1/items/${fixture.itemId}/media/upload`,
    token,
    mediaForm({ kind: "image", version: 1, bytes: PNG, fileName: "keep.png", mimeType: "image/png" })
  );
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const media = uploaded.body.data;
  const [[dbRow]] = await db.query("SELECT stored_name FROM item_media WHERE id = ?", [media.id]);
  const storedPath = path.join(mediaDirectory, dbRow.stored_name);

  const deleted = await post(`${url}/api/v1/item-media/${media.id}/delete`, token, {
    reason: "整合測試：密碼錯",
    password: "wrong-password"
  });

  assert.equal(deleted.status, 403, JSON.stringify(deleted.body));
  assert.equal(deleted.body.error.code, "PASSWORD_INVALID");

  const [[stillThere]] = await db.query("SELECT COUNT(*) AS c FROM item_media WHERE id = ?", [media.id]);
  assert.equal(stillThere.c, 1);
  assert.ok(await fileExists(storedPath));
});
