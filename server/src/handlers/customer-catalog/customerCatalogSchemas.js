export const EMPTY_OBJECT_SCHEMA = Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze({}) });
export const CATALOG_NAMES = Object.freeze(["categories", "industries", "territories"]);

export const CATALOG_PARAMS = Object.freeze({
  type: "object", required: ["catalog"], additionalProperties: false,
  properties: { catalog: { type: "string", enum: CATALOG_NAMES } }
});
export const CATALOG_ID_PARAMS = Object.freeze({
  type: "object", required: ["catalog", "id"], additionalProperties: false,
  properties: { ...CATALOG_PARAMS.properties, id: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }
});
const CATALOG_FIELDS = Object.freeze({
  id: { type: "integer", minimum: 1 }, code: { type: "string", minLength: 1, maxLength: 50 },
  name: { type: "string", minLength: 1, maxLength: 100 }, description: { type: "string", maxLength: 500 },
  status: { type: "string", enum: ["active", "inactive"] }, sortOrder: { type: "integer", minimum: 0, maximum: 1000000 },
  version: { type: "integer", minimum: 1 }, createdAt: { type: "integer", minimum: 0 }, updatedAt: { type: "integer", minimum: 0 }
});
export const CATALOG_ITEM = Object.freeze({ type: "object", required: Object.freeze(Object.keys(CATALOG_FIELDS)), additionalProperties: false, properties: CATALOG_FIELDS });
export const CATALOG_LIST = Object.freeze({ type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "array", items: CATALOG_ITEM } } });
export const CATALOG_CREATE = Object.freeze({ type: "object", required: ["code", "name", "description", "sortOrder", "reason", "password"], additionalProperties: false, properties: { code: CATALOG_FIELDS.code, name: CATALOG_FIELDS.name, description: CATALOG_FIELDS.description, sortOrder: CATALOG_FIELDS.sortOrder, reason: { type: "string", trim: true, minLength: 5, maxLength: 500 }, password: { type: "string", minLength: 1, maxLength: 1024 } } });
export const CATALOG_UPDATE = Object.freeze({ type: "object", required: ["code", "name", "description", "sortOrder", "version", "reason", "password"], additionalProperties: false, properties: { ...CATALOG_CREATE.properties, version: CATALOG_FIELDS.version } });
export const CATALOG_DEACTIVATE = Object.freeze({ type: "object", required: ["version", "reason", "password"], additionalProperties: false, properties: { version: CATALOG_FIELDS.version, reason: CATALOG_CREATE.properties.reason, password: CATALOG_CREATE.properties.password } });
