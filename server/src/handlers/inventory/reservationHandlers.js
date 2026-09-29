import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryReservationService } from "../../modules/inventory/InventoryReservationService.js";
import {
  EMPTY, OPERATION_POLICY, RESERVATION_CANCEL, RESERVATION_CREATE,
  RESERVATION_ID_PARAMS, RESERVATION_RELEASE, RESERVATION_RESPONSE
} from "./inventorySchemas.js";

class ReservationHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryReservationService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  command(req, purpose, payload, source = req.input.body.source) {
    return {
      actor: {
        userId: Number(req.auth.claims.sub), serviceName: "",
        claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions
      },
      authorization: { purpose, requiredCallerPermission: "inventory.operation" },
      source, correlationId: req.requestId ?? "", payload
    };
  }
}

function changeApi(action, body) {
  return {
    method: "POST", path: `/api/v1/inventory/reservations/:id/${action}`,
    description: `${action} inventory reservation with an immutable source event.`,
    authorizationPolicies: OPERATION_POLICY,
    idempotency: Object.freeze({ enabled: true }),
    requestSchema: { params: RESERVATION_ID_PARAMS, query: EMPTY, body },
    responseSchema: { 200: RESERVATION_RESPONSE }
  };
}

export class CreateInventoryReservationHandler extends ReservationHandler {
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

  async execute(req) {
    const { source, ...payload } = req.input.body;
    return this.response(await this.inventory.create(this.command(req, "reservation.create", payload, source)));
  }
}

export class ReleaseInventoryReservationHandler extends ReservationHandler {
  static handlerName = "releaseInventoryReservation";
  static api = changeApi("release", RESERVATION_RELEASE);

  async execute(req) {
    return this.response(await this.inventory.release(this.command(req, "reservation.release", {
      reservationId: req.input.params.id,
      expectedVersion: req.input.body.version,
      quantity: req.input.body.quantity
    })));
  }
}

export class CancelInventoryReservationHandler extends ReservationHandler {
  static handlerName = "cancelInventoryReservation";
  static api = changeApi("cancel", RESERVATION_CANCEL);

  async execute(req) {
    return this.response(await this.inventory.cancel(this.command(req, "reservation.cancel", {
      reservationId: req.input.params.id,
      expectedVersion: req.input.body.version
    })));
  }
}
