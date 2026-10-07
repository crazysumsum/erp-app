import { createHash } from "node:crypto";
import { CustomerLookupService } from "../customer/CustomerLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { readSalesOrderDetail } from "./SalesOrderService.js";
import { requireSalesActor } from "./salesAuthorization.js";
import { salesDate } from "./salesValidation.js";
import { salesError } from "./salesErrors.js";
const statuses=["DRAFT","CONFIRMING","CONFIRMED","PARTIALLY_FULFILLED","COMPLETED","CANCELLED","CLOSED"],sources=["MANUAL","QUOTATION","CSV","CHANNEL"];
const sort={number:"sales_order_number",customerCode:"customer_code_snapshot",customerName:"customer_name_snapshot",orderDate:"order_date",updatedAt:"updated_at",status:"status",sourceType:"source_type",totalAmount:"total_amount"};
export function validateSalesOrderQuery(input={}){
 const fields=["page","pageSize","q","number","status","sourceType","channelCode","externalOrderId","customerId","warehouseId","hasBackorder","orderDateFrom","orderDateTo","updatedFrom","updatedTo","sortBy","descending"];
 if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!fields.includes(key)))throw salesError("SALES_INPUT_INVALID");
 const query={...input,page:input.page??1,pageSize:input.pageSize??20,sortBy:input.sortBy??"orderDate",descending:input.descending??true};
 if(!Number.isSafeInteger(query.page)||query.page<1||!Number.isSafeInteger(query.pageSize)||query.pageSize<1||query.pageSize>100||!Number.isSafeInteger((query.page-1)*query.pageSize)||!Object.hasOwn(sort,query.sortBy)||typeof query.descending!=="boolean")throw salesError("SALES_INPUT_INVALID");
 for(const field of ["customerId","warehouseId"])if(query[field]!==undefined&&(!Number.isSafeInteger(query[field])||query[field]<1))throw salesError("SALES_INPUT_INVALID",{field});
 for(const field of ["q","number","channelCode","externalOrderId"])if(query[field]!==undefined&&(typeof query[field]!=="string"||query[field].length>(field==="channelCode"?50:190)))throw salesError("SALES_INPUT_INVALID",{field});
 for(const [field,allowed] of [["status",statuses],["sourceType",sources]])if(query[field]!==undefined){query[field]=Array.isArray(query[field])?query[field]:[query[field]];if(!query[field].length||query[field].length>allowed.length||query[field].some(value=>!allowed.includes(value)))throw salesError("SALES_INPUT_INVALID",{field});}
 if(query.hasBackorder!==undefined&&typeof query.hasBackorder!=="boolean")throw salesError("SALES_INPUT_INVALID",{field:"hasBackorder"});
 for(const suffix of ["From","To"]){if(query["orderDate"+suffix]!==undefined)salesDate(query["orderDate"+suffix],"orderDate"+suffix);if(query["updated"+suffix]!==undefined&&(!Number.isSafeInteger(query["updated"+suffix])||query["updated"+suffix]<0))throw salesError("SALES_INPUT_INVALID",{field:"updated"+suffix});}
 for(const prefix of ["orderDate","updated"])if(query[prefix+"From"]!==undefined&&query[prefix+"To"]!==undefined&&query[prefix+"From"]>query[prefix+"To"])throw salesError("SALES_INPUT_INVALID",{field:prefix});
 return query;
}
export function salesOrderWhere(query){
 const clauses=[],values=[];
 for(const [field,column] of [["number","sales_order_number"],["customerId","customer_id"],["warehouseId","fulfillment_warehouse_id"],["hasBackorder","has_backorder"]])if(query[field]!==undefined){clauses.push(`${column}=?`);values.push(query[field]);}
 for(const [field,column] of [["status","status"],["sourceType","source_type"]])if(query[field]){clauses.push(`${column} IN (${query[field].map(()=>"?").join(",")})`);values.push(...query[field]);}
 if(query.externalOrderId){clauses.push(`external_order_key_id IN (SELECT id FROM sales_external_order_keys WHERE external_order_id_hash=? AND BINARY external_order_id=BINARY ? AND is_order_archived=0${query.channelCode?" AND channel_code=?":""})`);values.push(createHash("sha256").update(query.externalOrderId).digest(),query.externalOrderId);if(query.channelCode)values.push(query.channelCode);}
 else if(query.channelCode){clauses.push("channel_code_snapshot=?");values.push(query.channelCode);}
 if(query.q){const escaped=query.q.replace(/[!%_]/gu,value=>`!${value}`);clauses.push("(sales_order_number=? OR customer_code_snapshot LIKE ? ESCAPE '!' OR customer_name_snapshot LIKE ? ESCAPE '!' OR customer_po_reference=?)");values.push(query.q,`${escaped}%`,`%${escaped}%`,query.q);}
 for(const [prefix,column] of [["orderDate","order_date"],["updated","updated_at"]])for(const [suffix,operator] of [["From",">="],["To","<="]])if(query[prefix+suffix]!==undefined){clauses.push(`${column}${operator}?`);values.push(query[prefix+suffix]);}
 return {where:clauses.length?` WHERE ${clauses.join(" AND ")}`:"",values};
}
const summarySelect=`id,sales_order_number,status,source_type,source_quotation_id,channel_code_snapshot,external_order_id_snapshot,version,customer_id,customer_code_snapshot,customer_name_snapshot,currency_code,
 fulfillment_warehouse_id,warehouse_code_snapshot,warehouse_name_snapshot,DATE_FORMAT(order_date,'%Y-%m-%d') AS order_date,line_count,total_amount,has_backorder,backorder_line_count,created_at,updated_at`;
