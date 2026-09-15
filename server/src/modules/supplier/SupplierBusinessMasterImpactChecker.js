const SUPPORTED_ENTITY_TYPES = new Set(["CURRENCY", "PAYMENT_TERM"]);

function requireSubject(subject) {
  if (!subject || !SUPPORTED_ENTITY_TYPES.has(subject.entityType)) {
    throw new TypeError("Supplier impact checker requires a supported Business Master entity type");
  }
  if (subject.entityType === "PAYMENT_TERM") {
    const id = Number(subject.entityKey);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new TypeError("Supplier impact checker requires a positive Payment Term ID");
    }
    return { column: "default_payment_term_id", value: id, key: String(id) };
  }
  const code = String(subject.entityKey ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new TypeError("Supplier impact checker requires a three-letter Currency code");
  }
  return { column: "default_currency_code", value: code, key: code };
}

function count(row, field) {
  const value = Number(row?.[field] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid Supplier impact count: ${field}`);
  return value;
}

/**
 * Consumer-owned Business Master impact checker. It exposes counts only and
 * never returns Supplier details or Bank data.
 */
export class SupplierBusinessMasterImpactChecker {
  constructor({ database } = {}) {
    if (!database || typeof database.query !== "function") {
      throw new TypeError("SupplierBusinessMasterImpactChecker requires a database");
    }
    this.database = database;
    this.id = "supplier";
  }

  async check(subject) {
    const reference = requireSubject(subject);
    const [schemaRows] = await this.database.query(
      `SELECT COUNT(*) AS present
         FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'suppliers'`
    );
    if (Number(schemaRows[0]?.present ?? 0) === 0) {
      return {
        status: "NOT_INSTALLED",
        activeDefaultCount: 0,
        openUseCount: 0,
        historicalCount: 0,
        watermark: "not-installed:suppliers"
      };
    }

    const [rows] = await this.database.query(
      `SELECT
         COALESCE(SUM(status = 'active'), 0) AS active_default_count,
         COALESCE(SUM(status IN ('draft', 'pending_approval', 'suspended', 'blocked')), 0) AS open_use_count,
         COALESCE(SUM(status = 'archived'), 0) AS historical_count,
         COUNT(*) AS total_count,
         COALESCE(MAX(updated_at), 0) AS max_updated_at,
         COALESCE(MAX(id), 0) AS max_id,
         COALESCE(SUM(version), 0) AS version_sum
       FROM suppliers
       WHERE ${reference.column} = ?`,
      [reference.value]
    );
    const activeDefaultCount = count(rows[0], "active_default_count");
    const openUseCount = count(rows[0], "open_use_count");
    const historicalCount = count(rows[0], "historical_count");
    const totalCount = count(rows[0], "total_count");
    const maxUpdatedAt = count(rows[0], "max_updated_at");
    const maxId = count(rows[0], "max_id");
    const versionSum = count(rows[0], "version_sum");
    if (totalCount !== activeDefaultCount + openUseCount + historicalCount) {
      throw new Error("Supplier impact checker found an unclassified status");
    }
    return {
      status: "READY",
      activeDefaultCount,
      openUseCount,
      historicalCount,
      watermark: [subject.entityType, reference.key, totalCount, activeDefaultCount, openUseCount, historicalCount, maxUpdatedAt, maxId, versionSum].join(":")
    };
  }
}
