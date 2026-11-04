import { assertActorFresh } from "../authorization/directoryLookups.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

const conflict=()=>{throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");};

// Advisory local rows only; terminal replay, original SHIP proof and locked eligibility belong to the caller.
export async function readShipmentReversalSnapshot(database,shipmentId){
 fulfillmentInteger(shipmentId);
 if(database.context?.get()?.databaseTransaction)throw new TypeError("Independent Shipment reversal read transaction required");
 return database.withTransaction(async tx=>{
  if(database.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="REPEATABLE READ")throw new TypeError("Current consistent Shipment reversal read required");
  const claims=database.context.get()?.auth?.claims;
  if(typeof claims?.sub!=="string"||!/^[1-9][0-9]*$/u.test(claims.sub)||!Number.isSafeInteger(Number(claims.sub)))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");
  const actor=await assertActorFresh(tx,{actorId:Number(claims.sub),claimedRoles:claims.roles,claimedPermissions:claims.permissions});
  if(!actor.username||!["fulfillment.view","fulfillment.reverse"].every(permission=>actor.permissions.includes(permission)))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");

  const [[shipment]]=await tx.query("SELECT id,fulfillment_id,sales_order_id,customer_id,warehouse_id,line_count,confirmation_event_id FROM shipments WHERE id=?",[shipmentId]);
  if(!shipment)throw fulfillmentError("SHIPMENT_NOT_FOUND");
  const [[root]]=await tx.query("SELECT id,sales_order_id,customer_id,warehouse_id,active_shipment_id,line_count FROM fulfillments WHERE id=?",[shipment.fulfillment_id]);
  if(!root||String(root.id)!==String(shipment.fulfillment_id)||["sales_order_id","customer_id","warehouse_id"].some(field=>String(root[field])!==String(shipment[field])))conflict();
  const [lines]=await tx.query("SELECT id,fulfillment_id,sales_order_id,sales_order_line_id,sku_id,base_uom_id,shipped_base_quantity,reversed_base_quantity FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY id LIMIT 101",[root.id]);
  const [shipmentLines]=await tx.query("SELECT id,shipment_id,fulfillment_id,fulfillment_line_id,sales_order_line_id,sku_id,base_uom_id,shipped_base_quantity,reversed_base_quantity FROM shipment_lines WHERE shipment_id=? ORDER BY id LIMIT 101",[shipmentId]);
  if(!lines.length||lines.length>100||shipmentLines.length>100||lines.length!==Number(root.line_count)||shipmentLines.length!==Number(shipment.line_count)||lines.length!==shipmentLines.length)conflict();
  const [sourceClaims]=await tx.query("SELECT id,fulfillment_id,fulfillment_line_id,sales_order_line_reservation_id,inventory_reservation_id,consumed_quantity,active_claimed_quantity,reversed_quantity,status,inventory_version FROM fulfillment_line_reservation_claims WHERE fulfillment_id=? ORDER BY id LIMIT 5001",[root.id]);
  const [allocations]=await tx.query("SELECT id,fulfillment_id,fulfillment_line_id,claim_id,inventory_reservation_id,inventory_allocation_id,inventory_balance_id,warehouse_id,bin_id,lot_id,stock_status_snapshot,picked_base_quantity,status,balance_version FROM fulfillment_allocations WHERE fulfillment_id=? AND picked_base_quantity>0 ORDER BY id LIMIT 5001",[root.id]);
  // Movement/member IDs are immutable references owned by these Issue rows, not an Inventory outcome read.
  const [issues]=await tx.query("SELECT *,DATE_FORMAT(expiry_date_snapshot,'%Y-%m-%d') AS expiry_date_snapshot FROM shipment_issue_details WHERE shipment_id=? ORDER BY shipment_line_id,id LIMIT 5001",[shipmentId]);
  if(sourceClaims.length>5000||allocations.length>5000||issues.length>5000)conflict();
  return {root,shipment,lines,shipmentLines,claims:sourceClaims,allocations,issues};
 },{isolationLevel:"REPEATABLE READ"});
}
