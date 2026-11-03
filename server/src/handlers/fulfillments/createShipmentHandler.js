import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ShipmentService } from "../../modules/fulfillment/ShipmentService.js";
import { normalizeShipmentDraft } from "../../modules/fulfillment/shipmentDraftCommand.js";
import { SHIPMENT_EMPTY,SHIPMENT_ID_PARAMS,SHIPMENT_DRAFT_RESPONSE } from "../shipments/shipmentDraftSchemas.js";
export class CreateShipmentHandler extends BaseRequestHandler {
 static handlerName="createShipment";
 static api={method:"POST",path:"/api/v1/fulfillments/:id/shipments/create",description:"Create Shipment Draft from picked Fulfillment",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],idempotency:{enabled:true},requestSchema:{params:SHIPMENT_ID_PARAMS,query:SHIPMENT_EMPTY,body:{}},responseSchema:{201:SHIPMENT_DRAFT_RESPONSE}};
 constructor(services={}){super(services);this.shipments=new ShipmentService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 authorizeRequest(){return this.shipments.authorizeWrite();}
 async execute(req){return this.response(await this.shipments.createDraft(String(req.input.params.id),normalizeShipmentDraft(req.input.body)),{statusCode:201});}
}
