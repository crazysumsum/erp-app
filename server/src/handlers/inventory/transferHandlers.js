import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryTransferService } from "../../modules/inventory/InventoryTransferService.js";
import { InventoryInquiryService } from "../../modules/inventory/InventoryInquiryService.js";
import { EMPTY, OPERATION_POLICY, VIEW_POLICY, TRANSFER_ID_PARAMS, TRANSFER_LIST_QUERY,
  TRANSFER_LIST_RESPONSE, TRANSFER_DETAIL_RESPONSE, TRANSFER_COMMAND_RESPONSE,
  TRANSFER_CREATE, TRANSFER_UPDATE, TRANSFER_CANCEL, TRANSFER_DISPATCH, TRANSFER_RECEIVE } from "./inventorySchemas.js";

class TransferInquiryHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryInquiryService({ database: services.require("mysqldatabase"), time: services.require("time") });
  }
}
export class ListInventoryTransfersHandler extends TransferInquiryHandler {
  static handlerName = "listInventoryTransfers";
  static api = { method: "GET", path: "/api/v1/inventory/transfers", authType: "jwt",
    description: "分頁查詢跨倉調撥及在途數量。", authorizationPolicies: VIEW_POLICY,
    requestSchema: { params: EMPTY, query: TRANSFER_LIST_QUERY }, responseSchema: { 200: TRANSFER_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.inventory.listTransfers(req.input.query)); }
}
export class GetInventoryTransferHandler extends TransferInquiryHandler {
  static handlerName = "getInventoryTransfer";
  static api = { method: "GET", path: "/api/v1/inventory/transfers/:id", authType: "jwt",
    description: "取得完整調撥、在途及異動追溯。", authorizationPolicies: VIEW_POLICY,
    requestSchema: { params: TRANSFER_ID_PARAMS, query: EMPTY }, responseSchema: { 200: TRANSFER_DETAIL_RESPONSE } };
  async execute(req) { return this.response(await this.inventory.getTransfer(req.input.params.id)); }
}
class TransferCommandHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryTransferService({ database: services.require("mysqldatabase"),
      logger: services.require("logging").logger, time: services.require("time") });
  }
  async change(req, action) {
    const { source, version, ...payload } = req.input.body;
    if (action !== "create") Object.assign(payload, { transferId: req.input.params.id, expectedVersion: version });
    return this.response(await this.inventory[action]({
      actor: { userId: Number(req.auth.claims.sub), serviceName: "",
        claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions },
      authorization: { purpose: `transfer.${action}`, requiredCallerPermission: "inventory.operation" },
      source, correlationId: req.requestId ?? "", payload
    }));
  }
}
function changeApi(action, body) {
  return { method: "POST", path: action === "create" ? "/api/v1/inventory/transfers/create" : `/api/v1/inventory/transfers/:id/${action}`,
    authType: "jwt", description: `整張調撥 ${action}；禁止部分過帳。`, authorizationPolicies: OPERATION_POLICY,
    idempotency: Object.freeze({ enabled: true }), requestSchema: { params: action === "create" ? EMPTY : TRANSFER_ID_PARAMS, query: EMPTY, body },
    responseSchema: { 200: TRANSFER_COMMAND_RESPONSE } };
}
export class CreateInventoryTransferHandler extends TransferCommandHandler {
  static handlerName = "createInventoryTransfer";
  static api = changeApi("create", TRANSFER_CREATE);
  async execute(req) { return this.change(req, "create"); }
}
export class UpdateInventoryTransferHandler extends TransferCommandHandler {
  static handlerName = "updateInventoryTransfer";
  static api = changeApi("update", TRANSFER_UPDATE);
  async execute(req) { return this.change(req, "update"); }
}
export class CancelInventoryTransferHandler extends TransferCommandHandler {
  static handlerName = "cancelInventoryTransfer";
  static api = changeApi("cancel", TRANSFER_CANCEL);
  async execute(req) { return this.change(req, "cancel"); }
}
export class DispatchInventoryTransferHandler extends TransferCommandHandler {
  static handlerName = "dispatchInventoryTransfer";
  static api = changeApi("dispatch", TRANSFER_DISPATCH);
  async execute(req) { return this.change(req, "dispatch"); }
}
export class ReceiveInventoryTransferHandler extends TransferCommandHandler {
  static handlerName = "receiveInventoryTransfer";
  static api = changeApi("receive", TRANSFER_RECEIVE);
  async execute(req) { return this.change(req, "receive"); }
}
