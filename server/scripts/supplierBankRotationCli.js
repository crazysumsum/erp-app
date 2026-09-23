/**
 * 兩條 Bank 輪替命令共用嘅 CLI 外殼。
 *
 * 呢個檔案（同佢兩個 entry）住喺 `server/scripts/`，而嗰個路徑**唔喺**
 * supplier_management 模組 scope 入面 —— HD-034 決定咗接受嗰個 OUTSIDE_MODULE
 * finding，換返 design baseline 唔郁（33 條 review 綁住佢，包括唯一一條 APPROVED）。
 * 所以呢度**刻意只留外殼**：解 argv、駁 config 同資料庫、印 report。所有邏輯喺
 * `server/src/modules/supplier/bankKeyRotation.js`，嗰度喺 scope 內而且測得到。
 *
 * 跟 `scripts/migrate.js` 同 `scripts/createUser.js` 嘅載入次序：`config/*.js` 喺
 * 載入當下就讀 `process.env`，所以一定要先 `dotenv.config()` 再動態 import。
 */
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export function parseArguments(argv) {
  const options = { batchSize: undefined, limit: undefined, transitionStarted: null, json: false };
  for (const argument of argv) {
    const [flag, rawValue] = argument.startsWith("--") ? argument.slice(2).split("=") : [null, null];
    if (flag === "from") options.from = rawValue;
    else if (flag === "to") options.to = rawValue;
    else if (flag === "batch-size") options.batchSize = Number(rawValue);
    else if (flag === "limit") options.limit = Number(rawValue);
    else if (flag === "transition-started") options.transitionStarted = Date.parse(rawValue);
    else if (flag === "json") options.json = true;
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!options.from || !options.to) throw new Error("both --from and --to are required");
  for (const [name, value] of [["--batch-size", options.batchSize], ["--limit", options.limit]]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  if (options.transitionStarted !== null && Number.isNaN(options.transitionStarted)) {
    throw new Error("--transition-started must be an ISO date");
  }
  return options;
}

export async function main(kind, argv = process.argv.slice(2)) {
  const options = parseArguments(argv);

  dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
  const [{ default: supplierConfig }, { default: databaseConfig }] = await Promise.all([
    import("../config/supplier.js"), import("../config/database.js")
  ]);
  const { normalizeSupplierConfig } = await import("../src/modules/supplier/normalizeSupplierConfig.js");
  const { SupplierBankCrypto } = await import("../src/modules/supplier/SupplierBankCrypto.js");
  const { runRotation } = await import("../src/modules/supplier/bankKeyRotation.js");
  const { createMySqlDatabasePool } = await import("../src/services/mysqldatabase/connection.js");
  const { normalizeDatabaseConfig } = await import("../src/framework/configuration/normalizeDatabaseConfig.js");

  const supplier = normalizeSupplierConfig(supplierConfig);
  const crypto = new SupplierBankCrypto({ encryption: supplier.bankEncryption, lookup: supplier.bankLookup });
  const pool = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));

  const database = {
    query: (sql, params) => pool.query(sql, params),
    async withTransaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  };

  try {
    const report = await runRotation({
      database, crypto, kind, from: options.from, to: options.to,
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      transitionStartedAt: options.transitionStarted,
      // Progress 印 id 同數量 —— 冇一樣係祕密，而且冇咗佢，一個跑幾個鐘嘅輪替
      // 就變成一個冇任何輸出嘅黑盒。
      onProgress: options.json ? () => {} : ({ processed, lastId }) => {
        if (processed % 100 === 0) process.stdout.write(`processed=${processed} lastId=${lastId}\n`);
      }
    });
    process.stdout.write(`${JSON.stringify(report, null, options.json ? 0 : 2)}\n`);
    for (const warning of report.warnings) process.stderr.write(`WARNING ${warning.code}: ${warning.message}\n`);
    // 有失敗行就唔可以回 0 —— 一個 CI job 或者 runbook 睇 exit code，而「做咗一半」
    // 唔係成功。仲有行未換唔係失敗：續跑本來就係預期用法。
    return report.failed === 0 ? 0 : 1;
  } finally {
    await pool.end();
  }
}
