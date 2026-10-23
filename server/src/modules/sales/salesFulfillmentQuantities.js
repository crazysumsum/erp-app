import { assertQuantityConservation } from "./salesQuantityMath.js";
import { transitionSalesOrder } from "./salesOrderStateMachine.js";
import { salesError } from "./salesErrors.js";

const PARTS=["orderedBaseQuantity","reservedOutstandingBaseQuantity","backorderedBaseQuantity","fulfilledBaseQuantity","cancelledBaseQuantity"];
const mismatch=()=>{throw salesError("SALES_FULFILLMENT_CONTRACT_MISMATCH");};
const version=value=>{if(!Number.isSafeInteger(value)||value<1||value>4294967295)mismatch();return value;};
function quantity(value,positive=false){
  if(typeof value!=="string"||value.length>16||! /^(0|[1-9][0-9]*)$/u.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER)||positive&&value==="0")mismatch();
  return BigInt(value);
}

// Plans only Sales quantities. The transaction provider separately verifies the real Inventory receipt and Reservation ownership.
export function planSalesFulfillmentQuantities(order,{action,lines}={}){
  if(!order||!["SHIPMENT_CONFIRMED","SHIPMENT_REVERSED"].includes(action)||!Array.isArray(order.lines)||!order.lines.length||order.lines.length>100||!Array.isArray(lines)||!lines.length||lines.length>100)mismatch();
  quantity(order.orderId,true);version(order.version);if(order.version===4294967295)mismatch();
  const current=new Map();
  for(const row of order.lines){
    if(!row||typeof row!=="object"||Array.isArray(row))mismatch();
    quantity(row.salesOrderLineId,true);version(row.version);if(current.has(row.salesOrderLineId))mismatch();
    const values=Object.fromEntries(PARTS.map(field=>[field,Number(quantity(row[field]))]));
    try{assertQuantityConservation(values);}catch{mismatch();}
    if(values.orderedBaseQuantity===0)mismatch();current.set(row.salesOrderLineId,row);
  }
  let previous=0n,total=0n;
  const result=lines.map(selected=>{
    if(!selected||typeof selected!=="object"||Array.isArray(selected))mismatch();
    const id=quantity(selected.salesOrderLineId,true),amount=quantity(selected.baseQuantity),row=current.get(selected.salesOrderLineId);
    if(id<=previous||!row||version(selected.expectedVersion)!==row.version)mismatch();previous=id;total+=amount;
    const after={...row};
    if(amount>0n){
      if(row.version===4294967295)mismatch();
      const from=action==="SHIPMENT_CONFIRMED"?"reservedOutstandingBaseQuantity":"fulfilledBaseQuantity",to=action==="SHIPMENT_CONFIRMED"?"fulfilledBaseQuantity":"reservedOutstandingBaseQuantity";
      if(quantity(row[from])<amount)mismatch();after[from]=(quantity(row[from])-amount).toString();after[to]=(quantity(row[to])+amount).toString();after.version+=1;
    }
    current.set(selected.salesOrderLineId,after);return after;
  });
  if(total===0n)mismatch();
  const all=[...current.values()],fulfilled=all.reduce((sum,row)=>sum+quantity(row.fulfilledBaseQuantity),0n),ordered=all.reduce((sum,row)=>sum+quantity(row.orderedBaseQuantity),0n);
  let status;
  try{
    // The state machine needs only zero/partial/all; totals across 100 individually safe Lines may exceed Number precision.
    status=transitionSalesOrder(order.status,action==="SHIPMENT_CONFIRMED"?"FULFILL":"REVERSE_SHIPMENT",{fulfilledBaseQuantity:fulfilled===0n?0:fulfilled===ordered?2:1,orderedBaseQuantity:2});
  }catch{mismatch();}
  return {orderId:order.orderId,status,version:order.version+1,lines:result.map(row=>({salesOrderLineId:row.salesOrderLineId,version:row.version,...Object.fromEntries(PARTS.map(field=>[field,row[field]]))}))};
}
