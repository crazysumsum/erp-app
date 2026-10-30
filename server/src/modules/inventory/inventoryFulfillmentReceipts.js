import { createHash } from "node:crypto";
import { inventoryOperationHash } from "./InventoryOperationService.js";
import { FULFILLMENT_INVENTORY_COMMANDS } from "./inventoryFulfillmentConstants.js";
import { inventoryError } from "./inventoryErrors.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";

export function fulfillmentInventoryDigest(rows) {
  return createHash("sha256").update(rows.join("\n"),"utf8").digest("hex");
}
const compare=(left,right)=>BigInt(left)<BigInt(right)?-1:BigInt(left)>BigInt(right)?1:0;
const memberDigest=members=>fulfillmentInventoryDigest(members.map(m=>`${m.input.claimId}:${m.operationId}:${m.requestHash}`));
const legDigest=legs=>fulfillmentInventoryDigest(legs.map(l=>`${l.ordinal}:${l.operationId}:${l.requestHash}`));

export async function claimFulfillmentInventoryBatch(transaction, input) {
  const {operations,action,payload,source,actor,actorLabel,timestamp,correlationId}=input;
  const contract=FULFILLMENT_INVENTORY_COMMANDS[action];
  if (!contract) throw inventoryError("INVENTORY_INPUT_INVALID");
  const documentId=payload.shipmentId??payload.fulfillmentId;
  const rootSource={module:"FULFILLMENT",documentType:contract.documentType,documentId,lineId:"",eventId:source.eventId};
  const operationInput=(commandType,tuple,value)=>({commandType,source:tuple,payload:value,actorUserId:actor.userId,actorLabel,
    requestId:correlationId,correlationId,createdAt:timestamp});
  const rootInput=operationInput(contract.root,rootSource,payload);
  const requestHash=inventoryOperationHash(rootInput);
  const root=await operations.claim(transaction,rootInput);
  const batch={operations,action,contract,payload,source:rootSource,operationId:root.operationId,requestHash,timestamp,members:[],replay:root.replay};
  if (root.replay) return batch;
  const members=payload.lines.flatMap(line=>line.reservations.map(member=>({line,input:member})))
    .sort((a,b)=>compare(a.input.claimId,b.input.claimId));
  let pending=[];
  const flush=async()=>{
    if(!pending.length)return;
    const claims=await operations.claimReallocationChildren(transaction,pending.map(entry=>entry.input));
    for(const [index,entry]of pending.entries())entry.accept(claims[index]);
    pending=[];
  };
  const claimChild=async(input,accept)=>{
    if(action!=="REALLOCATE"){const claim=await operations.claim(transaction,input);if(claim.replay)throw inventoryError("INVENTORY_SOURCE_CONFLICT");accept(claim);return;}
    pending.push({input,accept});if(pending.length===100)await flush();
  };
  for (const member of members) {
    const value={rootRequestHash:requestHash,fulfillmentLineId:member.line.fulfillmentLineId,
      salesOrderLineId:member.line.salesOrderLineId,...member.input};
    const childInput=operationInput(contract.member,{...rootSource,lineId:member.input.claimId},value);
    await claimChild(childInput,child=>batch.members.push({...member,operationId:child.operationId,requestHash:inventoryOperationHash(childInput),legs:[]}));
  }
  await flush();
  for (const member of batch.members) {
    const inputs=[...(member.input.releases??[]).map(leg=>({kind:"RELEASE",input:leg})),
      ...member.input.allocations.map(leg=>({kind:action==="REALLOCATE"?"ALLOCATE":action,input:leg}))];
    for (const [index,leg] of inputs.entries()) {
      const ordinal=index+1;
      const value={rootRequestHash:requestHash,claimId:member.input.claimId,legOrdinal:ordinal,legKind:leg.kind,input:leg.input};
      const legInput=operationInput("FULFILLMENT_BATCH_LEG",{...rootSource,documentType:contract.documentType+"_LEG",lineId:`${member.input.claimId}:${ordinal}`},value);
      await claimChild(legInput,claim=>member.legs.push({...leg,ordinal,operationId:claim.operationId,requestHash:inventoryOperationHash(legInput)}));
    }
  }
  await flush();
  return batch;
}

