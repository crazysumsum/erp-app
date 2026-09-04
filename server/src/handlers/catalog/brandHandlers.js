import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemCatalogService } from "../../modules/item/ItemCatalogService.js";
import {
  BRAND_DESCRIPTION_SCHEMA,
  BRAND_LIST_RESPONSE_SCHEMA,
  BRAND_OFFICIAL_NAME_SCHEMA,
  BRAND_SUMMARY_SCHEMA,
  CATALOG_DELETE_RESULT_SCHEMA,
  CATALOG_ID_PARAMS_SCHEMA,
  CATALOG_NAME_SCHEMA,
  CATALOG_PAGE_QUERY_SCHEMA,
  EMPTY_OBJECT_SCHEMA,
  ITEM_MGMT_POLICY,
  ITEM_VIEW_POLICY,
  PASSWORD_SCHEMA,
  REASON_SCHEMA,
  VERSION_SCHEMA
} from "./catalogSchemas.js";

/**
 * Brand（品牌）的分頁查詢、新增、修改、狀態變更、受控刪除。設計說明見
 * docs/items_management/design_spec.md §6.4。跟 Category 同一組認證慣例：
 * GET 用 item.view，一般寫入用 item.mgmt，archive／restore／delete 額外要求
 * jwt-password；每支狀態動作獨立成一個 endpoint（理由見 categoryHandlers.js）。
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

export class ListBrandsHandler extends BaseRequestHandler {
  static handlerName = "listBrands";

  static api = {
    method: "GET",
    path: "/api/v1/catalog/brands",
    description: "品牌分頁清單，支援名稱搜尋與狀態篩選。",
    authorizationPolicies: ITEM_VIEW_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: CATALOG_PAGE_QUERY_SCHEMA
    },
    responseSchema: { 200: BRAND_LIST_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const query = req.input.query ?? {};
    const pageSize = Math.min(Number(query.pageSize ?? 20), 100);

    const result = await this.itemCatalog.listBrands({
      ...actorContext(req),
      page: Number(query.page ?? 1),
      pageSize,
      q: query.q,
      status: query.status,
      sortBy: query.sortBy,
      descending: query.descending === "true"
    });

    return this.response(result);
  }
}

export class CreateBrandHandler extends BaseRequestHandler {
  static handlerName = "createBrand";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/brands/create",
    description: "新增品牌。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name: CATALOG_NAME_SCHEMA,
          officialName: BRAND_OFFICIAL_NAME_SCHEMA,
          description: BRAND_DESCRIPTION_SCHEMA
        }
      }
    },
    responseSchema: { 201: BRAND_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const brand = await this.itemCatalog.createBrand({
      ...actorContext(req),
      name: req.input.body.name,
      officialName: req.input.body.officialName ?? "",
      description: req.input.body.description ?? "",
      ...requestMeta(req)
    });

    return this.response(brand, { statusCode: 201 });
  }
}

export class UpdateBrandHandler extends BaseRequestHandler {
  static handlerName = "updateBrand";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/brands/:id/update",
    description: "整組覆蓋品牌名稱／官方名稱／描述，compare-and-set。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: CATALOG_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["name", "officialName", "description", "version"],
        additionalProperties: false,
        properties: {
          name: CATALOG_NAME_SCHEMA,
          officialName: BRAND_OFFICIAL_NAME_SCHEMA,
          description: BRAND_DESCRIPTION_SCHEMA,
          version: VERSION_SCHEMA
        }
      }
    },
    responseSchema: { 200: BRAND_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const brand = await this.itemCatalog.updateBrand({
      ...actorContext(req),
      id: Number(req.input.params.id),
      name: req.input.body.name,
      officialName: req.input.body.officialName,
      description: req.input.body.description,
      version: req.input.body.version,
      ...requestMeta(req)
    });

    return this.response(brand);
  }
}

class BrandStatusHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async transition(_options) {
    throw new Error(`${this.constructor.name} must implement transition()`);
  }

  async execute(req) {
    const brand = await this.transition({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(brand);
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
    responseSchema: { 200: BRAND_SUMMARY_SCHEMA }
  };
}

export class ActivateBrandHandler extends BrandStatusHandler {
  static handlerName = "activateBrand";
  static api = statusApi({
    path: "/api/v1/catalog/brands/:id/activate",
    description: "啟用品牌（Inactive → Active）。"
  });

  async transition(options) {
    return this.itemCatalog.activateBrand(options);
  }
}

export class DeactivateBrandHandler extends BrandStatusHandler {
  static handlerName = "deactivateBrand";
  static api = statusApi({
    path: "/api/v1/catalog/brands/:id/deactivate",
    description: "停用品牌（Active → Inactive）。"
  });

  async transition(options) {
    return this.itemCatalog.deactivateBrand(options);
  }
}

export class ArchiveBrandHandler extends BrandStatusHandler {
  static handlerName = "archiveBrand";
  static api = statusApi({
    path: "/api/v1/catalog/brands/:id/archive",
    description: "封存品牌；預設不再出現於列表與選擇器。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemCatalog.archiveBrand(options);
  }
}

export class RestoreBrandHandler extends BrandStatusHandler {
  static handlerName = "restoreBrand";
  static api = statusApi({
    path: "/api/v1/catalog/brands/:id/restore",
    description: "從封存恢復；只回到 Inactive，需另外啟用。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemCatalog.restoreBrand(options);
  }
}

export class DeleteBrandHandler extends BaseRequestHandler {
  static handlerName = "deleteBrand";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/brands/:id/delete",
    description: "永久刪除品牌；被商品引用時拒絕。",
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
    const result = await this.itemCatalog.deleteBrand({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(result);
  }
}
