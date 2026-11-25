import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { issueInventoryReturnContext } from "../../modules/inventory/InventoryReturnContext.js";
import { InventoryReturnPostingService } from "../../modules/inventory/InventoryReturnPostingService.js";
import { ReturnInquiryService } from "../../modules/returns/ReturnInquiryService.js";
import { ReturnService } from "../../modules/returns/ReturnService.js";
import { returnError } from "../../modules/returns/returnErrors.js";
import { returnSourceId } from "../../modules/returns/returnSourceScope.js";
import { RETURN_STATUSES, RETURN_STOCK_STATUSES } from "../../modules/returns/returnTypes.js";

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
const CUSTOMER_WRITE = { name: "hasPermission", options: { permissions: ["returns.customer.mgmt"] } };
const SUPPLIER_WRITE = { name: "hasPermission", options: { permissions: ["returns.supplier.mgmt"] } };
const CUSTOMER = "/api/v1/customer-returns", SUPPLIER = "/api/v1/supplier-returns";
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

const CUSTOMER_SUMMARY = { ...SUMMARY, shipmentId: ID, shipmentNumber: TEXT };
const SUPPLIER_SUMMARY = { ...SUMMARY, goodsReceiptId: ID, goodsReceiptNumber: TEXT };

export class ListCustomerReturnsHandler extends InquiryHandler {
  static handlerName = "listCustomerReturns";
  static api = list(CUSTOMER, CUSTOMER_SUMMARY, { salesOrderId: ID });
  static kind = "customer";
  static action = "list";
}
export class GetCustomerReturnHandler extends InquiryHandler {
  static handlerName = "getCustomerReturn";
  static api = detail(CUSTOMER, CUSTOMER_SUMMARY);
  static kind = "customer";
  static action = "detail";
}
export class GetCustomerReturnSourceHandler extends InquiryHandler {
  static handlerName = "getCustomerReturnSource";
  static api = source(CUSTOMER);
  static kind = "customer";
  static action = "source";
}
export class CreateCustomerReturnHandler extends CommandHandler {
  static handlerName = "createCustomerReturn";
  static api = write(CUSTOMER, CUSTOMER_WRITE, "Create a customer return draft", EMPTY);
  static kind = "customer";
  static action = "create";
}
export class PostCustomerReturnHandler extends CommandHandler {
  static handlerName = "postCustomerReturn";
  static api = write(`${CUSTOMER}/:id/post`, CUSTOMER_WRITE, "Receive a customer return into quarantine");
  static kind = "customer";
  static action = "post";
}
export class CancelCustomerReturnHandler extends CommandHandler {
  static handlerName = "cancelCustomerReturn";
  static api = write(`${CUSTOMER}/:id/cancel`, CUSTOMER_WRITE, "Cancel a customer return draft");
  static kind = "customer";
  static action = "cancel";
}

export class ListSupplierReturnsHandler extends InquiryHandler {
  static handlerName = "listSupplierReturns";
  static api = list(SUPPLIER, SUPPLIER_SUMMARY);
  static kind = "supplier";
  static action = "list";
}
export class GetSupplierReturnHandler extends InquiryHandler {
  static handlerName = "getSupplierReturn";
  static api = detail(SUPPLIER, SUPPLIER_SUMMARY);
  static kind = "supplier";
  static action = "detail";
}
export class GetSupplierReturnSourceHandler extends InquiryHandler {
  static handlerName = "getSupplierReturnSource";
  static api = source(SUPPLIER);
  static kind = "supplier";
  static action = "source";
}
export class CreateSupplierReturnHandler extends CommandHandler {
  static handlerName = "createSupplierReturn";
  static api = write(SUPPLIER, SUPPLIER_WRITE, "Create a supplier return draft", EMPTY);
  static kind = "supplier";
  static action = "create";
}
export class CancelSupplierReturnHandler extends CommandHandler {
  static handlerName = "cancelSupplierReturn";
  static api = write(`${SUPPLIER}/:id/cancel`, SUPPLIER_WRITE, "Cancel a supplier return draft");
  static kind = "supplier";
  static action = "cancel";
}

export class PostSupplierReturnHandler extends CommandHandler {
  static handlerName = "postSupplierReturn";
  static api = write(`${SUPPLIER}/:id/post`, SUPPLIER_WRITE, "Post a supplier return issue");
  static kind = "supplier";
  static action = "post";
}
