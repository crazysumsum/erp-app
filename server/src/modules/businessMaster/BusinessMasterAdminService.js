import { assertActorFresh } from "../authorization/directoryLookups.js";
import {
  businessMasterConflict,
  businessMasterNotFound,
  invalidBusinessMasterInput
} from "./businessMasterErrors.js";
import {
  assertCurrencyInput,
  assertPaymentTermRule,
  calculateDueDate,
  normalizePaymentTermInput,
  normalizePaymentTermMutableInput
} from "./businessMasterRules.js";

function assertVersion(version) {
  if (!Number.isInteger(version) || version < 1) {
    throw invalidBusinessMasterInput("VERSION_INVALID", "版本號格式不正確", { field: "version" });
  }
}

function assertReason(reason) {
  const value = typeof reason === "string" ? reason.trim() : "";
  if (value.length < 5 || value.length > 190) {
    throw invalidBusinessMasterInput("REASON_INVALID", "原因必須是 5 至 190 字元", { field: "reason" });
  }
  return value;
}

function paymentTermProjection(term) {
  if (!term) return term;
  const { codeKey: _codeKey, ...publicTerm } = term;
  return publicTerm;
}

export class BusinessMasterAdminService {
  constructor({ database, repository, audit, impactRegistry, authorize = assertActorFresh, time, logger } = {}) {
    if (!database || !repository || !audit || !time || !logger) {
      throw new TypeError("BusinessMasterAdminService requires database, repository, audit, time and logger");
    }
    this.database = database;
    this.repository = repository;
    this.audit = audit;
    this.impactRegistry = impactRegistry;
    this.authorize = authorize;
    this.time = time;
    this.logger = logger;
  }

