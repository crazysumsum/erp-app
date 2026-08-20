/**
 * 核准一筆設備綁定申請，不經過應用程式。
 *
 *   node scripts/approveDevice.js --list        列出所有待審批的申請
 *   node scripts/approveDevice.js <bindingId>   核准指定的申請
 *
 * 這支腳本存在的第一個理由是上線那天的死結：設備綁定一上線，所有人都沒有已審批
 * 的設備，**包含審批者自己**。他登不進去，於是沒有人能審批任何東西，全公司鎖死。
 * 這支腳本就是打破那個循環的那一步，跟 createUser.js 打破「建帳號要先登入」的
 * 循環是同一回事。
 *
 * 第二個理由是它永遠是 break-glass 路徑：日後全員被鎖在外面時，靠的還是它。
 *
 * 走原生連線而不是啟動整個應用程式：它跟 migrate.js、createUser.js 一樣是一次性
 * 的管理工具，為了核准一筆申請而把 service container、排程器、限流器全部拉起來
 * 只會讓失敗模式變多。
 */
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { normalizeDatabaseConfig } from "../src/framework/configuration/normalizeDatabaseConfig.js";

// 與 migrate.js 相同的載入順序：config/database.js 在載入當下就讀
// process.env.DB_*，所以必須先 dotenv.config() 再動態 import 它。
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
const { default: databaseConfig } = await import("../config/database.js");
const { createMySqlDatabasePool } = await import(
  "../src/services/mysqldatabase/connection.js"
);

// reviewed_by 是 NULL——腳本背後沒有一個登入的審批者。所以把「是誰批的」寫進
// review_note，否則稽核時分不出「腳本核准」與「審批者帳號後來被刪掉」。
const REVIEW_NOTE = "approved via scripts/approveDevice.js";

function parseArguments(argv) {
  if (argv.includes("--list")) {
    return { mode: "list" };
  }

  const [bindingId] = argv.filter((argument) => !argument.startsWith("--"));

  if (!bindingId || !/^\d+$/.test(bindingId)) {
    throw new Error(
      "Usage: node scripts/approveDevice.js --list\n" +
        "       node scripts/approveDevice.js <bindingId>"
    );
  }

  return { mode: "approve", bindingId: Number(bindingId) };
}

async function listPending(connection) {
  const [rows] = await connection.query(
    `SELECT d.id, d.user_id, u.username, d.device_id, d.label,
            d.requested_at, d.requested_ip, d.requested_ua
     FROM user_devices d
     JOIN users u ON u.id = d.user_id
     WHERE d.status = 'pending'
     ORDER BY d.requested_at`
  );

  if (rows.length === 0) {
    console.log("No pending device bindings.");
    return;
  }

  for (const row of rows) {
    console.log(
      [
        `#${row.id}  ${row.username} (user ${row.user_id})`,
        `  label:     ${row.label || "(none)"}`,
        // 完整的 thumbprint 對人沒有用，但前 16 個字元足以在兩台待審設備之間分辨。
        `  device:    ${String(row.device_id).slice(0, 16)}…`,
        `  requested: ${new Date(Number(row.requested_at)).toISOString()}`,
        `  from:      ${row.requested_ip || "(unknown)"}  ${row.requested_ua || ""}`
      ].join("\n")
    );
  }
}

async function approve(connection, bindingId) {
  // 條件帶著 status = 'pending'：核准一筆已經被拒絕或已撤銷的申請，應該是一次
  // 明確的失敗而不是靜默地把它復活。
  //
  // reviewed_at 一定要寫。清理工作的第二條規則（已核准但從未使用）靠它判斷年齡，
  // 第三條看的是 last_used_at；兩欄都是 NULL 的列會同時逃過兩條規則，變成永遠
  // 清不掉的孤兒。
  const [result] = await connection.execute(
    `UPDATE user_devices
     SET status = 'approved', reviewed_at = ?, reviewed_by = NULL, review_note = ?
     WHERE id = ? AND status = 'pending'`,
    [Date.now(), REVIEW_NOTE, bindingId]
  );

  if (result.affectedRows === 1) {
    console.log(`Approved device binding #${bindingId}`);
    return;
  }

  const [rows] = await connection.query(
    "SELECT status FROM user_devices WHERE id = ?",
    [bindingId]
  );

  if (rows.length === 0) {
    throw new Error(`No device binding with id ${bindingId}`);
  }

  throw new Error(
    `Device binding #${bindingId} is "${rows[0].status}", not "pending". ` +
      "Only pending bindings can be approved by this script."
  );
}

const options = parseArguments(process.argv.slice(2));
const pool = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));
const connection = await pool.getConnection();

try {
  if (options.mode === "list") {
    await listPending(connection);
  } else {
    await approve(connection, options.bindingId);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
