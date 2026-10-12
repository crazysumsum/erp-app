import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { deepFreeze, plainObject } from "../../framework/api/normalizeApiDefaultsConfig.js";
import { permissionStaleError } from "../../modules/authorization/adminGuard.js";
import { normalizeAdjustmentCommand } from "../../modules/inventory/inventoryAdjustmentPosting.js";
import { normalizeReversalCommand } from "../../modules/inventory/inventoryReversalPosting.js";
import { inventoryError } from "../../modules/inventory/inventoryErrors.js";
import { checkInventoryHighRiskContext, consumeInventoryHighRiskContext, issueInventoryHighRiskContext } from "../../modules/inventory/inventoryHighRiskContext.js";
import { InventoryPostingService } from "../../modules/inventory/InventoryPostingService.js";
import {
  ADJUSTMENT_CREATE,
  ADJUSTMENT_RESPONSE,
  ADJUST_POLICY,
  BIN_MOVE_CREATE,
  BIN_MOVE_RESPONSE,
  EMPTY,
  ISSUE_CREATE,
  ISSUE_RESPONSE,
  OPERATION_POLICY,
  RECEIPT_CREATE,
  RECEIPT_RESPONSE,
  REVERSAL_CREATE,
  REVERSAL_ID_PARAMS,
  REVERSAL_RESPONSE,
  STATUS_TRANSFER_CREATE
} from "./inventorySchemas.js";

class HighRiskPostingHandler extends BaseRequestHandler {
  #prepared = new WeakMap();

  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryPostingService({ database: services.require("mysqldatabase"),
      logger: services.require("logging").logger, time: services.require("time") });
    const jwt = services.require("jwt"), device = services.require("deviceBinding");
    this.highRiskOptions = Object.freeze({ time: services.require("time"), sessionMaxAgeSeconds: jwt.sessionMaxAgeSeconds,
      clockToleranceSeconds: jwt.config.jwt.clockToleranceSeconds, signatureMaxSkewSeconds: device.config.deviceBinding.signatureMaxSkewSeconds });
  }

  async prepareIdempotency(req) {
    try {
      let command;
      const reversal = this.constructor.action === "movement.reverse";
      try {
        for (const location of reversal ? ["query"] : ["params", "query"]) {
          if (Object.keys(plainObject(req.input[location], location)).length) throw inventoryError("INVENTORY_INPUT_INVALID", { field: location });
        }
        const params = plainObject(req.input.params, "params");
        if (reversal && (Object.keys(params).length !== 1 || typeof params.id !== "string" || !/^[1-9][0-9]*$/u.test(params.id) ||
            !Number.isSafeInteger(Number(params.id)) || Number(params.id) <= 0)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "id" });
        const { password, source, ...payload } = plainObject(req.input.body, "body");
        if (reversal && Object.hasOwn(payload, "movementId")) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "movementId" });
        if (typeof password !== "string" || [...password].length < 1 || [...password].length > 1024) {
          throw inventoryError("INVENTORY_INPUT_INVALID", { field: "password" });
        }
        const input = {
          actor: { userId: Number(req.auth.claims.sub), serviceName: "", claimedRoles: req.auth.claims.roles,
            claimedPermissions: req.auth.claims.permissions },
          authorization: { purpose: this.constructor.action, requiredCallerPermission: "inventory.adjust" },
          source, correlationId: req.requestId ?? "", payload: reversal ? { ...payload, movementId: Number(params.id) } : payload
        };
        const tx = { query() {}, execute() {} };
        command = deepFreeze(reversal ? normalizeReversalCommand(tx, input) : normalizeAdjustmentCommand(tx, input, this.constructor.action));
      } catch (error) {
        if (error instanceof TypeError) throw inventoryError("INVENTORY_INPUT_INVALID");
        throw error;
      }
      const context = issueInventoryHighRiskContext(req, command, this.highRiskOptions);
      await this.inventory.database.withTransaction(tx => checkInventoryHighRiskContext(tx, context, command));
      this.#prepared.set(req, { command, context });
      const { movementId, ...reversalPayload } = command.payload;
      return { input: deepFreeze({ params: reversal ? { id: String(movementId) } : {}, query: {},
        body: { source: command.source, ...(reversal ? reversalPayload : command.payload) } }),
        replay: async sendCachedResponse => {
          try {
            const record = this.#take(req);
            const guard = consumeInventoryHighRiskContext(record.context, record.command);
            await this.inventory.database.withTransaction(async tx => {
              await guard.check(tx, { locking: true });
              sendCachedResponse();
            });
          } catch (error) { await this.#failure(req, error); throw error; }
        } };
    } catch (error) { await this.#failure(req, error); throw error; }
  }

  #take(req) {
    const record = this.#prepared.get(req);
    this.#prepared.delete(req);
    if (!record) throw permissionStaleError();
    return record;
  }

  async execute(req) {
    try {
      const { command, context } = this.#take(req);
      if (this.constructor.action === "movement.reverse") return this.response(await this.inventory.reverseMovement(command, context));
      return this.response(await (this.constructor.action === "adjustment.post"
        ? this.inventory.postAdjustment(command, context) : this.inventory.postStatusTransfer(command, context)));
    } catch (error) { await this.#failure(req, error); throw error; }
  }

  async #failure(req, error) {
    const userId = Number(req.auth?.claims?.sub);
    const audit = { actorUserId: Number.isSafeInteger(userId) && userId > 0 ? userId : null,
      actorLabel: Number.isSafeInteger(userId) && userId > 0 ? `user:${userId}` : "unavailable",
      action: this.constructor.action, targetType: "movement_group", targetLabel: this.constructor.api.path,
      requestId: req.requestId ?? "", correlationId: req.requestId ?? "", errorCode: error.code };
    await (error.statusCode >= 500 || !error.statusCode
      ? this.inventory.audit.recordFailed(audit) : this.inventory.audit.recordRejected(audit));
  }
}

