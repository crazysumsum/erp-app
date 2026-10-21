import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { SalesAuditService } from "./SalesAuditService.js";
import { salesPayloadHash } from "./salesCanonicalHash.js";
import { salesEventId } from "./salesValidation.js";
import { salesError } from "./salesErrors.js";
import { planSalesFulfillmentQuantities } from "./salesFulfillmentQuantities.js";

const mismatch=()=>{throw salesError("SALES_FULFILLMENT_CONTRACT_MISMATCH");};
const object=value=>value&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&!Array.isArray(value);
function fields(value,names){if(!object(value)||Object.keys(value).sort().join(",")!==names.split(",").sort().join(","))mismatch();}
function integer(value,positive=true){if(typeof value!=="string"||value.length>16||!/^(0|[1-9][0-9]*)$/u.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER)||positive&&value==="0")mismatch();return value;}
function version(value){if(!Number.isSafeInteger(value)||value<1||value>4294967295)mismatch();return value;}
function epoch(value){if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)mismatch();return value;}
function event(value){try{return salesEventId(value).toLowerCase();}catch{mismatch();}}
function hash(value){if(typeof value!=="string"||!/^[a-f0-9]{64}$/u.test(value))mismatch();return value;}
function dbInteger(value,positive=true){return integer(typeof value==="number"&&Number.isSafeInteger(value)?String(value):value,positive);}
function freeze(value){if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function strings(value){if(!Array.isArray(value)||value.some(s=>typeof s!=="string"||!s||s.length>190)||new Set(value).size!==value.length)mismatch();return [...value];}
const keys=rows=>rows.map(row=>dbInteger(row.id)).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
const placeholders=values=>values.map(()=>"?").join(",");
const json=value=>{try{return typeof value==="string"?JSON.parse(value):value;}catch{mismatch();}};

export function normalizeSalesFulfillmentIntent(command){
  const purpose=command?.purpose,shipment=purpose!=="CLAIM",reverse=purpose==="SHIPMENT_REVERSED";
  if(!["CLAIM","SHIPMENT_CONFIRMED","SHIPMENT_REVERSED"].includes(purpose))mismatch();
  fields(command,"actor,purpose,salesOrderId,expectedOrderVersion,lines"+(shipment?",eventId,shipmentId,inventoryRequestHash":"")+(reverse?",originalConfirmationEventId":""));
  fields(command.actor,"userId,serviceName,claimedRoles,claimedPermissions");if(command.actor.serviceName!=="")mismatch();
  const actor={userId:integer(command.actor.userId),serviceName:"",claimedRoles:strings(command.actor.claimedRoles),claimedPermissions:strings(command.actor.claimedPermissions)};
  if(!Array.isArray(command.lines)||!command.lines.length||command.lines.length>100)mismatch();
  if(command.lines.reduce((count,line)=>count+(Array.isArray(line?.reservations)?line.reservations.length:0),0)>5000)mismatch();
  let previous=0n,total=0n;const reservations=new Set(),claims=new Set();
  const lines=command.lines.map(line=>{
    fields(line,"salesOrderLineId,expectedVersion,baseQuantity,reservations");const id=integer(line.salesOrderLineId),q=integer(line.baseQuantity,false);
    if(BigInt(id)<=previous||!Array.isArray(line.reservations))mismatch();previous=BigInt(id);total+=BigInt(q);
    let previousReservation=0n,sum=0n;
    const members=line.reservations.map(member=>{
      fields(member,"claimId,inventoryReservationId,expectedVersion,baseQuantity"+(reverse?",originalInventoryOperationId":""));
      const claimId=integer(member.claimId),inventoryReservationId=integer(member.inventoryReservationId),baseQuantity=integer(member.baseQuantity);
      if(BigInt(inventoryReservationId)<=previousReservation||reservations.has(inventoryReservationId)||claims.has(claimId))mismatch();
      previousReservation=BigInt(inventoryReservationId);reservations.add(inventoryReservationId);claims.add(claimId);sum+=BigInt(baseQuantity);
      return {claimId,inventoryReservationId,expectedVersion:version(member.expectedVersion),baseQuantity,...(reverse?{originalInventoryOperationId:integer(member.originalInventoryOperationId)}:{})};
    });
    if(sum!==BigInt(q))mismatch();return {salesOrderLineId:id,expectedVersion:version(line.expectedVersion),baseQuantity:q,reservations:members};
  });
  if(total===0n)mismatch();
  const result={actor,purpose,salesOrderId:integer(command.salesOrderId),expectedOrderVersion:version(command.expectedOrderVersion),...(shipment?{eventId:event(command.eventId),shipmentId:integer(command.shipmentId),inventoryRequestHash:hash(command.inventoryRequestHash)}:{}),...(reverse?{originalConfirmationEventId:event(command.originalConfirmationEventId)}:{}),lines};
  if(reverse&&result.originalConfirmationEventId===result.eventId)mismatch();return freeze(result);
}
export function salesFulfillmentIntentHash(intent){return salesPayloadHash({...intent,actor:{userId:intent.actor.userId},source:{module:"FULFILLMENT",documentType:"SHIPMENT"}});}
const quantities=row=>({salesOrderLineId:dbInteger(row.id),version:version(Number(row.version)),orderedBaseQuantity:dbInteger(row.ordered_base_quantity),reservedOutstandingBaseQuantity:dbInteger(row.reserved_outstanding_base_quantity,false),backorderedBaseQuantity:dbInteger(row.backordered_base_quantity,false),fulfilledBaseQuantity:dbInteger(row.fulfilled_base_quantity,false),cancelledBaseQuantity:dbInteger(row.cancelled_base_quantity,false)});
const memberIdentity=intent=>intent.lines.map(line=>({salesOrderLineId:line.salesOrderLineId,baseQuantity:line.baseQuantity,reservations:line.reservations.map(member=>({claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,baseQuantity:member.baseQuantity}))}));

export class SalesFulfillmentService {
  #receipts=new WeakMap();
  constructor({database,context=database?.context,time,logger,itemProvider,inventoryFulfillment,audit=new SalesAuditService()}={}){Object.assign(this,{database,context,time,logger,itemProvider,inventoryFulfillment,audit});}
  #transaction(tx){if(typeof tx?.query!=="function"||typeof tx?.execute!=="function"||this.context?.get()?.databaseTransaction!==tx)mismatch();}
  async #actor(tx,intent){
    const claims=this.context?.get()?.auth?.claims,actorId=claims&&Number(claims.sub);
    if(!Number.isSafeInteger(actorId)||actorId<1||intent&&String(actorId)!==intent.actor.userId)throw new ApplicationError("Authenticated Fulfillment actor required",{code:"FORBIDDEN",statusCode:403});
    const actor=await assertActorFresh(tx,{actorId,claimedRoles:claims.roles,claimedPermissions:claims.permissions});
    const required=intent?.purpose==="SHIPMENT_REVERSED"?"fulfillment.reverse":intent?"fulfillment.operation":"fulfillment.view";
    if(!actor.username||!["fulfillment.view",required].every(permission=>actor.permissions.includes(permission))||intent&&(salesPayloadHash([...intent.actor.claimedRoles].sort())!==salesPayloadHash([...actor.roles].sort())||salesPayloadHash([...intent.actor.claimedPermissions].sort())!==salesPayloadHash([...actor.permissions].sort())))throw new ApplicationError("Fresh Fulfillment permission required",{code:"FORBIDDEN",statusCode:403});
    return actor;
  }
  async getOrderForFulfillment(orderId,options){
    integer(orderId);fields(options,"atMs");epoch(options.atMs);
    const read=async tx=>{this.#transaction(tx);await this.#actor(tx);const data=await this.#readOrder(tx,orderId);if(!["CONFIRMED","PARTIALLY_FULFILLED"].includes(data.header.status))mismatch();return this.#projection(tx,data,options.atMs,true);};
    const tx=this.context?.get()?.databaseTransaction;return tx?read(tx):this.database.withTransaction(read);
  }
  async #readOrder(tx,orderId){
    const [[header]]=await tx.query("SELECT * FROM sales_orders WHERE id=?",[orderId]);if(!header)mismatch();
    const [lines]=await tx.query("SELECT * FROM sales_order_lines WHERE sales_order_id=? ORDER BY id",[orderId]);
    if(lines.length!==Number(header.line_count)||!lines.length||lines.length>100)mismatch();
    const ids=keys(lines),[mappings]=await tx.query(`SELECT * FROM sales_order_line_reservations WHERE sales_order_line_id IN (${placeholders(ids)}) ORDER BY id`,ids);
    return {header,lines,mappings};
  }
  async #lockOrder(tx,orderId){
    const [[header]]=await tx.query("SELECT * FROM sales_orders WHERE id=? FOR UPDATE",[orderId]);if(!header)mismatch();
    const [[snapshot]]=await tx.query("SELECT version FROM sales_orders WHERE id=?",[orderId]);
    // Auth may have opened an older RR read view. Do not use its Line/mapping IDs after a newer root was locked.
    if(Number(snapshot?.version)!==Number(header.version))throw salesError("CONCURRENT_OPERATION");
    const [lineIds]=await tx.query("SELECT id FROM sales_order_lines WHERE sales_order_id=? ORDER BY id",[orderId]),ids=keys(lineIds);
    if(ids.length!==Number(header.line_count)||!ids.length||ids.length>100)mismatch();
    const [lines]=await tx.query(`SELECT * FROM sales_order_lines WHERE id IN (${placeholders(ids)}) ORDER BY id FOR UPDATE`,ids);
    if(lines.length!==ids.length||lines.some(row=>dbInteger(row.sales_order_id)!==orderId))mismatch();
    const [mappingIds]=await tx.query(`SELECT id FROM sales_order_line_reservations WHERE sales_order_line_id IN (${placeholders(ids)}) ORDER BY id`,ids),mappingKeys=keys(mappingIds);
    const [mappings]=mappingKeys.length?await tx.query(`SELECT * FROM sales_order_line_reservations WHERE id IN (${placeholders(mappingKeys)}) ORDER BY id FOR UPDATE`,mappingKeys):[[]];
    if(mappings.length!==mappingKeys.length||mappings.some(row=>!ids.includes(dbInteger(row.sales_order_line_id))))mismatch();
    for(const line of lines){
      const owned=mappings.filter(m=>dbInteger(m.sales_order_line_id)===dbInteger(line.id));
      let outstanding=0n,consumed=0n;
      for(const m of owned){const o=BigInt(dbInteger(m.original_base_quantity)),c=BigInt(dbInteger(m.consumed_base_quantity,false)),r=BigInt(dbInteger(m.released_base_quantity,false)),left=BigInt(dbInteger(m.outstanding_base_quantity,false));if(o!==c+r+left)mismatch();outstanding+=left;consumed+=c;}
      if(outstanding!==BigInt(dbInteger(line.reserved_outstanding_base_quantity,false))||consumed!==BigInt(dbInteger(line.fulfilled_base_quantity,false)))mismatch();
    }
    return {header,lines,mappings};
  }
  async #projection(tx,data,atMs,eligible=false,selection=null){
    const lines=selection?data.lines.filter(row=>selection.includes(dbInteger(row.id))):data.lines;
    const provider=this.itemProvider??new ItemLookupService({database:tx,time:this.time,logger:this.logger});
    if(typeof provider.findManyByIds!=="function")throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    // This is a display projection. Fulfillment revalidates the real locking Item batch after its own roots, before Inventory effects.
    const skuIds=[...new Set(lines.map(row=>dbInteger(row.sku_id)))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),profiles=await provider.findManyByIds(skuIds.map(Number),{purpose:"inventory",atMs});
    if(!(profiles instanceof Map)||profiles.size!==skuIds.length||skuIds.some(id=>!profiles.has(Number(id))))mismatch();
    const projected=lines.map(row=>{
      const profile=profiles.get(Number(row.sku_id));if(!object(profile)||!Array.isArray(profile.uoms)||profile.uoms.some(uom=>!object(uom)))mismatch();const bases=profile.uoms.filter(uom=>uom.isBase);if(!Array.isArray(bases)||bases.length!==1||bases[0].toBaseFactor!==1)mismatch();const baseUom=bases[0];
      const mappings=data.mappings.filter(m=>dbInteger(m.sales_order_line_id)===dbInteger(row.id)&&(!eligible||BigInt(dbInteger(m.outstanding_base_quantity,false))>0n));
      return {lineId:dbInteger(row.id),lineNo:Number(row.line_no),version:version(Number(row.version)),skuId:dbInteger(row.sku_id),skuCode:row.sku_code_snapshot,skuName:row.sku_name_snapshot,baseUomId:dbInteger(baseUom.uomId),baseUomCode:baseUom.uomCode,trackingPolicy:row.tracking_policy_snapshot,minimumSaleLifeDays:Number(row.minimum_sale_life_days_snapshot),...Object.fromEntries(Object.entries(quantities(row)).filter(([key])=>!["salesOrderLineId","version"].includes(key))),reservationMappings:mappings.map(m=>({salesReservationMappingId:dbInteger(m.id),inventoryReservationId:dbInteger(m.inventory_reservation_id),outstandingBaseQuantity:dbInteger(m.outstanding_base_quantity,false),inventoryVersion:version(Number(m.inventory_version))}))};
    }).filter(row=>!eligible||row.reservationMappings.length);
    if(!projected.length)mismatch();const h=data.header;
    return {orderId:dbInteger(h.id),orderNumber:h.sales_order_number,status:h.status,version:version(Number(h.version)),customer:{id:dbInteger(h.customer_id),code:h.customer_code_snapshot,name:h.customer_name_snapshot},warehouse:{id:dbInteger(h.fulfillment_warehouse_id),code:h.warehouse_code_snapshot,name:h.warehouse_name_snapshot},lines:projected};
  }
  #completed(row,intent){
    const payload=json(row.recovery_payload),result=json(row.result_summary);
    if(row.status!=="SUCCEEDED"||row.event_id!==intent.eventId||row.result_type!=="FULFILLMENT_SOURCE"||dbInteger(row.result_id)!==intent.salesOrderId||row.command_type!==intent.purpose||row.target_type!=="FULFILLMENT_SOURCE"||dbInteger(row.target_id)!==intent.shipmentId||row.request_hash!==salesFulfillmentIntentHash(intent)||row.completed_at==null||!payload||payload.resultHash!==salesPayloadHash(result)||salesFulfillmentIntentHash(normalizeSalesFulfillmentIntent(payload.intent))!==row.request_hash||result?.orderId!==intent.salesOrderId)mismatch();
    fields(result,"orderId,status,version,lines");
    if(result.version!==intent.expectedOrderVersion+1||!(intent.purpose==="SHIPMENT_REVERSED"?["CONFIRMED","PARTIALLY_FULFILLED"]:["PARTIALLY_FULFILLED","COMPLETED"]).includes(result.status)||!Array.isArray(result.lines)||result.lines.length!==intent.lines.length)mismatch();
    hash(payload.applyHash);hash(payload.resultHash);epoch(Number(row.completed_at));
    for(const [index,line]of result.lines.entries()){
      fields(line,"salesOrderLineId,version,orderedBaseQuantity,reservedOutstandingBaseQuantity,backorderedBaseQuantity,fulfilledBaseQuantity,cancelledBaseQuantity");
      const expected=intent.lines[index];if(line.salesOrderLineId!==expected.salesOrderLineId||version(line.version)!==expected.expectedVersion+(expected.baseQuantity==="0"?0:1))mismatch();
      const parts=[line.reservedOutstandingBaseQuantity,line.backorderedBaseQuantity,line.fulfilledBaseQuantity,line.cancelledBaseQuantity].map(v=>BigInt(integer(v,false)));
      if(BigInt(integer(line.orderedBaseQuantity))!==parts.reduce((a,b)=>a+b,0n))mismatch();
    }
    if(!Array.isArray(payload.inventoryMembers)||payload.membersHash!==salesPayloadHash(payload.inventoryMembers))mismatch();
    const expectedMembers=intent.lines.flatMap(l=>l.reservations),members=payload.inventoryMembers;
    if(members.length!==expectedMembers.length)mismatch();
    for(const [index,m]of members.entries()){fields(m,"claimId,inventoryReservationId,baseQuantity,inventoryOperationId");integer(m.inventoryOperationId);const e=expectedMembers[index];if(m.claimId!==e.claimId||m.inventoryReservationId!==e.inventoryReservationId||m.baseQuantity!==e.baseQuantity)mismatch();}
    return {payload,result};
  }
  async #original(tx,intent){
    const [[row]]=await tx.query("SELECT * FROM sales_operation_requests WHERE event_id=?",[intent.originalConfirmationEventId]);
    if(!row)mismatch();const stored=json(row.recovery_payload),original=normalizeSalesFulfillmentIntent(stored?.intent),completed=this.#completed(row,original);
    if(original.purpose!=="SHIPMENT_CONFIRMED"||original.salesOrderId!==intent.salesOrderId||original.shipmentId!==intent.shipmentId||salesPayloadHash(memberIdentity(original))!==salesPayloadHash(memberIdentity(intent)))mismatch();
    for(const line of intent.lines)for(const member of line.reservations){const old=completed.payload.inventoryMembers?.find(m=>m.claimId===member.claimId);if(!old||old.inventoryReservationId!==member.inventoryReservationId||old.baseQuantity!==member.baseQuantity||old.inventoryOperationId!==member.originalInventoryOperationId)mismatch();}
  }
  async lockLinesForFulfillmentInTransaction(tx,command){
    this.#transaction(tx);const intent=normalizeSalesFulfillmentIntent(command),actor=await this.#actor(tx,intent),intentHash=salesFulfillmentIntentHash(intent),existing=this.#receipts.get(tx);
    if(existing){if(existing.intentHash!==intentHash)mismatch();return structuredClone(existing.replay?{replay:true,result:existing.result}:{replay:false,order:existing.projection});}
    const nowMs=epoch(this.time.nowMs());let operationId=null;
    if(intent.purpose==="SHIPMENT_REVERSED")await this.#original(tx,intent);
    if(intent.purpose!=="CLAIM"){
      try{const [row]=await tx.execute(`INSERT INTO sales_operation_requests(event_id,command_type,target_type,target_id,request_hash,recovery_payload,status,actor_user_id,actor_label,created_at,updated_at) VALUES (?,?,'FULFILLMENT_SOURCE',?,?,?,'IN_PROGRESS',?,?,?,?)`,[intent.eventId,intent.purpose,intent.shipmentId,intentHash,JSON.stringify({intent}),actor.id,actor.username,nowMs,nowMs]);operationId=dbInteger(row.insertId);}
      catch(error){if((error.cause?.code??error.code)!=="ER_DUP_ENTRY")throw error;const [[row]]=await tx.query("SELECT * FROM sales_operation_requests WHERE event_id=? FOR UPDATE",[intent.eventId]);if(!row||row.request_hash!==intentHash||String(row.actor_user_id)!==intent.actor.userId)mismatch();if(row.status!=="SUCCEEDED")throw salesError("CONCURRENT_OPERATION");const {payload,result}=this.#completed(row,intent);this.#receipts.set(tx,{intentHash,replay:true,result,applyHash:payload.applyHash});return {replay:true,result:structuredClone(result)};}
    }
    const data=await this.#lockOrder(tx,intent.salesOrderId);
    if(Number(data.header.version)!==intent.expectedOrderVersion||!(intent.purpose==="SHIPMENT_REVERSED"?["COMPLETED","PARTIALLY_FULFILLED","CLOSED"]:["CONFIRMED","PARTIALLY_FULFILLED"]).includes(data.header.status))mismatch();
    const mappingByReservation=new Map(data.mappings.map(row=>[dbInteger(row.inventory_reservation_id),row]));
    for(const line of intent.lines){const row=data.lines.find(row=>dbInteger(row.id)===line.salesOrderLineId);if(!row||Number(row.version)!==line.expectedVersion)mismatch();for(const member of line.reservations){const m=mappingByReservation.get(member.inventoryReservationId);if(!m||dbInteger(m.sales_order_line_id)!==line.salesOrderLineId||Number(m.inventory_version)!==member.expectedVersion||BigInt(dbInteger(m[intent.purpose==="SHIPMENT_REVERSED"?"consumed_base_quantity":"outstanding_base_quantity"],false))<BigInt(member.baseQuantity))mismatch();}}
    if(intent.purpose!=="CLAIM")planSalesFulfillmentQuantities({orderId:intent.salesOrderId,status:data.header.status,version:intent.expectedOrderVersion,lines:data.lines.map(quantities)},{action:intent.purpose,lines:intent.lines});
    const projection=await this.#projection(tx,data,nowMs,false,intent.lines.map(l=>l.salesOrderLineId));
    this.#receipts.set(tx,{intentHash,intent,actor,operationId,data,projection,replay:false});return {replay:false,order:structuredClone(projection)};
  }
  async applyFulfillmentResultInTransaction(tx,command){
    this.#transaction(tx);fields(command,"intent,inventoryResult");const intent=normalizeSalesFulfillmentIntent(command.intent),bound=this.#receipts.get(tx),intentHash=salesFulfillmentIntentHash(intent);
    if(!bound||bound.intentHash!==intentHash||intent.purpose==="CLAIM")mismatch();
    if(!object(command.inventoryResult)||!Array.isArray(command.inventoryResult.lines))mismatch();
    const applyHash=salesPayloadHash(command.inventoryResult);
    if(bound.replay){await this.#actor(tx,intent);if(bound.applyHash!==applyHash)mismatch();return structuredClone(bound.result);}
    const actor=await this.#actor(tx,intent),verify=this.inventoryFulfillment?.verifyFulfillmentBatchReceiptInTransaction;
    if(typeof verify!=="function")throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    const verified=await verify.call(this.inventoryFulfillment,tx,{action:intent.purpose,operationId:integer(command.inventoryResult?.operationId),shipmentId:intent.shipmentId,eventId:intent.eventId,requestHash:intent.inventoryRequestHash});
    if(!object(verified)||!object(verified.result)||salesPayloadHash(verified.result)!==applyHash||!Array.isArray(verified.reservationStates)||!Array.isArray(verified.result.lines)||verified.result.lines.length!==intent.lines.length)mismatch();
    if(verified.reservationStates.some(row=>!object(row)))mismatch();
    const states=new Map(verified.reservationStates.map(row=>[integer(row.inventoryReservationId),row])),seen=new Set(),inventoryMembers=[];
    if(states.size!==verified.reservationStates.length)mismatch();
    const mappings=[];
    for(const [index,line]of intent.lines.entries()){
      const actual=verified.result.lines[index];if(actual?.salesOrderLineId!==line.salesOrderLineId||actual.baseQuantity!==line.baseQuantity||!Array.isArray(actual.reservations)||actual.reservations.length!==line.reservations.length)mismatch();
      for(const [i,member]of line.reservations.entries()){
        const result=actual.reservations[i],state=states.get(member.inventoryReservationId),before=bound.data.mappings.find(m=>dbInteger(m.inventory_reservation_id)===member.inventoryReservationId),q=BigInt(member.baseQuantity),sign=intent.purpose==="SHIPMENT_CONFIRMED"?1n:-1n;
        if(!state||seen.has(member.inventoryReservationId)||result?.claimId!==member.claimId||result.inventoryReservationId!==member.inventoryReservationId||result.baseQuantity!==member.baseQuantity||result.expectedVersion!==member.expectedVersion||version(result.version)!==member.expectedVersion+1||state.version!==result.version||intent.purpose==="SHIPMENT_REVERSED"&&result.originalInventoryOperationId!==member.originalInventoryOperationId)mismatch();
        if(integer(state.originalQuantity)!==dbInteger(before.original_base_quantity)||integer(state.releasedQuantity,false)!==dbInteger(before.released_base_quantity,false)||BigInt(integer(state.consumedQuantity,false))!==BigInt(dbInteger(before.consumed_base_quantity,false))+sign*q||BigInt(integer(state.outstandingQuantity,false))!==BigInt(dbInteger(before.outstanding_base_quantity,false))-sign*q||!["ACTIVE","PARTIALLY_CONSUMED","CONSUMED","RELEASED","CANCELLED"].includes(state.status))mismatch();
        seen.add(member.inventoryReservationId);inventoryMembers.push({claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,baseQuantity:member.baseQuantity,inventoryOperationId:integer(result.inventoryOperationId)});mappings.push({before,state});
      }
    }
    if(seen.size!==states.size)mismatch();
    const result=planSalesFulfillmentQuantities({orderId:intent.salesOrderId,status:bound.data.header.status,version:intent.expectedOrderVersion,lines:bound.data.lines.map(quantities)},{action:intent.purpose,lines:intent.lines});
    const nowMs=epoch(this.time.nowMs());
    for(const {before,state}of mappings){const [updated]=await tx.execute("UPDATE sales_order_line_reservations SET consumed_base_quantity=?,outstanding_base_quantity=?,status=?,inventory_version=?,updated_at=? WHERE id=? AND inventory_version=?",[state.consumedQuantity,state.outstandingQuantity,state.status,state.version,nowMs,dbInteger(before.id),Number(before.inventory_version)]);if(Number(updated.affectedRows)!==1)mismatch();}
    for(const line of result.lines)if(line.version!==intent.lines.find(l=>l.salesOrderLineId===line.salesOrderLineId).expectedVersion){const [updated]=await tx.execute("UPDATE sales_order_lines SET reserved_outstanding_base_quantity=?,fulfilled_base_quantity=?,version=?,updated_at=? WHERE id=? AND version=?",[line.reservedOutstandingBaseQuantity,line.fulfilledBaseQuantity,line.version,nowMs,line.salesOrderLineId,line.version-1]);if(Number(updated.affectedRows)!==1)mismatch();}
    const [updated]=await tx.execute("UPDATE sales_orders SET status=?,version=?,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND version=?",[result.status,result.version,nowMs,nowMs,actor.id,intent.salesOrderId,intent.expectedOrderVersion]);if(Number(updated.affectedRows)!==1)mismatch();
    const action=intent.purpose==="SHIPMENT_CONFIRMED"?"FULFILLMENT_CONFIRM":"FULFILLMENT_REVERSE_REOPEN";
    await tx.execute(`INSERT INTO sales_order_status_history(sales_order_id,sequence_no,from_status,to_status,action,order_version_after,event_id,actor_user_id,actor_label,occurred_at) SELECT ?,COALESCE(MAX(sequence_no),0)+1,?,?,?,?,?,?,?,? FROM sales_order_status_history WHERE sales_order_id=?`,[intent.salesOrderId,bound.data.header.status,result.status,action,result.version,intent.eventId,actor.id,actor.username,nowMs,intent.salesOrderId]);
    await this.audit.record(tx,{actor,action:intent.purpose==="SHIPMENT_CONFIRMED"?"sales_order.fulfillment_confirmed":"sales_order.fulfillment_reversed",targetId:Number(intent.salesOrderId),targetNumber:bound.data.header.sales_order_number,eventId:intent.eventId,nowMs,details:{fromStatus:bound.data.header.status,toStatus:result.status,version:result.version,commitmentHash:applyHash}});
    const recovery={intent,applyHash,resultHash:salesPayloadHash(result),inventoryMembers,membersHash:salesPayloadHash(inventoryMembers)};
    const [completed]=await tx.execute("UPDATE sales_operation_requests SET status='SUCCEEDED',result_type='FULFILLMENT_SOURCE',result_id=?,result_summary=?,recovery_payload=?,completed_at=?,updated_at=? WHERE id=? AND status='IN_PROGRESS'",[intent.salesOrderId,JSON.stringify(result),JSON.stringify(recovery),nowMs,nowMs,bound.operationId]);if(Number(completed.affectedRows)!==1)mismatch();
    this.#receipts.set(tx,{intentHash,replay:true,result,applyHash});return structuredClone(result);
  }
}
