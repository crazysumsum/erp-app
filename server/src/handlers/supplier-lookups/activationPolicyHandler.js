import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { readActivationPolicy } from "../../modules/supplier/SupplierSettingsService.js";

/**
 * 建檔頁要知而家係咪需要審批，先決定顯唔顯示 approver selector（T30 AC 1）。
 *
 * 點解唔叫 `/api/v1/supplier-settings`：嗰條要 `supplier.settings`，而建檔頁閘喺
 * `supplier.mgmt`，設計 §4.3 又明文講 permission catalogue 冇隱式繼承。呢條係
 * Supplier 自己嘅 lookup，同 HD-022 為 Business Master readiness 定落嘅做法一樣。
 * 決定記錄喺 HD-024。
 *
 * 只回一個 boolean：version、updatedAt、updatedBy 係設定頁先需要嘅嘢，唔關建檔頁事。
 *
 * 伺服器仍然係權威：政策 ON 而唔帶 approver 會 400 APPROVER_REQUIRED，OFF 而帶咗
 * 會 400 APPROVER_NOT_REQUIRED。呢條 route 只係令使用者唔使撞完錯先知。
 */

const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

const ACTIVATION_POLICY_READER_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({
    permissions: Object.freeze(["supplier.mgmt", "supplier.approval", "supplier.settings"]),
    match: "any"
  })
})]);

const ACTIVATION_POLICY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["requireActivationApproval"],
  properties: { requireActivationApproval: { type: "boolean" } }
});

export class GetSupplierActivationPolicyHandler extends BaseRequestHandler {
  static handlerName = "getSupplierActivationPolicy";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-lookups/activation-policy",
    description: "回報啟用供應商是否需要審批，供建檔與啟用畫面決定是否要求審批人。",
    authorizationPolicies: ACTIVATION_POLICY_READER_POLICY,
    requestSchema: { params: EMPTY, query: EMPTY, body: EMPTY },
    responseSchema: { 200: ACTIVATION_POLICY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.database = services.require("mysqldatabase");
  }

  async execute() {
    return this.response({ requireActivationApproval: await readActivationPolicy(this.database) });
  }
}
