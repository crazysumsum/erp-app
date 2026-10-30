import { httpClient } from "@/framework/http/HttpClient.js";
import { ERROR_CODE_MESSAGES } from "@/framework/http/errorMessages.js";

export const service={name:"fulfillment"};
export function fulfillmentDocumentId(value){
 const id=typeof value==="number"&&Number.isSafeInteger(value)?String(value):value;
 if(typeof id!=="string"||! /^[1-9][0-9]{0,15}$/u.test(id)||BigInt(id)>BigInt(Number.MAX_SAFE_INTEGER))throw new TypeError("履約單識別碼不正確，請返回列表重新選取");
 return id;
}
const common=["q","customerId","warehouseId","sortBy","descending","page","pageSize","cursor"];
const queue=["salesOrderStatus","hasBackorder","hasActiveWork","requestedDateFrom","requestedDateTo"];
const list=["view","salesOrderId","status","hasShortPick","createdFrom","createdTo","pickedFrom","pickedTo"];
const sorts={queue:["requestedDeliveryDate","orderDate","salesOrderNumber"],list:["lastBusinessUpdatedAt","createdAt","updatedAt","fulfillmentNumber","id"]};
const invalid=()=>{throw new TypeError("履約篩選資料不正確，請檢查後再試");};
export function normalizeFulfillmentQuery(kind,input={}){
 if(!Object.hasOwn(sorts,kind)||!input||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.keys(input).some(key=>![...common,...(kind==="queue"?queue:list),"rowsPerPage","filter"].includes(key)))invalid();
 const {rowsPerPage,filter,...fields}=input,query=Object.fromEntries(Object.entries({...fields,pageSize:rowsPerPage??fields.pageSize,q:filter??fields.q}).filter(([,value])=>value!==undefined&&value!==null&&value!==""));
 for(const [key,value]of Object.entries(query)){
  if(typeof value!=="string"&&typeof value!=="number"&&typeof value!=="boolean")invalid();
  if(["descending","hasBackorder","hasActiveWork","hasShortPick"].includes(key)){if(![true,false,"true","false"].includes(value))invalid();query[key]=value===true||value==="true";}
  else if(["page","pageSize","salesOrderId","customerId","warehouseId","createdFrom","createdTo","pickedFrom","pickedTo"].includes(key)){
   if(typeof value!=="number"&&(typeof value!=="string"||!/^(0|[1-9][0-9]*)$/u.test(value)))invalid();const number=Number(value),minimum=key.endsWith("From")||key.endsWith("To")?0:1;if(!Number.isSafeInteger(number)||number<minimum||key==="pageSize"&&number>100)invalid();query[key]=number;
  }else if(typeof value!=="string")invalid();
 }
 if(query.sortBy!==undefined&&!sorts[kind].includes(query.sortBy)||query.view!==undefined&&!["active","myRecent","exceptions","finalized"].includes(query.view)||query.status!==undefined&&!["DRAFT","PICKING","PICKED","SHIPPED","CANCELLED","REVERSED"].includes(query.status)||query.salesOrderStatus!==undefined&&!["CONFIRMED","PARTIALLY_FULFILLED"].includes(query.salesOrderStatus))invalid();
 if(query.q!==undefined){query.q=query.q.trim();if(query.q.length>190)invalid();if(!query.q)delete query.q;}
 for(const key of ["requestedDateFrom","requestedDateTo"])if(query[key]!==undefined){const value=query[key],date=new Date(`${value}T00:00:00.000Z`);if(!/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/u.test(value)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)invalid();}
 for(const prefix of ["requestedDate","created","picked"])if(query[prefix+"From"]!==undefined&&query[prefix+"To"]!==undefined&&query[prefix+"From"]>query[prefix+"To"])invalid();
 if(query.cursor!==undefined&&(typeof query.cursor!=="string"||query.cursor.length>2048||!/^[A-Za-z0-9_-]+$/u.test(query.cursor)||(query.page??1)===1)||(query.page??1)>1&&!query.cursor)invalid();
 return query;
}
export function fulfillmentFailure(error){
 const status=error?.status,code=error?.code;
 if(status===403)return {message:"沒有權限查看或操作履約資料，請重新登入或聯絡管理員",action:"none",preserveInput:true};
 if(status===404)return {message:"找不到可用的履約資料，請返回列表重新查詢",action:"none",preserveInput:true};
 if(["DATABASE_TRANSACTION_INDETERMINATE","FULFILLMENT_DEPENDENCY_UNAVAILABLE","TIMEOUT","NETWORK_ERROR","CONCURRENT_OPERATION"].includes(code))return {message:"暫時未能確認結果，請保留輸入並沿用原操作識別碼確認結果",action:"recover",preserveInput:true};
 const correct=["SHORT_PICK_REASON_REQUIRED","PICK_SEQUENCE_REASON_REQUIRED","FEFO_OVERRIDE_REQUIRED","PICK_RESULT_INVALID"].includes(code);
 return {message:Object.hasOwn(ERROR_CODE_MESSAGES,code)?ERROR_CODE_MESSAGES[code]:"履約操作未能完成，請保留輸入並稍後再試",action:correct?"correct":status===409?"reload":"none",preserveInput:true};
}
const write=(path,{idempotencyKey,...body}={}, {signal}={})=>httpClient.post(path,{idempotent:true,idempotencyKey:idempotencyKey??body.eventId,body,...(signal===undefined?{}:{signal})});
export default {
 listQueue({signal,...query}={}){return httpClient.get("/api/v1/fulfillment-queue",{params:normalizeFulfillmentQuery("queue",query),signal});},
 listFulfillments({signal,...query}={}){return httpClient.get("/api/v1/fulfillments",{params:normalizeFulfillmentQuery("list",query),signal});},
 getFulfillment(id,{signal,...params}={}){return httpClient.get(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}`,{params,signal});},
 getCandidates(id,{signal,...params}={}){return httpClient.get(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}/allocation-candidates`,{params,signal});},
 getReallocationCandidates(id,{signal,...params}={}){return httpClient.get(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}/reallocation-candidates`,{params,signal});},
 previewAllocation(id,body,{signal}={}){return httpClient.post(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}/allocation-preview`,{body,signal});},
 createFulfillment(body,options){return write("/api/v1/fulfillments/create",body,options);},
 updateFulfillment(id,body,options){return write(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}/update`,body,options);},
 allocate(id,body,options){return write(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}/allocate`,body,options);},
 reallocate(id,body,options){return write(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}/reallocate`,body,options);},
 confirmPick(id,body,options){return write(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}/pick-confirm`,body,options);},
 cancel(id,body,options){return write(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}/cancel`,body,options);},
 getPickList(id,{signal}={}){return httpClient.get(`/api/v1/fulfillments/${fulfillmentDocumentId(id)}/pick-list`,{signal});}
};
