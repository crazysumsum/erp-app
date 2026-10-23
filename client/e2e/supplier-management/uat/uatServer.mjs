import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { API_PORT, CLIENT_URL, adminConfig, connect, fixturePath, runDirectory, serverRoot } from "./uatEnvironment.mjs";

/**
 * Playwright webServer 會喺 globalSetup 之前起，所以 scratch database 喺呢度準備：建庫 → migrate → 種 UAT 角色同帳號 → 起 server。
 * 刪庫喺 globalTeardown（Playwright 停 webServer 唔一定行到呢個 process 嘅清理）。
 *
 * 角色照 07_uat_test_cases.md §2；SYSTEM-ADMIN 用 migration 種好嘅受保護 `system-admin` 角色。
 */
const ROLES = {
  CLERK: ["supplier.view", "supplier.mgmt"],
  VIEWER: ["supplier.view"],
  "APPROVER-A": ["supplier.view", "supplier.approval"],
  "APPROVER-B": ["supplier.view", "supplier.approval"],
  "BANK-READER": ["supplier.view", "supplier.bank.view"],
  "BANK-OFFICER": ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"],
  "SETTINGS-ADMIN": ["supplier.settings"],
  NOACCESS: []
};

if (!process.env.DB_ADMIN_USER || !process.env.DB_NAME) {
  console.error("Supplier UAT needs DB_NAME and DB_ADMIN_USER: it creates, migrates and later drops a scratch database");
  process.exit(1);
}

const database = `${process.env.DB_NAME}_rh_uat${randomUUID().replace(/-/gu, "").slice(0, 8)}`;
fs.mkdirSync(runDirectory, { recursive: true });
// 先寫名：之後任何一步失敗，teardown 都知要刪邊個。
fs.writeFileSync(fixturePath, JSON.stringify({ database, users: {} }));

const admin = await connect();
await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
await admin.end();

const { user, password } = adminConfig();
const env = { ...process.env, DB_NAME: database, DB_USER: user, DB_PASSWORD: password, DB_SOCKET_PATH: "", DB_SSL_ENABLED: "false" };
await promisify(execFile)(process.execPath, [path.join(serverRoot, "scripts/migrate.js")], { cwd: serverRoot, env });

const { hashPassword } = await import(pathToFileURL(path.join(serverRoot, "src/modules/user/passwordHash.js")).href);
const db = await connect(database);
const now = Date.now();
const users = {};
async function addUser(role, roleId) {
  const username = `uat-${role.toLowerCase()}`;
  const secret = `Uat-${randomBytes(12).toString("base64url")}`;
  const [inserted] = await db.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [username, await hashPassword(secret), `UAT ${role}`, now, now]);
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [inserted.insertId, roleId]);
  users[role] = { id: Number(inserted.insertId), username, password: secret };
}
for (const [role, permissions] of Object.entries(ROLES)) {
  const [inserted] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`uat-${role.toLowerCase()}`, now]);
  for (const permission of permissions) {
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [inserted.insertId, permission]);
  }
  await addUser(role, inserted.insertId);
}
const [[systemAdmin]] = await db.query("SELECT id FROM roles WHERE name = 'system-admin'");
await addUser("SYSTEM-ADMIN", systemAdmin.id);
await db.end();
fs.writeFileSync(fixturePath, JSON.stringify({ database, users }), { mode: 0o600 });

const server = spawn(process.execPath, ["src/index.js"], {
  cwd: serverRoot,
  stdio: "inherit",
  env: { ...env, APP_HOST: "127.0.0.1", APP_PORT: String(API_PORT), CLIENT_URL, NODE_ENV: "test", JWT_SECRET: randomBytes(48).toString("base64url") }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
