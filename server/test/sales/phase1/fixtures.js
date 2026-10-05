import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

export async function migrationFixture(t, tables) {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const prefix = `p1_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const names = Object.fromEntries(tables.map((table, index) => [table, `${prefix}_${index}`]));
  const cleanup = [];
  t.after(async () => { try { for (const table of Object.values(names).reverse()) await db.query(`DROP TABLE IF EXISTS ${table}`);
    for (const action of cleanup.reverse()) await action(); } finally { await db.end(); } });
  const scoped = { async query(sql, args = []) {
    for (const [source, target] of Object.entries(names)) sql = sql.replace(new RegExp(`\\b${source}\\b`, "gu"), target);
    sql = sql.replace(/\b(fk|chk)_sales_([a-z_]+)\b/gu, `$1_${prefix}_$2`);
    const result = await db.query(sql, args.map(arg => names[arg] ?? arg));
    if (Array.isArray(result[0])) for (const row of result[0]) {
      const original = Object.keys(names).find(name => names[name] === row.target);
      if (original) row.target = original;
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
  const currency = "XTS";
  const [added] = await db.execute("INSERT IGNORE INTO currencies (code,name,decimal_places,status,version,created_at,updated_at) VALUES (?, 'Test currency', 2, 'active', 1, ?, ?)", [currency, now, now]);
  if (added.affectedRows) cleanup.push(() => db.execute("DELETE FROM currencies WHERE code = ?", [currency]));
  const uomId = await insert("item_uoms", { code: prefix, name: "Each", status: "active", created_at: now, updated_at: now });
  const customerId = await insert("customers", { customer_code: prefix, customer_code_key: prefix, legal_name: prefix,
    legal_name_key: prefix, default_currency_code: currency, status: "active", version: 1, created_at: now, updated_at: now });
  const itemId = await insert("items", { name: prefix, status: "active", created_at: now, updated_at: now });
  const skuId = await insert("item_skus", { item_id: itemId, sku_code: prefix, sku_name: prefix, status: "active", created_at: now, updated_at: now });
  const skuUomId = await insert("item_sku_uoms", { sku_id: skuId, uom_id: uomId, to_base_factor: 1, is_base: 1,
    is_default_sale: 1, created_at: now, updated_at: now });
  const warehouseId = await insert("inventory_warehouses", { warehouse_code: prefix, normalized_code: prefix, warehouse_name: prefix,
    status: "ACTIVE", created_at: now, updated_at: now });
  return { db, scoped, names, now, currency, customerId, itemId, skuId, skuUomId, warehouseId, insert, cleanup };
}
