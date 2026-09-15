import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { actorInput, adminService } from "./handlerSupport.js";
import { CURRENCY, CURRENCY_CODE_INPUT, CURRENCY_LIST, CURRENCY_PARAMS, EMPTY, IMPACT_RESPONSE, LIST_QUERY, MGMT_POLICY, REASON, TOKEN, VERSION, VIEW_POLICY, listInput } from "./businessMasterSchemas.js";

const IDEMPOTENT = Object.freeze({ enabled: true });

class CurrencyHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.admin = adminService(services); }
}

export class ListCurrenciesHandler extends CurrencyHandler {
  static handlerName = "listBusinessMasterCurrencies";
  static api = { method: "GET", path: "/api/v1/business-master/currencies", authorizationPolicies: VIEW_POLICY, requestSchema: { params: EMPTY, query: LIST_QUERY }, responseSchema: { 200: CURRENCY_LIST } };
  async execute(req) { return this.response(await this.admin.listCurrencies({ ...actorInput(req), ...listInput(req.input.query) })); }
}

export class CreateCurrencyHandler extends CurrencyHandler {
  static handlerName = "createBusinessMasterCurrency";
  static api = { method: "POST", path: "/api/v1/business-master/currencies", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: EMPTY, query: EMPTY, body: { type: "object", required: ["code", "name", "decimalPlaces"], additionalProperties: false, properties: { code: CURRENCY_CODE_INPUT, name: { type: "string", trim: true, minLength: 1, maxLength: 100 }, decimalPlaces: { type: "integer", minimum: 0, maximum: 4 } } } }, responseSchema: { 201: CURRENCY } };
  async execute(req) { return this.response(await this.admin.createCurrency({ ...actorInput(req), ...req.input.body }), { statusCode: 201 }); }
}

export class GetCurrencyHandler extends CurrencyHandler {
  static handlerName = "getBusinessMasterCurrency";
  static api = { method: "GET", path: "/api/v1/business-master/currencies/:code", authorizationPolicies: VIEW_POLICY, requestSchema: { params: CURRENCY_PARAMS, query: EMPTY }, responseSchema: { 200: CURRENCY } };
  async execute(req) { return this.response(await this.admin.getCurrency({ ...actorInput(req), code: req.input.params.code })); }
}

export class UpdateCurrencyHandler extends CurrencyHandler {
  static handlerName = "updateBusinessMasterCurrency";
  static api = { method: "PATCH", path: "/api/v1/business-master/currencies/:code", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: CURRENCY_PARAMS, query: EMPTY, body: { type: "object", required: ["name", "version"], additionalProperties: false, properties: { name: { type: "string", trim: true, minLength: 1, maxLength: 100 }, version: VERSION } } }, responseSchema: { 200: CURRENCY } };
  async execute(req) { return this.response(await this.admin.updateCurrency({ ...actorInput(req), code: req.input.params.code, ...req.input.body })); }
}

export class PreviewCurrencyImpactHandler extends CurrencyHandler {
  static handlerName = "previewBusinessMasterCurrencyImpact";
  static api = { method: "POST", path: "/api/v1/business-master/currencies/:code/impact-preview", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: CURRENCY_PARAMS, query: EMPTY, body: { type: "object", required: ["operation", "version", "proposedChange"], additionalProperties: false, properties: { operation: { type: "string", enum: ["DEACTIVATE", "CHANGE_PRECISION"] }, version: VERSION, proposedChange: { type: "object", additionalProperties: false, properties: { decimalPlaces: { type: "integer", minimum: 0, maximum: 4 } } } } } }, responseSchema: { 200: IMPACT_RESPONSE } };
  async execute(req) {
    const { operation, version, proposedChange } = req.input.body;
    const change = operation === "DEACTIVATE" ? { status: "INACTIVE" } : { decimalPlaces: proposedChange.decimalPlaces };
    return this.response(await this.admin.previewImpact({ ...actorInput(req), entityType: "CURRENCY", entityKey: req.input.params.code, version, operation, proposedChange: change }));
  }
}

function statusApi(path, tokenRequired) {
  return { method: "POST", path, authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: CURRENCY_PARAMS, query: EMPTY, body: { type: "object", required: ["version", "reason", ...(tokenRequired ? ["impactToken"] : [])], additionalProperties: false, properties: { version: VERSION, reason: REASON, ...(tokenRequired ? { impactToken: TOKEN } : {}) } } }, responseSchema: { 200: CURRENCY } };
}

export class ActivateCurrencyHandler extends CurrencyHandler {
  static handlerName = "activateBusinessMasterCurrency";
  static api = statusApi("/api/v1/business-master/currencies/:code/activate", false);
  async execute(req) { return this.response(await this.admin.activateCurrency({ ...actorInput(req), code: req.input.params.code, ...req.input.body })); }
}

export class DeactivateCurrencyHandler extends CurrencyHandler {
  static handlerName = "deactivateBusinessMasterCurrency";
  static api = statusApi("/api/v1/business-master/currencies/:code/deactivate", true);
  async execute(req) { return this.response(await this.admin.deactivateCurrency({ ...actorInput(req), code: req.input.params.code, ...req.input.body })); }
}

export class ChangeCurrencyPrecisionHandler extends CurrencyHandler {
  static handlerName = "changeBusinessMasterCurrencyPrecision";
  static api = { method: "POST", path: "/api/v1/business-master/currencies/:code/change-precision", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: CURRENCY_PARAMS, query: EMPTY, body: { type: "object", required: ["decimalPlaces", "version", "reason", "impactToken"], additionalProperties: false, properties: { decimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, version: VERSION, reason: REASON, impactToken: TOKEN } } }, responseSchema: { 200: CURRENCY } };
  async execute(req) { return this.response(await this.admin.changeCurrencyPrecision({ ...actorInput(req), code: req.input.params.code, ...req.input.body })); }
}

for (const Handler of [ListCurrenciesHandler, CreateCurrencyHandler, GetCurrencyHandler, UpdateCurrencyHandler, PreviewCurrencyImpactHandler, ActivateCurrencyHandler, DeactivateCurrencyHandler, ChangeCurrencyPrecisionHandler]) {
  Handler.api.description = `${Handler.handlerName} endpoint.`;
}
