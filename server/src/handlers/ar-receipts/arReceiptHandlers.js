import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  ALLOCATION_COMMAND_RESPONSE, ALLOCATION_PARAMS, AR_RECEIPT_POLICY, AR_VIEW_POLICY, EMPTY, ID_PARAMS, RECEIPT_COMMAND_RESPONSE, RECEIPT_DETAIL_RESPONSE,
  RECEIPT_LIST_QUERY, RECEIPT_LIST_RESPONSE, arCommand, arInquiryService, arReceiptService
} from "../ar/arSchemas.js";

const BASE = "/api/v1/ar-receipts";
const read = (path, description, query, response, params = EMPTY) => ({ method: "GET", path: `${BASE}${path}`, description, authorizationPolicies: [AR_VIEW_POLICY],
  requestSchema: { params, query, body: EMPTY }, responseSchema: { 200: response } });
// 命令一律 jwt／ar.receipt.mgmt；狀態、版本及金額由 service 在交易內驗。
const command = (path, description, response = RECEIPT_COMMAND_RESPONSE, params = ID_PARAMS) => ({ method: "POST", path: `${BASE}${path}`, description,
  authorizationPolicies: [AR_RECEIPT_POLICY], idempotency: { enabled: true }, requestSchema: { params, query: EMPTY, body: {} }, responseSchema: { 200: response } });

class InquiryHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.inquiry = arInquiryService(services); }
}
class ReceiptHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.receipts = arReceiptService(services); }
  target(req) { return { ...arCommand(req), receiptId: Number(req.input.params.id) }; }
}

export class ListArReceiptsHandler extends InquiryHandler {
  static handlerName = "listArReceipts";
  static api = read("", "List AR receipts", RECEIPT_LIST_QUERY, RECEIPT_LIST_RESPONSE);
  async execute(req) { return this.response(await this.inquiry.listReceipts({ claims: req.auth.claims, query: req.input.query })); }
}

export class GetArReceiptHandler extends InquiryHandler {
  static handlerName = "getArReceipt";
  static api = read("/:id", "Read an AR receipt with its allocations", EMPTY, RECEIPT_DETAIL_RESPONSE, ID_PARAMS);
  async execute(req) { return this.response(await this.inquiry.getReceipt({ claims: req.auth.claims, id: Number(req.input.params.id) })); }
}

export class CreateArReceiptHandler extends ReceiptHandler {
  static handlerName = "createArReceipt";
  static api = command("", "Create a Draft AR receipt", RECEIPT_COMMAND_RESPONSE, EMPTY);
  async execute(req) { return this.response(await this.receipts.create(arCommand(req))); }
}

export class ConfirmArReceiptHandler extends ReceiptHandler {
  static handlerName = "confirmArReceipt";
  static api = command("/:id/confirm", "Confirm a Draft AR receipt and assign its number");
  async execute(req) { return this.response(await this.receipts.confirm(this.target(req))); }
}

export class CancelArReceiptHandler extends ReceiptHandler {
  static handlerName = "cancelArReceipt";
  static api = command("/:id/cancel", "Cancel a Draft AR receipt");
  async execute(req) { return this.response(await this.receipts.cancel(this.target(req))); }
}

export class VoidArReceiptHandler extends ReceiptHandler {
  static handlerName = "voidArReceipt";
  static api = command("/:id/void", "Void a Confirmed AR receipt that has no active allocation");
  async execute(req) { return this.response(await this.receipts.void(this.target(req))); }
}

export class AllocateArReceiptHandler extends ReceiptHandler {
  static handlerName = "allocateArReceipt";
  static api = command("/:id/allocations", "Allocate a Confirmed AR receipt to one or more Confirmed invoices", ALLOCATION_COMMAND_RESPONSE);
  async execute(req) { return this.response(await this.receipts.allocate(this.target(req))); }
}

export class UnapplyArReceiptAllocationHandler extends ReceiptHandler {
  static handlerName = "unapplyArReceiptAllocation";
  static api = command("/:id/allocations/:allocationId/unapply", "Unapply one allocation of an AR receipt", ALLOCATION_COMMAND_RESPONSE, ALLOCATION_PARAMS);
  async execute(req) { return this.response(await this.receipts.unapply({ ...this.target(req), allocationId: Number(req.input.params.allocationId) })); }
}
