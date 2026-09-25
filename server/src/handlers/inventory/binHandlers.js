import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryMasterService } from "../../modules/inventory/InventoryMasterService.js";
import {
  BIN_CREATE, BIN_DELETE_RESPONSE, BIN_DETAIL, BIN_ID_PARAMS, BIN_LIST_QUERY, BIN_LIST_RESPONSE,
  BIN_RESPONSE, BIN_UPDATE, EMPTY, LIFECYCLE, MGMT_POLICY, VIEW_POLICY, WAREHOUSE_PARENT_PARAMS
} from "./inventorySchemas.js";

const IDEMPOTENT = Object.freeze({ enabled: true });

function actor(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

function command(req) {
  const { password: _password, ...body } = req.input.body;
  return { ...actor(req), requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || "", ...body };
}

class BinHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryMasterService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }
}

export class ListBinsHandler extends BinHandler {
  static handlerName = "listInventoryBins";
  static api = { method: "GET", path: "/api/v1/inventory/warehouses/:warehouseId/bins", description: "分頁搜尋指定倉庫的庫位。", authorizationPolicies: VIEW_POLICY, requestSchema: { params: WAREHOUSE_PARENT_PARAMS, query: BIN_LIST_QUERY }, responseSchema: { 200: BIN_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.inventory.listBins({ warehouseId: req.input.params.warehouseId, ...req.input.query })); }
}

export class GetBinHandler extends BinHandler {
  static handlerName = "getInventoryBin";
  static api = { method: "GET", path: "/api/v1/inventory/warehouses/:warehouseId/bins/:binId", description: "取得 owner-safe 庫位詳情、目前鎖定及阻擋狀態。", authorizationPolicies: VIEW_POLICY, requestSchema: { params: BIN_ID_PARAMS, query: EMPTY }, responseSchema: { 200: BIN_DETAIL } };
  async execute(req) { return this.response(await this.inventory.getBin(req.input.params.warehouseId, req.input.params.binId)); }
}

export class CreateBinHandler extends BinHandler {
  static handlerName = "createInventoryBin";
  static api = { method: "POST", path: "/api/v1/inventory/warehouses/:warehouseId/bins/create", description: "在啟用中的倉庫建立庫位。", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: WAREHOUSE_PARENT_PARAMS, query: EMPTY, body: BIN_CREATE }, responseSchema: { 201: BIN_RESPONSE } };
  async execute(req) { return this.response(await this.inventory.createBin({ ...command(req), warehouseId: req.input.params.warehouseId }), { statusCode: 201 }); }
}

export class UpdateBinHandler extends BinHandler {
  static handlerName = "updateInventoryBin";
  static api = { method: "POST", path: "/api/v1/inventory/warehouses/:warehouseId/bins/:binId/update", description: "以版本檢查更新指定倉庫的庫位。", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: BIN_ID_PARAMS, query: EMPTY, body: BIN_UPDATE }, responseSchema: { 200: BIN_RESPONSE } };
  async execute(req) { return this.response(await this.inventory.updateBin({ ...command(req), warehouseId: req.input.params.warehouseId, binId: req.input.params.binId })); }
}

function lifecycleApi(path, authType, description, response = BIN_RESPONSE) {
  return { method: "POST", path, description, authType, authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: BIN_ID_PARAMS, query: EMPTY, body: LIFECYCLE }, responseSchema: { 200: response } };
}

export class DeactivateBinHandler extends BinHandler {
  static handlerName = "deactivateInventoryBin";
  static api = lifecycleApi("/api/v1/inventory/warehouses/:warehouseId/bins/:binId/deactivate", "jwt-password", "停用沒有目前庫存阻擋的庫位。");
  async execute(req) { return this.response(await this.inventory.deactivateBin({ ...command(req), warehouseId: req.input.params.warehouseId, binId: req.input.params.binId })); }
}

export class ReactivateBinHandler extends BinHandler {
  static handlerName = "reactivateInventoryBin";
  static api = lifecycleApi("/api/v1/inventory/warehouses/:warehouseId/bins/:binId/reactivate", "jwt-password", "在啟用中的倉庫重新啟用庫位。");
  async execute(req) { return this.response(await this.inventory.reactivateBin({ ...command(req), warehouseId: req.input.params.warehouseId, binId: req.input.params.binId })); }
}

export class DeleteBinHandler extends BinHandler {
  static handlerName = "deleteInventoryBin";
  static api = lifecycleApi("/api/v1/inventory/warehouses/:warehouseId/bins/:binId/delete", "jwt-device-password", "永久刪除從未使用的庫位。", BIN_DELETE_RESPONSE);
  async execute(req) { return this.response(await this.inventory.deleteBin({ ...command(req), warehouseId: req.input.params.warehouseId, binId: req.input.params.binId })); }
}
