/**
 * TASK-012／TC-006／TC-009：operation、audit 同初始不可變 trigger 對真 MySQL 驗收（設計 §4.14–4.16；HD-014）。
 *
 * 所有資料測試喺 transaction 入面做完即刻 ROLLBACK，月份用 2099 年。Trigger 喺 BEFORE 階段跑，比 CHECK／FK 早，
 * 所以每個受保護欄位都用「同原值唔同」嘅運算式去改，唔理新值合唔合法：擋住佢嘅一定要係 trigger。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import mysql from "mysql2/promise";

import { ensureTriggers, up as createOperations } from "../../database/migrations/0114_create_purchasing_operation_requests.js";
import { up as createAudit } from "../../database/migrations/0115_create_purchasing_audit_logs.js";
import {
  LINE_MUTABLE, LINE_PROTECTED, PO_MUTABLE, PO_PROTECTED, up as addTriggers
} from "../../database/migrations/0116_add_purchasing_immutability_triggers.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const MONTH = "209911";
const TABLES = ["purchasing_operation_requests", "purchasing_audit_logs"];
const HASH = "a".repeat(64);

async function connect(t) {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  t.after(() => db.end());
  return db;
}

async function inRollback(db, work) {
  await db.query("START TRANSACTION");
  try { return await work(); } finally { await db.query("ROLLBACK"); }
}

async function rejects(promise, code, text) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`);
    if (text) assert.match(error.message, text);
    return true;
  });
}
const frozen = (promise, text) => rejects(promise, "ER_SIGNAL_EXCEPTION", text);

const insert = async (db, table, row) => (await db.query(`INSERT INTO ${table} SET ?`, row))[0].insertId;

// 同 purchasingMigrations.integration.test.js 嘅主檔 fixture 一樣；第三個檔要用時先抽出嚟。
async function masters(db) {
  const now = Date.now(), tag = randomUUID().replaceAll("-", "").slice(0, 12);
  let currency;
  for (;;) {
    currency = `X${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
    const [rows] = await db.query("SELECT code FROM currencies WHERE code = ?", [currency]);
    if (!rows.length) break;
  }
  await db.query("INSERT INTO currencies SET ?", { code: currency, name: "Probe", decimal_places: 2, status: "ACTIVE",
    version: 1, created_at: now, updated_at: now });
  const user = await insert(db, "users", { username: `op_probe_${tag}`, password_hash: "synthetic", created_at: now, updated_at: now });
  const supplier = await insert(db, "suppliers", { supplier_code: `OPP-${tag}`, supplier_code_key: `opp-${tag}`, supplier_name: "Probe",
    supplier_name_key: "probe", default_currency_code: currency, created_at: now, updated_at: now });
  const item = await insert(db, "items", { name: `Probe ${tag}`, created_at: now, updated_at: now });
  const uom = await insert(db, "item_uoms", { code: `U${tag}`, name: "Each", created_at: now, updated_at: now });
  const sku = await insert(db, "item_skus", { item_id: item, sku_code: `SKU-${tag}`, sku_name: "Probe", created_at: now, updated_at: now });
  const mapping = await insert(db, "item_sku_uoms", { sku_id: sku, uom_id: uom, to_base_factor: 1, created_at: now, updated_at: now });
  return { now, currency, user, supplier, uom, sku, mapping };
}

function order(f, sequence = 1, overrides = {}) {
  return { po_number: `PO-${MONTH}-${String(sequence).padStart(6, "0")}`, document_year_month: MONTH, sequence_no: sequence,
    supplier_id: f.supplier, supplier_code_snapshot: "OPP", supplier_name_snapshot: "Probe", currency_code: f.currency,
    currency_name_snapshot: "Probe", currency_decimal_places_snapshot: 2, order_date: "2099-11-02", buyer_id: f.user,
    buyer_label: "probe", created_at: f.now, updated_at: f.now, created_by: f.user, updated_by: f.user,
    created_by_label: "probe", updated_by_label: "probe", ...overrides };
}

function line(f, purchaseOrderId, overrides = {}) {
  return { purchase_order_id: purchaseOrderId, line_number: 1, sku_id: f.sku, sku_code_snapshot: "SKU", sku_name_snapshot: "SKU",
    tracking_policy_snapshot: "none", inventory_tracked_snapshot: 1, base_uom_id: f.uom, base_uom_code_snapshot: "EA",
    purchase_sku_uom_id: f.mapping, purchase_uom_code_snapshot: "EA", uom_to_base_factor_snapshot: 1,
    ordered_quantity: "1.000000", ordered_base_quantity: 1, unit_price: "1.0000", line_amount: "1.0000",
    created_at: f.now, updated_at: f.now, ...overrides };
}

function operation(overrides = {}) {
  return { command_type: "PO_CREATE", source_document_type: "PURCHASE_ORDER", event_id: randomUUID(), request_hash: HASH,
    actor_label: "probe", created_at: Date.now(), ...overrides };
}

/** 每種型別一個「一定同原值唔同」嘅運算式。 */
async function changeExpressions(db, table, columns) {
  const [rows] = await db.query(`SELECT column_name AS name, data_type AS type FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = ? AND column_name IN (?)`, [table, columns]);
  const expression = ({ name, type }) => {
    if (["bigint", "int", "smallint", "tinyint", "decimal"].includes(type)) return `COALESCE(\`${name}\`, 0) + 1`;
    if (type === "date") return `DATE_ADD(COALESCE(\`${name}\`, '2099-01-01'), INTERVAL 1 DAY)`;
    if (type === "json") return `JSON_OBJECT('changed', COALESCE(\`${name}\`, 1))`;
    if (["varchar", "char"].includes(type)) return `IF(\`${name}\` = 'a', 'b', 'a')`;
    throw new Error(`no change expression for ${table}.${name} (${type})`);
  };
  assert.equal(rows.length, columns.length, `${table}: every listed column exists`);
  return Object.fromEntries(rows.map((row) => [row.name, expression(row)]));
}