export async function completeFulfillmentInventoryBatch(transaction,batch) {
  let pending=[];
  const complete=async(operationId,resultType,resultId,resultSummary)=>{
    pending.push({operationId,resultType,resultId,resultSummary,completedAt:batch.timestamp});
    if(pending.length===100){await batch.operations.completeBatch(transaction,pending);pending=[];}
  };
  for (const member of batch.members) {
    for (const leg of member.legs) {
      if (!leg.result) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      await complete(leg.operationId,"FULFILLMENT_LEG",leg.result.inventoryAllocationId,
        {...leg.result,rootOperationId:String(batch.operationId),rootRequestHash:batch.requestHash,
          memberOperationId:String(member.operationId),legOrdinal:leg.ordinal,legKind:leg.kind});
    }
    if (!Number.isSafeInteger(member.version)||member.version!==member.input.expectedVersion+1) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    await complete(member.operationId,batch.contract.result,member.input.claimId,
      {rootOperationId:String(batch.operationId),rootRequestHash:batch.requestHash,
        claimId:member.input.claimId,inventoryReservationId:member.input.inventoryReservationId,
        expectedVersion:member.input.expectedVersion,version:member.version,baseQuantity:member.input.baseQuantity,
        fulfillmentLineId:member.line.fulfillmentLineId,salesOrderLineId:member.line.salesOrderLineId,
        ...(member.input.originalInventoryOperationId?{originalInventoryOperationId:member.input.originalInventoryOperationId}:{}),
        legCount:member.legs.length,legDigest:legDigest(member.legs)});
  }
  for(const entry of pending)await batch.operations.complete(transaction,entry);
  await batch.operations.complete(transaction,{operationId:batch.operationId,resultType:batch.contract.root,resultId:batch.source.documentId,
    resultSummary:{fulfillmentId:batch.payload.fulfillmentId,memberCount:batch.members.length,membershipDigest:memberDigest(batch.members),
      lineSnapshot:JSON.stringify(batch.payload.lines.map(line=>[line.fulfillmentLineId,line.salesOrderLineId,line.baseQuantity]))},completedAt:batch.timestamp});
}

const receiptFailure=()=>{throw inventoryError("INVENTORY_SOURCE_CONFLICT");};
function summary(row) {
  let result;
  try { result=typeof row.result_summary==="string"?JSON.parse(row.result_summary):row.result_summary; }
  catch { receiptFailure(); }
  if (!result||typeof result!=="object"||Array.isArray(result)||Buffer.byteLength(JSON.stringify(result),"utf8")>8192) receiptFailure();
  return result;
}
function identity(value,zero=false) {
  const text=typeof value==="number"&&Number.isSafeInteger(value)?String(value):value;
  if (typeof text!=="string"||text.length>16||!/^(0|[1-9][0-9]*)$/u.test(text)||BigInt(text)>BigInt(Number.MAX_SAFE_INTEGER)||(!zero&&text==="0")) receiptFailure();
  return text;
}
function receiptVersion(value) {
  if (!Number.isSafeInteger(value)||value<1||value>4294967295) receiptFailure();
  return value;
}
function completed(row,type,id) {
  if (!row||row.completed_at===null||row.completed_at===undefined||row.result_type!==type||String(row.result_id)!==id) receiptFailure();
}
async function receiptRows(tx,source,type,resultType,max,locking) {
  const rows=[];let after="0";
  while (true) {
    const [page]=await tx.query(`SELECT * FROM inventory_operation_requests
      WHERE source_module='FULFILLMENT' AND source_document_type=? AND source_document_id=?
        AND source_event_id=? AND command_type=? AND result_type=? AND completed_at IS NOT NULL
        AND source_line_id<>'' AND id>? ORDER BY id LIMIT 100 ${locking?'FOR SHARE':''}`,
    [source.documentType,source.documentId,source.eventId,type,resultType,after]);
    rows.push(...page);
    if (rows.length>max) receiptFailure();
    if (page.length<100) return rows;
    after=identity(page.at(-1).id);
  }
}
function snapshot(movement,leg) {
  if (typeof leg.baseUomCode!=="string"||!leg.baseUomCode||leg.baseUomCode.length>100||/[\p{Cc}]/u.test(leg.baseUomCode)||!Number.isSafeInteger(Number(movement.posted_at))||Number(movement.posted_at)<0) receiptFailure();
  return {warehouseId:identity(movement.warehouse_id),warehouseCode:movement.warehouse_code_snapshot,
    binId:identity(movement.bin_id),binCode:movement.bin_code_snapshot,lotId:movement.lot_id===null?null:identity(movement.lot_id),
    lotNumber:movement.lot_id===null?null:movement.lot_number_snapshot,expiryDate:movement.expiry_date_snapshot,
    stockStatus:movement.stock_status,skuId:identity(movement.sku_id),skuCode:movement.sku_code_snapshot,skuName:movement.sku_name_snapshot,
    baseUomId:identity(leg.baseUomId),baseUomCode:leg.baseUomCode,postedAt:Number(movement.posted_at)};
}

