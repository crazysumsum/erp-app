/**
 * Phase 1 的三支 migration，對一個真的、已經 migrate 過的 MySQL 驗收。
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
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { PERMISSION_CATALOGUE } from "../../src/modules/authorization/permissionCatalogue.js";
import { up as addUserPasswordColumns } from "../../database/migrations/0006_add_user_password_columns.js";
import { up as addUserAuditLogs } from "../../database/migrations/0007_add_user_audit_logs.js";
import { up as seedPermissions } from "../../database/migrations/0008_seed_user_management_permissions.js";

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

  const [permissions] = await database.query("SELECT name FROM permissions");
  assert.deepEqual(
    permissions.map((row) => row.name).sort(),
    PERMISSION_CATALOGUE.map((permission) => permission.name).sort()
  );

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

test("re-running all three migrations changes nothing", { skip }, async (t) => {
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
    return { permissions, links, audits };
  };

  const before = await countRows();
  const columnsBefore = await columnsOf(database, "users");

  // 部署失敗後重跑走的就是這條路。每一支都必須撐得住。
  await addUserPasswordColumns(database);
  await addUserAuditLogs(database);
  await seedPermissions(database);

  assert.deepEqual(await countRows(), before);
  assert.deepEqual(
    [...(await columnsOf(database, "users")).keys()].sort(),
    [...columnsBefore.keys()].sort()
  );
});
