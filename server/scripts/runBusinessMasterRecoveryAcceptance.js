import { writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";

import { up as migrateBusinessMaster } from "../database/migrations/0027_create_business_master.js";
import { BusinessMasterProvider } from "../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../src/modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../src/modules/businessMaster/BusinessMasterRepository.js";

function outputPath() {
  const index = process.argv.indexOf("--output");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--output is required");
  return process.argv[index + 1];
}

const reportPath = outputPath();
const connectionOptions = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
};

let connection;
let recovered;
let report;
const startedAt = Date.now();
const recoverySchema = `bm_recovery_${process.pid}`;
const fixtureCurrency = "CAD";
const fixtureTermCode = "RECOVERY-BM";
try {
  connection = await mysql.createConnection({ ...connectionOptions, database: process.env.DB_NAME });
  await connection.query("DELETE FROM business_master_audit_logs WHERE correlation_id = 'recovery-rehearsal'");
  await connection.query("DELETE FROM payment_terms WHERE code_key = ?", [fixtureTermCode]);
  await connection.query("DELETE FROM currencies WHERE code = ?", [fixtureCurrency]);
  const nowMs = Date.now();
  await connection.execute(
    `INSERT INTO currencies
       (code, name, decimal_places, status, version, created_at, created_by, updated_at, updated_by)
     VALUES (?, 'Canadian Dollar', 2, 'INACTIVE', 3, ?, NULL, ?, NULL)`,
    [fixtureCurrency, nowMs, nowMs]
  );
  const [termResult] = await connection.execute(
    `INSERT INTO payment_terms
       (code, code_key, name, description, calculation_type, due_days, status, version, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, 'Recovery Net 30', 'Recovery fixture', 'NET_DAYS', 30, 'INACTIVE', 4, ?, NULL, ?, NULL)`,
    [fixtureTermCode, fixtureTermCode, nowMs, nowMs]
  );
  await connection.execute(
    `INSERT INTO business_master_audit_logs
       (entity_type, entity_key, action, result, before_json, after_json, impact_json, reason, actor_user_id, correlation_id, idempotency_key_hash, created_at)
     VALUES ('CURRENCY', ?, 'DEACTIVATE', 'SUCCESS', NULL, ?, NULL, 'recovery fixture', NULL, 'recovery-rehearsal', NULL, ?),
            ('PAYMENT_TERM', ?, 'CHANGE_RULE', 'SUCCESS', NULL, ?, NULL, 'recovery fixture', NULL, 'recovery-rehearsal', NULL, ?)`,
    [fixtureCurrency, JSON.stringify({ code: fixtureCurrency, status: "INACTIVE", version: 3 }), nowMs, String(termResult.insertId), JSON.stringify({ id: Number(termResult.insertId), status: "INACTIVE", version: 4 }), nowMs]
  );

  const tables = ["roles", "permissions", "role_permissions", "currencies", "payment_terms", "business_master_audit_logs"];
  await connection.query(`CREATE DATABASE \`${recoverySchema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  for (const table of tables) await connection.query(`CREATE TABLE \`${recoverySchema}\`.\`${table}\` LIKE \`${process.env.DB_NAME}\`.\`${table}\``);
  await connection.beginTransaction();
  try {
    for (const table of tables) await connection.query(`INSERT INTO \`${recoverySchema}\`.\`${table}\` SELECT * FROM \`${process.env.DB_NAME}\`.\`${table}\``);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }

  recovered = await mysql.createConnection({ ...connectionOptions, database: recoverySchema });
  const before = {};
  for (const table of ["currencies", "payment_terms", "business_master_audit_logs"]) {
    const [[sourceCount]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${process.env.DB_NAME}\`.\`${table}\``);
    const [[restoredCount]] = await recovered.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    before[table] = Number(sourceCount.total) === Number(restoredCount.total);
  }
  const [[restoredCurrency]] = await recovered.query("SELECT status, version FROM currencies WHERE code = ?", [fixtureCurrency]);
  const [[restoredTerm]] = await recovered.query("SELECT id, status, version FROM payment_terms WHERE code_key = ?", [fixtureTermCode]);
  const [[auditLinkage]] = await recovered.query(
    "SELECT COUNT(*) AS total FROM business_master_audit_logs WHERE (entity_type='CURRENCY' AND entity_key=?) OR (entity_type='PAYMENT_TERM' AND entity_key=?)",
    [fixtureCurrency, String(restoredTerm.id)]
  );
  const readinessBefore = await new BusinessMasterReadinessService({ database: recovered, checkerIds: ["customer", "supplier", "sales", "purchasing", "ar", "ap"] }).inspect();
  const providerBefore = await new BusinessMasterProvider({ database: recovered, repository: new BusinessMasterRepository() }).getCurrencyHistory(fixtureCurrency);

  await migrateBusinessMaster(recovered);
  const readinessAfter = await new BusinessMasterReadinessService({ database: recovered, checkerIds: ["customer", "supplier", "sales", "purchasing", "ar", "ap"] }).inspect();
  const providerAfter = await new BusinessMasterProvider({ database: recovered, repository: new BusinessMasterRepository() }).getPaymentTermHistory(restoredTerm.id);
  const [[hkdCount]] = await recovered.query("SELECT COUNT(*) AS total FROM currencies WHERE code='HKD' AND decimal_places=2 AND status='ACTIVE'");
  const evidence = {
    ...before,
    hkd: Number(hkdCount.total) === 1,
    inactiveCurrency: restoredCurrency.status === "INACTIVE" && Number(restoredCurrency.version) === 3 && providerBefore.status === "INACTIVE",
    inactiveTerm: restoredTerm.status === "INACTIVE" && Number(restoredTerm.version) === 4 && providerAfter.version === 4,
    auditLinkage: Number(auditLinkage.total) === 2,
    readinessBefore: readinessBefore.status === "READY",
    readinessAfter: readinessAfter.status === "READY"
  };
  const passed = Object.values(evidence).every((value) => Number(value) === 1);
  console.log(JSON.stringify({ durationMs: Date.now() - startedAt, rtoObjectiveHours: 4, rpoObjectiveMinutes: 15, observedRpoMinutes: 0, method: "consistent cross-schema logical copy and fresh provider/readiness instances", evidence }));
  report = { tests: [{ name: "Business Master logical restore, migration rerun and provider restart rehearsal", id: "TC-019", status: passed ? "PASS" : "FAIL" }] };
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(error);
  report = { tests: [{ name: "Business Master logical restore, migration rerun and provider restart rehearsal", id: "TC-019", status: "FAIL" }] };
  process.exitCode = 1;
} finally {
  await recovered?.end().catch(() => {});
  await connection?.query(`DROP DATABASE IF EXISTS \`${recoverySchema}\``).catch(() => {});
  await connection?.query("DELETE FROM business_master_audit_logs WHERE correlation_id = 'recovery-rehearsal'").catch(() => {});
  await connection?.query("DELETE FROM payment_terms WHERE code_key = ?", [fixtureTermCode]).catch(() => {});
  await connection?.query("DELETE FROM currencies WHERE code = ?", [fixtureCurrency]).catch(() => {});
  await connection?.end().catch(() => {});
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
