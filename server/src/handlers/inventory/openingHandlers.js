import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { deepFreeze } from "../../framework/api/normalizeApiDefaultsConfig.js";
import { issueInventoryHighRiskContext } from "../../modules/inventory/inventoryHighRiskContext.js";
import { assertActorFresh } from "../../modules/authorization/directoryLookups.js";
import { inventoryError } from "../../modules/inventory/inventoryErrors.js";
import { InventoryOpeningService } from "../../modules/inventory/opening/InventoryOpeningService.js";
import { EMPTY, MGMT_POLICY } from "./inventorySchemas.js";

const ROOT = "/api/v1/inventory/opening";
const integer = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const params = { type: "object", additionalProperties: false, required: ["id"],
  properties: { id: { type: "string", pattern: "^[1-9][0-9]{0,15}$" } } };
const controlSchema = { type: "object", additionalProperties: false, required: ["status", "version"],
  properties: { status: { enum: ["PRE_GO_LIVE", "LIVE"] }, version: integer } };
const jobSchema = { type: "object", additionalProperties: false,
  required: ["id", "status", "version", "control", "sourceFileHash", "readyRows", "errors", "skippedRows", "completedAt", "operationId"],
  properties: {
    id: integer, status: { enum: ["INVALID", "READY", "COMPLETED", "CANCELLED"] }, version: integer,
    control: controlSchema, sourceFileHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    readyRows: { type: "integer", minimum: 0, maximum: 5000 },
    errors: { type: "array", items: { type: "object", additionalProperties: false, required: ["row", "field", "code"],
      properties: { row: integer, field: { type: "string" }, code: { type: "string" } } } },
    skippedRows: { type: "array", items: integer }, completedAt: { type: ["integer", "null"] },
    operationId: { anyOf: [integer, { type: "null" }] }
  } };

class OpeningHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.opening = new InventoryOpeningService({ database: services.require("mysqldatabase"),
      time: services.require("time"), logger: services.require("logging").logger });
  }

  requestOptions(req) {
    const claims = req.auth?.claims;
    const actorId = Number(claims?.sub);
    if (!Number.isSafeInteger(actorId) || actorId < 1) throw inventoryError("PERMISSION_STALE");
    return {
      signal: req.requestTimeout?.signal,
      authorize: async (tx) => {
        req.requestTimeout?.signal?.throwIfAborted();
        const actor = await assertActorFresh(tx, {
          actorId, claimedRoles: claims.roles, claimedPermissions: claims.permissions
        });
        if (!actor.username || !["inventory.view", "inventory.mgmt"].every(permission => actor.permissions.includes(permission))) {
          throw inventoryError("PERMISSION_STALE");
        }
        return actor;
      }
    };
  }
}

export class UploadInventoryOpeningHandler extends OpeningHandler {
  static handlerName = "uploadInventoryOpening";
  static api = {
    method: "POST", path: ROOT + "/upload", authType: "jwt", authorizationPolicies: MGMT_POLICY,
    description: "上傳期初庫存 CSV、同步預檢並保存結果。",
    upload: { enabled: true, memoryOnly: true, maxFiles: 1,
      maxFileSizeBytes: 10485760, maxTotalFileBytes: 10485760, maxRequestBytes: 10551296,
      maxFieldCount: 1, allowedMimeTypes: ["text/csv", "application/csv"] },
    requestSchema: { params: EMPTY, query: EMPTY, body: EMPTY }, responseSchema: { 201: jobSchema }
  };

  async execute(req) {
    const file = req.files?.[0];
    if (req.files?.length !== 1 || !Buffer.isBuffer(file.buffer)) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "file" });
    }
    try {
      return this.response(await this.opening.upload(file.buffer, this.requestOptions(req)), { statusCode: 201 });
    } finally {
      file.buffer.fill(0);
      req.files = Object.freeze([]);
    }
  }
}

export class GetInventoryOpeningHandler extends OpeningHandler {
  static handlerName = "getInventoryOpening";
  static api = {
    method: "GET", path: ROOT + "/jobs/:id", authType: "jwt", authorizationPolicies: MGMT_POLICY,
    description: "讀取已保存的期初庫存預檢或入帳結果。",
    requestSchema: { params, query: EMPTY, body: EMPTY }, responseSchema: { 200: jobSchema }
  };

  async execute(req) {
    return this.response(await this.opening.get(req.input.params.id, this.requestOptions(req)));
  }
}

export class ConfirmInventoryOpeningHandler extends OpeningHandler {
  static handlerName = "confirmInventoryOpening";
  static api = {
    method: "POST", path: ROOT + "/jobs/:id/confirm", authType: "jwt-device-password", authorizationPolicies: MGMT_POLICY,
    description: "確認將同一份期初庫存預檢結果整批入帳。",
    inputCoercion: false,
    requestSchema: { params, query: EMPTY, body: {
      type: "object", additionalProperties: false, required: ["eventId", "expectedVersion", "reason", "password"],
      properties: {
        eventId: { type: "string", pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" },
        expectedVersion: integer, reason: { type: "string", minLength: 5, maxLength: 500 },
        password: { type: "string", minLength: 1, maxLength: 1024 }
      }
    } },
    responseSchema: { 200: jobSchema }
  };

  constructor(services = {}) {
    super(services);
    const jwt = services.require("jwt"), device = services.require("deviceBinding");
    this.authOptions = { time: this.time, sessionMaxAgeSeconds: jwt.sessionMaxAgeSeconds,
      clockToleranceSeconds: jwt.config.jwt.clockToleranceSeconds,
      signatureMaxSkewSeconds: device.config.deviceBinding.signatureMaxSkewSeconds };
  }

  async execute(req) {
    const { eventId, expectedVersion, reason } = req.input.body;
    const jobId = Number(req.input.params.id), normalizedReason = reason.trim();
    const actorId = Number(req.auth?.claims?.sub);
    if (!Number.isSafeInteger(jobId) || jobId <= 0 || [...normalizedReason].length < 5 || /\p{Cc}/u.test(reason)) {
      throw inventoryError("INVENTORY_INPUT_INVALID");
    }
    const command = deepFreeze({
      authorization: { purpose: "opening.post", requiredCallerPermission: "inventory.mgmt" },
      actor: { userId: actorId, claimedRoles: [...req.auth.claims.roles], claimedPermissions: [...req.auth.claims.permissions] },
      source: { module: "INVENTORY", documentType: "OPENING", documentId: String(jobId), eventId },
      payload: { jobId, expectedVersion, reason: normalizedReason }, correlationId: req.requestId ?? ""
    });
    const proof = issueInventoryHighRiskContext(req, command, this.authOptions);
    return this.response(await this.opening.confirm(command, proof, { signal: req.requestTimeout?.signal }));
  }
}
