import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemCatalogService } from "../../modules/item/ItemCatalogService.js";
import {
  CATALOG_ID_PARAMS_SCHEMA,
  CATALOG_NAME_SCHEMA,
  CATEGORY_DELETE_RESULT_SCHEMA,
  CATEGORY_PARENT_ID_SCHEMA,
  CATEGORY_SUMMARY_SCHEMA,
  CATEGORY_TREE_RESPONSE_SCHEMA,
  EMPTY_OBJECT_SCHEMA,
  ITEM_MGMT_POLICY,
  ITEM_VIEW_POLICY,
  PASSWORD_SCHEMA,
  REASON_SCHEMA,
  SORT_ORDER_SCHEMA,
  VERSION_SCHEMA
} from "./catalogSchemas.js";

/**
 * Category（分類）的樹狀查詢、新增、修改（含移動）、狀態變更、受控刪除。
 * 設計說明見 docs/items_management/design_spec.md §6.4、§7.5。
 *
 * 每支狀態動作拆成獨立 endpoint，而不是一支 `status/change` 吃 action 參數：
 * `static api.authType` 在啟動時就固定，不必由 handler 內部依 body 動態決定
 * 認證強度（同一理由見 design_spec.md §6.2）。
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

export class ListCategoriesHandler extends BaseRequestHandler {
  static handlerName = "listCategories";

  static api = {
    method: "GET",
    path: "/api/v1/catalog/categories",
    description: "整棵分類樹，預設不含 Archived。",
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
    responseSchema: { 200: CATEGORY_TREE_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const result = await this.itemCatalog.loadCategoryTree({
      ...actorContext(req),
      includeArchived: req.input.query?.includeArchived === "true"
    });

    return this.response(result);
  }
}

export class CreateCategoryHandler extends BaseRequestHandler {
  static handlerName = "createCategory";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/categories/create",
    description: "新增分類；不帶 parentId 表示根層級。",
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
          parentId: CATEGORY_PARENT_ID_SCHEMA,
          sortOrder: SORT_ORDER_SCHEMA
        }
      }
    },
    responseSchema: { 201: CATEGORY_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const category = await this.itemCatalog.createCategory({
      ...actorContext(req),
      name: req.input.body.name,
      parentId: req.input.body.parentId ?? null,
      sortOrder: req.input.body.sortOrder ?? 0,
      ...requestMeta(req)
    });

    return this.response(category, { statusCode: 201 });
  }
}

export class UpdateCategoryHandler extends BaseRequestHandler {
  static handlerName = "updateCategory";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/categories/:id/update",
    description: "改名稱／排序／移動父層，整組 compare-and-set 一次提交。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: CATALOG_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["name", "parentId", "sortOrder", "version"],
        additionalProperties: false,
        properties: {
          name: CATALOG_NAME_SCHEMA,
          parentId: CATEGORY_PARENT_ID_SCHEMA,
          sortOrder: SORT_ORDER_SCHEMA,
          version: VERSION_SCHEMA
        }
      }
    },
    responseSchema: { 200: CATEGORY_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const category = await this.itemCatalog.updateCategory({
      ...actorContext(req),
      id: Number(req.input.params.id),
      name: req.input.body.name,
      parentId: req.input.body.parentId,
      sortOrder: req.input.body.sortOrder,
      version: req.input.body.version,
      ...requestMeta(req)
    });

    return this.response(category);
  }
}

/**
 * 四支狀態動作共同的部分：找哪支 service 方法、路徑、描述文字、認證強度不同，
 * 其餘（權限、schema、request 映射）完全一樣。
 */
class CategoryStatusHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  /** 子類別覆寫：呼叫 ItemCatalogService 的哪一個方法。 */
  async transition(_options) {
    throw new Error(`${this.constructor.name} must implement transition()`);
  }

  async execute(req) {
    const category = await this.transition({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(category);
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
    responseSchema: { 200: CATEGORY_SUMMARY_SCHEMA }
  };
}

export class ActivateCategoryHandler extends CategoryStatusHandler {
  static handlerName = "activateCategory";
  static api = statusApi({
    path: "/api/v1/catalog/categories/:id/activate",
    description: "啟用分類（Inactive → Active）。"
  });

  async transition(options) {
    return this.itemCatalog.activateCategory(options);
  }
}

export class DeactivateCategoryHandler extends CategoryStatusHandler {
  static handlerName = "deactivateCategory";
  static api = statusApi({
    path: "/api/v1/catalog/categories/:id/deactivate",
    description: "停用分類（Active → Inactive）；不影響既有 Item，但不可再指派給新 Item。"
  });

  async transition(options) {
    return this.itemCatalog.deactivateCategory(options);
  }
}

export class ArchiveCategoryHandler extends CategoryStatusHandler {
  static handlerName = "archiveCategory";
  static api = statusApi({
    path: "/api/v1/catalog/categories/:id/archive",
    description: "封存分類；預設不再出現於列表與選擇器。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemCatalog.archiveCategory(options);
  }
}

export class RestoreCategoryHandler extends CategoryStatusHandler {
  static handlerName = "restoreCategory";
  static api = statusApi({
    path: "/api/v1/catalog/categories/:id/restore",
    description: "從封存恢復；只回到 Inactive，需另外啟用。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemCatalog.restoreCategory(options);
  }
}

export class DeleteCategoryHandler extends BaseRequestHandler {
  static handlerName = "deleteCategory";

  static api = {
    method: "POST",
    path: "/api/v1/catalog/categories/:id/delete",
    description: "永久刪除分類；有子分類或被 Item 引用時拒絕。",
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
    responseSchema: { 200: CATEGORY_DELETE_RESULT_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemCatalog = itemCatalogService(services);
  }

  async execute(req) {
    const result = await this.itemCatalog.deleteCategory({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(result);
  }
}
