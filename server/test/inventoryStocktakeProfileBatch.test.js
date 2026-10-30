import assert from "node:assert/strict";
import test from "node:test";
import * as stocktakeModule from "../src/modules/inventory/InventoryStocktakeService.js";
import { ItemLookupService } from "../src/modules/item/ItemLookupService.js";
const { InventoryStocktakeService } = stocktakeModule;
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
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "unit-PBU", eventId: `post-${++event}` },
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
  const stats = { transactions: 0, commits: 0, rollbacks: 0, profiles: [], chunks: [], profileSql: [], factories: 0, balanceWrites: 0, lineWrites: 0, auditWrites: 0, movementReads: 0,
    availableReads: [], inserted: [] };
  const catalog = itemCatalog(initial, options, clock);
  let activeTx;
  let balanceSequence = 10000, movementSequence = 20000;
  const database = createFakeInventoryDatabase({ initialState: initial,
    query: async ({ sql, params, state }) => {
      await options.onQuery?.({ sql, params, state, clock });
      if (/FROM (?:item_skus|item_sku_uoms|items|item_uoms)\b/iu.test(sql)) {
        const kind = /s\.id AS sku_id/iu.test(sql) ? "discovery" : /FROM item_skus s/iu.test(sql) ? "sku" :
          /FROM item_sku_uoms su/iu.test(sql) ? "uom" : /FROM item_sku_uoms /iu.test(sql) ? "mapping" :
          /FROM item_uoms /iu.test(sql) ? "uom" : "item";
        const call = { kind, sql, params: [...params], tx: activeTx };
        stats.profileSql.push(call);
        if (kind === "discovery") assert.doesNotMatch(sql, /FOR SHARE/u, "Item discovers IDs before ordered locking reads");
        else assert.match(sql, / FOR SHARE$/u, "Actual Item fact reads must retain their locks");
        assert.equal((sql.match(/FOR SHARE/gu) ?? []).length, kind === "discovery" ? 0 : 1, "Each current Item fact read owns exactly one lock clause");
        await options.onProfileSql?.({ ...call, clock, state });
        return catalog.query(sql, params);
      }
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
    try { const result = await originalTransaction(tx => { activeTx = tx; return work(tx); }); stats.commits++; return result; }
    catch (error) { stats.rollbacks++; throw error; }
  };
  const locks = { lockForCommand: async (tx, input) => ({ warehouses: [{ id: 1, warehouse_code: "W1", status: "ACTIVE" }],
    bins: input.binIds.map(id => ({ id, warehouse_id: 1, status: "ACTIVE", bin_code: `B${id}` })),
    stockControls: structuredClone(tx.state.controls), binLocks: structuredClone(tx.state.locks) }) };
  database.query = async () => { throw new Error("Main database.query is forbidden"); };
  database.getConnection = async () => { throw new Error("New connection is forbidden"); };
  const logger = { error() {} };
  const actualSingle = new ItemLookupService({ database, logger, time: clock });
  const itemLookup = { getInventoryProfileInTransaction: async (tx, skuId) => {
    stats.profiles.push(skuId);
    const result = await actualSingle.getInventoryProfileInTransaction(tx, skuId);
    options.afterSingle?.(skuId, result);
    return result;
  } };
  const inventoryProfileLookupFactory = executor => {
    assert.equal(++stats.factories, 1, "A Post must construct one tx-local bulk lookup");
    assert.deepEqual(Object.keys(executor), ["query"]);
    const actual = new ItemLookupService({ database: executor, logger, time: clock });
    let pending = false;
    return { findManyByIds: async (ids, lookupOptions) => {
      assert.equal(pending, false, "Bulk chunks must await the preceding lookup"); pending = true;
      assert.deepEqual(lookupOptions, { purpose: "inventory" });
      stats.chunks.push([...ids]);
      try {
        const result = await actual.findManyByIds(ids, lookupOptions);
        return options.reverseMap ? new Map([...result].reverse()) : result;
      } finally { pending = false; }
    } };
  };

  const audit = new InventoryAuditService({ database, logger, time: clock });
  return { database, stats, options, clock, catalog, initial: structuredClone(initial), audit,
    service: new InventoryStocktakeService({ database, time: clock, logger, locks, itemLookup, audit,
      ...(options.defaultFactory ? {} : { inventoryProfileLookupFactory }) }) };
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
  assert.deepEqual([...f.stats.profiles, ...f.stats.chunks.flat()].sort((a, b) => a - b),
    [...new Set(f.initial.lines.filter(row => row.stocktake_id === 41).map(row => row.sku_id))].sort((a, b) => a - b));
  assert.equal(f.stats.transactions, 1); assert.equal(f.stats.commits, 1);
}
// This is a synthetic SQL-executor unit oracle; it is not MySQL, HTTP, lock-wait or GC evidence.
function insertSizes(f, key) { return f.stats.inserted.filter(row => row.key === key).map(row => row.count); }
function change(row, actual) { Object.assign(row, { counted_quantity: actual, variance_quantity: actual - row.snapshot_quantity }); }

function itemCatalog(initial, options = {}, clock = { nowMs: () => NOW }) {
  const ids = [...new Set(initial.lines.map(row => Number(row.sku_id)))];
  const skus = ids.filter(id => !options.missing?.includes(id)).map(id => ({ id, sku_code: `SKU${id}`, sku_name: "synthetic",
    version: 1, item_version: 1, sku_status: "active", item_id: id + 10000, item_name: "extra Item field", product_type: "standard", item_status: "active",
    inventory_tracked: 1, tracking_policy: initial.lots.some(lot => Number(lot.sku_id) === id) ? "batch_expiry" : "none",
    purchasable: 0, sellable: 0, shelf_life_days: null, min_receipt_life_days: null, min_sale_life_days: 0,
    effective_from: NOW + 999999, effective_to: NOW - 999999, ...options.sku?.(id) }));
  const uoms = skus.flatMap(sku => (options.uoms?.(sku.id) ?? [{ id: sku.id, sku_id: sku.id, uom_id: 1, uom_code: "EA",
    uom_name: "extra UOM field", uom_status: "inactive", version: 3, uom_version: 4, to_base_factor: "1", is_base: 1,
    is_default_purchase: 0, is_default_sale: 0 }]).map((row, index) => ({ id: sku.id * 100 + index + 1, version: 3, uom_version: 4, ...row })));
  return { skus, uoms, clock, async query(sql, params) {
    if (/s\.id AS sku_id/iu.test(sql)) return [structuredClone(skus.filter(row => params.includes(Number(row.id))).flatMap(sku => {
      const mappings = uoms.filter(row => Number(row.sku_id) === Number(sku.id));
      return (mappings.length ? mappings : [{ id: null, uom_id: null }]).map(row =>
        ({ sku_id: sku.id, item_id: sku.item_id, id: row.id, uom_id: row.uom_id }));
    }))];
    if (/FROM item_uoms /iu.test(sql)) return [structuredClone([...new Map(uoms.filter(row => params.includes(Number(row.uom_id))).map(row =>
      [Number(row.uom_id), { id: row.uom_id, code: row.uom_code, name: row.uom_name, status: row.uom_status, version: row.uom_version }])).values()])];
    if (/FROM items /iu.test(sql)) return [structuredClone(skus.filter(row => params.includes(Number(row.item_id))).map(row =>
      ({ id: row.item_id, name: row.item_name, product_type: row.product_type, status: row.item_status, version: row.item_version })))];
    if (/FROM item_skus s/iu.test(sql)) return [structuredClone(skus.filter(row => params.includes(Number(row.id))).map(row => ({ ...row, sku_version: row.version })))];
    if (/FROM item_sku_uoms(?: su)? /iu.test(sql)) return [structuredClone(uoms.filter(row => params.includes(Number(row.sku_id))))];
    throw new Error(`Unexpected Item query: ${sql}`);
  } };
}
function projectionOracle(options = {}) {
  const catalog = itemCatalog(data(3), options), lookup = new ItemLookupService({ database: catalog, logger: { error() {} }, time: catalog.clock });
  return { catalog, lookup };
}
function project(value) {
  assert.equal(typeof stocktakeModule.toStocktakeInventoryProfile, "function", "The actual Inventory projection helper must be exported");
  return stocktakeModule.toStocktakeInventoryProfile(value);
}
const profileKeys = ["skuId", "skuCode", "skuName", "skuStatus", "itemStatus", "inventoryTracked", "trackingPolicy", "shelfLifeDays",
  "minimumReceiptLifeDays", "minimumSaleLifeDays", "baseUom", "usable", "reasons"].sort();
const uomError = { code: "UOM_CONVERSION_INVALID", message: "UOM conversion is invalid: Inventory profile requires exactly one Base UOM with factor 1" };
function invalidUoms(id, factor = 2) { return [{ sku_id: id, uom_id: 1, uom_code: "EA", to_base_factor: factor, is_base: 1 }]; }
function assertBulk(f, count) {
  assert.equal(f.stats.factories, 1); assert.deepEqual(f.stats.profiles, []);
  const ids = [...new Set(f.initial.lines.map(row => row.sku_id))].sort((a, b) => a - b);
  assert.deepEqual(f.stats.chunks, Array.from({ length: Math.ceil(count / 100) }, (_, i) => ids.slice(i * 100, i * 100 + 100)));
  assert.equal(f.stats.profileSql.length, 2 * Math.ceil(count / 100));
  assert.equal(new Set(f.stats.profileSql.map(call => call.tx)).size, 1);
  for (let i = 0; i < f.stats.profileSql.length; i += 2) {
    const [sku, uom] = f.stats.profileSql.slice(i, i + 2);
    assert.deepEqual([sku.kind, uom.kind], ["sku", "uom"]); assert.deepEqual(sku.params, f.stats.chunks[i / 2]);
    assert.deepEqual([...uom.params].sort((a, b) => a - b), sku.params);
    assert.ok(sku.params.length <= 100); assert.ok(uom.params.length <= 100);
    assert.match(sku.sql, /s\.id IN \(/u); assert.match(sku.sql, / FOR SHARE$/u); assert.match(uom.sql, / FOR SHARE$/u);
  }
}

test("ST041-PBU01 strategy uses unique SKU threshold including 100k rows with only 100 SKUs", async () => {
  for (const count of [0, 1, 100, 101]) {
    const f = fixture(data(count, { zero: true })), input = request(); ownEffects(f, await post(f, input), input);
    if (count === 101) assertBulk(f, count);
    else { assert.equal(f.stats.factories, 0); assert.deepEqual(f.stats.profiles, Array.from({ length: count }, (_, i) => 12 + i));
      assert.equal(f.stats.profileSql.length, 5 * count); assert.deepEqual(f.stats.chunks, []);
      for (let index = 0; index < count; index++) {
        const calls = f.stats.profileSql.slice(index * 5, index * 5 + 5);
        assert.deepEqual(calls.map(call => call.kind), ["discovery", "uom", "item", "sku", "mapping"]);
        assert.deepEqual(calls.map(call => call.params), [[12 + index], [1], [10012 + index], [12 + index], [12 + index]]);
        assert.equal(new Set(calls.map(call => call.tx)).size, 1);
        assert.match(calls[3].sql, /s\.id IN \(\?\) ORDER BY s\.id FOR SHARE$/u);
      } }
  }
  // A bounded strategy probe stops after real scalar profiles, before processing 100k legs.
  const initial = data(100, { zero: true, newEvery: 1 }), originals = initial.lines;
  initial.lines = Array.from({ length: 1000 }, (_, bin) => originals.map((row, sku) => ({ ...row, id: 1000 + bin * 100 + sku,
    bin_id: bin + 1, stocktake_bin_id: bin + 101 }))).flat();
  initial.scopes = Array.from({ length: 1000 }, (_, bin) => ({ id: bin + 101, stocktake_id: 41, bin_id: bin + 1 }));
  initial.locks = initial.scopes.map(scope => ({ id: scope.id, stocktake_id: 41, stocktake_bin_id: scope.id,
    bin_id: scope.bin_id, released_at: null, lock_type: "STOCKTAKE" }));
  const stop = new Error("unit strategy probe complete"), f = fixture(initial, { afterSingle: id => { if (id === 111) throw stop; } });
  await unchanged(f, stop); assert.equal(f.stats.factories, 0); assert.equal(f.stats.profiles.length, 100); assert.equal(f.stats.profileSql.length, 500);
});

test("ST041-PBU02 sorted deduplicated 101 201 1001 IDs use one same-tx real Item lookup in sequential chunks", async () => {
  for (const count of [101, 201, 1001]) {
    const initial = data(count + 1, { zero: true, statuses: true });
    initial.lines.at(-1).sku_id = initial.lines[0].sku_id; initial.balances.at(-1).sku_id = initial.lines[0].sku_id;
    initial.lines.at(-1).stock_status = "DAMAGED"; initial.balances.at(-1).stock_status = "DAMAGED";
    initial.lines.reverse(); const f = fixture(initial), input = request();
    ownEffects(f, await post(f, input), input); assertBulk(f, count);
    assert.equal(f.stats.transactions, 1); assert.equal(f.stats.commits, 1);
  }
});

test("ST041-PBU03 actual generic projection maps exactly to original real scalar 13-key profiles", async () => {
  const { catalog, lookup } = projectionOracle({ sku: id => ({ tracking_policy: ["none", "batch", "batch_expiry"][id - 12],
    shelf_life_days: id === 12 ? null : "120", min_receipt_life_days: "3", min_sale_life_days: id === 12 ? null : "7",
    inventory_tracked: id === 14 ? 0 : 1, item_status: id === 13 ? "archived" : "inactive" }) });
  const generic = await lookup.findManyByIds([12, 13, 14], { purpose: "inventory" });
  for (const id of [12, 13, 14]) {
    const actual = project(generic.get(id)), original = await lookup.getInventoryProfileInTransaction(catalog, id);
    assert.deepEqual(actual, original); assert.deepEqual(Object.keys(actual).sort(), profileKeys);
    assert.deepEqual(Object.keys(actual.baseUom).sort(), ["uomCode", "uomId"]);
  }
  assert.equal(project(generic.get(12)).usable, true, "Inventory ignores sale flags and effective windows");
  assert.deepEqual(project(generic.get(13)).reasons, ["ARCHIVED"]);
  assert.deepEqual(project(generic.get(14)).reasons, ["NOT_INVENTORY_TRACKED"]);
});

test("ST041-PBU04 reversed real Item Map and missing IDs preserve ascending first business error", async () => {
  const reverse = fixture(data(101), { reverseMap: true, sku: id => id === 12 ? { tracking_policy: "serial" } : id === 111 ? { inventory_tracked: 0 } : {} });
  await unchanged(reverse, "SERIAL_TRACKING_UNSUPPORTED"); assert.equal(reverse.stats.factories, 1); assert.equal(reverse.stats.chunks.length, 1);
  for (const missing of [12, 112]) {
    const f = fixture(data(201), { reverseMap: true, missing: [missing], sku: id => id === missing + 1 ? { tracking_policy: "serial" } : {} });
    await unchanged(f, "INVENTORY_RESOURCE_NOT_FOUND"); assert.equal(f.stats.factories, 1);
    assert.equal(f.stats.chunks.length, missing === 12 ? 1 : 2, "No later batch may be read before validating the current one");
  }
});

test("ST041-PBU05 invalid Base wins before later missing or serial within and across chunk boundaries", async () => {
  for (const [bad, later] of [[12, 13], [111, 112], [112, 113]]) for (const mode of ["missing", "serial"]) {
    const f = fixture(data(201), { missing: mode === "missing" ? [later] : [],
      sku: id => mode === "serial" && id === later ? { tracking_policy: "serial" } : {},
      uoms: id => id === bad ? invalidUoms(id) : undefined });
    await assert.rejects(post(f), uomError); assert.deepEqual(f.database.state, f.initial);
    assert.equal(f.stats.factories, 1); assert.equal(f.stats.chunks.length, bad <= 111 ? 1 : 2);
    assert.equal(f.stats.rollbacks, 1); assert.equal(f.stats.commits, 0);
  }
});

test("ST041-PBU06 original tracked serial usable precedence and Item inventory status purpose survive", async () => {
  for (const [sku, code] of [[{ inventory_tracked: 0, tracking_policy: "serial", sku_status: "archived" }, "SKU_NOT_INVENTORY_TRACKED"],
    [{ tracking_policy: "serial", sku_status: "archived" }, "SERIAL_TRACKING_UNSUPPORTED"],
    [{ sku_status: "inactive" }, "INVENTORY_INPUT_INVALID"], [{ sku_status: "discontinued" }, "INVENTORY_INPUT_INVALID"],
    [{ item_status: "archived" }, "INVENTORY_INPUT_INVALID"], [{ sku_status: "archived" }, "INVENTORY_INPUT_INVALID"]]) {
    const f = fixture(data(101), { sku: id => id === 12 ? sku : {} }); await unchanged(f, code); assert.equal(f.stats.factories, 1);
  }
  for (const item_status of ["active", "inactive", "discontinued"]) {
    const f = fixture(data(101, { zero: true }), { sku: () => ({ item_status }) });
    const input = request(); ownEffects(f, await post(f, input), input); assertBulk(f, 101);
  }
});

test("ST041-PBU07 exact missing Base and factor errors retain first Base and permissive nonbase UOM semantics", async () => {
  for (const rows of [[], invalidUoms(12, 0), invalidUoms(12, 2)]) {
    const { catalog, lookup } = projectionOracle({ uoms: id => id === 12 ? rows : undefined });
    const generic = await lookup.findManyByIds([12], { purpose: "inventory" });
    const scalarError = rows.length ? uomError : { code: "UOM_CONVERSION_INVALID",
      message: "UOM conversion is invalid: Sales SKU has no UOM associations" };
    await assert.rejects(lookup.getInventoryProfileInTransaction(catalog, 12), scalarError);
    assert.throws(() => project(generic.get(12)), uomError);
    const f = fixture(data(101), { uoms: id => id === 12 ? rows : undefined }); await assert.rejects(post(f), uomError);
    assert.deepEqual(f.database.state, f.initial); assert.equal(f.stats.factories, 1);
  }
  const { catalog, lookup } = projectionOracle({ uoms: id => [
    { sku_id: id, uom_id: 9, uom_code: "FIRST", to_base_factor: 1, is_base: 1, uom_status: "inactive" },
    { sku_id: id, uom_id: 8, uom_code: "SECOND", to_base_factor: 2, is_base: 1 },
    { sku_id: id, uom_id: 7, uom_code: "FRACTION", to_base_factor: 0.5, is_base: 0 }] });
  const generic = await lookup.findManyByIds([12], { purpose: "inventory" });
  assert.deepEqual(project(generic.get(12)), await lookup.getInventoryProfileInTransaction(catalog, 12));
  assert.deepEqual(project(generic.get(12)).baseUom, { uomId: 9, uomCode: "FIRST" });
});

test("ST041-PBU08 real bulk profiles preserve full mixed row effects allocated Reserved sale-life and safe sums", async () => {
  const mixed = fixture(data(201, { newEvery: 2, statuses: true })), input = request();
  ownEffects(mixed, await post(mixed, input), input); assertBulk(mixed, 201);
  assert.deepEqual(insertSizes(mixed, "movements"), [100, 100, 1]);
  assert.ok(mixed.database.state.balances.every(row => row.lot_id === null && row.lot_scope === 0));
  const combined = data(102, { newEvery: 2 }); combined.lines[0].sku_id = combined.lines[1].sku_id;
  combined.lines[0].bin_id = 2; combined.lines[0].stocktake_bin_id = 102;
  combined.scopes.push({ id: 102, stocktake_id: 41, bin_id: 2 }); combined.locks[1].bin_id = 999;
  combined.locks.push({ id: 83, stocktake_id: 41, stocktake_bin_id: 102, bin_id: 2, released_at: null, lock_type: "STOCKTAKE" });
  change(combined.lines[0], 3); change(combined.lines[1], 1); combined.controls.find(row => row.sku_id === 13).reserved_quantity = 4;
  const whole = fixture(combined), wholeInput = request(); ownEffects(whole, await post(whole, wholeInput), wholeInput); assertBulk(whole, 101);
  const wrongSku = structuredClone(combined); wrongSku.lines[0].sku_id = 9000;
  wrongSku.controls.push({ warehouse_id: 1, sku_id: 9000, reserved_quantity: 0 });
  await unchanged(fixture(wrongSku), "INSUFFICIENT_ATP");
  const floor = data(101); change(floor.lines[0], 1); floor.balances[0].allocated_quantity = 2;
  await unchanged(fixture(floor), "INSUFFICIENT_STOCK");
  const outside = data(101); change(outside.lines[0], 1); outside.controls[0].reserved_quantity = 4;
  outside.balances.push({ ...outside.balances[0], id: 9991, bin_id: 999, on_hand_quantity: 2 });
  const repeated = fixture(outside, { availableRows: rows => [...rows, ...rows.filter(row => row.id === 9991)] }), repeatedInput = request();
  ownEffects(repeated, await post(repeated, repeatedInput), repeatedInput); assertBulk(repeated, 101);
  const uncovered = structuredClone(outside); uncovered.balances.pop(); change(uncovered.lines[1], 1000);
  await unchanged(fixture(uncovered), "INSUFFICIENT_ATP");
  const unsafe = structuredClone(outside); unsafe.balances.at(-1).on_hand_quantity = Number.MAX_SAFE_INTEGER;
  await unchanged(fixture(unsafe), "STOCKTAKE_SNAPSHOT_MISMATCH");
  const expiry = data(101); change(expiry.lines[0], 1); expiry.controls[0].reserved_quantity = 4;
  expiry.lots.push({ id: 1, sku_id: 12, lot_number: "known", normalized_lot_number: "known", expiry_date: "2027-01-01", manufacture_date: "2026-01-01", first_receipt_date: "2026-01-01" },
    { id: 2, sku_id: 12, lot_number: "short", normalized_lot_number: "short", expiry_date: "2026-10-13", manufacture_date: "2026-01-01", first_receipt_date: "2026-01-01" });
  expiry.lines[0].lot_id = 1; Object.assign(expiry.balances[0], { lot_id: 1, lot_scope: 1, expiry_date: "2027-01-01" });
  expiry.balances.push({ ...expiry.balances[0], id: 9991, bin_id: 999, lot_id: 2, lot_scope: 2, expiry_date: "2026-10-13", on_hand_quantity: 1000 });
  await unchanged(fixture(expiry, { sku: id => id === 12 ? { min_sale_life_days: 30 } : {} }), "INSUFFICIENT_ATP");
});

test("ST041-PBU09 second batch SKU SQL fault propagates unchanged atomically with no fallback or third batch", async () => {
  const fault = new Error("injected second SKU SQL"), f = fixture(data(201), { onProfileSql: call => {
    if (call.kind === "sku" && call.params[0] === 112 && call.params.length === 100) throw fault;
  } });
  await unchanged(f, fault); assert.equal(f.stats.factories, 1); assert.deepEqual(f.stats.chunks.map(ids => ids.length), [100, 100]);
  assert.deepEqual(f.stats.profileSql.map(call => call.kind), ["sku", "uom", "sku"]);
  assert.deepEqual(f.stats.profiles, []); assert.equal(f.stats.balanceWrites, 0);
});

test("ST041-PBU10 second UOM fault and expiry during await retain original error and guard precedence", async () => {
  const fault = new Error("injected second UOM SQL"), failed = fixture(data(201), { onProfileSql: call => {
    if (call.kind === "uom" && call.params[0] === 112 && call.params.length === 100) throw fault;
  } });
  await unchanged(failed, fault); assert.equal(failed.stats.factories, 1); assert.equal(failed.stats.chunks.length, 2);
  assert.deepEqual(failed.stats.profiles, []); assert.equal(failed.stats.profileSql.length, 4);
  for (const invalid of [false, true]) {
    const f = fixture(data(101, { zero: true }), { uoms: id => invalid && id === 12 ? invalidUoms(id) : undefined,
      onProfileSql: async call => { if (call.kind === "uom" && call.params[0] === 12) { await Promise.resolve(); call.clock.now += 61000; } } });
    await assert.rejects(post(f), invalid ? uomError : { code: "DEVICE_SIGNATURE_STALE" });
    assert.deepEqual(f.database.state, f.initial); assert.equal(f.stats.factories, 1); assert.equal(f.stats.transactions, 1);
    assert.equal(f.stats.rollbacks, 1); assert.equal(f.stats.commits, 0);
    assert.equal(f.stats.chunks.length, invalid ? 1 : 2, "No new per-batch time guard may preempt original profile validation");
  }
});

test("ST041-PBU11 later Balance Movement Audit and header faults roll back real earlier row effects", async () => {
  for (const point of ["balance", "movement", "audit", "header"]) {
    const fault = new Error(`injected later ${point}`); let seen = 0, earlier;
    const f = fixture(data(201, { newEvery: 2 }), { onExecute: ({ sql, state }) => {
      const match = point === "balance" ? /UPDATE inventory_stock_balances/iu : point === "movement" ? /INSERT INTO inventory_movements/iu
        : point === "audit" ? /INSERT INTO inventory_audit_logs/iu : /UPDATE inventory_stocktakes SET status = 'POSTED'/iu;
      if (match.test(sql) && ++seen === (point === "header" ? 1 : 2)) { earlier = structuredClone(state); throw fault; }
    } });
    await unchanged(f, fault); assertBulk(f, 201); assert.ok(earlier.movements.length >= 100);
    assert.ok(earlier.lines.some(row => row.movement_id != null));
    assert.ok(earlier.balances.some(row => row.on_hand_quantity !== (f.initial.balances.find(old => old.id === row.id)?.on_hand_quantity ?? 0)));
    assert.equal(f.database.state.operations.length, 0); assert.equal(f.database.state.audits.length, 0);
  }
});

test("ST041-PBU12 large all-zero validates every profile and current auth while scalar replay has no new effects", async () => {
  const invalid = fixture(data(101, { zero: true }), { sku: id => id === 112 ? { tracking_policy: "serial" } : {} });
  await unchanged(invalid, "SERIAL_TRACKING_UNSUPPORTED"); assertBulk(invalid, 101);
  const f = fixture(data(1001, { zero: true })), input = request();
  await assert.rejects(f.service.post(input, {}), { code: "PERMISSION_STALE" }); assert.equal(f.stats.profileSql.length, 0);
  const result = await post(f, input), after = f.database.state, sqlCount = f.stats.profileSql.length, factoryCount = f.stats.factories;
  assertBulk(f, 1001); assert.deepEqual(result, { id: 41, operationId: 21, status: "POSTED", version: 4, rowCount: 0, movementGroupId: null });
  assert.deepEqual(after.balances, f.initial.balances); assert.deepEqual(after.lines, f.initial.lines); assert.deepEqual(after.movements, []);
  assert.equal(f.stats.balanceWrites, 0); assert.equal(f.stats.lineWrites, 0); assert.equal(after.audits.length, 1);
  assert.equal(after.locks[0].release_reason, "POSTED"); assert.deepEqual(after.locks[1], f.initial.locks[1]);
  assert.deepEqual(await post(f, input), result); assert.deepEqual(f.database.state, after);
  assert.equal(f.stats.profileSql.length, sqlCount); assert.equal(f.stats.factories, factoryCount);
  for (const [changes, code] of [[{ permissions: ["inventory.view"] }, "PERMISSION_STALE"], [{ device: { status: "revoked" } }, "DEVICE_REVOKED"], [{ tokenVersion: 1 }, "JWT_INVALID"]]) {
    Object.assign(f.options, changes); await assert.rejects(post(f, input), { code }); assert.deepEqual(f.database.state, after);
    assert.equal(f.stats.profileSql.length, sqlCount); delete f.options.permissions; delete f.options.device; delete f.options.tokenVersion;
  }
});

test("ST041-PBU13 default real StocktakeService plus real ItemLookup query cost is two per 100 unique IDs", async () => {
  for (const count of [101, 1001]) {
    const f = fixture(data(count, { zero: true }), { defaultFactory: true }), result = await post(f);
    assert.equal(result.status, "POSTED"); assert.equal(result.rowCount, 0); assert.equal(f.stats.factories, 0, "No injected factory in this cost evidence");
    assert.deepEqual(f.stats.profiles, [], "Default bulk must not use the scalar injected collaborator");
    assert.equal(f.stats.profileSql.length, 2 * Math.ceil(count / 100));
    assert.equal(new Set(f.stats.profileSql.map(call => call.tx)).size, 1); assert.equal(f.stats.transactions, 1);
    for (const call of f.stats.profileSql) { assert.ok(call.params.length <= 100); assert.match(call.sql, / FOR SHARE$/u); }
    assert.deepEqual(f.database.state.balances, f.initial.balances); assert.deepEqual(f.database.state.movements, []);
  }
});

test("ST041-PBU14 exact pure projection excludes extra Item UOM fields and leaves generic input untouched", async () => {
  const { lookup } = projectionOracle(), generic = (await lookup.findManyByIds([12], { purpose: "inventory" })).get(12);
  generic.extraItem = { private: "must not retain" }; generic.uoms[0].extraUom = "must not retain";
  const before = structuredClone(generic), actual = project(generic);
  assert.deepEqual(Object.keys(actual).sort(), profileKeys); assert.deepEqual(Object.keys(actual.baseUom).sort(), ["uomCode", "uomId"]);
  assert.deepEqual(generic, before); assert.equal(actual.itemId, undefined); assert.equal(actual.uoms, undefined);
  assert.equal(actual.extraItem, undefined); assert.equal(actual.baseUom.extraUom, undefined);
  assert.deepEqual(project(generic), actual); assert.notEqual(actual.baseUom, generic.uoms[0]);
  // Post's use of this exact helper and generic Map lifetime require source audit; no dynamic GC/retention claim.
});

