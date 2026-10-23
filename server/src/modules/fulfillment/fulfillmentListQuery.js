import { createHash } from "node:crypto";
import { fulfillmentError } from "./fulfillmentErrors.js";
const sorts=Object.freeze({lastBusinessUpdatedAt:"last_business_updated_at",createdAt:"created_at",updatedAt:"updated_at",fulfillmentNumber:"fulfillment_number",id:"id"});
const filters=["view","q","salesOrderId","customerId","warehouseId","status","hasShortPick","createdFrom","createdTo","pickedFrom","pickedTo"];
const invalid=()=>{throw fulfillmentError("FULFILLMENT_INPUT_INVALID");};
const object=value=>value&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&!Array.isArray(value);
const binding=query=>createHash("sha256").update(JSON.stringify(Object.fromEntries([...filters,"sortBy","descending","pageSize"].filter(key=>query[key]!==undefined).map(key=>[key,query[key]])))).digest("hex");
export function normalizeFulfillmentListQuery(input={}) {
  if(!object(input)||Object.keys(input).some(key=>![...filters,"sortBy","descending","page","pageSize","cursor"].includes(key)))invalid();
  const query={...input,view:input.view===undefined?"active":input.view,page:input.page===undefined?1:input.page,pageSize:input.pageSize===undefined?20:input.pageSize,sortBy:input.sortBy===undefined?"lastBusinessUpdatedAt":input.sortBy,descending:input.descending===undefined?true:input.descending};
  if(!Object.hasOwn(sorts,query.sortBy)||typeof query.descending!=="boolean"||!["active","myRecent","exceptions","finalized"].includes(query.view)||!Number.isSafeInteger(query.page)||query.page<1||query.page>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(query.pageSize)||query.pageSize<1||query.pageSize>100)invalid();
  for(const key of ["salesOrderId","customerId","warehouseId"])if(query[key]!==undefined&&(!Number.isSafeInteger(query[key])||query[key]<1))invalid();
  if(query.status!==undefined&&!["DRAFT","PICKING","PICKED","SHIPPED","CANCELLED","REVERSED"].includes(query.status))invalid();
  if(query.hasShortPick!==undefined&&typeof query.hasShortPick!=="boolean")invalid();
  if(query.q!==undefined){if(typeof query.q!=="string"||query.q.length>190)invalid();query.q=query.q.trim();if(!query.q)delete query.q;}
  for(const key of ["createdFrom","createdTo","pickedFrom","pickedTo"])if(query[key]!==undefined&&(!Number.isSafeInteger(query[key])||query[key]<0))invalid();
  for(const prefix of ["created","picked"])if(query[prefix+"From"]!==undefined&&query[prefix+"To"]!==undefined&&query[prefix+"From"]>query[prefix+"To"])invalid();
  query.after=null;
  if(query.cursor!==undefined){
    if(query.page===1||typeof query.cursor!=="string"||query.cursor.length>2048||!/^[A-Za-z0-9_-]+$/u.test(query.cursor))invalid();
    let decoded;try{const bytes=Buffer.from(query.cursor,"base64url");if(bytes.toString("base64url")!==query.cursor)invalid();decoded=JSON.parse(bytes.toString("utf8"));}catch{invalid();}
    if(!object(decoded)||Object.keys(decoded).sort().join(",")!=="after,binding,page,version"||decoded.version!==1||decoded.binding!==binding(query)||decoded.page!==query.page||!object(decoded.after)||Object.keys(decoded.after).sort().join(",")!=="id,value"||typeof decoded.after.id!=="string"||!/^[1-9][0-9]{0,15}$/u.test(decoded.after.id)||BigInt(decoded.after.id)>BigInt(Number.MAX_SAFE_INTEGER))invalid();
    const value=decoded.after.value;
    if(query.sortBy==="fulfillmentNumber"?(typeof value!=="string"||! /^[\x21-\x7e]{1,24}$/u.test(value)):query.sortBy==="id"?(typeof value!=="string"||!/^[1-9][0-9]{0,15}$/u.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER)):(!Number.isSafeInteger(value)||value<0))invalid();
    query.after={id:decoded.after.id,value};
  }else if(query.page!==1)invalid();
  return query;
}
export function encodeFulfillmentListCursor(query,last){return Buffer.from(JSON.stringify({version:1,binding:binding(query),page:query.page+1,after:{id:String(last.id),value:["id","fulfillmentNumber"].includes(query.sortBy)?String(last[sorts[query.sortBy]]):Number(last[sorts[query.sortBy]])}})).toString("base64url");}
export function fulfillmentListPageQuery(query,actorId,salesNumberOrderId=null){
  if(!Number.isSafeInteger(actorId)||actorId<1)invalid();
  if(salesNumberOrderId!==null&&(!/^[1-9][0-9]{0,15}$/u.test(salesNumberOrderId)||BigInt(salesNumberOrderId)>BigInt(Number.MAX_SAFE_INTEGER)))invalid();
  const clauses=[],values=[];
  if(query.view==="active")clauses.push("f.status IN ('DRAFT','PICKING','PICKED')");
  if(query.view==="finalized")clauses.push("f.status IN ('SHIPPED','CANCELLED','REVERSED')");
  if(query.view==="myRecent"){clauses.push("f.created_by=?");values.push(actorId);}
  if(query.view==="exceptions")clauses.push("(f.has_short_pick=1 OR EXISTS(SELECT 1 FROM fulfillment_operation_requests o WHERE o.target_type='FULFILLMENT' AND o.target_id=f.id AND o.status='FAILED'))");
  for(const [field,column]of [["salesOrderId","sales_order_id"],["customerId","customer_id"],["warehouseId","warehouse_id"],["status","status"],["hasShortPick","has_short_pick"]])if(query[field]!==undefined){clauses.push(`f.${column}=?`);values.push(query[field]);}
  if(query.q){clauses.push(salesNumberOrderId===null?"f.fulfillment_number=?":"(f.fulfillment_number=? OR f.sales_order_id=?)");values.push(query.q);if(salesNumberOrderId!==null)values.push(salesNumberOrderId);}
  for(const [prefix,column]of [["created","created_at"],["picked","picked_at"]])for(const [suffix,operator]of [["From",">="],["To","<="]])if(query[prefix+suffix]!==undefined){clauses.push(`f.${column}${operator}?`);values.push(query[prefix+suffix]);}
  const column=sorts[query.sortBy],operator=query.descending?"<":">",direction=query.descending?"DESC":"ASC";
  if(query.after){clauses.push(`(f.${column}${operator}? OR (f.${column}=? AND f.id${operator}?))`);values.push(query.after.value,query.after.value,query.after.id);}
  return {sql:`SELECT f.id,f.fulfillment_number,f.status,f.version,f.sales_order_id,f.sales_order_number_snapshot,f.customer_id,f.customer_code_snapshot,f.customer_name_snapshot,f.warehouse_id,f.warehouse_code_snapshot,f.warehouse_name_snapshot,f.line_count,f.has_short_pick,f.created_at,f.updated_at,f.picked_at,f.last_business_updated_at FROM fulfillments f${clauses.length?" WHERE "+clauses.join(" AND "):""} ORDER BY f.${column} ${direction}${column==="id"?"":`,f.id ${direction}`} LIMIT ?`,values:[...values,query.pageSize+1]};
}
