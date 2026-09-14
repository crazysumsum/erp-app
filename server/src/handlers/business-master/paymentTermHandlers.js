import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { actorInput, adminService } from "./handlerSupport.js";
import { EMPTY, IMPACT_RESPONSE, LIST_QUERY, MGMT_POLICY, PAYMENT_TERM, PAYMENT_TERM_LIST, REASON, TERM_ID_PARAMS, TOKEN, VERSION, VIEW_POLICY, listInput } from "./businessMasterSchemas.js";

const IDEMPOTENT = Object.freeze({ enabled: true });
const TERM_CODE = Object.freeze({ type: "string", minLength: 1, maxLength: 50 });
const TERM_NAME = Object.freeze({ type: "string", minLength: 1, maxLength: 100 });
const TERM_DESCRIPTION = Object.freeze({ type: "string", maxLength: 500 });
const TERM_CODE_INPUT = Object.freeze({ ...TERM_CODE, trim: true });
const TERM_NAME_INPUT = Object.freeze({ ...TERM_NAME, trim: true });
const TERM_DESCRIPTION_INPUT = Object.freeze({ ...TERM_DESCRIPTION, trim: true });
const TYPE = Object.freeze({ type: "string", enum: ["IMMEDIATE", "NET_DAYS", "END_OF_MONTH", "MANUAL"] });
const DAYS = Object.freeze({ type: ["integer", "null"], minimum: 0, maximum: 3650 });

class PaymentTermHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.admin = adminService(services); }
}

export class ListPaymentTermsHandler extends PaymentTermHandler {
  static handlerName = "listBusinessMasterPaymentTerms";
  static api = { method: "GET", path: "/api/v1/business-master/payment-terms", authorizationPolicies: VIEW_POLICY, requestSchema: { params: EMPTY, query: LIST_QUERY }, responseSchema: { 200: PAYMENT_TERM_LIST } };
  async execute(req) { return this.response(await this.admin.listPaymentTerms({ ...actorInput(req), ...listInput(req.input.query) })); }
}

export class CreatePaymentTermHandler extends PaymentTermHandler {
  static handlerName = "createBusinessMasterPaymentTerm";
  static api = { method: "POST", path: "/api/v1/business-master/payment-terms", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: EMPTY, query: EMPTY, body: { type: "object", required: ["code", "name", "description", "calculationType", "dueDays"], additionalProperties: false, properties: { code: TERM_CODE_INPUT, name: TERM_NAME_INPUT, description: TERM_DESCRIPTION_INPUT, calculationType: TYPE, dueDays: DAYS } } }, responseSchema: { 201: PAYMENT_TERM } };
  async execute(req) { return this.response(await this.admin.createPaymentTerm({ ...actorInput(req), ...req.input.body }), { statusCode: 201 }); }
}

export class GetPaymentTermHandler extends PaymentTermHandler {
  static handlerName = "getBusinessMasterPaymentTerm";
  static api = { method: "GET", path: "/api/v1/business-master/payment-terms/:id", authorizationPolicies: VIEW_POLICY, requestSchema: { params: TERM_ID_PARAMS, query: EMPTY }, responseSchema: { 200: PAYMENT_TERM } };
  async execute(req) { return this.response(await this.admin.getPaymentTerm({ ...actorInput(req), id: Number(req.input.params.id) })); }
}

export class UpdatePaymentTermHandler extends PaymentTermHandler {
  static handlerName = "updateBusinessMasterPaymentTerm";
  static api = { method: "PATCH", path: "/api/v1/business-master/payment-terms/:id", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: TERM_ID_PARAMS, query: EMPTY, body: { type: "object", required: ["name", "description", "version"], additionalProperties: false, properties: { name: TERM_NAME_INPUT, description: TERM_DESCRIPTION_INPUT, version: VERSION } } }, responseSchema: { 200: PAYMENT_TERM } };
  async execute(req) { return this.response(await this.admin.updatePaymentTerm({ ...actorInput(req), id: Number(req.input.params.id), ...req.input.body })); }
}

