import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import dotenv from "dotenv";

/**
 * T51 部署 smoke（HD-148 B；設計 §14.1 第 7 步、§14.4）。兩個模式：
 *
 * - `check --url <已部署 server 嘅 base URL> --output <file>`：只讀，對已部署環境。`DB_*` 要 export 一個只有 SELECT 嘅帳號；
 *   刻意唔讀 server/.env，免得退返去 app 有寫權嘅帳號。查 health 200、Supplier schema 同開機自我檢查用同一套 inspector、
 *   §14.4 嘅 migration／permission／settings／貨幣。Approval 狀態只係記低（上線之後業務可以開咗佢），除非加
 *   `--first-deployment`：第一次部署 Supplier 時 §14.2／§14.4 要求 OFF。唔使任何 app 帳號或者密碼。
 * - `copy --database <名>_smoke --output <file>`：會寫，只對一個還原咗嘅 production 副本（名一定要以 `_smoke` 結尾，亦唔可以
 *   係 DB_NAME）。同 migrate.js、app 一樣讀 server/.env，連線設定（SSL、socket）亦一樣。用 `DB_ADMIN_*` 以呢個 release 跑
 *   migration（即係喺真資料上面演練 upgrade），做 §14.4 核對，再用部署嘅 config（Bank key ring、JWT_SECRET）喺副本上面起
 *   app（只聽 127.0.0.1），臨時用戶（harness 會刪返）行齊分角色 smoke，包括 approval ON。Supplier、SKU、Bank 等 smoke
 *   資料留喺副本，副本由 operator 自己剷。
 *
 * 報告係 harness 嘅 HARNESS_JSON；每項檢查同細節印喺 stdout。需要 server/test/integration 同 test-support（smoke 同 TC-135
 * 共用嗰份 code），所以要喺一個完整嘅 repository checkout 度跑。
 */
const [mode] = process.argv.slice(2);
const SERVER = fileURLToPath(new URL("../", import.meta.url));
// config/database.js 喺 import 當下讀 env，所以 .env 要先載，其他 module 之後先動態 import（同 migrate.js）。
if (mode === "copy") dotenv.config({ path: path.join(SERVER, ".env") });

const { default: databaseConfig } = await import("../config/database.js");
const { normalizeDatabaseConfig } = await import("../src/framework/configuration/normalizeDatabaseConfig.js");
const { createMySqlDatabasePool } = await import("../src/services/mysqldatabase/connection.js");
const { inspectSupplierSchema } = await import("../src/modules/supplier/supplierSchemaCheck.js");
const { checklist, deploymentChecks, errorText, outputPath, separatedRoleSmoke, writeReport } =
  await import("../test/integration/supplierAcceptanceRunner.js");

const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const firstDeployment = process.argv.includes("--first-deployment");
const reportPath = outputPath();
const { checks, check, passed } = checklist();
const evidence = { mode, firstDeployment, checks };

async function deployedCheck(url) {
  // 同 migrate.js、app 一樣嘅連線設定（包括 SSL）。
  const connection = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));
  try {
    const health = await fetch(new URL("/api/v1/health", url)).then((response) => response.status, errorText);
    check("deploy.health", health === 200, { health });
    const { missing, incompatible } = await inspectSupplierSchema(connection);
    check("deploy.schema_matches_release", missing.length === 0 && incompatible.length === 0, { missing, incompatible });
    evidence.approval = (await deploymentChecks(connection, databaseConfig.database, check, { approvalMustBeOff: firstDeployment })).approval;
  } finally {
    await connection.end().catch(() => {});
  }
}

async function restoredCopy(database) {
  if (!/^[\w$]+_smoke$/u.test(database ?? "") || database === process.env.DB_NAME) {
    throw new Error("copy needs --database <name>_smoke: a restored copy of production, never the database the deployment uses (DB_NAME)");
  }
  if (!process.env.DB_ADMIN_USER) throw new Error("copy needs DB_ADMIN_USER and DB_ADMIN_PASSWORD: it runs migrations on the copy");
  if (!process.env.JWT_SECRET) throw new Error("copy needs the deployment's JWT_SECRET");
  const user = process.env.DB_ADMIN_USER;
  const password = process.env.DB_ADMIN_PASSWORD ?? "";
  // 只聽本機：副本有 production 資料（REV-129 O2）。Harness 喺 start() 先載 config/application.js。
  process.env.APP_HOST = "127.0.0.1";
  const { createSupplierHarness } = await import("../test/integration/supplierHttpHarness.js");
  const admin = createMySqlDatabasePool(normalizeDatabaseConfig({ ...databaseConfig, database, user, password }));
  const app = createSupplierHarness("smk", { database: { database, user, password } });
  try {
    const env = { ...process.env, DB_NAME: database, DB_USER: user, DB_PASSWORD: password };
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(SERVER, "scripts/migrate.js")], { cwd: SERVER, env });
    evidence.migrationsApplied = stdout.split("\n").filter((line) => line.startsWith("applied "));
    const { currencyCode, approval } = await deploymentChecks(admin, database, check, { approvalMustBeOff: firstDeployment });
    evidence.approvalBefore = approval;
    // app.start() 行開機自我檢查：schema、permission、settings、key ring 唔啱就拋，即係 FAIL。
    await app.start();
    await separatedRoleSmoke(app, check, { tag: randomUUID().slice(0, 8).toUpperCase(), reason: "T51 deployment smoke", currencyCode });
  } finally {
    await app.stop().catch((error) => check("cleanup.app", false, errorText(error)));
    await admin.end().catch(() => {});
  }
}

const NAMES = {
  check: "TC-135 deployed environment: health, schema and §14.4 checks (read-only)",
  copy: "TC-135 restored copy of production: upgrade, §14.4 checks and separated-role smoke"
};
try {
  if (mode === "check") await deployedCheck(option("url") ?? (() => { throw new Error("check needs --url"); })());
  else if (mode === "copy") await restoredCopy(option("database"));
  else throw new Error("usage: smokeSupplierManagement.js check --url <url> | copy --database <name>_smoke, with --output <file>"
    + " [--first-deployment]");
} catch (error) {
  check("runner.completed", false, errorText(error));
}
console.log(JSON.stringify(evidence, null, 2));
await writeReport(reportPath, [{ name: NAMES[mode] ?? "smokeSupplierManagement.js: no valid mode", id: "TC-135", status: passed() ? "PASS" : "FAIL" }]);
if (!passed()) process.exitCode = 1;
