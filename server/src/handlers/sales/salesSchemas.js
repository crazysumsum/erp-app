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
    toBaseFactor:{...ID,maximum:1000000},trackingPolicy:{enum:["NONE","LOT","SERIAL"]},minimumSaleLifeDays:{type:"integer",minimum:0},quantity,orderedBaseQuantity:baseQuantity,
    unitSellingPrice:money,priceSource:{enum:["MANUAL","SUGGESTED","QUOTATION","IMPORT"]},lineAmount:money,reservedBaseQuantity:baseQuantity,backorderedBaseQuantity:baseQuantity,
    fulfilledBaseQuantity:baseQuantity,cancelledBaseQuantity:baseQuantity,lineNote:STRING,version:ID})}});
export const SALES_ORDER_COMMAND_RESPONSE=object({salesOrder:SALES_ORDER_DETAIL,operation:object({id:ID,number:SALES_ORDER_DETAIL.properties.number,status:{const:"DRAFT"},version:ID}),
  warnings:{type:"array",items:object({code:STRING,field:STRING})}});

export function salesOrderCommandRequest(req,update=false){return {claims:salesActorClaims(req),input:validateSalesOrderInput(req.input.body,update),trace:{requestId:req.requestId ?? "",correlationId:req.correlationId ?? "",ipAddress:req.ip ?? ""}};}
