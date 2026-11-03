import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ShipmentService } from "../../modules/fulfillment/ShipmentService.js";
import { normalizeShipmentCancel } from "../../modules/fulfillment/shipmentDraftCommand.js";
import { SHIPMENT_EMPTY,SHIPMENT_ID_PARAMS,SHIPMENT_DRAFT_RESPONSE } from "./shipmentDraftSchemas.js";
export class CancelShipmentHandler extends BaseRequestHandler {
 static handlerName="cancelShipment";
 static api={method:"POST",path:"/api/v1/shipments/:id/cancel",description:"cancel Shipment Draft",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],idempotency:{enabled:true},requestSchema:{params:SHIPMENT_ID_PARAMS,query:SHIPMENT_EMPTY,body:{}},responseSchema:{200:SHIPMENT_DRAFT_RESPONSE}};
 constructor(services={}){super(services);this.shipments=new ShipmentService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 authorizeRequest(){return this.shipments.authorizeWrite();}
 async execute(req){return this.response(await this.shipments.cancelDraft(String(req.input.params.id),normalizeShipmentCancel(req.input.body)));}
}