integrationTest("TASK-012 migrations create the operation, audit and trigger schema and rerun as no-ops", async (t) => {
  const db = await connect(t);
  const shape = async () => {
    const [columns] = await db.query(`SELECT table_name t, column_name c, column_type ty, is_nullable n, column_default d,
      collation_name co FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN (?)
      ORDER BY table_name, ordinal_position`, [TABLES]);
    const [constraints] = await db.query(`SELECT table_name t, constraint_name n, constraint_type ty FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE() AND table_name IN (?) ORDER BY table_name, constraint_name`, [TABLES]);
    const [indexes] = await db.query(`SELECT table_name t, index_name i, non_unique u, GROUP_CONCAT(column_name ORDER BY seq_in_index) c
      FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name IN (?) GROUP BY table_name, index_name, non_unique
      ORDER BY table_name, index_name`, [TABLES]);
    const [triggers] = await db.query(`SELECT event_object_table t, trigger_name n, event_manipulation e, action_timing w, action_statement s
      FROM information_schema.triggers WHERE trigger_schema = DATABASE()
        AND event_object_table IN ('purchasing_operation_requests', 'purchasing_audit_logs', 'purchase_orders', 'purchase_order_lines',
          'purchasing_document_sequences') ORDER BY trigger_name`);
    return { columns, constraints, indexes, triggers };
  };
  const before = await shape();
  assert.deepEqual(TABLES.map((table) => before.columns.filter((row) => row.t === table).length), [16, 16]);
  const collation = (table, name) => before.columns.find((row) => row.t === table && row.c === name).co;
  for (const name of ["command_type", "source_document_type", "source_document_id", "source_line_id", "event_id", "request_hash"]) {
    assert.equal(collation("purchasing_operation_requests", name), "ascii_bin", name);
  }
  for (const name of ["action", "outcome", "target_type"]) assert.equal(collation("purchasing_audit_logs", name), "ascii_bin", name);
  // 冇任何敏感欄位（SEC-014、SEC-015）。
  assert.deepEqual(before.columns.filter((row) => /password|token|secret|bank|account_no/iu.test(row.c)), []);
  assert.deepEqual(before.constraints.map((row) => `${row.t}.${row.n}:${row.ty}`).sort(), [
    "purchasing_audit_logs.PRIMARY:PRIMARY KEY", "purchasing_audit_logs.chk_purchasing_audit_detail:CHECK",
    "purchasing_audit_logs.chk_purchasing_audit_outcome:CHECK", "purchasing_audit_logs.chk_purchasing_audit_target:CHECK",
    "purchasing_audit_logs.fk_purchasing_audit_actor:FOREIGN KEY",
    "purchasing_operation_requests.PRIMARY:PRIMARY KEY", "purchasing_operation_requests.chk_purchasing_operation_event:CHECK",
    "purchasing_operation_requests.chk_purchasing_operation_hash:CHECK", "purchasing_operation_requests.chk_purchasing_operation_result:CHECK",
    "purchasing_operation_requests.chk_purchasing_operation_source:CHECK", "purchasing_operation_requests.chk_purchasing_operation_summary:CHECK",
    "purchasing_operation_requests.fk_purchasing_operation_actor:FOREIGN KEY",
    "purchasing_operation_requests.uq_purchasing_operation_event:UNIQUE"
  ].sort());
  assert.ok(before.indexes.some((row) => row.i === "uq_purchasing_operation_event" &&
    row.c === "source_document_type,source_document_id,source_line_id,event_id" && Number(row.u) === 0));
  assert.deepEqual(before.triggers.map((row) => `${row.t}.${row.n}:${row.w} ${row.e}`).sort(), [
    "purchase_order_lines.trg_po_lines_delete:BEFORE DELETE", "purchase_order_lines.trg_po_lines_insert:BEFORE INSERT",
    "purchase_order_lines.trg_po_lines_update:BEFORE UPDATE", "purchase_orders.trg_purchase_orders_update:BEFORE UPDATE",
    "purchasing_audit_logs.trg_purchasing_audit_delete:BEFORE DELETE", "purchasing_audit_logs.trg_purchasing_audit_update:BEFORE UPDATE",
    "purchasing_operation_requests.trg_purchasing_operation_delete:BEFORE DELETE",
    "purchasing_operation_requests.trg_purchasing_operation_update:BEFORE UPDATE",
    "purchasing_document_sequences.trg_purchasing_sequence_delete:BEFORE DELETE",
    "purchasing_document_sequences.trg_purchasing_sequence_update:BEFORE UPDATE"
  ].sort());

  // 重跑：trigger 已存在而且一樣，唔使建、唔使 TRIGGER 權限。
  for (const migrate of [createOperations, createAudit, addTriggers]) await migrate(db);
  assert.deepEqual(await shape(), before);
});

