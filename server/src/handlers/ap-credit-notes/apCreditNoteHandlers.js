import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  ALLOCATION_PARAMS, AP_CREDIT_POLICY, AP_VIEW_POLICY, CREDIT_COMMAND_RESPONSE, CREDIT_DETAIL_RESPONSE,
  CREDIT_LIST_QUERY, CREDIT_LIST_RESPONSE, EMPTY, ID_PARAMS, apCommand, apCreditInquiry, apCreditService
} from "../accounts-payable/apSchemas.js";

const base = "/api/v1/ap-credit-notes";
const read = (path, description, query, response, params = EMPTY) => ({
  method: "GET", path: base + path, description, authorizationPolicies: [AP_VIEW_POLICY],
  requestSchema: { params, query, body: EMPTY }, responseSchema: { 200: response }
});
const command = (path, description, params = ID_PARAMS) => ({
  method: "POST", path: base + path, description, authorizationPolicies: [AP_CREDIT_POLICY], idempotency: { enabled: true },
  requestSchema: { params, query: EMPTY, body: {} }, responseSchema: { 200: CREDIT_COMMAND_RESPONSE }
});

class CreditCommandHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.credits = apCreditService(services); }
  target(req) { return { ...apCommand(req), creditNoteId: Number(req.input.params.id) }; }
}

export class ListApCreditNotesHandler extends BaseRequestHandler {
  static handlerName = "listApCreditNotes";
  static api = read("", "List AP credit notes", CREDIT_LIST_QUERY, CREDIT_LIST_RESPONSE);
  constructor(services = {}) { super(services); this.credits = apCreditInquiry(services); }
  async execute(req) { return this.response(await this.credits.list({ query: req.input.query })); }
}

export class GetApCreditNoteHandler extends BaseRequestHandler {
  static handlerName = "getApCreditNote";
  static api = read("/:id", "Read an AP credit note with lines and allocations", EMPTY, CREDIT_DETAIL_RESPONSE, ID_PARAMS);
  constructor(services = {}) { super(services); this.credits = apCreditInquiry(services); }
  async execute(req) {
    return this.response(await this.credits.get({ id: Number(req.input.params.id), claims: req.auth.claims }));
  }
}

export class CreateApCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "createApCreditNote";
  static api = command("", "Create an AP credit note draft", EMPTY);
  async execute(req) { return this.response(await this.credits.create(apCommand(req))); }
}

export class UpdateApCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "updateApCreditNote";
  static api = command("/:id/update", "Update an AP credit note draft");
  async execute(req) { return this.response(await this.credits.update(this.target(req))); }
}

export class ConfirmApCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "confirmApCreditNote";
  static api = command("/:id/confirm", "Confirm and number an AP credit note");
  async execute(req) { return this.response(await this.credits.confirm(this.target(req))); }
}

export class CancelApCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "cancelApCreditNote";
  static api = command("/:id/cancel", "Cancel an AP credit note draft");
  async execute(req) { return this.response(await this.credits.cancel(this.target(req))); }
}

export class VoidApCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "voidApCreditNote";
  static api = command("/:id/void", "Void a confirmed AP credit note");
  async execute(req) { return this.response(await this.credits.void(this.target(req))); }
}

export class AllocateApCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "allocateApCreditNote";
  static api = command("/:id/allocations", "Apply AP credit to a confirmed invoice");
  async execute(req) { return this.response(await this.credits.allocate(this.target(req))); }
}

export class UnapplyApCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "unapplyApCreditNote";
  static api = command("/:id/allocations/:allocationId/unapply", "Unapply credit allocated to a different invoice", ALLOCATION_PARAMS);
  async execute(req) {
    return this.response(await this.credits.unapply({ ...this.target(req), allocationId: Number(req.input.params.allocationId) }));
  }
}
