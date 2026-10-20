import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultConfigurationSource,
  validateApplicationConfiguration
} from "../../src/framework/configuration/applicationConfiguration.js";

const DEFAULTS = Object.freeze({
  maxLinesPerDocument: 100,
  maxAllocationsPerLine: 50,
  defaultPageSize: 20,
  maxPageSize: 100,
  operationLeaseMs: 60000,
  recoveryBatchSize: 100,
  exportBatchSize: 1000,
  exportMaxRows: 250000,
  exportRetentionHours: 24,
  archiveQueryMaxRangeDays: 366,
  reconciliationBatchSize: 500
});

function configuration(fulfillment) {
  return validateApplicationConfiguration({ ...defaultConfigurationSource(), fulfillment });
}

test("Fulfillment startup configuration exposes immutable approved defaults", () => {
  const config = validateApplicationConfiguration(defaultConfigurationSource()).fulfillment;
  assert.deepEqual(config, DEFAULTS);
  assert.equal(Object.isFrozen(config), true);
});

test("Fulfillment startup rejects malformed sections and unapproved settings", () => {
  for (const source of [null, [], "invalid", { typo: 1 }, { timeZone: "UTC" }]) {
    assert.throws(() => configuration(source), error => {
      assert.equal(error.code, "CONFIGURATION_INVALID");
      assert.ok(error.details.some(detail => detail.section === "fulfillment"));
      return true;
    });
  }
});

test("every Fulfillment numeric setting fails closed for nonpositive, fractional or unsafe values", () => {
  for (const field of Object.keys(DEFAULTS)) {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, true, [], "1"]) {
      assert.throws(() => configuration({ [field]: value }), undefined, `${field}: ${String(value)}`);
    }
    const config = configuration({ [field]: 1, ...(field === "maxPageSize" ? { defaultPageSize: 1 } : {}) });
    assert.equal(config.fulfillment[field], 1);
  }
});

test("Fulfillment rejects document, allocation, page, export and date windows beyond approved bounds", () => {
  for (const changes of [
    { maxLinesPerDocument: 101 }, { maxAllocationsPerLine: 51 },
    { defaultPageSize: 101 }, { maxPageSize: 101 },
    { defaultPageSize: 21, maxPageSize: 20 },
    { exportMaxRows: 250001 }, { archiveQueryMaxRangeDays: 367 }
  ]) assert.throws(() => configuration(changes));
});

test("invalid Fulfillment environment configuration stops the actual server before database startup or listening", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "fulfillment-config-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ["src/index.js"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: {
      ...process.env, PORT: "0", FULFILLMENT_MAX_LINES_PER_DOCUMENT: "0",
      DB_SOCKET_PATH: path.join(directory, "absent.sock"), DB_NAME: "fulfillment_config_no_database"
    },
    encoding: "utf8",
    timeout: 10000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CONFIGURATION_INVALID/);
  assert.match(result.stderr, /maxLinesPerDocument/);
  assert.doesNotMatch(result.stdout + result.stderr, /API listening|DATABASE_OPERATION_FAILED/);
});