integrationTest("TASK-012 an operation is unique per document, line and event, and its identity is validated", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const event = randomUUID();
    await insert(db, "purchasing_operation_requests", operation({ event_id: event, source_document_id: "1" }));
    await rejects(insert(db, "purchasing_operation_requests", operation({ event_id: event, source_document_id: "1", command_type: "PO_UPDATE" })),
      "ER_DUP_ENTRY");
    await insert(db, "purchasing_operation_requests", operation({ event_id: event, source_document_id: "2" }));
    await insert(db, "purchasing_operation_requests", operation({ event_id: event, source_document_id: "1", source_line_id: "7" }));
    const check = (overrides, name) => rejects(insert(db, "purchasing_operation_requests", operation(overrides)),
      "ER_CHECK_CONSTRAINT_VIOLATED", new RegExp(`'${name}'`, "u"));
    await check({ event_id: randomUUID().toUpperCase() }, "chk_purchasing_operation_event");
    await check({ event_id: "not-a-uuid-not-a-uuid-not-a-uuid-xxx" }, "chk_purchasing_operation_event");
    await check({ request_hash: "A".repeat(64) }, "chk_purchasing_operation_hash");
    await check({ request_hash: "a".repeat(63) + "g" }, "chk_purchasing_operation_hash");
    await check({ source_document_type: "INVOICE" }, "chk_purchasing_operation_source");
    await check({ source_document_type: "purchase_order" }, "chk_purchasing_operation_source");
    await check({ result_type: "PO" }, "chk_purchasing_operation_result");
    await check({ completed_at: 1 }, "chk_purchasing_operation_result");
    await check({ completed_at: 1, result_type: "PO", result_summary: JSON.stringify({ text: "x".repeat(8200) }) },
      "chk_purchasing_operation_summary");
  });
});

