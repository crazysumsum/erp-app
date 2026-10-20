import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import mysql from "mysql2/promise";

/**
 * Supplier 驗收測試用嘅 scratch database：admin 帳號開一個空白 database，用完即刪，唔郁 DB_NAME。
 * CI 上 erp_user 只有 erp_dev 嘅權限，所以 runner、server 同檢查都用 admin 帳號（同 supplierBankRestore 一樣）。
 */
export const githubActions = process.env.GITHUB_ACTIONS === "true";
export const ADMIN = { user: process.env.DB_ADMIN_USER ?? (githubActions ? "root" : undefined),
  password: process.env.DB_ADMIN_PASSWORD ?? (githubActions ? "root" : undefined) };
export const ADMIN_CONFIG = () => ({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), ...ADMIN, multipleStatements: true });
export const SERVER = fileURLToPath(new URL("../../", import.meta.url));

/** 一個空白 database，test 完即刪。回傳 admin 連線（multipleStatements，已 USE 咗佢）。 */
export async function scratchDatabase(t) {
  assert.ok(ADMIN.user, "DB_ADMIN_USER is required: these cases create and drop their own databases");
  const name = `${process.env.DB_NAME}_mig_${randomUUID().slice(0, 8)}`;
  const connection = await mysql.createConnection(ADMIN_CONFIG());
  // 用自己一條連線刪：測試中途可能已經關咗 `connection`（REV-102 M-3）。
  t.after(async () => {
    await connection.end().catch(() => {});
    const admin = await mysql.createConnection(ADMIN_CONFIG());
    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    } finally {
      await admin.end();
    }
  });
  await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await connection.query(`USE \`${name}\``);
  return { name, connection };
}

/**
 * 子程序嘅資料庫設定全部明確俾：`scripts/migrate.js` 同 `src/index.js` 都會讀 server/.env，dotenv 只補未設嘅 key，
 * 所以開發者本機嘅 DB_SOCKET_PATH／APP_HOST 等等唔可以漏網（REV-102 L-2）。
 */
export const childDatabaseEnv = (database) => ({ DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: ADMIN.user,
  DB_PASSWORD: ADMIN.password, DB_NAME: database, DB_SOCKET_PATH: "", DB_SSL_ENABLED: "false" });

export function runRunner(database) {
  return promisify(execFile)(process.execPath, [path.join(SERVER, "scripts/migrate.js")], { cwd: SERVER,
    env: { ...process.env, ...childDatabaseEnv(database) } });
}
