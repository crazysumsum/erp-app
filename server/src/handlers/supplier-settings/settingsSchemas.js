export const SUPPLIER_SETTINGS_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["supplier.settings"]) })
})]);

export const EMPTY_OBJECT_SCHEMA = Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze({}) });

export const SUPPLIER_SETTINGS_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze(["requireActivationApproval", "version", "updatedAt", "updatedBy"]),
  additionalProperties: false,
  properties: Object.freeze({
    requireActivationApproval: Object.freeze({ type: "boolean" }),
    version: Object.freeze({ type: "integer", minimum: 1 }),
    updatedAt: Object.freeze({ type: "integer", minimum: 0 }),
    updatedBy: Object.freeze({ type: Object.freeze(["integer", "null"]) })
  })
});

// additionalProperties: false 係 FR-SET-006 嘅第一道閘：未定義嘅參數喺呢度已經 400，
// 唔會變成一個動態 setting。Service 亦獨立再檢查一次，唔靠 caller 去守。
export const SUPPLIER_SETTINGS_UPDATE_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze(["requireActivationApproval", "version", "reason", "password"]),
  additionalProperties: false,
  properties: Object.freeze({
    requireActivationApproval: Object.freeze({ type: "boolean" }),
    version: Object.freeze({ type: "integer", minimum: 1 }),
    reason: Object.freeze({ type: "string", minLength: 5, maxLength: 500 }),
    password: Object.freeze({ type: "string", minLength: 1, maxLength: 200 })
  })
});
