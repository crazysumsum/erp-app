import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as cancellation from "../src/modules/inventory/inventoryStocktakeCancelContext.js";
import * as inquiry from "../src/modules/inventory/InventoryInquiryService.js";
import { formatDateForFile } from "../src/services/time/timeFormat.js";
import { parse } from "csv-parse/sync";
import fs from "node:fs/promises";
import os from "node:os";
import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import { resolveApiDefinitions } from "../src/framework/api/apiDefinitionResolver.js";
import { validateApiConfig } from "../src/framework/middleware/apiDispatcher.js";
import apiConfig from "../config/api.js";
import { MySqlDatabaseService } from "../src/services/mysqldatabase/MySqlDatabaseService.js";

const time = { nowMs: () => 1791763200000, fileDate: (value = new Date(1791763200000)) => formatDateForFile(value, "Asia/Hong_Kong") };
function cancelFixture() {
  const claims = { sub: "7", roles: ["counter"], permissions: ["inventory.view", "inventory.operation"], ver: 0,
    exp: time.nowMs() / 1000 + 900, auth_time: time.nowMs() / 1000 };
  const command = { actor: { userId: 7, serviceName: "", claimedRoles: claims.roles, claimedPermissions: claims.permissions },
    authorization: { purpose: "stocktake.cancel", requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "unit039", lineId: "", eventId: "cancel" },
    payload: { stocktakeId: 41, expectedVersion: 2, reason: "abandoned count" }, correlationId: "test039" };
  const req = { method: "POST", apiRoute: { authType: "jwt-password", path: "/api/v1/inventory/stocktakes/:id/cancel" },
    input: { params: { id: "41" } }, auth: { type: "jwt-password", claims } };
  const proof = cancellation.issueInventoryStocktakeCancelContext(req, command, { time, sessionMaxAgeSeconds: 3600, clockToleranceSeconds: 0 });
  let revoked = false;
  const tx = { query: async sql => {
    if (sql.includes("FROM users")) return [[{ username: "counter" }]];
    if (sql.includes("FROM roles")) return [[{ name: "counter" }]];
    if (sql.includes("FROM permissions")) return [claims.permissions.map(name => ({ name }))];
    if (sql.includes("FROM fr_token_versions")) return [[{ version: revoked ? 1 : 0 }]];
    throw new Error(`unexpected auth read ${sql}`);
  } };
  return { command, proof, tx, revoke: () => { revoked = true; } };
}
test("ST039-U04 Cancel preflight checks do not consume; changed intent and current revocation fail closed", async () => {
  assert.equal(typeof cancellation.checkInventoryStocktakeCancelContext, "function");
  const f = cancelFixture();
  await cancellation.checkInventoryStocktakeCancelContext(f.tx, f.proof, f.command);
  await cancellation.checkInventoryStocktakeCancelContext(f.tx, f.proof, f.command, { locking: true });
  await assert.rejects(cancellation.checkInventoryStocktakeCancelContext(f.tx, f.proof,
    { ...f.command, payload: { ...f.command.payload, reason: "other" } }), { code: "PERMISSION_STALE" });
  const guard = cancellation.consumeInventoryStocktakeCancelContext(f.proof, f.command);
  await guard.check(f.tx); f.revoke();
  await assert.rejects(guard.check(f.tx, { locking: true }), { code: "JWT_INVALID" });
  await assert.rejects(cancellation.checkInventoryStocktakeCancelContext(f.tx, f.proof, f.command), { code: "PERMISSION_STALE" });
  assert.throws(() => cancellation.consumeInventoryStocktakeCancelContext(f.proof, f.command), { code: "PERMISSION_STALE" });
});
const row = { id: 201, stocktake_id: 41, stocktake_bin_id: 101, bin_id: 1, sku_id: 12, lot_id: null,
  stock_status: "AVAILABLE", stock_balance_id: 301, snapshot_quantity: 5, snapshot_balance_version: 1,
  counted_quantity: 3, is_not_found: 0, variance_quantity: null, version: 2, counted_at: 17, counted_by: 7,
  movement_id: null, bin_code_snapshot: "OLD", bin_code: "NOW", sku_code: "SKU12", sku_name: "Current SKU",
  lot_number: null, base_uom_id: 1, base_uom_code: "EA" };
