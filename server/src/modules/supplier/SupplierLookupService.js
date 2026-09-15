import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { normalizeSupplierCode } from "./supplierNormalization.js";
import { supplierConflict, supplierNotFound } from "./supplierErrors.js";
import { toAddressResponse } from "./supplierProjections.js";

const PURPOSES = Object.freeze(["purchase", "history"]);
const MAX_BATCH_SIZE = 100;
const READ_TRANSACTION_OPTIONS = Object.freeze({ isolationLevel: "READ COMMITTED", timeoutMs: 5_000 });
const SUPPLIER_SELECT = `SELECT id, supplier_code, supplier_name, display_name,
       default_currency_code, default_payment_term_id, status, version
  FROM suppliers`;

function requireConnection(connection) {
  if (!connection || typeof connection.query !== "function") {
    throw new TypeError("A caller-owned transaction connection is required");
  }
}

function requireSupplierId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("Supplier ID must be a positive safe integer");
  return id;
}

function lookupOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Supplier lookup options must be an object");
  }
  if (!PURPOSES.includes(options.purpose)) {
    throw new TypeError(`Unknown SupplierLookupService purpose: "${options.purpose}"`);
  }
  const atMs = options.atMs ?? null;
  if (atMs !== null && (!Number.isSafeInteger(atMs) || atMs < 0)) {
    throw new TypeError("Supplier lookup atMs must be a non-negative epoch millisecond integer");
  }
  return { purpose: options.purpose, atMs };
}

function providerNotReady() {
  return new ApplicationError("Business Master provider is unavailable for Supplier purchase defaults", {
    code: "BUSINESS_MASTER_NOT_READY",
    publicCode: "BUSINESS_MASTER_NOT_READY",
    statusCode: 503,
    publicMessage: "貨幣及付款條件資料暫時不可用"
  });
}

function toProjection(row, { purpose }) {
  if (!row) return null;
  const reasons = purpose === "purchase" && row.status !== "active" ? ["STATUS_NOT_ACTIVE"] : [];
  return {
    supplierId: Number(row.id),
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    displayName: row.display_name,
    defaultCurrencyCode: row.default_currency_code,
    defaultPaymentTermId: row.default_payment_term_id === null ? null : Number(row.default_payment_term_id),
    status: row.status,
    version: Number(row.version),
    usable: reasons.length === 0,
    reasons
  };
}

/**
 * Internal Supplier provider for Purchasing and historical document readers.
 * Callers authorize their own workflow before invoking this service; no Supplier
 * management permission is implied, and the projection never contains Bank data.
 */
export class SupplierLookupService {
  static contract = "supplier-core-provider/v1";

  constructor({ database, logger, time, businessMaster = null } = {}) {
    if (!database || typeof database.withTransaction !== "function") {
      throw new TypeError("SupplierLookupService requires a transactional database");
    }
    if (!logger || !time) throw new TypeError("SupplierLookupService requires logger and time services");
    this.database = database;
    this.logger = logger;
    this.time = time;
    this.businessMaster = businessMaster;
  }

  async findById(supplierId, options) {
    const id = requireSupplierId(supplierId);
    const normalized = lookupOptions(options);
    return this.#read((connection) => this.#findById(connection, id, normalized));
  }

  async findByCode(supplierCode, options) {
    const code = normalizeSupplierCode(supplierCode);
    const normalized = lookupOptions(options);
    return this.#read(async (connection) => {
      const [rows] = await connection.query(`${SUPPLIER_SELECT} WHERE supplier_code_key = ? LIMIT 1`, [code.key]);
      return toProjection(rows[0], normalized);
    });
  }

  async findManyByIds(supplierIds, options) {
    if (!Array.isArray(supplierIds)) throw new TypeError("Supplier IDs must be an array");
    const normalized = lookupOptions(options);
    if (supplierIds.length > MAX_BATCH_SIZE) throw new TypeError(`Supplier lookup accepts at most ${MAX_BATCH_SIZE} IDs`);
    const ids = [...new Set(supplierIds.map(requireSupplierId))];
    if (ids.length === 0) return new Map();
    return this.#read(async (connection) => {
      const placeholders = ids.map(() => "?").join(",");
      const [rows] = await connection.query(`${SUPPLIER_SELECT} WHERE id IN (${placeholders})`, ids);
      return new Map(rows.map((row) => [Number(row.id), toProjection(row, normalized)]));
    });
  }

  async assertUsable(supplierId, options) {
    const id = requireSupplierId(supplierId);
    const normalized = lookupOptions(options);
    return this.#read((connection) => this.#assertUsable(connection, id, normalized, false));
  }

  async assertUsableInTransaction(connection, supplierId, options) {
    requireConnection(connection);
    const id = requireSupplierId(supplierId);
    const normalized = lookupOptions(options);
    return this.#assertUsable(connection, id, normalized, true);
  }

  async getPurchaseDefaults(supplierId, { atMs } = {}) {
    const id = requireSupplierId(supplierId);
    return this.#read((connection) => this.getPurchaseDefaultsInTransaction(connection, id, { atMs }));
  }

  async getPurchaseDefaultsInTransaction(connection, supplierId, { atMs } = {}) {
    requireConnection(connection);
    const options = lookupOptions({ purpose: "purchase", atMs });
    const supplier = await this.#assertUsable(connection, requireSupplierId(supplierId), options, true);
    if (!this.businessMaster || typeof this.businessMaster.assertSupplierDefaultsInTransaction !== "function") {
      throw providerNotReady();
    }
    const references = await this.businessMaster.assertSupplierDefaultsInTransaction(connection, {
      currencyCode: supplier.defaultCurrencyCode,
      paymentTermId: supplier.defaultPaymentTermId,
      purpose: "new_assignment"
    });
    const [addressRows] = await connection.query(
      `SELECT a.*
         FROM supplier_address_purposes p
         JOIN supplier_addresses a ON a.id = p.address_id AND a.supplier_id = p.supplier_id
        WHERE p.supplier_id = ? AND p.purpose_code = 'ordering' AND p.is_primary = 1
          AND a.status = 'active'
        LIMIT 1`,
      [supplier.supplierId]
    );
    const orderingAddress = addressRows[0]
      ? toAddressResponse(addressRows[0], [{ purpose_code: "ordering", is_primary: 1 }])
      : null;
    return {
      supplier,
      currency: references.currency,
      paymentTerm: references.paymentTerm,
      orderingAddress
    };
  }

  #read(work) {
    return this.database.withTransaction(work, READ_TRANSACTION_OPTIONS);
  }

  async #findById(connection, supplierId, options, forUpdate = false) {
    const [rows] = await connection.query(
      `${SUPPLIER_SELECT} WHERE id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [supplierId]
    );
    return toProjection(rows[0], options);
  }

  async #assertUsable(connection, supplierId, options, forUpdate) {
    const supplier = await this.#findById(connection, supplierId, options, forUpdate);
    if (!supplier) throw supplierNotFound(supplierId);
    if (!supplier.usable) {
      throw supplierConflict("SUPPLIER_NOT_USABLE", "供應商目前不可用於這個用途", {
        supplierId,
        purpose: options.purpose,
        reasons: supplier.reasons
      });
    }
    return supplier;
  }
}
