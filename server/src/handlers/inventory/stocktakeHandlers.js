import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { cloneData, deepFreeze } from "../../framework/api/normalizeApiDefaultsConfig.js";
import { AuthenticationError } from "../../framework/auth/AuthenticationError.js";
import { assertActorFresh } from "../../modules/authorization/directoryLookups.js";
import { permissionStaleError } from "../../modules/authorization/adminGuard.js";
import { InventoryStocktakeService } from "../../modules/inventory/InventoryStocktakeService.js";
import { InventoryInquiryService } from "../../modules/inventory/InventoryInquiryService.js";
import { InventoryStocktakeExportService } from "../../modules/inventory/InventoryStocktakeExportService.js";
import { InventoryAuditService } from "../../modules/inventory/InventoryAuditService.js";
import { createStocktakeExportAudit } from "../../modules/inventory/inventoryStocktakeExportAudit.js";
import { inventoryError } from "../../modules/inventory/inventoryErrors.js";
import { issueInventoryHighRiskContext, checkInventoryHighRiskContext, consumeInventoryHighRiskContext } from "../../modules/inventory/inventoryHighRiskContext.js";
import { issueInventoryStocktakeCancelContext, checkInventoryStocktakeCancelContext, consumeInventoryStocktakeCancelContext } from "../../modules/inventory/inventoryStocktakeCancelContext.js";
import { EMPTY, VIEW_POLICY, OPERATION_POLICY, ADJUST_POLICY } from "./inventorySchemas.js";
import { STOCKTAKE_BODIES, STOCKTAKE_PARAMS, STOCKTAKE_QUERIES, STOCKTAKE_RESPONSES,
  normalizeStocktakeCommand, normalizeStocktakeQuery, stocktakePathId } from "./stocktakeSchemas.js";

const ROOT = "/api/v1/inventory/stocktakes";
function writeApi(action, suffix) {
  return { method: "POST", path: action === "create" ? ROOT + "/create" : `${ROOT}/:id/${suffix}`,
    description: `Inventory Stocktake ${action}`, authType: action === "post" ? "jwt-device-password" : action === "cancel" ? "jwt-password" : "jwt",
    authorizationPolicies: action === "post" ? ADJUST_POLICY : OPERATION_POLICY, inputCoercion: false,
    idempotency: { enabled: true, ttlMs: 604800000 }, idempotencyPreparation: true,
    requestSchema: { params: action === "create" ? EMPTY : STOCKTAKE_PARAMS, query: EMPTY, body: STOCKTAKE_BODIES[action] },
    responseSchema: { 200: STOCKTAKE_RESPONSES.command } };
}
function readApi(kind, suffix = "") {
  return { method: "GET", path: ROOT + suffix, description: `Inventory Stocktake ${kind}`, authType: "jwt", authorizationPolicies: VIEW_POLICY,
    inputCoercion: false, requestSchema: { params: kind === "list" ? EMPTY : STOCKTAKE_PARAMS, query: STOCKTAKE_QUERIES[kind], body: EMPTY },
    responseSchema: { 200: kind === "export" ? { type: "object" } : STOCKTAKE_RESPONSES[kind] },
    ...(kind === "export" ? { download: { enabled: true }, timeoutMs: 120000 } : {}) };
}

