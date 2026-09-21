import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerOperationService } from "./CustomerOperationService.js";
import { CustomerApprovalService } from "./CustomerApprovalService.js";
import {
  customerCodeTaken,
  customerLegalNameTaken,
  customerNotFound,
  customerReferenceNotUsable,
  versionConflict
} from "./customerErrors.js";
import {
  normalizeCustomerCode,
  normalizeIdentifierValue,
  normalizeLegalName,
  normalizeTradingName
} from "./customerNormalization.js";
import { toCustomerDetail, toCustomerSummary } from "./customerProjections.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { BusinessMasterProvider } from "../businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../businessMaster/BusinessMasterRepository.js";

const CUSTOMER_COLUMNS = `id, customer_code, legal_name, trading_name, default_currency_code,
  default_payment_term_id, account_manager_user_id, category_id, industry_id, territory_id,
  website, general_phone, general_email, notes, status, ever_activated_at, version,
  created_at, updated_at, created_by, updated_by`;

const DUPLICATE_COLUMNS = `${CUSTOMER_COLUMNS}, customer_code_key, legal_name_key, trading_name_key`;

const SORT_COLUMNS = Object.freeze({
  code: "customer_code_key",
  legalName: "legal_name_key",
  accountManager: "account_manager_user_id",
  status: "status",
  updatedAt: "updated_at"
});

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError("Customer reference ID is invalid");
  return number;
}

function optionalText(value, field, maxLength) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  const text = value.trim();
  if ([...text].length > maxLength || /[\p{Cc}]/u.test(text)) {
    throw new TypeError(`${field} is invalid`);
  }
  return text;
}

function customerInput(input) {
  const code = normalizeCustomerCode(input.customerCode);
  const legalName = normalizeLegalName(input.legalName);
  const tradingName = normalizeTradingName(input.tradingName ?? "");
  const website = optionalText(input.website, "website", 500);
  const generalEmail = optionalText(input.generalEmail, "generalEmail", 254);
  if (website) {
    let protocol;
    try { protocol = new URL(website).protocol; } catch { throw new TypeError("website is invalid"); }
    if (protocol !== "http:" && protocol !== "https:") throw new TypeError("website is invalid");
  }
  if (generalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(generalEmail)) throw new TypeError("generalEmail is invalid");
  return {
    customerCode: code.value,
    customerCodeKey: code.key,
    legalName: legalName.value,
    legalNameKey: legalName.key,
    tradingName: tradingName.value,
    tradingNameKey: tradingName.key,
    defaultCurrencyCode: input.defaultCurrencyCode ?? null,
    defaultPaymentTermId: nullableNumber(input.defaultPaymentTermId),
    accountManagerUserId: nullableNumber(input.accountManagerUserId),
    categoryId: nullableNumber(input.categoryId),
    industryId: nullableNumber(input.industryId),
    territoryId: nullableNumber(input.territoryId),
    website,
    generalPhone: optionalText(input.generalPhone, "generalPhone", 50),
    generalEmail,
    notes: optionalText(input.notes, "notes", 2000)
  };
}

function duplicate(error) {
  if ((error?.cause?.code || error?.code) !== "ER_DUP_ENTRY") throw error;
  if (String(error?.cause?.message ?? error?.message ?? "").includes("uq_customers_legal_name_key")) throw customerLegalNameTaken();
  throw customerCodeTaken();
}

function prefix(value) {
  return `${value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;
}

function list(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function epoch(value, field) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${field} is invalid`);
  return number;
}

function purposesByOwner(rows, ownerColumn) {
  const result = new Map();
  for (const row of rows) {
    const id = Number(row[ownerColumn]);
    if (!result.has(id)) result.set(id, []);
    result.get(id).push({ code: row.purpose_code, isDefault: Boolean(row.is_default) });
  }
  return result;
}

export class CustomerService {
  constructor({ database, time, audit = new CustomerAuditLogService(), operations = new CustomerOperationService(), actorVerifier = assertActorFresh, businessMaster, approvals } = {}) {
    if (!database || !time) throw new TypeError("CustomerService requires database and time");
    this.database = database;
    this.time = time;
    this.audit = audit;
    this.operations = operations;
    this.actorVerifier = actorVerifier;
    this.businessMaster = businessMaster ?? new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
    this.approvals = approvals ?? new CustomerApprovalService({ database, time, audit });
  }

