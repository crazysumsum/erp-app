import assert from "node:assert/strict";
import test from "node:test";

import { BANK_METRICS_WINDOW_MS, SUPPLIER_ALERT_THRESHOLDS, supplierAlerts } from "../src/modules/supplier/supplierMetrics.js";
import { SupplierMetricsJob } from "../src/services/supplierMetrics/SupplierMetricsJob.js";

const quiet = { approvals: { pending: 0, oldestAgeMs: null },
  imports: { uploaded: 0, validating: 0, queued: 0, running: 0, oldestWaitingMs: null, stalled: 0 },
  bank: { windowMs: BANK_METRICS_WINDOW_MS, reveals: 0, changes: 0, privilegedUses: 0 } };
const HOUR = 3_600_000;

test("TASK-050 (HD-083): alerts fire only past their thresholds", () => {
  assert.deepEqual(supplierAlerts(quiet), []);
  const atLimit = { approvals: { pending: 3, oldestAgeMs: SUPPLIER_ALERT_THRESHOLDS.approvalPendingMs },
    imports: { ...quiet.imports, queued: 1, oldestWaitingMs: SUPPLIER_ALERT_THRESHOLDS.importWaitingMs }, bank: { ...quiet.bank, reveals: 9, changes: 9 } };
  assert.deepEqual(supplierAlerts(atLimit), [], "exactly at the threshold is not over it");

  const overdue = supplierAlerts({ ...quiet, approvals: { pending: 3, oldestAgeMs: 24 * HOUR + 1 } });
  assert.deepEqual(overdue.map(({ event, level }) => [event, level]), [["supplier.alert.approval_overdue", "warn"]]);
  assert.equal(overdue[0].context.pending, 3);

  const waiting = supplierAlerts({ ...quiet, imports: { ...quiet.imports, uploaded: 1, oldestWaitingMs: 15 * 60_000 + 1 } });
  assert.deepEqual(waiting.map(({ event, level }) => [event, level]), [["supplier.alert.import_stalled", "error"]]);
  const stalled = supplierAlerts({ ...quiet, imports: { ...quiet.imports, running: 1, stalled: 1 } });
  assert.deepEqual(stalled.map(({ event }) => event), ["supplier.alert.import_stalled"]);

  // SEC-014：system-admin 用過銀行資料就報，冇門檻（DEF-047、HD-142 A）。
  const privileged = supplierAlerts({ ...quiet, bank: { ...quiet.bank, reveals: 1, privilegedUses: 1 } });
  assert.deepEqual(privileged.map(({ event, level }) => [event, level]), [["supplier.alert.bank_privileged_use", "warn"]]);
  assert.equal(privileged[0].context.privilegedUses, 1);
});

test("TASK-050 (HD-083): the job logs one supplier.metrics line and each alert at its level, without CSV or Bank values", async () => {
  const logged = [];
  const logger = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (event, message, context) => logged.push({ level, event, context })]));
  const rows = [[[{ pending: 2, oldest: 0 }]], [[{ status: "running", n: 1, oldest: 0, stalled: 1 }]],
    [[{ action: "supplier.bank.reveal", n: 2, privileged: 1 }, { action: "supplier.bank.update", n: 1, privileged: 0 }]]];
  const services = { require: (name) => ({ scheduler: { register() {} }, mysqldatabase: { query: async () => rows.shift() },
    logging: { logger }, time: { nowMs: () => 25 * HOUR } })[name] };
  assert.deepEqual(SupplierMetricsJob.jobs.map(({ name, scope, intervalMs }) => [name, scope, intervalMs]), [["supplier.metrics", "cluster", 300_000]]);
  assert.equal(BANK_METRICS_WINDOW_MS, SupplierMetricsJob.jobs[0].intervalMs, "each metrics line counts bank use since the previous one");
  const metrics = await new SupplierMetricsJob({ services }).report();
  assert.deepEqual(logged.map(({ level, event }) => [level, event]), [
    ["info", "supplier.metrics"], ["warn", "supplier.alert.approval_overdue"], ["error", "supplier.alert.import_stalled"],
    ["warn", "supplier.alert.bank_privileged_use"]]);
  assert.deepEqual(metrics.approvals, { pending: 2, oldestAgeMs: 25 * HOUR });
  assert.deepEqual(metrics.bank, { windowMs: BANK_METRICS_WINDOW_MS, reveals: 2, changes: 1, privilegedUses: 1 });
  // 只有數字：冇名稱、冇檔名、冇帳號。
  assert.ok(logged.every(({ context }) => Object.values(flat(context)).every((value) => value === null || typeof value === "number")));
});

function flat(value, prefix = "") {
  return Object.entries(value).reduce((all, [key, item]) => (item !== null && typeof item === "object"
    ? { ...all, ...flat(item, `${prefix}${key}.`) } : { ...all, [`${prefix}${key}`]: item }), {});
}
