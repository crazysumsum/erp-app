import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { fulfillmentError } from "../../modules/fulfillment/fulfillmentErrors.js";
import { SHIPMENT_EMPTY, SHIPMENT_ID_PARAMS } from "./shipmentDraftSchemas.js";
import { SHIPMENT_REVERSE_BODY, SHIPMENT_REVERSE_RESPONSE, SHIPMENT_REVERSE_PENDING } from "./shipmentReversalSchemas.js";

export class ReverseShipmentHandler extends BaseRequestHandler {
  static handlerName = "reverseShipment";
  static api = {
    method: "POST", path: "/api/v1/shipments/:id/reverse", description: "Reverse Shipment with original-event recovery",
    authType: "jwt-device-password",
    authorizationPolicies: [{ name: "hasPermission", options: { permissions: ["fulfillment.view", "fulfillment.reverse"] } }],
    idempotency: { enabled: true, retryAfterSeconds: 2 },
    requestSchema: { params: SHIPMENT_ID_PARAMS, query: SHIPMENT_EMPTY, body: SHIPMENT_REVERSE_BODY },
    responseSchema: { 200: SHIPMENT_REVERSE_RESPONSE, 202: SHIPMENT_REVERSE_PENDING }
  };

  constructor(services) {
    super(services);
    this.runtime = services.require("fulfillment.shipmentConfirmation");
  }

  authorizeRequest(req) {
    const { password, ...body } = req.body;
    if (password.length > 1024 || req.get("Idempotency-Key") !== body.eventId) {
      throw fulfillmentError("FULFILLMENT_INPUT_INVALID", { field: password.length > 1024 ? "password" : "eventId" });
    }
    // Device signing and password confirmation have already used the original request.
    // Validate and fingerprint the same business body as before password confirmation.
    req.body = body;
    return this.runtime.authorizeRequest("fulfillment.reverse");
  }

  async execute(req, res) {
    const { statusCode, data } = await this.runtime.reverse(String(req.input.params.id), req.input.body);
    if (statusCode === 202) res.setHeader("Retry-After", String(data.retryAfterSeconds));
    return this.response(data, { statusCode });
  }
}