function calendarDate(value) {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/u.test(value))return false;
  const epoch=Date.parse(value+"T00:00:00.000Z");
  return Number.isFinite(epoch)&&new Date(epoch).toISOString().slice(0,10)===value;
}
function allocationSnapshot(value) {
  let bucket;
  try {bucket=JSON.parse(value);}catch {receiptFailure();}
  const fields=["warehouseId","warehouseCode","binId","binCode","lotId","lotNumber","expiryDate","stockStatus","skuId","skuCode","skuName","baseUomId","baseUomCode","postedAt"];
  if(!bucket||typeof bucket!=="object"||Array.isArray(bucket)||Object.keys(bucket).length!==fields.length||Object.keys(bucket).some(k=>!fields.includes(k)))receiptFailure();
  for(const key of ["warehouseId","binId","skuId","baseUomId"])if(identity(bucket[key])!==bucket[key])receiptFailure();
  if(bucket.lotId!==null&&identity(bucket.lotId)!==bucket.lotId)receiptFailure();
  for(const key of ["warehouseCode","binCode","skuCode","skuName","baseUomCode"])if(typeof bucket[key]!=="string"||!bucket[key]||[...bucket[key]].length>190||/[\p{Cc}]/u.test(bucket[key]))receiptFailure();
  if(bucket.lotId===null?bucket.lotNumber!==null:typeof bucket.lotNumber!=="string"||!bucket.lotNumber||[...bucket.lotNumber].length>100||/[\p{Cc}]/u.test(bucket.lotNumber))receiptFailure();
  if(bucket.expiryDate!==null&&(!calendarDate(bucket.expiryDate)||bucket.lotId===null))receiptFailure();
  if(bucket.stockStatus!=="AVAILABLE"||!Number.isSafeInteger(bucket.postedAt)||bucket.postedAt<0)receiptFailure();
  return bucket;
}

function allocationRecommendation(value,balanceId,overridden,bucket) {
  if(!overridden){if(value!==null)receiptFailure();return null;}
  let result;
  try{result=JSON.parse(value);}catch{receiptFailure();}
  const fields=["recommendedBalanceId","recommendedExpiryDate","selectedBalanceId","selectedExpiryDate"];
  if(!result||typeof result!=="object"||Array.isArray(result)||Object.keys(result).length!==4||Object.keys(result).some(k=>!fields.includes(k))||identity(result.selectedBalanceId)!==balanceId)receiptFailure();
  identity(result.recommendedBalanceId);
  for(const key of ["recommendedExpiryDate","selectedExpiryDate"])if(result[key]!==null&&!calendarDate(result[key]))receiptFailure();
  if(result.selectedExpiryDate!==bucket.expiryDate||result.recommendedBalanceId===balanceId&&result.recommendedExpiryDate!==result.selectedExpiryDate)receiptFailure();
  return result;
}

