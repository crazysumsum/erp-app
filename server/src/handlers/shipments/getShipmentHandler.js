import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ShipmentService } from "../../modules/fulfillment/ShipmentService.js";
import { SHIPMENT_EMPTY,SHIPMENT_ID_PARAMS,SHIPMENT_DETAIL_RESPONSE } from "./shipmentDraftSchemas.js";
export class GetShipmentHandler extends BaseRequestHandler {
 static handlerName="getShipment";
 static api={method:"GET",path:"/api/v1/shipments/:id",description:"Read Shipment detail",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.view"]}}],requestSchema:{params:SHIPMENT_ID_PARAMS,query:SHIPMENT_EMPTY,body:SHIPMENT_EMPTY},responseSchema:{200:SHIPMENT_DETAIL_RESPONSE}};
 constructor(services={}){super(services);this.shipments=new ShipmentService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req){return this.response({shipment:await this.shipments.detail(String(req.input.params.id))});}
}
