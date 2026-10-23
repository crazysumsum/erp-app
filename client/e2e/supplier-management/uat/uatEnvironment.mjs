import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

/**
 * Supplier UAT（HD-124 A）嘅共用環境：真 server、真 MySQL、一個新 migrate 嘅 scratch database。
 *
 * Database 名一定係 `${DB_NAME}_rh_uat…`：同其他 runner 嘅 scratch 一樣喺 `_rh_` 前綴之下，清理只會剷呢個前綴。
 * 建庫、migrate、刪庫要 admin 帳號（DB_ADMIN_USER／DB_ADMIN_PASSWORD），同 release／recovery runner 一樣。
 */
export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../../..");
export const serverRoot = path.join(repoRoot, "server");

// 3021／5216：唔撞 technical suite（5203）同 Business Master（5202）。
export const API_PORT = 3021;
export const CLIENT_PORT = 5216;
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;

export const runDirectory = path.resolve(process.cwd(), process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "supplier-management-uat"));
/** uatServer 寫、測試同 teardown 讀：scratch database 名同 UAT 帳號（密碼係每次隨機生成，唔入 repo）。 */
export const fixturePath = path.join(runDirectory, "uat-fixture.json");

export function adminConfig(database = undefined) {
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_ADMIN_USER,
    password: process.env.DB_ADMIN_PASSWORD ?? "",
    database
  };
}

export function readFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

export function connect(database) {
  return mysql.createConnection(adminConfig(database));
}

export function isScratchName(name) {
  return typeof name === "string" && name.startsWith(`${process.env.DB_NAME}_rh_uat`) && /^[A-Za-z0-9_]+$/u.test(name);
}
