/**
 * `npm run perf:supplier --workspace server -- --database=<DB_NAME> [--suppliers=100000] [--concurrency=50] [其他 benchmark 參數]`
 *
 * T50 嘅驗收指令（HD-101）：資料庫冇 Supplier 就先用 seedSupplierPerformanceFixtures.js seed，然後跑
 * benchmarkSupplierManagement.js。`--concurrency` 即係 benchmark 嘅 `--users`；冇 `--output` 就寫去
 * `supplier-perf-<時間>.json`。其餘參數（例如 `--only=forSku`、`--seconds`）原樣交畀 benchmark。
 * 兩個 script 各自檢查 DB_* 同 `--database`：只可以對用完即棄嘅資料庫跑。
 */
import { spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const suppliers = value("suppliers") ?? "100000";
const concurrency = value("concurrency") ?? "50";
const passThrough = args.filter((arg) => !/^--(suppliers|concurrency)=/u.test(arg));
const run = (script, scriptArgs) => {
  const result = spawnSync(process.execPath, [new URL(script, import.meta.url).pathname, ...scriptArgs], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, socketPath: process.env.DB_SOCKET_PATH || undefined });
const [[{ existing }]] = await connection.query("SELECT COUNT(*) AS existing FROM suppliers");
await connection.end();

if (Number(existing) === 0) run("./seedSupplierPerformanceFixtures.js", [`--database=${value("database") ?? ""}`, `--suppliers=${suppliers}`]);
else console.error(`${process.env.DB_NAME} already has ${existing} Supplier(s): skipping the seed`);
run("./benchmarkSupplierManagement.js", [...passThrough, `--users=${concurrency}`,
  ...(value("output") ? [] : [`--output=supplier-perf-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`])]);
