/**
 * 建立一個使用者帳號，並視需要建立角色與授權。
 *
 *   node scripts/createUser.js <username> [--name "顯示名稱"] [--role admin --role staff]
 *
 * 密碼**唔會**由 command line 收：argv 會出現喺 shell history，亦會出現喺同一
 * 部機上任何人跑 `ps` 睇到嘅 process list 入面。改為由 stdin 讀——係 TTY 就
 * 收埋回顯提示輸入，唔係 TTY（pipe、secrets manager）就直接讀一行。
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

  const [username, extra] = positional;

  if (!username) {
    throw new Error(
      "Usage: node scripts/createUser.js <username> " +
        '[--name "Display Name"] [--role <role>]...'
    );
  }

  // 靜靜哋忽略嘅話，密碼已經留咗喺 history 同 process list 入面，而使用者以為
  // 自己用咗佢。明明白白講出嚟，順便叫佢清 history。
  if (extra !== undefined) {
    throw new Error(
      "The password is no longer taken as an argument: it would be visible in shell " +
        "history and in `ps` output for anyone on this machine.\n" +
        "Run it without the password and type it at the prompt, or pipe it in:\n" +
        "  node scripts/createUser.js <username>\n" +
        "  <secrets-manager> | node scripts/createUser.js <username>\n" +
        "You just passed one on the command line - clear it from your shell history."
    );
  }

  if (roles.some((role) => !role)) {
    throw new Error("--role requires a non-empty value");
  }

  return { username: username.trim(), displayName, roles };
}

/**
 * 由 stdin 讀密碼。
 *
 * TTY：收埋回顯，逐個字元讀。用 readline 嘅話要覆寫佢個私有 _writeToOutput
 * 先收得埋，倚賴一個冇文件嘅內部欄位；raw mode 係公開 API。
 *
 * 非 TTY：直接讀一行，畀 CI 或者 secrets manager 用 pipe 餵入。呢條路唔會有
 * 提示字串，因為輸出可能俾人重新導向去第二度。
 */
function readPassword(prompt) {
  const { stdin, stdout } = process;

  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let buffer = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => {
        buffer += chunk;
      });
      stdin.on("end", () => resolve(buffer.replace(/\r?\n$/, "")));
      stdin.on("error", reject);
    });
  }

  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    const finish = (callback) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      callback();
    };

    function onData(char) {
      // raw mode 落，一次 data 可能係貼上嚟嘅一整段，所以逐個字元行。
      for (const character of char) {
        if (character === "\n" || character === "\r" || character === "\u0004") {
          finish(() => resolve(value));
          return;
        }

        if (character === "\u0003") {
          finish(() => reject(new Error("Aborted")));
          return;
        }

        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }

        value += character;
      }
    }

    stdin.on("data", onData);
  });
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
const password = await readPassword(`Password for ${options.username}: `);

if (!password) {
  throw new Error("A password is required");
}

const pool = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));
const connection = await pool.getConnection();

try {
  const { userId, roles, isFirstUser } = await createUser(connection, { ...options, password });
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
