import assert from "node:assert/strict";
import test from "node:test";
import { InventoryStocktakeService } from "../src/modules/inventory/InventoryStocktakeService.js";
import { InventoryAuditService } from "../src/modules/inventory/InventoryAuditService.js";
import { issueInventoryHighRiskContext } from "../src/modules/inventory/inventoryHighRiskContext.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const NOW = 1791763200000;
const permissions = ["inventory.view", "inventory.adjust"];
const binding = { id: 5, user_id: 7, device_id: "a".repeat(64), public_key: Buffer.from("synthetic-public-key"), status: "approved" };
let event = 0;
function request(reason = "physical reconciliation") {
  return inventoryCommandFixture({ actor: { claimedRoles: ["counter"], claimedPermissions: permissions },
    authorization: { purpose: "stocktake.post", requiredCallerPermission: "inventory.adjust" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "unit-PB", eventId: `post-${++event}` },
    payload: { stocktakeId: 41, expectedVersion: 3, reason } });
}
// Trusted executor fixtures use the real sealed issuer, not HTTP or signature verification.
function proof(input, time) {
  const now = time.nowMs();
  return issueInventoryHighRiskContext({ method: "POST", apiRoute: { authType: "jwt-device-password", path: "/api/v1/inventory/stocktakes/:id/post" },
    input: { params: { id: "41" } }, get: () => String(now),
    auth: { type: "jwt-device-password", deviceBinding: binding, claims: { sub: "7", did: binding.device_id,
      roles: ["counter"], permissions, ver: 0, exp: now / 1000 + 900, auth_time: now / 1000 } } }, input,
  { time, signatureMaxSkewSeconds: 60, sessionMaxAgeSeconds: 3600, clockToleranceSeconds: 0 });
}
function data(size, { zero = false, newEvery = 0, statuses = false } = {}) {
  const lines = [], balances = [], controls = [];
  for (let i = 0; i < size; i++) {
    const fresh = newEvery > 0 && i % newEvery === 0, before = fresh ? 0 : 4;
    const row = { id: 201 + i, stocktake_id: 41, stocktake_bin_id: 101, bin_id: 1, sku_id: 12 + i,
      lot_id: null, stock_status: statuses ? ["AVAILABLE", "DAMAGED", "QUARANTINED"][i % 3] : "AVAILABLE",
      stock_balance_id: fresh ? null : 301 + i, snapshot_quantity: before, snapshot_balance_version: fresh ? 0 : 1,
      counted_quantity: zero ? before : 7, is_not_found: 0, variance_quantity: zero ? 0 : 7 - before, version: 2, movement_id: null };
    lines.push(row); controls.push({ warehouse_id: 1, sku_id: row.sku_id, reserved_quantity: 0 });
    if (!fresh) balances.push({ id: row.stock_balance_id, warehouse_id: 1, bin_id: 1, sku_id: row.sku_id,
      lot_id: null, lot_scope: 0, stock_status: row.stock_status, on_hand_quantity: before, allocated_quantity: 0,
      version: 1, fifo_anchor_date: "2026-01-01", expiry_date: null });
  }
  return { headers: [{ id: 41, warehouse_id: 1, stocktake_number: "ST-41", status: "READY_TO_POST", version: 3, reason: "" }],
    scopes: [{ id: 101, stocktake_id: 41, bin_id: 1 }], lines, balances, controls, lots: [], operations: [], audits: [], movements: [],
    locks: [{ id: 81, stocktake_id: 41, stocktake_bin_id: 101, bin_id: 1, released_at: null, lock_type: "STOCKTAKE" },
      { id: 82, stocktake_id: 42, stocktake_bin_id: 102, bin_id: 2, released_at: null, lock_type: "STOCKTAKE" }] };
}
function order(a, b) {
  return Number(a.warehouse_id) - Number(b.warehouse_id) || Number(a.sku_id) - Number(b.sku_id) ||
    Number(a.bin_id) - Number(b.bin_id) || Number(a.lot_scope) - Number(b.lot_scope) || String(a.stock_status).localeCompare(String(b.stock_status));
}

