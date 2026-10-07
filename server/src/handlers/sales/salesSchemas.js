import { RequestValidator } from "../../framework/validation/requestValidator.js";
import { salesError } from "../../modules/sales/salesErrors.js";
import { quotationActorClaims as salesActorClaims } from "../sales-quotations/salesQuotationSchemas.js";
export { EMPTY, quotationActorClaims as salesActorClaims } from "../sales-quotations/salesQuotationSchemas.js";
const ID = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, STRING = { type: "string" };
const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const pagination = { page: ID, pageSize: { type: "integer", enum: [10, 20, 50, 100] }, q: { type: "string", maxLength: 190 } };
export const SALES_LOOKUP_QUERY = Object.fromEntries(["customers", "skus", "warehouses", "channels"].map(kind => [kind,
  { type: "object", additionalProperties: false, properties: { ...pagination, ...(kind === "skus" ? {
    barcode: { type: "string", maxLength: 190 }, currencyCode: { type: "string", pattern: "^[A-Z]{3}$" } } : {}) } }]));
const validator = new RequestValidator({ config: { enabled: true, allErrors: true, coerceTypes: true, useDefaults: false, removeAdditional: false,
  maxErrors: 20, includeErrorDetailsInResponse: false } });
const validators = Object.fromEntries(Object.entries(SALES_LOOKUP_QUERY).map(([kind, query]) => [kind, validator.compile({ query }, `Sales ${kind} lookup`)]));
export function salesLookupQuery(req, kind) {
  const request = { query: structuredClone(req.input.query) };
  try { validators[kind](request); }
  catch (error) { if (error.code === "REQUEST_VALIDATION_FAILED") throw salesError("SALES_INPUT_INVALID"); throw error; }
  return request.input.query;
}
const nullableId = { type: ["integer", "null"], minimum: 1 }, nullableString = { type: ["string", "null"] };
const credit = object({ configured: { type: "boolean" }, creditLimit: nullableString, currencyCode: nullableString, status: STRING, policyVersion: nullableId });
const customer = object({ customerId: ID, customerCode: STRING, legalName: STRING, displayName: STRING, defaultCurrencyCode: nullableString,
  defaultPaymentTermId: nullableId, status: { const: "active" }, version: ID, credit });
const uom = object({ skuUomId: ID, uomId: ID, uomCode: STRING, uomName: STRING, toBaseFactor: { ...ID, maximum: 1000000 }, isDefaultSale: { type: "boolean" }, isBase: { type: "boolean" } });
const sku = object({ skuId: ID, skuCode: STRING, skuName: STRING, itemId: ID, itemName: STRING, skuVersion: ID, itemVersion: ID,
  suggestedPrice: { anyOf: [{ type: "null" }, object({ amount: STRING, currency: STRING, taxBasis: STRING })] }, priceCurrencyMatches: { type: "boolean" },
  uoms: { type: "array", minItems: 1, items: uom } });
export const SALES_LOOKUP_RESPONSE = Object.fromEntries(Object.entries({ customers: customer, skus: sku, warehouses: object({ id: ID, code: STRING, name: STRING }),
  channels: object({ code: STRING, name: STRING }) }).map(([kind, item]) => [kind, object({ items: { type: "array", maxItems: 100, items: item },
  total: { type: "integer", minimum: 0 }, page: ID, pageSize: pagination.pageSize })]));

const orderLine = update => ({type:"object",additionalProperties:false,required:["skuId","skuUomId","quantity","unitSellingPrice"],properties:{
  skuId:ID,skuUomId:ID,quantity:{type:"string",pattern:"^\\d{1,14}(?:\\.\\d{1,6})?$"},unitSellingPrice:{type:"string",pattern:"^\\d{1,15}(?:\\.\\d{1,4})?$"},
  lineNote:{type:"string",maxLength:500},...(update?{id:ID}:{})}});
