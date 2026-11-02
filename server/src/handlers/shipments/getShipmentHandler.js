import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ShipmentInquiryService } from "../../modules/fulfillment/ShipmentInquiryService.js";
import { SHIPMENT_EMPTY,SHIPMENT_ID_PARAMS } from "./shipmentDraftSchemas.js";
import { SHIPMENT_INQUIRY_RESPONSE } from "./shipmentInquirySchemas.js";
export class GetShipmentHandler extends BaseRequestHandler {
 static handlerName="getShipment";
 static api={method:"GET",path:"/api/v1/shipments/:id",description:"Read Shipment detail",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.view"]}}],requestSchema:{params:SHIPMENT_ID_PARAMS,query:{},body:SHIPMENT_EMPTY},responseSchema:{200:SHIPMENT_INQUIRY_RESPONSE}};
 constructor(services={}){super(services);this.inquiry=new ShipmentInquiryService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req){return this.response({shipment:await this.inquiry.detail(String(req.input.params.id),req.input.query)});}
}
