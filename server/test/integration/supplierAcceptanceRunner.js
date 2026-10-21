import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

/**
 * `server/scripts/runSupplier*Acceptance.js` 共用嘅小工具（HD-117 A、HD-119 A）。報告格式係 harness 嘅
 * HARNESS_JSON：`{"tests":[{name,id,status}]}`，status 只有 PASS／FAIL／SKIPPED／NOT_RUN。要 production 先做到嘅部分
 * 一律另開一項 NOT_RUN，原因寫喺 stdout 嘅 JSON，唔當 PASS。
 */

export function outputPath(argv = process.argv) {
  const index = argv.indexOf("--output");
  if (index < 0 || !argv[index + 1]) throw new Error("--output is required");
  return argv[index + 1];
}

export async function writeReport(file, tests) {
  await writeFile(file, `${JSON.stringify({ tests }, null, 2)}\n`);
}

/** 逐項檢查：記低結果，唔即刻拋，等報告列得出邊幾項唔過。 */
export function checklist() {
  const checks = [];
  return {
    checks,
    check(id, ok, detail = undefined) {
      checks.push({ id, status: ok ? "PASS" : "FAIL", ...(detail === undefined ? {} : { detail }) });
      return Boolean(ok);
    },
    passed: () => checks.length > 0 && checks.every(({ status }) => status === "PASS")
  };
}

/** 開／剷 scratch database 要 admin；冇 DB_ADMIN_USER 就用 DB_USER（harness 只傳 profile 嘅 env_keys）。 */
export function adminCredentials() {
  return { user: process.env.DB_ADMIN_USER ?? process.env.DB_USER, password: process.env.DB_ADMIN_PASSWORD ?? process.env.DB_PASSWORD };
}

export function adminConnection(database = undefined) {
  return mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), ...adminCredentials(), database,
    multipleStatements: true });
}

/** 名一定喺 `${DB_NAME}_rh_` 之下：清理只會剷呢個前綴。 */
export function scratchName() {
  return `${process.env.DB_NAME}_rh_${randomUUID().replace(/-/gu, "").slice(0, 8)}`;
}

/** 呼叫 mysql／mysqldump。密碼經 MYSQL_PWD，唔放 argv（ps 睇得到）。 */
export function mysqlClient(binary, args, { input, stdoutFile } = {}) {
  const { user, password } = adminCredentials();
  const bin = process.env.MYSQL_BIN ? path.join(process.env.MYSQL_BIN, binary) : binary;
  const result = spawnSync(bin, [`--host=${process.env.DB_HOST}`, `--port=${process.env.DB_PORT}`, `--user=${user}`,
    "--default-character-set=utf8mb4", ...args], {
    input, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, env: { ...process.env, MYSQL_PWD: password ?? "" },
    ...(stdoutFile ? { stdio: ["pipe", stdoutFile, "pipe"] } : {})
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${binary} exited ${result.status}: ${String(result.stderr).trim().slice(0, 500)}`);
  return result.stdout;
}

/** 每張 table 嘅 CHECKSUM，key 係 table 名。 */
export async function tableChecksums(connection, database) {
  const [tables] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name", [database]);
  if (tables.length === 0) return {};
  const [rows] = await connection.query(`CHECKSUM TABLE ${tables.map(({ name }) => `\`${database}\`.\`${name}\``).join(", ")}`);
  return Object.fromEntries(rows.map((row) => [row.Table.slice(database.length + 1), String(row.Checksum)]));
}

export const errorText = (error) => (error instanceof Error ? error.message : String(error));
