import assert from "node:assert/strict";
import test from "node:test";
import { InventoryStocktakeService } from "../src/modules/inventory/InventoryStocktakeService.js";
import { issueInventoryHighRiskContext } from "../src/modules/inventory/inventoryHighRiskContext.js";
import { inventoryOperationHash } from "../src/modules/inventory/InventoryOperationService.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const time = { nowMs: () => 1791763200000, fileDate: () => "2026-10-12" };
const permissions = ["inventory.view", "inventory.adjust"];
const binding = { id: 5, user_id: 7, device_id: "a".repeat(64), public_key: Buffer.from("synthetic-public-key"), status: "approved" };
const header = { id: 41, warehouse_id: 1, stocktake_number: "ST-41", status: "READY_TO_POST", version: 3, reason: "" };
const scope = { id: 101, stocktake_id: 41, bin_id: 1 };
const line = { id: 201, stocktake_id: 41, stocktake_bin_id: 101, bin_id: 1, sku_id: 12, lot_id: null,
  stock_status: "AVAILABLE", stock_balance_id: 301, snapshot_quantity: 4, snapshot_balance_version: 1,
  counted_quantity: 7, is_not_found: 0, variance_quantity: 3, version: 2 };
const balance = { id: 301, warehouse_id: 1, bin_id: 1, sku_id: 12, lot_id: null, lot_scope: 0,
  stock_status: "AVAILABLE", on_hand_quantity: 4, allocated_quantity: 0, version: 1, fifo_anchor_date: "2026-01-01", expiry_date: null };
const lot = { id: 1, sku_id: 13, lot_number: "known", normalized_lot_number: "known", expiry_date: "2027-01-01",
  manufacture_date: "2026-01-01", first_receipt_date: "2026-01-02" };
