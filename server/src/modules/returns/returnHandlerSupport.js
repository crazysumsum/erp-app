import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { issueInventoryReturnContext } from "../../modules/inventory/InventoryReturnContext.js";
import { InventoryReturnPostingService } from "../../modules/inventory/InventoryReturnPostingService.js";
import { ReturnInquiryService } from "./ReturnInquiryService.js";
import { ReturnService } from "./ReturnService.js";
import { returnError } from "./returnErrors.js";
import { returnSourceId } from "./returnSourceScope.js";
import { RETURN_STATUSES, RETURN_STOCK_STATUSES } from "./returnTypes.js";

const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const EMPTY = object({});
const ID = { type: "string", pattern: "^[1-9][0-9]{0,15}$" };
const VERSION = { type: "integer", minimum: 1, maximum: 4294967295 };
const STATUS = { enum: RETURN_STATUSES };
const STOCK_STATUS = { enum: RETURN_STOCK_STATUSES };
const TEXT = { type: "string" };
const DATE = { type: "string", format: "date" };
const TIME = { type: ["integer", "null"], minimum: 0 };
const ID_PARAMS = object({ id: ID });
const REFERENCE_PARAMS = object({ id: { type: "string", pattern: "^[A-Z0-9-]{1,24}$" } });
const PAGE = {
  page: { type: "integer", minimum: 1, maximum: 1000000 },
  pageSize: { type: "integer", minimum: 1, maximum: 100 }
};
const VIEW = { name: "hasPermission", options: { permissions: ["returns.view"] } };
const COMMAND_RESULT = object({ id: ID, returnNumber: TEXT, status: STATUS, version: VERSION, replayed: { type: "boolean" } });
const LIST_FILTERS = { ...PAGE, status: STATUS, returnNumber: { type: "string", pattern: "^(CRT|SRT)-[1-9][0-9]{0,15}$" } };
const SUMMARY = { id: ID, returnNumber: TEXT, status: STATUS, version: VERSION, partyCode: TEXT, partyName: TEXT, returnDate: DATE };
const LINE = object({
  id: ID, lineNo: VERSION, sourceDetailId: ID, baseQuantity: ID, binId: ID, binCode: TEXT, warehouseCode: TEXT,
  stockStatus: STOCK_STATUS, skuCode: TEXT, lotNumber: TEXT, inventoryMovementId: { type: ["string", "null"] }
});
const SOURCE_RESPONSE = object({
  id: ID, sourceNumber: TEXT,
  details: { type: "array", items: object({
    id: ID, warehouseId: ID, skuCode: TEXT, skuName: TEXT, lotNumber: TEXT,
    stockStatus: STOCK_STATUS, remainingBaseQuantity: { type: "string", pattern: "^[0-9]+$" }
  }) },
  bins: { type: "array", items: object({ id: ID, warehouseId: ID, binCode: TEXT, warehouseCode: TEXT }) }
});

function read(path, description, { params = EMPTY, query = EMPTY, response }) {
  return { method: "GET", path, description, authorizationPolicies: [VIEW],
    requestSchema: { params, query, body: EMPTY }, responseSchema: { 200: response } };
}
function list(path, summary, extraQuery = {}) {
  return read(path, "List return documents", { query: object({ ...LIST_FILTERS, ...extraQuery }, []),
    response: object({ items: { type: "array", maxItems: 100, items: object(summary) }, total: { type: "integer", minimum: 0 }, ...PAGE }) });
}
function detail(path, summary) {
  return read(`${path}/:id`, "Read a return document and its lines", { params: ID_PARAMS,
    response: object({ ...summary, reason: TEXT, createdBy: TEXT, postedBy: TEXT, postedAt: TIME,
      lines: { type: "array", items: LINE }, allowedActions: { type: "array", items: { enum: ["cancel", "post"] } } }) });
}
function source(path) {
  return read(`${path}/sources/:id`, "Read source details and active bins eligible for a return", { params: REFERENCE_PARAMS, response: SOURCE_RESPONSE });
}
function write(path, policy, description, params = ID_PARAMS) {
  return { method: "POST", path, description, authorizationPolicies: [policy], idempotency: { enabled: true },
    requestSchema: { params, query: EMPTY, body: {} }, responseSchema: { 200: COMMAND_RESULT } };
}

function validateId(id, field) {
  try {
    return returnSourceId(id);
  } catch {
    throw returnError("RETURN_INPUT_INVALID", { field });
  }
}

class InquiryHandler extends BaseRequestHandler {
  constructor(services) {
    super(services);
    this.inquiry = new ReturnInquiryService(services.require("mysqldatabase"));
  }

  async execute(req) {
    const { kind, action } = this.constructor;
    if (action === "list") {
      const query = req.input.query;
      if (query.salesOrderId !== undefined) validateId(query.salesOrderId, "salesOrderId");
      if (query.returnNumber !== undefined) validateId(query.returnNumber.slice(4), "returnNumber");
      return this.response(await this.inquiry.list(kind, query));
    }
    const id = action === "source" ? req.input.params.id : validateId(req.input.params.id, "id");
    return this.response(await this.inquiry[action](kind, id, req.auth.claims.permissions ?? []));
  }
}

class CommandHandler extends BaseRequestHandler {
  constructor(services) {
    super(services);
    const database = services.require("mysqldatabase");
    const time = services.require("time");
    const jwt = services.require("jwt");
    const inventory = new InventoryReturnPostingService({ database, time, logger: this.logger });
    const postInventory = (tx, { req, kind, command, lockedFacts }) => {
      const proof = issueInventoryReturnContext(req, tx, command, lockedFacts, {
        kind, database, time, sessionMaxAgeSeconds: jwt.sessionMaxAgeSeconds, clockToleranceSeconds: jwt.config.jwt.clockToleranceSeconds
      });
      return kind === "customer"
        ? inventory.postCustomerReturnReceiptBatchInTransaction(tx, command, proof)
        : inventory.postSupplierReturnIssueBatchInTransaction(tx, command, proof);
    };
    this.returns = new ReturnService({ database, time, postInventory });
  }

  async execute(req) {
    const input = req.input.body;
    if (!input?.eventId || req.get("Idempotency-Key") !== input.eventId) {
      throw returnError("RETURN_INPUT_INVALID", { field: "eventId" });
    }
    const { kind, action } = this.constructor;
    const id = req.input.params.id === undefined ? undefined : validateId(req.input.params.id, "id");
    return this.response(await this.returns[action]({ kind, id, claims: req.auth.claims, input, req }));
  }
}

export { CommandHandler, EMPTY, ID, InquiryHandler, SUMMARY, TEXT, detail, list, source, write };
