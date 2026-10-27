import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { API_PORT, CLIENT_URL, adminConfig, assertUatEnvironment, connect, fixturePath, importRoot, isScratchName, runDirectory, serverRoot } from "./uatEnvironment.mjs";

/**
 * Playwright webServer 會喺 globalSetup 之前起，所以 scratch database 喺呢度準備：建庫 → migrate → 種 UAT 角色同帳號 → 起 server。
 * 準備失敗或者 server 退出（包括起唔到，例如 port 被佔）都喺呢度刪庫同 fixture：globalTeardown 淨係喺 webServer 起到之後先會行
 * （REV-115 M-3）。Playwright 直接殺呢個 process 嗰陣，由 globalTeardown 刪。
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

assertUatEnvironment();
const database = `${process.env.DB_NAME}_rh_uat${randomUUID().replace(/-/gu, "").slice(0, 8)}`;
if (!isScratchName(database)) throw new Error(`unexpected scratch database name ${database}`);

// 密碼檔：目錄 0700、檔案第一次寫就 0600（之後再寫唔會改權限，REV-115 L-1）。
fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
const writeFixture = (value) => fs.writeFileSync(fixturePath, JSON.stringify(value), { mode: 0o600 });

async function dropScratch() {
  const admin = await connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  } finally {
    await admin.end();
  }
  fs.rmSync(fixturePath, { force: true });
  fs.rmSync(importRoot, { recursive: true, force: true });
  // 父目錄空咗就一齊刪（REV-126 nit）；有其他 run 嘅目錄就留低。
  try { fs.rmdirSync(path.dirname(importRoot)); } catch { /* not empty, or gone */ }
}

async function prepare() {
  const admin = await connect();
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await admin.end();
  }
  writeFixture({ database, users: {} });

  const { user, password } = adminConfig();
  const env = { ...process.env, DB_NAME: database, DB_USER: user, DB_PASSWORD: password, DB_SOCKET_PATH: "", DB_SSL_ENABLED: "false" };
  await promisify(execFile)(process.execPath, [path.join(serverRoot, "scripts/migrate.js")], { cwd: serverRoot, env });

  const { hashPassword } = await import(pathToFileURL(path.join(serverRoot, "src/modules/user/passwordHash.js")).href);
  const db = await connect(database);
  try {
    const now = Date.now();
    const users = {};
    const addUser = async (role, roleId) => {
      const username = `uat-${role.toLowerCase()}`;
      const secret = `Uat-${randomBytes(12).toString("base64url")}`;
      const [inserted] = await db.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [username, await hashPassword(secret), `UAT ${role}`, now, now]);
      await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [inserted.insertId, roleId]);
      users[role] = { id: Number(inserted.insertId), username, password: secret };
    };
    for (const [role, permissions] of Object.entries(ROLES)) {
      const [inserted] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`uat-${role.toLowerCase()}`, now]);
      for (const permission of permissions) {
        await db.execute("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [inserted.insertId, permission]);
      }
      await addUser(role, inserted.insertId);
    }
    const [[systemAdmin]] = await db.query("SELECT id FROM roles WHERE name = 'system-admin'");
    await addUser("SYSTEM-ADMIN", systemAdmin.id);
    writeFixture({ database, users });
  } finally {
    await db.end();
  }
  return env;
}

let env;
try {
  env = await prepare();
} catch (error) {
  console.error(`Supplier UAT setup failed: ${error.message}`);
  await dropScratch().catch((dropError) => console.error(`and the scratch database ${database} could not be dropped: ${dropError.message}`));
  process.exit(1);
}

fs.mkdirSync(importRoot, { recursive: true, mode: 0o700 });
const server = spawn(process.execPath, ["src/index.js"], {
  cwd: serverRoot,
  stdio: "inherit",
  env: { ...env, SUPPLIER_IMPORT_ROOT: importRoot, APP_HOST: "127.0.0.1", APP_PORT: String(API_PORT), CLIENT_URL, NODE_ENV: "test", JWT_SECRET: randomBytes(48).toString("base64url") }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", async (code) => {
  await dropScratch().catch((error) => console.error(`Supplier UAT could not drop ${database}: ${error.message}`));
  process.exit(code ?? 0);
});
