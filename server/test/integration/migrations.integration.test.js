/**
 * Phase 1 的十支 migration（含 Item Management 的 0010 權限種子、0011–0013
 * 的 Category／Brand／UOM catalog、0014–0015 的 Item／SKU 主表，以及提前建立
 * 的 0024 item_audit_logs），對一個真的、已經 migrate 過的 MySQL 驗收。0024
 * 提前於 0014–0023（items／skus 等表）是刻意的：它不依賴 items／skus
 * （target_id 不設外鍵），先建好讓 Catalog 的寫入路徑從一開始就能正確寫稽核。
 *
 * 這裡要的是假連線給不了的兩件事：DDL 本身是不是合法的 MySQL（欄位型別、索引、
 * 外鍵的 ON DELETE 行為），以及**重跑會不會收斂**。後者在假連線上只是「我寫的
 * if 有沒有分對」，在這裡才是「資料庫真的會這樣反應嗎」。
 *
 * 刻意不模擬「跑到一半才失敗」：那需要先破壞一次資料庫（例如 DROP 掉其中一欄），
 * 而這個 suite 在開發者的 erp_dev 上也會跑。半途失敗的分岔由 migrate.test.js 用
 * 假連線精準地擺出來，那裡破壞不到任何東西。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { PERMISSION_CATALOGUE } from "../../src/modules/authorization/permissionCatalogue.js";
import { up as addUserPasswordColumns } from "../../database/migrations/0006_add_user_password_columns.js";
import { up as addUserAuditLogs } from "../../database/migrations/0007_add_user_audit_logs.js";
import { up as seedPermissions } from "../../database/migrations/0008_seed_user_management_permissions.js";
import { up as seedItemPermissions } from "../../database/migrations/0010_seed_item_management_permissions.js";
import { up as createItemCategories } from "../../database/migrations/0011_create_item_categories.js";
import { up as createItemBrands } from "../../database/migrations/0012_create_item_brands.js";
import { up as createItemUoms } from "../../database/migrations/0013_create_item_uoms.js";
import { up as createItems } from "../../database/migrations/0014_create_items.js";
import { up as createItemSkus } from "../../database/migrations/0015_create_item_skus.js";
import { up as createItemAuditLogs } from "../../database/migrations/0024_create_item_audit_logs.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite (see README's CI section)";

async function withDatabase(t) {
  const source = defaultConfigurationSource();
  const application = await createApplication({
    // port: 0 拿一個隨機空 port，避免與其他正在跑的實例撞。
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });

  t.after(() => application.shutdown("integration_test_complete"));

  return application.services.require("mysqldatabase");
}

async function columnsOf(database, table) {
  const [rows] = await database.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );

  return new Map(rows.map((row) => [row.COLUMN_NAME, row]));
}

test("0006 gave users its two password columns, with defaults that leave existing rows alone", { skip }, async (t) => {
  const database = await withDatabase(t);
  const columns = await columnsOf(database, "users");

  const flag = columns.get("must_change_password");
  assert.ok(flag, "users.must_change_password is missing; did 0006 run?");
  assert.equal(flag.COLUMN_TYPE, "tinyint(1)");
  assert.equal(flag.IS_NULLABLE, "NO");
  // 預設 0 是既有的列不需要回填的唯一理由。改成 1 的話，這個 migration 會把
  // 全公司鎖在「請先改密碼」那一頁後面。
  assert.equal(flag.COLUMN_DEFAULT, "0");

  const deadline = columns.get("temporary_password_expires_at");
  assert.ok(deadline, "users.temporary_password_expires_at is missing; did 0006 run?");
  assert.equal(deadline.COLUMN_TYPE, "bigint unsigned");
  // NULL = 不是臨時密碼。既有的列全部落在這一邊。
  assert.equal(deadline.IS_NULLABLE, "YES");
  assert.equal(deadline.COLUMN_DEFAULT, null);
});

test("0007 built user_audit_logs with the three indexes and an actor FK that does not cascade", { skip }, async (t) => {
  const database = await withDatabase(t);

  const columns = await columnsOf(database, "user_audit_logs");
  assert.ok(columns.size > 0, "user_audit_logs is missing; did 0007 run?");
  assert.equal(columns.get("detail").COLUMN_TYPE, "json");
  assert.equal(columns.get("occurred_at").COLUMN_TYPE, "bigint unsigned");
  // 操作者的帳號被硬刪除時這一欄變 NULL，記錄本身留著——所以它必須可為 NULL。
  assert.equal(columns.get("actor_user_id").IS_NULLABLE, "YES");

  const [indexes] = await database.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_audit_logs'`
  );
  const indexNames = indexes.map((row) => row.INDEX_NAME).sort();
  assert.deepEqual(indexNames, [
    "PRIMARY",
    "idx_user_audit_logs_actor",
    "idx_user_audit_logs_target",
    "idx_user_audit_logs_time"
  ].sort());

  // 這一條是整張表最容易被「順手改成 CASCADE」的地方，而改了之後的症狀是
  // 「開除一個人，他做過的事跟著消失」——正好是最需要這些記錄的時候。
  const [constraints] = await database.query(
    `SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'user_audit_logs'`
  );
  assert.deepEqual(
    constraints.map((row) => row.DELETE_RULE),
    ["SET NULL"]
  );

  // target_id 刻意沒有外鍵：角色被刪掉之後，「誰在什麼時候刪的」必須留得住。
  assert.equal(constraints.length, 1, "user_audit_logs should have exactly one FK");
});

test("0008 seeded exactly the catalogue, and gave all of it to system-admin", { skip }, async (t) => {
  const database = await withDatabase(t);

  // 只驗證目錄涵蓋這幾項，不驗證「剛好只有」這幾項：node --test 預設會跨檔案
  // 平行跑，這句可能剛好夾在另一個整合測試檔案（例如 authFlow）暫時種下的
  // 一次性權限中間，那不是這支 migration 的錯——它只保證目錄裡的都在，不保證
  // 資料庫裡沒有別人手動加的東西（那正是啟動自檢要抓的事，不是這支測試）。
  const [permissions] = await database.query("SELECT name FROM permissions");
  const permissionNames = permissions.map((row) => row.name);
  for (const permission of PERMISSION_CATALOGUE) {
    assert.ok(permissionNames.includes(permission.name), `missing ${permission.name}`);
  }

  const [held] = await database.query(
    `SELECT p.name FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = 'system-admin'`
  );
  assert.deepEqual(
    held.map((row) => row.name).sort(),
    PERMISSION_CATALOGUE.map((permission) => permission.name).sort()
  );
});

test("0010 seeded item.view/item.mgmt, and gave both to system-admin", { skip }, async (t) => {
  const database = await withDatabase(t);

  const [permissions] = await database.query(
    "SELECT name FROM permissions WHERE name IN ('item.view', 'item.mgmt')"
  );
  assert.deepEqual(
    permissions.map((row) => row.name).sort(),
    ["item.mgmt", "item.view"]
  );

  // item.mgmt 不隱含 item.view——現有 authorization 沒有 permission
  // inheritance，這裡直接證明 0010 把兩項都種給了 system-admin，而不是只種了
  // 其中一項就假設另一項會自動生效。
  const [held] = await database.query(
    `SELECT p.name FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = 'system-admin' AND p.name IN ('item.view', 'item.mgmt')`
  );
  assert.deepEqual(
    held.map((row) => row.name).sort(),
    ["item.mgmt", "item.view"]
  );
});

test("0011 built item_categories: a generated parent_scope_id blocks duplicate root names too", { skip }, async (t) => {
  const database = await withDatabase(t);

  const columns = await columnsOf(database, "item_categories");
  assert.ok(columns.size > 0, "item_categories is missing; did 0011 run?");
  assert.equal(columns.get("parent_scope_id").COLUMN_TYPE, "bigint unsigned");
  assert.equal(columns.get("version").COLUMN_DEFAULT, "1");

  const [indexes] = await database.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'item_categories'`
  );
  assert.deepEqual(
    indexes.map((row) => row.INDEX_NAME).sort(),
    ["PRIMARY", "fk_item_categories_created_by", "fk_item_categories_updated_by", "idx_item_categories_parent", "uq_item_categories_parent_name"].sort()
  );

  // parent_id 是 self FK 且必須是 RESTRICT：分類有子分類時不能被刪除，這是
  // service 檢查之外的最後防線。created_by／updated_by 則是 SET NULL。
  const [constraints] = await database.query(
    `SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'item_categories'`
  );
  const rulesByName = Object.fromEntries(
    constraints.map((row) => [row.CONSTRAINT_NAME, row.DELETE_RULE])
  );
  assert.equal(rulesByName.fk_item_categories_parent, "RESTRICT");
  assert.equal(rulesByName.fk_item_categories_created_by, "SET NULL");
  assert.equal(rulesByName.fk_item_categories_updated_by, "SET NULL");

  const nowMs = Date.now();
  const rootName = `it-cat-${randomUUID().slice(0, 8)}`;
  const insertRoot = () =>
    database.query(
      "INSERT INTO item_categories (name, created_at, updated_at) VALUES (?, ?, ?)",
      [rootName, nowMs, nowMs]
    );

  // 清理寫成單一 finally 而不是多個 t.after：withDatabase() 自己已經註冊了一個
  // t.after 去 shutdown application（連同它的連線池），另外分開的 t.after 之間
  // 的先後順序不保證跑在 shutdown 之前——實測會撞見「Pool is closed」。單一
  // finally 把清理釘在池子還活著的這段時間內執行，順序自己完全掌控。
  let firstId = null;
  let childId = null;

  try {
    const [first] = await insertRoot();
    firstId = first.insertId;

    // 兩個 parent_id 都是 NULL 的根分類，同名——若 unique key 直接寫
    // UNIQUE(parent_id, name)，MySQL 會把兩個 NULL 視為互不相等而放行；這裡要
    // 證明 parent_scope_id 這個 generated column 確實把它們擋下來了。
    await assert.rejects(insertRoot(), (error) => {
      assert.equal(error.cause?.code ?? error.code, "ER_DUP_ENTRY");
      return true;
    });

    // 同名但不同父層必須被允許：唯一性是「同一父分類下」，不是全域。
    const [child] = await database.query(
      "INSERT INTO item_categories (parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [firstId, rootName, nowMs, nowMs]
    );
    childId = child.insertId;

    // 有子分類的分類不可被刪除——RESTRICT 在資料庫層面擋下，不只是 service 的檢查。
    await assert.rejects(
      database.execute("DELETE FROM item_categories WHERE id = ?", [firstId]),
      (error) => {
        assert.equal(error.cause?.code ?? error.code, "ER_ROW_IS_REFERENCED_2");
        return true;
      }
    );
  } finally {
    // 先刪子再刪父：父還被子引用時刪不掉，順序反過來這個清理本身就會失敗。
    if (childId !== null) {
      await database.execute("DELETE FROM item_categories WHERE id = ?", [childId]);
    }
    if (firstId !== null) {
      await database.execute("DELETE FROM item_categories WHERE id = ?", [firstId]);
    }
  }
});

test("0012 built item_brands with a case-insensitive unique name", { skip }, async (t) => {
  const database = await withDatabase(t);

  const columns = await columnsOf(database, "item_brands");
  assert.ok(columns.size > 0, "item_brands is missing; did 0012 run?");
  assert.equal(columns.get("official_name").COLUMN_DEFAULT, "");
  assert.equal(columns.get("status").COLUMN_DEFAULT, "active");

  const nowMs = Date.now();
  const name = `It-Brand-${randomUUID().slice(0, 8)}`;
  const [inserted] = await database.query(
    "INSERT INTO item_brands (name, created_at, updated_at) VALUES (?, ?, ?)",
    [name, nowMs, nowMs]
  );

  try {
    // 全公司不分大小寫唯一，靠資料庫預設的 utf8mb4_unicode_ci collation。
    await assert.rejects(
      database.query(
        "INSERT INTO item_brands (name, created_at, updated_at) VALUES (?, ?, ?)",
        [name.toUpperCase(), nowMs, nowMs]
      ),
      (error) => {
        assert.equal(error.cause?.code ?? error.code, "ER_DUP_ENTRY");
        return true;
      }
    );
  } finally {
    // 單一 finally 而不是 t.after：見 0011 測試裡對 withDatabase() 自己那個
    // shutdown t.after 的說明。
    await database.execute("DELETE FROM item_brands WHERE id = ?", [inserted.insertId]);
  }
});

test("0013 built item_uoms with a case-insensitive unique code", { skip }, async (t) => {
  const database = await withDatabase(t);

  const columns = await columnsOf(database, "item_uoms");
  assert.ok(columns.size > 0, "item_uoms is missing; did 0013 run?");
  assert.equal(columns.get("symbol").COLUMN_DEFAULT, "");

  const nowMs = Date.now();
  const code = `IT${randomUUID().slice(0, 6)}`;
  const [inserted] = await database.query(
    "INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [code, "Integration Test Unit", nowMs, nowMs]
  );

  try {
    await assert.rejects(
      database.query(
        "INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [code.toLowerCase(), "Duplicate", nowMs, nowMs]
      ),
      (error) => {
        assert.equal(error.cause?.code ?? error.code, "ER_DUP_ENTRY");
        return true;
      }
    );
  } finally {
    // 單一 finally 而不是 t.after：見 0011 測試裡對 withDatabase() 自己那個
    // shutdown t.after 的說明。
    await database.execute("DELETE FROM item_uoms WHERE id = ?", [inserted.insertId]);
  }
});

test("0014 built items with RESTRICT FKs to category and brand", { skip }, async (t) => {
  const database = await withDatabase(t);

  const columns = await columnsOf(database, "items");
  assert.ok(columns.size > 0, "items is missing; did 0014 run?");
  assert.equal(columns.get("status").COLUMN_DEFAULT, "draft");
  assert.equal(columns.get("product_type").COLUMN_DEFAULT, "standard");
  assert.equal(columns.get("category_id").IS_NULLABLE, "YES");
  assert.equal(columns.get("brand_id").IS_NULLABLE, "YES");
  assert.equal(columns.get("version").COLUMN_DEFAULT, "1");

  const [indexes] = await database.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items'`
  );
  assert.deepEqual(
    indexes.map((row) => row.INDEX_NAME).sort(),
    [
      "PRIMARY",
      "idx_items_status_updated",
      // category_id／brand_id 的 FK 冇獨立索引：idx_items_category_status／
      // idx_items_brand_status 已經以它們做最左欄位，MySQL 不會為同一個 FK
      // 再建一個多餘的索引。created_by／updated_by 冇其他索引覆蓋，所以
      // MySQL 會用約束名替它們各自建一個——同 item_categories 的
      // fk_item_categories_created_by／updated_by 是同一個模式。
      "idx_items_category_status",
      "idx_items_brand_status",
      "idx_items_name",
      "fk_items_created_by",
      "fk_items_updated_by"
    ].sort()
  );

  const [constraints] = await database.query(
    `SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'items'`
  );
  const rulesByName = Object.fromEntries(
    constraints.map((row) => [row.CONSTRAINT_NAME, row.DELETE_RULE])
  );
  assert.equal(rulesByName.fk_items_category, "RESTRICT");
  assert.equal(rulesByName.fk_items_brand, "RESTRICT");
  assert.equal(rulesByName.fk_items_created_by, "SET NULL");
  assert.equal(rulesByName.fk_items_updated_by, "SET NULL");

  const nowMs = Date.now();
  const categoryName = `it-item-cat-${randomUUID().slice(0, 8)}`;
  const brandName = `it-item-brand-${randomUUID().slice(0, 8)}`;

  let categoryId = null;
  let brandId = null;
  let itemId = null;

  try {
    const [category] = await database.query(
      "INSERT INTO item_categories (name, created_at, updated_at) VALUES (?, ?, ?)",
      [categoryName, nowMs, nowMs]
    );
    categoryId = category.insertId;

    const [brand] = await database.query(
      "INSERT INTO item_brands (name, created_at, updated_at) VALUES (?, ?, ?)",
      [brandName, nowMs, nowMs]
    );
    brandId = brand.insertId;

    const [item] = await database.query(
      "INSERT INTO items (name, category_id, brand_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [`it-item-${randomUUID().slice(0, 8)}`, categoryId, brandId, nowMs, nowMs]
    );
    itemId = item.insertId;

    // 分類／品牌被 Item 引用時不可刪除——資料庫層的最後防線，不只是 service 檢查。
    await assert.rejects(
      database.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]),
      (error) => {
        assert.equal(error.cause?.code ?? error.code, "ER_ROW_IS_REFERENCED_2");
        return true;
      }
    );
    await assert.rejects(
      database.execute("DELETE FROM item_brands WHERE id = ?", [brandId]),
      (error) => {
        assert.equal(error.cause?.code ?? error.code, "ER_ROW_IS_REFERENCED_2");
        return true;
      }
    );
  } finally {
    // 先刪 Item 再刪它引用的 Category／Brand——順序反過來會撞 RESTRICT。
    if (itemId !== null) {
      await database.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
    if (categoryId !== null) {
      await database.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
    }
    if (brandId !== null) {
      await database.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
    }
  }
});

test("0015 built item_skus: globally unique sku_code, per-item unique variant_signature, CASCADE from items, RESTRICT to UOMs", { skip }, async (t) => {
  const database = await withDatabase(t);

  const columns = await columnsOf(database, "item_skus");
  assert.ok(columns.size > 0, "item_skus is missing; did 0015 run?");
  assert.equal(columns.get("status").COLUMN_DEFAULT, "draft");
  assert.equal(columns.get("tracking_policy").COLUMN_DEFAULT, "none");
  assert.equal(columns.get("purchasable").COLUMN_DEFAULT, "1");
  assert.equal(columns.get("sellable").COLUMN_DEFAULT, "1");
  assert.equal(columns.get("suggested_price_amount").COLUMN_TYPE, "decimal(19,4)");
  assert.equal(columns.get("net_content").COLUMN_TYPE, "decimal(20,6)");

  const [indexes] = await database.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'item_skus'`
  );
  assert.deepEqual(
    indexes.map((row) => row.INDEX_NAME).sort(),
    [
      "PRIMARY",
      "uq_item_skus_code",
      "uq_item_skus_item_variant",
      "uq_item_skus_id_item",
      "idx_item_skus_item_status",
      "idx_item_skus_status_flags",
      "idx_item_skus_updated",
      // item_id 的 FK 冇獨立索引：idx_item_skus_item_status 已經以 item_id
      // 做最左欄位，MySQL 不會再建一個多餘的索引（uq_item_skus_id_item 最左
      // 欄位是 id，唔算，蓋唔到）。三個 UOM FK 及 created_by／updated_by 冇
      // 其他索引覆蓋，各自獨立建一個。
      "fk_item_skus_net_content_uom",
      "fk_item_skus_weight_uom",
      "fk_item_skus_dimension_uom",
      "fk_item_skus_created_by",
      "fk_item_skus_updated_by"
    ].sort()
  );

  const [constraints] = await database.query(
    `SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'item_skus'`
  );
  const rulesByName = Object.fromEntries(
    constraints.map((row) => [row.CONSTRAINT_NAME, row.DELETE_RULE])
  );
  assert.equal(rulesByName.fk_item_skus_item, "CASCADE");
  assert.equal(rulesByName.fk_item_skus_net_content_uom, "RESTRICT");
  assert.equal(rulesByName.fk_item_skus_weight_uom, "RESTRICT");
  assert.equal(rulesByName.fk_item_skus_dimension_uom, "RESTRICT");
  assert.equal(rulesByName.fk_item_skus_created_by, "SET NULL");
  assert.equal(rulesByName.fk_item_skus_updated_by, "SET NULL");

  const nowMs = Date.now();
  const itemName = `it-sku-item-${randomUUID().slice(0, 8)}`;
  const uomCode = `IT${randomUUID().slice(0, 6)}`;

  let itemId = null;
  let uomId = null;
  let cascadedSkuId = null;

  try {
    const [item] = await database.query(
      "INSERT INTO items (name, created_at, updated_at) VALUES (?, ?, ?)",
      [itemName, nowMs, nowMs]
    );
    itemId = item.insertId;

    const [uom] = await database.query(
      "INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [uomCode, "Integration Test Unit", nowMs, nowMs]
    );
    uomId = uom.insertId;

    const code = `IT-SKU-${randomUUID().slice(0, 8)}`;
    const [sku] = await database.query(
      `INSERT INTO item_skus (item_id, sku_code, sku_name, net_content_uom_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [itemId, code, "Integration test SKU", uomId, nowMs, nowMs]
    );
    cascadedSkuId = sku.insertId;

    // 全域不分大小寫唯一，靠資料庫預設的 utf8mb4_unicode_ci collation。
    await assert.rejects(
      database.query(
        `INSERT INTO item_skus (item_id, sku_code, sku_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [itemId, code.toLowerCase(), "Duplicate code", nowMs, nowMs]
      ),
      (error) => {
        assert.equal(error.cause?.code ?? error.code, "ER_DUP_ENTRY");
        return true;
      }
    );

    // 同一個 Item 底下，相同 variant_signature 不可重複。
    const signature = "a".repeat(64);
    const [firstVariant] = await database.query(
      `INSERT INTO item_skus (item_id, sku_code, sku_name, variant_signature, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [itemId, `IT-SKU-${randomUUID().slice(0, 8)}`, "Variant A", signature, nowMs, nowMs]
    );
    try {
      await assert.rejects(
        database.query(
          `INSERT INTO item_skus (item_id, sku_code, sku_name, variant_signature, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [itemId, `IT-SKU-${randomUUID().slice(0, 8)}`, "Variant A duplicate", signature, nowMs, nowMs]
        ),
        (error) => {
          assert.equal(error.cause?.code ?? error.code, "ER_DUP_ENTRY");
          return true;
        }
      );
    } finally {
      await database.execute("DELETE FROM item_skus WHERE id = ?", [firstVariant.insertId]);
    }

    // 被 SKU 引用的 UOM 不可刪除——RESTRICT 是 service 檢查之外的最後防線。
    await assert.rejects(
      database.execute("DELETE FROM item_uoms WHERE id = ?", [uomId]),
      (error) => {
        assert.equal(error.cause?.code ?? error.code, "ER_ROW_IS_REFERENCED_2");
        return true;
      }
    );

    // 刪除父 Item 會 CASCADE 埋底下的 SKU——「只有未被引用的 Draft Item 可以
    // 整個刪掉」由 service 保證，這裡驗證資料庫層真的會連 SKU 一併清走。
    await database.execute("DELETE FROM items WHERE id = ?", [itemId]);
    const [[remaining]] = await database.query(
      "SELECT COUNT(*) AS c FROM item_skus WHERE id = ?",
      [cascadedSkuId]
    );
    assert.equal(remaining.c, 0, "deleting the parent item must cascade-delete its SKU");
    itemId = null;
    cascadedSkuId = null;
  } finally {
    if (cascadedSkuId !== null) {
      await database.execute("DELETE FROM item_skus WHERE id = ?", [cascadedSkuId]);
    }
    if (itemId !== null) {
      await database.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
    if (uomId !== null) {
      await database.execute("DELETE FROM item_uoms WHERE id = ?", [uomId]);
    }
  }
});

test("0024 built item_audit_logs with a non-cascading actor FK and no target FK", { skip }, async (t) => {
  const database = await withDatabase(t);

  const columns = await columnsOf(database, "item_audit_logs");
  assert.ok(columns.size > 0, "item_audit_logs is missing; did 0024 run?");
  assert.equal(columns.get("detail").COLUMN_TYPE, "json");
  assert.equal(columns.get("occurred_at").COLUMN_TYPE, "bigint unsigned");
  assert.equal(columns.get("actor_user_id").IS_NULLABLE, "YES");
  assert.equal(columns.get("target_id").IS_NULLABLE, "YES");
  assert.equal(columns.get("reason").COLUMN_DEFAULT, "");

  const [indexes] = await database.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'item_audit_logs'`
  );
  assert.deepEqual(
    indexes.map((row) => row.INDEX_NAME).sort(),
    [
      "PRIMARY",
      "idx_item_audit_logs_time",
      "idx_item_audit_logs_target",
      "idx_item_audit_logs_actor",
      "idx_item_audit_logs_action"
    ].sort()
  );

  // target_id 刻意沒有外鍵：分類／SKU 被刪掉之後，「誰在什麼時候刪的」必須
  // 留得住。actor_user_id 是唯一一個 FK，且是 SET NULL 不是 CASCADE：帳號被
  // 刪除不能連帶讓稽核記錄消失，那正是最需要它的情況。
  const [constraints] = await database.query(
    `SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'item_audit_logs'`
  );
  assert.deepEqual(
    constraints.map((row) => row.DELETE_RULE),
    ["SET NULL"]
  );
  assert.equal(constraints.length, 1, "item_audit_logs should have exactly one FK");
});

test("re-running all ten migrations changes nothing", { skip }, async (t) => {
  const database = await withDatabase(t);

  // `links` 只數 system-admin 自己嘅 role_permissions 列，不是整張表的
  // COUNT(*)：node --test 預設跨檔案平行跑，role_permissions 這種共用表隨時
  // 有別的 integration 測試檔案（roleManagement／userManagement／itemCatalog
  // 等）在建立、刪除自己另外角色的權限連結——跟 0008／0010 那兩支「seeded
  // exactly the catalogue」測試上面註解的理由一樣。`permissions` 表本身沒有
  // 任何測試會寫入新列（其他檔案只用 SELECT 讀既有 id），維持整表 COUNT(*)
  // 沒問題。0011–0015、0024 這六支純粹是 `CREATE TABLE IF NOT EXISTS`，不寫
  // 任何資料列（見各檔案開頭註解），所以「重跑不變」對它們而言驗的是表結構
  // 有沒有被動到，不是列數——列數本來就會被 itemCatalog.integration.test.js
  // 等同時在跑的測試改動，跟這幾支 migration 有沒有正確重跑無關。
  const countRows = async () => {
    const [[{ permissions }]] = await database.query(
      "SELECT COUNT(*) AS permissions FROM permissions"
    );
    const [[{ links }]] = await database.query(
      `SELECT COUNT(*) AS links FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
        WHERE r.name = 'system-admin'`
    );
    return { permissions, links };
  };

  const before = await countRows();
  const columnsBefore = await columnsOf(database, "users");
  const itemTableColumnsBefore = await Promise.all(
    ["item_categories", "item_brands", "item_uoms", "items", "item_skus", "item_audit_logs"].map(
      (table) => columnsOf(database, table)
    )
  );

  // 部署失敗後重跑走的就是這條路。每一支都必須撐得住。
  await addUserPasswordColumns(database);
  await addUserAuditLogs(database);
  await seedPermissions(database);
  await seedItemPermissions(database);
  await createItemCategories(database);
  await createItemBrands(database);
  await createItemUoms(database);
  await createItems(database);
  await createItemSkus(database);
  await createItemAuditLogs(database);

  assert.deepEqual(await countRows(), before);
  assert.deepEqual(
    [...(await columnsOf(database, "users")).keys()].sort(),
    [...columnsBefore.keys()].sort()
  );

  const itemTables = ["item_categories", "item_brands", "item_uoms", "items", "item_skus", "item_audit_logs"];
  for (const [index, table] of itemTables.entries()) {
    assert.deepEqual(
      [...(await columnsOf(database, table)).keys()].sort(),
      [...itemTableColumnsBefore[index].keys()].sort(),
      `${table} 的欄位在重跑後必須不變`
    );
  }
});
