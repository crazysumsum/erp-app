import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";

export async function nativeDatabase(t, { migrateAuth = false } = {}) {
  const socketPath = process.env.DB_SOCKET_PATH;
  if (process.env.GITHUB_ACTIONS !== "true" &&
      (!socketPath?.includes("erp-fulfillment-p0-mysql-") || !/^fulfillment_p0_[a-z0-9_]+$/.test(process.env.DB_NAME ?? ""))) {
    throw new Error("Fulfillment native tests require their owned disposable runtime");
  }
  const options = { host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
    socketPath, user: process.env.DB_ADMIN_USER || process.env.DB_USER,
    password: process.env.DB_ADMIN_PASSWORD ?? process.env.DB_PASSWORD };
  const admin = await mysql.createConnection(options);
  const name = "fulfillment_p0_" + randomUUID().replaceAll("-", "");
  let db = null;
  t.after(async () => {
    const failures = [];
    try { if (db) await db.end(); } catch (error) { failures.push(error); }
    try { await admin.query(`DROP DATABASE IF EXISTS \`${name}\``); } catch (error) { failures.push(error); }
    try { await admin.end(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Owned Fulfillment database cleanup failed");
  });
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  db = await mysql.createConnection({ ...options, database: name });
  if (migrateAuth) await (await import("../../database/migrations/0003_add_auth_tables.js")).up(db);
  return { db, name, options };
}