integrationTest("TASK-012 an operation completes once, then its identity and outcome are frozen", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await masters(db);
    const id = await insert(db, "purchasing_operation_requests", operation({ actor_user_id: f.user }));
    await frozen(db.query("UPDATE purchasing_operation_requests SET request_hash = ? WHERE id = ?", ["b".repeat(64), id]), /immutable/u);
    await frozen(db.query("UPDATE purchasing_operation_requests SET event_id = ? WHERE id = ?", [randomUUID(), id]), /immutable/u);
    await db.query(`UPDATE purchasing_operation_requests SET result_type = 'PO', result_id = '42', result_summary = JSON_OBJECT('status', 'DRAFT'),
      completed_at = 5 WHERE id = ?`, [id]);
    await frozen(db.query("UPDATE purchasing_operation_requests SET result_id = '43' WHERE id = ?", [id]), /immutable/u);
    await frozen(db.query("UPDATE purchasing_operation_requests SET result_summary = JSON_OBJECT('status', 'CONFIRMED') WHERE id = ?", [id]),
      /immutable/u);
    await frozen(db.query("UPDATE purchasing_operation_requests SET completed_at = 6 WHERE id = ?", [id]), /immutable/u);
    await frozen(db.query("DELETE FROM purchasing_operation_requests WHERE id = ?", [id]), /retention/u);
    // FK 嘅 SET NULL 唔會觸發 trigger：刪 user 仍然得。
    await db.query("DELETE FROM users WHERE id = ?", [f.user]);
    const [[row]] = await db.query("SELECT actor_user_id, actor_label, result_id FROM purchasing_operation_requests WHERE id = ?", [id]);
    assert.deepEqual({ ...row }, { actor_user_id: null, actor_label: "probe", result_id: "42" });
  });
});

integrationTest("TASK-012 audit rows are append-only, bounded, and keep working when an actor is deleted", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await masters(db);
    const audit = (overrides = {}) => insert(db, "purchasing_audit_logs", { occurred_at: 1, actor_user_id: f.user, actor_label: "probe",
      action: "purchase_order.create", outcome: "SUCCEEDED", target_type: "PO", target_id: 1, detail: JSON.stringify({ after: {} }), ...overrides });
    const id = await audit();
    await audit({ outcome: "REJECTED", target_type: "SETTING", detail: null });
    await frozen(db.query("UPDATE purchasing_audit_logs SET reason = 'x' WHERE id = ?", [id]), /immutable/u);
    await frozen(db.query("DELETE FROM purchasing_audit_logs WHERE id = ?", [id]), /immutable/u);
    for (const [overrides, name] of [[{ outcome: "succeeded" }, "chk_purchasing_audit_outcome"], [{ outcome: "DONE" }, "chk_purchasing_audit_outcome"],
      [{ target_type: "INVOICE" }, "chk_purchasing_audit_target"], [{ detail: JSON.stringify({ text: "x".repeat(8200) }) }, "chk_purchasing_audit_detail"]]) {
      await rejects(audit(overrides), "ER_CHECK_CONSTRAINT_VIOLATED", new RegExp(`'${name}'`, "u"));
    }
    await db.query("DELETE FROM users WHERE id = ?", [f.user]);
    const [[row]] = await db.query("SELECT actor_user_id, actor_label FROM purchasing_audit_logs WHERE id = ?", [id]);
    assert.deepEqual({ ...row }, { actor_user_id: null, actor_label: "probe" });
  });
});

integrationTest("TASK-012 a confirmed PO freezes its commercial fields but keeps lifecycle fields writable", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await masters(db);
    const po = await insert(db, "purchase_orders", order(f));
    await insert(db, "purchase_order_lines", line(f, po));
    const changes = await changeExpressions(db, "purchase_orders", PO_PROTECTED.filter((name) => name !== "id"));
    // DRAFT：商業欄位照改。
    await db.query("UPDATE purchase_orders SET notes = 'draft note', supplier_reference = 'R1', subtotal_amount = 1 WHERE id = ?", [po]);
    await db.query("UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = 9, confirmed_by = ? WHERE id = ?", [f.user, po]);
    for (const [column, expression] of Object.entries(changes)) {
      await frozen(db.query(`UPDATE purchase_orders SET \`${column}\` = ${expression} WHERE id = ?`, [po]), /immutable after DRAFT/u);
    }
    await frozen(db.query("UPDATE purchase_orders SET id = id + 1000000 WHERE id = ?", [po]), /immutable after DRAFT/u);
    await db.query(`UPDATE purchase_orders SET status = 'PARTIALLY_RECEIVED', has_outstanding = 1, has_confirmed_receipt = 1,
      version = version + 1, updated_at = updated_at + 1, updated_by = NULL, updated_by_label = 'x', closed_at = 10, closed_by = ?,
      cancelled_at = NULL, cancelled_by = NULL WHERE id = ?`, [f.user, po]);
    // 撤回確認：返 DRAFT 嗰一下唔可以順手改商業欄位，返咗之後就改得。
    const draft = await insert(db, "purchase_orders", order(f, 2, { status: "CONFIRMED" }));
    await frozen(db.query("UPDATE purchase_orders SET status = 'DRAFT', notes = 'sneaky' WHERE id = ?", [draft]), /immutable after DRAFT/u);
    await db.query("UPDATE purchase_orders SET status = 'DRAFT' WHERE id = ?", [draft]);
    await db.query("UPDATE purchase_orders SET notes = 'edited again', order_date = '2099-11-03' WHERE id = ?", [draft]);
    // FK SET NULL 唔觸發 trigger：已確認 PO 嘅 Buyer／建立者都會清空。
    await db.query("DELETE FROM users WHERE id = ?", [f.user]);
    const [[row]] = await db.query("SELECT buyer_id, created_by, buyer_label FROM purchase_orders WHERE id = ?", [po]);
    assert.deepEqual({ ...row }, { buyer_id: null, created_by: null, buyer_label: "probe" });
  });
});