export function toSalesOrderSummary(row){return {id:Number(row.id),number:row.sales_order_number,status:row.status,sourceType:row.source_type,sourceQuotationId:row.source_quotation_id===null?null:Number(row.source_quotation_id),channelCode:row.channel_code_snapshot,externalOrderId:row.external_order_id_snapshot,
 version:Number(row.version),customerId:Number(row.customer_id),customerCode:row.customer_code_snapshot,customerName:row.customer_name_snapshot,currencyCode:row.currency_code,fulfillmentWarehouseId:Number(row.fulfillment_warehouse_id),warehouseCode:row.warehouse_code_snapshot,warehouseName:row.warehouse_name_snapshot,
 orderDate:row.order_date,lineCount:Number(row.line_count),totalAmount:String(row.total_amount),hasBackorder:Boolean(row.has_backorder),backorderLineCount:Number(row.backorder_line_count),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)};}
export class SalesInquiryService{
 constructor({database,time,logger}={}){this.database=database;this.time=time;this.logger=logger;}
 async list({claims,input={}}){const query=validateSalesOrderQuery(input),{where,values}=salesOrderWhere(query);
  return this.database.withTransaction(async tx=>{await requireSalesActor(tx,claims,"sales.view");const [[count]]=await tx.query(`SELECT COUNT(*) AS total FROM sales_orders${where}`,values);
   const [page]=await tx.query(`SELECT id FROM sales_orders${where} ORDER BY ${sort[query.sortBy]} ${query.descending?"DESC":"ASC"},id ${query.descending?"DESC":"ASC"} LIMIT ? OFFSET ?`,[...values,query.pageSize,(query.page-1)*query.pageSize]);
   const [rows]=page.length?await tx.query(`SELECT ${summarySelect} FROM sales_orders WHERE id IN (${page.map(()=>"?").join(",")})`,page.map(row=>row.id)):[[]];
   const byId=new Map(rows.map(row=>[String(row.id),row]));
   return {items:page.map(row=>toSalesOrderSummary(byId.get(String(row.id)))),total:Number(count.total),page:query.page,pageSize:query.pageSize};});
 }
 async get({claims,id}){if(!Number.isSafeInteger(id)||id<1)throw salesError("SALES_INPUT_INVALID",{field:"id"});
  return this.database.withTransaction(async tx=>{const actor=await requireSalesActor(tx,claims,"sales.view"),detail=await readSalesOrderDetail(tx,id);
   const [rows]=await tx.query("SELECT id,sequence_no,from_status,to_status,action,reason,order_version_after,actor_label,occurred_at FROM sales_order_status_history WHERE sales_order_id=? ORDER BY sequence_no DESC LIMIT 101",[id]);
   const customer=await new CustomerLookupService({database:tx}).findById(detail.customerId,{purpose:"history"});
   const skus=await new ItemLookupService({database:tx,time:this.time,logger:this.logger}).findManyByIds(detail.lines.map(line=>line.skuId),{includeInactive:true});
   return {...detail,isArchived:false,allowedActions:detail.status==="DRAFT"&&actor.permissions.includes("sales.mgmt")?["edit","confirm"]:[],historyTruncated:rows.length>100,
    history:rows.slice(0,100).reverse().map(row=>({id:Number(row.id),sequence:Number(row.sequence_no),fromStatus:row.from_status,toStatus:row.to_status,action:row.action,reason:row.reason,version:Number(row.order_version_after),actorLabel:row.actor_label,occurredAt:Number(row.occurred_at)})),
    currentMaster:{customer:customer?{customerCode:customer.customerCode,customerName:customer.legalName,status:customer.status}:null,
     skus:[...skus.values()].map(sku=>({skuId:sku.skuId,skuCode:sku.skuCode,skuName:sku.skuName,itemName:sku.itemName,skuStatus:sku.skuStatus,itemStatus:sku.itemStatus}))}};
  });
 }
}
