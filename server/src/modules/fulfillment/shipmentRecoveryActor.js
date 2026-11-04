import { loadRoleNamesForUser,loadPermissionNamesForUser } from "../authorization/directoryLookups.js";
import { assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { freezeShipmentIntent } from "./shipmentConfirmationScope.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

// Directory failures and a missing original identity never attest revocation.
export async function readShipmentRecoveryActor(database,tx,actorId){
 assertFulfillmentTransaction(database,tx);fulfillmentInteger(actorId);
 const [[user]]=await tx.query("SELECT id,username,status FROM users WHERE id=?",[actorId]);
 if(!user||String(user.id)!==actorId||typeof user.username!=="string"||!user.username||!["active","disabled"].includes(user.status))throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
 const roles=await loadRoleNamesForUser(tx,Number(actorId)),permissions=await loadPermissionNamesForUser(tx,Number(actorId));
 return freezeShipmentIntent({actor:{id:Number(actorId),username:user.username,roles,permissions},eligible:user.status==="active"&&["fulfillment.view","fulfillment.operation"].every(permission=>permissions.includes(permission))});
}
