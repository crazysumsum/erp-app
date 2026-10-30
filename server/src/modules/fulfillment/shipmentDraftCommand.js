import { fulfillmentError } from "./fulfillmentErrors.js";
import { normalizeShipmentWeight } from "./shipmentWeight.js";

const invalid=()=>{throw fulfillmentError("FULFILLMENT_INPUT_INVALID");};
const positive=value=>Number.isSafeInteger(value)&&value>0;
const version=value=>positive(value)&&value<=4294967295;
const exact=(input,required,optional=[])=>input&&Object.getPrototypeOf(input)===Object.prototype&&Object.getOwnPropertySymbols(input).length===0&&required.every(key=>Object.hasOwn(input,key))&&Object.keys(input).every(key=>required.includes(key)||optional.includes(key));
const event=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
function text(value,maximum){if(typeof value!=="string"||value.length>maximum)invalid();return value;}

export function normalizeShipmentDraft(input,{update=false}={}) {
 const required=["eventId","shippingAddressId","shippingAddressVersion",...(update?["version"]:[])];
 if(!exact(input,required,["shippingContactId","shippingContactVersion","carrierName","trackingNumber","packageCount","totalWeight","weightUom","notes"])||!event(input.eventId)||!positive(input.shippingAddressId)||!version(input.shippingAddressVersion)||update&&!version(input.version))invalid();
 const contact=input.shippingContactId??null,contactVersion=input.shippingContactVersion??null;
 if(contact===null?contactVersion!==null:!positive(contact)||!version(contactVersion))invalid();
 const packageCount=input.packageCount??null;if(packageCount!==null&&!version(packageCount))invalid();
 return Object.freeze({eventId:input.eventId,...(update?{version:input.version}:{}),shippingAddressId:input.shippingAddressId,shippingAddressVersion:input.shippingAddressVersion,shippingContactId:contact,shippingContactVersion:contactVersion,carrierName:text(input.carrierName===undefined?"":input.carrierName,190),trackingNumber:text(input.trackingNumber===undefined?"":input.trackingNumber,190),packageCount,...normalizeShipmentWeight(input.totalWeight===undefined?null:input.totalWeight,input.weightUom===undefined?"":input.weightUom),notes:text(input.notes===undefined?"":input.notes,2000)});
}
export function normalizeShipmentCancel(input) {
 if(!exact(input,["eventId","version"],["reason"])||!event(input.eventId)||!version(input.version))invalid();
 return Object.freeze({eventId:input.eventId,version:input.version,reason:text(input.reason===undefined?"":input.reason,500)});
}
