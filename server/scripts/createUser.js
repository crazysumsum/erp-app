/**
 * 建立一個使用者帳號，並視需要建立角色與授權。
 *
 *   node scripts/createUser.js <username> <password> [--name "顯示名稱"] [--role admin --role staff]
 *
 * 系統上第一個帳號只能這樣建出來——登入 API 需要一個已存在的帳號，而建立帳號
 * 的 API 需要一個已登入的人。這支腳本就是打破這個循環的那一步。
 *
 * 走原生連線而不是啟動整個應用程式：它跟 scripts/migrate.js 一樣是一次性的
 * 管理工具，為了建一個帳號而把 service container、排程器、限流器全部拉起來
 * 只會讓失敗模式變多。
 */
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { normalizeDatabaseConfig } from "../src/framework/configuration/normalizeDatabaseConfig.js";
import { hashPassword } from "../src/modules/user/passwordHash.js";

// 與 migrate.js 相同的載入順序：config/database.js 在載入當下就讀
// process.env.DB_*，所以必須先 dotenv.config() 再動態 import 它。
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const { default: databaseConfig } = await import("../config/database.js");
const { createMySqlDatabasePool } = await import(
  "../src/services/mysqldatabase/connection.js"
);

function parseArguments(argv) {
  const positional = [];
  const roles = [];
  let displayName = "";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--role") {
      index += 1;
      roles.push(String(argv[index] ?? "").trim());
    } else if (argument === "--name") {
      index += 1;
      displayName = String(argv[index] ?? "");
    } else {
      positional.push(argument);
    }
  }

  const [username, password] = positional;

  if (!username || !password) {
    throw new Error(
      "Usage: node scripts/createUser.js <username> <password> " +
        '[--name "Display Name"] [--role <role>]...'
    );
  }

  if (roles.some((role) => !role)) {
    throw new Error("--role requires a non-empty value");
  }

  return { username: username.trim(), password, displayName, roles };
}

async function createUser(connection, { username, password, displayName, roles }) {
  const passwordHash = await hashPassword(password);
  const nowMs = Date.now();

  await connection.beginTransaction();

  try {
    const [result] = await connection.execute(
      `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [username, passwordHash, displayName, nowMs, nowMs]
    );

    const userId = result.insertId;

    for (const role of roles) {
      // 角色不存在就順手建出來：第一個帳號建立時角色表一定是空的，要求先手動
      // 建角色只會讓第一步多一個必踩的坑。
      await connection.execute(
        "INSERT IGNORE INTO roles (name, created_at) VALUES (?, ?)",
        [role, nowMs]
      );
      await connection.execute(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT ?, id FROM roles WHERE name = ?`,
        [userId, role]
      );
    }

    await connection.commit();
    return userId;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

const options = parseArguments(process.argv.slice(2));
const pool = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));
const connection = await pool.getConnection();

try {
  const userId = await createUser(connection, options);
  console.log(
    `Created user ${options.username} (id ${userId})` +
      (options.roles.length > 0 ? ` with roles: ${options.roles.join(", ")}` : "")
  );
} catch (error) {
  if (error.code === "ER_DUP_ENTRY") {
    console.error(`User already exists: ${options.username}`);
  } else {
    console.error("Failed to create user:", error.message);
  }
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