integrationTest("TASK-012 lines of a non-DRAFT PO cannot be edited, added or removed, but projections can", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await masters(db);
    const draft = await insert(db, "purchase_orders", order(f));
    const lineId = await insert(db, "purchase_order_lines", line(f, draft));
    await insert(db, "purchase_order_lines", line(f, draft, { line_number: 2 }));
    await db.query("UPDATE purchase_order_lines SET line_note = 'draft edit', ordered_quantity = '2.000000' WHERE id = ?", [lineId]);
    await db.query("DELETE FROM purchase_order_lines WHERE purchase_order_id = ? AND line_number = 2", [draft]);

    const confirmed = await insert(db, "purchase_orders", order(f, 2));
    const confirmedLine = await insert(db, "purchase_order_lines", line(f, confirmed));
    await insert(db, "purchase_order_lines", line(f, confirmed, { line_number: 2 }));
    await db.query("UPDATE purchase_orders SET status = 'CONFIRMED' WHERE id = ?", [confirmed]);

    const changes = await changeExpressions(db, "purchase_order_lines", LINE_PROTECTED.filter((name) => name !== "id"));
    for (const [column, expression] of Object.entries(changes)) {
      await frozen(db.query(`UPDATE purchase_order_lines SET \`${column}\` = ${expression} WHERE id = ?`, [confirmedLine]), /immutable after DRAFT/u);
    }
    await db.query(`UPDATE purchase_order_lines SET gross_received_base_quantity = 5, net_received_base_quantity = 3, reversed_base_quantity = 2,
      closed_remaining_base_quantity = 1, has_outstanding = 0, is_over_received = 1, close_reason = 'short supply', closed_at = 11,
      closed_by = ?, version = version + 1, updated_at = updated_at + 1 WHERE id = ?`, [f.user, confirmedLine]);
    await frozen(insert(db, "purchase_order_lines", line(f, confirmed, { line_number: 3 })), /cannot be added after DRAFT/u);
    await frozen(db.query("DELETE FROM purchase_order_lines WHERE purchase_order_id = ? AND line_number = 2", [confirmed]),
      /cannot be removed after DRAFT/u);
    // 由 DRAFT 單搬去已確認單都唔得。
    await frozen(db.query("UPDATE purchase_order_lines SET purchase_order_id = ?, line_number = 9 WHERE id = ?", [confirmed, lineId]),
      /immutable after DRAFT/u);
  });
});

integrationTest("TASK-012 document numbers only move forward and are never deleted", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    await insert(db, "purchasing_document_sequences", { document_type: "PO", year_month: MONTH, next_value: 5, updated_at: 1 });
    const where = ["PO", MONTH];
    // 設計 §4.3 嘅 upsert：撞 key 時做一次唔變嘅 UPDATE，一定要過得到 trigger。
    await db.query(`INSERT INTO purchasing_document_sequences (document_type, \`year_month\`, next_value, updated_at) VALUES ('PO', ?, 1, 2)
      ON DUPLICATE KEY UPDATE document_type = VALUES(document_type)`, [MONTH]);
    await db.query("UPDATE purchasing_document_sequences SET next_value = 6, updated_at = 3 WHERE document_type = ? AND `year_month` = ?", where);
    await frozen(db.query("UPDATE purchasing_document_sequences SET next_value = 5 WHERE document_type = ? AND `year_month` = ?", where),
      /cannot be reused/u);
    await frozen(db.query("UPDATE purchasing_document_sequences SET `year_month` = '209912' WHERE document_type = ? AND `year_month` = ?", where),
      /cannot be reused/u);
    await frozen(db.query("DELETE FROM purchasing_document_sequences WHERE document_type = ? AND `year_month` = ?", where), /cannot be reused/u);
    const [[row]] = await db.query("SELECT next_value FROM purchasing_document_sequences WHERE document_type = ? AND `year_month` = ?", where);
    assert.equal(row.next_value, 6);
  });
});