// SQL boundary oracle, not a second Post implementation. It evaluates parameterized
// INSERT/UPDATE expressions against rows, including every WHERE/CAS predicate.
function sqlParser(sql, params) {
  const tokens = sql.match(/'(?:''|[^'])*'|<=>|>=|<=|<>|!=|[(),?=+><]|[0-9]+|[A-Za-z_][A-Za-z_0-9.]*/gu) ?? [];
  let at = 0, bind = 0;
  const peek = value => tokens[at]?.toUpperCase() === value;
  const take = value => { assert.ok(peek(value), `SQL oracle expected ${value}, got ${tokens[at]} in ${sql}`); at++; };
  const same = (a, b) => a == null || b == null ? a == null && b == null : String(a) === String(b);
  function atom() {
    if (peek("(")) {
      at++; const values = [expression()]; while (peek(",")) { at++; values.push(expression()); } take(")");
      return values.length === 1 ? values[0] : row => values.map(value => value(row));
    }
    if (peek("CASE")) {
      at++; const base = peek("WHEN") ? null : expression(); const cases = [];
      while (peek("WHEN")) { at++; const condition = expression(); take("THEN"); cases.push([condition, expression()]); }
      let fallback = () => null;
      if (peek("ELSE")) { at++; fallback = expression(); }
      take("END");
      return row => { for (const [condition, value] of cases) if (base ? same(base(row), condition(row)) : condition(row)) return value(row); return fallback(row); };
    }
    const token = tokens[at++];
    assert.notEqual(token, undefined, `Incomplete SQL expression: ${sql}`);
    if (token === "?") { const value = params[bind++]; return () => value; }
    if (token.toUpperCase() === "NULL") return () => null;
    if (token.startsWith("'")) return () => token.slice(1, -1).replaceAll("''", "'");
    if (/^[0-9]+$/u.test(token)) return () => Number(token);
    return row => row[token.split(".").at(-1)];
  }
  function expression(min = 0) {
    let left = atom();
    const precedence = { OR: 1, AND: 2, "=": 3, "<=>": 3, ">": 3, "<": 3, ">=": 3, "<=": 3, "!=": 3, "<>": 3, IS: 3, IN: 3, "+": 4 };
    while ((precedence[tokens[at]?.toUpperCase()] ?? -1) >= min) {
      const operator = tokens[at++].toUpperCase(), before = left;
      if (operator === "IS") { const not = peek("NOT"); if (not) at++; take("NULL"); left = row => not ? before(row) != null : before(row) == null; continue; }
      if (operator === "IN") {
        take("("); const values = [expression()]; while (peek(",")) { at++; values.push(expression()); } take(")");
        left = row => values.some(value => same(before(row), value(row))); continue;
      }
      const right = expression(precedence[operator] + 1);
      left = row => {
        const a = before(row), b = right(row);
        if (operator === "AND") return Boolean(a && b);
        if (operator === "OR") return Boolean(a || b);
        if (operator === "+") return Number(a) + Number(b);
        if (["=", "<=>"].includes(operator)) return same(a, b);
        if (["!=", "<>"].includes(operator)) return !same(a, b);
        if (operator === ">") return a > b;
        if (operator === "<") return a < b;
        if (operator === ">=") return a >= b;
        return a <= b;
      };
    }
    return left;
  }
  return { expression, peek, take, get token() { return tokens[at]; }, advance() { return tokens[at++]; },
    finish() { assert.equal(at, tokens.length, `Unconsumed SQL: ${tokens.slice(at).join(" ")}`); assert.equal(bind, params.length, "All SQL bindings must be consumed"); } };
}
function insertRows(sql, params) {
  const match = /INSERT\s+INTO\s+\w+\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+)$/iu.exec(sql);
  assert.ok(match, `Unrecognized INSERT: ${sql}`);
  const columns = match[1].split(",").map(value => value.trim()), parser = sqlParser(match[2], params), rows = [];
  do {
    if (rows.length) parser.take(",");
    parser.take("("); const row = {};
    columns.forEach((column, i) => { if (i) parser.take(","); row[column] = parser.expression()({}); });
    parser.take(")"); rows.push(row);
  } while (parser.peek(","));
  parser.finish(); return rows;
}
function updateRows(sql, params, rows, short = false) {
  const match = /\bSET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/iu.exec(sql);
  assert.ok(match, `UPDATE must have WHERE: ${sql}`);
  const parser = sqlParser(`${match[1]} WHERE ${match[2]}`, params), assignments = [];
  do {
    if (assignments.length) parser.take(",");
    const column = parser.advance().split(".").at(-1); parser.take("="); assignments.push([column, parser.expression()]);
  } while (parser.peek(","));
  parser.take("WHERE"); const predicate = parser.expression(); parser.finish();
  const targets = rows.filter(predicate), applied = short ? targets.slice(0, -1) : targets;
  for (const row of applied) { const original = { ...row }; for (const [column, value] of assignments) row[column] = value(original); }
  return applied.length;
}
function selectRows(sql, params, rows) {
  const match = /\bWHERE\s+([\s\S]+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+FOR\s+(?:UPDATE|SHARE)|$)/iu.exec(sql);
  assert.ok(match, `SELECT must have WHERE: ${sql}`);
  const parser = sqlParser(match[1], params), predicate = parser.expression(); parser.finish();
  return rows.filter(predicate);
}
const tableState = { inventory_stocktakes: "headers", inventory_stocktake_bins: "scopes", inventory_stocktake_lines: "lines",
  inventory_stock_balances: "balances", inventory_lots: "lots", inventory_movements: "movements", inventory_operation_requests: "operations",
  inventory_audit_logs: "audits", inventory_bin_locks: "locks" };
