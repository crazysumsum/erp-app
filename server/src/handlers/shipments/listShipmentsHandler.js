import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ShipmentInquiryService } from "../../modules/fulfillment/ShipmentInquiryService.js";
import { SHIPMENT_EMPTY } from "./shipmentDraftSchemas.js";
import { SHIPMENT_LIST_RESPONSE } from "./shipmentInquirySchemas.js";
export class ListShipmentsHandler extends BaseRequestHandler {
 static handlerName="listShipments";
 static api={method:"GET",path:"/api/v1/shipments",description:"List Shipment work and confirmed history",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.view"]}}],requestSchema:{params:SHIPMENT_EMPTY,query:{},body:SHIPMENT_EMPTY},responseSchema:{200:SHIPMENT_LIST_RESPONSE}};
 constructor(services={}){super(services);this.inquiry=new ShipmentInquiryService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req){return this.response(await this.inquiry.list(req.input.query));}
}
