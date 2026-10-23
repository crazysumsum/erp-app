import {getActiveTransactionIsolation} from "../../services/mysqldatabase/MySqlDatabaseService.js";

function integer(value,positive=true){
 if(typeof value!=="string"||value.length>16||!/^(0|[1-9][0-9]*)$/u.test(value)||BigInt(value)>9007199254740991n||positive&&value==="0")throw new TypeError("Invalid Sales Archive operation scope");
 return value;
}
// Internal fixed coordinator support only. Locks neither certify a fresh read view nor grant Archive authority.
export class SalesArchiveLockService{
 constructor({database}){this.database=database;}
 async lockOrderOperationsInTransaction(tx,scope){
  if(this.database.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="REPEATABLE READ")throw new TypeError("Actual Sales Archive RR transaction required");
  if(!scope||![Object.prototype,null].includes(Object.getPrototypeOf(scope))||Reflect.ownKeys(scope).sort().join(",")!=="orderId,shipmentIds"||!Array.isArray(scope.shipmentIds))throw new TypeError("Invalid Sales Archive operation scope");
  const orderId=integer(scope.orderId),shipmentIds=scope.shipmentIds.map(id=>integer(id));
  if(shipmentIds.some((id,i)=>i>0&&BigInt(id)<=BigInt(shipmentIds[i-1])))throw new TypeError("Invalid Sales Archive Shipment order");
  let operationCount=0,hasInProgress=false;
  // FULFILLMENT_SOURCE targets Shipment IDs, not the SO stored in its result_id.
  // All callers use this same table/prefix order before any domain root locks.
  for(const [type,target]of [...shipmentIds.map(id=>["FULFILLMENT_SOURCE",id]),["SALES_ORDER",orderId]]){
   let created="0",after="0";
   for(;;){
    const [rows]=await tx.query("SELECT id,created_at,status,target_type,target_id FROM sales_operation_requests FORCE INDEX (idx_sales_operations_target) WHERE target_type=? AND target_id=? AND (created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT 500 FOR UPDATE",[type,target,created,created,after]);
    for(const row of rows){
     const id=integer(String(row.id)),stamp=integer(String(row.created_at),false);
     if(row.target_type!==type||String(row.target_id)!==target||!["FAILED","IN_PROGRESS","SUCCEEDED"].includes(row.status)||BigInt(stamp)<BigInt(created)||stamp===created&&BigInt(id)<=BigInt(after))throw new TypeError("Inconsistent Sales Archive operation prefix");
     created=stamp;after=id;operationCount++;hasInProgress ||=row.status==="IN_PROGRESS";
     if(!Number.isSafeInteger(operationCount))throw new TypeError("Sales Archive operation count overflow");
    }
    if(rows.length<500)break;
   }
  }
  return {operationCount,hasInProgress};
 }
}