class StocktakeHandler extends BaseRequestHandler {
  #failed = new WeakSet();
  constructor(services = {}) {
    super(services);
    this.database = services.require("mysqldatabase"); this.time = services.require("time");
    this.audit = new InventoryAuditService({ database: this.database, logger: this.logger, time: this.time });
    const jwt = services.require("jwt");
    this.authOptions = { time: this.time, sessionMaxAgeSeconds: jwt.sessionMaxAgeSeconds, clockToleranceSeconds: jwt.config.jwt.clockToleranceSeconds };
  }
  currentGuard(req, permission = "inventory.view") {
    if (!["jwt", "jwt-password", "jwt-device-password"].includes(req.auth?.type)) throw permissionStaleError();
    const claims = deepFreeze(cloneData(req.auth.claims, "Stocktake authenticated claims")), actorId = Number(claims.sub), signal = req.requestTimeout?.signal;
    if (!Number.isSafeInteger(actorId) || actorId <= 0) throw permissionStaleError();
    const checkTime = () => {
      signal?.throwIfAborted(); const now = this.time.nowMs();
      if (!Number.isSafeInteger(now) || !Number.isSafeInteger(claims.exp) || now >= (claims.exp + this.authOptions.clockToleranceSeconds) * 1000) throw new AuthenticationError("JWT_INVALID", "JWT expired before Stocktake response");
      if (!Number.isSafeInteger(claims.auth_time) || Math.floor(now / 1000) - claims.auth_time > this.authOptions.sessionMaxAgeSeconds) throw new AuthenticationError("SESSION_EXPIRED", "Absolute session lifetime exceeded");
    };
    return async (tx, { locking = false } = {}) => {
      checkTime();
      const reader = locking ? { query: (sql, params) => tx.query(sql + " FOR SHARE", params) } : tx;
      const actor = await assertActorFresh(reader, { actorId, claimedRoles: claims.roles, claimedPermissions: claims.permissions });
      if (!["inventory.view", permission].every(value => actor.permissions.includes(value))) throw permissionStaleError();
      const [[record]] = await reader.query("SELECT version FROM fr_token_versions WHERE subject=?", [claims.sub]);
      const version = Number(record?.version ?? 0);
      if (!Number.isSafeInteger(claims.ver) || claims.ver < 0 || !Number.isSafeInteger(version) || version < 0 || claims.ver < version) throw new AuthenticationError("JWT_INVALID", "JWT revoked before Stocktake response");
      checkTime(); return actor;
    };
  }
  async auditFailure(req, error) {
    if (this.#failed.has(req) || (!this.constructor.action && this.constructor.kind !== "export")) return;
    this.#failed.add(req); const actorId = Number(req.auth?.claims?.sub);
    const input = { actorUserId: Number.isSafeInteger(actorId) && actorId > 0 ? actorId : null,
      actorLabel: Number.isSafeInteger(actorId) && actorId > 0 ? `user:${actorId}` : "unavailable",
      action: this.constructor.action ? `stocktake.${this.constructor.action}` : "inventory.export", targetType: "stocktake",
      targetLabel: this.constructor.api.path, requestId: req.requestId ?? "", correlationId: req.requestId ?? "", errorCode: error.code };
    await (error.statusCode >= 500 || !error.statusCode ? this.audit.recordFailed(input) : this.audit.recordRejected(input));
  }
}

class StocktakeWriteHandler extends StocktakeHandler {
  #prepared = new WeakMap();
  constructor(services = {}) {
    super(services); this.inventory = new InventoryStocktakeService({ database: this.database, time: this.time, logger: this.logger });
    if (this.constructor.action === "post") this.authOptions.signatureMaxSkewSeconds = services.require("deviceBinding").config.deviceBinding.signatureMaxSkewSeconds;
  }
  async prepareIdempotency(req) {
    try {
      const action = this.constructor.action, command = normalizeStocktakeCommand(req, action);
      if (req.auth?.type !== this.constructor.api.authType) throw permissionStaleError();
      const current = this.currentGuard(req, action === "post" ? "inventory.adjust" : "inventory.operation");
      const proof = action === "post" ? issueInventoryHighRiskContext(req, command, this.authOptions)
        : action === "cancel" ? issueInventoryStocktakeCancelContext(req, command, this.authOptions) : null;
      await this.database.withTransaction(async tx => {
        await current(tx, { locking: true });
        if (action === "post") await checkInventoryHighRiskContext(tx, proof, command, { locking: true });
        if (action === "cancel") await checkInventoryStocktakeCancelContext(tx, proof, command, { locking: true });
      });
      this.#prepared.set(req, { command, proof, current });
      const { stocktakeId, ...body } = command.payload;
      return { input: deepFreeze({ params: action === "create" ? {} : { id: String(stocktakeId) }, query: {}, body: { source: command.source, ...body } }),
        replay: async sendCachedResponse => {
          try {
            const record = this.#take(req);
            const guard = action === "post" ? consumeInventoryHighRiskContext(record.proof, record.command)
              : action === "cancel" ? consumeInventoryStocktakeCancelContext(record.proof, record.command) : null;
            await this.database.withTransaction(async tx => {
              await record.current(tx, { locking: true }); if (guard) await guard.check(tx, { locking: true });
              sendCachedResponse();
            }, { signal: req.requestTimeout?.signal });
          } catch (error) { await this.auditFailure(req, error); throw error; }
        } };
    } catch (error) { await this.auditFailure(req, error); throw error; }
  }
  #take(req) {
    const record = this.#prepared.get(req); this.#prepared.delete(req);
    if (!record) throw permissionStaleError(); return record;
  }
  async execute(req) {
    try {
      const record = this.#take(req), action = this.constructor.action;
      const method = { count: "saveCountsInTransaction", add_line: "addLineInTransaction" }[action] ?? `${action}InTransaction`;
      const result = await this.database.withTransaction(async tx => {
        await record.current(tx);
        const result = await this.inventory[method](tx, record.command, record.proof);
        // The unchanged ordinary domain methods do not own HTTP JWT/time; check before the caller's commit.
        await record.current(tx, { locking: true }); return result;
      }, { signal: req.requestTimeout?.signal }).catch(error => {
        if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error?.cause?.code ?? error?.code)) throw inventoryError("CONCURRENT_OPERATION");
        throw error;
      });
      return this.response(result);
    } catch (error) { await this.auditFailure(req, error); throw error; }
  }
}

