import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SHIPMENT_EMPTY,SHIPMENT_ID_PARAMS } from "./shipmentDraftSchemas.js";
import { SHIPMENT_CONFIRM_BODY,SHIPMENT_CONFIRM_RESPONSE,SHIPMENT_CONFIRM_PENDING } from "./shipmentConfirmationSchemas.js";
export class ConfirmShipmentHandler extends BaseRequestHandler {
 static handlerName="confirmShipment";
 static api={method:"POST",path:"/api/v1/shipments/:id/confirm",description:"Confirm Shipment with original-event recovery",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],idempotency:{enabled:true,retryAfterSeconds:2},requestSchema:{params:SHIPMENT_ID_PARAMS,query:SHIPMENT_EMPTY,body:SHIPMENT_CONFIRM_BODY},responseSchema:{200:SHIPMENT_CONFIRM_RESPONSE,202:SHIPMENT_CONFIRM_PENDING}};
 constructor(services={}){super(services);this.confirmation=services.require("fulfillment.shipmentConfirmation");}
 authorizeRequest(){return this.confirmation.authorizeRequest();}
 async execute(req,res){const result=await this.confirmation.confirm(String(req.input.params.id),req.input.body);if(result.statusCode===202)res.setHeader("Retry-After","2");return this.response(result.data,{statusCode:result.statusCode});}
}
