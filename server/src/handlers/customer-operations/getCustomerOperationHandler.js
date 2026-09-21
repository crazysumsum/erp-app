import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerService } from "../../modules/customer/CustomerService.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { EMPTY, OPERATION, OPERATION_ID_PARAMS } from "../customers/customerSchemas.js";

export class GetCustomerOperationHandler extends BaseRequestHandler {
  static handlerName = "getCustomerOperation";

  static api = {
    method: "GET",
    path: "/api/v1/customer-operations/:operationId",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead],
    requestSchema: { params: OPERATION_ID_PARAMS, query: EMPTY },
    responseSchema: { 200: OPERATION },
    description: "getCustomerOperation endpoint."
  };

  constructor(services = {}) {
    super(services);
    this.customer = new CustomerService({
      database: services.require("mysqldatabase"),
      time: services.require("time")
    });
  }

  async execute(req) {
    const result = await this.customer.getOperation({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      operationId: req.input.params.operationId
    });
    return this.response(result ?? {
      operationId: req.input.params.operationId,
      status: "unknown",
      resourceType: null,
      resourceId: null,
      resultVersion: null,
      errorCode: null
    });
  }
}