export class PostInventoryAdjustmentHandler extends HighRiskPostingHandler {
  static handlerName = "postInventoryAdjustment";
  static action = "adjustment.post";
  static api = { method: "POST", path: "/api/v1/inventory/adjustments", description: "強認證單次庫存調整。",
    authType: "jwt-device-password", authorizationPolicies: ADJUST_POLICY, inputCoercion: false, idempotencyPreparation: true,
    idempotency: Object.freeze({ enabled: true, ttlMs: 604800000 }),
    requestSchema: { params: EMPTY, query: EMPTY, body: ADJUSTMENT_CREATE }, responseSchema: { 200: ADJUSTMENT_RESPONSE } };
}

export class PostInventoryStatusTransferHandler extends HighRiskPostingHandler {
  static handlerName = "postInventoryStatusTransfer";
  static action = "status_transfer.post";
  static api = { method: "POST", path: "/api/v1/inventory/status-transfers", description: "強認證單次庫存狀態轉換。",
    authType: "jwt-device-password", authorizationPolicies: ADJUST_POLICY, inputCoercion: false, idempotencyPreparation: true,
    idempotency: Object.freeze({ enabled: true, ttlMs: 604800000 }),
    requestSchema: { params: EMPTY, query: EMPTY, body: STATUS_TRANSFER_CREATE }, responseSchema: { 200: ADJUSTMENT_RESPONSE } };
}

export class ReverseInventoryMovementHandler extends HighRiskPostingHandler {
  static handlerName = "reverseInventoryMovement";
  static action = "movement.reverse";
  static api = { method: "POST", path: "/api/v1/inventory/movements/:id/reverse", description: "強認證完整沖銷原庫存異動組。",
    authType: "jwt-device-password", authorizationPolicies: ADJUST_POLICY, inputCoercion: false, idempotencyPreparation: true,
    idempotency: Object.freeze({ enabled: true, ttlMs: 604800000 }),
    requestSchema: { params: REVERSAL_ID_PARAMS, query: EMPTY, body: REVERSAL_CREATE }, responseSchema: { 200: REVERSAL_RESPONSE } };
}

export class PostInventoryReceiptHandler extends BaseRequestHandler {
  static handlerName = "postInventoryReceipt";
  static api = {
    method: "POST",
    path: "/api/v1/inventory/receipts",
    description: "以正式來源原子過帳庫存收貨。",
    authorizationPolicies: OPERATION_POLICY,
    idempotency: Object.freeze({ enabled: true }),
    requestSchema: { params: EMPTY, query: EMPTY, body: RECEIPT_CREATE },
    responseSchema: { 200: RECEIPT_RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryPostingService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const { source, ...payload } = req.input.body;
    return this.response(await this.inventory.postReceipt({
      actor: {
        userId: Number(req.auth.claims.sub),
        serviceName: "",
        claimedRoles: req.auth.claims.roles,
        claimedPermissions: req.auth.claims.permissions
      },
      authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
      source,
      correlationId: req.requestId ?? "",
      payload
    }));
  }
}

export class PostInventoryBinMoveHandler extends BaseRequestHandler {
  static handlerName = "postInventoryBinMove";
  static api = {
    method: "POST", path: "/api/v1/inventory/bin-moves",
    description: "原子過帳同倉多行 Bin Move。",
    authType: "jwt", authorizationPolicies: OPERATION_POLICY,
    idempotency: Object.freeze({ enabled: true }), inputCoercion: false,
    requestSchema: { params: EMPTY, query: EMPTY, body: BIN_MOVE_CREATE },
    responseSchema: { 200: BIN_MOVE_RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryPostingService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const { source, ...payload } = req.input.body;
    return this.response(await this.inventory.postBinMove({
      actor: { userId: Number(req.auth.claims.sub), serviceName: "",
        claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions },
      authorization: { purpose: "bin_move.post", requiredCallerPermission: "inventory.operation" },
      source, correlationId: req.requestId ?? "", payload
    }));
  }
}

export class PostInventoryIssueHandler extends BaseRequestHandler {
  static handlerName = "postInventoryIssue";
  static api = {
    method: "POST", path: "/api/v1/inventory/issues",
    description: "消耗同一預留的匹配分配並原子過帳出庫。",
    authorizationPolicies: OPERATION_POLICY,
    idempotency: Object.freeze({ enabled: true }),
    requestSchema: { params: EMPTY, query: EMPTY, body: ISSUE_CREATE },
    responseSchema: { 200: ISSUE_RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryPostingService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const { source, version, ...payload } = req.input.body;
    return this.response(await this.inventory.postIssue({
      actor: {
        userId: Number(req.auth.claims.sub), serviceName: "",
        claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions
      },
      authorization: { purpose: "issue.post", requiredCallerPermission: "inventory.operation" },
      source, correlationId: req.requestId ?? "",
      payload: { ...payload, expectedVersion: version }
    }));
  }
}
