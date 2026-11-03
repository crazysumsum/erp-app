import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ShipmentInquiryService } from "../../modules/fulfillment/ShipmentInquiryService.js";
import { SHIPMENT_EMPTY,SHIPMENT_ID_PARAMS } from "./shipmentDraftSchemas.js";
import { SHIPMENT_DELIVERY_NOTE_RESPONSE } from "./shipmentInquirySchemas.js";
export class GetShipmentDeliveryNoteHandler extends BaseRequestHandler {
 static handlerName="getShipmentDeliveryNote";
 static api={method:"GET",path:"/api/v1/shipments/:id/delivery-note",description:"Read immutable Delivery Note and Packing List data and record a technical print audit",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.view"]}}],requestSchema:{params:SHIPMENT_ID_PARAMS,query:SHIPMENT_EMPTY,body:SHIPMENT_EMPTY},responseSchema:{200:SHIPMENT_DELIVERY_NOTE_RESPONSE}};
 constructor(services={}){super(services);this.inquiry=new ShipmentInquiryService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req,res){const result=await this.inquiry.deliveryNote(String(req.input.params.id));res.setHeader("Cache-Control","private, no-store");res.setHeader("Pragma","no-cache");return this.response(result);}
}