// Owner-only decoder shared by original replay and Sales verification; never locks an arbitrary operation FOR UPDATE.
export async function readFulfillmentInventoryBatch(tx,{action,operationId,documentId,eventId,requestHash,locking=true}) {
  const contract=FULFILLMENT_INVENTORY_COMMANDS[action];
  if (!contract||typeof requestHash!=="string"||!/^[a-f0-9]{64}$/u.test(requestHash)) receiptFailure();
  const source={documentType:contract.documentType,documentId:identity(documentId),eventId};
  const [[root]]=await tx.query(`SELECT * FROM inventory_operation_requests WHERE id=?
    AND source_module='FULFILLMENT' AND source_document_type=? AND source_document_id=?
    AND source_event_id=? AND source_line_id='' ${locking?'FOR SHARE':''}`,[identity(operationId),source.documentType,source.documentId,eventId]);
  completed(root,contract.root,source.documentId);
  if (root.command_type!==contract.root||root.request_hash!==requestHash) receiptFailure();
  const rootSummary=summary(root);
  let tuples;
  try { tuples=JSON.parse(rootSummary.lineSnapshot); } catch { receiptFailure(); }
  if (!Array.isArray(tuples)||!tuples.length||tuples.length>100||!Number.isSafeInteger(rootSummary.memberCount)||rootSummary.memberCount<1||rootSummary.memberCount>5000) receiptFailure();
  const lineIds=new Set(),salesIds=new Set();
  const lines=tuples.map(tuple=>{
    if (!Array.isArray(tuple)||tuple.length!==3) receiptFailure();
    const [fulfillmentLineId,salesOrderLineId,baseQuantity]=[identity(tuple[0]),identity(tuple[1]),identity(tuple[2],true)];
    if (lineIds.has(fulfillmentLineId)||salesIds.has(salesOrderLineId)) receiptFailure();
    lineIds.add(fulfillmentLineId);salesIds.add(salesOrderLineId);
    return {fulfillmentLineId,salesOrderLineId,baseQuantity,reservations:[]};
  });
  if (lines.some((line,index)=>index>0&&compare(lines[index-1].salesOrderLineId,line.salesOrderLineId)>=0)) receiptFailure();
  const memberRows=await receiptRows(tx,source,contract.member,contract.result,5000,locking);
  const members=memberRows.map(row=>{const value=summary(row);identity(value.claimId);return {row,value};}).sort((a,b)=>compare(a.value.claimId,b.value.claimId));
  const memberOperationIds=new Set(members.map(member=>identity(member.row.id)));
  if (members.length!==rootSummary.memberCount||fulfillmentInventoryDigest(members.map(m=>`${m.value.claimId}:${identity(m.row.id)}:${m.row.request_hash}`))!==rootSummary.membershipDigest) receiptFailure();
  const aux=await receiptRows(tx,{...source,documentType:source.documentType+"_LEG"},"FULFILLMENT_BATCH_LEG","FULFILLMENT_LEG",action==="REALLOCATE"?10000:5000,locking);
  const legsByMember=new Map();
  for (const row of aux) {
    const leg=summary(row),memberId=identity(leg.memberOperationId);
    if (leg.rootOperationId!==identity(root.id)||leg.rootRequestHash!==requestHash||!memberOperationIds.has(memberId)) receiptFailure();
    const list=legsByMember.get(memberId)??[];list.push({row,value:leg});legsByMember.set(memberId,list);
  }
  const movementIds=aux.flatMap(row=>{const id=summary(row).movementId;return id===undefined?[]:[identity(id)];});
  if (new Set(movementIds).size!==movementIds.length) receiptFailure();
  const movementLock=locking||getActiveTransactionIsolation(tx)!=="READ COMMITTED";
  const [movementRows]=movementIds.length?await tx.query(`SELECT m.*, DATE_FORMAT(m.expiry_date_snapshot,'%Y-%m-%d') AS expiry_date_snapshot
      FROM inventory_movements m WHERE m.id IN (${movementIds.map(()=>"?").join(",")}) ORDER BY m.id ${movementLock?'FOR SHARE OF m':''}`,movementIds):[[]];
  const movements=new Map(movementRows.map(m=>[identity(m.id),m]));
  const claims=new Set(),reservations=new Set();let seenLegs=0;
  for (const {row,value} of members) {
    const claimId=identity(value.claimId),reservationId=identity(value.inventoryReservationId),id=identity(row.id);
    completed(row,contract.result,claimId);
    if (claims.has(claimId)||reservations.has(reservationId)||row.source_line_id!==claimId||value.rootOperationId!==identity(root.id)||value.rootRequestHash!==requestHash||
        receiptVersion(value.version)!==receiptVersion(value.expectedVersion)+1) receiptFailure();
    claims.add(claimId);reservations.add(reservationId);
    const line=lines.find(l=>l.fulfillmentLineId===value.fulfillmentLineId&&l.salesOrderLineId===value.salesOrderLineId);
    if (!line) receiptFailure();
    const legs=(legsByMember.get(id)??[]).sort((a,b)=>a.value.legOrdinal-b.value.legOrdinal);
    if (!Number.isSafeInteger(value.legCount)||value.legCount<1||value.legCount>10000||legs.length!==value.legCount||
        fulfillmentInventoryDigest(legs.map(l=>`${l.value.legOrdinal}:${identity(l.row.id)}:${l.row.request_hash}`))!==value.legDigest) receiptFailure();
    const result={claimId,inventoryReservationId:reservationId,expectedVersion:value.expectedVersion,version:value.version,
      baseQuantity:identity(value.baseQuantity),inventoryOperationId:id,allocations:[],...(action==="REALLOCATE"?{releases:[]}:{}),
      ...(action==="REVERSE"?{originalInventoryOperationId:identity(value.originalInventoryOperationId)}:{})};
    for (const [index,leg] of legs.entries()) {
      const v=leg.value;
      if (v.legOrdinal!==index+1||leg.row.source_line_id!==`${claimId}:${index+1}`) receiptFailure();
      const allocationId=identity(v.inventoryAllocationId),balanceId=identity(v.inventoryBalanceId),quantity=identity(v.baseQuantity);
      completed(leg.row,"FULFILLMENT_LEG",allocationId);
      const output={inventoryAllocationId:allocationId,inventoryBalanceId:balanceId,baseQuantity:quantity,
        allocationVersion:receiptVersion(v.allocationVersion),balanceVersion:receiptVersion(v.balanceVersion)};
      if (["ISSUE","REVERSE"].includes(action)) {
        const movement=movements.get(identity(v.movementId));
        if (!movement||identity(movement.operation_request_id)!==id||identity(movement.reservation_id)!==reservationId||identity(movement.allocation_id)!==allocationId||
            identity(movement.quantity)!==quantity||Number(movement.balance_version_after)!==output.balanceVersion||movement.movement_type!==(action==="ISSUE"?"ISSUE":"REVERSAL")||
            (action==="ISSUE"?movement.reversal_of_movement_id!==null:identity(movement.reversal_of_movement_id)!==identity(v.originalMovementId))) receiptFailure();
        const before=BigInt(identity(movement.balance_before,true)),after=BigInt(identity(movement.balance_after,true));
        if (movement.location_kind!=="BIN"||movement.direction!==(action==="ISSUE"?"OUT":"IN")||
            after!==before+(action==="ISSUE"?-BigInt(quantity):BigInt(quantity))) receiptFailure();
        Object.assign(output,{movementId:identity(movement.id),bucketSnapshot:snapshot(movement,v)},
          action==="REVERSE"?{shipmentIssueId:identity(v.shipmentIssueId),originalMovementId:identity(v.originalMovementId)}:{});
      } else {
        if(v.legKind==="ALLOCATE") {
          if(!["FEFO","FIFO"].includes(v.selectionStrategy)||typeof v.isSequenceOverride!=="boolean"||!Number.isSafeInteger(v.recommendedRank)||v.recommendedRank<1)receiptFailure();
          const bucket=allocationSnapshot(v.bucketSnapshot);
          Object.assign(output,{selectionStrategy:v.selectionStrategy,isSequenceOverride:v.isSequenceOverride,recommendedRank:v.recommendedRank,
            bucketSnapshot:bucket,recommendedSummary:allocationRecommendation(v.recommendedSummary,balanceId,v.isSequenceOverride,bucket)});
          if((output.bucketSnapshot.expiryDate!==null)!==(v.selectionStrategy==="FEFO"))receiptFailure();
        } else {
          if(!["ACTIVE","PARTIALLY_CONSUMED","RELEASED"].includes(v.status))receiptFailure();
          Object.assign(output,{status:v.status,releasedQuantity:identity(v.releasedQuantity,true),outstandingQuantity:identity(v.outstandingQuantity,true)});
          if(BigInt(output.releasedQuantity)<BigInt(quantity)||(output.status==="RELEASED")!==(output.outstandingQuantity==="0"))receiptFailure();
        }
      }
      if (action==="REALLOCATE"&&v.legKind==="RELEASE") result.releases.push(output);
      else {
        if (v.legKind!==(action==="REALLOCATE"?"ALLOCATE":action)) receiptFailure();
        result.allocations.push(output);
      }
    }
    for (const list of [result.allocations,...(result.releases?[result.releases]:[])]) {
      if (list.reduce((sum,leg)=>sum+BigInt(leg.baseQuantity),0n)!==BigInt(result.baseQuantity)) receiptFailure();
    }
    seenLegs+=legs.length;line.reservations.push(result);
  }
  if (seenLegs!==aux.length) receiptFailure();
  for (const line of lines) {
    line.reservations.sort((a,b)=>compare(a.inventoryReservationId,b.inventoryReservationId));
    if (line.reservations.reduce((sum,m)=>sum+BigInt(m.baseQuantity),0n)!==BigInt(line.baseQuantity)) receiptFailure();
    if (line.reservations.reduce((count,m)=>count+m.allocations.length,0)>50||
        line.reservations.reduce((count,m)=>count+(m.releases?.length??0),0)>50) receiptFailure();
  }
  const result={operationId:identity(root.id),lines};
  if (action==="REVERSE") {
    const original=await readOriginalFulfillmentIssueBatch(tx,{shipmentId:source.documentId,
      members:result.lines.flatMap(line=>line.reservations)});
    assertReversedIssueReceipt(result,original.result);
  }
  return {result,members,root,fulfillmentId:identity(rootSummary.fulfillmentId)};
}


