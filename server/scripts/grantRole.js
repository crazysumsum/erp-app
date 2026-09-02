/**
 * Break-glass：把一個角色授予某個帳號，不經過應用程式、不受任何提權防護。
 * 設計說明見 docs/user_management/design_spec.md §5.1。
 *
 *   node scripts/grantRole.js <username> <role> --reason "<原因>"
 *
 * §1.4 的守衛擋住了「最後一個 active system-admin 被停用或拔掉角色」這一種
 * 鎖死，但擋不住這些路徑：有人直接對資料庫下 SQL 把帳號停掉；三個權限被從
 * system-admin 以外的角色上全部收走，而 system-admin 帳號的密碼沒有人記得。
 * 這些情況下應用程式本身沒有任何一條路能救回來——這支腳本就是那條繞過去的路。
 *
 * 走原生連線而不是啟動整個應用程式：跟 approveDevice.js／createUser.js 一樣，
 * 一次性的管理工具不需要把 service container、排程器、限流器全部拉起來。
 *
 * 帳號如果是 disabled，這裡一併啟用（清掉鎖定與失敗計數，做法跟
 * UserAdminService.enable() 一致）——角色救回來了，帳號卻還登不進去等於沒救。
 *
 * 沒有任何守衛：能跑這支腳本的人＝能連生產資料庫的人，那道門在部署層，不在
 * 這裡。每次執行都寫一列 user_audit_logs（actor_user_id 是 NULL，
 * actor_username 是 `cli:<執行這支腳本的系統帳號>`），從命令列動生產資料庫
 * 這件事，比從介面動更需要留痕。
 */
import os from "node:os";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { normalizeDatabaseConfig } from "../src/framework/configuration/normalizeDatabaseConfig.js";

// 與 migrate.js／approveDevice.js 相同的載入順序：config/database.js 在載入
// 當下就讀 process.env.DB_*，所以必須先 dotenv.config() 再動態 import 它。
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const { default: databaseConfig } = await import("../config/database.js");
const { createMySqlDatabasePool } = await import(
  "../src/services/mysqldatabase/connection.js"
);

function parseArguments(argv) {
  const positional = [];
  let reason = "";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--reason") {
      index += 1;
      reason = String(argv[index] ?? "").trim();
    } else {
      positional.push(argument);
    }
  }

  const [username, roleName] = positional;

  if (!username || !roleName || !reason) {
    throw new Error(
      'Usage: node scripts/grantRole.js <username> <role> --reason "<原因，必填>"'
    );
  }

  return { username, roleName, reason };
}

async function currentRoleNames(connection, userId) {
  const [rows] = await connection.query(
    `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ? ORDER BY r.name`,
    [userId]
  );
  return rows.map((row) => row.name);
}

async function grantRole(connection, { username, roleName, reason }) {
  const [[user]] = await connection.query(
    "SELECT id, status FROM users WHERE username = ?",
    [username]
  );

  if (!user) {
    throw new Error(`No user with username "${username}"`);
  }

  const [[role]] = await connection.query("SELECT id FROM roles WHERE name = ?", [roleName]);

  if (!role) {
    throw new Error(`No role named "${roleName}"`);
  }

  const nowMs = Date.now();
  const beforeRoles = await currentRoleNames(connection, user.id);

  // PRIMARY KEY (user_id, role_id)：已經有這個角色就當作重跑一次，不報錯。
  await connection.execute(
    "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
    [user.id, role.id]
  );

  const wasDisabled = user.status !== "active";
  if (wasDisabled) {
    await connection.execute(
      `UPDATE users
       SET status = 'active', failed_login_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      [nowMs, user.id]
    );
  }

  const afterRoles = await currentRoleNames(connection, user.id);
  const detail = { roles: { before: beforeRoles, after: afterRoles } };
  if (wasDisabled) {
    detail.status = { before: "disabled", after: "active" };
  }

  const actorUsername = `cli:${os.userInfo().username}`;
  await connection.execute(
    `INSERT INTO user_audit_logs
       (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
        target_label, reason, detail, request_id, ip)
     VALUES (?, NULL, ?, 'user.roles', 'user', ?, ?, ?, ?, '', '')`,
    [nowMs, actorUsername, user.id, username, reason, JSON.stringify(detail)]
  );

  console.log(
    `Granted role "${roleName}" to "${username}"` +
      (wasDisabled ? " and reactivated the account" : "") +
      `. Roles are now: ${afterRoles.join(", ")}`
  );
}

const options = parseArguments(process.argv.slice(2));
const pool = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));
const connection = await pool.getConnection();

try {
  await grantRole(connection, options);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
