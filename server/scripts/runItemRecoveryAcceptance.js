import { readFile, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";

import databaseConfig from "../config/database.js";
import {
  parseItemRecoveryContext,
  verifyItemRecoveryAttestation,
  verifyItemRecovery
} from "../src/modules/item/itemRecoveryAcceptance.js";

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

const reportPath = requiredArgument("--output");
const testName = "Item restored database, media and import reconciliation";
const trustPolicyUrl = new URL("../config/itemRecoveryTrustPolicy.json", import.meta.url);
let connection;
let report = { tests: [{ name: testName, id: "TC-016", status: "FAIL" }] };

try {
  const trustPolicy = JSON.parse(await readFile(trustPolicyUrl, "utf8"));
  if (trustPolicy.status === "UNPROVISIONED") {
    report.tests[0].status = "NOT_RUN";
    throw new Error("repository recovery trust policy is not provisioned");
  }
  const manifestPath = process.env.ITEM_RECOVERY_MANIFEST_PATH;
  if (!manifestPath) throw new Error("ITEM_RECOVERY_MANIFEST_PATH is required");
  const attestationPath = process.env.ITEM_RECOVERY_ATTESTATION_PATH;
  if (!attestationPath) throw new Error("ITEM_RECOVERY_ATTESTATION_PATH is required");
  const manifestBytes = await readFile(manifestPath);
  verifyItemRecoveryAttestation({
    manifestBytes,
    signatureBase64: await readFile(attestationPath, "utf8"),
    publicKeyPem: trustPolicy.attestationPublicKeyPem
  });
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const context = parseItemRecoveryContext({ env: process.env, manifest, trustPolicy });

  connection = await mysql.createConnection({
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    password: databaseConfig.password,
    database: context.databaseSchema,
    socketPath: databaseConfig.socketPath,
    ssl: databaseConfig.ssl.enabled ? {
      ca: databaseConfig.ssl.ca,
      rejectUnauthorized: databaseConfig.ssl.rejectUnauthorized
    } : undefined
  });
  await connection.query("SET SESSION TRANSACTION READ ONLY");
  await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
  const result = await verifyItemRecovery({ database: connection, context });
  await connection.rollback();

  report = {
    tests: [{ name: testName, id: "TC-016", status: result.passed ? "PASS" : "FAIL" }]
  };
  console.log(JSON.stringify({
    recoveryPointId: context.recoveryPoint.id,
    observedRtoMs: result.metrics.observedRtoMs,
    observedRpoMs: result.metrics.observedRpoMs,
    passedChecks: result.checks.filter(({ status }) => status === "PASS").length,
    failedChecks: result.checks.filter(({ status }) => status === "FAIL").map(({ id }) => id)
  }));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  console.error(`Item recovery acceptance failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await connection?.rollback().catch(() => {});
  await connection?.end().catch(() => {});
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
