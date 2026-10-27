import { randomUUID } from "node:crypto";
import { fixture } from "./aggregateFixture.js";
import { up as auditUp } from "../../database/migrations/0098_create_fulfillment_audit_and_exports.js";
import { up as shipmentsUp } from "../../database/migrations/0096_create_shipments.js";
import { FulfillmentService } from "../../src/modules/fulfillment/FulfillmentService.js";
import { FulfillmentLockService } from "../../src/modules/fulfillment/FulfillmentLockService.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";
import { InventoryFulfillmentService } from "../../src/modules/inventory/InventoryFulfillmentService.js";
import { InventoryLookupService } from "../../src/modules/inventory/InventoryLookupService.js";
export async function p1Fixture(t,baseQuantity=1){
  const f=await fixture(t,baseQuantity);await auditUp(f.db);await shipmentsUp(f.db);f.time.timeZone="Asia/Hong_Kong";
  await f.db.execute("UPDATE item_skus SET inventory_tracked=1 WHERE id=?",[f.s.skuId]);
  await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:baseQuantity,created_at:f.s.now,updated_at:f.s.now});
  const logger={error(){}},fulfillments=new FulfillmentService({database:f.database,time:f.time,logger}),inventory=new InventoryFulfillmentService({database:f.database,time:f.time,logger});
  const locks=new FulfillmentLockService({database:f.database,sales:f.service,inventoryLookup:new InventoryLookupService({fulfillment:inventory,time:f.time}),itemLookup:new ItemLookupService({database:f.database,time:f.time,logger}),time:f.time});
  const execute=work=>f.context.storage.run({databaseTransaction:null,signal:null,auth:{claims:f.claims},startedAt:f.time.nowMs()},work);
  const body=(quantity="1")=>({eventId:randomUUID(),salesOrderId:f.s.orderId,salesOrderVersion:1,lines:[{salesOrderLineId:f.s.lineId,plannedBaseQuantity:quantity}]});
  const pending=(quantity="1")=>{const intent=f.command();intent.purpose="CLAIM";intent.claimMode="PENDING_UPDATE";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete intent[key];intent.lines[0].baseQuantity=quantity;intent.lines[0].reservations[0].claimId=null;intent.lines[0].reservations[0].baseQuantity=quantity;return intent;};
  return {...f,locks,fulfillments,execute,body,pending,create:input=>execute(()=>fulfillments.create(input))};
}

