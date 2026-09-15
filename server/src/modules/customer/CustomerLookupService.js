import { customerLookupPurposeInvalid, customerNotFound, customerPartyNotFound, versionConflict } from "./customerErrors.js";
import { normalizeCustomerCode, normalizeLegalName } from "./customerNormalization.js";

const CUSTOMER_PURPOSES = new Set([
  "new_sale",
  "manual_invoice",
  "existing_order_fulfillment",
  "invoice_existing_shipment",
  "ar_existing_document",
  "historical_return",
  "refund_existing_transaction",
  "history"
]);
const ACTIVE_ONLY_PURPOSES = new Set(["new_sale", "manual_invoice"]);
const ADDRESS_PURPOSES = new Set(["registered", "office", "billing", "shipping", "returns", "other"]);
const CONTACT_PURPOSES = new Set(["general", "ordering", "shipping", "billing_ar", "returns", "other"]);

const CUSTOMER_SELECT = `id, customer_code, legal_name, trading_name, default_currency_code,
  default_payment_term_id, status, version`;

const ADDRESS_SELECT = `a.id, a.customer_id, a.label, a.recipient_company_department,
  a.address_line1, a.address_line2, a.address_line3, a.city, a.state_region, a.postal_code,
  a.country_code, a.phone, a.sort_order, a.status, a.version, p.is_default`;

const CONTACT_SELECT = `c.id, c.customer_id, c.name, c.job_title, c.department, c.email,
  c.phone, c.mobile, c.preferred_language, c.sort_order, c.status, c.version, p.is_default`;

function requireId(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
}

function requireAtMs(value) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError("atMs must be a non-negative integer");
}

function requireExpectedVersion(value, required) {
  if (value === undefined && !required) return;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("expectedVersion must be a positive integer");
}

function requirePurpose(purpose, purposes) {
  if (!purposes.has(purpose)) throw customerLookupPurposeInvalid(purpose);
}

function requireExecutor(connection) {
  if (!connection || typeof connection.query !== "function") throw new TypeError("A caller-owned transaction connection is required");
}

