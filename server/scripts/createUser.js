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

// 系統第一個帳號自動取得這個角色。角色與它的 device.approve 權限由
// 0004_add_device_binding_tables.js 種入。
const SYSTEM_ADMIN_ROLE = "system-admin";

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
    // 系統第一個帳號自動成為 system admin，無論有沒有給 --role。
    //
    // 少了這一步，bootstrap 會斷在一個沒有症狀的地方：帳號建出來了、登得進去，
    // 但沒有人握有 device.approve，於是所有設備綁定申請都沒有人能核准。查在
    // 交易裡而且在 INSERT 之前，判準是「users 表原本是空的」——放在 INSERT
    // 之後就得改成跟 1 比較，那個 1 是哪來的並不明顯。
    const [[{ existing }]] = await connection.query(
      "SELECT COUNT(*) AS existing FROM users"
    );
    const isFirstUser = Number(existing) === 0;
    const effectiveRoles = isFirstUser
      ? [...new Set([...roles, SYSTEM_ADMIN_ROLE])]
      : roles;

    const [result] = await connection.execute(
      `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [username, passwordHash, displayName, nowMs, nowMs]
    );

    const userId = result.insertId;

    for (const role of effectiveRoles) {
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
    return { userId, roles: effectiveRoles, isFirstUser };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

const options = parseArguments(process.argv.slice(2));
const pool = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));
const connection = await pool.getConnection();

try {
  const { userId, roles, isFirstUser } = await createUser(connection, options);
  console.log(
    `Created user ${options.username} (id ${userId})` +
      (roles.length > 0 ? ` with roles: ${roles.join(", ")}` : "")
  );

  if (isFirstUser) {
    // 明講而不是靜默授予：這個帳號拿到了呼叫端沒有要求的權限，看不到就等於
    // 沒發生過。第二句是因為建好帳號的下一步幾乎一定會撞到設備綁定那道門。
    console.log(
      `This is the first account, so it was granted "${SYSTEM_ADMIN_ROLE}" ` +
        "(which holds device.approve).\n" +
        "Log in once from a browser to create a device binding request, then approve it " +
        "with: node scripts/approveDevice.js --list"
    );
  }
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
