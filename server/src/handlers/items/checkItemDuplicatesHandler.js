import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import { EMPTY_OBJECT_SCHEMA, ITEM_MGMT_POLICY } from "./itemSchemas.js";

const CHECK_DUPLICATES_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 190 },
    categoryId: { type: "integer", minimum: 1 },
    brandId: { type: "integer", minimum: 1 }
  }
});

const DUPLICATE_CANDIDATE_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "name", "status", "categoryName", "brandName", "skuCount", "skuCodes"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string" },
    status: { type: "string" },
    categoryName: { type: ["string", "null"] },
    brandName: { type: ["string", "null"] },
    skuCount: { type: "integer" },
    skuCodes: { type: "array", items: { type: "string" } }
  }
});

const CHECK_DUPLICATES_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["candidates"],
  additionalProperties: false,
  properties: {
    candidates: { type: "array", maxItems: 10, items: DUPLICATE_CANDIDATE_SCHEMA }
  }
});

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

/**
 * 建立 Item 之前嘅疑似重複提示（Phase 3）。設計說明見
 * docs/items_management/design_spec.md §6.2、§8.1：只用 deterministic
 * normalization／exact catalog 條件產生提示，最多 10 筆，唔自動合併、唔
 * 阻擋建立——純粹警告，見 `ItemAdminService.findDuplicateCandidates()`。
 */
export class CheckItemDuplicatesHandler extends BaseRequestHandler {
  static handlerName = "checkItemDuplicates";

  static api = {
    method: "POST",
    path: "/api/v1/items/duplicates/check",
    description: "按名稱（同可選嘅分類／品牌）查疑似重複嘅 Item，最多 10 筆，只警告唔阻擋。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: CHECK_DUPLICATES_BODY_SCHEMA
    },
    responseSchema: { 200: CHECK_DUPLICATES_RESPONSE_SCHEMA }
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
    const candidates = await this.itemAdmin.findDuplicateCandidates({
      ...actorContext(req),
      name: req.input.body.name,
      categoryId: req.input.body.categoryId,
      brandId: req.input.body.brandId
    });

    return this.response({ candidates });
  }
}
