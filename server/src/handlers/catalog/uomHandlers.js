import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemCatalogService } from "../../modules/item/ItemCatalogService.js";
import {
  CATALOG_DELETE_RESULT_SCHEMA,
  CATALOG_ID_PARAMS_SCHEMA,
  EMPTY_OBJECT_SCHEMA,
  ITEM_MGMT_POLICY,
  ITEM_VIEW_POLICY,
  PASSWORD_SCHEMA,
  REASON_SCHEMA,
  UOM_CODE_SCHEMA,
  UOM_LIST_RESPONSE_SCHEMA,
  UOM_NAME_SCHEMA,
  UOM_SUMMARY_SCHEMA,
  UOM_SYMBOL_SCHEMA,
  VERSION_SCHEMA
} from "./catalogSchemas.js";

/**
 * UOM（計量單位）的查詢、新增、修改、狀態變更、受控刪除。設計說明見
 * docs/items_management/design_spec.md §6.4：「列表不分頁的唯一例外是 UOM
 * 小目錄」——跟 Category 一樣不分頁，跟 Brand 不同。認證慣例與 Category／
 * Brand 相同：GET 用 item.view，一般寫入用 item.mgmt，archive／restore／
 * delete 額外要求 jwt-password。
 */

function itemCatalogService(services) {
  return new ItemCatalogService({
    database: services.require("mysqldatabase"),
    logger: services.require("logging").logger,
    time: services.require("time"),
    categoryMaxDepth: services.config.item.categoryMaxDepth
  });
}

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

export class ListUomsHandler extends BaseRequestHandler {
  static handlerName = "listUoms";

  static api = {
    method: "GET",
    path: "/api/v1/catalog/uoms",
    description: "全部計量單位，不分頁，預設不含 Archived。",
    authorizationPolicies: ITEM_VIEW_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: {
        type: "object",
        additionalProperties: false,
        properties: {
          includeArchived: { type: "string", enum: ["true", "false"] }
        }
      }
    },
    responseSchema: { 200: UOM_LIST_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const result = await this.itemCatalog.listUoms({
      ...actorContext(req),
      includeArchived: req.input.query?.includeArchived === "true"
    });

    return this.response(result);
  }
}

export class CreateUomHandler extends BaseRequestHandler {
  static handlerName = "createUom";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/uoms/create",
    description: "新增計量單位；code 建立後不可修改。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["code", "name"],
        additionalProperties: false,
        properties: {
          code: UOM_CODE_SCHEMA,
          name: UOM_NAME_SCHEMA,
          symbol: UOM_SYMBOL_SCHEMA
        }
      }
    },
    responseSchema: { 201: UOM_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const uom = await this.itemCatalog.createUom({
      ...actorContext(req),
      code: req.input.body.code,
      name: req.input.body.name,
      symbol: req.input.body.symbol ?? "",
      ...requestMeta(req)
    });

    return this.response(uom, { statusCode: 201 });
  }
}

export class UpdateUomHandler extends BaseRequestHandler {
  static handlerName = "updateUom";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/uoms/:id/update",
    description: "改名稱／符號，compare-and-set；不接受修改 code。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: CATALOG_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["name", "symbol", "version"],
        additionalProperties: false,
        properties: {
          name: UOM_NAME_SCHEMA,
          symbol: UOM_SYMBOL_SCHEMA,
          version: VERSION_SCHEMA
        }
      }
    },
    responseSchema: { 200: UOM_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const uom = await this.itemCatalog.updateUom({
      ...actorContext(req),
      id: Number(req.input.params.id),
      name: req.input.body.name,
      symbol: req.input.body.symbol,
      version: req.input.body.version,
      ...requestMeta(req)
    });

    return this.response(uom);
  }
}

class UomStatusHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async transition(_options) {
    throw new Error(`${this.constructor.name} must implement transition()`);
  }

  async execute(req) {
    const uom = await this.transition({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(uom);
  }
}

function statusApi({ path, description, authType }) {
  return {
    method: "POST",
    path,
    description,
    ...(authType ? { authType } : {}),
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: CATALOG_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: authType === "jwt-password" ? ["reason", "version", "password"] : ["reason", "version"],
        additionalProperties: false,
        properties: {
          reason: REASON_SCHEMA,
          version: VERSION_SCHEMA,
          ...(authType === "jwt-password" ? { password: PASSWORD_SCHEMA } : {})
        }
      }
    },
    responseSchema: { 200: UOM_SUMMARY_SCHEMA }
  };
}

export class ActivateUomHandler extends UomStatusHandler {
  static handlerName = "activateUom";
  static api = statusApi({
    path: "/api/v1/catalog/uoms/:id/activate",
    description: "啟用單位（Inactive → Active）。"
  });

  async transition(options) {
    return this.itemCatalog.activateUom(options);
  }
}

export class DeactivateUomHandler extends UomStatusHandler {
  static handlerName = "deactivateUom";
  static api = statusApi({
    path: "/api/v1/catalog/uoms/:id/deactivate",
    description: "停用單位（Active → Inactive）。"
  });

  async transition(options) {
    return this.itemCatalog.deactivateUom(options);
  }
}

export class ArchiveUomHandler extends UomStatusHandler {
  static handlerName = "archiveUom";
  static api = statusApi({
    path: "/api/v1/catalog/uoms/:id/archive",
    description: "封存單位；預設不再出現於列表與選擇器。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemCatalog.archiveUom(options);
  }
}

export class RestoreUomHandler extends UomStatusHandler {
  static handlerName = "restoreUom";
  static api = statusApi({
    path: "/api/v1/catalog/uoms/:id/restore",
    description: "從封存恢復；只回到 Inactive，需另外啟用。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemCatalog.restoreUom(options);
  }
}

export class DeleteUomHandler extends BaseRequestHandler {
  static handlerName = "deleteUom";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/uoms/:id/delete",
    description: "永久刪除單位；被 SKU UOM／條碼／商品規格引用時拒絕。",
    authType: "jwt-password",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: CATALOG_ID_PARAMS_SCHEMA,
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
    responseSchema: { 200: CATALOG_DELETE_RESULT_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const result = await this.itemCatalog.deleteUom({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(result);
  }
}
