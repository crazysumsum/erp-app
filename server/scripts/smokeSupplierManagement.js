// 第一個 import：config/jwt.js 冇預設 JWT_SECRET；copy 模式嘅 harness 要簽 token（同 runSupplierReleaseAcceptance.js）。
import "../test-support/testEnv.js";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import databaseConfig from "../config/database.js";
import { normalizeDatabaseConfig } from "../src/framework/configuration/normalizeDatabaseConfig.js";
import { inspectSupplierSchema } from "../src/modules/supplier/supplierSchemaCheck.js";
import { createMySqlDatabasePool } from "../src/services/mysqldatabase/connection.js";
import { createSupplierHarness } from "../test/integration/supplierHttpHarness.js";
import {
  adminConnection, adminCredentials, checklist, deploymentChecks, errorText, outputPath, separatedRoleSmoke, writeReport
} from "../test/integration/supplierAcceptanceRunner.js";

/**
 * T51 部署 smoke（HD-148 B；設計 §14.1 第 7 步、§14.4）。兩個模式：
 *
 * - `check --url <已部署 server 嘅 base URL> --output <file>`：只讀，對已部署環境。`DB_*` 用一個只有 SELECT 嘅帳號連佢個
 *   database。查 health 200、Supplier schema 同開機自我檢查用同一套 inspector、§14.4 嘅 migration／permission／settings／
 *   貨幣。Approval 狀態只係記低：上線之後業務可以開咗佢。唔寫任何嘢，唔使任何 app 帳號或者密碼。
 * - `copy --database <名>_smoke --output <file>`：會寫，只對一個還原咗嘅 production 副本（名一定要以 `_smoke` 結尾，亦唔可以
 *   係 DB_NAME）。用 `DB_ADMIN_*` 以呢個 release 跑 migration（即係喺真資料上面演練 upgrade），做 §14.4 核對，再用部署嘅
 *   config（Bank key ring 等環境變數）喺副本上面起 app，臨時用戶（harness 會刪返）行齊分角色 smoke，包括 approval ON。
 *   Supplier、SKU、Bank 等 smoke 資料留喺副本，副本由 operator 自己剷。
 *
 * 報告係 harness 嘅 HARNESS_JSON；每項檢查同細節印喺 stdout。
 */
const [mode] = process.argv.slice(2);
const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const reportPath = outputPath();
const { checks, check, passed } = checklist();
const evidence = { mode, checks };
const SERVER = fileURLToPath(new URL("../", import.meta.url));

async function deployedCheck(url) {
  // 同 migrate.js、app 一樣嘅連線設定（包括 SSL）。
  const connection = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));
  try {
    const health = await fetch(new URL("/api/v1/health", url)).then((response) => response.status, errorText);
    check("deploy.health", health === 200, { health });
    const { missing, incompatible } = await inspectSupplierSchema(connection);
    check("deploy.schema_matches_release", missing.length === 0 && incompatible.length === 0, { missing, incompatible });
    evidence.approval = (await deploymentChecks(connection, databaseConfig.database, check, { approvalMustBeOff: false })).approval;
  } finally {
    await connection.end().catch(() => {});
  }
}

async function restoredCopy(database) {
  if (!/^[\w$]+_smoke$/u.test(database ?? "") || database === process.env.DB_NAME) {
    throw new Error("copy needs --database <name>_smoke: a restored copy of production, never the database the deployment uses (DB_NAME)");
  }
  const admin = await adminConnection();
  const { user, password } = adminCredentials();
  const app = createSupplierHarness("smk", { database: { database, user, password } });
  try {
    const env = { ...process.env, DB_NAME: database, DB_USER: user, DB_PASSWORD: password };
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(SERVER, "scripts/migrate.js")], { cwd: SERVER, env });
    evidence.migrationsApplied = stdout.split("\n").filter((line) => line.startsWith("applied "));
    const { currencyCode, approval } = await deploymentChecks(admin, database, check, { approvalMustBeOff: false });
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
  else throw new Error("usage: smokeSupplierManagement.js check --url <url> | copy --database <name>_smoke, with --output <file>");
} catch (error) {
  check("runner.completed", false, errorText(error));
}
console.log(JSON.stringify(evidence, null, 2));
await writeReport(reportPath, [{ name: NAMES[mode] ?? `unknown mode ${mode}`, id: "TC-135", status: passed() ? "PASS" : "FAIL" }]);
if (!passed()) process.exitCode = 1;
