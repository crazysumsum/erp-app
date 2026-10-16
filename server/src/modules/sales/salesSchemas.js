import Ajv from "ajv";
import {canonicalSalesPayload} from "./salesCanonicalHash.js";
import {normalizeQuantity} from "./salesQuantityMath.js";
import {normalizeMoney} from "./salesMoneyMath.js";
import {salesDate} from "./salesValidation.js";
const identifier=maximum=>({type:"string",minLength:1,maxLength:maximum,pattern:"^(?!\\s*$)[^\\p{Cc}\\p{Cf}]+$"}),text=maximum=>({type:"string",maxLength:maximum,pattern:"^[^\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]*$"}),date={type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"};
export const SALES_CHANNEL_V1_SCHEMA={type:"object",additionalProperties:false,required:["schemaVersion","channelIdentity","requestId","idempotencyKey","order"],properties:{
 schemaVersion:{const:"1.0"},channelIdentity:{type:"object",additionalProperties:false,required:["code","serviceId"],properties:{code:identifier(50),serviceId:identifier(180)}},requestId:identifier(190),idempotencyKey:identifier(190),
 order:{type:"object",additionalProperties:false,required:["externalOrderId","customerId","fulfillmentWarehouseCode","orderDate","currencyCode","lines"],properties:{externalOrderId:identifier(190),customerId:{type:"integer",minimum:1,maximum:Number.MAX_SAFE_INTEGER},fulfillmentWarehouseCode:identifier(190),orderDate:date,requestedDeliveryDate:{anyOf:[date,{type:"null"}]},currencyCode:{type:"string",pattern:"^[A-Z]{3}$"},paymentTermCode:{anyOf:[identifier(100),{type:"null"}]},customerPoReference:text(190),notes:text(2000),
  lines:{type:"array",minItems:1,maxItems:100,items:{type:"object",additionalProperties:false,required:["skuCode","salesUomCode","quantity","unitSellingPrice"],properties:{skuCode:identifier(190),salesUomCode:identifier(100),quantity:{type:"string",maxLength:20,pattern:"^\\d+(?:\\.\\d{1,6})?$"},unitSellingPrice:{type:"string",maxLength:20,pattern:"^\\d+(?:\\.\\d{1,4})?$"},lineNote:text(500)}}}}
 }}};
const validate=new Ajv({strict:true,allErrors:true}).compile(SALES_CHANNEL_V1_SCHEMA);
// Pure V1 boundary; identity is selected only by the server-wired verifier, never by this payload.
export function normalizeSalesChannelV1(input,identity){
 const fail=(code="SALES_INPUT_INVALID",field="order")=>({errors:[{code,field}]});
 if(!validate(input))return {errors:validate.errors.slice(0,200).map(error=>({code:"SALES_INPUT_INVALID",field:(error.instancePath.slice(1).replaceAll("/",".")+(error.keyword==="required"?"."+error.params.missingProperty:"")).replace(/^\./u,"")||"order"}))};
 try{canonicalSalesPayload(input);}catch{return fail();}
 try{
  const order=input.order;salesDate(order.orderDate,"orderDate");if(order.requestedDeliveryDate!=null&&salesDate(order.requestedDeliveryDate,"requestedDeliveryDate")<order.orderDate)return fail("SALES_DATE_INVALID","requestedDeliveryDate");
  const payload={customerId:order.customerId,channelCode:identity.code,currencyCode:order.currencyCode,orderDate:order.orderDate,requestedDeliveryDate:order.requestedDeliveryDate??null,warehouseCode:order.fulfillmentWarehouseCode,paymentTermCode:order.paymentTermCode??"",customerPoReference:order.customerPoReference??"",notes:order.notes??"",lines:order.lines.map((line,index)=>({skuCode:line.skuCode,salesUomCode:line.salesUomCode,quantity:normalizeQuantity(line.quantity),unitSellingPrice:normalizeMoney(line.unitSellingPrice),lineNote:line.lineNote??"",rowNumbers:[index+1]}))};
  return {errors:[],group:{sourceOrderKey:input.idempotencyKey,externalOrderId:order.externalOrderId,channelCode:identity.code,payload,errors:[],firstRowNo:1,lastRowNo:order.lines.length,rowCount:order.lines.length}};
 }catch(error){return fail(["SALES_DATE_INVALID","SALES_QUANTITY_INVALID","SALES_PRICE_INVALID"].includes(error.code)?error.code:"SALES_INPUT_INVALID",error.publicDetails?.field??"order");}
}
