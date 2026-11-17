import { assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

const unavailable=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
export function assertNoRequiredShipmentDownstream(registry){
 if(!registry||Object.getPrototypeOf(registry)!==Object.prototype||Object.keys(registry).sort().join(",")!=="invoicing,returns,version"||registry.version!=="NO_DOWNSTREAM_MODULES_V1")unavailable();
 // Only an explicit deployment declaration closes the currently uninstalled owners.
 // A required owner stays UNKNOWN until its formal transaction-aware provider exists.
 if(registry.returns!=="NO_PROVIDER_REQUIRED"||registry.invoicing!=="NO_PROVIDER_REQUIRED")unavailable();
 return Object.freeze({status:"CLOSED",registryVersion:registry.version});
}
export class FulfillmentDownstreamMatterService {
 #registry;
 constructor({database,registry}){this.database=database;this.#registry=registry===undefined?null:Object.freeze({...registry});}
 async assertShipmentReversibleInTransaction(tx,command){
  assertFulfillmentTransaction(this.database,tx);
  if(!command||Object.getPrototypeOf(command)!==Object.prototype||Object.keys(command).join(",")!=="shipmentId")throw new TypeError("Fixed Shipment downstream purpose required");
  fulfillmentInteger(command.shipmentId);
  return assertNoRequiredShipmentDownstream(this.#registry);
 }
}
