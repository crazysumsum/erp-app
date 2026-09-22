export const EMPTY_OBJECT_SCHEMA = Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze({}) });

export const CUSTOMER_SETTINGS_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze(["requireActivationApproval", "version", "updatedAt", "updatedBy"]),
  additionalProperties: false,
  properties: Object.freeze({
    requireActivationApproval: Object.freeze({ type: "boolean" }),
    version: Object.freeze({ type: "integer", minimum: 1 }),
    updatedAt: Object.freeze({ type: "integer", minimum: 0 }),
    updatedBy: Object.freeze({ type: ["integer", "null"] })
  })
});

export const CUSTOMER_SETTINGS_UPDATE_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze(["requireActivationApproval", "version", "reason", "password"]),
  additionalProperties: false,
  properties: Object.freeze({
    requireActivationApproval: Object.freeze({ type: "boolean" }),
    version: Object.freeze({ type: "integer", minimum: 1 }),
    reason: Object.freeze({ type: "string", trim: true, minLength: 5, maxLength: 500 }),
    password: Object.freeze({ type: "string", minLength: 1, maxLength: 1024 })
  })
});