let event = 0;
function request() {
  return inventoryCommandFixture({ actor: { claimedRoles: ["counter"], claimedPermissions: permissions },
    authorization: { purpose: "stocktake.post", requiredCallerPermission: "inventory.adjust" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "synthetic-unit041", eventId: `post-${++event}` },
    payload: { stocktakeId: 41, expectedVersion: 3, reason: "physical reconciliation" } });
}
// A trusted request fixture exercises the real sealed issuer; it is not an HTTP/signature test.
function proof(input, clock = time) {
  return issueInventoryHighRiskContext({ method: "POST", apiRoute: { authType: "jwt-device-password", path: "/api/v1/inventory/stocktakes/:id/post" },
    input: { params: { id: String(input.payload.stocktakeId) } }, get: () => String(clock.nowMs()),
    auth: { type: "jwt-device-password", deviceBinding: binding, claims: { sub: "7", did: binding.device_id,
      roles: ["counter"], permissions, ver: 0, exp: clock.nowMs() / 1000 + 900, auth_time: clock.nowMs() / 1000 } } },
  input, { time: clock, signatureMaxSkewSeconds: 60, sessionMaxAgeSeconds: 3600, clockToleranceSeconds: 0 });
}
function bucketOrder(a, b) {
  return Number(a.warehouse_id) - Number(b.warehouse_id) || Number(a.sku_id) - Number(b.sku_id) ||
    Number(a.bin_id) - Number(b.bin_id) || Number(a.lot_scope) - Number(b.lot_scope) || a.stock_status.localeCompare(b.stock_status);
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
        if (operator === "<=>") return same(a, b);
        if (operator === "=") return a != null && b != null && same(a, b);
        if (["!=", "<>"].includes(operator)) return a != null && b != null && !same(a, b);
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
function updateRows(sql, params, rows) {
  const match = /\bSET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/iu.exec(sql);
  assert.ok(match, `UPDATE must have WHERE: ${sql}`);
  const parser = sqlParser(`${match[1]} WHERE ${match[2]}`, params), assignments = [];
  do {
    if (assignments.length) parser.take(",");
    const column = parser.advance().split(".").at(-1); parser.take("="); assignments.push([column, parser.expression()]);
  } while (parser.peek(","));
  parser.take("WHERE"); const predicate = parser.expression(); parser.finish();
  const applied = rows.filter(predicate);
  for (const row of applied) { const original = { ...row }; for (const [column, value] of assignments) row[column] = value(original); }
  return applied.length;
}
function selectRows(sql, params, rows) {
  const match = /\bWHERE\s+([\s\S]+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+FOR\s+(?:UPDATE|SHARE)|$)/iu.exec(sql);
  assert.ok(match, `SELECT must have WHERE: ${sql}`);
  const parser = sqlParser(match[1], params), predicate = parser.expression(); parser.finish();
  return rows.filter(predicate);
}
function fixture(initial = {}, options = {}) {
  const observed = { reads: 0, returned: {}, availableRows: 0, limit: options.limit ?? Infinity };
  const keyFields = new Set(["id", "stocktake_id", "stocktake_bin_id", "warehouse_id", "bin_id", "sku_id", "lot_id", "lot_scope", "stock_status"]);
  const observe = (rows, kind) => {
    observed.returned[kind] = (observed.returned[kind] ?? 0) + rows.length;
    if (kind === "available") observed.availableRows += rows.length;
    if (!options.observe) return rows;
    // Install only after the fake has applied WHERE and ORDER BY. Its own scans are unobserved.
    return rows.map(row => new Proxy(row, { get(target, key, receiver) {
      if (keyFields.has(key) && ++observed.reads > observed.limit) {
        throw Object.assign(new Error(`TEST_OBSERVATION_BUDGET_EXCEEDED: ${observed.reads} > ${observed.limit}`), { code: "TEST_OBSERVATION_BUDGET_EXCEEDED" });
      }
      return Reflect.get(target, key, receiver);
    } }));
  };
  const stats = { transactions: 0, commits: 0, rollbacks: 0, profiles: [], locks: [] };
  let auditWrites = 0, balanceWrites = 0;
  const database = createFakeInventoryDatabase({ initialState: { headers: [header], scopes: [scope], lines: [line], balances: [balance],
    controls: [{ warehouse_id: 1, sku_id: 12, reserved_quantity: 0 }], lots: [], operations: [], audits: [], movements: [], released: [], ...initial },
  failAt: options.failAt,
  query: async ({ sql, params, state }) => {
    options.onQuery?.({ sql, params, state });
    if (sql.includes("FROM users")) return [[{ id: 7, username: "synthetic", status: "active" }]];
    if (sql.includes("FROM user_roles")) return [[{ name: "counter", role_id: 1 }]];
    if (sql.includes("FROM role_permissions")) return [(options.permissions ?? permissions).map(name => ({ name }))];
    if (sql.includes("FROM user_devices")) return [[{ ...binding, ...options.device }]];
    if (sql.includes("FROM fr_token_versions")) return [[{ version: options.tokenVersion ?? 0 }]];
    if (sql.includes("FROM inventory_operation_requests")) return [state.operations.filter(row => row.source === JSON.stringify(params))];
    if (sql.includes("FROM inventory_stocktakes")) return [state.headers.filter(row => Number(row.id) === params[0]).map(row => ({ ...row, ...(sql.includes("FOR UPDATE") ? options.currentHeader : {}) }))];
    if (sql.includes("FROM inventory_stocktake_bins")) {
      let rows = state.scopes.filter(row => Number(row.stocktake_id) === params[0]).sort((a, b) => Number(a.bin_id) - Number(b.bin_id) || Number(a.id) - Number(b.id));
      if (sql.includes("FOR UPDATE") && options.currentScopes) rows = options.currentScopes(rows);
      return [observe(rows, sql.includes("FOR UPDATE") ? "scopes" : "discoveredScopes")];
    }
    if (sql.includes("FROM inventory_stocktake_lines")) {
      let rows = state.lines.filter(row => Number(row.stocktake_id) === params[0]).sort((a, b) => Number(a.id) - Number(b.id));
      if (sql.includes("FOR UPDATE") && options.currentLines) rows = options.currentLines(rows);
      return [observe(rows, sql.includes("FOR UPDATE") ? "rows" : "discoveredLines")];
    }
    if (sql.includes("FROM inventory_lots")) {
      const rows = state.lots.filter(row => params.includes(Number(row.id))).sort((a, b) => Number(a.sku_id) - Number(b.sku_id) || a.normalized_lot_number.localeCompare(b.normalized_lot_number) || Number(a.id) - Number(b.id));
      return [observe(rows, sql.includes("FOR UPDATE") ? "lots" : "discoveredLots")];
    }
    if (sql.includes("FROM inventory_movements")) {
      const rows = selectRows(sql, params, state.movements).sort((a, b) => Number(a.id) - Number(b.id));
      const limit = /\bLIMIT\s+(\d+)/iu.exec(sql);
      return [limit ? rows.slice(0, Number(limit[1])) : rows];
    }
    if (sql.includes("FROM inventory_stock_balances")) {
      const available = sql.includes("LEFT JOIN inventory_lots");
      let rows = selectRows(sql, params, state.balances).sort(bucketOrder);
      if (available && options.availableRows) rows = options.availableRows(rows, params[1]);
      return [observe(rows, available ? "available" : "balances")];
    }
    throw new Error(`unexpected Post lookup read: ${sql}`);
  },
  execute: async ({ sql, params, state }) => {
    options.onExecute?.({ sql, params, state });
    if (sql.includes("INSERT INTO inventory_operation_requests")) {
      const source = JSON.stringify(params.slice(1, 6));
      if (state.operations.some(row => row.source === source)) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      const id = state.operations.length + 21;
      state.operations.push({ id, source, request_hash: params[6], actor_user_id: params[7], completed_at: null });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (sql.includes("UPDATE inventory_operation_requests SET actor_user_id")) {
      state.operations.find(row => row.id === params[1]).actor_user_id = params[0]; return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE inventory_operation_requests")) {
      Object.assign(state.operations.find(row => row.id === params[4]), { result_type: params[0], result_id: params[1], result_summary: params[2], completed_at: params[3] }); return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO inventory_audit_logs")) {
      if (++auditWrites === options.failAudit) throw options.error;
      const rows = insertRows(sql, params);
      const columns = ["occurred_at", "actor_user_id", "actor_label", "action", "target_type", "target_id", "target_label", "outcome",
        "reason_category", "reason_text", "before_summary", "after_summary", "operation_request_id", "request_id", "correlation_id", "ip"];
      for (const row of rows) state.audits.push(columns.map(column => row[column]));
      return [{ affectedRows: rows.length }];
    }
    if (sql.includes("INSERT INTO inventory_stock_balances")) {
      if (!sql.includes("0,0,NULL,1")) {
        const rows = insertRows(sql, params), insertId = 500 + state.balances.length;
        for (const row of rows) state.balances.push({ ...row, id: 500 + state.balances.length, lot_scope: row.lot_id ?? 0 });
        return [{ insertId, affectedRows: rows.length }];
      }
      const id = 500 + state.balances.length;
      state.balances.push({ id, warehouse_id: params[0], bin_id: params[1], sku_id: params[2], lot_id: params[3], lot_scope: params[3] ?? 0,
        stock_status: params[4], on_hand_quantity: 0, allocated_quantity: 0, fifo_anchor_date: null, version: 1 });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (sql.includes("UPDATE inventory_stock_balances")) {
      if (++balanceWrites === options.failBalance) throw options.error;
      if (sql.includes("CASE")) return [{ affectedRows: updateRows(sql, params, state.balances) }];
      const row = state.balances.find(row => Number(row.id) === Number(params[3]) && Number(row.version) === params[4]);
      if (!row) return [{ affectedRows: 0 }];
      Object.assign(row, { on_hand_quantity: params[0], fifo_anchor_date: params[1], version: Number(row.version) + 1 }); return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO inventory_movements")) {
      if (!sql.includes("'STOCKTAKE_VARIANCE','BIN'")) {
        const rows = insertRows(sql, params), insertId = 801 + state.movements.length;
        for (let index = 0; index < rows.length; index++) {
          const values = params.slice(index * 26, (index + 1) * 26);
          state.movements.push({ ...rows[index], id: 801 + state.movements.length, params: [...values.slice(0, 2), ...values.slice(4)] });
        }
        return [{ insertId, affectedRows: rows.length }];
      }
      const id = 801 + state.movements.length; state.movements.push({ id, params }); return [{ insertId: id, affectedRows: 1 }];
    }
    if (sql.includes("UPDATE inventory_stocktake_lines SET movement_id")) {
      if (sql.includes("CASE")) return [{ affectedRows: updateRows(sql, params, state.lines) }];
      const row = state.lines.find(row => Number(row.id) === Number(params[1]));
      Object.assign(row, { movement_id: params[0], version: Number(row.version) + 1 }); return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE inventory_stocktakes SET status = 'POSTED'")) {
      Object.assign(state.headers[0], { status: "POSTED", version: Number(state.headers[0].version) + 1, reason: params[0], post_operation_id: params[1] }); return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE inventory_bin_locks")) { state.released.push(params); return [{ affectedRows: 1 }]; }
    throw new Error(`unexpected Post lookup write: ${sql}`);
  } });
  const transaction = database.withTransaction.bind(database);
  database.withTransaction = async work => {
    stats.transactions++;
    try { const result = await transaction(work); stats.commits++; return result; }
    catch (error) { stats.rollbacks++; throw error; }
  };
  const locks = { lockForCommand: async (tx, input) => {
    stats.locks.push(input);
    return { warehouses: [{ id: 1, warehouse_code: "W1", status: "ACTIVE" }],
      bins: observe(options.bins ?? input.binIds.map(id => ({ id, bin_code: `B${id}`, warehouse_id: 1, status: "ACTIVE" })), "bins"),
      stockControls: observe(tx.state.controls, "controls"), binLocks: options.binLocks ?? tx.state.scopes.map(row => ({ id: 80 + Number(row.bin_id),
        stocktake_id: 41, stocktake_bin_id: row.id, bin_id: row.bin_id, released_at: null, lock_type: "STOCKTAKE" })) };
  } };
  const itemLookup = { getInventoryProfileInTransaction: async (_tx, skuId) => {
    stats.profiles.push(skuId);
    return options.profiles?.get(skuId) ?? { skuId, skuCode: `SKU${skuId}`, skuName: "synthetic", inventoryTracked: true, usable: true,
      trackingPolicy: initial.lots?.some(row => Number(row.sku_id) === skuId) ? "batch_expiry" : "none", minimumSaleLifeDays: options.minimumSaleLifeDays ?? 0,
      baseUom: { uomId: 1, uomCode: "EA" } };
  } };
  const clock = options.time ?? time;
  const inventoryProfileLookupFactory = tx => ({ async findManyByIds(ids) {
    const result = new Map();
    for (const skuId of ids) {
      const profile = await itemLookup.getInventoryProfileInTransaction(tx, skuId);
      result.set(skuId, { ...profile, uoms: [{ ...profile.baseUom, isBase: true, toBaseFactor: 1 }] });
    }
    return result;
  } });
  return { database, observed, stats, options, clock, service: new InventoryStocktakeService({ database, time: clock, logger: { error() {} }, locks, itemLookup, inventoryProfileLookupFactory }) };
}
async function post(f, input = request()) { return f.service.post(input, proof(input, f.clock)); }
async function rejectsUnchanged(f, code) {
  const before = f.database.state;
  await assert.rejects(post(f), { code });
  assert.deepEqual(f.database.state, before);
  assert.equal(f.stats.commits, 0);
}
function lotLine(changes = {}) { return { ...line, sku_id: 13, lot_id: 1, ...changes }; }
function lotBalance(changes = {}) { return { ...balance, sku_id: 13, lot_id: 1, lot_scope: 1, expiry_date: lot.expiry_date, ...changes }; }

test("ST041-PU01 empty and all-zero Post preserve strong proof, scalar replay and own unlock without stock effects", async () => {
  for (const lines of [[], [{ ...line, counted_quantity: 4, variance_quantity: 0 }]]) {
    const f = fixture({ lines, controls: [] }), before = f.database.state, input = request();
    await assert.rejects(f.service.post(input, {}), { code: "PERMISSION_STALE" });
    const result = await post(f, input), after = f.database.state;
    assert.deepEqual(result, { id: 41, operationId: 21, status: "POSTED", version: 4, rowCount: 0, movementGroupId: null });
    assert.deepEqual(after.balances, before.balances); assert.deepEqual(after.lines, before.lines);
    assert.deepEqual(after.movements, []); assert.equal(after.audits.length, 1); assert.equal(after.released.length, 1);
    assert.equal(after.operations[0].actor_user_id, 7); assert.deepEqual(JSON.parse(after.operations[0].result_summary), result);
    assert.deepEqual(await post(f, input), result); assert.deepEqual(f.database.state, after);
    assert.equal(f.database.calls.filter(call => call.sql.includes("FROM users")).length, 4);
  }
});

test("ST041-PU02 complete Bin/SKU/NULL-Lot/status buckets keep original locked values and line order", async () => {
  const lines = [line, ...["AVAILABLE", "DAMAGED", "QUARANTINED"].map((stock_status, i) => lotLine({ id: 202 + i, stock_balance_id: 302 + i, stock_status, counted_quantity: i + 1, variance_quantity: i - 3 })),
    { ...line, id: 205, stocktake_bin_id: 102, bin_id: 2, stock_balance_id: 305 },
    lotLine({ id: 206, lot_id: 2, stock_balance_id: 306 })];
  const balances = lines.map(row => ({ ...balance, id: row.stock_balance_id, bin_id: row.bin_id, sku_id: row.sku_id, lot_id: row.lot_id,
    lot_scope: row.lot_id ?? 0, stock_status: row.stock_status, fifo_anchor_date: `2026-01-0${row.id - 200}`, expiry_date: row.lot_id ? lot.expiry_date : null })).reverse();
  const f = fixture({ lines, balances, lots: [lot, { ...lot, id: 2, normalized_lot_number: "second", lot_number: "second" }],
    scopes: [scope, { ...scope, id: 102, bin_id: 2 }], controls: [{ sku_id: 12, reserved_quantity: 0 }, { sku_id: 13, reserved_quantity: 0 }] });
  const result = await post(f); assert.equal(result.rowCount, 6);
  assert.deepEqual(f.database.state.movements.map(row => row.params.slice(3, 7)), lines.map(row => [row.bin_id, row.sku_id, row.lot_id, row.stock_status]));
  for (const row of f.database.state.balances) {
    assert.equal(row.on_hand_quantity, lines.find(line => line.stock_balance_id === row.id).counted_quantity);
    assert.equal(row.fifo_anchor_date, balances.find(balance => balance.id === row.id).fifo_anchor_date);
  }
});

test("ST041-PU03 zero/one/duplicate balance matches retain snapshot identity and count semantics", async () => {
  await post(fixture());
  await post(fixture({ lines: [{ ...line, stock_balance_id: null, snapshot_quantity: 0, snapshot_balance_version: 0, variance_quantity: 7 }], balances: [] }));
  for (const initial of [{ balances: [] }, { balances: [balance, { ...balance, id: 302 }] },
    { balances: [{ ...balance, id: 302 }] }, { lines: [{ ...line, stock_balance_id: null, snapshot_quantity: 0, snapshot_balance_version: 0, variance_quantity: 7 }] },
    { balances: [], lines: [{ ...line, stock_balance_id: null, snapshot_quantity: 1, snapshot_balance_version: 0, variance_quantity: 6 }] },
    { balances: [], lines: [{ ...line, stock_balance_id: null, snapshot_quantity: 0, snapshot_balance_version: 1, variance_quantity: 7 }] }]) {
    await rejectsUnchanged(fixture(initial), "STOCKTAKE_SNAPSHOT_MISMATCH");
  }
});

test("ST041-PU04 off-book gains use only registered Lots and roll back the second balance side effect", async () => {
  const initial = { lots: [{ ...lot, expiry_date: "2020-01-01", first_receipt_date: "2019-01-01", manufacture_date: null }], balances: [],
    lines: [lotLine({ stock_balance_id: null, snapshot_quantity: 0, snapshot_balance_version: 0, variance_quantity: 7 }),
      lotLine({ id: 202, stock_status: "DAMAGED", stock_balance_id: null, snapshot_quantity: 0, snapshot_balance_version: 0, variance_quantity: 7 })], controls: [{ sku_id: 13, reserved_quantity: 0 }] };
  const f = fixture(initial); await post(f);
  assert.deepEqual(f.database.state.lots, initial.lots);
  assert.deepEqual(f.database.state.balances.map(row => [row.lot_id, row.on_hand_quantity, row.fifo_anchor_date]), [[1, 7, null], [1, 7, null]]);
  assert.equal(f.database.calls.some(call => /INSERT INTO inventory_lots/u.test(call.sql)), false);
  const fault = new Error("second balance fault"), g = fixture(initial, { failBalance: 2, error: fault }), before = g.database.state;
  await assert.rejects(post(g), error => error === fault); assert.deepEqual(g.database.state, before);
});

test("ST041-PU05 snapshot pins, bucket identity, versions and unsafe quantities reject before partial updates", async () => {
  for (const changes of [{ id: 302 }, { bin_id: 2 }, { sku_id: 13 }, { lot_id: 1 }, { stock_status: "DAMAGED" },
    { on_hand_quantity: 5 }, { version: 2 }, { on_hand_quantity: Number.MAX_SAFE_INTEGER + 1 }]) {
    await rejectsUnchanged(fixture({ balances: [{ ...balance, ...changes }] }), "STOCKTAKE_SNAPSHOT_MISMATCH");
  }
  for (const changes of [{ counted_quantity: Number.MAX_SAFE_INTEGER + 1 }, { variance_quantity: null }, { variance_quantity: 2 },
    { movement_id: 801 }, { is_not_found: 1 }, { counted_quantity: null }]) {
    await rejectsUnchanged(fixture({ lines: [{ ...line, ...changes }] }), "STOCKTAKE_SNAPSHOT_MISMATCH");
  }
  await rejectsUnchanged(fixture({}, { currentLines: rows => rows.map(row => ({ ...row, version: 3 })) }), "STOCKTAKE_SNAPSHOT_MISMATCH");
  await rejectsUnchanged(fixture({ lines: [{ ...line, version: 4294967295 }] }), "CONCURRENT_OPERATION");
  await rejectsUnchanged(fixture({ balances: [{ ...balance, version: 4294967295 }], lines: [{ ...line, snapshot_balance_version: 4294967295 }] }), "CONCURRENT_OPERATION");
});

test("ST041-PU06 scope id plus Bin and original row validation order determine the first error", async () => {
  for (const changes of [{ stocktake_bin_id: 102 }, { bin_id: 2 }]) await rejectsUnchanged(fixture({ lines: [{ ...line, ...changes }] }), "STOCKTAKE_SNAPSHOT_MISMATCH");
  await rejectsUnchanged(fixture({ scopes: [scope, { ...scope, id: 102, bin_id: 2 }],
    lines: [{ ...line, stocktake_bin_id: 102 }] }), "STOCKTAKE_SNAPSHOT_MISMATCH");
  const badCount = { ...line, id: 202, stock_status: "DAMAGED", stock_balance_id: 302, counted_quantity: -1 };
  const badTracking = { ...line, lot_id: 1 }, balances = [{ ...balance, lot_id: 1, lot_scope: 1 }, { ...balance, id: 302, stock_status: "DAMAGED" }];
  await rejectsUnchanged(fixture({ lines: [badTracking, badCount], balances }), "LOT_DATA_CONFLICT");
  await rejectsUnchanged(fixture({ lines: [{ ...badCount, id: 201 }, { ...badTracking, id: 202 }], balances }), "STOCKTAKE_SNAPSHOT_MISMATCH");
  await rejectsUnchanged(fixture({ lines: [{ ...line, counted_quantity: 0, variance_quantity: -4, lot_id: 1 }],
    balances: [{ ...balance, allocated_quantity: 1, lot_id: 1, lot_scope: 1 }] }), "INSUFFICIENT_STOCK");
  await rejectsUnchanged(fixture({}, { binLocks: [] }), "STOCKTAKE_STATE_CONFLICT");
});

test("ST041-PU07 allocated remains a per-bucket floor that another bucket gain cannot cover", async () => {
  const gain = { ...line, id: 202, stock_status: "DAMAGED", stock_balance_id: 302, counted_quantity: 20, variance_quantity: 16 };
  await rejectsUnchanged(fixture({ lines: [{ ...line, counted_quantity: 1, variance_quantity: -3 }, gain],
    balances: [{ ...balance, allocated_quantity: 2 }, { ...balance, id: 302, stock_status: "DAMAGED" }] }), "INSUFFICIENT_STOCK");
  await rejectsUnchanged(fixture({ balances: [{ ...balance, allocated_quantity: 5 }] }), "INSUFFICIENT_STOCK");
  const f = fixture({ lines: [{ ...line, counted_quantity: 2, variance_quantity: -2 }], balances: [{ ...balance, allocated_quantity: 2 }] });
  await post(f); assert.equal(f.database.state.balances[0].allocated_quantity, 2);
});

test("ST041-PU08 final Reserved covers the whole same-SKU effect and excludes unsaleable stock with safe sums", async () => {
  const loss = { ...line, counted_quantity: 1, variance_quantity: -3 };
  const gain = { ...line, id: 202, bin_id: 2, stocktake_bin_id: 102, stock_balance_id: null, snapshot_quantity: 0, snapshot_balance_version: 0, counted_quantity: 3, variance_quantity: 3 };
  const initial = { lines: [loss, gain], scopes: [scope, { ...scope, id: 102, bin_id: 2 }], controls: [{ sku_id: 12, reserved_quantity: 4 }] };
  const f = fixture(initial); await post(f); assert.deepEqual(f.database.state.balances.map(row => row.on_hand_quantity), [1, 3]);
  for (const stock_status of ["DAMAGED", "QUARANTINED"]) await rejectsUnchanged(fixture({ ...initial, lines: [loss, { ...gain, stock_status }] }), "INSUFFICIENT_ATP");
  await rejectsUnchanged(fixture({ ...initial, lines: [loss, { ...gain, sku_id: 14 }], controls: [{ sku_id: 12, reserved_quantity: 4 }, { sku_id: 14, reserved_quantity: 0 }] }), "INSUFFICIENT_ATP");
  const uncovered = fixture({ controls: [{ sku_id: 12, reserved_quantity: 9 }] }); await post(uncovered);
  assert.equal(uncovered.database.state.controls[0].reserved_quantity, 9);
  await rejectsUnchanged(fixture({ lines: [loss], balances: [balance, { ...balance, id: 302, bin_id: 2, expiry_date: "2020-01-01", on_hand_quantity: 100 }], controls: [{ sku_id: 12, reserved_quantity: 4 }] }), "INSUFFICIENT_ATP");
  await rejectsUnchanged(fixture({ balances: [balance, { ...balance, id: 302, bin_id: 2, on_hand_quantity: Number.MAX_SAFE_INTEGER }] }), "STOCKTAKE_SNAPSHOT_MISMATCH");
});

test("ST041-PU09 Number-equivalent Control and Bin keys keep their first match and missing dependency errors", async () => {
  const bins = [{ id: "1", warehouse_id: "1", status: "ACTIVE", bin_code: "FIRST" }, { id: 1, warehouse_id: 1, status: "INACTIVE", bin_code: "LAST" }];
  const f = fixture({ controls: [{ sku_id: "12", reserved_quantity: 0 }, { sku_id: 12, reserved_quantity: Number.MAX_SAFE_INTEGER }] }, { bins });
  await post(f); assert.equal(f.database.state.movements[0].params[18], "FIRST");
  await rejectsUnchanged(fixture({ controls: [] }), "INVENTORY_DEPENDENCY_UNAVAILABLE");
  await rejectsUnchanged(fixture({}, { bins: [] }), "BIN_INVALID");
  await rejectsUnchanged(fixture({}, { bins: [...bins].reverse() }), "BIN_INVALID");
  await rejectsUnchanged(fixture({ lines: [{ ...line, counted_quantity: 1, variance_quantity: -3 }],
    controls: [{ sku_id: "12", reserved_quantity: 4 }, { sku_id: 12, reserved_quantity: 0 }] }), "INSUFFICIENT_ATP");
});

test("ST041-PU10 Number-equivalent Lot keys preserve first match, tracking and all original date rules", async () => {
  const initial = { lines: [lotLine()], balances: [lotBalance()], controls: [{ sku_id: 13, reserved_quantity: 0 }] };
  const f = fixture({ ...initial, lots: [{ ...lot, id: "1", normalized_lot_number: "a", lot_number: "FIRST" }, { ...lot, normalized_lot_number: "z", lot_number: "LAST", first_receipt_date: null }] });
  await post(f); assert.equal(f.database.state.movements[0].params[19], "FIRST");
  for (const [changes, code] of [[{ first_receipt_date: null }, "LOT_DATA_CONFLICT"], [{ expiry_date: null }, "EXPIRY_REQUIRED"],
    [{ manufacture_date: "2028-01-01" }, "LOT_DATA_CONFLICT"], [{ expiry_date: "2026-02-30" }, "INVENTORY_INPUT_INVALID"]]) {
    await rejectsUnchanged(fixture({ ...initial, lots: [{ ...lot, ...changes }, { ...lot, normalized_lot_number: "z" }] }), code);
  }
  await rejectsUnchanged(fixture({ ...initial, lots: [{ ...lot, sku_id: 14 }] }), "LOT_DATA_CONFLICT");
  await rejectsUnchanged(fixture({ ...initial, lots: [] }), "LOT_DATA_CONFLICT");
  await rejectsUnchanged(fixture({ lines: [line], lots: [lot], balances: [balance] }, { profiles: new Map([[12, { inventoryTracked: true, usable: true, baseUom: {}, trackingPolicy: "batch_expiry" }]]) }), "LOT_DATA_CONFLICT");
  const lowLife = fixture({ ...initial, lots: [{ ...lot, expiry_date: "2026-10-13" }], balances: [lotBalance({ expiry_date: "2026-10-13" })] }, { minimumSaleLifeDays: 30 });
  await post(lowLife); assert.equal(lowLife.database.state.balances[0].on_hand_quantity, 7);
  const outsideLowLife = fixture({ ...initial, lines: [lotLine({ counted_quantity: 1, variance_quantity: -3 })],
    lots: [lot, { ...lot, id: 2, lot_number: "near-expiry", normalized_lot_number: "near-expiry", expiry_date: "2026-10-13" }],
    balances: [lotBalance(), lotBalance({ id: 302, bin_id: 2, lot_id: 2, lot_scope: 2, expiry_date: "2026-10-13", on_hand_quantity: 100 })],
    controls: [{ sku_id: 13, reserved_quantity: 4 }] }, { minimumSaleLifeDays: 30 });
  await rejectsUnchanged(outsideLowLife, "INSUFFICIENT_ATP");
});

test("ST041-PU11 fresh current authorization gates scalar replay and command-local data never becomes a cache", async () => {
  const options = {}, f = fixture({}, options), input = request(), capsule = proof(input);
  const result = await f.service.post(input, capsule), after = f.database.state;
  await assert.rejects(f.service.post(input, capsule), { code: "PERMISSION_STALE" });
  assert.deepEqual(await post(f, input), result); assert.deepEqual(f.database.state, after);
  assert.equal(f.stats.locks.length, 1); assert.deepEqual(f.stats.profiles, [12]);
  options.permissions = ["inventory.view"];
  await assert.rejects(post(f, input), { code: "PERMISSION_STALE" }); assert.deepEqual(f.database.state, after);
  options.permissions = permissions;
  await assert.rejects(post(f, { ...input, payload: { ...input.payload, reason: "changed" } }), { code: "INVENTORY_SOURCE_CONFLICT" });
  await assert.rejects(post(f), { code: "VERSION_CONFLICT" }); assert.deepEqual(f.database.state, after);
  assert.equal(f.stats.locks.length, 2);
  for (const [changes, code] of [[{ tokenVersion: 1 }, "JWT_INVALID"], [{ device: { status: "revoked" } }, "DEVICE_REVOKED"],
    [{ device: { public_key: Buffer.from("changed") } }, "DEVICE_MISMATCH"]]) await rejectsUnchanged(fixture({}, changes), code);
});

// Frozen old-source SQL oracle. Whitespace is intentional: lookup-only changes must preserve SQL bytes.
const sqlOracle = {
  users: "SELECT id, username, status FROM users WHERE id = ?",
  roles: "SELECT ur.role_id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id\n    WHERE ur.user_id = ? ORDER BY ur.role_id",
  permissions: "SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id\n      WHERE rp.role_id = ? ORDER BY rp.permission_id",
  devices: "SELECT id, user_id, device_id, public_key, status FROM user_devices\n    WHERE user_id = ? AND device_id = ?",
  versions: "SELECT version FROM fr_token_versions WHERE subject = ?",
  claim: "INSERT INTO inventory_operation_requests\n           (command_type, source_module, source_document_type, source_document_id,\n            source_line_id, source_event_id, request_hash, actor_user_id, actor_label,\n            request_id, correlation_id, created_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  header: "SELECT * FROM inventory_stocktakes WHERE id = ?",
  scopes: "SELECT * FROM inventory_stocktake_bins WHERE stocktake_id = ? ORDER BY bin_id,id",
  lines: "SELECT * FROM inventory_stocktake_lines WHERE stocktake_id = ? ORDER BY id",
  balances: "SELECT *,DATE_FORMAT(fifo_anchor_date,'%Y-%m-%d') AS fifo_anchor_date\n      FROM inventory_stock_balances WHERE warehouse_id = ? AND bin_id IN (?)\n      ORDER BY warehouse_id,sku_id,bin_id,lot_scope,stock_status FOR UPDATE",
  available: "SELECT b.*,DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry_date FROM inventory_stock_balances b\n        LEFT JOIN inventory_lots l ON l.id = b.lot_id WHERE b.warehouse_id = ? AND b.sku_id = ? AND b.stock_status = 'AVAILABLE'\n        ORDER BY b.warehouse_id,b.sku_id,b.bin_id,b.lot_scope,b.stock_status FOR SHARE",
  bind: "UPDATE inventory_operation_requests SET actor_user_id = ?\n      WHERE id = ? AND command_type = ? AND actor_user_id IS NULL AND completed_at IS NULL",
  update: "UPDATE inventory_stock_balances SET on_hand_quantity = ?,fifo_anchor_date = ?,version = version + 1,updated_at = ?\n        WHERE id = ? AND version = ?",
  movement: "INSERT INTO inventory_movements\n        (movement_group_id,operation_request_id,movement_type,location_kind,warehouse_id,bin_id,sku_id,lot_id,stock_status,direction,\n         quantity,balance_before,balance_after,balance_version_after,stocktake_id,stocktake_line_id,reason_text,\n         sku_code_snapshot,sku_name_snapshot,warehouse_code_snapshot,bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,posted_at,posted_by,posted_by_label)\n        VALUES (?,?,'STOCKTAKE_VARIANCE','BIN',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  link: "UPDATE inventory_stocktake_lines SET movement_id = ?,version = version + 1\n        WHERE id = ? AND stocktake_id = ? AND version = ? AND movement_id IS NULL",
  audit: "INSERT INTO inventory_audit_logs\n         (occurred_at, actor_user_id, actor_label, action, target_type, target_id,\n          target_label, outcome, reason_category, reason_text, before_summary,\n          after_summary, operation_request_id, request_id, correlation_id, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  post: "UPDATE inventory_stocktakes SET status = 'POSTED',reason = ?,post_operation_id = ?,\n      posted_at = ?,posted_by = ?,updated_at = ?,updated_by = ?,version = version + 1\n      WHERE id = ? AND version = ? AND status = 'READY_TO_POST'",
  release: "UPDATE inventory_bin_locks SET released_at = ?,released_by = ?,release_reason = ?\n        WHERE id = ? AND stocktake_id = ? AND stocktake_bin_id = ? AND bin_id = ? AND released_at IS NULL AND lock_type = 'STOCKTAKE'",
  complete: "UPDATE inventory_operation_requests\n          SET result_type = ?, result_id = ?, result_summary = ?, completed_at = ?\n        WHERE id = ? AND completed_at IS NULL"
};
test("ST041-PU12 exact SQL and parameter order, second Audit rollback and native error identity stay unchanged", async () => {
  const f = fixture(), input = request(), result = await post(f, input), now = time.nowMs();
  const q = (sql, params) => ({ method: "query", sql, params }), e = (sql, params) => ({ method: "execute", sql, params });
  const auth = suffix => [q(sqlOracle.users + suffix, [7]), q(sqlOracle.roles + suffix, [7]), q(sqlOracle.permissions + suffix, [1]),
    q(sqlOracle.devices + suffix, [7, binding.device_id]), q(sqlOracle.versions + suffix, ["7"])];
  const audit = (before, after) => e(sqlOracle.audit, [now, 7, "synthetic", "stocktake.post", "stocktake", 41, "ST-41", "SUCCEEDED", "", "",
    JSON.stringify(before), JSON.stringify(after), 21, input.correlationId, input.correlationId, ""]);
  assert.deepEqual(f.database.calls, [...auth(""), e(sqlOracle.claim, ["STOCKTAKE_POST", ...Object.values(input.source),
    inventoryOperationHash({ commandType: "STOCKTAKE_POST", payload: input.payload }), null, "synthetic", input.correlationId, input.correlationId, now]),
  q(sqlOracle.header, [41]), q(sqlOracle.scopes, [41]), q(sqlOracle.lines, [41]), q(sqlOracle.balances, [1, 1]),
  q(sqlOracle.header + " ORDER BY id FOR UPDATE", [41]), q(sqlOracle.scopes + " FOR UPDATE", [41]), q(sqlOracle.lines + " FOR UPDATE", [41]),
  q(sqlOracle.available, [1, 12]), ...auth(" FOR SHARE"), e(sqlOracle.bind, [7, 21, "STOCKTAKE_POST"]),
  e(sqlOracle.update, [7, "2026-01-01", now, 301, 1]), e(sqlOracle.movement, [result.movementGroupId, 21, 1, 1, 12, null, "AVAILABLE", "IN", 3, 4, 7, 2, 41, 201,
    input.payload.reason, "SKU12", "synthetic", "W1", "B1", "", null, now, 7, "synthetic"]), e(sqlOracle.link, [801, 201, 41, 2]),
  audit({ id: 201, stocktakeId: 41, quantity: 4, version: 1, status: "AVAILABLE", movementId: null }, { id: 201, stocktakeId: 41, quantity: 7, version: 2, status: "AVAILABLE", movementId: 801 }),
  e(sqlOracle.post, [input.payload.reason, 21, now, 7, now, 7, 41, 3]), e(sqlOracle.release, [now, 7, "POSTED", 81, 41, 101, 1]),
  audit({ stocktakeId: 41, status: "READY_TO_POST", version: 3 }, { stocktakeId: 41, status: "POSTED", version: 4, rowCount: 1 }),
  e(sqlOracle.complete, ["STOCKTAKE", "41", JSON.stringify(result), now, 21])]);
  assert.deepEqual(f.stats.locks, [{ warehouseIds: [1], binIds: [1], now, stockControls: [{ warehouseId: 1, skuId: 12 }], lots: [] }]);
  assert.deepEqual([f.stats.transactions, f.stats.commits, f.stats.rollbacks], [1, 1, 0]);
  for (const native of [new Error("second Audit failure"), Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }),
    Object.assign(new Error("wrapped lock timeout"), { cause: { code: "ER_LOCK_WAIT_TIMEOUT" } })]) {
    const g = fixture({}, { failAudit: 2, error: native }), before = g.database.state;
    await assert.rejects(post(g), error => native.code === "ER_LOCK_DEADLOCK" || native.cause ? error.code === "CONCURRENT_OPERATION" : error === native);
    assert.deepEqual(g.database.state, before); assert.deepEqual([g.stats.transactions, g.stats.commits, g.stats.rollbacks], [1, 0, 1]);
  }
});

function costFixture(size) {
  const lines = [], balances = [], lots = [], controls = new Map();
  for (let i = 0; i < size; i++) {
    const key = size - i - 1, part = key % 7, group = Math.floor(key / 7), sku_id = 100 + group * 2 + (part === 0 ? 0 : 1);
    const lot_id = part === 0 ? null : group * 2 + (part <= 3 ? 1 : 2), stock_status = part === 0 ? "AVAILABLE" : ["AVAILABLE", "DAMAGED", "QUARANTINED"][(part - 1) % 3];
    lines.push({ ...line, id: 201 + i, stock_balance_id: 301 + i, sku_id, lot_id, stock_status, counted_quantity: 5, variance_quantity: 1 });
    balances.push({ ...balance, id: 301 + i, sku_id, lot_id, lot_scope: lot_id ?? 0, stock_status, expiry_date: lot_id ? lot.expiry_date : null });
    controls.set(sku_id, { sku_id, reserved_quantity: 0 });
    if (lot_id !== null && !lots.some(row => row.id === lot_id)) lots.push({ ...lot, id: lot_id, sku_id, lot_number: `L${lot_id}`, normalized_lot_number: `l${lot_id}` });
  }
  const initial = { lines, balances, lots, controls: [...controls.values()].sort((a, b) => a.sku_id - b.sku_id) };
  const availableRows = balances.filter(row => row.stock_status === "AVAILABLE").length;
  const denominator = lines.length + balances.length + lots.length + controls.size + 1 + 1 + availableRows;
  return { initial, denominator, availableRows };
}
function assertObservedBudget(f, denominator) {
  assert.equal(f.observed.returned.discoveredLines, f.observed.returned.rows);
  assert.equal(f.observed.returned.discoveredScopes, 1); assert.equal(f.observed.returned.scopes, 1); assert.equal(f.observed.returned.bins, 1);
  assert.ok(f.observed.reads > 0); assert.ok(f.observed.reads <= 128 * denominator);
}
test("ST041-PU13 actual Post reverse-key full dimensions meet the bounded key-read budget at N=100 and N=1000", async () => {
  const failures = [];
  for (const size of [100, 1000]) {
    const { initial, denominator, availableRows } = costFixture(size), f = fixture(initial, { observe: true, limit: 128 * denominator });
    try {
      const result = await post(f); assert.equal(result.rowCount, size); assert.equal(f.observed.availableRows, availableRows);
      assertObservedBudget(f, denominator); assert.equal(f.database.state.movements.length, size);
      assert.deepEqual(f.database.state.movements.map(row => row.params[13]), initial.lines.map(row => row.id));
      assert.ok(f.database.state.balances.every(row => row.on_hand_quantity === 5 && row.version === 2));
    } catch (error) { failures.push(Object.assign(error, { fixtureSize: size })); }
  }
  if (failures.length) throw new AggregateError(failures, "Post lookup budget regression at the recorded fixture sizes (test-only observation tripwire)");
});

test("ST041-PU14 all AVAILABLE returns count in the fixed-Bin budget, including excluded/outside/duplicate rows and error order", async () => {
  const failures = [];
  // This second large fixture catches a mutation that restores a scoped full scan, independently of the outside-Bin cases.
  const large = costFixture(1000), g = fixture(large.initial, { observe: true, limit: 128 * large.denominator });
  try { await post(g); assertObservedBudget(g, large.denominator); } catch (error) { failures.push(error); }
  for (const outside of [1000, 10000]) {
    const extras = Array.from({ length: outside }, (_, i) => ({ ...balance, id: 1000 + i, bin_id: 2 + Math.floor(i / 2),
      lot_id: i % 2 ? 2 : 1, lot_scope: i % 2 ? 2 : 1, on_hand_quantity: i % 2 ? Number.MAX_SAFE_INTEGER : 1,
      expiry_date: i % 2 ? "2020-01-01" : "2027-01-01" }));
    // Repeated query rows deliberately remain repeated in the denominator and the safe sums.
    const availableRows = rows => [...rows, rows.at(-2)];
    const expectedAvailable = outside + 2, denominator = 1 + 1 + 0 + 1 + 1 + 1 + expectedAvailable;
    const f = fixture({ balances: [balance, ...extras] }, { observe: true, limit: 128 * denominator, availableRows });
    try {
      await post(f); assert.equal(f.observed.availableRows, expectedAvailable); assertObservedBudget(f, denominator);
      assert.equal(f.observed.returned.balances, 1); assert.equal(f.database.state.movements.length, 1);
      assert.deepEqual(f.database.state.balances.slice(1), extras);
      assert.deepEqual(f.database.calls.filter(call => call.sql === sqlOracle.available).map(call => call.params), [[1, 12]]);
    } catch (error) { failures.push(error); }
  }
  const repeated = fixture({ balances: [balance, { ...balance, id: 302, bin_id: 2, on_hand_quantity: Number.MAX_SAFE_INTEGER - 7 }] },
    { observe: true, limit: 128 * 8, availableRows: rows => [...rows, rows.at(-1)] });
  await rejectsUnchanged(repeated, "STOCKTAKE_SNAPSHOT_MISMATCH");
  assert.equal(repeated.observed.availableRows, 3); assert.equal(repeated.observed.returned.balances, 1);
  assertObservedBudget(repeated, 8);
  for (const on_hand_quantity of [Number.MAX_SAFE_INTEGER - 7, Number.MAX_SAFE_INTEGER - 6]) {
    const f = fixture({ balances: [balance, { ...balance, id: 302, bin_id: 2, on_hand_quantity }] }, { observe: true, limit: 128 * 7 });
    if (on_hand_quantity === Number.MAX_SAFE_INTEGER - 7) await post(f);
    else await rejectsUnchanged(f, "STOCKTAKE_SNAPSHOT_MISMATCH");
    assert.equal(f.observed.availableRows, 2);
  }
  // Bad snapshot must win over a later invalid expiry in AVAILABLE rows.
  const ordered = fixture({ lines: [{ ...line, variance_quantity: 2 }], balances: [balance, { ...balance, id: 302, bin_id: 2, expiry_date: "bad-date" }] }, { observe: true, limit: 128 * 5 });
  await rejectsUnchanged(ordered, "STOCKTAKE_SNAPSHOT_MISMATCH"); assert.equal(ordered.observed.availableRows, 0);
  if (failures.length) throw new AggregateError(failures, "Fixed-Bin Post lookup boundary regression (test-only observation tripwire)");
});