function fixture(initial = data(101), options = {}) {
  const clock = { now: NOW, date: "2026-10-12", nowMs() { return this.now; }, fileDate() { return this.date; } };
  const stats = { transactions: 0, commits: 0, rollbacks: 0, profiles: [], balanceWrites: 0, lineWrites: 0, auditWrites: 0, movementReads: 0,
    availableReads: [], inserted: [] };
  let balanceSequence = 10000, movementSequence = 20000;
  const database = createFakeInventoryDatabase({ initialState: initial,
    query: async ({ sql, params, state }) => {
      options.onQuery?.({ sql, params, state, clock });
      if (sql.includes("FROM users")) return [[{ id: 7, username: "synthetic", status: "active" }]];
      if (sql.includes("FROM user_roles")) return [[{ role_id: 1, name: "counter" }]];
      if (sql.includes("FROM role_permissions")) return [(options.permissions ?? permissions).map(name => ({ name }))];
      if (sql.includes("FROM user_devices")) return [[{ ...binding, ...options.device }]];
      if (sql.includes("FROM fr_token_versions")) return [[{ version: options.tokenVersion ?? 0 }]];
      const table = /\bFROM\s+(\w+)/iu.exec(sql)?.[1], key = tableState[table];
      assert.ok(key, `Unknown query table: ${sql}`);
      let source = state[key];
      if (key === "balances" && /LEFT\s+JOIN\s+inventory_lots/iu.test(sql)) {
        assert.match(sql, /FOR\s+SHARE/iu); assert.match(sql, /ORDER\s+BY\s+b\.warehouse_id\s*,\s*b\.sku_id\s*,\s*b\.bin_id\s*,\s*b\.lot_scope\s*,\s*b\.stock_status/iu);
        const skus = params.slice(1); stats.availableReads.push([...skus]);
        source = source.map(row => ({ ...row, expiry_date: row.lot_id == null ? null : state.lots.find(lot => Number(lot.id) === Number(row.lot_id))?.expiry_date ?? row.expiry_date }));
      }
      let rows = selectRows(sql, params, source).sort(key === "balances" ? order : (a, b) => Number(a.id) - Number(b.id));
      if (key === "balances" && /LEFT\s+JOIN/iu.test(sql)) rows = options.availableRows?.(rows, params.slice(1)) ?? rows;
      if (key === "lines" && /FOR\s+UPDATE/iu.test(sql)) rows = options.currentLines?.(rows) ?? rows;
      if (key === "scopes" && /FOR\s+UPDATE/iu.test(sql)) rows = options.currentScopes?.(rows) ?? rows;
      if (key === "balances" && !/FOR\s+UPDATE|LEFT\s+JOIN/iu.test(sql)) rows = options.balanceReadback?.(rows) ?? rows;
      if (key === "movements") {
        stats.movementReads++; assert.match(sql, /operation_request_id\s*=\s*\?/iu); assert.match(sql, /\bid\s*>\s*\?/iu);
        assert.match(sql, /ORDER\s+BY\s+id\s+LIMIT\s+101/iu); assert.equal(params[0], 21);
        rows = rows.slice(0, 101); rows = options.movementReadback?.(rows, stats.movementReads) ?? rows;
      }
      return [structuredClone(rows)];
    },
    execute: async ({ sql, params, state }) => {
      options.onExecute?.({ sql, params, state, clock });
      const table = /(?:INSERT\s+INTO|UPDATE)\s+(\w+)/iu.exec(sql)?.[1], key = tableState[table];
      assert.ok(key, `Unknown write table: ${sql}`);
      if (/^\s*INSERT/iu.test(sql)) {
        const rows = insertRows(sql, params); stats.inserted.push({ key, count: rows.length });
        if (key === "operations") {
          const fields = ["source_module", "source_document_type", "source_document_id", "source_line_id", "source_event_id"];
          if (state.operations.some(row => fields.every(field => row[field] === rows[0][field]))) throw Object.assign(new Error("duplicate source"), { code: "ER_DUP_ENTRY" });
          rows[0].id = 21; rows[0].completed_at = null;
        }
        if (key === "audits" && ++stats.auditWrites === options.failAuditAt) throw options.auditError;
        for (const [i, row] of rows.entries()) {
          if (key === "balances") { row.id = balanceSequence + (rows.length - i) * 7; row.lot_scope = row.lot_id ?? 0; }
          if (key === "movements") row.id = movementSequence + (rows.length - i) * 11;
        }
        if (key === "balances") balanceSequence += rows.length * 7 + 100;
        if (key === "movements") movementSequence += rows.length * 11 + 100;
        state[key].push(...rows); return [{ affectedRows: rows.length, insertId: rows[0]?.id ?? 0 }];
      }
      let short = false;
      if (key === "balances") short = ++stats.balanceWrites === options.shortBalanceAt;
      if (key === "lines") short = ++stats.lineWrites === options.shortLineAt;
      return [{ affectedRows: updateRows(sql, params, state[key], short) }];
    } });
  const originalTransaction = database.withTransaction.bind(database);
  database.withTransaction = async work => {
    stats.transactions++;
    try { const result = await originalTransaction(work); stats.commits++; return result; }
    catch (error) { stats.rollbacks++; throw error; }
  };
  const locks = { lockForCommand: async (tx, input) => ({ warehouses: [{ id: 1, warehouse_code: "W1", status: "ACTIVE" }],
    bins: input.binIds.map(id => ({ id, warehouse_id: 1, status: "ACTIVE", bin_code: `B${id}` })),
    stockControls: structuredClone(tx.state.controls), binLocks: structuredClone(tx.state.locks) }) };
  const itemLookup = { getInventoryProfileInTransaction: async (_tx, skuId) => {
    stats.profiles.push(skuId);
    return { skuId, skuCode: `SKU${skuId}`, skuName: options.skuName ?? "synthetic", inventoryTracked: true, usable: true,
      trackingPolicy: initial.lots.some(lot => Number(lot.sku_id) === skuId) ? "batch_expiry" : "none",
      minimumSaleLifeDays: options.minimumSaleLifeDays ?? 0, baseUom: { uomId: 1, uomCode: "EA" }, ...options.profile };
  } };
  const logger = { error() {} }, audit = new InventoryAuditService({ database, logger, time: clock });
  const inventoryProfileLookupFactory = tx => ({ async findManyByIds(ids) {
    const result = new Map();
    for (const skuId of ids) {
      const profile = await itemLookup.getInventoryProfileInTransaction(tx, skuId);
      result.set(skuId, { ...profile, uoms: [{ ...profile.baseUom, isBase: true, toBaseFactor: 1 }] });
    }
    return result;
  } });
  return { database, stats, options, clock, initial: structuredClone(initial), audit,
    service: new InventoryStocktakeService({ database, time: clock, logger, locks, itemLookup, audit, inventoryProfileLookupFactory }) };
}
async function post(f, input = request()) { return f.service.post(input, proof(input, f.clock)); }
async function unchanged(f, code, input = request()) {
  const before = f.database.state;
  await assert.rejects(post(f, input), typeof code === "string" ? { code } : error => error === code);
  assert.deepEqual(f.database.state, before, "Every caller-owned table must roll back");
  assert.equal(f.stats.commits, 0); assert.equal(f.stats.transactions, 1); assert.equal(f.stats.rollbacks, 1);
}
function ownEffects(f, receipt, input) {
  const state = f.database.state, changed = f.initial.lines.filter(row => row.stocktake_id === 41 && row.variance_quantity !== 0), movements = state.movements.filter(row => Number(row.operation_request_id) === receipt.operationId);
  assert.deepEqual(receipt, { id: 41, operationId: 21, status: "POSTED", version: 4, rowCount: changed.length,
    movementGroupId: changed.length ? receipt.movementGroupId : null });
  if (changed.length) assert.match(receipt.movementGroupId, /^[0-9a-f-]{36}$/u);
  assert.equal(movements.length, changed.length); assert.equal(new Set(movements.map(row => row.id)).size, changed.length);
  assert.deepEqual(movements.map(row => row.stocktake_line_id), changed.map(row => row.id).sort((a, b) => a - b), "Original line order must survive expiry and ID ordering");
  const ownAudits = state.audits.filter(row => Number(row.operation_request_id) === receipt.operationId);
  assert.equal(ownAudits.length, changed.length + 1);
  for (const original of changed) {
    const row = state.lines.find(row => row.id === original.id), movement = movements.find(row => row.id === state.lines.find(line => line.id === original.id).movement_id);
    assert.ok(movement, `Line ${original.id} must reference an actual Movement ID`);
    assert.deepEqual([movement.stocktake_id, movement.stocktake_line_id, movement.operation_request_id, movement.movement_group_id,
      movement.warehouse_id, movement.bin_id, movement.sku_id, movement.lot_id, movement.stock_status],
    [41, original.id, 21, receipt.movementGroupId, 1, original.bin_id, original.sku_id, original.lot_id, original.stock_status]);
    assert.deepEqual([movement.movement_type, movement.location_kind, movement.direction, movement.quantity, movement.balance_before, movement.balance_after,
      movement.balance_version_after, movement.reason_text, movement.posted_by, movement.posted_by_label],
    ["STOCKTAKE_VARIANCE", "BIN", original.variance_quantity > 0 ? "IN" : "OUT", Math.abs(original.variance_quantity), original.snapshot_quantity,
      original.counted_quantity, original.snapshot_balance_version ? original.snapshot_balance_version + 1 : 2, input.payload.reason, 7, "synthetic"]);
    assert.equal(row.stock_balance_id, original.stock_balance_id, "Post must retain the original snapshot FK, including NULL");
    assert.equal(row.version, original.version + 1);
    const balance = state.balances.find(balance => balance.warehouse_id === 1 && balance.bin_id === original.bin_id && balance.sku_id === original.sku_id &&
      Number(balance.lot_scope) === Number(original.lot_id ?? 0) && balance.stock_status === original.stock_status);
    assert.ok(balance); assert.equal(balance.on_hand_quantity, original.counted_quantity); assert.equal(balance.version, original.snapshot_balance_version ? original.snapshot_balance_version + 1 : 2);
    const oldBalance = f.initial.balances.find(row => row.id === original.stock_balance_id);
    assert.equal(balance.allocated_quantity, oldBalance?.allocated_quantity ?? 0);
    const audit = ownAudits.find(row => JSON.parse(row.after_summary).id === original.id);
    assert.ok(audit, "Each changed leg needs its own scalar success Audit");
    assert.deepEqual(JSON.parse(audit.before_summary), { id: original.id, stocktakeId: 41, quantity: original.snapshot_quantity,
      version: original.snapshot_balance_version || 1, status: original.stock_status, movementId: null });
    assert.deepEqual(JSON.parse(audit.after_summary), { id: original.id, stocktakeId: 41, quantity: original.counted_quantity,
      version: (original.snapshot_balance_version || 1) + 1, status: original.stock_status, movementId: movement.id });
    assert.deepEqual([audit.action, audit.target_type, audit.target_id, audit.target_label, audit.outcome, audit.actor_user_id, audit.actor_label,
      audit.operation_request_id, audit.request_id, audit.correlation_id], ["stocktake.post", "stocktake", 41, "ST-41", "SUCCEEDED", 7, "synthetic", 21, input.correlationId, input.correlationId]);
    assert.equal(audit.occurred_at, NOW); assert.equal(movement.posted_at, NOW);
  }
  const header = state.headers.find(row => row.id === 41), operation = state.operations.find(row => row.id === 21);
  assert.deepEqual([header.status, header.version, header.post_operation_id, operation.actor_user_id], ["POSTED", 4, 21, 7]);
  assert.deepEqual(JSON.parse(operation.result_summary), receipt);
  assert.deepEqual(JSON.parse(ownAudits.at(-1).before_summary), { stocktakeId: 41, status: "READY_TO_POST", version: 3 });
  assert.deepEqual(JSON.parse(ownAudits.at(-1).after_summary), { stocktakeId: 41, status: "POSTED", version: 4, rowCount: changed.length });
  for (const lock of f.initial.locks) {
    const actual = state.locks.find(row => row.id === lock.id);
    if (lock.stocktake_id === 41) assert.deepEqual([actual.release_reason, actual.released_at, actual.released_by], ["POSTED", NOW, 7]);
    else assert.deepEqual(actual, lock, "Foreign locks cannot be released");
  }
  const changedBalanceIds = new Set(changed.map(row => row.stock_balance_id));
  for (const row of f.initial.balances.filter(row => !changedBalanceIds.has(row.id))) assert.deepEqual(state.balances.find(actual => actual.id === row.id), row);
  for (const key of ["headers", "lines", "movements", "operations", "audits"]) {
    for (const row of f.initial[key].filter(row => key === "headers" ? row.id !== 41 : key === "lines" ? row.stocktake_id !== 41 : true)) {
      assert.deepEqual(state[key].find(actual => actual.id === row.id), row, `Foreign ${key} owner must stay unchanged`);
    }
  }
  assert.deepEqual(state.controls, f.initial.controls); assert.deepEqual(state.lots, f.initial.lots);
  assert.deepEqual(f.stats.profiles, [...new Set(f.initial.lines.filter(row => row.stocktake_id === 41).map(row => row.sku_id))].sort((a, b) => a - b));
  assert.equal(f.stats.transactions, 1); assert.equal(f.stats.commits, 1);
}
function writes(f, table) { return f.database.calls.filter(call => call.method === "execute" && call.sql.includes(table)); }
function insertSizes(f, key) { return f.stats.inserted.filter(row => row.key === key).map(row => row.count); }
function change(row, actual) { Object.assign(row, { counted_quantity: actual, variance_quantity: actual - row.snapshot_quantity }); }

