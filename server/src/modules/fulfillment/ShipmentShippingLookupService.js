import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { CustomerLookupService } from "../customer/CustomerLookupService.js";

const unavailable=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
const validId=value=>Number.isSafeInteger(value)&&value>0;
export class ShipmentShippingLookupService {
 constructor({database,time,logger}){Object.assign(this,{database,time,logger});this.transactions=new FulfillmentTransactionService({database});}
 async list(customerId,fulfillmentId,kind){
  try{fulfillmentInteger(customerId);fulfillmentInteger(fulfillmentId);}catch{throw fulfillmentError("FULFILLMENT_INPUT_INVALID");}
  if(!["addresses","contacts"].includes(kind))throw new TypeError("Fixed shipping lookup purpose required");
  return this.transactions.withTransaction(async tx=>{
   await requireFulfillmentActor(this.database,tx,"fulfillment.operation");
   // Customer identity is immutable in the original SO-owned Fulfillment.
   const [[parent]]=await tx.query("SELECT customer_id FROM fulfillments WHERE id=?",[fulfillmentId]);
   if(!parent||String(parent.customer_id)!==customerId)throw fulfillmentError("FULFILLMENT_NOT_FOUND");
   const customer=new CustomerLookupService({database:tx,time:this.time,logger:this.logger});let rows;
   try{rows=await (kind==="addresses"?customer.listAddresses(Number(customerId),{purpose:"shipping",atMs:this.time.nowMs()}):customer.listContacts(Number(customerId),{purpose:"shipping",atMs:this.time.nowMs()}));}catch{unavailable();}
   if(!Array.isArray(rows)||rows.filter(row=>row?.isDefault===true).length>1)unavailable();
   const seen=new Set(),items=rows.map(row=>{
    if(!row||typeof row!=="object")unavailable();
    const id=kind==="addresses"?row.addressId:row.contactId;
    if(!validId(id)||seen.has(id)||row.customerId!==Number(customerId)||row.status!=="active"||!validId(row.version)||row.version>4294967295||typeof row.isDefault!=="boolean")unavailable();seen.add(id);
    const fields=kind==="addresses"?["label","recipientCompanyDepartment","addressLine1","addressLine2","addressLine3","city","stateRegion","postalCode","countryCode","phone"]:["name","email","phone","mobile"];
    if(fields.some(key=>!(key==="countryCode"&&row[key]===null)&&typeof row[key]!=="string"))unavailable();
    return {...Object.fromEntries(fields.map(key=>[key,row[key]])),[kind==="addresses"?"addressId":"contactId"]:String(id),version:row.version,isDefault:row.isDefault};
   });
   return {items};
  });
 }
}
