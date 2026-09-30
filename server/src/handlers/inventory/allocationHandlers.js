import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryReservationService } from "../../modules/inventory/InventoryReservationService.js";
import {
  ALLOCATION_CREATE, ALLOCATION_CREATE_RESPONSE, ALLOCATION_REALLOCATE,
  ALLOCATION_RELEASE, ALLOCATION_RELEASE_RESPONSE, EMPTY, OPERATION_POLICY, RESERVATION_ID_PARAMS
} from "./inventorySchemas.js";

class AllocationHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryReservationService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  command(req, purpose) {
    const { source, version, ...payload } = req.input.body;
    return {
      actor: {
        userId: Number(req.auth.claims.sub), serviceName: "",
        claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions
      },
      authorization: { purpose, requiredCallerPermission: "inventory.operation" },
      source, correlationId: req.requestId ?? "",
      payload: { reservationId: req.input.params.id, expectedVersion: version, ...payload }
    };
  }
}

function allocationApi(action, body, response) {
  return {
    method: "POST", path: `/api/v1/inventory/reservations/:id/allocations/${action}`,
    description: `依正式來源原子執行 Allocation ${action}。`,
    authorizationPolicies: OPERATION_POLICY,
    idempotency: Object.freeze({ enabled: true }),
    requestSchema: { params: RESERVATION_ID_PARAMS, query: EMPTY, body },
    responseSchema: { 200: response }
  };
}

export class CreateInventoryAllocationHandler extends AllocationHandler {
  static handlerName = "createInventoryAllocation";
  static api = allocationApi("create", ALLOCATION_CREATE, ALLOCATION_CREATE_RESPONSE);
  async execute(req) {
    return this.response(await this.inventory.allocate(this.command(req, "allocation.create")));
  }
}

export class ReleaseInventoryAllocationHandler extends AllocationHandler {
  static handlerName = "releaseInventoryAllocation";
  static api = allocationApi("release", ALLOCATION_RELEASE, ALLOCATION_RELEASE_RESPONSE);
  async execute(req) {
    return this.response(await this.inventory.releaseAllocation(this.command(req, "allocation.release")));
  }
}

export class ReallocateInventoryAllocationHandler extends AllocationHandler {
  static handlerName = "reallocateInventoryAllocation";
  static api = allocationApi("reallocate", ALLOCATION_REALLOCATE, ALLOCATION_CREATE_RESPONSE);
  async execute(req) {
    return this.response(await this.inventory.reallocateAllocation(this.command(req, "allocation.reallocate")));
  }
}