test("TASK-012 every PO and line column is classified once, triggers drift fails closed, and migrations only add", async () => {
  // 0112／0113 嘅每一欄都要分到「受保護」或者「可改」其中一邊，加欄唔分類呢度就紅。
  const columnsOf = (file) => {
    const source = readFileSync(new URL(`../../database/migrations/${file}`, import.meta.url), "utf8");
    const body = source.slice(source.indexOf("CREATE TABLE IF NOT EXISTS"), source.indexOf("PRIMARY KEY"));
    return [...body.matchAll(/^\s+(\w+)\s+(?:BIGINT|INT|SMALLINT|TINYINT|VARCHAR|CHAR|JSON|DATE|DECIMAL)/gmu)].map((match) => match[1]).sort();
  };
  for (const [file, protectedColumns, mutable] of [["0112_create_purchase_orders.js", PO_PROTECTED, PO_MUTABLE],
    ["0113_create_purchase_order_lines.js", LINE_PROTECTED, LINE_MUTABLE]]) {
    const classified = [...protectedColumns, ...mutable];
    assert.equal(new Set(classified).size, classified.length, `${file}: no column is both protected and mutable`);
    assert.deepEqual([...classified].sort(), columnsOf(file), file);
  }

  // 設計 §4.16 點名要凍結嘅欄位：由「受保護」搬去「可改」，上面嘅分類完整性照樣過，所以喺度釘死。
  const named = {
    PO: ["supplier_id", "supplier_code_snapshot", "supplier_name_snapshot", "ordering_address_id", "ordering_address_snapshot",
      "currency_code", "currency_name_snapshot", "currency_decimal_places_snapshot", "payment_term_id", "payment_term_snapshot",
      "order_date", "expected_delivery_date", "default_receiving_warehouse_id", "default_warehouse_code_snapshot", "buyer_id",
      "buyer_label", "supplier_reference", "notes", "subtotal_amount", "total_amount", "po_number", "document_year_month", "sequence_no"],
    line: ["sku_id", "sku_code_snapshot", "sku_name_snapshot", "base_uom_id", "base_uom_code_snapshot", "purchase_sku_uom_id",
      "purchase_uom_code_snapshot", "uom_to_base_factor_snapshot", "ordered_quantity", "ordered_base_quantity", "unit_price",
      "line_amount", "expected_delivery_date", "line_note", "zero_price_reason", "tracking_policy_snapshot",
      "inventory_tracked_snapshot", "minimum_receipt_life_days_snapshot", "supplier_item_code_snapshot", "purchase_order_id"]
  };
  assert.deepEqual(named.PO.filter((column) => !PO_PROTECTED.includes(column)), [], "PO fields design 4.16 freezes");
  assert.deepEqual(named.line.filter((column) => !LINE_PROTECTED.includes(column)), [], "line fields design 4.16 freezes");

  const fake = (statement) => ({ query: async (sql) => (sql.includes("information_schema.triggers")
    ? [[{ name: "trg_x", event: "UPDATE", timing: "BEFORE", statement }]] : assert.fail(`unexpected DDL: ${sql}`)) });
  await ensureTriggers(fake("SIGNAL  SQLSTATE '45000'"), "t", { trg_x: ["UPDATE", "SIGNAL SQLSTATE '45000'"] });
  await assert.rejects(ensureTriggers(fake("SET @x = 1"), "t", { trg_x: ["UPDATE", "SIGNAL SQLSTATE '45000'"] }),
    /Incompatible existing Purchasing trigger: trg_x/u);

  for (const file of ["0114_create_purchasing_operation_requests.js", "0115_create_purchasing_audit_logs.js",
    "0116_add_purchasing_immutability_triggers.js"]) {
    const source = readFileSync(new URL(`../../database/migrations/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:ALTER|DROP)\s+(?:TABLE|TRIGGER)\b/iu, `${file} must only add`);
  }
});
