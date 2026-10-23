import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { formatDateForFile } from "../../services/time/timeFormat.js";
const prefixes=Object.freeze({FULFILLMENT:"FUL",SHIPMENT:"SHP",REVERSAL:"REV"});
export class FulfillmentSequenceService {
  constructor({database,time}){this.database=database;this.time=time;this.transactions=new FulfillmentTransactionService({database});}
  // A number is returned only after this short reservation transaction commits. Later business rollback leaves a gap.
  // Durable event replay belongs to FulfillmentOperationService; this allocator is not an event journal.
  async reserveNumber({documentType,nowMs=this.time.nowMs()}){
    if(this.database.context?.get()?.databaseTransaction)throw new TypeError("Number reservation must precede the business transaction");
    if(!Object.hasOwn(prefixes,documentType)||!Number.isSafeInteger(nowMs)||nowMs<0||!this.time.timeZone)throw new TypeError("Invalid Fulfillment sequence request");
    const period=formatDateForFile(new Date(nowMs),this.time.timeZone).slice(0,7).replace("-","");
    if(!/^[0-9]{6}$/u.test(period))throw new TypeError("Invalid Fulfillment sequence period");
    return this.transactions.withTransaction(async tx=>{
      await requireFulfillmentActor(this.database,tx,documentType==="REVERSAL"?"fulfillment.reverse":"fulfillment.operation");
      await tx.execute("INSERT INTO fulfillment_document_sequences(document_type,period_key,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=id",[documentType,period,nowMs]);
      const [[row]]=await tx.query("SELECT next_value,version FROM fulfillment_document_sequences WHERE document_type=? AND period_key=? FOR UPDATE",[documentType,period]);
      const value=BigInt(row.next_value),number=`${prefixes[documentType]}-${period}-${value.toString().padStart(6,"0")}`;
      if(value<1n||value>BigInt(Number.MAX_SAFE_INTEGER)||number.length>24||row.version>=4294967295)throw new TypeError("Fulfillment sequence exhausted");
      const [result]=await tx.execute("UPDATE fulfillment_document_sequences SET next_value=next_value+1,version=version+1,updated_at=GREATEST(updated_at,?) WHERE document_type=? AND period_key=? AND version=?",[nowMs,documentType,period,row.version]);
      if(result.affectedRows!==1)throw new TypeError("Fulfillment sequence changed");
      return number;
    });
  }
}