export class PreviewPaymentTermImpactHandler extends PaymentTermHandler {
  static handlerName = "previewBusinessMasterPaymentTermImpact";
  static api = { method: "POST", path: "/api/v1/business-master/payment-terms/:id/impact-preview", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: TERM_ID_PARAMS, query: EMPTY, body: { type: "object", required: ["operation", "version", "proposedChange"], additionalProperties: false, properties: { operation: { type: "string", enum: ["DEACTIVATE", "CHANGE_RULE"] }, version: VERSION, proposedChange: { type: "object", additionalProperties: false, properties: { calculationType: TYPE, dueDays: DAYS } } } } }, responseSchema: { 200: IMPACT_RESPONSE } };
  async execute(req) {
    const { operation, version, proposedChange } = req.input.body;
    const change = operation === "DEACTIVATE" ? { status: "INACTIVE" } : { calculationType: proposedChange.calculationType, dueDays: proposedChange.dueDays };
    return this.response(await this.admin.previewImpact({ ...actorInput(req), entityType: "PAYMENT_TERM", entityKey: req.input.params.id, version, operation, proposedChange: change }));
  }
}

function statusApi(path, tokenRequired) {
  return { method: "POST", path, authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: TERM_ID_PARAMS, query: EMPTY, body: { type: "object", required: ["version", "reason", ...(tokenRequired ? ["impactToken"] : [])], additionalProperties: false, properties: { version: VERSION, reason: REASON, ...(tokenRequired ? { impactToken: TOKEN } : {}) } } }, responseSchema: { 200: PAYMENT_TERM } };
}

export class ActivatePaymentTermHandler extends PaymentTermHandler {
  static handlerName = "activateBusinessMasterPaymentTerm";
  static api = statusApi("/api/v1/business-master/payment-terms/:id/activate", false);
  async execute(req) { return this.response(await this.admin.activatePaymentTerm({ ...actorInput(req), id: Number(req.input.params.id), ...req.input.body })); }
}

export class DeactivatePaymentTermHandler extends PaymentTermHandler {
  static handlerName = "deactivateBusinessMasterPaymentTerm";
  static api = statusApi("/api/v1/business-master/payment-terms/:id/deactivate", true);
  async execute(req) { return this.response(await this.admin.deactivatePaymentTerm({ ...actorInput(req), id: Number(req.input.params.id), ...req.input.body })); }
}

export class ChangePaymentTermRuleHandler extends PaymentTermHandler {
  static handlerName = "changeBusinessMasterPaymentTermRule";
  static api = { method: "POST", path: "/api/v1/business-master/payment-terms/:id/change-rule", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: TERM_ID_PARAMS, query: EMPTY, body: { type: "object", required: ["calculationType", "dueDays", "version", "reason", "impactToken"], additionalProperties: false, properties: { calculationType: TYPE, dueDays: DAYS, version: VERSION, reason: REASON, impactToken: TOKEN } } }, responseSchema: { 200: PAYMENT_TERM } };
  async execute(req) { return this.response(await this.admin.changePaymentTermRule({ ...actorInput(req), id: Number(req.input.params.id), ...req.input.body })); }
}

const CALCULATION_TERM = Object.freeze({ type: "object", additionalProperties: false, required: ["id", "code", "name", "version", "calculationType", "dueDays"], properties: { id: { type: "integer", minimum: 1 }, code: TERM_CODE, name: TERM_NAME, version: VERSION, calculationType: TYPE, dueDays: DAYS } });
const CALCULATION_RESPONSE = Object.freeze({ type: "object", additionalProperties: false, required: ["term", "baseDate", "dueDate", "requiresManualDueDate"], properties: { term: CALCULATION_TERM, baseDate: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }, dueDate: { type: ["string", "null"], pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }, requiresManualDueDate: { type: "boolean" } } });

export class CalculatePaymentTermHandler extends PaymentTermHandler {
  static handlerName = "calculatePaymentTerm";
  static api = { method: "POST", path: "/api/v1/business-master/payment-terms/:id/calculate", authorizationPolicies: VIEW_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: TERM_ID_PARAMS, query: EMPTY, body: { type: "object", required: ["baseDate", "expectedVersion"], additionalProperties: false, properties: { baseDate: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }, expectedVersion: VERSION } } }, responseSchema: { 200: CALCULATION_RESPONSE } };
  async execute(req) { return this.response(await this.admin.calculatePaymentTerm({ ...actorInput(req), id: Number(req.input.params.id), ...req.input.body })); }
}

for (const Handler of [ListPaymentTermsHandler, CreatePaymentTermHandler, GetPaymentTermHandler, UpdatePaymentTermHandler, PreviewPaymentTermImpactHandler, ActivatePaymentTermHandler, DeactivatePaymentTermHandler, ChangePaymentTermRuleHandler, CalculatePaymentTermHandler]) {
  Handler.api.description = `${Handler.handlerName} endpoint.`;
}
