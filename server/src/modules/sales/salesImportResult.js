import {Readable} from "node:stream";
import {stringify} from "csv-stringify/sync";
import {safeSalesCsvCell} from "./salesCsv.js";
import {salesError} from "./salesErrors.js";
export const SALES_IMPORT_RESULT_COLUMNS=Object.freeze(["sourceOrderKey","channelCode","externalOrderId","status","salesOrderNumber","errorCode","errorField","errorMessage"]);
// Keyset pages cap memory even when every source has200 diagnostics; only retained safe facts are exported.
export function createSalesImportResultStream({database,id,signal}){
 if(!Number.isSafeInteger(id)||id<1)throw new TypeError("Invalid Import result owner");
 async function* csv(){
  yield "\uFEFF"+stringify([SALES_IMPORT_RESULT_COLUMNS],{record_delimiter:"\r\n"});let orderId=0,errorId=0;
  for(;;){
   signal?.throwIfAborted();const [rows]=await database.query(`SELECT i.id,COALESCE(e.id,0) AS error_id,i.source_order_key,i.channel_code,i.external_order_id,i.status,i.sales_order_number,
    COALESCE(e.error_code,i.result_code) AS error_code,COALESCE(e.field_path,'') AS error_field,COALESCE(e.safe_message,'') AS error_message
    FROM sales_intake_orders i LEFT JOIN sales_intake_errors e ON e.intake_order_id=i.id WHERE i.import_job_id=?
    AND (i.id>? OR (i.id=? AND COALESCE(e.id,0)>?)) ORDER BY i.id,COALESCE(e.id,0) LIMIT 100`,[id,orderId,orderId,errorId]);
   if(!rows.length)return;
   for(const row of rows){signal?.throwIfAborted();if(!["INVALID","DUPLICATE","SUCCEEDED","FAILED"].includes(row.status)||!Number.isSafeInteger(Number(row.id))||Number(row.id)<1||!Number.isSafeInteger(Number(row.error_id))||Number(row.error_id)<0)throw salesError("SALES_STATE_CONFLICT");yield stringify([[row.source_order_key,row.channel_code,row.external_order_id,row.status,row.sales_order_number,row.error_code,row.error_field,row.error_message].map(safeSalesCsvCell)],{record_delimiter:"\r\n"});}
   const last=rows.at(-1);orderId=Number(last.id);errorId=Number(last.error_id);
  }
 }
 return Readable.from(csv());
}
