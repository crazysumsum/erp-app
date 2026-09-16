import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerOperationService } from "./CustomerOperationService.js";
import {
  customerCodeTaken,
  customerLegalNameTaken,
  customerNotFound,
  versionConflict
} from "./customerErrors.js";
import {
  normalizeCustomerCode,
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

const SORT_COLUMNS = Object.freeze({
  code: "customer_code_key",
  legalName: "legal_name_key",
  status: "status",
  updatedAt: "updated_at"
});

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
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
    website: optionalText(input.website, "website", 500),
    generalPhone: optionalText(input.generalPhone, "generalPhone", 50),
    generalEmail: optionalText(input.generalEmail, "generalEmail", 254),
    notes: optionalText(input.notes, "notes", 2000)
  };
}

function duplicate(error) {
  if ((error?.cause?.code || error?.code) !== "ER_DUP_ENTRY") throw error;
  if (String(error?.message ?? "").includes("uq_customers_legal_name_key")) throw customerLegalNameTaken();
  throw customerCodeTaken();
}

function prefix(value) {
  return `${value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;
}

export class CustomerService {
  constructor({ database, time, audit = new CustomerAuditLogService(), operations = new CustomerOperationService(), actorVerifier = assertActorFresh, businessMaster } = {}) {
    if (!database || !time) throw new TypeError("CustomerService requires database and time");
    this.database = database;
    this.time = time;
    this.audit = audit;
    this.operations = operations;
    this.actorVerifier = actorVerifier;
    this.businessMaster = businessMaster ?? new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
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
      await this.#assertNewDefaults(connection, customer);
      const before = await this.#get(connection, id, { forUpdate: true });
      if (!before) throw customerNotFound(id);
      const [result] = await connection.execute(
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
      if (result.affectedRows !== 1) throw versionConflict(before.version);
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
    return toCustomerDetail(row);
  }

  async list({ actorId, claimedRoles, claimedPermissions, q = "", page = 1, pageSize = 20, sortBy = "updatedAt", descending = true, status }) {
    await this.actorVerifier(this.database, { actorId, claimedRoles, claimedPermissions });
    const conditions = [];
    const params = [];
    const search = String(q).trim();
    if (search) {
      const name = normalizeLegalName(search).key;
      const normalizedSearch = search.normalize("NFKC");
      if ([...search].length <= 64 && [...normalizedSearch].length <= 64) {
        conditions.push("(customer_code_key LIKE ? ESCAPE '!' OR legal_name_key LIKE ? ESCAPE '!')");
        params.push(prefix(normalizeCustomerCode(search).key), prefix(name));
      } else {
        conditions.push("legal_name_key LIKE ? ESCAPE '!'");
        params.push(prefix(name));
      }
    }
    if (status) { conditions.push("status = ?"); params.push(status); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = [10, 20, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 20;
    const sort = SORT_COLUMNS[sortBy] ?? SORT_COLUMNS.updatedAt;
    const direction = descending ? "DESC" : "ASC";
    const [countRows] = await this.database.query(`SELECT COUNT(*) AS total FROM customers ${where}`, params);
    const [idRows] = await this.database.query(
      `SELECT id FROM customers ${where}
       ORDER BY ${sort} ${direction}, id DESC LIMIT ? OFFSET ?`,
      [...params, safePageSize, (safePage - 1) * safePageSize]
    );
    const ids = idRows.map((row) => Number(row.id));
    if (ids.length === 0) return { items: [], total: Number(countRows[0].total), page: safePage, pageSize: safePageSize };
    const [rows] = await this.database.query(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id IN (${ids.map(() => "?").join(",")})`,
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
      `SELECT ${CUSTOMER_COLUMNS} FROM customers
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

  async #assertNewDefaults(connection, customer) {
    if (customer.defaultCurrencyCode) {
      await this.businessMaster.assertCurrencyUsableInTransaction(connection, {
        code: customer.defaultCurrencyCode, purpose: "new_assignment"
      });
    }
    if (customer.defaultPaymentTermId) {
      await this.businessMaster.assertPaymentTermUsableInTransaction(connection, {
        id: customer.defaultPaymentTermId, purpose: "new_assignment"
      });
    }
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