function prefix(value) {
  return `${value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;
}

function customerProjection(row) {
  if (!row) return null;
  return Object.freeze({
    customerId: Number(row.id),
    customerCode: row.customer_code,
    legalName: row.legal_name,
    displayName: row.trading_name || row.legal_name,
    defaultCurrencyCode: row.default_currency_code,
    defaultPaymentTermId: row.default_payment_term_id === null ? null : Number(row.default_payment_term_id),
    status: row.status,
    version: Number(row.version)
  });
}

function addressProjection(row) {
  const result = {
    addressId: Number(row.id), customerId: Number(row.customer_id), label: row.label,
    recipientCompanyDepartment: row.recipient_company_department, addressLine1: row.address_line1,
    addressLine2: row.address_line2, addressLine3: row.address_line3, city: row.city,
    stateRegion: row.state_region, postalCode: row.postal_code, countryCode: row.country_code,
    phone: row.phone, sortOrder: Number(row.sort_order), status: row.status,
    version: Number(row.version), isDefault: Boolean(row.is_default)
  };
  if (row.customer_status !== undefined) {
    result.customerStatus = row.customer_status;
    result.customerVersion = Number(row.customer_version);
  }
  return Object.freeze(result);
}

function contactProjection(row) {
  const result = {
    contactId: Number(row.id), customerId: Number(row.customer_id), name: row.name,
    jobTitle: row.job_title, department: row.department, email: row.email, phone: row.phone,
    mobile: row.mobile, preferredLanguage: row.preferred_language, sortOrder: Number(row.sort_order),
    status: row.status, version: Number(row.version), isDefault: Boolean(row.is_default)
  };
  if (row.customer_status !== undefined) {
    result.customerStatus = row.customer_status;
    result.customerVersion = Number(row.customer_version);
  }
  return Object.freeze(result);
}

function creditProjection(row) {
  if (row.credit_version === null) return Object.freeze({ configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null });
  return Object.freeze({
    configured: true,
    creditLimit: row.credit_limit === null ? null : String(row.credit_limit),
    currencyCode: row.credit_currency_code,
    status: row.credit_status,
    policyVersion: Number(row.credit_version)
  });
}

export class CustomerLookupService {
  static contract = "customer-purpose-provider-contracts/aligned-design-2.0";

  constructor({ database } = {}) {
    if (!database || typeof database.query !== "function") throw new TypeError("CustomerLookupService requires a database");
    this.database = database;
  }

  async findById(customerId, { purpose, atMs } = {}) {
    requireId(customerId, "customerId"); requirePurpose(purpose, CUSTOMER_PURPOSES); requireAtMs(atMs);
    const [[row]] = await this.database.query(`SELECT ${CUSTOMER_SELECT} FROM customers WHERE id = ?`, [customerId]);
    if (row && ACTIVE_ONLY_PURPOSES.has(purpose) && row.status !== "active") return null;
    return customerProjection(row);
  }

  async findByCode(customerCode, { purpose, atMs } = {}) {
    requirePurpose(purpose, CUSTOMER_PURPOSES); requireAtMs(atMs);
    const key = normalizeCustomerCode(customerCode).key;
    const [[row]] = await this.database.query(`SELECT ${CUSTOMER_SELECT} FROM customers WHERE customer_code_key = ?`, [key]);
    if (row && ACTIVE_ONLY_PURPOSES.has(purpose) && row.status !== "active") return null;
    return customerProjection(row);
  }

  async listActive({ q = "", page = 1, pageSize = 20, purpose, atMs } = {}) {
    requirePurpose(purpose, CUSTOMER_PURPOSES); requireAtMs(atMs);
    if (typeof q !== "string" || [...q].length > 190 || /[\p{Cc}]/u.test(q)) throw new TypeError("q is invalid");
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = [10, 20, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 20;
    const search = q.trim();
    const conditions = ["status = 'active'"];
    const params = [];
    if (search) {
      const legalNamePrefix = prefix(normalizeLegalName(search).key);
      const normalizedSearch = search.normalize("NFKC");
      if ([...search].length <= 64 && [...normalizedSearch].length <= 64) {
        conditions.push("(customer_code_key LIKE ? ESCAPE '!' OR legal_name_key LIKE ? ESCAPE '!')");
        params.push(prefix(normalizeCustomerCode(search).key), legalNamePrefix);
      } else {
        conditions.push("legal_name_key LIKE ? ESCAPE '!'");
        params.push(legalNamePrefix);
      }
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const [[count]] = await this.database.query(`SELECT COUNT(*) AS total FROM customers ${where}`, params);
    const [rows] = await this.database.query(
      `SELECT ${CUSTOMER_SELECT} FROM customers ${where} ORDER BY customer_code_key ASC, id ASC LIMIT ? OFFSET ?`,
      [...params, safePageSize, (safePage - 1) * safePageSize]
    );
    return Object.freeze({ items: Object.freeze(rows.map(customerProjection)), total: Number(count.total), page: safePage, pageSize: safePageSize });
  }

  async getCreditPolicy(customerId, { atMs } = {}) {
    requireId(customerId, "customerId"); requireAtMs(atMs);
    const [[row]] = await this.database.query(
      `SELECT c.id AS customer_id, p.credit_limit, p.credit_currency_code, p.credit_status,
              p.version AS credit_version
         FROM customers c
         LEFT JOIN customer_credit_profiles p ON p.customer_id = c.id
        WHERE c.id = ?`,
      [customerId]
    );
    if (!row) throw customerNotFound(customerId);
    return creditProjection(row);
  }

  async listAddresses(customerId, { purpose, atMs } = {}) {
    requireId(customerId, "customerId"); requirePurpose(purpose, ADDRESS_PURPOSES); requireAtMs(atMs);
    const [rows] = await this.database.query(
      `SELECT ${ADDRESS_SELECT}
         FROM customer_addresses a
         JOIN customer_address_purposes p ON p.address_id = a.id AND p.customer_id = a.customer_id
        WHERE a.customer_id = ? AND a.status = 'active' AND p.purpose_code = ?
        ORDER BY p.is_default DESC, a.sort_order ASC, a.id ASC`,
      [customerId, purpose]
    );
    return Object.freeze(rows.map(addressProjection));
  }

  async assertAddressUsable(customerId, addressId, options = {}) {
    return this.#assertAddress(this.database, customerId, addressId, options);
  }

  async assertAddressUsableInTransaction(connection, customerId, addressId, options = {}) {
    requireExecutor(connection);
    return this.#assertAddress(connection, customerId, addressId, options, true);
  }

  async listContacts(customerId, { purpose, atMs } = {}) {
    requireId(customerId, "customerId"); requirePurpose(purpose, CONTACT_PURPOSES); requireAtMs(atMs);
    const [rows] = await this.database.query(
      `SELECT ${CONTACT_SELECT}
         FROM customer_contacts c
         JOIN customer_contact_purposes p ON p.contact_id = c.id AND p.customer_id = c.customer_id
        WHERE c.customer_id = ? AND c.status = 'active' AND p.purpose_code = ?
        ORDER BY p.is_default DESC, c.sort_order ASC, c.id ASC`,
      [customerId, purpose]
    );
    return Object.freeze(rows.map(contactProjection));
  }

  async assertContactUsable(customerId, contactId, options = {}) {
    return this.#assertContact(this.database, customerId, contactId, options);
  }

  async assertContactUsableInTransaction(connection, customerId, contactId, options = {}) {
    requireExecutor(connection);
    return this.#assertContact(connection, customerId, contactId, options, true);
  }

  async #assertAddress(connection, customerId, addressId, { purpose, expectedVersion, atMs } = {}, forUpdate = false) {
    requireId(customerId, "customerId"); requireId(addressId, "addressId"); requirePurpose(purpose, ADDRESS_PURPOSES); requireAtMs(atMs);
    requireExpectedVersion(expectedVersion, forUpdate);
    const [[row]] = await connection.query(
      `SELECT ${ADDRESS_SELECT}, customer.status AS customer_status, customer.version AS customer_version
         FROM customers customer
         JOIN customer_addresses a ON a.customer_id = customer.id
         JOIN customer_address_purposes p ON p.address_id = a.id AND p.customer_id = a.customer_id
        WHERE customer.id = ? AND a.id = ? AND a.status = 'active' AND p.purpose_code = ?${forUpdate ? " FOR UPDATE" : ""}`,
      [customerId, addressId, purpose]
    );
    if (!row) throw customerPartyNotFound("address", addressId);
    if (expectedVersion !== undefined && Number(row.version) !== expectedVersion) throw versionConflict(row.version);
    return addressProjection(row);
  }

  async #assertContact(connection, customerId, contactId, { purpose, expectedVersion, atMs } = {}, forUpdate = false) {
    requireId(customerId, "customerId"); requireId(contactId, "contactId"); requirePurpose(purpose, CONTACT_PURPOSES); requireAtMs(atMs);
    requireExpectedVersion(expectedVersion, forUpdate);
    const [[row]] = await connection.query(
      `SELECT ${CONTACT_SELECT}, customer.status AS customer_status, customer.version AS customer_version
         FROM customers customer
         JOIN customer_contacts c ON c.customer_id = customer.id
         JOIN customer_contact_purposes p ON p.contact_id = c.id AND p.customer_id = c.customer_id
        WHERE customer.id = ? AND c.id = ? AND c.status = 'active' AND p.purpose_code = ?${forUpdate ? " FOR UPDATE" : ""}`,
      [customerId, contactId, purpose]
    );
    if (!row) throw customerPartyNotFound("contact", contactId);
    if (expectedVersion !== undefined && Number(row.version) !== expectedVersion) throw versionConflict(row.version);
    return contactProjection(row);
  }
}