  async create({ actorId, claimedRoles, claimedPermissions, idempotencyKey, requestId, ip, ...input }) {
    const customer = customerInput(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.actorVerifier(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();
      const started = await this.operations.begin(connection, {
        actorId,
        routeKey: "customer.create",
        idempotencyKey,
        payload: customer,
        nowMs
      });
      if (started.replay) return this.#replayedCustomer(connection, started.replay);

      await this.#assertNewDefaults(connection, customer);

      let id;
      try {
        const [result] = await connection.execute(
          `INSERT INTO customers
             (customer_code, customer_code_key, legal_name, legal_name_key, trading_name, trading_name_key,
              default_currency_code, default_payment_term_id, account_manager_user_id, category_id, industry_id,
              territory_id, website, general_phone, general_email, notes, status, version,
              created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
          [customer.customerCode, customer.customerCodeKey, customer.legalName, customer.legalNameKey,
            customer.tradingName, customer.tradingNameKey, customer.defaultCurrencyCode,
            customer.defaultPaymentTermId, customer.accountManagerUserId, customer.categoryId, customer.industryId,
            customer.territoryId, customer.website, customer.generalPhone, customer.generalEmail, customer.notes,
            nowMs, nowMs, actorId, actorId]
        );
        id = Number(result.insertId);
      } catch (error) {
        duplicate(error);
      }
      const created = await this.#get(connection, id);
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username, action: "customer.create",
        targetType: "customer", targetId: id, customerId: id, targetLabel: created.customer_code,
        detail: { after: this.#auditSnapshot(created) }, requestId, ip
      });
      await this.operations.succeed(connection, {
        operationId: started.operationId, resourceType: "customer", resourceId: id,
        resultVersion: Number(created.version), nowMs
      });
      return { customer: toCustomerDetail(created), operation: { operationId: started.operationId, status: "succeeded", resourceType: "customer", resourceId: id, resultVersion: Number(created.version), errorCode: null } };
    });
  }

  async update({ actorId, claimedRoles, claimedPermissions, id, idempotencyKey, requestId, ip, version, reason, ...input }) {
    const customer = customerInput({ ...input, customerCode: "update-placeholder" });
    return this.database.withTransaction(async (connection) => {
      const actor = await this.actorVerifier(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();
      const started = await this.operations.begin(connection, {
        actorId, routeKey: "customer.update", idempotencyKey, payload: { id: Number(id), version: Number(version), reason, ...customer }, nowMs
      });
      if (started.replay) return this.#replayedCustomer(connection, started.replay);
      const before = await this.#get(connection, id, { forUpdate: true });
      if (!before) throw customerNotFound(id);
      await this.#assertNewDefaults(connection, customer, before);
      let result;
      try {
        [result] = await connection.execute(
          `UPDATE customers SET legal_name = ?, legal_name_key = ?, trading_name = ?, trading_name_key = ?,
               default_currency_code = ?, default_payment_term_id = ?, account_manager_user_id = ?, category_id = ?,
               industry_id = ?, territory_id = ?, website = ?, general_phone = ?, general_email = ?, notes = ?,
               version = version + 1, updated_at = ?, updated_by = ?
            WHERE id = ? AND version = ?`,
          [customer.legalName, customer.legalNameKey, customer.tradingName, customer.tradingNameKey,
            customer.defaultCurrencyCode, customer.defaultPaymentTermId, customer.accountManagerUserId,
            customer.categoryId, customer.industryId, customer.territoryId, customer.website, customer.generalPhone,
            customer.generalEmail, customer.notes, nowMs, actorId, id, version]
        );
      } catch (error) {
        duplicate(error);
      }
      if (result.affectedRows !== 1) throw versionConflict(before.version);
      if (before.legal_name_key !== customer.legalNameKey || before.default_currency_code !== customer.defaultCurrencyCode) {
        await this.approvals.invalidateForCriticalChange(connection, { customer: before, actorId, actorUsername: actor.username, reason, requestId, ip });
      }
      const updated = await this.#get(connection, id);
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username, action: "customer.update",
        targetType: "customer", targetId: Number(id), customerId: Number(id), targetLabel: updated.customer_code,
        reason: String(reason ?? ""), detail: { before: this.#auditSnapshot(before), after: this.#auditSnapshot(updated) }, requestId, ip
      });
      await this.operations.succeed(connection, { operationId: started.operationId, resourceType: "customer", resourceId: Number(id), resultVersion: Number(updated.version), nowMs });
      return { customer: toCustomerDetail(updated), operation: { operationId: started.operationId, status: "succeeded", resourceType: "customer", resourceId: Number(id), resultVersion: Number(updated.version), errorCode: null } };
    });
  }

  async get({ actorId, claimedRoles, claimedPermissions, id }) {
    await this.actorVerifier(this.database, { actorId, claimedRoles, claimedPermissions });
    const row = await this.#get(this.database, id);
    if (!row) throw customerNotFound(id);
    const [addresses, contacts, identifiers, creditRows] = await Promise.all([
      this.database.query(`SELECT id, customer_id, label, recipient_company_department, address_line1, address_line2,
          address_line3, city, state_region, postal_code, country_code, phone, notes, sort_order, status, version
        FROM customer_addresses WHERE customer_id = ? ORDER BY sort_order ASC, id ASC LIMIT 100`, [id]),
      this.database.query(`SELECT id, customer_id, name, job_title, department, email, phone, mobile,
          preferred_language, notes, sort_order, status, version
        FROM customer_contacts WHERE customer_id = ? ORDER BY sort_order ASC, id ASC LIMIT 100`, [id]),
      this.database.query(`SELECT id, customer_id, identifier_type, issuer_country_code, identifier_value,
          valid_from, expires_at, notes, status, version
        FROM customer_identifiers WHERE customer_id = ? ORDER BY id ASC LIMIT 100`, [id]),
      this.database.query(`SELECT credit_limit, credit_currency_code, credit_status, version
        FROM customer_credit_profiles WHERE customer_id = ?`, [id])
    ]);
    const [addressPurposes, contactPurposes] = await Promise.all([
      this.#purposes("address", id, addresses[0]),
      this.#purposes("contact", id, contacts[0])
    ]);
    return toCustomerDetail(row, this.#detailRelations({
      addresses: addresses[0], addressPurposes, contacts: contacts[0],
      contactPurposes, identifiers: identifiers[0], credit: creditRows[0][0]
    }));
  }

  async listAddresses(input) {
    return this.#listChildren("address", input);
  }

  async listContacts(input) {
    return this.#listChildren("contact", input);
  }

  async listIdentifiers(input) {
    return this.#listChildren("identifier", input);
  }

  async list({
    actorId, claimedRoles, claimedPermissions, q = "", page = 1, pageSize = 20,
    sortBy = "updatedAt", sortDirection, descending = true, status, currencyCode,
    paymentTermId, accountManagerUserId, categoryId, industryId, territoryId, creditStatus,
    missing, createdFrom, createdTo, updatedFrom, updatedTo, includeArchived = false
  }) {
    await this.actorVerifier(this.database, { actorId, claimedRoles, claimedPermissions });
    const conditions = [];
    const params = [];
    const search = String(q).trim();
    let exactOrder = [];
    if (search) {
      const name = normalizeLegalName(search).key;
      const normalizedSearch = search.normalize("NFKC");
      const namePrefix = prefix(name);
      const identifierPrefix = prefix(normalizeIdentifierValue(search).key);
      const childConditions = [
        "trading_name_key LIKE ? ESCAPE '!'",
        "general_phone LIKE ? ESCAPE '!'",
        "general_email LIKE ? ESCAPE '!'",
        `EXISTS (SELECT 1 FROM customer_identifiers ci WHERE ci.customer_id = customers.id AND ci.status = 'active' AND ci.identifier_value_key LIKE ? ESCAPE '!')`,
        `EXISTS (SELECT 1 FROM customer_contacts cc WHERE cc.customer_id = customers.id AND cc.status = 'active'
          AND (cc.name LIKE ? ESCAPE '!' OR cc.email LIKE ? ESCAPE '!' OR cc.phone LIKE ? ESCAPE '!' OR cc.mobile LIKE ? ESCAPE '!'))`,
        `EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.customer_id = customers.id AND ca.status = 'active'
          AND (ca.label LIKE ? ESCAPE '!' OR ca.address_line1 LIKE ? ESCAPE '!' OR ca.city LIKE ? ESCAPE '!' OR ca.postal_code LIKE ? ESCAPE '!'))`
      ];
      if ([...search].length <= 64 && [...normalizedSearch].length <= 64) {
        const code = normalizeCustomerCode(search).key;
        conditions.push(`(customer_code_key LIKE ? ESCAPE '!' OR legal_name_key LIKE ? ESCAPE '!' OR ${childConditions.join(" OR ")})`);
        params.push(prefix(code), namePrefix, namePrefix, namePrefix, namePrefix, identifierPrefix, ...Array(8).fill(namePrefix));
        exactOrder = [code, name];
      } else {
        conditions.push(`(legal_name_key LIKE ? ESCAPE '!' OR ${childConditions.join(" OR ")})`);
        params.push(namePrefix, namePrefix, namePrefix, namePrefix, identifierPrefix, ...Array(8).fill(namePrefix));
      }
    }
    const statuses = list(status);
    if (statuses.length) {
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    } else if (!includeArchived) {
      conditions.push("status <> 'archived'");
    }
    for (const [value, column] of [[currencyCode, "default_currency_code"], [paymentTermId, "default_payment_term_id"],
      [accountManagerUserId, "account_manager_user_id"], [categoryId, "category_id"], [industryId, "industry_id"], [territoryId, "territory_id"]]) {
      if (value !== undefined && value !== null && value !== "") { conditions.push(`${column} = ?`); params.push(value); }
    }
    if (creditStatus) {
      conditions.push("EXISTS (SELECT 1 FROM customer_credit_profiles cp WHERE cp.customer_id = customers.id AND cp.credit_status = ?)");
      params.push(creditStatus);
    }
    const missingValues = new Set(list(missing));
    for (const value of missingValues) {
      if (!["shippingDefault", "billingDefault", "contactDefault", "paymentTerm", "credit"].includes(value)) {
        throw new TypeError(`missing value is not supported: ${value}`);
      }
    }
    if (missingValues.has("shippingDefault")) conditions.push("NOT EXISTS (SELECT 1 FROM customer_address_purposes cap WHERE cap.customer_id = customers.id AND cap.purpose_code = 'shipping' AND cap.is_default = 1)");
    if (missingValues.has("billingDefault")) conditions.push("NOT EXISTS (SELECT 1 FROM customer_address_purposes cap WHERE cap.customer_id = customers.id AND cap.purpose_code = 'billing' AND cap.is_default = 1)");
    if (missingValues.has("contactDefault")) conditions.push("NOT EXISTS (SELECT 1 FROM customer_contact_purposes ccp WHERE ccp.customer_id = customers.id AND ccp.purpose_code = 'general' AND ccp.is_default = 1)");
    if (missingValues.has("paymentTerm")) conditions.push("default_payment_term_id IS NULL");
    if (missingValues.has("credit")) conditions.push("NOT EXISTS (SELECT 1 FROM customer_credit_profiles cp WHERE cp.customer_id = customers.id)");
    for (const [value, operator, column, field] of [[createdFrom, ">=", "created_at", "createdFrom"], [createdTo, "<=", "created_at", "createdTo"],
      [updatedFrom, ">=", "updated_at", "updatedFrom"], [updatedTo, "<=", "updated_at", "updatedTo"]]) {
      const timestamp = epoch(value, field);
      if (timestamp !== null) { conditions.push(`${column} ${operator} ?`); params.push(timestamp); }
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = [10, 20, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 20;
    const sort = SORT_COLUMNS[sortBy] ?? SORT_COLUMNS.updatedAt;
    const direction = sortDirection ? (sortDirection === "asc" ? "ASC" : "DESC") : (descending ? "DESC" : "ASC");
    const ranking = exactOrder.length ? "CASE WHEN customer_code_key = ? THEN 0 WHEN legal_name_key = ? THEN 1 ELSE 2 END, " : "";
    const [countRows] = await this.database.query(`SELECT COUNT(*) AS total FROM customers ${where}`, params);
    const [idRows] = await this.database.query(
      `SELECT id FROM customers ${where}
       ORDER BY ${ranking}${sort} ${direction}, id DESC LIMIT ? OFFSET ?`,
      [...params, ...exactOrder, safePageSize, (safePage - 1) * safePageSize]
    );
    const ids = idRows.map((row) => Number(row.id));
    if (ids.length === 0) return { items: [], total: Number(countRows[0].total), page: safePage, pageSize: safePageSize };
    const [rows] = await this.database.query(
      `SELECT ${CUSTOMER_COLUMNS}, COALESCE((SELECT cp.credit_status FROM customer_credit_profiles cp WHERE cp.customer_id = customers.id), 'not_configured') AS credit_status
         FROM customers
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    const summariesById = new Map(rows.map((row) => [Number(row.id), toCustomerSummary(row)]));
    return { items: ids.map((id) => summariesById.get(id)), total: Number(countRows[0].total), page: safePage, pageSize: safePageSize };
  }

  async checkDuplicates({ actorId, claimedRoles, claimedPermissions, customerCode, legalName, tradingName = "" }) {
    await this.actorVerifier(this.database, { actorId, claimedRoles, claimedPermissions });
    const code = normalizeCustomerCode(customerCode).key;
    const legal = normalizeLegalName(legalName).key;
    const trading = normalizeTradingName(tradingName).key;
    const [rows] = await this.database.query(
      `SELECT ${DUPLICATE_COLUMNS}, COALESCE((SELECT cp.credit_status FROM customer_credit_profiles cp WHERE cp.customer_id = customers.id), 'not_configured') AS credit_status
         FROM customers
        WHERE customer_code_key = ? OR legal_name_key = ? OR (? IS NOT NULL AND trading_name_key = ?)
        ORDER BY id ASC LIMIT 12`,
      [code, legal, trading, trading]
    );
    return { code: rows.filter((row) => row.customer_code_key === code).map(toCustomerSummary), legalName: rows.filter((row) => row.legal_name_key === legal).map(toCustomerSummary), tradingName: rows.filter((row) => trading && row.trading_name_key === trading).slice(0, 10).map(toCustomerSummary) };
  }

  async getOperation({ actorId, claimedRoles, claimedPermissions, operationId }) {
    await this.actorVerifier(this.database, { actorId, claimedRoles, claimedPermissions });
    return this.operations.getForActor(this.database, { actorId, operationId });
  }

  async #get(connection, id, { forUpdate = false } = {}) {
    const [rows] = await connection.query(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id = ?${forUpdate ? " FOR UPDATE" : ""}`, [id]);
    return rows[0] ?? null;
  }

  async #assertNewDefaults(connection, customer, before = null) {
    if (customer.defaultCurrencyCode && customer.defaultCurrencyCode !== before?.default_currency_code) {
      await this.businessMaster.assertCurrencyUsableInTransaction(connection, {
        code: customer.defaultCurrencyCode, purpose: "new_assignment"
      });
    }
    if (customer.defaultPaymentTermId && customer.defaultPaymentTermId !== nullableNumber(before?.default_payment_term_id)) {
      await this.businessMaster.assertPaymentTermUsableInTransaction(connection, {
        id: customer.defaultPaymentTermId, purpose: "new_assignment"
      });
    }
    for (const [field, column, table] of [["categoryId", "category_id", "customer_categories"], ["industryId", "industry_id", "customer_industries"], ["territoryId", "territory_id", "customer_territories"]]) {
      if (!customer[field] || customer[field] === nullableNumber(before?.[column])) continue;
      const [[row]] = await connection.query(`SELECT id FROM ${table} WHERE id = ? AND status = 'active'`, [customer[field]]);
      if (!row) throw customerReferenceNotUsable(field);
    }
    if (customer.accountManagerUserId && customer.accountManagerUserId !== nullableNumber(before?.account_manager_user_id)) {
      const [[row]] = await connection.query("SELECT id FROM users WHERE id = ? AND status = 'active'", [customer.accountManagerUserId]);
      if (!row) throw customerReferenceNotUsable("accountManagerUserId");
    }
  }

  async #listChildren(type, { actorId, claimedRoles, claimedPermissions, id, page = 1, pageSize = 20 }) {
    await this.actorVerifier(this.database, { actorId, claimedRoles, claimedPermissions });
    if (!await this.#get(this.database, id)) throw customerNotFound(id);
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = [10, 20, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 20;
    const offset = (safePage - 1) * safePageSize;
    const definitions = {
      address: {
        table: "customer_addresses",
        order: "sort_order ASC, id ASC",
        columns: `id, customer_id, label, recipient_company_department, address_line1, address_line2,
          address_line3, city, state_region, postal_code, country_code, phone, notes, sort_order, status, version`
      },
      contact: {
        table: "customer_contacts",
        order: "sort_order ASC, id ASC",
        columns: `id, customer_id, name, job_title, department, email, phone, mobile,
          preferred_language, notes, sort_order, status, version`
      },
      identifier: {
        table: "customer_identifiers",
        order: "id ASC",
        columns: `id, customer_id, identifier_type, issuer_country_code, identifier_value,
          valid_from, expires_at, notes, status, version`
      }
    };
    const definition = definitions[type];
    const [countResult, rowsResult] = await Promise.all([
      this.database.query(`SELECT COUNT(*) AS total FROM ${definition.table} WHERE customer_id = ?`, [id]),
      this.database.query(`SELECT ${definition.columns} FROM ${definition.table}
        WHERE customer_id = ? ORDER BY ${definition.order} LIMIT ? OFFSET ?`, [id, safePageSize, offset])
    ]);
    const total = countResult[0][0].total;
    const rows = rowsResult[0];
    const relations = this.#detailRelations({
      addresses: type === "address" ? rows : [],
      addressPurposes: type === "address" ? await this.#purposes("address", id, rows) : [],
      contacts: type === "contact" ? rows : [],
      contactPurposes: type === "contact" ? await this.#purposes("contact", id, rows) : [],
      identifiers: type === "identifier" ? rows : []
    });
    const key = `${type}${type === "address" ? "es" : "s"}`;
    return { items: relations[key], total: Number(total), page: safePage, pageSize: safePageSize };
  }

  async #purposes(type, customerId, rows) {
    if (rows.length === 0) return [];
    const owner = `${type}_id`;
    const table = `customer_${type}_purposes`;
    const ids = rows.map((row) => Number(row.id));
    const [purposes] = await this.database.query(
      `SELECT ${owner}, purpose_code, is_default FROM ${table}
        WHERE customer_id = ? AND ${owner} IN (${ids.map(() => "?").join(",")})
        ORDER BY ${owner} ASC, purpose_code ASC`,
      [customerId, ...ids]
    );
    return purposes;
  }

  #detailRelations({ addresses, addressPurposes, contacts, contactPurposes, identifiers, credit }) {
    const addressPurposeMap = purposesByOwner(addressPurposes, "address_id");
    const contactPurposeMap = purposesByOwner(contactPurposes, "contact_id");
    return {
      addresses: addresses.map((row) => ({
        id: Number(row.id), customerId: Number(row.customer_id), label: row.label,
        recipientCompanyDepartment: row.recipient_company_department, addressLine1: row.address_line1,
        addressLine2: row.address_line2, addressLine3: row.address_line3, city: row.city,
        stateRegion: row.state_region, postalCode: row.postal_code, countryCode: row.country_code,
        phone: row.phone, notes: row.notes, sortOrder: Number(row.sort_order), status: row.status,
        version: Number(row.version), purposes: addressPurposeMap.get(Number(row.id)) ?? []
      })),
      contacts: contacts.map((row) => ({
        id: Number(row.id), customerId: Number(row.customer_id), name: row.name, jobTitle: row.job_title,
        department: row.department, email: row.email, phone: row.phone, mobile: row.mobile,
        preferredLanguage: row.preferred_language, notes: row.notes, sortOrder: Number(row.sort_order),
        status: row.status, version: Number(row.version), purposes: contactPurposeMap.get(Number(row.id)) ?? []
      })),
      identifiers: identifiers.map((row) => ({
        id: Number(row.id), customerId: Number(row.customer_id), identifierType: row.identifier_type,
        issuerCountryCode: row.issuer_country_code, identifierValue: row.identifier_value,
        validFrom: row.valid_from === null ? null : Number(row.valid_from),
        expiresAt: row.expires_at === null ? null : Number(row.expires_at), notes: row.notes,
        status: row.status, version: Number(row.version)
      })),
      credit: credit ? {
        configured: true, creditLimit: credit.credit_limit, currencyCode: credit.credit_currency_code,
        status: credit.credit_status, policyVersion: Number(credit.version)
      } : undefined
    };
  }

  async #replayedCustomer(connection, operation) {
    if (operation.status !== "succeeded" || operation.resourceType !== "customer" || !operation.resourceId) return { customer: null, operation };
    const row = await this.#get(connection, operation.resourceId);
    if (!row) return { customer: null, operation: { ...operation, status: "unknown" } };
    return { customer: toCustomerDetail(row), operation };
  }

  #auditSnapshot(row) {
    return {
      id: Number(row.id), customerCode: row.customer_code, legalName: row.legal_name,
      tradingName: row.trading_name, defaultCurrencyCode: row.default_currency_code,
      defaultPaymentTermId: nullableNumber(row.default_payment_term_id), accountManagerUserId: nullableNumber(row.account_manager_user_id),
      categoryId: nullableNumber(row.category_id), industryId: nullableNumber(row.industry_id), territoryId: nullableNumber(row.territory_id),
      website: row.website, generalPhone: row.general_phone, generalEmail: row.general_email,
      status: row.status, everActivatedAt: nullableNumber(row.ever_activated_at), version: Number(row.version)
    };
  }
}
