import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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

/**
 * 開／剷 scratch database、還原有 definer 嘅 trigger、跑 migration 都要 admin（HD-123 A 起 profile 會傳 DB_ADMIN_*）。
 * 一對一齊用，唔逐個欄位退返去 DB_USER：嗰樣會變成用 erp_user 加 admin 密碼登入（REV-112 L-2）。
 */
export function adminCredentials() {
  return { user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD ?? "" };
}

/**
 * 冇 admin 帳號係環境前提唔齊，唔係測試失敗：每個 TC 報 NOT_RUN（suite 係 BLOCKED）就收工，唔郁任何資料庫（REV-112 L-2）。
 */
export async function exitUnlessAdmin(file, ids) {
  if (process.env.DB_ADMIN_USER) return;
  console.error("DB_ADMIN_USER is not set: these runners create and drop scratch databases, restore triggers and run migrations");
  await writeReport(file, ids.map((id) => ({ name: `${id} not run: DB_ADMIN_USER is not set`, id, status: "NOT_RUN" })));
  process.exit(0);
}

export function adminConnection(database = undefined) {
  return mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), ...adminCredentials(), database,
    multipleStatements: true });
}

/** 名一定喺 `${DB_NAME}_rh_` 之下：清理只會剷呢個前綴。 */
export function scratchName() {
  return `${process.env.DB_NAME}_rh_${randomUUID().replace(/-/gu, "").slice(0, 8)}`;
}

/**
 * 呼叫 mysql／mysqldump。密碼經 MYSQL_PWD，唔放 argv（ps 睇得到）。`stdin`／`stdout` 係 file descriptor：成份 dump
 * 唔使變一條 JS 字串，mysql 中途退出亦唔會變 EPIPE 蓋住真正原因。exit 0 但 stderr 有 Error（例如權限不足）都當失敗。
 */
export function mysqlClient(binary, args, { stdin = "pipe", stdout = "pipe" } = {}) {
  const { user, password } = adminCredentials();
  const bin = process.env.MYSQL_BIN ? path.join(process.env.MYSQL_BIN, binary) : binary;
  const result = spawnSync(bin, [`--host=${process.env.DB_HOST}`, `--port=${process.env.DB_PORT}`, `--user=${user}`,
    "--default-character-set=utf8mb4", ...args], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MYSQL_PWD: password ?? "" }, stdio: [stdin, stdout, "pipe"]
  });
  const stderr = String(result.stderr ?? "").trim().slice(0, 500);
  if (result.error) throw new Error(`${binary}: ${result.error.message}${stderr ? `: ${stderr}` : ""}`);
  if (result.status !== 0 || /\berror\b/iu.test(stderr)) throw new Error(`${binary} exited ${result.status}: ${stderr}`);
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

const hash = (value) => createHash("sha256").update(value).digest("hex");

/**
 * CHECKSUM 只計資料。Schema 物件另外比：每張 table 嘅 `SHOW CREATE TABLE`（去咗 AUTO_INCREMENT 計數）、trigger、
 * routine 同 event 嘅定義。Schema 名唔計，因為還原嘅 schema 名一定唔同。
 */
export async function schemaObjects(connection, database) {
  const objects = {};
  const [tables] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name", [database]);
  for (const { name } of tables) {
    const [[row]] = await connection.query(`SHOW CREATE TABLE \`${database}\`.\`${name}\``);
    // 還原之後 column 會明寫 `CHARACTER SET x COLLATE y`，原本只寫 `COLLATE y`：collation 已經決定 charset，所以拎走前者。
    objects[`table:${name}`] = hash(row["Create Table"].replace(/ AUTO_INCREMENT=\d+/u, "").replace(/CHARACTER SET \w+ (?=COLLATE )/gu, ""));
  }
  const [triggers] = await connection.query(`SELECT trigger_name AS name, event_manipulation AS event, event_object_table AS tbl,
    action_timing AS timing, action_statement AS body FROM information_schema.triggers WHERE trigger_schema = ?`, [database]);
  for (const row of triggers) objects[`trigger:${row.name}`] = hash(JSON.stringify([row.event, row.tbl, row.timing, row.body]));
  const [routines] = await connection.query(`SELECT routine_name AS name, routine_type AS type, routine_definition AS body
    FROM information_schema.routines WHERE routine_schema = ?`, [database]);
  for (const row of routines) objects[`${row.type.toLowerCase()}:${row.name}`] = hash(String(row.body));
  const [events] = await connection.query(`SELECT event_name AS name, event_definition AS body, interval_value AS every, interval_field AS unit
    FROM information_schema.events WHERE event_schema = ?`, [database]);
  for (const row of events) objects[`event:${row.name}`] = hash(JSON.stringify([row.body, row.every, row.unit]));
  return objects;
}
