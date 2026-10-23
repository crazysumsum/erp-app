import { assertActorFresh } from "../authorization/directoryLookups.js";
import { assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
export async function requireFulfillmentActor(database,tx,permission){
  assertFulfillmentTransaction(database,tx);
  if(!["fulfillment.view","fulfillment.operation","fulfillment.reverse"].includes(permission))throw new TypeError("Invalid Fulfillment purpose");
  const claims=database.context.get()?.auth?.claims,id=claims?.sub;
  if(typeof id!=="string"||!/^[1-9][0-9]*$/u.test(id)||BigInt(id)>BigInt(Number.MAX_SAFE_INTEGER))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");
  const actor=await assertActorFresh(tx,{actorId:Number(id),claimedRoles:claims.roles,claimedPermissions:claims.permissions});
  if(!actor.username||!["fulfillment.view",permission].every(p=>actor.permissions.includes(p)))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");
  return actor;
}
