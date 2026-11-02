import { deepFreeze, plainObject } from "../../framework/api/normalizeApiDefaultsConfig.js";
import { INVENTORY_STOCKTAKE_STATUSES, INVENTORY_STOCK_STATUSES } from "../../modules/inventory/inventoryConstants.js";
import { inventoryError } from "../../modules/inventory/inventoryErrors.js";
import { inventoryStringHasInvalidCharacters } from "../../modules/inventory/inventorySafeJson.js";
import { validateInventoryCommandContext } from "../../modules/inventory/inventoryValidation.js";
import { TRANSFER_CREATE } from "./inventorySchemas.js";

const ID = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const QTY = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const VERSION = { ...ID, maximum: 4294967295 };
const TEXT = { type: "string" }, NULL_ID = { ...ID, type: ["integer", "null"] }, NULL_QTY = { ...QTY, type: ["integer", "null"] };
const enums = values => ({ type: "string", enum: values });
const object = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const array = items => ({ type: "array", items });
const STATUS = enums([...INVENTORY_STOCKTAKE_STATUSES]), STAGE = enums(["NOT_STARTED", "PREVIEW", "FROZEN"]);
const SOURCE = TRANSFER_CREATE.properties.source;
const REASON = { type: "string", maxLength: 500 };
const PASSWORD = { type: "string", minLength: 1, maxLength: 1024 };
const BINS = { type: "array", minItems: 1, uniqueItems: true, items: ID };
const COUNT_FIELDS = { lineId: ID, expectedVersion: VERSION, countedQuantity: QTY, notFound: { const: true } };
const COUNT_ROW = { ...object(COUNT_FIELDS, ["lineId", "expectedVersion"]), oneOf: [
  object({ lineId: ID, expectedVersion: VERSION, countedQuantity: QTY }),
  object({ lineId: ID, expectedVersion: VERSION, notFound: { const: true } })
] };
export const STOCKTAKE_PARAMS = deepFreeze(object({ id: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 16 } }));
export const STOCKTAKE_BODIES = deepFreeze({
  create: object({ source: SOURCE, warehouseId: ID, binIds: BINS, reason: REASON }, ["source", "warehouseId", "binIds"]),
  update: object({ source: SOURCE, binIds: BINS, expectedVersion: VERSION, reason: REASON }, ["source", "binIds", "expectedVersion"]),
  start: object({ source: SOURCE, expectedVersion: VERSION }), ready: object({ source: SOURCE, expectedVersion: VERSION }),
  count: object({ source: SOURCE, lines: { type: "array", minItems: 1, maxItems: 100, items: COUNT_ROW } }),
  add_line: object({ source: SOURCE, binId: ID, skuId: ID, lotId: NULL_ID, stockStatus: enums([...INVENTORY_STOCK_STATUSES]) }),
  post: object({ source: SOURCE, expectedVersion: VERSION, reason: REASON, password: PASSWORD }),
  cancel: object({ source: SOURCE, expectedVersion: VERSION, reason: REASON, password: PASSWORD })
});
const QUERY_ID = { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 16 };
const LINE_FILTERS = { q: { type: "string", maxLength: 190, pattern: "^[^\\p{Cc}]*$" }, binId: QUERY_ID, skuId: QUERY_ID, lotId: QUERY_ID,
  stockStatus: enums(["ALL", ...INVENTORY_STOCK_STATUSES]), progress: enums(["ALL", "UNCOUNTED", "COUNTED", "NOT_FOUND"]),
  variance: enums(["ALL", "GAIN", "LOSS", "ZERO"]) };
export const STOCKTAKE_QUERIES = deepFreeze({
  list: object({ warehouseId: QUERY_ID, binId: QUERY_ID, status: enums(["ALL", ...INVENTORY_STOCKTAKE_STATUSES]),
    dateFrom: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }, dateTo: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }, page: QUERY_ID, pageSize: QUERY_ID }, []),
  detail: object({ scopePage: QUERY_ID, scopePageSize: QUERY_ID }, []),
  lines: object({ ...LINE_FILTERS, page: QUERY_ID, pageSize: QUERY_ID }, []), export: object(LINE_FILTERS, [])
});
const HEADER = { id: ID, number: TEXT, warehouseId: ID, status: STATUS, version: VERSION, reason: TEXT,
  createdAt: QTY, updatedAt: QTY, startedAt: NULL_QTY, readyAt: NULL_QTY, postedAt: NULL_QTY, cancelledAt: NULL_QTY };
