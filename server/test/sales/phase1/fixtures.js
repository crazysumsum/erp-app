import { randomUUID, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";

export async function lockSalesFixture(db) {
  // ponytail: serialize fixture DDL per schema; real transaction races run inside each test.
  const [[row]] = await db.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':sales-p1-fixture-ddl'), 30) AS acquired");
  if (row.acquired !== 1) throw new Error("Sales fixture DDL lease unavailable");
  // The connection owns this lease until its registered cleanup calls end().
}

export async function createTestCurrency(db, cleanup, now) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const code = [...randomBytes(3)].map(byte => String.fromCharCode(65 + byte % 26)).join("");
    try {
      await db.execute("INSERT INTO currencies (code,name,decimal_places,status,version,created_at,updated_at) VALUES (?, 'Test currency', 2, 'active', 1, ?, ?)", [code, now, now]);
      cleanup.push(() => db.execute("DELETE FROM currencies WHERE code = ?", [code]));
      return code;
    } catch (error) { if (error.code !== "ER_DUP_ENTRY") throw error; }
  }
  throw new Error("Unable to allocate a private test currency");
}

export async function migrationFixture(t, tables) {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  let admin;
  const ddl = { async query(sql, args = []) {
    if (!/^\s*(CREATE|DROP) TRIGGER\b/iu.test(sql)) throw new TypeError("Sales fixture admin connection is for trigger DDL only");
    if (!admin) {
      if (process.env.DB_ADMIN_USER === undefined && process.env.DB_ADMIN_PASSWORD === undefined) admin = db;
      else {
        if (!process.env.DB_ADMIN_USER || process.env.DB_ADMIN_PASSWORD === undefined) throw new Error("Sales fixture requires both DB_ADMIN_USER and DB_ADMIN_PASSWORD");
        admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
          socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD, database: process.env.DB_NAME });
      }
    }
    return admin.query(sql, args);
  } };
  const prefix = `p1_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const names = Object.fromEntries(tables.map((table, index) => [table, `${prefix}_${index}`]));
  const cleanup = [], beforeParents = [];
  t.after(async () => { try { for (const table of Object.values(names).reverse()) await db.query(`DROP TABLE IF EXISTS ${table}`);
    for (const action of [...beforeParents.reverse(), ...cleanup.reverse()]) await action(); } finally { try { if (admin && admin !== db) await admin.end(); } finally { await db.end(); } } });
  await lockSalesFixture(db);
  const scoped = { async query(sql, args = []) {
    for (const [source, target] of Object.entries(names)) sql = sql.replace(new RegExp(`\\b${source}\\b`, "gu"), target);
    sql = sql.replace(/\b(fk|chk|trg)_sales_([a-z_]+)\b/gu, `$1_${prefix}_$2`);
    const connection = /^\s*CREATE TRIGGER\b/iu.test(sql) ? ddl : db;
    const result = await connection.query(sql, args.map(arg => names[arg] ?? (typeof arg === "string" ? arg.replace(/^trg_sales_/u, `trg_${prefix}_`) : arg)));
    if (Array.isArray(result[0])) for (const row of result[0]) {
      const original = Object.keys(names).find(name => names[name] === row.target);
      if (original) row.target = original;
      if (typeof row.name === "string") row.name = row.name.replace(`trg_${prefix}_`, "trg_sales_");
    }
    return result;
  } };
  const now = Date.now();
  async function insert(table, row, key = "id") {
    const [result] = await db.query(`INSERT INTO ${table} SET ?`, row);
    const id = key === "id" ? Number(result.insertId) : row[key];
    cleanup.push(() => db.execute(`DELETE FROM ${table} WHERE ${key} = ?`, [id]));
    return id;
  }
  const currency = await createTestCurrency(db, cleanup, now);
  const uomId = await insert("item_uoms", { code: prefix, name: "Each", status: "active", created_at: now, updated_at: now });
  const customerId = await insert("customers", { customer_code: prefix, customer_code_key: prefix, legal_name: prefix,
    legal_name_key: prefix, default_currency_code: currency, status: "active", version: 1, created_at: now, updated_at: now });
  const itemId = await insert("items", { name: prefix, status: "active", created_at: now, updated_at: now });
  const skuId = await insert("item_skus", { item_id: itemId, sku_code: prefix, sku_name: prefix, status: "active", created_at: now, updated_at: now });
  const skuUomId = await insert("item_sku_uoms", { sku_id: skuId, uom_id: uomId, to_base_factor: 1, is_base: 1,
    is_default_sale: 1, created_at: now, updated_at: now });
  const warehouseId = await insert("inventory_warehouses", { warehouse_code: prefix, normalized_code: prefix, warehouse_name: prefix,
    status: "ACTIVE", created_at: now, updated_at: now });
  return { db, ddl, scoped, names, now, currency, customerId, itemId, skuId, skuUomId, warehouseId, insert, cleanup, beforeParents };
}
