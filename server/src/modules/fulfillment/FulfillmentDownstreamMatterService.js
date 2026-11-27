import { assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

export const SHIPMENT_DOWNSTREAM_PROVIDERS_VERSION="SHIPMENT_DOWNSTREAM_PROVIDERS_V1";

const unavailable=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
export function assertNoRequiredShipmentDownstream(registry){
 if(!registry||Object.getPrototypeOf(registry)!==Object.prototype||Object.keys(registry).sort().join(",")!=="invoicing,returns,version"||registry.version!=="NO_DOWNSTREAM_MODULES_V1")unavailable();
 // Only an explicit deployment declaration closes the currently uninstalled owners.
 // A required owner stays UNKNOWN until its formal transaction-aware provider exists.
 if(registry.returns!=="NO_PROVIDER_REQUIRED"||registry.invoicing!=="NO_PROVIDER_REQUIRED")unavailable();
 return Object.freeze({status:"CLOSED",registryVersion:registry.version});
}
function readCount(rows,shipmentId,key){
 if(!Array.isArray(rows)||rows.length!==1)unavailable();
 const [row]=rows;
 if(!row||row.shipmentId!==shipmentId||!Number.isSafeInteger(row[key])||row[key]<0)unavailable();
 return row[key];
}
export class FulfillmentDownstreamMatterService {
 #registry;
 #invoicing;
 #returns;
 constructor({database,registry,providers}){
  this.database=database;this.#registry=registry===undefined?null:Object.freeze({...registry});
  if(providers===undefined)return;
  const {invoicing,returns}=providers??{};
  if(registry!==undefined||typeof invoicing?.findShipmentInvoiceClaimsInTransaction!=="function"||
     typeof returns?.findShipmentReturnsInTransaction!=="function")throw new TypeError("Shipment Reversal requires both downstream providers");
  this.#invoicing=invoicing.findShipmentInvoiceClaimsInTransaction.bind(invoicing);
  this.#returns=returns.findShipmentReturnsInTransaction.bind(returns);
 }
 async assertShipmentReversibleInTransaction(tx,command){
  assertFulfillmentTransaction(this.database,tx);
  if(!command||Object.getPrototypeOf(command)!==Object.prototype||Object.keys(command).join(",")!=="shipmentId")throw new TypeError("Fixed Shipment downstream purpose required");
  fulfillmentInteger(command.shipmentId);
  if(!this.#invoicing)return assertNoRequiredShipmentDownstream(this.#registry);
  const {shipmentId}=command,scope=Object.freeze({shipmentIds:Object.freeze([shipmentId])});
  let invoices,returns;
  try{
   invoices=await this.#invoicing(tx,scope);
   returns=await this.#returns(tx,scope);
  }catch{unavailable();}
  const invoiceCount=readCount(invoices,shipmentId,"activeInvoiceLineCount");
  const returnCount=readCount(returns,shipmentId,"openReturnCount");
  if(invoiceCount||returnCount)throw fulfillmentError("DOWNSTREAM_MATTER_BLOCKS_REVERSAL");
  return Object.freeze({status:"CLOSED",registryVersion:SHIPMENT_DOWNSTREAM_PROVIDERS_VERSION});
 }
}
