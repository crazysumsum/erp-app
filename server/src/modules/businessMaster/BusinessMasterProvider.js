import { businessMasterConflict } from "./businessMasterErrors.js";
import { calculateDueDate } from "./businessMasterRules.js";

function requireConnection(connection) {
  if (!connection || (typeof connection.query !== "function" && typeof connection.execute !== "function")) {
    throw new TypeError("A caller-owned transaction connection is required");
  }
}

function requirePurpose(purpose) {
  if (purpose !== "new_assignment" && purpose !== "history") {
    throw businessMasterConflict("PROVIDER_PURPOSE_INVALID", "不支援的主資料查詢用途", { purpose });
  }
}

function currencyProjection(row) {
  if (!row) return row;
  return { code: row.code, name: row.name, decimalPlaces: row.decimalPlaces, status: row.status, version: row.version };
}

function paymentTermProjection(row) {
  if (!row) return row;
  return { id: row.id, code: row.code, name: row.name, calculationType: row.calculationType, dueDays: row.dueDays, status: row.status, version: row.version };
}

export class BusinessMasterProvider {
  static contract = "business-master-currency-payment-term-provider/v1";

  constructor({ database, repository } = {}) {
    if (!database || !repository) throw new TypeError("BusinessMasterProvider requires database and repository");
    this.database = database;
    this.repository = repository;
  }

  async listActiveCurrencies({ page = 1, pageSize = 100 } = {}) {
    return (await this.repository.listCurrencies(this.database, { status: "ACTIVE", page, pageSize })).items.map(currencyProjection);
  }

  async listActivePaymentTerms({ page = 1, pageSize = 100 } = {}) {
    return (await this.repository.listPaymentTerms(this.database, { status: "ACTIVE", page, pageSize })).items.map(paymentTermProjection);
  }

  async getCurrencyHistory(code) { return currencyProjection(await this.repository.getCurrency(this.database, code)); }
  async getPaymentTermHistory(id) { return paymentTermProjection(await this.repository.getPaymentTerm(this.database, id)); }

  async assertCurrencyUsableInTransaction(connection, { code, expectedVersion, purpose = "new_assignment" }) {
    requireConnection(connection);
    requirePurpose(purpose);
    const currency = await this.repository.getCurrency(connection, code, { forUpdate: true });
    if (!currency || (purpose === "new_assignment" && currency.status !== "ACTIVE")) {
      throw businessMasterConflict("CURRENCY_NOT_ACTIVE", "貨幣目前不可用", { code });
    }
    if (expectedVersion !== undefined && currency.version !== expectedVersion) {
      throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
    }
    return currencyProjection(currency);
  }

  async assertPaymentTermUsableInTransaction(connection, { id, expectedVersion, purpose = "new_assignment" }) {
    requireConnection(connection);
    requirePurpose(purpose);
    const term = await this.repository.getPaymentTerm(connection, id, { forUpdate: true });
    if (!term || (purpose === "new_assignment" && term.status !== "ACTIVE")) {
      throw businessMasterConflict("PAYMENT_TERM_NOT_ACTIVE", "付款條款目前不可用", { id });
    }
    if (expectedVersion !== undefined && term.version !== expectedVersion) {
      throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
    }
    return paymentTermProjection(term);
  }

  calculatePaymentTermSnapshot(term, baseDate) {
    const result = calculateDueDate({ calculationType: term.calculationType, dueDays: term.dueDays }, baseDate);
    return {
      term: { id: term.id, code: term.code, name: term.name, version: term.version, calculationType: term.calculationType, dueDays: term.dueDays },
      baseDate,
      dueDate: result.dueDate,
      requiresManualDueDate: result.manual
    };
  }


  async calculateDueDateInTransaction(connection, { id, expectedVersion, baseDate, purpose = "new_assignment" }) {
    const term = await this.assertPaymentTermUsableInTransaction(connection, { id, expectedVersion, purpose });
    return this.calculatePaymentTermSnapshot(term, baseDate);
  }
}