const PROGRESS = object(Object.fromEntries(["totalLines", "countedLines", "notFoundLines", "uncountedLines"].map(key => [key, QTY])));
const SUMMARY = object({ ...PROGRESS.properties, gainLines: QTY, lossLines: QTY, zeroLines: QTY });
const LINE = object({ id: ID, stocktakeId: ID, stocktakeBinId: ID, binId: ID, skuId: ID, lotId: NULL_ID,
  stockStatus: enums([...INVENTORY_STOCK_STATUSES]), snapshotBalanceId: NULL_ID, snapshotQuantity: QTY,
  snapshotBalanceVersion: { ...QTY, maximum: 4294967295 }, countedQuantity: NULL_QTY, actualQuantity: NULL_QTY,
  notFound: { type: "boolean" }, countState: enums(["UNCOUNTED", "COUNTED", "NOT_FOUND"]),
  varianceQuantity: { type: ["integer", "null"], minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
  varianceStage: STAGE, cancelled: { type: "boolean" }, version: VERSION, movementId: NULL_ID, countedAt: NULL_QTY, countedBy: NULL_ID,
  binCodeSnapshot: TEXT, binCodeCurrent: TEXT, skuCodeCurrent: TEXT, skuNameCurrent: TEXT, lotNumberCurrent: { type: ["string", "null"] },
  baseUom: object({ uomId: ID, uomCode: TEXT }) });
const SCOPE = object({ id: ID, binId: ID, binCodeSnapshot: TEXT, binCodeCurrent: TEXT, statusCurrent: enums(["ACTIVE", "INACTIVE"]) });
const PAGE = { total: QTY, page: ID, pageSize: { ...ID, maximum: 100 } };
export const STOCKTAKE_RESPONSES = deepFreeze({
  command: object({ id: ID, operationId: ID, status: STATUS, version: VERSION, rowCount: QTY, stocktakeId: ID,
    movementGroupId: { type: ["string", "null"], pattern: "^[a-f0-9-]{36}$" } }, ["id", "operationId", "status", "version", "rowCount"]),
  list: object({ items: array(object(HEADER)), ...PAGE, asOf: QTY }),
  detail: object({ ...HEADER, asOf: QTY, varianceStage: STAGE, cancelled: { type: "boolean" },
    scope: object({ items: array(SCOPE), ...PAGE }), progress: PROGRESS, varianceSummary: SUMMARY }),
  lines: object({ id: ID, status: STATUS, version: VERSION, asOf: QTY, varianceStage: STAGE, cancelled: { type: "boolean" },
    items: array(LINE), ...PAGE, globalSummary: SUMMARY, filteredSummary: SUMMARY })
});

function invalid(field) { throw inventoryError("INVENTORY_INPUT_INVALID", { field }); }
function strictInteger(value, field, maximum = Number.MAX_SAFE_INTEGER, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(field);
  return value;
}
function shape(value, allowed, required = []) {
  try { plainObject(value, "Stocktake input"); } catch { invalid("shape"); }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(key);
  for (const key of required) if (!Object.hasOwn(value, key)) invalid(key);
  return value;
}
function reason(value = "", required = false) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 500 || inventoryStringHasInvalidCharacters(value) || (required && !value.trim())) invalid("reason");
  return value.trim();
}
export function stocktakePathId(params) {
  shape(params, ["id"], ["id"]);
  if (typeof params.id !== "string" || !/^[1-9][0-9]*$/u.test(params.id)) invalid("id");
  return strictInteger(Number(params.id), "id");
}
export function normalizeStocktakeCommand(req, action) {
  if (!Object.hasOwn(STOCKTAKE_BODIES, action)) invalid("action");
  const spec = STOCKTAKE_BODIES[action], body = shape(req?.input?.body, Object.keys(spec.properties), spec.required);
  shape(req.input.query, []);
  const payload = {};
  if (action === "create") shape(req.input.params, []); else payload.stocktakeId = stocktakePathId(req.input.params);
  if (Object.hasOwn(spec.properties, "password") && (typeof body.password !== "string" || [...body.password].length < 1 || [...body.password].length > 1024)) invalid("password");
  for (const field of ["warehouseId", "binId", "skuId", "expectedVersion"]) if (Object.hasOwn(spec.properties, field)) {
    payload[field] = strictInteger(body[field], field, field === "expectedVersion" ? 4294967295 : Number.MAX_SAFE_INTEGER);
  }
  if (Object.hasOwn(spec.properties, "reason")) payload.reason = reason(body.reason, ["post", "cancel"].includes(action));
  if (Object.hasOwn(spec.properties, "binIds")) {
    if (!Array.isArray(body.binIds) || !body.binIds.length) invalid("binIds");
    payload.binIds = body.binIds.map(value => strictInteger(value, "binId")).sort((a, b) => a - b);
    if (new Set(payload.binIds).size !== payload.binIds.length) invalid("binIds");
  }
  if (action === "add_line") {
    payload.lotId = body.lotId === null ? null : strictInteger(body.lotId, "lotId");
    if (!INVENTORY_STOCK_STATUSES.includes(body.stockStatus)) invalid("stockStatus");
    payload.stockStatus = body.stockStatus;
  }
  if (action === "count") {
    if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) invalid("lines");
    payload.lines = body.lines.map(row => {
      shape(row, Object.keys(COUNT_FIELDS), ["lineId", "expectedVersion"]);
      const counted = Object.hasOwn(row, "countedQuantity"), missing = Object.hasOwn(row, "notFound");
      if (counted === missing || (missing && row.notFound !== true)) invalid("notFound");
      return { lineId: strictInteger(row.lineId, "lineId"), expectedVersion: strictInteger(row.expectedVersion, "expectedVersion", 4294967295),
        ...(counted ? { countedQuantity: strictInteger(row.countedQuantity, "countedQuantity", Number.MAX_SAFE_INTEGER, 0) } : { notFound: true }) };
    }).sort((a, b) => a.lineId - b.lineId);
    if (new Set(payload.lines.map(row => row.lineId)).size !== payload.lines.length) invalid("lines");
  }
  try {
    const claims = req.auth.claims, permission = action === "post" ? "inventory.adjust" : "inventory.operation";
    if (!claims.permissions.includes("inventory.view")) invalid("permission");
    return deepFreeze(validateInventoryCommandContext({ query() {}, execute() {} }, {
      actor: { userId: strictInteger(Number(claims.sub), "actor"), serviceName: "", claimedRoles: claims.roles, claimedPermissions: claims.permissions },
      authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: permission }, source: body.source,
      correlationId: req.requestId ?? "", payload
    }, { purpose: `stocktake.${action}`, requiredCallerPermission: permission }));
  } catch (error) { if (error instanceof TypeError) invalid("command"); throw error; }
}