test("ST041-PB01 100 changed legs retain the original single-row SQL, complete scalar receipt and replay", async () => {
  const f = fixture(data(100)), input = request(), result = await post(f, input); ownEffects(f, result, input);
  assert.deepEqual(insertSizes(f, "movements"), Array(100).fill(1));
  assert.equal(f.stats.balanceWrites, 100); assert.equal(f.stats.lineWrites, 100); assert.equal(f.stats.auditWrites, 101);
  assert.equal(f.stats.movementReads, 0); assert.equal(writes(f, "inventory_stock_balances").some(row => /CASE/iu.test(row.sql)), false);
  assert.deepEqual(f.stats.availableReads, Array.from({ length: 100 }, (_, i) => [12 + i]));
  const after = f.database.state; assert.deepEqual(await post(f, input), result); assert.deepEqual(f.database.state, after);
});

test("ST041-PB02 101 changed legs and SKUs cross both 100-row boundaries with one Audit per leg", async () => {
  const initial = data(101);
  for (const i of [0, 50, 100]) { initial.lines[i].snapshot_balance_version = 3 + i; initial.balances[i].version = 3 + i; initial.lines[i].version = 7 + i; }
  const f = fixture(initial), input = request(), result = await post(f, input); ownEffects(f, result, input);
  assert.deepEqual(insertSizes(f, "movements"), [100, 1]); assert.deepEqual(insertSizes(f, "audits"), [100, 1, 1]);
  assert.deepEqual(f.stats.availableReads.map(row => row.length), [100, 1]);
  assert.equal(f.stats.balanceWrites, 2); assert.equal(f.stats.lineWrites, 2); assert.equal(f.stats.movementReads, 2);
  for (const call of [...writes(f, "UPDATE inventory_stock_balances"), ...writes(f, "UPDATE inventory_stocktake_lines")]) assert.match(call.sql, /CASE/iu);
});

