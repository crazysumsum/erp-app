import {readFulfillmentArchiveState} from "./fulfillmentArchiveState.js";
import {FULFILLMENT_ARCHIVE_CONTRACTS} from "./fulfillmentArchiveSchema.js";
import {getActiveTransactionIsolation} from "../../services/mysqldatabase/MySqlDatabaseService.js";
const batchSize=500;
function identity(value){if(typeof value!=="string"||value.length>16||!/^[1-9][0-9]*$/u.test(value)||BigInt(value)>9007199254740991n)throw new TypeError("Invalid Archive order identity");return value;}
async function members(executor,orderId){
 const result={orderId,fulfillmentIds:[],shipments:[]};
 for(const [table,index,columns]of [["fulfillments","idx_ful_order","id"],["shipments","idx_shipment_order","id,fulfillment_id"]]){
  let after="0";
  for(;;){
   const [rows]=await executor.query(`SELECT ${columns} FROM ${table} FORCE INDEX (${index}) WHERE sales_order_id=? AND id>? ORDER BY id LIMIT 500`,[orderId,after]);
   for(const row of rows){const id=identity(String(row.id));if(BigInt(id)<=BigInt(after))throw new TypeError("Invalid Archive membership order");after=id;if(table==="fulfillments")result.fulfillmentIds.push(id);else result.shipments.push({id,fulfillmentId:identity(String(row.fulfillment_id))});}
   if(rows.length<batchSize)break;
  }
 }
 if(result.shipments.some(row=>!result.fulfillmentIds.includes(row.fulfillmentId)))throw new TypeError("Inconsistent Archive owner membership");
 return result;
}
// Internal fixed-coordinator support only: hints and locks grant no Archive authority or CLOSED result.
// The real job runtime owns the fresh RR entry, complete writer protocol and private participant capability.
export class FulfillmentArchiveLockService{
 constructor({database}){this.database=database;}
 #transaction(tx){if(this.database.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="REPEATABLE READ")throw new TypeError("Actual Archive RR transaction required");}
 discoverOrder(orderId){
  const active=this.database.context?.get()?.databaseTransaction;
  if(active!==null&&active!==undefined)throw new TypeError("Archive discovery must precede the mutation transaction");
  return members(this.database,identity(orderId));
 }
 readOrderMembershipInTransaction(tx,orderId){this.#transaction(tx);return members(tx,identity(orderId));}
 async readOrderMirrorMetadataInTransaction(tx,orderId){
  this.#transaction(tx);orderId=identity(orderId);
  const active=await readFulfillmentArchiveState(tx,orderId),mirrors=await readFulfillmentArchiveState(tx,orderId,{archived:true,sourceIdentities:active});
  return FULFILLMENT_ARCHIVE_CONTRACTS.flatMap(({table})=>mirrors[table].map(row=>({archiveBatchId:String(row.archive_batch_id),archivedAtMs:Number(row.archived_at)})));
 }
 async lockOrderOperationsInTransaction(tx,orderId){
  this.#transaction(tx);orderId=identity(orderId);
  const operationIds=[];let after="0",hasInProgress=false;
  for(;;){
   // Every page, including an empty prefix/tail, is a current locking read before any domain lock.
   const [rows]=await tx.query(`SELECT id,status,target_type,target_id,sales_order_id FROM fulfillment_operation_requests FORCE INDEX (idx_ful_operation_archive_order) WHERE sales_order_id=? AND id>? ORDER BY id LIMIT 500 FOR UPDATE`,[orderId,after]);
   for(const row of rows){
    const id=identity(String(row.id));
    if(String(row.sales_order_id)!==orderId||!["FULFILLMENT","SHIPMENT"].includes(row.target_type)||!["FAILED","IN_PROGRESS","SUCCEEDED"].includes(row.status)||BigInt(id)<=BigInt(after))throw new TypeError("Inconsistent Archive operation range");
    operationIds.push(id);hasInProgress ||=row.status==="IN_PROGRESS";after=id;
   }
   if(rows.length<batchSize)break;
  }
  return {operationIds,hasInProgress};
 }
}
