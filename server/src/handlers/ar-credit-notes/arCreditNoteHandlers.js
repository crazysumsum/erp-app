import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ArCreditNoteService } from "../../modules/ar/ArCreditNoteService.js";
import { ArCreditNoteInquiryService } from "../../modules/ar/ArCreditNoteInquiryService.js";
import { ArCommandRunner } from "../../modules/ar/arCommand.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { AMOUNT, AR_VIEW_POLICY, CURRENCY, DATE, EMPTY, ID, ID_PARAMS, NULLABLE_TEXT, NULLABLE_TIME, PAGE, TEXT, TIME,
  actions, arCommand, object } from "../ar/arSchemas.js";

const BASE = "/api/v1/ar-credit-notes";
const MANAGE = { name: "hasPermission", options: { permissions: ["ar.credit.mgmt"] } };
const STATES = { enum: ["DRAFT", "CONFIRMED", "CANCELLED", "VOID"] };
const NULLABLE_ID = { ...ID, type: ["integer", "null"] }, BOOLEAN = { type: "boolean" };
const AMOUNTS = { totalAmount: AMOUNT, appliedAmount: AMOUNT, refundedAmount: AMOUNT, availableAmount: AMOUNT };
const IDENTITY = { id: ID, number: NULLABLE_TEXT, status: STATES, version: ID };
const SUMMARY = { ...IDENTITY, ...AMOUNTS, invoiceId: ID, customerId: ID, customerCode: TEXT, customerName: TEXT,
  currencyCode: CURRENCY, currencyDecimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, creditDate: DATE, createdAt: TIME, updatedAt: TIME };
const LIST_QUERY = object({ ...PAGE, status: STATES, customerId: ID, currencyCode: CURRENCY, invoiceId: ID,
  creditDateFrom: DATE, creditDateTo: DATE, q: { ...TEXT, minLength: 1, maxLength: 190 } }, []);
const LIST_RESPONSE = object({ items: { type: "array", maxItems: 100, items: object(SUMMARY) }, total: { type: "integer", minimum: 0 }, ...PAGE });
const DETAIL_RESPONSE = object({
  ...SUMMARY, reason: TEXT, notes: TEXT, voidReason: TEXT, invoiceNumber: NULLABLE_TEXT, customerReturnId: NULLABLE_ID,
  createdByLabel: TEXT, confirmedByLabel: TEXT, confirmedAt: NULLABLE_TIME, voidedByLabel: TEXT, voidedAt: NULLABLE_TIME,
  allowedActions: actions("edit", "confirm", "cancel", "apply", "void"),
  lines: { type: "array", items: object({ id: ID, lineNo: ID, invoiceLineId: NULLABLE_ID, customerReturnLineId: NULLABLE_ID,
    baseQuantity: { ...NULLABLE_TEXT, pattern: "^[1-9]\\d*$" }, amount: AMOUNT, description: TEXT, skuCode: NULLABLE_TEXT, skuName: NULLABLE_TEXT, baseUomCode: NULLABLE_TEXT }) },
  applications: { type: "array", items: object({ id: ID, invoiceId: ID, invoiceNumber: NULLABLE_TEXT, isOrigin: BOOLEAN, amount: AMOUNT,
    status: { enum: ["ACTIVE", "UNAPPLIED"] }, createdAt: TIME, createdByLabel: TEXT, unappliedAt: NULLABLE_TIME, unappliedByLabel: TEXT,
    allowedActions: actions("unapply") }) }
});
const COMMAND_OUTPUT = { ...IDENTITY, ...AMOUNTS, replayed: BOOLEAN };
const COMMAND_RESPONSE = object({ ...COMMAND_OUTPUT, applicationId: ID }, Object.keys(COMMAND_OUTPUT));

const command = (path, description, params = ID_PARAMS) => ({ method: "POST", path: BASE + path, description, authorizationPolicies: [MANAGE],
  idempotency: { enabled: true }, requestSchema: { params, query: EMPTY, body: {} }, responseSchema: { 200: COMMAND_RESPONSE } });

class CreditInquiryHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inquiry = new ArCreditNoteInquiryService({ database: services.require("mysqldatabase") });
  }
}

class CreditCommandHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    const database = services.require("mysqldatabase"), time = services.require("time");
    this.credits = new ArCreditNoteService({ commands: new ArCommandRunner({ database, time }), time,
      businessMaster: new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() }) });
  }
  target(req) { return { ...arCommand(req), creditNoteId: Number(req.input.params.id) }; }
}

export class ListArCreditNotesHandler extends CreditInquiryHandler {
  static handlerName = "listArCreditNotes";
  static api = { method: "GET", path: BASE, description: "List AR credit notes", authorizationPolicies: [AR_VIEW_POLICY],
    requestSchema: { params: EMPTY, query: LIST_QUERY, body: EMPTY }, responseSchema: { 200: LIST_RESPONSE } };
  async execute(req) { return this.response(await this.inquiry.list({ query: req.input.query })); }
}

export class GetArCreditNoteHandler extends CreditInquiryHandler {
  static handlerName = "getArCreditNote";
  static api = { method: "GET", path: BASE + "/:id", description: "Read an AR credit note and its lines and applications", authorizationPolicies: [AR_VIEW_POLICY],
    requestSchema: { params: ID_PARAMS, query: EMPTY, body: EMPTY }, responseSchema: { 200: DETAIL_RESPONSE } };
  async execute(req) { return this.response(await this.inquiry.get({ id: Number(req.input.params.id), claims: req.auth.claims })); }
}

export class ListArCreditReturnSourcesHandler extends CreditInquiryHandler {
  static handlerName = "listArCreditReturnSources";
  static api = { method: "GET", path: BASE + "/sources/:id/returns", description: "List posted return lines tied to an original AR invoice",
    authorizationPolicies: [{ name: "hasPermission", options: { permissions: ["ar.view", "ar.credit.mgmt"] } }],
    requestSchema: { params: ID_PARAMS, query: EMPTY, body: EMPTY },
    responseSchema: { 200: object({ items: { type: "array", items: object({
      returnId: ID, returnDate: DATE, returnLineId: ID, lineNo: ID, invoiceLineId: ID
    }) } }) } };
  async execute(req) { return this.response(await this.inquiry.returnSources(Number(req.input.params.id))); }
}

export class CreateArCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "createArCreditNote";
  static api = command("", "Create an AR credit note draft", EMPTY);
  async execute(req) { return this.response(await this.credits.create(arCommand(req))); }
}

export class EditArCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "editArCreditNote";
  static api = command("/:id/edit", "Replace the fields and lines of an AR credit note draft");
  async execute(req) { return this.response(await this.credits.edit(this.target(req))); }
}

export class ConfirmArCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "confirmArCreditNote";
  static api = command("/:id/confirm", "Confirm a credit note and apply it to the original invoice");
  async execute(req) { return this.response(await this.credits.confirm(this.target(req))); }
}

export class CancelArCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "cancelArCreditNote";
  static api = command("/:id/cancel", "Cancel a credit note draft");
  async execute(req) { return this.response(await this.credits.cancel(this.target(req))); }
}

export class VoidArCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "voidArCreditNote";
  static api = command("/:id/void", "Void a confirmed credit note and undo its application to the original invoice");
  async execute(req) { return this.response(await this.credits.void(this.target(req))); }
}

export class ApplyArCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "applyArCreditNote";
  static api = command("/:id/applications", "Apply credit to another invoice");
  async execute(req) { return this.response(await this.credits.apply(this.target(req))); }
}

export class UnapplyArCreditNoteHandler extends CreditCommandHandler {
  static handlerName = "unapplyArCreditNote";
  static api = command("/:id/applications/:applicationId/unapply", "Unapply credit from another invoice", object({ id: ID, applicationId: ID }));
  async execute(req) { return this.response(await this.credits.unapply({ ...this.target(req), applicationId: Number(req.input.params.applicationId) })); }
}
