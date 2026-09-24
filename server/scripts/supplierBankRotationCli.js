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

export const USAGE = [
  "Usage: --from=<keyId> --to=<activeKeyId> [options]",
  "",
  "  --from=<keyId>              the key id to rotate away from; must be in the ring",
  "  --to=<keyId>                the key id to rotate to; must be the active one",
  "  --batch-size=<n>            rows per SELECT (default 200); at least 1",
  "  --limit=<n>                 stop after n rows attempted; at least 1.",
  "                              Omit it to rotate everything — 0 is not a dry run.",
  "  --transition-started=<iso>  when the two-key transition began (age warning)",
  "  --json                      print the report on one line, no progress output",
  "  --help                      print this"
].join("\n");

/**
 * 解 argv。
 *
 * 呢個係 operator 唯一接觸得到嘅面，而佢之前一條測試都冇 —— REV-052 M-1（一個從來
 * 冇驗證過嘅 `--from`）就係住喺呢度。而家佢有自己一個測試檔。（REV-053 M-4）
 *
 * 三樣嘢係特登收緊咗嘅：
 *
 * 1. `--limit=0` 之前係**合法**嘅，而喺 `runRotation` 入面 `limit = 0` 等於「冇上限」
 *    —— 即係一個打 `--limit=0` 當「乜都唔好做，俾我睇吓」嘅 operator 會改寫成張表，
 *    然後收到「舊 key 可以剷」。佢隔籬嗰個 `--batch-size=0` 又啱啱相反：一行都唔做。
 *    同一個 0，兩個相反意思，而且就喺嗰個「謹慎試探」用嘅旗上面。兩個都收 `>= 1`。
 * 2. `--to=e2=x` 之前靜靜雞截成 `e2`，因為 `split("=")` 兩位解構。Base64 key material
 *    本身就帶 `=`，所以一個貼錯嘅值會變成一個睇落合理嘅 key id。（L-9）
 * 3. `--json=false` 之前等於 `--json`。（L-9）
 */
export function parseArguments(argv) {
  const options = { batchSize: undefined, limit: undefined, transitionStarted: null, json: false };
  for (const argument of argv) {
    if (!argument.startsWith("--")) throw new Error(`unknown argument ${JSON.stringify(argument)}`);
    const body = argument.slice(2);
    const separator = body.indexOf("=");
    // 淨係喺**第一個** `=` 度分 —— 右邊原封不動。
    const [flag, rawValue] = separator === -1 ? [body, undefined] : [body.slice(0, separator), body.slice(separator + 1)];
    if (flag === "help") return { help: true };
    else if (flag === "from") options.from = rawValue;
    else if (flag === "to") options.to = rawValue;
    else if (flag === "batch-size") options.batchSize = Number(rawValue);
    else if (flag === "limit") options.limit = Number(rawValue);
    else if (flag === "transition-started") options.transitionStarted = Date.parse(String(rawValue));
    else if (flag === "json") {
      if (rawValue !== undefined) throw new Error("--json takes no value");
      options.json = true;
    // 淨係報旗名，唔好把成個 argv 回顯 —— 一個打錯位置嘅 key value 唔應該
    // 走入 stderr 同 shell history。（L-8）
    } else throw new Error(`unknown argument --${flag}`);
  }
  if (!options.from || !options.to) throw new Error("both --from and --to are required");
  for (const [name, value] of [["--batch-size", options.batchSize], ["--limit", options.limit]]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new Error(name === "--limit"
        ? "--limit must be a positive integer; omit it to rotate every remaining row"
        : "--batch-size must be a positive integer");
    }
  }
  if (options.transitionStarted !== null && Number.isNaN(options.transitionStarted)) {
    throw new Error("--transition-started must be an ISO date");
  }
  return options;
}

export async function main(kind, argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    // Operator 打錯嘢唔應該收到一個 Node stack trace。（REV-053 L-8）
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

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
      // 用 `attempted` 唔用 `processed`：`processed` 喺啲行一路失敗嗰陣唔會郁，而
      // `0 % 100 === 0`，所以一張壞表會變成**一行 stdout 一行資料**。`attempted`
      // 單調遞增，所以佢真係每一百行出一次。（REV-053 L-3）
      onProgress: options.json ? () => {} : ({ processed, attempted, lastId }) => {
        if (attempted % 100 === 0) {
          process.stdout.write(`attempted=${attempted} processed=${processed} lastId=${lastId}\n`);
        }
      }
    });
    process.stdout.write(`${JSON.stringify(report, null, options.json ? 0 : 2)}\n`);
    for (const warning of report.warnings) process.stderr.write(`WARNING ${warning.code}: ${warning.message}\n`);
    // 有失敗行就唔可以回 0 —— 一個 CI job 或者 runbook 睇 exit code，而「做咗一半」
    // 唔係成功。仲有行未換唔係失敗：續跑本來就係預期用法。
    return report.failed === 0 ? 0 : 1;
  } catch (error) {
    /**
     * 打錯 `--from`、`--to` 唔係 active、連唔到資料庫 —— 呢啲之前全部變成一個
     * unhandled rejection，即係 operator 收到成個 Node stack trace。（REV-053 L-8）
     *
     * 印 `error.message` 係安全嘅：會走到呢度嘅係 `assertSource`／`assertTarget`
     * （講嘅係 key **id**，唔係 key material）、config 同連線錯誤。真正會嵌住
     * blind index 嗰個 `ER_DUP_ENTRY` 係逐行 catch 嘅，行唔到呢度 —— 而嗰條路
     * 由 `safeReason` 收住。
     */
    process.stderr.write(`${error.message}\n`);
    return 2;
  } finally {
    await pool.end();
  }
}
