import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ShipmentShippingLookupService } from "../../modules/fulfillment/ShipmentShippingLookupService.js";
import { SHIPPING_LOOKUP_PARAMS,SHIPPING_LOOKUP_QUERY,SHIPPING_LOOKUP_EMPTY,SHIPPING_CONTACT_RESPONSE } from "./shippingLookupSchemas.js";
export class ListShippingContactsHandler extends BaseRequestHandler {
 static handlerName="listFulfillmentShippingContacts";
 static api={method:"GET",path:"/api/v1/fulfillment-lookups/customers/:customerId/shipping-contacts",description:"Read parent-owned active shipping contacts",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],requestSchema:{params:SHIPPING_LOOKUP_PARAMS,query:SHIPPING_LOOKUP_QUERY,body:SHIPPING_LOOKUP_EMPTY},responseSchema:{200:SHIPPING_CONTACT_RESPONSE}};
 constructor(services={}){super(services);this.lookups=new ShipmentShippingLookupService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req){return this.response(await this.lookups.list(String(req.input.params.customerId),String(req.input.query.fulfillmentId),"contacts"));}
}