const orderInput = update => ({type:"object",additionalProperties:false,required:["eventId","customerId","currencyCode","fulfillmentWarehouseId","orderDate","lines",...(update?["version"]:[])],properties:{
  eventId:{type:"string",pattern:"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},
  customerId:ID,currencyCode:{type:"string",pattern:"^[A-Z]{3}$"},paymentTermId:nullableId,fulfillmentWarehouseId:ID,orderDate:{type:"string",format:"date"},
  requestedDeliveryDate:{type:["string","null"],format:"date"},customerPoReference:{type:"string",maxLength:190},notes:{type:"string",maxLength:2000},
  lines:{type:"array",minItems:1,items:orderLine(update)},...(update?{version:ID}:{})}});
export const SALES_ORDER_CREATE_INPUT=orderInput(false),SALES_ORDER_UPDATE_INPUT=orderInput(true);
const bodyValidator=new RequestValidator({config:{enabled:true,allErrors:true,coerceTypes:false,useDefaults:false,removeAdditional:false,maxErrors:20,includeErrorDetailsInResponse:false}});
const orderValidators=[SALES_ORDER_CREATE_INPUT,SALES_ORDER_UPDATE_INPUT].map(body=>bodyValidator.compile({body},"Sales Order editable body"));
export function validateSalesOrderInput(body,update=false){try{orderValidators[update?1:0]({body});}catch(error){if(error.code==="REQUEST_VALIDATION_FAILED")throw salesError("SALES_INPUT_INVALID");throw error;}return body;}
export const SALES_ORDER_ID_PARAMS={type:"object",additionalProperties:false,required:["id"],properties:{id:ID}};
export const SALES_ORDER_WRITE_POLICY={name:"hasPermission",options:{permissions:["sales.view","sales.mgmt"]}};
const timestamp={type:"integer",minimum:0},baseQuantity={type:"string",pattern:"^\\d+$"},money={type:"string",pattern:"^\\d+\\.\\d{4}$"},quantity={type:"string",pattern:"^\\d+\\.\\d{6}$"};
export const SALES_ORDER_STATUSES=["DRAFT","CONFIRMING","CONFIRMED","PARTIALLY_FULFILLED","COMPLETED","CANCELLED","CLOSED"];
export const SALES_ORDER_DETAIL=object({id:ID,number:{type:"string",pattern:"^SO-\\d{6}-\\d{6}$"},status:{enum:SALES_ORDER_STATUSES},sourceType:{enum:["MANUAL","QUOTATION","CSV","CHANNEL"]},
  sourceQuotationId:nullableId,channelCode:STRING,externalOrderId:STRING,version:ID,customerId:ID,customerCode:STRING,customerName:STRING,currencyCode:STRING,
  paymentTermId:nullableId,paymentTermCode:STRING,paymentTermName:STRING,fulfillmentWarehouseId:ID,warehouseCode:STRING,warehouseName:STRING,
  orderDate:{type:"string",format:"date"},requestedDeliveryDate:{type:["string","null"],format:"date"},customerPoReference:STRING,notes:STRING,
  lineCount:{...ID,maximum:100},totalAmount:money,hasBackorder:{type:"boolean"},backorderLineCount:{type:"integer",minimum:0,maximum:100},createdAt:timestamp,updatedAt:timestamp,
  lines:{type:"array",maxItems:100,items:object({id:ID,lineNo:ID,skuId:ID,skuUomId:ID,itemName:STRING,skuCode:STRING,skuName:STRING,uomCode:STRING,uomName:STRING,
    toBaseFactor:{...ID,maximum:1000000},trackingPolicy:{enum:["NONE","LOT","BATCH","BATCH_EXPIRY","SERIAL"]},minimumSaleLifeDays:{type:"integer",minimum:0},quantity,orderedBaseQuantity:baseQuantity,
    unitSellingPrice:money,priceSource:{enum:["MANUAL","SUGGESTED","QUOTATION","IMPORT"]},lineAmount:money,reservedBaseQuantity:baseQuantity,backorderedBaseQuantity:baseQuantity,
    fulfilledBaseQuantity:baseQuantity,cancelledBaseQuantity:baseQuantity,lineNote:STRING,version:ID})}});
export const SALES_ORDER_COMMAND_RESPONSE=object({salesOrder:SALES_ORDER_DETAIL,operation:object({id:ID,number:SALES_ORDER_DETAIL.properties.number,status:{const:"DRAFT"},version:ID}),
  warnings:{type:"array",items:object({code:STRING,field:STRING})}});

export const SALES_CONFIRMATION_INPUT = object({ eventId: SALES_ORDER_CREATE_INPUT.properties.eventId,version: ID });
const validateConfirmationBody = bodyValidator.compile({ body: SALES_CONFIRMATION_INPUT }, "Sales confirmation body");
export function validateSalesConfirmationInput(body) {
  try { validateConfirmationBody({ body }); }
  catch (error) { if (error.code === "REQUEST_VALIDATION_FAILED") throw salesError("SALES_INPUT_INVALID"); throw error; }
  return body;
}
export const SALES_CONFIRMATION_RESPONSE = object({ outcome: { const: "CONFIRMED" },salesOrder: SALES_ORDER_DETAIL,
  warnings: { type: "array",maxItems: 3,uniqueItems: true,items: { enum: ["PARTIAL_BACKORDER","CREDIT_LIMIT_ADVISORY","MASTER_DATA_CHANGED"] } } });
export const SALES_CONFIRMATION_PENDING_RESPONSE = object({ outcome: { const: "CONFIRMING" },operationId: ID,eventId: SALES_CONFIRMATION_INPUT.properties.eventId,
  statusUrl: { type: "string",pattern: "^/api/v1/sales-operations/by-event/[0-9a-fA-F-]{36}$" },retryAfterSeconds: { const: 2 } });
export const SALES_OPERATION_EVENT_PARAMS = object({ eventId: SALES_CONFIRMATION_INPUT.properties.eventId });
export const SALES_OPERATION_LOOKUP_RESPONSE = object({ eventId: SALES_CONFIRMATION_INPUT.properties.eventId,operationId: ID,
  status: { enum: ["IN_PROGRESS","SUCCEEDED","FAILED"] },result: { anyOf: [{ type: "null" },object({ id: ID,number: { type: "string",pattern: "^(SO|QT)-\\d{6}-\\d{6}$" },
    status: { enum: ["DRAFT","ISSUED","EXPIRED","CANCELLED","CONVERTED","CONFIRMED"] },version: ID })] },errorCode: nullableString });

export function salesOrderCommandRequest(req,update=false){return {claims:salesActorClaims(req),input:validateSalesOrderInput(req.input.body,update),trace:{requestId:req.requestId ?? "",correlationId:req.correlationId ?? "",ipAddress:req.ip ?? ""}};}

export const SALES_ORDER_READ_POLICY={name:"hasPermission",options:{permissions:["sales.view"]}};
const oneOrMany=values=>({anyOf:[{enum:values},{type:"array",minItems:1,maxItems:values.length,items:{enum:values}}]});
export const SALES_ORDER_LIST_QUERY={type:"object",additionalProperties:false,properties:{page:ID,pageSize:{type:"integer",minimum:1,maximum:100},q:{type:"string",maxLength:190},number:{type:"string",maxLength:190},
 status:oneOrMany(SALES_ORDER_STATUSES),sourceType:oneOrMany(["MANUAL","QUOTATION","CSV","CHANNEL"]),channelCode:{type:"string",maxLength:50},externalOrderId:{type:"string",maxLength:190},customerId:ID,warehouseId:ID,hasBackorder:{type:"boolean"},
 orderDateFrom:{type:"string",format:"date"},orderDateTo:{type:"string",format:"date"},updatedFrom:timestamp,updatedTo:timestamp,sortBy:{enum:["number","customerCode","customerName","orderDate","updatedAt","status","sourceType","totalAmount"]},descending:{type:"boolean"}}};
const validateOrderQuery=validator.compile({query:SALES_ORDER_LIST_QUERY},"Sales Order list query");
export function salesOrderListRequest(req){const request={query:structuredClone(req.input.query)};try{validateOrderQuery(request);}catch(error){if(error.code==="REQUEST_VALIDATION_FAILED")throw salesError("SALES_INPUT_INVALID");throw error;}return {claims:salesActorClaims(req),input:request.input.query};}
const summaryFields=["id","number","status","sourceType","sourceQuotationId","channelCode","externalOrderId","version","customerId","customerCode","customerName","currencyCode","fulfillmentWarehouseId","warehouseCode","warehouseName","orderDate","lineCount","totalAmount","hasBackorder","backorderLineCount","createdAt","updatedAt"];
export const SALES_ORDER_LIST_RESPONSE=object({items:{type:"array",maxItems:100,items:object(Object.fromEntries(summaryFields.map(field=>[field,SALES_ORDER_DETAIL.properties[field]])))},total:{type:"integer",minimum:0},page:ID,pageSize:{type:"integer",minimum:1,maximum:100}});
export const SALES_ORDER_READ_RESPONSE=object({...SALES_ORDER_DETAIL.properties,isArchived:{const:false},allowedActions:{type:"array",uniqueItems:true,items:{enum:["edit","confirm"]}},historyTruncated:{type:"boolean"},
 history:{type:"array",maxItems:100,items:object({id:ID,sequence:ID,fromStatus:{type:["string","null"]},toStatus:STRING,action:STRING,reason:STRING,version:ID,actorLabel:STRING,occurredAt:timestamp})},
 currentMaster:object({customer:{anyOf:[{type:"null"},object({customerCode:STRING,customerName:STRING,status:STRING})]},skus:{type:"array",maxItems:100,items:object({skuId:ID,skuCode:STRING,skuName:STRING,itemName:STRING,skuStatus:STRING,itemStatus:STRING})}})});