test("ST041-PB03 201 mixed existing and off-book NULL-Lot three-status legs finish all three chunks", async () => {
  const f = fixture(data(201, { newEvery: 2, statuses: true })), input = request(), result = await post(f, input); ownEffects(f, result, input);
  assert.deepEqual(insertSizes(f, "movements"), [100, 100, 1]); assert.deepEqual(insertSizes(f, "audits"), [100, 100, 1, 1]);
  assert.deepEqual(insertSizes(f, "balances"), [50, 50, 1]);
  assert.equal(f.database.state.balances.length, 201);
  assert.ok(f.database.state.balances.every(row => row.lot_id === null && row.lot_scope === 0));
  assert.ok(f.database.state.balances.filter(row => row.id >= 10000).every(row => row.fifo_anchor_date === "2026-10-12"));
});

test("ST041-PB04 sparse IDs assigned in reverse line order map actual new Balance and Movement owners", async () => {
  const initial = data(101, { newEvery: 1 });
  initial.headers.push({ id: 42, warehouse_id: 2, status: "READY_TO_POST", version: 6 });
  initial.lines.push({ ...initial.lines[0], id: 99001, stocktake_id: 42, stocktake_bin_id: 102, bin_id: 2, sku_id: 9999 });
  initial.balances.push({ id: 99002, warehouse_id: 2, bin_id: 2, sku_id: 9999, lot_id: null, lot_scope: 0, stock_status: "AVAILABLE", on_hand_quantity: 15, allocated_quantity: 3, version: 9 });
  initial.movements.push({ id: 99003, operation_request_id: 999, stocktake_id: 42, stocktake_line_id: 99001 });
  initial.operations.push({ id: 999, source_module: "FOREIGN", completed_at: NOW - 1 });
  initial.audits.push({ id: 99004, operation_request_id: 999, after_summary: "{}" });
  const f = fixture(initial), input = request(), result = await post(f, input); ownEffects(f, result, input);
  const state = f.database.state;
  const movements = state.movements.filter(row => row.operation_request_id === 21), balances = state.balances.filter(row => row.warehouse_id === 1);
  assert.ok(movements[0].id > movements[1].id); assert.notEqual(movements[0].id + 1, movements[1].id);
  assert.ok(balances[0].id > balances[1].id); assert.notEqual(balances[0].id + 1, balances[1].id);
  assert.equal(f.stats.movementReads, 2, "Post must read actual IDs instead of using insertId plus an offset");
  assert.equal(f.database.calls.filter(call => call.method === "query" && /FROM inventory_stock_balances/iu.test(call.sql) && !/LEFT JOIN|FOR UPDATE/iu.test(call.sql)).length, 2);
});