export async function readOriginalFulfillmentIssueBatch(tx,{shipmentId,members}) {
  const ids=members.map(member=>identity(member.originalInventoryOperationId));
  if (!ids.length||ids.length>5000||new Set(ids).size!==ids.length) receiptFailure();
  const [rows]=await tx.query(`SELECT * FROM inventory_operation_requests WHERE id IN (${ids.map(()=>"?").join(",")}) ORDER BY id`,ids);
  if (rows.length!==ids.length) receiptFailure();
  const rootIds=new Set(),events=new Set(),hashes=new Set();
  for (const row of rows) {
    if (row.command_type!=="ISSUE_POST"||row.source_module!=="FULFILLMENT"||row.source_document_type!=="SHIPMENT"||row.source_document_id!==shipmentId) receiptFailure();
    completed(row,"FULFILLMENT_ISSUE_MEMBER",row.source_line_id);
    const value=summary(row);rootIds.add(identity(value.rootOperationId));events.add(row.source_event_id);hashes.add(value.rootRequestHash);
  }
  if (rootIds.size!==1||events.size!==1||hashes.size!==1) receiptFailure();
  return readFulfillmentInventoryBatch(tx,{action:"ISSUE",operationId:[...rootIds][0],documentId:shipmentId,
    eventId:[...events][0],requestHash:[...hashes][0],locking:false});
}

