/**
 * Phase 1 的七支 migration（含 Item Management 的 0010 權限種子與 0011–0013
 * 的 Category／Brand／UOM catalog），對一個真的、已經 migrate 過的 MySQL 驗收。
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

test("re-running all seven migrations changes nothing", { skip }, async (t) => {
  const database = await withDatabase(t);

  const countRows = async () => {
    const [[{ permissions }]] = await database.query(
      "SELECT COUNT(*) AS permissions FROM permissions"
    );
    const [[{ links }]] = await database.query(
      "SELECT COUNT(*) AS links FROM role_permissions"
    );
    const [[{ audits }]] = await database.query(
      "SELECT COUNT(*) AS audits FROM user_audit_logs"
    );
    const [[{ categories }]] = await database.query(
      "SELECT COUNT(*) AS categories FROM item_categories"
    );
    const [[{ brands }]] = await database.query(
      "SELECT COUNT(*) AS brands FROM item_brands"
    );
    const [[{ uoms }]] = await database.query("SELECT COUNT(*) AS uoms FROM item_uoms");
    return { permissions, links, audits, categories, brands, uoms };
  };

  const before = await countRows();
  const columnsBefore = await columnsOf(database, "users");

  // 部署失敗後重跑走的就是這條路。每一支都必須撐得住。
  await addUserPasswordColumns(database);
  await addUserAuditLogs(database);
  await seedPermissions(database);
  await seedItemPermissions(database);
  await createItemCategories(database);
  await createItemBrands(database);
  await createItemUoms(database);

  assert.deepEqual(await countRows(), before);
  assert.deepEqual(
    [...(await columnsOf(database, "users")).keys()].sort(),
    [...columnsBefore.keys()].sort()
  );
});
