import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryInquiryService } from "../../modules/inventory/InventoryInquiryService.js";
import {
  EMPTY, RESERVATION_DETAIL_RESPONSE, RESERVATION_ID_PARAMS,
  RESERVATION_LIST_QUERY, RESERVATION_LIST_RESPONSE, VIEW_POLICY
} from "./inventorySchemas.js";

class ReservationInquiryHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryInquiryService({
      database: services.require("mysqldatabase"), time: services.require("time")
    });
  }
}

export class ListInventoryReservationsHandler extends ReservationInquiryHandler {
  static handlerName = "listInventoryReservations";
  static api = {
    method: "GET", path: "/api/v1/inventory/reservations",
    description: "分頁查詢預留及即時 ATP／未覆蓋數量。",
    authorizationPolicies: VIEW_POLICY,
    requestSchema: { params: EMPTY, query: RESERVATION_LIST_QUERY },
    responseSchema: { 200: RESERVATION_LIST_RESPONSE }
  };
  async execute(req) { return this.response(await this.inventory.listReservations(req.input.query)); }
}

export class GetInventoryReservationHandler extends ReservationInquiryHandler {
  static handlerName = "getInventoryReservation";
  static api = {
    method: "GET", path: "/api/v1/inventory/reservations/:id",
    description: "查詢預留明細、來源及其分配。",
    authorizationPolicies: VIEW_POLICY,
    requestSchema: { params: RESERVATION_ID_PARAMS, query: EMPTY },
    responseSchema: { 200: RESERVATION_DETAIL_RESPONSE }
  };
  async execute(req) { return this.response(await this.inventory.getReservation(req.input.params.id)); }
}
