import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  BARCODE_RELEASE_REQUEST_SCHEMA,
  EMPTY_OBJECT_SCHEMA,
  ITEM_MGMT_POLICY,
  SKU_BARCODE_PARAMS_SCHEMA,
  SKU_CODE_CHANGE_REQUEST_SCHEMA,
  SKU_DELETE_RESULT_SCHEMA,
  SKU_DETAIL_RESPONSE_SCHEMA,
  SKU_ID_PARAMS_SCHEMA,
  PASSWORD_SCHEMA,
  REASON_SCHEMA,
  VERSION_SCHEMA
} from "./skuSchemas.js";

/**
 * SKU 嘅高風險操作：永久刪除、Code 特批修改、條碼釋放。設計說明見
 * docs/items_management/design_spec.md §6.3。Code 修改／條碼釋放改變外部
 * 識別，用 `jwt-device-password`（已核准設備＋簽章＋密碼），比刪除／狀態
 * 動作嘅 `jwt-password` 再高一級。
 */

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

function requestMeta(req) {
  return {
    requestId: req.requestId,
    ip: req.ip || req.socket?.remoteAddress || ""
  };
}

export class DeleteSkuHandler extends BaseRequestHandler {
  static handlerName = "deleteSku";

  static api = {
    method: "POST",
    path: "/api/v1/skus/:id/delete",
    description: "永久刪除 Draft SKU；不可令所屬 Item 變成零 SKU，不可復原。",
    authType: "jwt-password",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: SKU_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["reason", "version", "password"],
        additionalProperties: false,
        properties: {
          reason: REASON_SCHEMA,
          version: VERSION_SCHEMA,
          password: PASSWORD_SCHEMA
        }
      }
    },
    responseSchema: { 200: SKU_DELETE_RESULT_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemAdmin = new ItemAdminService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const id = Number(req.input.params.id);
    await this.itemAdmin.deleteSku({
      ...actorContext(req),
      id,
      reason: req.input.body.reason,
      version: req.input.body.version,
      ...requestMeta(req)
    });

    return this.response({ id });
  }
}

export class ChangeSkuCodeHandler extends BaseRequestHandler {
  static handlerName = "changeSkuCode";

  static api = {
    method: "POST",
    path: "/api/v1/skus/:id/code/change",
    description: "特批修改 SKU Code；全域唯一，reason 必填，版本遞增。",
    authType: "jwt-device-password",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: SKU_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: SKU_CODE_CHANGE_REQUEST_SCHEMA
    },
    responseSchema: { 200: SKU_DETAIL_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemAdmin = new ItemAdminService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const updated = await this.itemAdmin.changeSkuCode({
      ...actorContext(req),
      id: Number(req.input.params.id),
      skuCode: req.input.body.skuCode,
      reason: req.input.body.reason,
      version: req.input.body.version,
      ...requestMeta(req)
    });

    return this.response(updated);
  }
}

export class ReleaseBarcodeHandler extends BaseRequestHandler {
  static handlerName = "releaseBarcode";

  static api = {
    method: "POST",
    path: "/api/v1/skus/:id/barcodes/:barcodeId/release",
    description: "移除並釋放一個條碼；reason 必填，讓正規化值可以再被使用。",
    authType: "jwt-device-password",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: SKU_BARCODE_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: BARCODE_RELEASE_REQUEST_SCHEMA
    },
    responseSchema: { 200: SKU_DETAIL_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemAdmin = new ItemAdminService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const updated = await this.itemAdmin.releaseBarcode({
      ...actorContext(req),
      id: Number(req.input.params.id),
      barcodeId: Number(req.input.params.barcodeId),
      reason: req.input.body.reason,
      version: req.input.body.version,
      ...requestMeta(req)
    });

    return this.response(updated);
  }
}