test("ST039-U06 public preview distinguishes numeric zero, notFound and untouched NULL without writes", () => {
  assert.equal(typeof inquiry.projectStocktakeLine, "function");
  const header = { id: 41, status: "COUNTING", started_at: 10, ready_at: null };
  assert.equal(inquiry.projectStocktakeLine(row, header).varianceQuantity, -2);
  const empty = inquiry.projectStocktakeLine({ ...row, counted_quantity: null }, header);
  assert.equal(empty.actualQuantity, null); assert.equal(empty.varianceQuantity, null); assert.equal(empty.countState, "UNCOUNTED");
  const missing = inquiry.projectStocktakeLine({ ...row, counted_quantity: null, is_not_found: 1 }, header);
  assert.equal(missing.actualQuantity, 0); assert.equal(missing.varianceQuantity, -5); assert.equal(missing.countState, "NOT_FOUND");
  const zero = inquiry.projectStocktakeLine({ ...row, counted_quantity: 0 }, header);
  assert.equal(zero.actualQuantity, 0); assert.equal(zero.varianceQuantity, -5); assert.equal(zero.countState, "COUNTED");
  assert.equal(zero.varianceStage, "PREVIEW"); assert.equal(zero.version, 2); assert.equal(zero.snapshotBalanceId, 301);
  assert.equal(row.variance_quantity, null);
});
test("ST039-U07 frozen and cancelled projections validate stored variance and never imply posted", () => {
  assert.equal(typeof inquiry.stocktakeVarianceStage, "function");
  for (const status of ["READY_TO_POST", "POSTED", "CANCELLED"]) {
    const header = { id: 41, status, started_at: 10, ready_at: 12 };
    const result = inquiry.projectStocktakeLine({ ...row, variance_quantity: -2 }, header);
    assert.equal(result.varianceStage, "FROZEN"); assert.equal(result.cancelled, status === "CANCELLED");
    for (const variance_quantity of [null, -1, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => inquiry.projectStocktakeLine({ ...row, variance_quantity }, header), { code: "STOCKTAKE_SNAPSHOT_MISMATCH" });
    }
  }
  assert.equal(inquiry.stocktakeVarianceStage({ status: "CANCELLED", started_at: 10, ready_at: null }), "PREVIEW");
  assert.equal(inquiry.stocktakeVarianceStage({ status: "CANCELLED", started_at: null, ready_at: null }), "NOT_STARTED");
  assert.equal(inquiry.stocktakeVarianceStage({ status: "DRAFT", started_at: null, ready_at: null }), "NOT_STARTED");
  for (const changes of [{ is_not_found: 1 }, { counted_quantity: -1 }, { counted_quantity: null, variance_quantity: 0 },
    { snapshot_quantity: Number.MAX_SAFE_INTEGER + 1 }, { stock_status: "UNKNOWN" }, { stocktake_id: 42 }]) {
    assert.throws(() => inquiry.projectStocktakeLine({ ...row, ...changes }, { id: 41, status: "COUNTING", started_at: 10, ready_at: null }),
      { code: "STOCKTAKE_SNAPSHOT_MISMATCH" });
  }
});
function readFixture() {
  const header = { id: 41, warehouse_id: 1, stocktake_number: "ST-41", status: "COUNTING", version: 2,
    started_at: 10, ready_at: null, reason: "", created_at: 5, updated_at: 12 };
  const totals = { totalLines: 4, countedLines: 2, notFoundLines: 1, uncountedLines: 1, gainLines: 1, lossLines: 2, zeroLines: 0, corruptLines: 0 };
  let transactions = 0;
  const calls = [];
  const database = { query() { throw new Error("public data read escaped its snapshot"); },
    withTransaction: async (work, options) => {
      transactions++; assert.equal(options.isolationLevel, "REPEATABLE READ");
      return work({ query: async (sql, params) => {
        calls.push({ sql, params }); assert.doesNotMatch(sql, /FOR UPDATE|FOR SHARE/u);
        if (sql.includes("COUNT(*)") && sql.includes("FROM inventory_stocktakes")) return [[{ total: 1 }]];
        if (sql.includes("FROM inventory_stocktakes")) return [[header]];
        if (sql.includes("COUNT(*)") && sql.includes("inventory_stocktake_lines")) return [[totals]];
        if (sql.includes("COUNT(*)") && sql.includes("inventory_stocktake_bins")) return [[{ total: 2 }]];
        if (sql.includes("inventory_stocktake_lines")) return [[row]];
        if (sql.includes("inventory_stocktake_bins")) return [[{ id: 101, stocktake_id: 41, bin_id: 1, bin_code_snapshot: "OLD", bin_code: "NOW", status: "ACTIVE" }]];
        throw new Error(`unexpected public read ${sql}`);
      } });
    } };
  return { service: new inquiry.InventoryInquiryService({ database, time }), calls, transactions: () => transactions, totals };
}
test("ST039-U10 public header/summary/page use one unlocked RR snapshot with asOf and versions", async () => {
  const f = readFixture(); assert.equal(typeof f.service.listStocktakeLines, "function");
  const result = await f.service.listStocktakeLines({ stocktakeId: 41, page: 1, pageSize: 20 });
  assert.equal(f.transactions(), 1); assert.equal(result.asOf, time.nowMs()); assert.equal(result.version, 2);
  assert.equal(result.items[0].varianceQuantity, -2); assert.equal(result.items[0].version, 2);
  assert.equal(result.globalSummary.uncountedLines, 1); assert.equal(result.total, 4);
  const g = readFixture(); assert.equal(typeof g.service.getStocktake, "function");
  const detail = await g.service.getStocktake(41, { scopePage: 1, scopePageSize: 20 });
  assert.equal(g.transactions(), 1); assert.equal(detail.scope.total, 2); assert.equal(detail.scope.items[0].binCodeSnapshot, "OLD");
  assert.equal(detail.scope.items[0].binCodeCurrent, "NOW"); assert.equal(detail.progress.uncountedLines, 1);
});
test("ST039-U09 public summaries are safe line counts, never summed mixed-SKU quantities", async () => {
  const f = readFixture(); assert.equal(typeof f.service.listStocktakeLines, "function");
  const result = await f.service.listStocktakeLines({ stocktakeId: 41 });
  assert.deepEqual(Object.keys(result.globalSummary).sort(), ["countedLines", "gainLines", "lossLines", "notFoundLines", "totalLines", "uncountedLines", "zeroLines"].sort());
  for (const changes of [{ corruptLines: 1 }, { totalLines: Number.MAX_SAFE_INTEGER + 1 }]) {
    const g = readFixture(); Object.assign(g.totals, changes);
    await assert.rejects(g.service.listStocktakeLines({ stocktakeId: 41 }), { code: "STOCKTAKE_SNAPSHOT_MISMATCH" });
  }
});
const source = { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "unit039", eventId: "intent1" };
function request(body, action = "count", params = { id: "41" }) {
  return { method: "POST", input: { params, query: {}, body }, requestId: "unit039-request", auth: { type: "jwt", claims: {
    sub: "7", roles: ["counter"], permissions: ["inventory.view", "inventory.operation", "inventory.adjust"], ver: 0,
    exp: time.nowMs() / 1000 + 900, auth_time: time.nowMs() / 1000 } }, action };
}
async function schemas() {
  const module = await import("../src/handlers/inventory/stocktakeSchemas.js").catch(error => {
    if (error.code === "ERR_MODULE_NOT_FOUND" && error.message.includes("stocktakeSchemas.js")) return {};
    throw error;
  });
  assert.equal(typeof module.normalizeStocktakeCommand, "function"); return module;
}
test("ST039-U02 count input unions, versions, limits, IDs and foreign fields are strict without coercion", async () => {
  const { normalizeStocktakeCommand } = await schemas();
  const rows = [{ lineId: 201, expectedVersion: 1, countedQuantity: 0 }, { lineId: 202, expectedVersion: 1, notFound: true }];
  const valid = normalizeStocktakeCommand(request({ source, lines: rows }), "count");
  assert.deepEqual(valid.payload.lines, rows); assert.equal(valid.payload.stocktakeId, 41);
  for (const lines of [[], Array.from({ length: 101 }, (_, i) => ({ lineId: i + 1, expectedVersion: 1, countedQuantity: 0 })),
    [rows[0], rows[0]], [null], [{ lineId: 201, expectedVersion: 1 }], [{ lineId: 201, expectedVersion: 1, notFound: false }],
    [{ ...rows[0], notFound: true }], [{ ...rows[0], snapshotQuantity: 9 }],
    ...[null, "0", -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(countedQuantity => [{ ...rows[0], countedQuantity }]),
    ...[0, "1", 4294967296].map(expectedVersion => [{ ...rows[0], expectedVersion }])]) {
    assert.throws(() => normalizeStocktakeCommand(request({ source, lines }), "count"), { code: "INVENTORY_INPUT_INVALID" });
  }
  for (const params of [{ id: "01" }, { id: "1.0" }, { id: "9007199254740992" }, { id: 41 }, { id: "41", stocktakeId: 41 }]) {
    assert.throws(() => normalizeStocktakeCommand(request({ source, lines: rows }, "count", params), "count"), { code: "INVENTORY_INPUT_INVALID" });
  }
});
test("ST039-U03 canonical intent excludes credentials and rejects caller-owned security/stock fields", async () => {
  const { normalizeStocktakeCommand } = await schemas();
  const body = { source, expectedVersion: 2, reason: "  count reconciled  ", password: "first password" };
  const command = normalizeStocktakeCommand(request(body, "post"), "post");
  const other = normalizeStocktakeCommand(request({ ...body, password: "second password" }, "post"), "post");
  assert.deepEqual(command, other); assert.equal(command.source.lineId, ""); assert.equal(command.payload.reason, "count reconciled");
  assert.equal(command.authorization.requiredCallerPermission, "inventory.adjust");
  assert.ok(Object.isFrozen(command) && Object.isFrozen(command.payload)); assert.doesNotMatch(JSON.stringify(command), /password/u);
  for (const field of ["actor", "proof", "status", "snapshotQuantity", "varianceQuantity", "stocktakeId", "permission"]) {
    assert.throws(() => normalizeStocktakeCommand(request({ ...body, [field]: true }, "post"), "post"), { code: "INVENTORY_INPUT_INVALID" });
  }
  for (const reason of ["", "   ", "bad\u0000", "中".repeat(167)]) {
    assert.throws(() => normalizeStocktakeCommand(request({ ...body, reason }, "post"), "post"), { code: "INVENTORY_INPUT_INVALID" });
  }
  assert.throws(() => normalizeStocktakeCommand(request({ source, expectedVersion: 2, password: "secret" }, "start"), "start"), { code: "INVENTORY_INPUT_INVALID" });
});
test("ST039-U08 variance/progress predicates are typed, parameterized and preserve filtered/global separation", async () => {
  const header = { id: 41, status: "COUNTING", ready_at: null, started_at: 10 };
  for (const variance of ["GAIN", "LOSS", "ZERO"]) {
    const result = inquiry.stocktakeLineFilters({ binId: 9, skuId: 12, lotId: 5, stockStatus: "DAMAGED", progress: "NOT_FOUND", variance }, header);
    assert.deepEqual(result.params, [41, 9, 12, 5, "DAMAGED"]);
    assert.match(result.clause, /CAST\(l.snapshot_quantity AS SIGNED\)/u); assert.match(result.clause, /l.is_not_found=1/u);
  }
  for (const field of ["progress", "variance"]) {
    assert.throws(() => inquiry.stocktakeLineFilters({ [field]: ["ALL"] }, header), { code: "INVENTORY_INPUT_INVALID" });
  }
  const { normalizeStocktakeQuery } = await schemas();
  assert.deepEqual(normalizeStocktakeQuery({ variance: "GAIN", progress: "COUNTED", page: "2", pageSize: "1" }, "lines"),
    { variance: "GAIN", progress: "COUNTED", page: 2, pageSize: 1 });
  for (const query of [{ page: "01" }, { pageSize: "101" }, { variance: ["GAIN"] }, { binId: "1 OR 1=1" }, { actor: "7" }]) {
    assert.throws(() => normalizeStocktakeQuery(query, "lines"), { code: "INVENTORY_INPUT_INVALID" });
  }
});
test("ST039-U11 list paging/date validation uses EXISTS, bounds and one consistent read", async () => {
  const f = readFixture(); assert.equal(typeof f.service.listStocktakes, "function");
  const { normalizeStocktakeQuery } = await schemas();
  for (const query of [{ dateFrom: "2026-02-30" }, { dateFrom: "2026-10-13", dateTo: "2026-10-12" },
    { sortBy: "reason" }, { page: "9007199254740991", pageSize: "100" }]) {
    assert.throws(() => normalizeStocktakeQuery(query, "list"), { code: "INVENTORY_INPUT_INVALID" });
  }
  await f.service.listStocktakes({ binId: 1, page: 1, pageSize: 20, dateFrom: "2026-10-12", dateTo: "2026-10-12" });
  assert.equal(f.transactions(), 1); assert.ok(f.calls.every(call => !/JOIN inventory_stocktake_bins/u.test(call.sql)));
  assert.ok(f.calls.some(call => /EXISTS/u.test(call.sql)));
});
async function exporter() {
  const module = await import("../src/modules/inventory/InventoryStocktakeExportService.js").catch(error => {
    if (error.code === "ERR_MODULE_NOT_FOUND" && error.message.includes("InventoryStocktakeExportService.js")) return {};
    throw error;
  });
  assert.equal(typeof module.InventoryStocktakeExportService, "function"); return module;
}
function exportFixture({ size = 3, maxRows = 100000, failAudit = false, failQuery = false, delayedMetadata = false } = {}) {
  const header = { id: 41, stocktake_number: "=ST-41", warehouse_id: 1, status: "COUNTING", version: 2, started_at: 10, ready_at: null };
  const rowAt = i => ({ ...row, id: 201 + i, sku_name: '中,"name"\nline', counted_quantity: i === 0 ? null : i === 1 ? null : 3,
    is_not_found: i === 1 ? 1 : 0 });
  const scopes = [{ id: 101, stocktake_id: 41, bin_id: 1, bin_code_snapshot: "@OLD", bin_code: "NOW" },
    { id: 102, stocktake_id: 41, bin_id: 2, bin_code_snapshot: "EMPTY", bin_code: "EMPTY" }];
  const audits = [], calls = [], budget = { now: time.nowMs() };
  const database = { query() {}, withTransaction: async (work, options) => work({
    query: async (sql, params) => {
      calls.push({ sql, params, options });
      if (failQuery && sql.includes("inventory_stocktake_lines")) throw Object.assign(new Error("intended SQL fault"), { code: "DATABASE_QUERY_TIMEOUT" });
      if (sql.includes("FROM inventory_stocktakes")) { if (delayedMetadata) budget.now += 60001; return [[header]]; }
      if (sql.includes("COUNT(*)") && sql.includes("inventory_stocktake_bins")) return [[{ total: 2 }]];
      if (sql.includes("COUNT(*)") && sql.includes("inventory_stocktake_lines")) return [[{ totalLines: size, countedLines: Math.max(size - 2, 0),
        notFoundLines: size > 1 ? 1 : 0, uncountedLines: size > 0 ? 1 : 0, gainLines: 0, lossLines: Math.max(size - 1, 0), zeroLines: 0, corruptLines: 0 }]];
      if (sql.includes("inventory_stocktake_lines")) {
        const first = Math.max(0, params.at(-2) - 200), length = Math.max(0, Math.min(size - first, params.at(-1)));
        return [Array.from({ length }, (_, i) => rowAt(first + i))];
      }
      if (sql.includes("inventory_stocktake_bins")) return [scopes.filter(scope => scope.id > params.at(-2)).slice(0, params.at(-1))];
      throw new Error(`unexpected export query ${sql}`);
    }, execute: async (sql, params) => { assert.match(sql, /INSERT INTO inventory_audit_logs/u);
      if (failAudit) throw new Error("intended audit fault"); audits.push(params); return [{ affectedRows: 1 }]; }
  }) };
  const readers = { created: 0, closed: 0 };
  return { database, audits, calls, readers, createReader: () => { readers.created++; return { database, initialize: async () => database, close: async () => { readers.closed++; } }; },
    time: { nowMs: () => budget.now, fileDate: time.fileDate }, budget, config: { exportMaxRows: maxRows },
    options: { stocktakeId: 41, filters: {}, deadline: new Date(time.nowMs() + 120000).toISOString(), requestId: "unit039-export", ip: "",
      authorize: async () => ({ id: 7, username: "counter" }) } };
}
const ownedExportDirs = async () => (await fs.readdir(os.tmpdir())).filter(name => name.startsWith("inventory-stocktake-export-")).sort();
async function csvResult(f, changes = {}) {
  const { InventoryStocktakeExportService } = await exporter();
  const service = new InventoryStocktakeExportService({ database: f.database, logger: { error() {} }, time: f.time, config: f.config });
  service.createGenerationReader = f.createReader;
  const result = await service.prepare({ ...f.options, ...changes });
  const chunks = []; for await (const chunk of result.stream) chunks.push(chunk);
  return { ...result, rows: parse(Buffer.concat(chunks), { columns: true }) };
}
test("ST039-U12 every CSV text cell is formula-safe and quoted while signed numeric quantities remain numbers", async () => {
  const { stocktakeCsv } = await exporter(); assert.equal(typeof stocktakeCsv, "function");
  const { rows } = await csvResult(exportFixture());
  assert.ok(rows.every(row => row.stocktakeNumber === "'=ST-41"));
  assert.equal(rows[0].binCodeSnapshot, "'@OLD");
  const lines = rows.filter(row => row.recordType === "LINE");
  assert.equal(lines[2].skuNameCurrent, '中,"name"\nline'); assert.equal(lines[2].varianceQuantity, "-2");
  for (const text of ["=1", "+1", "-text", "@test", "\t1", "\r1"]) {
    const [parsed] = parse(stocktakeCsv([{ recordType: "LINE", skuNameCurrent: text }], true), { columns: true });
    assert.equal(parsed.skuNameCurrent, "'" + text);
  }
});
test("ST039-U13 CSV retains empty Bin scope, preview/null/notFound distinctions and explicit final summary", async () => {
  const before = await ownedExportDirs(), f = exportFixture(); const result = await csvResult(f);
  assert.deepEqual(result.rows.map(row => row.recordType), ["SCOPE", "SCOPE", "LINE", "LINE", "LINE", "SUMMARY"]);
  const lines = result.rows.filter(row => row.recordType === "LINE");
  assert.deepEqual(lines.map(row => [row.actualQuantity, row.varianceQuantity, row.countState]), [["", "", "UNCOUNTED"], ["0", "-5", "NOT_FOUND"], ["3", "-2", "COUNTED"]]);
  assert.equal(result.rows.at(-1).truncated, "false"); assert.equal(result.rows.at(-1).generationBudgetMs, "60000");
  assert.match(result.rows.at(-1).filterHash, /^[a-f0-9]{64}$/u); assert.equal(result.rows.at(-1).exportedRows, "5");
  assert.equal(f.audits[0][3], "inventory.export"); assert.equal(JSON.parse(f.audits[0][11]).rowCount, 5);
  assert.deepEqual(await ownedExportDirs(), before);
});
test("ST039-U14 keyset batches stay at most 500 and row-cap metadata never silently omits data", async () => {
  const full = await csvResult(exportFixture({ size: 1200 }));
  assert.equal(full.rows.filter(row => row.recordType === "LINE").length, 1200);
  assert.equal(new Set(full.rows.filter(row => row.recordType === "LINE").map(row => row.lineId)).size, 1200);
  const f = exportFixture({ size: 1200, maxRows: 503 }), result = await csvResult(f);
  assert.equal(result.truncated, true); assert.equal(result.truncationReason, "ROW_LIMIT"); assert.equal(result.rows.at(-1).exportedRows, "503");
  assert.ok(f.calls.filter(call => call.sql.includes("LIMIT ?")).every(call => call.params.at(-1) <= 500));
  const raised = exportFixture({ size: 100001, maxRows: 200000 }), hard = await csvResult(raised);
  assert.equal(hard.rows.at(-1).exportedRows, "100000"); assert.equal(hard.truncationReason, "ROW_LIMIT");
  assert.deepEqual(raised.readers, { created: 1, closed: 1 });
});
test("ST039-U15 half-remaining budget truncates deliberately; SQL/Audit faults and invalid deadline fail and clean up", async () => {
  const { InventoryStocktakeExportService } = await exporter(), requestSignal = new AbortController().signal;
  const requestContext = { signal: requestSignal, deadline: "original-deadline", databaseTransaction: null }, borrowed = { closes: 0 };
  const primary = { config: {}, withTransaction() { throw new Error("unit owner must not use primary transaction"); }, logger: { info() {}, error() {}, shutdown() { borrowed.closes++; } },
    context: { get: () => requestContext, update: values => Object.assign(requestContext, values), shutdown() { borrowed.closes++; } } };
  const managed = new InventoryStocktakeExportService({ database: primary, time, logger: primary.logger });
  let healthChecks = 0;
  mock.method(MySqlDatabaseService.prototype, "healthCheck", async function () { healthChecks++; assert.equal(this.services.require("logging").logger, primary.logger); return true; });
  let owner;
  try {
    const workSignal = AbortSignal.any([requestSignal, new AbortController().signal]);
    owner = managed.createGenerationReader(workSignal);
    assert.equal(typeof owner.initialize, "function", "reader must be initialized through its owning container");
    const database = await owner.initialize(); assert.ok(database instanceof MySqlDatabaseService);
    assert.equal(healthChecks, 1); assert.equal(database.services.require("context").get().signal, workSignal);
    assert.equal(requestContext.signal, requestSignal); assert.equal(requestContext.deadline, "original-deadline");
    assert.equal(database.config.connectionLimit, 1); assert.equal(database.config.queueLimit, 1);
    const close = owner.close(); assert.equal(owner.close(), close); await close;
    assert.equal(owner.closed, true); assert.equal(database.closed, true); assert.equal(borrowed.closes, 0);
  } finally { await owner?.close(); mock.restoreAll(); }
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  mock.method(MySqlDatabaseService.prototype, "healthCheck", async () => { entered(); await held; return true; });
  const cutoff = new AbortController(), reason = Object.assign(new Error("owned generation cutoff"), { code: "REQUEST_TIMEOUT" });
  owner = managed.createGenerationReader(cutoff.signal);
  const initializing = owner.initialize(); void initializing.catch(() => {});
  try {
    await started; cutoff.abort(reason); const close = owner.close(); assert.equal(owner.closed, false, "late initialization remains owned");
    release(); await assert.rejects(initializing, error => error === reason); await close;
    assert.equal(owner.closed, true); assert.equal(borrowed.closes, 0);
    await assert.rejects(owner.initialize(), error => error === reason);
  } finally { release(); await owner.close(); mock.restoreAll(); }
  const before = await ownedExportDirs(), f = exportFixture(); let checks = 0;
  // HD158 explicitly changes expiry during the auth await from salvage to fail-closed504.
  await assert.rejects(csvResult(f, { deadline: new Date(time.nowMs() + 80000).toISOString(), authorize: async () => {
    if (++checks === 3) f.budget.now += 40001; return { id: 7, username: "counter" }; } }), { code: "REQUEST_TIMEOUT", statusCode: 504 });
  await assert.rejects(csvResult(exportFixture({ size: 0, delayedMetadata: true })), { code: "REQUEST_TIMEOUT", statusCode: 504 });
  for (const options of [{ failAudit: true }, { failQuery: true }]) await assert.rejects(csvResult(exportFixture(options)));
  await assert.rejects(csvResult(exportFixture(), { deadline: "invalid" }), { code: "INVENTORY_INPUT_INVALID" });
  for (const method of ["chmod", "lstat", "fileStat"]) {
    const intended = Object.assign(new Error(`intended ${method} fault`), { code: "EIO" });
    if (method === "fileStat") {
      const open = fs.open.bind(fs);
      mock.method(fs, "open", async (...args) => {
        const handle = await open(...args), stat = handle.stat.bind(handle); let first = true;
        handle.stat = async () => { if (first) { first = false; throw intended; } return stat(); }; return handle;
      });
    } else mock.method(fs, method, async () => { throw intended; }, { times: 1 });
    try { await assert.rejects(csvResult(exportFixture()), error => error === intended); }
    finally { mock.restoreAll(); }
    assert.deepEqual(await ownedExportDirs(), before);
  }
  assert.deepEqual(await ownedExportDirs(), before);
});
test("ST039-U16 current authority is rechecked on generation/delivery; abort stops disclosure and removes owned files", async () => {
  const before = await ownedExportDirs(), f = exportFixture(), { InventoryStocktakeExportService } = await exporter();
  assert.equal(typeof InventoryStocktakeExportService.prototype.createGenerationReader, "function");
  const service = new InventoryStocktakeExportService({ database: f.database, logger: { error() {} }, time: f.time, config: f.config });
  let revoked = false;
  service.createGenerationReader = f.createReader;
  const result = await service.prepare({ ...f.options, authorize: async () => {
    if (revoked) throw Object.assign(new Error("revoked"), { code: "PERMISSION_STALE" }); return { id: 7, username: "counter" }; } });
  revoked = true; await assert.rejects(async () => { for await (const chunk of result.stream) assert.fail(`disclosed ${chunk.length} bytes`); }, { code: "PERMISSION_STALE" });
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await assert.rejects(csvResult(exportFixture(), { signal: controller.signal }));
  const held = exportFixture(), generator = new InventoryStocktakeExportService({ database: held.database, logger: { error() {} }, time: held.time, config: held.config });
  let beganClose, finishClose; const closing = new Promise(resolve => { beganClose = resolve; }), terminal = new Promise(resolve => { finishClose = resolve; });
  generator.createGenerationReader = () => ({ database: held.database, initialize: async () => held.database, close: async () => { beganClose(); await terminal; } });
  const preparing = generator.prepare(held.options); await closing;
  const duringClose = await ownedExportDirs();
  await assert.rejects(generator.prepare(held.options), { code: "INVENTORY_DEPENDENCY_UNAVAILABLE", statusCode: 503 });
  assert.deepEqual(await ownedExportDirs(), duringClose);
  finishClose(); const prepared = await preparing; for await (const chunk of prepared.stream) assert.ok(chunk.length);
  await csvResult(held); assert.deepEqual(held.readers, { created: 1, closed: 1 });
  assert.deepEqual(await ownedExportDirs(), before);
});
async function handlers() {
  const module = await import("../src/handlers/inventory/stocktakeHandlers.js").catch(error => {
    if (error.code === "ERR_MODULE_NOT_FOUND" && error.message.includes("stocktakeHandlers.js")) return {};
    throw error;
  });
  assert.equal(typeof module.StartInventoryStocktakeHandler, "function"); return module;
}
function handlerServices() {
  let tokenVersion = 0;
  const executions = [], logs = [], db = { query() {}, withTransaction: async work => work({
    query: async sql => {
      if (sql.includes("FROM users")) return [[{ username: "counter" }]];
      if (sql.includes("FROM roles")) return [[{ name: "counter" }]];
      if (sql.includes("FROM permissions")) return [["inventory.view", "inventory.operation", "inventory.adjust"].map(name => ({ name }))];
      if (sql.includes("FROM fr_token_versions")) return [[{ version: tokenVersion }]];
      throw new Error(`unexpected handler auth ${sql}`);
    }, execute: async (_sql, params) => { logs.push(params); return [{ affectedRows: 1 }]; }
  }) };
  const values = { mysqldatabase: db, time, logging: { logger: { error() {} } },
    jwt: { sessionMaxAgeSeconds: 3600, config: { jwt: { clockToleranceSeconds: 0 } } },
    deviceBinding: { config: { deviceBinding: { signatureMaxSkewSeconds: 60 } } } };
  return { services: { config: { inventory: {} }, require: key => values[key], get: key => values[key] ?? null },
    revoke: () => { tokenVersion = 1; }, executions, logs };
}
test("ST039-U01 twelve route schemas compile and startup with fixed auth and default receive timeout", async () => {
  const module = await handlers(), f = handlerServices();
  const registry = Object.fromEntries(Object.values(module).filter(type => typeof type === "function" && type.api).map(type => [type.handlerName, new type(f.services)]));
  assert.equal(Object.keys(registry).length, 12);
  const routes = resolveApiDefinitions(registry, { ...apiConfig.defaults, version: apiConfig.versioning.defaultVersion }), input = new RequestValidator(), output = new ResponseValidator();
  for (const route of routes) {
    input.compile(route.requestSchema, route.path, { coerceTypes: false }); output.compile(route.responseSchema, route.path);
    if (route.method === "POST") { assert.equal(route.idempotency.ttlMs, 604800000); assert.equal(route.idempotencyPreparation, true); }
  }
  const exportRoute = routes.find(route => route.path.endsWith("/export"));
  assert.equal(exportRoute.timeoutMs, 120000);
  assert.doesNotThrow(() => validateApiConfig(routes, registry, new Map(["jwt", "jwt-password", "jwt-device-password"].map(name => [name, {}])), 30000,
    undefined, undefined, { pendingLeaseMs: 120000, routeOptions() {} }, 120000));
  assert.equal(routes.find(route => route.path.endsWith("/post")).authType, "jwt-device-password");
  assert.equal(routes.find(route => route.path.endsWith("/cancel")).authType, "jwt-password");
});
test("ST039-U05 ordinary cached replay locks current authority, sends once, and rejects post-wait token revocation", async () => {
  const { StartInventoryStocktakeHandler } = await handlers(), f = handlerServices(), handler = new StartInventoryStocktakeHandler(f.services);
  const req = request({ source, expectedVersion: 2 }, "start");
  const prepared = await handler.prepareIdempotency(req); let sends = 0;
  await prepared.replay(() => { sends++; }); assert.equal(sends, 1);
  const next = request({ source, expectedVersion: 2 }, "start"), rejected = await handler.prepareIdempotency(next);
  f.revoke(); await assert.rejects(rejected.replay(() => { sends++; }), { code: "JWT_INVALID" }); assert.equal(sends, 1);
  assert.doesNotMatch(JSON.stringify(prepared.input), /password|claims|proof/u);
});
test("ST039-U17 unchanged domain scalar receipts, including Add line identity, are never reconstructed from current rows", async () => {
  const { AddInventoryStocktakeLineHandler } = await handlers(), f = handlerServices(), handler = new AddInventoryStocktakeLineHandler(f.services);
  const original = { id: 201, stocktakeId: 41, operationId: 21, status: "COUNTING", version: 1, rowCount: 1 };
  handler.inventory.addLineInTransaction = async () => original;
  const req = request({ source, binId: 1, skuId: 12, lotId: null, stockStatus: "AVAILABLE" }, "add_line");
  await handler.prepareIdempotency(req); const response = await handler.execute(req); assert.deepEqual(response.data, original);
  for (const code of ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]) {
    const next = request({ source, binId: 1, skuId: 12, lotId: null, stockStatus: "AVAILABLE" }, "add_line");
    await handler.prepareIdempotency(next);
    handler.inventory.addLineInTransaction = async () => { throw Object.assign(new Error("wrapped DB fault"), { cause: { code } }); };
    await assert.rejects(handler.execute(next), { code: "CONCURRENT_OPERATION", statusCode: 409 });
  }
  const next = request({ source, binId: 1, skuId: 12, lotId: null, stockStatus: "AVAILABLE" }, "add_line");
  await handler.prepareIdempotency(next);
  const unknown = Object.assign(new Error("unknown commit outcome"), { code: "TRANSACTION_OUTCOME_UNKNOWN" });
  handler.inventory.addLineInTransaction = async () => { throw unknown; };
  await assert.rejects(handler.execute(next), error => error === unknown);
});
test("ST039-U18 old Stocktake services and shared high-risk actions remain pinned and discoverable without collision", async () => {
  const module = await handlers(); assert.ok(Object.values(module).some(type => type?.api?.path === "/api/v1/inventory/stocktakes/:id/ready"));
  const old = await import("../src/handlers/inventory/postingHandlers.js");
  assert.equal(old.PostInventoryAdjustmentHandler.api.authType, "jwt-device-password");
  assert.equal(old.ReverseInventoryMovementHandler.api.path, "/api/v1/inventory/movements/:id/reverse");
  const { InventoryStocktakeService } = await import("../src/modules/inventory/InventoryStocktakeService.js");
  assert.equal(typeof InventoryStocktakeService.prototype.cancelDraft, "function");
});