class StocktakeReadHandler extends StocktakeHandler {
  constructor(services = {}) {
    super(services); this.inquiry = new InventoryInquiryService({ database: this.database, time: this.time });
    if (this.constructor.kind === "export") {
      this.audit = createStocktakeExportAudit({ database: this.database, time: this.time, logger: this.logger });
      this.exports = new InventoryStocktakeExportService({ database: this.database, time: this.time, logger: this.logger, config: services.config.inventory });
    }
  }
  async execute(req, res) {
    const kind = this.constructor.kind, query = normalizeStocktakeQuery(req.input.query, kind);
    const id = kind === "list" ? null : stocktakePathId(req.input.params);
    if (kind === "list" && Object.keys(req.input.params).length) throw permissionStaleError();
    const current = this.currentGuard(req), authorize = ({ signal = req.requestTimeout?.signal } = {}) =>
      this.database.withTransaction(tx => current(tx, { locking: true }), { signal });
    await authorize();
    if (kind === "export") {
      const result = await this.exports.prepare({ stocktakeId: id, filters: query, authorize,
        deadline: req.requestTimeout?.deadline, signal: req.requestTimeout?.signal, requestId: req.requestId ?? "", ip: req.ip ?? "" });
      try {
        res.setHeader("X-Inventory-Export-Truncated", String(result.truncated)); res.setHeader("X-Inventory-Export-Reason", result.truncationReason);
        res.setHeader("X-Inventory-Export-As-Of", String(result.asOf)); res.setHeader("X-Inventory-Export-Generation-Budget-Ms", String(result.generationBudgetMs)); res.setHeader("Pragma", "no-cache");
        return this.file({ stream: result.stream, fileName: result.fileName, contentType: "text/csv; charset=utf-8" });
      } catch (error) { result.stream.destroy(error); throw error; }
    }
    const data = kind === "list" ? await this.inquiry.listStocktakes(query) : kind === "detail" ? await this.inquiry.getStocktake(id, query)
      : await this.inquiry.listStocktakeLines({ stocktakeId: id, ...query });
    await authorize(); return this.response(data);
  }
}

export class CreateInventoryStocktakeHandler extends StocktakeWriteHandler { static handlerName = "createInventoryStocktake"; static action = "create"; static api = writeApi("create"); }
export class UpdateInventoryStocktakeHandler extends StocktakeWriteHandler { static handlerName = "updateInventoryStocktake"; static action = "update"; static api = writeApi("update", "update"); }
export class StartInventoryStocktakeHandler extends StocktakeWriteHandler { static handlerName = "startInventoryStocktake"; static action = "start"; static api = writeApi("start", "start"); }
export class SaveInventoryStocktakeCountsHandler extends StocktakeWriteHandler { static handlerName = "saveInventoryStocktakeCounts"; static action = "count"; static api = writeApi("count", "counts/save"); }
export class AddInventoryStocktakeLineHandler extends StocktakeWriteHandler { static handlerName = "addInventoryStocktakeLine"; static action = "add_line"; static api = writeApi("add_line", "lines/add"); }
export class ReadyInventoryStocktakeHandler extends StocktakeWriteHandler { static handlerName = "readyInventoryStocktake"; static action = "ready"; static api = writeApi("ready", "ready"); }
export class PostInventoryStocktakeHandler extends StocktakeWriteHandler { static handlerName = "postInventoryStocktake"; static action = "post"; static api = writeApi("post", "post"); }
export class CancelInventoryStocktakeHandler extends StocktakeWriteHandler { static handlerName = "cancelInventoryStocktake"; static action = "cancel"; static api = writeApi("cancel", "cancel"); }
export class ListInventoryStocktakesHandler extends StocktakeReadHandler { static handlerName = "listInventoryStocktakes"; static kind = "list"; static api = readApi("list"); }
export class GetInventoryStocktakeHandler extends StocktakeReadHandler { static handlerName = "getInventoryStocktake"; static kind = "detail"; static api = readApi("detail", "/:id"); }
export class ListInventoryStocktakeLinesHandler extends StocktakeReadHandler { static handlerName = "listInventoryStocktakeLines"; static kind = "lines"; static api = readApi("lines", "/:id/lines"); }
export class ExportInventoryStocktakeHandler extends StocktakeReadHandler { static handlerName = "exportInventoryStocktake"; static kind = "export"; static api = readApi("export", "/:id/export"); }