test("ST041-PB05 large Post retains complete snapshot, scope pairing, duplicate and first business error checks", async () => {
  for (const mutate of [initial => initial.lines[0].snapshot_quantity++, initial => initial.lines[0].stocktake_bin_id++,
    initial => initial.balances.push({ ...initial.balances[0], id: 9000 }), initial => initial.lines.push({ ...initial.lines[0], id: 9000 }),
    initial => initial.balances[0].version++]) {
    const initial = data(101); mutate(initial); await unchanged(fixture(initial), "STOCKTAKE_SNAPSHOT_MISMATCH");
  }
  await unchanged(fixture(data(101), { currentLines: rows => rows.map((row, i) => i ? row : { ...row, version: row.version + 1 }) }), "STOCKTAKE_SNAPSHOT_MISMATCH");
  const first = data(101); first.lines[0].lot_id = 999; first.balances[0].lot_id = 999; first.balances[0].lot_scope = 999; change(first.lines[1], -1);
  await unchanged(fixture(first), "LOT_DATA_CONFLICT");
  [first.lines[0].id, first.lines[1].id] = [first.lines[1].id, first.lines[0].id];
  await unchanged(fixture(first), "STOCKTAKE_SNAPSHOT_MISMATCH");
});

test("ST041-PB06 allocated stays a per-bucket floor despite another bucket gain in a large Post", async () => {
  const initial = data(101); change(initial.lines[0], 1); initial.balances[0].allocated_quantity = 2;
  change(initial.lines[1], 1000); await unchanged(fixture(initial), "INSUFFICIENT_STOCK");
  const equal = data(101); change(equal.lines[0], 2); equal.balances[0].allocated_quantity = 2;
  const f = fixture(equal), input = request(); ownEffects(f, await post(f, input), input);
});

test("ST041-PB07 final same-SKU Reserved includes off-book gains and outside-Bin AVAILABLE without cross-SKU cover", async () => {
  const initial = data(102, { newEvery: 2 });
  initial.lines[0].sku_id = initial.lines[1].sku_id; initial.lines[0].bin_id = 2; initial.lines[0].stocktake_bin_id = 102;
  initial.scopes.push({ id: 102, stocktake_id: 41, bin_id: 2 });
  initial.locks.push({ id: 83, stocktake_id: 41, stocktake_bin_id: 102, bin_id: 2, released_at: null, lock_type: "STOCKTAKE" });
  change(initial.lines[0], 3); change(initial.lines[1], 1); initial.controls.find(row => row.sku_id === initial.lines[1].sku_id).reserved_quantity = 4;
  const f = fixture(initial), input = request(); ownEffects(f, await post(f, input), input);
  const otherSku = structuredClone(initial); otherSku.lines[0].sku_id = 9000; otherSku.controls.push({ warehouse_id: 1, sku_id: 9000, reserved_quantity: 0 });
  await unchanged(fixture(otherSku), "INSUFFICIENT_ATP");
  const outside = data(101); change(outside.lines[0], 1); outside.controls[0].reserved_quantity = 4;
  outside.balances.push({ ...outside.balances[0], id: 9991, bin_id: 999, on_hand_quantity: 3 });
  const g = fixture(outside), outsideInput = request(); ownEffects(g, await post(g, outsideInput), outsideInput);
  assert.equal(g.database.state.balances.find(row => row.id === 9991).on_hand_quantity, 3);
});

