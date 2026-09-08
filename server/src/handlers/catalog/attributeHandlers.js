import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemCatalogService } from "../../modules/item/ItemCatalogService.js";
import {
  ATTRIBUTE_CODE_SCHEMA,
  ATTRIBUTE_DATA_TYPE_SCHEMA,
  ATTRIBUTE_LIST_RESPONSE_SCHEMA,
  ATTRIBUTE_OPTION_INPUT_SCHEMA,
  ATTRIBUTE_PAGE_QUERY_SCHEMA,
  ATTRIBUTE_SUMMARY_SCHEMA,
  CATALOG_DELETE_RESULT_SCHEMA,
  CATALOG_ID_PARAMS_SCHEMA,
  CATALOG_NAME_SCHEMA,
  EMPTY_OBJECT_SCHEMA,
  ITEM_MGMT_POLICY,
  ITEM_VIEW_POLICY,
  PASSWORD_SCHEMA,
  REASON_SCHEMA,
  VERSION_SCHEMA
} from "./catalogSchemas.js";

/**
 * Attribute（商品屬性）的分頁查詢、新增、修改（原子覆蓋 option 集合）、狀態
 * 變更、受控刪除。設計說明見 docs/items_management/design_spec.md §6.4、§5.10。
 * 認證慣例同 Brand／UOM 一致：GET 用 item.view，一般寫入用 item.mgmt，
 * archive／restore／delete 額外要求 jwt-password。
 *
 * `code`／`dataType` 建立後不可修改（同 UOM code 一樣），所以只出現在
 * CreateAttributeHandler 的 schema，UpdateAttributeHandler 不接受這兩個欄位。
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

const OPTIONS_BODY_SCHEMA = {
  type: "array",
  items: ATTRIBUTE_OPTION_INPUT_SCHEMA,
  default: []
};

export class ListAttributesHandler extends BaseRequestHandler {
  static handlerName = "listAttributes";

  static api = {
    method: "GET",
    path: "/api/v1/catalog/attributes",
    description: "商品屬性分頁清單，支援名稱／代碼搜尋、狀態及資料型別篩選。",
    authorizationPolicies: ITEM_VIEW_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: ATTRIBUTE_PAGE_QUERY_SCHEMA
    },
    responseSchema: { 200: ATTRIBUTE_LIST_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const query = req.input.query ?? {};
    const pageSize = Math.min(Number(query.pageSize ?? 20), 100);

    const result = await this.itemCatalog.listAttributes({
      ...actorContext(req),
      page: Number(query.page ?? 1),
      pageSize,
      q: query.q,
      status: query.status,
      dataType: query.dataType,
      sortBy: query.sortBy,
      descending: query.descending === "true"
    });

    return this.response(result);
  }
}

export class CreateAttributeHandler extends BaseRequestHandler {
  static handlerName = "createAttribute";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/attributes/create",
    description: "新增商品屬性；single_option 型別須連同至少一個選項一次提交。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["code", "name", "dataType"],
        additionalProperties: false,
        properties: {
          code: ATTRIBUTE_CODE_SCHEMA,
          name: CATALOG_NAME_SCHEMA,
          dataType: ATTRIBUTE_DATA_TYPE_SCHEMA,
          uomId: { type: ["integer", "null"], minimum: 1 },
          isVariant: { type: "boolean", default: false },
          isFilterable: { type: "boolean", default: false },
          options: OPTIONS_BODY_SCHEMA
        }
      }
    },
    responseSchema: { 201: ATTRIBUTE_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const attribute = await this.itemCatalog.createAttribute({
      ...actorContext(req),
      code: req.input.body.code,
      name: req.input.body.name,
      dataType: req.input.body.dataType,
      uomId: req.input.body.uomId ?? null,
      isVariant: req.input.body.isVariant ?? false,
      isFilterable: req.input.body.isFilterable ?? false,
      options: req.input.body.options ?? [],
      ...requestMeta(req)
    });

    return this.response(attribute, { statusCode: 201 });
  }
}

export class UpdateAttributeHandler extends BaseRequestHandler {
  static handlerName = "updateAttribute";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/attributes/:id/update",
    description: "改名稱／顯示單位／variant／filterable 旗標，原子覆蓋 option 集合，compare-and-set。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: CATALOG_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["name", "isVariant", "isFilterable", "options", "version"],
        additionalProperties: false,
        properties: {
          name: CATALOG_NAME_SCHEMA,
          uomId: { type: ["integer", "null"], minimum: 1 },
          isVariant: { type: "boolean" },
          isFilterable: { type: "boolean" },
          options: OPTIONS_BODY_SCHEMA,
          version: VERSION_SCHEMA
        }
      }
    },
    responseSchema: { 200: ATTRIBUTE_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const attribute = await this.itemCatalog.updateAttribute({
      ...actorContext(req),
      id: Number(req.input.params.id),
      name: req.input.body.name,
      uomId: req.input.body.uomId ?? null,
      isVariant: req.input.body.isVariant,
      isFilterable: req.input.body.isFilterable,
      options: req.input.body.options ?? [],
      version: req.input.body.version,
      ...requestMeta(req)
    });

    return this.response(attribute);
  }
}

class AttributeStatusHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async transition(_options) {
    throw new Error(`${this.constructor.name} must implement transition()`);
  }

  async execute(req) {
    const attribute = await this.transition({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(attribute);
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
    responseSchema: { 200: ATTRIBUTE_SUMMARY_SCHEMA }
  };
}

export class ActivateAttributeHandler extends AttributeStatusHandler {
  static handlerName = "activateAttribute";
  static api = statusApi({
    path: "/api/v1/catalog/attributes/:id/activate",
    description: "啟用商品屬性（Inactive → Active）。"
  });

  async transition(options) {
    return this.itemCatalog.activateAttribute(options);
  }
}

export class DeactivateAttributeHandler extends AttributeStatusHandler {
  static handlerName = "deactivateAttribute";
  static api = statusApi({
    path: "/api/v1/catalog/attributes/:id/deactivate",
    description: "停用商品屬性（Active → Inactive）。"
  });

  async transition(options) {
    return this.itemCatalog.deactivateAttribute(options);
  }
}

export class ArchiveAttributeHandler extends AttributeStatusHandler {
  static handlerName = "archiveAttribute";
  static api = statusApi({
    path: "/api/v1/catalog/attributes/:id/archive",
    description: "封存商品屬性；預設不再出現於列表與選擇器。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemCatalog.archiveAttribute(options);
  }
}

export class RestoreAttributeHandler extends AttributeStatusHandler {
  static handlerName = "restoreAttribute";
  static api = statusApi({
    path: "/api/v1/catalog/attributes/:id/restore",
    description: "從封存恢復；只回到 Inactive，需另外啟用。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemCatalog.restoreAttribute(options);
  }
}

export class DeleteAttributeHandler extends BaseRequestHandler {
  static handlerName = "deleteAttribute";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/attributes/:id/delete",
    description: "永久刪除商品屬性；被分類規則或商品屬性值引用時拒絕。",
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
    const result = await this.itemCatalog.deleteAttribute({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(result);
  }
}