  async #authorized(connection, input) {
    return this.authorize(connection, {
      actorId: input.actorId,
      claimedRoles: input.claimedRoles,
      claimedPermissions: input.claimedPermissions
    });
  }

  async #record(connection, input, actor, entry) {
    await this.audit.record(connection, {
      ...entry,
      result: entry.result ?? "SUCCESS",
      actorUserId: actor.id,
      correlationId: String(input.correlationId ?? ""),
      idempotencyKeyHash: input.idempotencyKeyHash ?? null,
      createdAt: this.time.nowMs()
    });
  }

  async #runHighRisk(input, entry, work) {
    try {
      return await work();
    } catch (error) {
      const expectedRejection = Number.isInteger(error?.statusCode) &&
        ((error.statusCode >= 400 && error.statusCode < 500) || error.statusCode === 503);
      if (!expectedRejection) throw error;
      await this.database.withTransaction(async (connection) => {
        await this.audit.record(connection, {
          ...entry,
          result: "REJECTED",
          before: null,
          after: null,
          impact: null,
          reason: String(input.reason ?? "").trim().slice(0, 190),
          actorUserId: Number(input.actorId),
          correlationId: String(input.correlationId ?? ""),
          idempotencyKeyHash: input.idempotencyKeyHash ?? null,
          createdAt: this.time.nowMs()
        });
      });
      throw error;
    }
  }

  async listCurrencies(input) {
    await this.#authorized(this.database, input);
    return this.repository.listCurrencies(this.database, input);
  }

  async getCurrency(input) {
    await this.#authorized(this.database, input);
    const row = await this.repository.getCurrency(this.database, input.code);
    if (!row) throw businessMasterNotFound("currency", input.code);
    return row;
  }

  async createCurrency(input) {
    const currency = assertCurrencyInput(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorized(connection, input);
      await this.#authorized(connection, input);
      const created = await this.repository.createCurrency(connection, {
        ...currency,
        actorId: actor.id,
        nowMs: this.time.nowMs()
      });
      await this.#record(connection, input, actor, {
        entityType: "CURRENCY", entityKey: created.code, action: "CREATE", before: null, after: created, impact: null, reason: ""
      });
      return created;
    });
  }

  async updateCurrency(input) {
    assertVersion(input.version);
    const name = assertCurrencyInput({ code: input.code, name: input.name, decimalPlaces: 0 }).name;
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorized(connection, input);
      const before = await this.repository.getCurrency(connection, input.code, { forUpdate: true });
      if (!before) throw businessMasterNotFound("currency", input.code);
      if (before.name === name) throw businessMasterConflict("NO_CHANGE", "提交內容沒有變更");
      await this.#authorized(connection, input);
      const updated = await this.repository.updateCurrency(connection, {
        code: input.code, version: input.version, changes: { name }, actorId: actor.id, nowMs: this.time.nowMs()
      });
      if (!updated) throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
      await this.#record(connection, input, actor, {
        entityType: "CURRENCY", entityKey: input.code, action: "UPDATE", before, after: updated, impact: null, reason: ""
      });
      return updated;
    });
  }

  async listPaymentTerms(input) {
    await this.#authorized(this.database, input);
    const result = await this.repository.listPaymentTerms(this.database, input);
    return { ...result, items: result.items.map(paymentTermProjection) };
  }

  async getPaymentTerm(input) {
    await this.#authorized(this.database, input);
    const row = await this.repository.getPaymentTerm(this.database, input.id);
    if (!row) throw businessMasterNotFound("payment_term", input.id);
    return paymentTermProjection(row);
  }

  async createPaymentTerm(input) {
    const term = normalizePaymentTermInput(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorized(connection, input);
      await this.#authorized(connection, input);
      const created = await this.repository.createPaymentTerm(connection, {
        ...term, actorId: actor.id, nowMs: this.time.nowMs()
      });
      const projection = paymentTermProjection(created);
      await this.#record(connection, input, actor, {
        entityType: "PAYMENT_TERM", entityKey: String(created.id), action: "CREATE", before: null, after: projection, impact: null, reason: ""
      });
      return projection;
    });
  }

  async updatePaymentTerm(input) {
    assertVersion(input.version);
    const { name, description } = normalizePaymentTermMutableInput(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorized(connection, input);
      const before = await this.repository.getPaymentTerm(connection, input.id, { forUpdate: true });
      if (!before) throw businessMasterNotFound("payment_term", input.id);
      if (before.name === name && before.description === description) throw businessMasterConflict("NO_CHANGE", "提交內容沒有變更");
      await this.#authorized(connection, input);
      const updated = await this.repository.updatePaymentTerm(connection, {
        id: input.id, version: input.version, changes: { name, description }, actorId: actor.id, nowMs: this.time.nowMs()
      });
      if (!updated) throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
      const projection = paymentTermProjection(updated);
      await this.#record(connection, input, actor, {
        entityType: "PAYMENT_TERM", entityKey: String(input.id), action: "UPDATE", before: paymentTermProjection(before), after: projection, impact: null, reason: ""
      });
      return projection;
    });
  }

  async calculatePaymentTerm(input) {
    await this.#authorized(this.database, input);
    const term = await this.repository.getPaymentTerm(this.database, input.id);
    if (!term) throw businessMasterNotFound("payment_term", input.id);
    if (term.status !== "ACTIVE") throw businessMasterConflict("PAYMENT_TERM_NOT_ACTIVE", "付款條款目前不可用");
    if (input.expectedVersion !== undefined && term.version !== input.expectedVersion) {
      throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
    }
    const result = calculateDueDate({ calculationType: term.calculationType, dueDays: term.dueDays }, input.baseDate);
    return {
      term: { id: term.id, code: term.code, name: term.name, version: term.version, calculationType: term.calculationType, dueDays: term.dueDays },
      baseDate: input.baseDate,
      dueDate: result.dueDate,
      requiresManualDueDate: result.manual
    };
  }

  async listAudit(input) {
    await this.#authorized(this.database, input);
    return this.repository.listAudit(this.database, input);
  }

  async previewImpact(input) {
    if (!this.impactRegistry) throw new TypeError("BusinessMasterAdminService requires impactRegistry for impact operations");
    await this.#authorized(this.database, input);
    if (input.entityType !== "CURRENCY" && input.entityType !== "PAYMENT_TERM") {
      throw invalidBusinessMasterInput("ENTITY_TYPE_INVALID", "不支援的主資料類型", { field: "entityType" });
    }
    const entity = input.entityType === "CURRENCY"
      ? await this.repository.getCurrency(this.database, input.entityKey)
      : await this.repository.getPaymentTerm(this.database, Number(input.entityKey));
    if (!entity) throw businessMasterNotFound(input.entityType.toLowerCase(), input.entityKey);
    assertVersion(input.version);
    if (entity.version !== input.version) throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
    let proposedChange;
    if (input.entityType === "CURRENCY" && input.operation === "DEACTIVATE") {
      proposedChange = { status: "INACTIVE" };
    } else if (input.entityType === "CURRENCY" && input.operation === "CHANGE_PRECISION") {
      proposedChange = {
        decimalPlaces: assertCurrencyInput({ code: entity.code, name: entity.name, decimalPlaces: input.proposedChange?.decimalPlaces }).decimalPlaces
      };
    } else if (input.entityType === "PAYMENT_TERM" && input.operation === "DEACTIVATE") {
      proposedChange = { status: "INACTIVE" };
    } else if (input.entityType === "PAYMENT_TERM" && input.operation === "CHANGE_RULE") {
      proposedChange = assertPaymentTermRule(input.proposedChange ?? {});
    } else {
      throw invalidBusinessMasterInput("IMPACT_OPERATION_INVALID", "影響預覽操作與資料類型不相容", { field: "operation" });
    }
    return this.impactRegistry.preview({ ...input, proposedChange });
  }

  async changeCurrencyStatus(input, status) {
    assertVersion(input.version);
    const reason = assertReason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorized(connection, input);
      const before = await this.repository.getCurrency(connection, input.code, { forUpdate: true });
      if (!before) throw businessMasterNotFound("currency", input.code);
      if (before.status === status) throw businessMasterConflict("STATUS_TRANSITION_INVALID", "目前狀態不允許這個操作");
      let impact = null;
      if (status === "INACTIVE") {
        impact = await this.impactRegistry.confirm({ ...input, actorId: actor.id, entityType: "CURRENCY", entityKey: input.code, operation: "DEACTIVATE", proposedChange: { status } });
      }
      await this.#authorized(connection, input);
      const updated = await this.repository.updateCurrency(connection, { code: input.code, version: input.version, changes: { status }, actorId: actor.id, nowMs: this.time.nowMs() });
      if (!updated) throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
      await this.#record(connection, input, actor, { entityType: "CURRENCY", entityKey: input.code, action: status === "ACTIVE" ? "ACTIVATE" : "DEACTIVATE", before, after: updated, impact, reason });
      return updated;
    });
  }

  activateCurrency(input) { return this.changeCurrencyStatus(input, "ACTIVE"); }
  deactivateCurrency(input) {
    return this.#runHighRisk(
      input,
      { entityType: "CURRENCY", entityKey: input.code, action: "DEACTIVATE" },
      () => this.changeCurrencyStatus(input, "INACTIVE")
    );
  }

  changeCurrencyPrecision(input) {
    return this.#runHighRisk(
      input,
      { entityType: "CURRENCY", entityKey: input.code, action: "CHANGE_PRECISION" },
      () => this.#changeCurrencyPrecision(input)
    );
  }

  async #changeCurrencyPrecision(input) {
    assertVersion(input.version);
    const reason = assertReason(input.reason);
    const decimalPlaces = assertCurrencyInput({ code: input.code, name: "valid", decimalPlaces: input.decimalPlaces }).decimalPlaces;
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorized(connection, input);
      const before = await this.repository.getCurrency(connection, input.code, { forUpdate: true });
      if (!before) throw businessMasterNotFound("currency", input.code);
      if (before.decimalPlaces === decimalPlaces) throw businessMasterConflict("NO_CHANGE", "提交內容沒有變更");
      const impact = await this.impactRegistry.confirm({ ...input, actorId: actor.id, entityType: "CURRENCY", entityKey: input.code, operation: "CHANGE_PRECISION", proposedChange: { decimalPlaces } });
      await this.#authorized(connection, input);
      const updated = await this.repository.updateCurrency(connection, { code: input.code, version: input.version, changes: { decimalPlaces }, actorId: actor.id, nowMs: this.time.nowMs() });
      if (!updated) throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
      await this.#record(connection, input, actor, { entityType: "CURRENCY", entityKey: input.code, action: "CHANGE_PRECISION", before, after: updated, impact, reason });
      return updated;
    });
  }

  changePaymentTermRule(input) {
    return this.#runHighRisk(
      input,
      { entityType: "PAYMENT_TERM", entityKey: String(input.id), action: "CHANGE_RULE" },
      () => this.#changePaymentTermRule(input)
    );
  }

  async #changePaymentTermRule(input) {
    assertVersion(input.version);
    const reason = assertReason(input.reason);
    const rule = assertPaymentTermRule(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorized(connection, input);
      const before = await this.repository.getPaymentTerm(connection, input.id, { forUpdate: true });
      if (!before) throw businessMasterNotFound("payment_term", input.id);
      if (before.calculationType === rule.calculationType && before.dueDays === rule.dueDays) throw businessMasterConflict("NO_CHANGE", "提交內容沒有變更");
      const impact = await this.impactRegistry.confirm({ ...input, actorId: actor.id, entityType: "PAYMENT_TERM", entityKey: String(input.id), operation: "CHANGE_RULE", proposedChange: rule });
      await this.#authorized(connection, input);
      const updated = await this.repository.updatePaymentTerm(connection, { id: input.id, version: input.version, changes: rule, actorId: actor.id, nowMs: this.time.nowMs() });
      if (!updated) throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
      const projection = paymentTermProjection(updated);
      await this.#record(connection, input, actor, { entityType: "PAYMENT_TERM", entityKey: String(input.id), action: "CHANGE_RULE", before: paymentTermProjection(before), after: projection, impact, reason });
      return projection;
    });
  }

  async changePaymentTermStatus(input, status) {
    assertVersion(input.version);
    const reason = assertReason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorized(connection, input);
      const before = await this.repository.getPaymentTerm(connection, input.id, { forUpdate: true });
      if (!before) throw businessMasterNotFound("payment_term", input.id);
      if (before.status === status) throw businessMasterConflict("STATUS_TRANSITION_INVALID", "目前狀態不允許這個操作");
      let impact = null;
      if (status === "INACTIVE") {
        impact = await this.impactRegistry.confirm({ ...input, actorId: actor.id, entityType: "PAYMENT_TERM", entityKey: String(input.id), operation: "DEACTIVATE", proposedChange: { status } });
      }
      await this.#authorized(connection, input);
      const updated = await this.repository.updatePaymentTerm(connection, { id: input.id, version: input.version, changes: { status }, actorId: actor.id, nowMs: this.time.nowMs() });
      if (!updated) throw businessMasterConflict("VERSION_CONFLICT", "資料已被修改，請重新載入");
      const projection = paymentTermProjection(updated);
      await this.#record(connection, input, actor, { entityType: "PAYMENT_TERM", entityKey: String(input.id), action: status === "ACTIVE" ? "ACTIVATE" : "DEACTIVATE", before: paymentTermProjection(before), after: projection, impact, reason });
      return projection;
    });
  }

  activatePaymentTerm(input) { return this.changePaymentTermStatus(input, "ACTIVE"); }
  deactivatePaymentTerm(input) {
    return this.#runHighRisk(
      input,
      { entityType: "PAYMENT_TERM", entityKey: String(input.id), action: "DEACTIVATE" },
      () => this.changePaymentTermStatus(input, "INACTIVE")
    );
  }
}