export async function addSourceLine(f,quantity=1){
  const [[oldSku]]=await f.db.query("SELECT * FROM item_skus WHERE id=?",[f.s.skuId]);delete oldSku.id;
  const suffix=randomUUID().slice(0,8),skuId=await f.s.insert("item_skus",{...oldSku,sku_code:"SKU-"+suffix,sku_name:"Synthetic "+suffix});
  const skuUomId=await f.s.insert("item_sku_uoms",{sku_id:skuId,uom_id:f.s.uomId,to_base_factor:1,is_base:1,is_default_sale:1,created_at:f.s.now,updated_at:f.s.now});
  const [[header]]=await f.db.query("SELECT line_count,version FROM sales_orders WHERE id=?",[f.s.orderId]),line={...f.before.line};delete line.id;
  const lineId=await f.s.insert("sales_order_lines",{...line,line_no:Number(header.line_count)+1,sku_id:skuId,sku_uom_id:skuUomId,sku_code_snapshot:"SKU-"+suffix,sku_name_snapshot:"Synthetic "+suffix,ordered_quantity:quantity,ordered_base_quantity:quantity,reserved_outstanding_base_quantity:quantity,line_amount:quantity});
  const event=randomUUID(),operation={source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(f.s.orderId),source_event_id:event,request_hash:"a".repeat(64),actor_label:f.label,created_at:f.s.now};
  const root=await f.s.insert("inventory_operation_requests",{...operation,command_type:"SALES_BACKORDER_BATCH_RESERVE"}),child=await f.s.insert("inventory_operation_requests",{...operation,command_type:"SALES_BACKORDER_LINE_RESERVE",source_line_id:String(lineId)});
  const reservationId=await f.s.insert("inventory_reservations",{create_operation_id:child,warehouse_id:f.s.warehouseId,sku_id:skuId,original_quantity:quantity,outstanding_quantity:quantity,purpose:"SALE",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
  const mappingId=await f.s.insert("sales_order_line_reservations",{sales_order_line_id:lineId,inventory_reservation_id:reservationId,inventory_operation_id:root,source_event_id:event,original_base_quantity:quantity,outstanding_base_quantity:quantity,status:"ACTIVE",inventory_version:1,created_at:f.s.now,updated_at:f.s.now});
  await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:skuId,reserved_quantity:quantity,created_at:f.s.now,updated_at:f.s.now});
  await f.db.execute("UPDATE sales_orders SET line_count=line_count+1,total_amount=total_amount+?,version=version+1 WHERE id=?",[quantity,f.s.orderId]);
  return {lineId,reservationId,mappingId,skuId};
}
export async function ownerQuantities(f){
 const facts={};for(const table of ["sales_orders","sales_order_lines","sales_order_line_reservations","inventory_reservations","inventory_stock_controls","inventory_stock_balances"])facts[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return facts;
}

export async function startP1Http(t,f){
 const {createApplication}=await import("../../src/framework/application/createApplication.js"),{defaultConfigurationSource}=await import("../../src/framework/configuration/applicationConfiguration.js"),{readdir}=await import("node:fs/promises");
 const directory=new URL("../../database/migrations/",import.meta.url),installed=new Set([92,93,95,96,98]);
 for(const name of (await readdir(directory)).filter(name=>/^[0-9]{4}_.*\.js$/u.test(name)&&Number(name.slice(0,4))>88&&!installed.has(Number(name.slice(0,4)))).sort())await(await import(new URL(name,directory).href)).up(f.db);
 const source=defaultConfigurationSource(),app=await createApplication({configurationSource:{...source,application:{...source.application,port:0},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.backorderAllocate":{enabled:false},"sales.importWorker":{enabled:false},"sales.quotationExpire":{enabled:false}}},database:{...source.database,host:f.f.connectionOptions.host,port:f.f.connectionOptions.port,socketPath:f.f.connectionOptions.socketPath,user:f.f.connectionOptions.user,password:f.f.connectionOptions.password,database:f.f.name}}});
 t.after(()=>app.shutdown("fulfillment_p1_http_complete"));const {url}=await app.start(),subject=String(f.userId),version=await app.services.require("tokenRevocation").currentVersion(subject);
 const token=await app.services.require("jwt").issue({roles:f.claims.roles,permissions:f.claims.permissions},{subject,version,authTime:Math.floor(Date.now()/1000)}),denied=await app.services.require("jwt").issue({roles:f.claims.roles,permissions:[]},{subject,version,authTime:Math.floor(Date.now()/1000)});
 return async(method,path,body,{auth=true,key=randomUUID()}={})=>{
  const response=await fetch(new URL(path,url),{method,headers:{...(auth?{Authorization:`Bearer ${auth==="denied"?denied:token}`} : {}),...(body===undefined?{}:{"Content-Type":"application/json","Idempotency-Key":key})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json(),headers:{cacheControl:response.headers.get("cache-control"),pragma:response.headers.get("pragma")}};
 };
}

export async function allocateWithInventoryOwner(f,document,{projected=false}={}){
 const {lockFulfillmentRowsInTransaction}=await import("../../src/modules/fulfillment/FulfillmentLockService.js");
 const [[claim]]=await f.db.query("SELECT * FROM fulfillment_line_reservation_claims WHERE fulfillment_id=?",[document.outcome.id]);
 const [[reservation]]=await f.db.query("SELECT version FROM inventory_reservations WHERE id=?",[f.reservationId]);
 const binId=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"PICK-"+randomUUID().slice(0,8),normalized_code:"pick-"+randomUUID().slice(0,8),status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
 const balanceId=await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:binId,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:10,allocated_quantity:0,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now});
 const time={...f.time,fileDate:()=>"2023-11-14"},inventory=new InventoryFulfillmentService({database:f.database,time,logger:{error(){}}}),actor={...f.command().actor,userId:f.userId};
 const command={actor,source:{documentId:document.outcome.id,eventId:randomUUID()},correlationId:"",payload:{fulfillmentId:document.outcome.id,lines:[{fulfillmentLineId:String(claim.fulfillment_line_id),salesOrderLineId:String(f.s.lineId),baseQuantity:"1",reservations:[{claimId:String(claim.id),inventoryReservationId:String(f.reservationId),expectedVersion:Number(reservation.version),baseQuantity:"1",overrideReason:"",allocations:[{inventoryBalanceId:String(balanceId),expectedBalanceVersion:1,baseQuantity:"1"}]}]}]}};
 return f.run({claims:f.claims},async tx=>{
  const proof=await inventory.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command});
  const intent=f.command();intent.purpose="CLAIM";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete intent[key];intent.lines[0].reservations[0].claimId=String(claim.id);intent.lines[0].reservations[0].expectedVersion=Number(reservation.version);
  await f.service.lockLinesForFulfillmentInTransaction(tx,intent);
  for(const [table,ids]of [["fulfillments",[document.outcome.id]],["fulfillment_lines",[String(claim.fulfillment_line_id)]],["fulfillment_line_reservation_claims",[String(claim.id)]]])await lockFulfillmentRowsInTransaction(tx,table,ids);
  await new ItemLookupService({database:f.database,time,logger:{error(){}}}).getFulfillmentInventoryProfilesInTransaction(tx,[String(f.s.skuId)],{atMs:time.nowMs()});
  const result=await inventory.allocateForFulfillmentBatchInTransaction(tx,command,proof),member=result.lines[0].reservations[0],leg=member.allocations[0];
  if(projected){
   const bucket=typeof leg.bucketSnapshot==="string"?JSON.parse(leg.bucketSnapshot):leg.bucketSnapshot;
   await tx.execute("INSERT INTO fulfillment_allocations (fulfillment_id,fulfillment_line_id,claim_id,inventory_reservation_id,inventory_allocation_id,inventory_balance_id,warehouse_id,bin_id,lot_id,bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,stock_status_snapshot,selection_strategy,recommended_rank_snapshot,allocated_base_quantity,status,inventory_version,balance_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[document.outcome.id,claim.fulfillment_line_id,claim.id,f.reservationId,leg.inventoryAllocationId,balanceId,f.s.warehouseId,binId,null,bucket.binCode,"",null,"AVAILABLE",leg.selectionStrategy,leg.recommendedRank,1,"ACTIVE",leg.allocationVersion,leg.balanceVersion,f.time.nowMs(),f.time.nowMs()]);
   await tx.execute("UPDATE fulfillment_lines SET allocated_base_quantity=1,version=version+1 WHERE id=?",[claim.fulfillment_line_id]);await tx.execute("UPDATE fulfillment_line_reservation_claims SET inventory_version=? WHERE id=?",[member.version,claim.id]);await tx.execute("UPDATE fulfillments SET status='PICKING',allocated_at=?,version=version+1 WHERE id=?",[f.time.nowMs(),document.outcome.id]);
   await tx.execute("INSERT INTO fulfillment_status_history (fulfillment_id,sequence_no,from_status,to_status,action,event_id,version_after,actor_user_id,actor_label,occurred_at) VALUES (?,2,'DRAFT','PICKING','ALLOCATE',?,2,?,?,?)",[document.outcome.id,command.source.eventId,f.userId,f.label,f.time.nowMs()]);
  }
  return result;
 });
}