test("ST041-PB08 AVAILABLE preserves duplicate rows, safe integer errors, expiry/minimum-life exclusions and no FEFO reorder", async () => {
  const initial = data(101); change(initial.lines[0], 1); initial.controls[0].reserved_quantity = 4;
  initial.balances.push({ ...initial.balances[0], id: 9991, bin_id: 999, on_hand_quantity: 2 });
  const f = fixture(initial, { availableRows: rows => [...rows, ...rows.filter(row => row.id === 9991)] }), input = request();
  ownEffects(f, await post(f, input), input);
  const unsafe = data(101); unsafe.balances.push({ ...unsafe.balances[0], id: 9991, bin_id: 999, on_hand_quantity: Number.MAX_SAFE_INTEGER });
  await unchanged(fixture(unsafe), "STOCKTAKE_SNAPSHOT_MISMATCH");
  for (const expiry_date of ["2020-01-01", "2026-10-13"]) {
    const lots = data(101); change(lots.lines[0], 1); lots.controls[0].reserved_quantity = 4;
    lots.lots.push({ id: 1, sku_id: 12, lot_number: "old", normalized_lot_number: "old", expiry_date: "2027-01-01", manufacture_date: "2019-01-01", first_receipt_date: "2019-01-01" },
      { id: 2, sku_id: 12, lot_number: "excluded", normalized_lot_number: "excluded", expiry_date, manufacture_date: "2019-01-01", first_receipt_date: "2019-01-01" });
    lots.lines[0].lot_id = 1; Object.assign(lots.balances[0], { lot_id: 1, lot_scope: 1, expiry_date: "2027-01-01" });
    lots.balances.push({ ...lots.balances[0], id: 9991, bin_id: 999, lot_id: 2, lot_scope: 2, expiry_date, on_hand_quantity: 1000 });
    await unchanged(fixture(lots, { minimumSaleLifeDays: 30 }), "INSUFFICIENT_ATP");
  }
  const firstError = data(101); change(firstError.lines[0], 1); firstError.controls[0].reserved_quantity = 4;
  firstError.balances.push({ ...firstError.balances[1], id: 9991, bin_id: 999, on_hand_quantity: Number.MAX_SAFE_INTEGER });
  await unchanged(fixture(firstError), "INSUFFICIENT_ATP");
});

test("ST041-PB09 second Balance CASE CAS short count rolls back earlier chunks and never retries", async () => {
  const f = fixture(data(201, { newEvery: 2 }), { shortBalanceAt: 2 }); await unchanged(f, "CONCURRENT_OPERATION");
  assert.equal(f.stats.balanceWrites, 2); assert.equal(f.stats.transactions, 1);
  assert.ok(f.stats.inserted.some(row => row.key === "movements" && row.count === 100), "The first full chunk must have executed before the injected second-chunk fault");
  let writes = 0;
  const versionChanged = fixture(data(201), { onExecute: ({ sql, state }) => {
    if (/UPDATE inventory_stock_balances/iu.test(sql) && ++writes === 2) state.balances.find(row => row.id === 401).version++;
  } });
  await unchanged(versionChanged, "CONCURRENT_OPERATION");
});

test("ST041-PB10 missing duplicate foreign or extra Movement and new Balance owner maps reject atomically", async () => {
  for (const mutate of [rows => rows.slice(1), rows => [...rows.slice(0, -1), rows[0]],
    rows => rows.map((row, i) => i ? row : { ...row, stocktake_line_id: 999999 }),
    rows => rows.map((row, i) => i ? row : { ...row, operation_request_id: 999 }),
    rows => [...rows, { ...rows[0], id: rows.at(-1).id + 1 }]]) {
    const f = fixture(data(201), { movementReadback: (rows, batch) => batch === 2 ? mutate(rows) : rows });
    await unchanged(f, "CONCURRENT_OPERATION"); assert.equal(f.stats.movementReads, 2);
  }
  for (const mutate of [rows => rows.slice(1), rows => [...rows.slice(0, -1), rows[0]],
    rows => rows.map((row, i) => i ? row : { ...row, warehouse_id: 999 }),
    rows => rows.map((row, i) => i ? row : { ...row, on_hand_quantity: 1 }),
    rows => rows.map((row, i) => i ? row : { ...row, allocated_quantity: 1 }),
    rows => rows.map((row, i) => i ? row : { ...row, version: 2 })]) {
    await unchanged(fixture(data(101, { newEvery: 1 }), { balanceReadback: mutate }), "CONCURRENT_OPERATION");
  }
});

test("ST041-PB11 second line CASE CAS short count rolls back all Balance Movement line and Audit effects", async () => {
  const f = fixture(data(201), { shortLineAt: 2 }); await unchanged(f, "CONCURRENT_OPERATION");
  assert.equal(f.stats.lineWrites, 2); assert.equal(f.stats.auditWrites, 1);
  assert.deepEqual(insertSizes(f, "movements"), [100, 100]);
  for (const changes of [{ version: 99 }, { stocktake_id: 999 }, { movement_id: 999 }]) {
    let writes = 0;
    const changed = fixture(data(201), { onExecute: ({ sql, state }) => {
      if (/UPDATE inventory_stocktake_lines/iu.test(sql) && ++writes === 2) Object.assign(state.lines.find(row => row.id === 301), changes);
    } });
    await unchanged(changed, "CONCURRENT_OPERATION");
  }
});

test("ST041-PB12 second real Audit batch failure propagates unchanged and rolls back the complete Post", async () => {
  const fault = new Error("injected second Audit SQL fault"), f = fixture(data(201, { newEvery: 2 }), { failAuditAt: 2, auditError: fault });
  await unchanged(f, fault); assert.equal(f.stats.auditWrites, 2);
  assert.deepEqual(insertSizes(f, "audits"), [100, 100]); assert.deepEqual(insertSizes(f, "movements"), [100, 100]);
});

