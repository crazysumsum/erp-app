/**
 * TASK-027（設計 §4.10、§4.11、§4.16）：0120 goods_receipt_lines 同 0121 goods_receipt_details 對一個真、已 migrate 嘅 MySQL。
 * Sam 2026-11-12 按名批准 SCHEMA.md fcb8f876（call_cb2041d1）：8 個 case——FK 3、UNIQUE 2、確認後 trigger 3。
 * 每個 case 喺 transaction 入面做完即刻 ROLLBACK；每案最多 1 張 PO、2 條 PO line、1 張 GR、2 條 GR line、2 個 detail，主檔另計。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const MONTH = "209709";

async function connect(t) {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, supportBigNumbers: true, bigNumberStrings: true });
  t.after(() => db.end());
  return db;
}

async function inRollback(db, work) {
  await db.query("START TRANSACTION");
  try { return await work(); } finally { await db.query("ROLLBACK"); }
}

/** 斷言 DB 錯誤碼；FK 同 unique 仲要對埋約束名（可以俾幾個，任何一個中都算），證明擋住嘅係預期嗰條。 */
async function rejects(promise, code, names) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${error.code}: ${error.message}`);
    if (names) assert.ok([names].flat().some((name) => error.message.includes(name)), error.message);
    return true;
  });
}

/** 主檔、一張 CONFIRMED PO（兩條 line：SKU A、SKU B）同一張 DRAFT GR；全部喺當前 transaction 入面。 */
async function fixture(db) {
  const now = Date.now(), tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  const user = await insert("users", { username: `gr_schema_${tag}`, password_hash: "synthetic", display_name: "GR schema", created_at: now, updated_at: now });
  const supplier = await insert("suppliers", { supplier_code: `GRS-${tag}`, supplier_code_key: `grs-${tag}`, supplier_name: "GR Supplier", supplier_name_key: "gr supplier",
    default_currency_code: "HKD", status: "active", created_at: now, updated_at: now });
  const item = await insert("items", { name: `GR ${tag}`, status: "active", created_at: now, updated_at: now });
  const uom = await insert("item_uoms", { code: `G${tag}`, name: "Each", created_at: now, updated_at: now });
  const sku = async (suffix) => {
    const id = await insert("item_skus", { item_id: item, sku_code: `GRS-${tag}-${suffix}`, sku_name: `GR SKU ${suffix}`, status: "active", created_at: now, updated_at: now });
    return { id, skuUom: await insert("item_sku_uoms", { sku_id: id, uom_id: uom, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now }) };
  };
  const skuA = await sku("a"), skuB = await sku("b");
  const place = async (suffix) => {
    const warehouse = await insert("inventory_warehouses", { warehouse_code: `W${tag}${suffix}`, normalized_code: `w${tag}${suffix}`, warehouse_name: `W ${suffix}`,
      created_at: now, updated_at: now });
    return { warehouse, bin: await insert("inventory_bins", { warehouse_id: warehouse, bin_code: `B${suffix}`, normalized_code: `b${suffix}`, created_at: now, updated_at: now }) };
  };
  const main = await place("1"), other = await place("2");
  const [[{ next }]] = await db.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM purchase_orders WHERE document_year_month = ?", [MONTH]);
  const po = await insert("purchase_orders", { po_number: `PO-${MONTH}-${String(next).padStart(6, "0")}`, document_year_month: MONTH, sequence_no: Number(next),
    supplier_id: supplier, supplier_code_snapshot: `GRS-${tag}`, supplier_name_snapshot: "GR Supplier", currency_code: "HKD", currency_name_snapshot: "HK Dollar",
    currency_decimal_places_snapshot: 2, order_date: "2097-09-01", buyer_id: user, buyer_label: "Buyer", total_amount: "5.0000", subtotal_amount: "5.0000",
    created_at: now, updated_at: now, created_by: user, created_by_label: "gr", updated_by: user, updated_by_label: "gr" });
  const poLine = (number, { id: skuId, skuUom }) => insert("purchase_order_lines", { purchase_order_id: po, line_number: number, sku_id: skuId,
    sku_code_snapshot: "S", sku_name_snapshot: "S", tracking_policy_snapshot: "none", inventory_tracked_snapshot: 1, base_uom_id: uom, base_uom_code_snapshot: "EA",
    purchase_sku_uom_id: skuUom, purchase_uom_code_snapshot: "EA", uom_to_base_factor_snapshot: 1, ordered_quantity: "2", ordered_base_quantity: 2,
    unit_price: "1.2500", line_amount: "2.5000", created_at: now, updated_at: now });
  const lineA = await poLine(1, skuA), lineB = await poLine(2, skuB);
  await db.query("UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = ? WHERE id = ?", [now, po]);   // line trigger：表頭離開 DRAFT 前先加行
  const [[{ grNext }]] = await db.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS grNext FROM goods_receipts WHERE document_year_month = ?", [MONTH]);
  const gr = await insert("goods_receipts", { gr_number: `GR-${MONTH}-${String(grNext).padStart(6, "0")}`, document_year_month: MONTH, sequence_no: Number(grNext),
    purchase_order_id: po, supplier_id: supplier, supplier_code_snapshot: `GRS-${tag}`, supplier_name_snapshot: "GR Supplier", business_receipt_date: "2097-09-02",
    created_at: now, updated_at: now, created_by: user, updated_by: user, created_by_label: "gr", updated_by_label: "gr" });
  const grLine = (fields = {}) => insert("goods_receipt_lines", { goods_receipt_id: gr, purchase_order_id: po, purchase_order_line_id: lineA, line_number: 1,
    sku_id: skuA.id, sku_code_snapshot: "S", sku_name_snapshot: "S", received_base_quantity: 2, created_at: now, updated_at: now, ...fields });
  const detail = (line, fields = {}) => insert("goods_receipt_details", { goods_receipt_id: gr, goods_receipt_line_id: line, purchase_order_id: po,
    purchase_order_line_id: lineA, detail_number: 1, sku_id: skuA.id, sku_code_snapshot: "S", sku_name_snapshot: "S", input_uom_id: uom, input_uom_code_snapshot: "EA",
    uom_to_base_factor_snapshot: 1, received_quantity: "2.000000", received_base_quantity: 2, warehouse_id: main.warehouse, bin_id: main.bin,
    warehouse_code_snapshot: "W1", bin_code_snapshot: "B1", tracking_policy_applied: "none", stock_status: "AVAILABLE", created_at: now, updated_at: now, ...fields });
  const confirm = () => db.query("UPDATE goods_receipts SET status = 'CONFIRMED', confirmed_at = ?, confirmed_by = ?, confirm_event_id = ? WHERE id = ?",
    [now, user, randomUUID(), gr]);
  return { now, po, lineA, lineB, skuA, skuB, gr, main, other, grLine, detail, confirm };
}

integrationTest("TASK-027 FK：GR line 嘅 PO 同 GR 嘅 PO 唔一致就拒絕（跨 PO）", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db);
    // 兩條 composite FK 都唔成立；MySQL 報邊條未保證，所以兩個名都接受。
    await rejects(f.grLine({ purchase_order_id: f.po + 1000000 }), "ER_NO_REFERENCED_ROW_2", ["fk_gr_lines_gr_po", "fk_gr_lines_po_line"]);
  });
});

integrationTest("TASK-027 FK：GR line 同 detail 嘅 SKU 同 PO line 唔一致就拒絕", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db);
    await rejects(f.grLine({ sku_id: f.skuB.id }), "ER_NO_REFERENCED_ROW_2", "fk_gr_lines_po_line_sku");
    const line = await f.grLine();
    await rejects(f.detail(line, { sku_id: f.skuB.id }), "ER_NO_REFERENCED_ROW_2", "fk_gr_details_po_line_sku");
  });
});

integrationTest("TASK-027 FK：detail 嘅 Bin 唔屬於佢個 Warehouse 就拒絕", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db);
    const line = await f.grLine();
    await rejects(f.detail(line, { bin_id: f.other.bin }), "ER_NO_REFERENCED_ROW_2", "fk_gr_details_bin");
  });
});

integrationTest("TASK-027 UNIQUE：同一張 GR 唔可以有兩條 line 收同一條 PO line", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db);
    await f.grLine();
    await rejects(f.grLine({ line_number: 2 }), "ER_DUP_ENTRY", "uq_gr_lines_po_line");
  });
});

integrationTest("TASK-027 UNIQUE：同一張 GR 唔可以有兩個相同 physical bucket 嘅 detail", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db);
    const line = await f.grLine();
    await f.detail(line);
    await rejects(f.detail(line, { detail_number: 2 }), "ER_DUP_ENTRY", "uq_gr_detail_dimension");
  });
});

integrationTest("TASK-027 trigger：GR 確認後 line 同 detail 唔准改，只有 detail 嘅 reversed_base_quantity 同 updated_at 可以改", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db);
    const line = await f.grLine(), detail = await f.detail(line);
    await f.confirm();
    await rejects(db.query("UPDATE goods_receipt_lines SET over_receipt_reason = 'x' WHERE id = ?", [line]), "ER_SIGNAL_EXCEPTION", "immutable after confirmation");
    await rejects(db.query("UPDATE goods_receipt_details SET bin_code_snapshot = 'X' WHERE id = ?", [detail]), "ER_SIGNAL_EXCEPTION", "immutable after confirmation");
    await db.query("UPDATE goods_receipt_details SET reversed_base_quantity = 1, updated_at = ? WHERE id = ?", [f.now + 1, detail]);
    const [[row]] = await db.query("SELECT reversed_base_quantity, updated_at FROM goods_receipt_details WHERE id = ?", [detail]);
    assert.deepEqual([String(row.reversed_base_quantity), String(row.updated_at)], ["1", String(f.now + 1)]);
  });
});

integrationTest("TASK-027 trigger：GR 確認後唔准刪 line 或者 detail", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db);
    const line = await f.grLine(), detail = await f.detail(line);
    await f.confirm();
    await rejects(db.query("DELETE FROM goods_receipt_details WHERE id = ?", [detail]), "ER_SIGNAL_EXCEPTION", "cannot be removed after confirmation");
    await rejects(db.query("DELETE FROM goods_receipt_lines WHERE id = ?", [line]), "ER_SIGNAL_EXCEPTION", "cannot be removed after confirmation");
  });
});

integrationTest("TASK-027 trigger：GR 確認後唔准再加 line 或者 detail", async (t) => {
  const db = await connect(t);
  await inRollback(db, async () => {
    const f = await fixture(db);
    const line = await f.grLine();
    await f.confirm();
    await rejects(f.grLine({ purchase_order_line_id: f.lineB, sku_id: f.skuB.id, line_number: 2 }), "ER_SIGNAL_EXCEPTION", "cannot be added after confirmation");
    await rejects(f.detail(line), "ER_SIGNAL_EXCEPTION", "cannot be added after confirmation");
  });
});
