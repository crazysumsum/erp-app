import { createHash } from "node:crypto";

const TARGETS = Object.freeze({
  CURRENCY: { column: "default_currency_code", key: (value) => String(value) },
  PAYMENT_TERM: {
    column: "default_payment_term_id",
    key: (value) => {
      const id = Number(value);
      if (!Number.isSafeInteger(id) || id < 1) throw new TypeError("Payment Term impact checks require a positive integer key");
      return id;
    }
  }
});

function count(row, field) {
  const value = Number(row[field] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid Customer impact ${field}`);
  return value;
}

function watermark(entityType, entityKey, rows) {
  const value = rows.map((row) => [
    String(row.status),
    count(row, "reference_count"),
    count(row, "version_sum"),
    count(row, "latest_updated_at"),
    count(row, "max_id")
  ]);
  return `customer:${entityType}:${entityKey}:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export class CustomerBusinessMasterImpactChecker {
  constructor({ database } = {}) {
    if (!database || typeof database.query !== "function") throw new TypeError("CustomerBusinessMasterImpactChecker requires database");
    this.database = database;
    this.id = "customer";
  }

  async check({ entityType, entityKey } = {}) {
    const target = TARGETS[entityType];
    if (!target) throw new TypeError("Customer impact checks support Currency and Payment Term only");
    const [tableRows] = await this.database.query(
      `SELECT COUNT(*) AS present
         FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'customers'`
    );
    if (Number(tableRows[0]?.present ?? 0) === 0) {
      return { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "not-installed:customers" };
    }

    const key = target.key(entityKey);
    const [rows] = await this.database.query(
      `SELECT status,
              COUNT(*) AS reference_count,
              COALESCE(SUM(version), 0) AS version_sum,
              COALESCE(MAX(updated_at), 0) AS latest_updated_at,
              COALESCE(MAX(id), 0) AS max_id
         FROM customers
        WHERE ${target.column} = ?
        GROUP BY status
        ORDER BY status`,
      [key]
    );
    const activeDefaultCount = rows.filter((row) => row.status === "active")
      .reduce((total, row) => total + count(row, "reference_count"), 0);
    const openUseCount = rows.filter((row) => row.status !== "active")
      .reduce((total, row) => total + count(row, "reference_count"), 0);
    return {
      status: "READY",
      activeDefaultCount,
      openUseCount,
      historicalCount: 0,
      watermark: watermark(entityType, key, rows)
    };
  }
}