test("ST041-PB13 current revocation device time date boundaries and scalar replay retain original guards", async () => {
  for (const [options, code] of [[{ permissions: ["inventory.view"] }, "PERMISSION_STALE"], [{ device: { status: "revoked" } }, "DEVICE_REVOKED"],
    [{ device: { public_key: Buffer.from("changed") } }, "DEVICE_MISMATCH"], [{ tokenVersion: 1 }, "JWT_INVALID"]]) await unchanged(fixture(data(101), options), code);
  for (const mode of ["time", "date"]) {
    const f = fixture(data(201), { onExecute: ({ sql, clock }) => { if (/INSERT INTO inventory_movements/iu.test(sql)) { if (mode === "time") clock.now += 61000; else clock.date = "2026-10-13"; } } });
    await unchanged(f, mode === "time" ? "DEVICE_SIGNATURE_STALE" : "CONCURRENT_OPERATION");
  }
  const f = fixture(), input = request(), capsule = proof(input, f.clock), result = await f.service.post(input, capsule), after = f.database.state;
  await assert.rejects(f.service.post(input, capsule), { code: "PERMISSION_STALE" });
  assert.deepEqual(await post(f, input), result); assert.deepEqual(f.database.state, after);
  for (const [changes, code] of [[{ permissions: ["inventory.view"] }, "PERMISSION_STALE"], [{ device: { status: "revoked" } }, "DEVICE_REVOKED"], [{ tokenVersion: 1 }, "JWT_INVALID"]]) {
    Object.assign(f.options, changes); await assert.rejects(post(f, input), { code }); assert.deepEqual(f.database.state, after);
    delete f.options.permissions; delete f.options.device; delete f.options.tokenVersion;
  }
});

test("ST041-PB14 large all-zero Post requires sealed authentication completes once and has no stock effects", async () => {
  const f = fixture(data(1001, { zero: true })), input = request(), before = f.database.state;
  await assert.rejects(f.service.post(input, {}), { code: "PERMISSION_STALE" });
  const result = await post(f, input), after = f.database.state;
  assert.deepEqual(result, { id: 41, operationId: 21, status: "POSTED", version: 4, rowCount: 0, movementGroupId: null });
  assert.deepEqual(after.balances, before.balances); assert.deepEqual(after.lines, before.lines); assert.deepEqual(after.movements, []);
  assert.equal(after.audits.length, 1); assert.equal(f.stats.balanceWrites, 0); assert.equal(f.stats.lineWrites, 0); assert.equal(f.stats.availableReads.length, 0);
  assert.equal(after.locks[0].release_reason, "POSTED"); assert.deepEqual(after.locks[1], before.locks[1]);
  assert.deepEqual(await post(f, input), result); assert.deepEqual(f.database.state, after);
});

test("ST041-PB15 each batch stays within 100 rows 3200 binds and 1MiB UTF8 strings without truncation", async () => {
  // Long Item snapshots intentionally force the Post string budget to split below 100;
  // they remain valid scalar values at this unit boundary, not native column-width evidence.
  const name = "盤".repeat(4000), f = fixture(data(201), { skuName: name }), input = request("盤".repeat(166));
  const result = await post(f, input); ownEffects(f, result, input);
  const movementSizes = insertSizes(f, "movements");
  assert.ok(movementSizes[0] < 100, "UTF8 bytes must shrink the first chunk before SQL dispatch");
  for (const entry of f.stats.inserted) if (["balances", "movements", "audits"].includes(entry.key)) assert.ok(entry.count <= 100);
  for (const call of f.database.calls) {
    assert.ok(Array.isArray(call.params)); assert.ok(call.params.length <= 3200, `${call.params.length} bind parameters`);
    assert.ok(call.params.filter(value => typeof value === "string").reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0) <= 1048576);
  }
  assert.ok(f.database.state.movements.every(row => row.sku_name_snapshot === name && row.reason_text === input.payload.reason));
  const tooLarge = fixture(data(101), { skuName: "盤".repeat(350000) });
  const before = tooLarge.database.state; await assert.rejects(post(tooLarge)); assert.deepEqual(tooLarge.database.state, before);
  assert.equal(tooLarge.stats.commits, 0); assert.equal(tooLarge.stats.transactions, 1);
});

test("ST041-PB16 N=101 and N=1001 SQL cost is per chunk and a per-row mutation exceeds the oracle", async () => {
  const failures = [];
  for (const size of [101, 1001]) {
    try {
    const f = fixture(data(size)), input = request(), result = await post(f, input); ownEffects(f, result, input);
    const chunks = Math.ceil(size / 100), calls = f.database.calls;
    assert.equal(f.stats.availableReads.length, chunks, `AVAILABLE reads at N=${size} must be per 100 sorted distinct SKUs`);
    assert.deepEqual(f.stats.availableReads.flat(), Array.from({ length: size }, (_, i) => 12 + i));
    assert.equal(f.stats.balanceWrites, chunks); assert.equal(f.stats.lineWrites, chunks); assert.equal(f.stats.movementReads, chunks);
    assert.equal(f.stats.auditWrites, chunks + 1); assert.equal(insertSizes(f, "movements").length, chunks);
    // Two current-auth passes (10), fixed discovery/claim/header/receipt/lock SQL (13),
    // then AVAILABLE + Balance + Movement INSERT/read + line + Audit (6) per chunk.
    assert.ok(calls.length <= 23 + chunks * 6, `${calls.length} SQL calls at N=${size}; old per-row path exceeds ${23 + chunks * 6}`);
    assert.equal(calls.some(call => /MAX\s*\(\s*id\s*\)/iu.test(call.sql)), false);
    assert.ok(calls.every(call => call.params.length <= 3200));
    } catch (error) { failures.push(Object.assign(error, { fixtureSize: size })); }
  }
  if (failures.length) throw new AggregateError(failures, "Post batch SQL budget regression at N=101 and N=1001");
});
