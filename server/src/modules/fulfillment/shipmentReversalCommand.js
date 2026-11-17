import { fulfillmentError } from "./fulfillmentErrors.js";

const fields=["eventId","version","reason","goodsUnderCompanyControl","goodsReturnedToOriginalBins"];
const invalid=()=>{throw fulfillmentError("FULFILLMENT_INPUT_INVALID");};
export function normalizeShipmentReversal(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.getOwnPropertySymbols(input).length||Object.keys(input).length!==fields.length||fields.some(key=>!Object.hasOwn(input,key)))invalid();
 if(typeof input.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input.eventId)||!Number.isSafeInteger(input.version)||input.version<1||input.version>4294967295||typeof input.reason!=="string"||input.goodsUnderCompanyControl!==true||input.goodsReturnedToOriginalBins!==true)invalid();
 const reason=input.reason.trim(),length=[...reason].length;if(length<5||length>500||/[\uD800-\uDFFF]/u.test(reason))invalid();
 return Object.freeze({eventId:input.eventId,version:input.version,reason,goodsUnderCompanyControl:true,goodsReturnedToOriginalBins:true});
}