export function normalizeStocktakeQuery(input, kind) {
  if (!Object.hasOwn(STOCKTAKE_QUERIES, kind)) invalid("query");
  const fields = STOCKTAKE_QUERIES[kind].properties; shape(input, Object.keys(fields));
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "q") {
      if (typeof value !== "string" || [...value].length > 190 || Buffer.byteLength(value, "utf8") > 760 || /\p{Cc}/u.test(value)) invalid(key);
      output.q = value.trim();
    } else if (fields[key] === QUERY_ID) {
      if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) invalid(key);
      output[key] = strictInteger(Number(value), key);
    } else if (fields[key].enum) {
      if (typeof value !== "string" || !fields[key].enum.includes(value)) invalid(key);
      output[key] = value;
    } else {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) invalid(key);
      const date = new Date(`${value}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid(key);
      output[key] = value;
    }
  }
  for (const field of ["pageSize", "scopePageSize"]) if (output[field] > 100) invalid(field);
  for (const [page, size] of [["page", "pageSize"], ["scopePage", "scopePageSize"]]) {
    if (Object.hasOwn(fields, page)) { output[page] ??= 1; output[size] ??= 20;
      if (output[page] - 1 > Math.floor(Number.MAX_SAFE_INTEGER / output[size])) invalid(page); }
  }
  if (output.dateFrom && output.dateTo && output.dateFrom > output.dateTo) invalid("dateFrom");
  return output;
}
