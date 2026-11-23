import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { arError } from "../../modules/ar/arErrors.js";
import { CustomerLookupService } from "../../modules/customer/CustomerLookupService.js";
import { AR_OPENING_POLICY, EMPTY, OPENING_CUSTOMER_QUERY, OPENING_CUSTOMER_RESPONSE } from "../ar/arSchemas.js";

export class FindArOpeningCustomerHandler extends BaseRequestHandler {
  static handlerName = "findArOpeningCustomer";
  static api = {
    method: "GET",
    path: "/api/v1/ar-opening-invoices/customer",
    description: "Verify a customer by code before registering an opening invoice",
    authorizationPolicies: [AR_OPENING_POLICY],
    requestSchema: { params: EMPTY, query: OPENING_CUSTOMER_QUERY, body: EMPTY },
    responseSchema: { 200: OPENING_CUSTOMER_RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.customers = new CustomerLookupService({ database: services.require("mysqldatabase") });
  }

  async execute(req) {
    const customer = await this.customers.findByCode(req.input.query.code, { purpose: "ar_existing_document" });
    if (!customer) throw arError("AR_CUSTOMER_NOT_FOUND");
    return this.response({
      customerId: customer.customerId, customerCode: customer.customerCode, customerName: customer.legalName, active: customer.status === "active"
    });
  }
}
