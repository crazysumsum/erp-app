import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryReservationService } from "../../modules/inventory/InventoryReservationService.js";
import { EMPTY, OPERATION_POLICY, RESERVATION_CREATE, RESERVATION_RESPONSE } from "./inventorySchemas.js";

export class CreateInventoryReservationHandler extends BaseRequestHandler {
  static handlerName = "createInventoryReservation";
  static api = {
    method: "POST",
    path: "/api/v1/inventory/reservations/create",
    description: "依正式來源及即時 ATP 原子建立庫存預留。",
    authorizationPolicies: OPERATION_POLICY,
    idempotency: Object.freeze({ enabled: true }),
    requestSchema: { params: EMPTY, query: EMPTY, body: RESERVATION_CREATE },
    responseSchema: { 200: RESERVATION_RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryReservationService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const { source, ...payload } = req.input.body;
    return this.response(await this.inventory.create({
      actor: {
        userId: Number(req.auth.claims.sub), serviceName: "",
        claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions
      },
      authorization: { purpose: "reservation.create", requiredCallerPermission: "inventory.operation" },
      source, correlationId: req.requestId ?? "", payload
    }));
  }
}
