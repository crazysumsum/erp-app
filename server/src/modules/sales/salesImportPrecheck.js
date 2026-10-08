import {createHash} from "node:crypto";
import {normalizePaymentTermCode} from "../businessMaster/businessMasterRules.js";
import {validateSalesDocument} from "./salesValidation.js";
import {orderedBaseQuantity} from "./salesQuantityMath.js";
import {salesPayloadHash} from "./salesCanonicalHash.js";
import {salesError,SALES_ERROR_STATUS} from "./salesErrors.js";

export const salesSourceHash=value=>createHash("sha256").update(value,"utf8").digest();
export function sourceOrderPayloadHash(group) {
 const {lines,...header}=group.payload;
 return salesPayloadHash({schemaVersion:"1.0",externalOrderId:group.externalOrderId,...header,
  lines:lines.map(({rowNumbers:_rows,...line})=>line)});
}
const pairKey=line=>JSON.stringify([line.skuCode,line.salesUomCode]);
const active=row=>row&&String(row.status).toUpperCase()==="ACTIVE";
const safeError=(rowNo,field,code)=>({rowNo,field,code});

// Diagnostic-only bounded reads. Confirmation revalidates locked owner snapshots before assigning any master.
export async function precheckSalesOrders({tx,groups,customers,items,config,nowMs}) {
 if(!Array.isArray(groups)||!groups.length||groups.length>100)throw salesError("SALES_INPUT_INVALID");
 const [keys]=await tx.query(`SELECT id,channel_code,external_order_id,HEX(external_order_id_hash) AS identity_hash,payload_hash,status,sales_order_id,sales_order_number,is_order_archived
  FROM sales_external_order_keys WHERE ${groups.map(()=>"(channel_code=? AND external_order_id_hash=?)").join(" OR ")}`,groups.flatMap(group=>[group.channelCode,salesSourceHash(group.externalOrderId)]));
 const completed=new Map();
 for(const group of groups){
  const key=keys.find(row=>row.channel_code===group.channelCode&&row.identity_hash?.toLowerCase()===salesSourceHash(group.externalOrderId).toString("hex"));
  if(!key)continue;if(key.external_order_id!==group.externalOrderId)throw salesError("SALES_SOURCE_HASH_COLLISION");
  if(key.status!=="SUCCEEDED")throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  const payloadHash=sourceOrderPayloadHash(group),warnings=key.payload_hash===payloadHash?[]:[{code:"EXTERNAL_ORDER_PAYLOAD_CONFLICT"}];
  completed.set(group,{status:"DUPLICATE",errors:[],warnings,payload:{channelCode:group.channelCode,externalOrderId:group.externalOrderId,warnings},payloadHash,
   duplicate:{externalOrderKeyId:Number(key.id),salesOrderId:Number(key.sales_order_id),salesOrderNumber:key.sales_order_number,isArchived:Boolean(key.is_order_archived)}});
 }
 const candidates=groups.filter(group=>!group.errors.length&&!completed.has(group)),pairs=new Map(),customerIds=new Set();
 for(const group of candidates){customerIds.add(group.payload.customerId);for(const line of group.payload.lines)pairs.set(pairKey(line),{skuCode:line.skuCode,salesUomCode:line.salesUomCode});}
 if(pairs.size>100||customerIds.size>100)throw salesError("SALES_INPUT_INVALID");
 const customerMap=await customers.getSalesPrecheckSnapshotsInTransaction(tx,[...customerIds],{atMs:nowMs}),resolved=await items.resolveSaleCodesInTransaction(tx,[...pairs.values()],{atMs:nowMs});
 if(!(customerMap instanceof Map)||!Array.isArray(resolved)||resolved.length!==pairs.size)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
 const itemMap=new Map(resolved.map(member=>[pairKey(member),member]));
 const codes=field=>[...new Set(candidates.map(group=>group.payload[field]).filter(Boolean))];
 const warehouses=codes("warehouseCode"),currencies=codes("currencyCode"),termKeys=new Map();
 for(const code of codes("paymentTermCode")){try{termKeys.set(code,normalizePaymentTermCode(code).codeKey);}catch(error){if(error.code!=="PAYMENT_TERM_CODE_INVALID")throw error;}}
 const read=async(table,columns,column,values)=>values.length?(await tx.query(`SELECT ${columns} FROM ${table} WHERE ${column} IN (${values.map(()=>"?").join(",")})`,values))[0]:[];
 const warehouseRows=warehouses.length?(await tx.query(warehouses.map(()=>"SELECT ? AS request_index,id,warehouse_code,status FROM inventory_warehouses WHERE warehouse_code=?").join(" UNION ALL "),warehouses.flatMap((code,index)=>[index,code])))[0]:[],currencyRows=await read("currencies","code,status","code",currencies),termRows=await read("payment_terms","id,code_key,status","code_key",[...new Set(termKeys.values())]);
 // Warehouse identifiers use the owner's existing DB collation; bind a request index instead of guessing case folding.
 const warehouseMap=new Map(warehouseRows.map(row=>[warehouses[Number(row.request_index)],row])),currencyMap=new Map(currencyRows.map(row=>[row.code,row])),termMap=new Map(termRows.map(row=>[row.code_key,row]));
 const results=groups.map(group=>{
  if(completed.has(group))return completed.get(group);
  const errors=[...group.errors],p=group.payload,row=group.firstRowNo,add=(field,code)=>errors.push(safeError(row,field,code));
  let document,warnings=[];
  if(!errors.length){
   const customer=customerMap.get(p.customerId),warehouse=warehouseMap.get(p.warehouseCode),term=p.paymentTermCode?termMap.get(termKeys.get(p.paymentTermCode)):null;
   if(!customer||customer.status!=="active")add("customerId","CUSTOMER_NOT_SALEABLE");
   else if(customer.credit?.status==="on_hold")add("customerId","CUSTOMER_CREDIT_ON_HOLD");
   if(!config.importChannelCodes.includes(group.channelCode))add("channelCode","SALES_IMPORT_ORDER_INVALID");
   if(!active(warehouse))add("warehouseCode","WAREHOUSE_INVALID");
   if(!active(currencyMap.get(p.currencyCode)))add("currencyCode","SALES_INPUT_INVALID");
   if(p.paymentTermCode&&!active(term))add("paymentTermCode","SALES_INPUT_INVALID");
   const lines=[];
   for(const line of p.lines){
    const member=itemMap.get(pairKey(line)),lineRow=line.rowNumbers[0];
    if(!member)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    if(member.errorCode){errors.push(safeError(lineRow,"salesUomCode","SKU_UOM_INVALID"));continue;}
    if(!member.sku?.usable){errors.push(safeError(lineRow,"skuCode","SKU_NOT_SALEABLE"));continue;}
    if(!active(member.salesUom)){errors.push(safeError(lineRow,"salesUomCode","SKU_UOM_INVALID"));continue;}
    try{orderedBaseQuantity(line.quantity,member.salesUom.toBaseFactor);}catch(error){if(error.code!=="SALES_UOM_CONVERSION_INVALID")throw error;errors.push(safeError(lineRow,"quantity",error.code));continue;}
    lines.push({skuId:member.sku.skuId,skuUomId:member.salesUom.skuUomId,quantity:line.quantity,unitSellingPrice:line.unitSellingPrice,lineNote:line.lineNote});
   }
   if(!errors.length){
    try {const validated=validateSalesDocument({eventId:group.processingEventId,customerId:p.customerId,currencyCode:p.currencyCode,paymentTermId:term?Number(term.id):null,notes:p.notes,lines,
     fulfillmentWarehouseId:Number(warehouse.id),orderDate:p.orderDate,requestedDeliveryDate:p.requestedDeliveryDate,customerPoReference:p.customerPoReference});
    document=validated.document;warnings=validated.warnings;
    }catch(error){if(!Object.hasOwn(SALES_ERROR_STATUS,error.code)||error.statusCode>=500)throw error;add(error.publicDetails?.field??"lines",error.code);}
   }
  }
  if(errors.length>200){errors.length=200;errors[199]=safeError(group.lastRowNo,"row","TOO_MANY_ERRORS");}
  const result={status:errors.length?"INVALID":"VALID",errors,warnings,payload:document?{document,channelCode:group.channelCode,externalOrderId:group.externalOrderId,warnings}:null,payloadHash:sourceOrderPayloadHash(group),duplicate:null};
  if(result.payload&&Buffer.byteLength(JSON.stringify(result.payload))>131072){result.status="INVALID";result.payload=null;result.errors.push(safeError(row,"payload","SALES_IMPORT_ORDER_INVALID"));}
  return result;
 });
 const stored=results.map((result,index)=>({result,index})).filter(({result})=>result.payload);
 if(stored.length){
  const [sizes]=await tx.query(stored.map(()=>"SELECT ? AS request_index,LENGTH(CAST(CAST(? AS JSON) AS CHAR CHARSET utf8mb4)) AS bytes").join(" UNION ALL "),stored.flatMap(({result,index})=>[index,JSON.stringify(result.payload)]));
  for(const size of sizes){const result=results[Number(size.request_index)];if(Number(size.bytes)>131072){result.status="INVALID";result.payload=null;result.errors.push(safeError(groups[Number(size.request_index)].firstRowNo,"payload","SALES_IMPORT_ORDER_INVALID"));}}
 }

 return results;
}
