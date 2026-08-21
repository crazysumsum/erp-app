import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { up as addIdempotencyLeaseOwner } from "../database/migrations/0001_add_idempotency_lease_owner.js";
import { up as addUserPasswordColumns } from "../database/migrations/0006_add_user_password_columns.js";

const databaseDirectory = fileURLToPath(new URL("../database/", import.meta.url));

test("framework SQL files don't hard-code a database name", async () => {
  const files = await readdir(`${databaseDirectory}framework/`);

  for (const file of files.filter((name) => name.endsWith(".sql"))) {
    const sql = await readFile(`${databaseDirectory}framework/${file}`, "utf8");

    assert.doesNotMatch(
      sql,
      /^\s*USE\s/im,
      `${file} 不應該寫死 USE 陳述式——連線已經指向 DB_NAME 指定的資料庫`
    );
  }
});

test("migrations directory files are named for a stable execution order", async () => {
  const entries = await readdir(`${databaseDirectory}migrations/`);
  const names = entries.filter((name) => name.endsWith(".sql") || name.endsWith(".js"));

  assert.ok(names.length > 0, "database/migrations/ 底下應該有檔案");

  for (const name of names) {
    assert.match(
      name,
      /^\d{4}_/,
      `${name} 應該用 4 位數字前綴命名，讓執行順序不必依賴檔案系統列出順序`
    );
  }
});

test("0001_add_idempotency_lease_owner adds the column when it's missing", async () => {
  const calls = [];
  const connection = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes("information_schema")) {
        return [[]];
      }
      return [{ affectedRows: 0 }];
    }
  };

  await addIdempotencyLeaseOwner(connection);

  assert.equal(calls.length, 2);
  assert.match(calls[1], /ALTER TABLE fr_idempotency_keys ADD COLUMN lease_owner/);
});

test("0001_add_idempotency_lease_owner is a no-op once the column already exists", async () => {
  const calls = [];
  const connection = {
    query: async (sql) => {
      calls.push(sql);
      return [[{ COLUMN_NAME: "lease_owner" }]];
    }
  };

  await addIdempotencyLeaseOwner(connection);

  assert.equal(calls.length, 1);
});

/**
 * 0006 的守衛是承重的，不是裝飾。
 *
 * MySQL 的 DDL 會隱式提交，而 scripts/migrate.js 只在整個 up() 成功之後才寫
 * fr_schema_migrations——所以「第一句 ALTER 成功、第二句失敗」會留下一個已經多
 * 了一欄、卻沒有被記成套用過的資料庫。這裡用假連線把那個狀態直接擺出來，因為
 * 真資料庫做不到「精準地只成功一半」而不去破壞資料。
 */
function fakeUsersTable(existingColumns) {
  const calls = [];
  const columns = new Set(existingColumns);

  return {
    calls,
    columns,
    connection: {
      query: async (sql, params) => {
        calls.push(sql);

        if (sql.includes("information_schema")) {
          return [columns.has(params[1]) ? [{ 1: 1 }] : []];
        }

        const added = /ADD COLUMN (\w+)/.exec(sql);
        if (added) {
          columns.add(added[1]);
        }

        return [{ affectedRows: 0 }];
      }
    }
  };
}

const PASSWORD_COLUMNS = ["must_change_password", "temporary_password_expires_at"];

test("0006_add_user_password_columns adds both columns to an untouched users table", async () => {
  const { connection, columns } = fakeUsersTable([]);

  await addUserPasswordColumns(connection);

  assert.deepEqual([...columns].sort(), [...PASSWORD_COLUMNS].sort());
});

test("0006_add_user_password_columns converges after a half-applied run", async () => {
  // 第一句成功、第二句炸了之後的資料庫。
  const { connection, calls, columns } = fakeUsersTable(["must_change_password"]);

  await addUserPasswordColumns(connection);

  assert.deepEqual([...columns].sort(), [...PASSWORD_COLUMNS].sort());

  // 而且只補了缺的那一句——重跑第一句會撞 "Duplicate column name"，也就是
  // 整條部署流程卡死在一個要人手動判斷的狀態。
  const alters = calls.filter((sql) => sql.includes("ADD COLUMN"));
  assert.equal(alters.length, 1);
  assert.match(alters[0], /temporary_password_expires_at/);
});

test("0006_add_user_password_columns is a no-op once both columns exist", async () => {
  const { connection, calls } = fakeUsersTable(PASSWORD_COLUMNS);

  await addUserPasswordColumns(connection);

  assert.equal(calls.filter((sql) => sql.includes("ADD COLUMN")).length, 0);
});
