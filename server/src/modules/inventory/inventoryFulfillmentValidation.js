import { inventoryError } from "./inventoryErrors.js";

export function fulfillmentInventoryInvalid() { throw inventoryError("INVENTORY_INPUT_INVALID"); }
export function fulfillmentInventoryFields(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !names.includes(key))) fulfillmentInventoryInvalid();
}
export function fulfillmentInventoryId(value, { zero=false }={}) {
  if (typeof value !== "string" || value.length>16 || !/^(0|[1-9][0-9]*)$/u.test(value) ||
      BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER) || (!zero && value==="0")) fulfillmentInventoryInvalid();
  return value;
}
export function fulfillmentInventoryVersion(value) {
  if (!Number.isSafeInteger(value) || value<1 || value>4294967295) fulfillmentInventoryInvalid();
  return value;
}
const cmp=(a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
function ordered(rows, key) {
  if (rows.some((row,index)=>index>0 && cmp(rows[index-1][key],row[key])>=0)) fulfillmentInventoryInvalid();
}
function total(rows) { return rows.reduce((sum,row)=>sum+BigInt(row.baseQuantity),0n); }
function reason(value) {
  if (typeof value!=="string" || [...value].length>500 || /[\p{Cc}\p{Cf}]/u.test(value)) fulfillmentInventoryInvalid();
  return value.trim();
}

export function normalizeFulfillmentInventoryBatch(action, payload) {
  if (!["ALLOCATE","RELEASE","REALLOCATE","ISSUE","REVERSE"].includes(action)) fulfillmentInventoryInvalid();
  const shipment=["ISSUE","REVERSE"].includes(action),allocate=["ALLOCATE","REALLOCATE"].includes(action);
  fulfillmentInventoryFields(payload,["fulfillmentId","lines",...(shipment?["shipmentId"]:[])]);
  const fulfillmentId=fulfillmentInventoryId(payload.fulfillmentId),shipmentId=shipment?fulfillmentInventoryId(payload.shipmentId):undefined;
  if (!Array.isArray(payload.lines)||!payload.lines.length||payload.lines.length>100) fulfillmentInventoryInvalid();
  const reservations=new Set(),claims=new Set(),allocations=new Set(),movements=new Set(),lineIds=new Set(),balanceVersions=new Map();
  const lines=payload.lines.map(line=>{
    fulfillmentInventoryFields(line,["fulfillmentLineId","salesOrderLineId","baseQuantity","reservations"]);
    const fulfillmentLineId=fulfillmentInventoryId(line.fulfillmentLineId),salesOrderLineId=fulfillmentInventoryId(line.salesOrderLineId),baseQuantity=fulfillmentInventoryId(line.baseQuantity,{zero:true});
    if (lineIds.has(fulfillmentLineId)||!Array.isArray(line.reservations)||line.reservations.length>50) fulfillmentInventoryInvalid();
    lineIds.add(fulfillmentLineId);
    let newCount=0,oldCount=0;
    const members=line.reservations.map(member=>{
      fulfillmentInventoryFields(member,["claimId","inventoryReservationId","expectedVersion","baseQuantity","allocations",...(allocate?["overrideReason"]:[]),...(action==="REALLOCATE"?["releases"]:[]),...(action==="REVERSE"?["originalInventoryOperationId"]:[])]);
      const claimId=fulfillmentInventoryId(member.claimId),inventoryReservationId=fulfillmentInventoryId(member.inventoryReservationId),quantity=fulfillmentInventoryId(member.baseQuantity);
      if (claims.has(claimId)||reservations.has(inventoryReservationId)) fulfillmentInventoryInvalid();
      claims.add(claimId);reservations.add(inventoryReservationId);
      function legs(rows,kind) {
        const reverse=kind==="REVERSE",create=kind==="ALLOCATE";
        if (!Array.isArray(rows)||!rows.length||rows.length>50) fulfillmentInventoryInvalid();
        const result=rows.map(leg=>{
          fulfillmentInventoryFields(leg,["baseQuantity","expectedBalanceVersion",...(reverse?["inventoryAllocationId","shipmentIssueId","originalMovementId"]:create?["inventoryBalanceId"]:["inventoryAllocationId","inventoryBalanceId","expectedVersion"])]);
          const r={...(!create?{inventoryAllocationId:fulfillmentInventoryId(leg.inventoryAllocationId)}:{}),
            ...(!reverse?{inventoryBalanceId:fulfillmentInventoryId(leg.inventoryBalanceId)}:{}),
            ...(!create&&!reverse?{expectedVersion:fulfillmentInventoryVersion(leg.expectedVersion)}:{}),
            expectedBalanceVersion:fulfillmentInventoryVersion(leg.expectedBalanceVersion),baseQuantity:fulfillmentInventoryId(leg.baseQuantity),
            ...(reverse?{shipmentIssueId:fulfillmentInventoryId(leg.shipmentIssueId),originalMovementId:fulfillmentInventoryId(leg.originalMovementId)}:{})};
          if (!create) { if (allocations.has(r.inventoryAllocationId)) fulfillmentInventoryInvalid();allocations.add(r.inventoryAllocationId); }
          if (reverse) { if (movements.has(r.originalMovementId)) fulfillmentInventoryInvalid();movements.add(r.originalMovementId); }
          if (r.inventoryBalanceId) {
            const prior=balanceVersions.get(r.inventoryBalanceId);
            if (prior!==undefined&&prior!==r.expectedBalanceVersion) fulfillmentInventoryInvalid();
            balanceVersions.set(r.inventoryBalanceId,r.expectedBalanceVersion);
          }
          return r;
        });
        ordered(result,create?"inventoryBalanceId":"inventoryAllocationId");
        if (total(result)!==BigInt(quantity)) fulfillmentInventoryInvalid();
        return result;
      }
      const selected=legs(member.allocations,allocate?"ALLOCATE":action);
      newCount+=selected.length;
      const releases=action==="REALLOCATE"?legs(member.releases,"RELEASE"):undefined;
      oldCount+=releases?.length??0;
      return {claimId,inventoryReservationId,expectedVersion:fulfillmentInventoryVersion(member.expectedVersion),baseQuantity:quantity,
        allocations:selected,...(allocate?{overrideReason:reason(member.overrideReason??"")} : {}),
        ...(releases?{releases}:{}),...(action==="REVERSE"?{originalInventoryOperationId:fulfillmentInventoryId(member.originalInventoryOperationId)}:{})};
    });
    ordered(members,"inventoryReservationId");
    if (newCount>50||oldCount>50||total(members)!==BigInt(baseQuantity)) fulfillmentInventoryInvalid();
    return {fulfillmentLineId,salesOrderLineId,baseQuantity,reservations:members};
  });
  ordered(lines,"salesOrderLineId");
  if (total(lines)===0n) fulfillmentInventoryInvalid();
  return {fulfillmentId,...(shipment?{shipmentId}:{}),lines};
}