export function assertReversedIssueReceipt(reversed,original) {
  if (reversed.lines.length!==original.lines.length) receiptFailure();
  for (const line of reversed.lines) {
    const old=original.lines.find(l=>l.fulfillmentLineId===line.fulfillmentLineId&&l.salesOrderLineId===line.salesOrderLineId);
    if (!old||old.baseQuantity!==line.baseQuantity||old.reservations.length!==line.reservations.length) receiptFailure();
    for (const member of line.reservations) {
      const previous=old.reservations.find(m=>m.claimId===member.claimId&&m.inventoryReservationId===member.inventoryReservationId);
      if (!previous||previous.inventoryOperationId!==member.originalInventoryOperationId||previous.baseQuantity!==member.baseQuantity||previous.allocations.length!==member.allocations.length) receiptFailure();
      for (const leg of member.allocations) {
        const prior=previous.allocations.find(l=>l.movementId===leg.originalMovementId&&l.inventoryAllocationId===leg.inventoryAllocationId);
        if (!prior||prior.baseQuantity!==leg.baseQuantity||prior.inventoryBalanceId!==leg.inventoryBalanceId) receiptFailure();
        for (const key of Object.keys(prior.bucketSnapshot)) if (key!=="postedAt"&&prior.bucketSnapshot[key]!==leg.bucketSnapshot[key]) receiptFailure();
      }
    }
  }
}
