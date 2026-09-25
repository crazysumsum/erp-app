import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryMasterService } from "../../modules/inventory/InventoryMasterService.js";
import {
  EMPTY, LIFECYCLE, MGMT_POLICY, VIEW_POLICY, WAREHOUSE_CREATE, WAREHOUSE_DELETE_RESPONSE,
  WAREHOUSE_DETAIL, WAREHOUSE_ID_PARAMS, WAREHOUSE_LIST_QUERY, WAREHOUSE_LIST_RESPONSE,
  WAREHOUSE_RESPONSE, WAREHOUSE_UPDATE
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

class WarehouseHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryMasterService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }
}

export class ListWarehousesHandler extends WarehouseHandler {
  static handlerName = "listInventoryWarehouses";
  static api = { method: "GET", path: "/api/v1/inventory/warehouses", description: "分頁搜尋倉庫主資料。", authorizationPolicies: VIEW_POLICY, requestSchema: { params: EMPTY, query: WAREHOUSE_LIST_QUERY }, responseSchema: { 200: WAREHOUSE_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.inventory.listWarehouses(req.input.query)); }
}

export class GetWarehouseHandler extends WarehouseHandler {
  static handlerName = "getInventoryWarehouse";
  static api = { method: "GET", path: "/api/v1/inventory/warehouses/:id", description: "取得倉庫詳情、庫位摘要及目前阻擋狀態。", authorizationPolicies: VIEW_POLICY, requestSchema: { params: WAREHOUSE_ID_PARAMS, query: EMPTY }, responseSchema: { 200: WAREHOUSE_DETAIL } };
  async execute(req) { return this.response(await this.inventory.getWarehouse(req.input.params.id)); }
}

export class CreateWarehouseHandler extends WarehouseHandler {
  static handlerName = "createInventoryWarehouse";
  static api = { method: "POST", path: "/api/v1/inventory/warehouses/create", description: "建立啟用中的倉庫。", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: EMPTY, query: EMPTY, body: WAREHOUSE_CREATE }, responseSchema: { 201: WAREHOUSE_RESPONSE } };
  async execute(req) { return this.response(await this.inventory.createWarehouse(command(req)), { statusCode: 201 }); }
}

export class UpdateWarehouseHandler extends WarehouseHandler {
  static handlerName = "updateInventoryWarehouse";
  static api = { method: "POST", path: "/api/v1/inventory/warehouses/:id/update", description: "以版本檢查更新倉庫主資料。", authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: WAREHOUSE_ID_PARAMS, query: EMPTY, body: WAREHOUSE_UPDATE }, responseSchema: { 200: WAREHOUSE_RESPONSE } };
  async execute(req) { return this.response(await this.inventory.updateWarehouse({ ...command(req), warehouseId: req.input.params.id })); }
}

function lifecycleApi(path, authType, description, response = WAREHOUSE_RESPONSE) {
  return { method: "POST", path, description, authType, authorizationPolicies: MGMT_POLICY, idempotency: IDEMPOTENT, requestSchema: { params: WAREHOUSE_ID_PARAMS, query: EMPTY, body: LIFECYCLE }, responseSchema: { 200: response } };
}

export class DeactivateWarehouseHandler extends WarehouseHandler {
  static handlerName = "deactivateInventoryWarehouse";
  static api = lifecycleApi("/api/v1/inventory/warehouses/:id/deactivate", "jwt-password", "停用沒有目前庫存阻擋的倉庫。");
  async execute(req) { return this.response(await this.inventory.deactivateWarehouse({ ...command(req), warehouseId: req.input.params.id })); }
}

export class ReactivateWarehouseHandler extends WarehouseHandler {
  static handlerName = "reactivateInventoryWarehouse";
  static api = lifecycleApi("/api/v1/inventory/warehouses/:id/reactivate", "jwt-password", "重新啟用倉庫而不自動恢復庫位。");
  async execute(req) { return this.response(await this.inventory.reactivateWarehouse({ ...command(req), warehouseId: req.input.params.id })); }
}

export class DeleteWarehouseHandler extends WarehouseHandler {
  static handlerName = "deleteInventoryWarehouse";
  static api = lifecycleApi("/api/v1/inventory/warehouses/:id/delete", "jwt-device-password", "永久刪除從未使用且沒有庫位的倉庫。", WAREHOUSE_DELETE_RESPONSE);
  async execute(req) { return this.response(await this.inventory.deleteWarehouse({ ...command(req), warehouseId: req.input.params.id })); }
}
