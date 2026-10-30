import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fixture } from "../fulfillment/aggregateFixture.js";
import { up as auditUp } from "../../database/migrations/0098_create_fulfillment_audit_and_exports.js";
import { FulfillmentService } from "../../src/modules/fulfillment/FulfillmentService.js";
const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
async function setup(t) {
  const f = await fixture(t); await auditUp(f.db); f.time.timeZone = "Asia/Hong_Kong";
  await f.db.execute("UPDATE item_skus SET inventory_tracked=1 WHERE id=?", [f.s.skuId]);
  await f.s.insert("inventory_stock_controls", { warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now });
  const service = new FulfillmentService({ database:f.database,time:f.time,logger:{error(){}} });
  const body = () => ({ eventId:randomUUID(),salesOrderId:f.s.orderId,salesOrderVersion:1,lines:[{salesOrderLineId:f.s.lineId,plannedBaseQuantity:"1"}],notes:"Synthetic draft" });
  const create = input => f.context.storage.run({databaseTransaction:null,signal:null,auth:{claims:f.claims},startedAt:f.time.nowMs()}, () => service.create(input));
  return {...f,body,create};
}
async function facts(f) {
  const result = {};
  for (const table of ["sales_orders","sales_order_lines","sales_order_line_reservations","inventory_reservations","inventory_stock_controls","inventory_stock_balances"]) result[table] = (await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
  return result;
}
nativeTest("Create atomically persists DRAFT, real Claims, immutable history/audit and replay result without changing owner quantities", async t => {
  const f=await setup(t),before=await facts(f),body=f.body(),result=await f.create(body);
  assert.equal(result.outcome.status,"DRAFT");assert.equal(result.outcome.version,1);assert.match(result.outcome.number,/^FUL-[0-9]{6}-[0-9]{6}$/u);assert.deepEqual(result.fulfillment.lines.map(line=>({salesOrderLineId:line.salesOrderLineId,plannedBaseQuantity:line.plannedBaseQuantity})),[{salesOrderLineId:String(f.s.lineId),plannedBaseQuantity:"1"}]);
  for (const table of ["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_status_history","fulfillment_audit_logs"]) assert.equal(Number((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n),1);
  const [[claim]]=await f.db.query("SELECT * FROM fulfillment_line_reservation_claims");assert.equal(String(claim.inventory_reservation_id),String(f.reservationId));assert.equal(String(claim.active_claimed_quantity),"1");
  assert.deepEqual(await facts(f),before);assert.deepEqual(await f.create(body),result);
  await assert.rejects(()=>f.create({...body,notes:"Different"}),{code:"FULFILLMENT_SOURCE_CONFLICT"});
});
nativeTest("Concurrent same-SO Create cannot overclaim and leaves no failed operation or partial document",async t=>{
  const f=await setup(t),results=await Promise.allSettled([f.create(f.body()),f.create(f.body())]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
  for (const table of ["fulfillments","fulfillment_line_reservation_claims","fulfillment_operation_requests"]) assert.equal(Number((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n),1);
});
nativeTest("Concurrent same-event Create replays a single original result",async t=>{
  const f=await setup(t),body=f.body(),results=await Promise.all([f.create(body),f.create(body)]);assert.deepEqual(results[0],results[1]);assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillments"))[0][0].n),1);
});
nativeTest("Late audit failure rolls back header, lines, Claims, history and operation, retaining only legitimate sequence gaps",async t=>{
  const f=await setup(t),before=await facts(f),body=f.body();
  await f.db.query("CREATE TRIGGER test_create_audit_failure BEFORE INSERT ON fulfillment_audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic late audit failure'");
  await assert.rejects(()=>f.create(body));
  for (const table of ["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_status_history","fulfillment_audit_logs","fulfillment_operation_requests"]) assert.equal(Number((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n),0);
  assert.deepEqual(await facts(f),before);await f.db.query("DROP TRIGGER test_create_audit_failure");assert.equal((await f.create(body)).outcome.status,"DRAFT");
});
nativeTest("Stale SO version, native source drift reject without surviving private effects",async t=>{
  const f=await setup(t);await assert.rejects(()=>f.create({...f.body(),salesOrderVersion:2}),{code:"VERSION_CONFLICT"});
  await f.db.execute("UPDATE inventory_reservations SET outstanding_quantity=0,released_quantity=1,version=version+1 WHERE id=?",[f.reservationId]);await assert.rejects(()=>f.create(f.body()),{code:"FULFILLABLE_QUANTITY_CHANGED"});
  assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillments"))[0][0].n),0);assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests"))[0][0].n),0);
});

nativeTest("Serial master or source snapshot rejects without creating a Claim",async t=>{
  const f=await setup(t);
  await f.db.execute("UPDATE item_skus SET tracking_policy='serial',version=version+1 WHERE id=?",[f.s.skuId]);
  await assert.rejects(()=>f.create(f.body()),{code:"SERIAL_TRACKING_UNSUPPORTED"});
  assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillments"))[0][0].n),0);
});
nativeTest("Replay returns the original outcome after the current document version changes",async t=>{
  const f=await setup(t),body=f.body(),result=await f.create(body);
  await f.db.execute("UPDATE fulfillments SET notes='Later draft edit',version=version+1 WHERE id=?",[result.outcome.id]);
  const replay=await f.create(body);assert.deepEqual(replay.outcome,result.outcome);assert.equal(replay.fulfillment.version,2);
});

nativeTest("Different SO and SKU Create in the same Warehouse locks the Warehouse before every new Header FK",async t=>{
  const f=await setup(t),omit=row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=="id"));
  const [[oldSku]]=await f.db.query("SELECT * FROM item_skus WHERE id=?",[f.s.skuId]);
  const [[oldItem]]=await f.db.query("SELECT * FROM items WHERE id=?",[oldSku.item_id]);
  const itemId=await f.s.insert("items",{...omit(oldItem),name:"Second synthetic Item"});
  const skuId=await f.s.insert("item_skus",{...omit(oldSku),item_id:itemId,sku_code:"SECOND-SKU",sku_name:"Second synthetic SKU"});
  const [[oldUom]]=await f.db.query("SELECT * FROM item_sku_uoms WHERE sku_id=?",[f.s.skuId]);
  const skuUomId=await f.s.insert("item_sku_uoms",{sku_id:skuId,uom_id:oldUom.uom_id,to_base_factor:1,is_base:1,is_default_sale:1,created_at:f.s.now,updated_at:f.s.now});
  const orderId=await f.s.insert("sales_orders",{...omit(f.before.order),sales_order_number:"SO-SECOND"});
  const lineId=await f.s.insert("sales_order_lines",{...omit(f.before.line),sales_order_id:orderId,sku_id:skuId,sku_uom_id:skuUomId});
  const event=randomUUID(),operation={source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(orderId),source_event_id:event,request_hash:"a".repeat(64),actor_label:f.label,created_at:f.s.now};
  const root=await f.s.insert("inventory_operation_requests",{...operation,command_type:"SALES_BATCH_RESERVE"});
  const child=await f.s.insert("inventory_operation_requests",{...operation,command_type:"SALES_LINE_RESERVE",source_line_id:String(lineId)});
  const reservation=await f.s.insert("inventory_reservations",{create_operation_id:child,warehouse_id:f.s.warehouseId,sku_id:skuId,original_quantity:1,outstanding_quantity:1,purpose:"SALE",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
  await f.s.insert("sales_order_line_reservations",{sales_order_line_id:lineId,inventory_reservation_id:reservation,inventory_operation_id:root,source_event_id:event,original_base_quantity:1,outstanding_base_quantity:1,status:"ACTIVE",inventory_version:1,created_at:f.s.now,updated_at:f.s.now});
  await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  const original=f.database.withTransaction.bind(f.database);let headers=0;
  f.database.withTransaction=(work,options)=>original(async tx=>{
    const query=tx.query.bind(tx),execute=tx.execute.bind(tx);let warehouseLocked=false,reservationsLocked=false;
    tx.query=async(sql,values)=>{const result=await query(sql,values);if(sql.includes("FROM inventory_warehouses")&&sql.includes("FOR UPDATE"))warehouseLocked=true;if(sql.includes("FROM inventory_reservations")&&sql.includes("FOR UPDATE"))reservationsLocked=true;return result;};
    tx.execute=(sql,values)=>{if(sql.startsWith("INSERT INTO fulfillments ")){assert.ok(warehouseLocked,"Warehouse X before Header FK");assert.ok(reservationsLocked,"current capacity proof before private effects");headers++;}return execute(sql,values);};
    return work(tx);
  },options);
  const results=await Promise.all([f.create(f.body()),f.create({...f.body(),salesOrderId:orderId,lines:[{salesOrderLineId:lineId,plannedBaseQuantity:"1"}]})]);
  assert.equal(new Set(results.map(row=>row.outcome.id)).size,2);assert.equal(headers,2);
});

nativeTest("Discovered Create HTTP endpoint enforces strict body, fresh permission and both idempotency layers",async t=>{
  const f=await setup(t);
  const {createApplication}=await import("../../src/framework/application/createApplication.js");
  const {defaultConfigurationSource}=await import("../../src/framework/configuration/applicationConfiguration.js");
  const {readdir}=await import("node:fs/promises"),directory=new URL("../../database/migrations/",import.meta.url);
  const installed=new Set([92,93,95,98]);
  for(const name of (await readdir(directory)).filter(name=>/^[0-9]{4}_.*\.js$/u.test(name)&&Number(name.slice(0,4))>88&&!installed.has(Number(name.slice(0,4)))).sort())await(await import(new URL(name,directory).href)).up(f.db);
  const source=defaultConfigurationSource();
  const app=await createApplication({configurationSource:{...source,application:{...source.application,port:0},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.backorderAllocate":{enabled:false},"sales.importWorker":{enabled:false},"sales.quotationExpire":{enabled:false}}},database:{...source.database,host:f.f.connectionOptions.host,port:f.f.connectionOptions.port,socketPath:f.f.connectionOptions.socketPath,user:f.f.connectionOptions.user,password:f.f.connectionOptions.password,database:f.f.name}}});
  t.after(()=>app.shutdown("fulfillment_p1_create_http_complete"));
  const {url}=await app.start(),subject=String(f.userId),version=await app.services.require("tokenRevocation").currentVersion(subject);
  const token=await app.services.require("jwt").issue({roles:f.claims.roles,permissions:f.claims.permissions},{subject,version,authTime:Math.floor(Date.now()/1000)});
  const denied=await app.services.require("jwt").issue({roles:f.claims.roles,permissions:["fulfillment.view"]},{subject,version,authTime:Math.floor(Date.now()/1000)});
  const post=async(body,bearer=token,key=randomUUID())=>{const response=await fetch(new URL("/api/v1/fulfillments/create",url),{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key,...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  assert.equal((await post(f.body(),null)).status,401);assert.equal((await post(f.body(),denied)).status,403);
  for(const patch of [{status:"DRAFT"},{salesOrderId:String(f.s.orderId)},{lines:[]},{notes:"x".repeat(2001)}])assert.equal((await post({...f.body(),...patch})).status,400);
  const body=f.body(),key=randomUUID(),first=await post(body,token,key);assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.data.outcome.status,"DRAFT");
  assert.deepEqual((await post(body,token,key)).body.data,first.body.data);assert.deepEqual((await post(body)).body.data,first.body.data);
  assert.equal((await post({...body,notes:"Changed payload"})).status,409);
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.operation'",[f.roleId]);
  const cachedStale=await post(body,token,key);assert.equal(cachedStale.status,403);assert.equal(cachedStale.body.error.code,"PERMISSION_STALE");
  const stale=await post(body);assert.equal(stale.status,403);assert.equal(stale.body.error.code,"PERMISSION_STALE");
});

nativeTest("Tentative members cannot reject a legal final single Claim behind 50 fully claimed mappings",async t=>{
  const f=await setup(t),{document}=await import("../fulfillment/aggregateFixture.js"),existing=await document(f),members=[f.reservationId];
  await f.db.execute("UPDATE fulfillment_lines SET planned_base_quantity=50,version=version+1 WHERE id=?",[existing.line]);
  for(let index=1;index<=50;index++){
    const amount=index===50?51:1,event=randomUUID();
    const common={source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(f.s.orderId),source_event_id:event,request_hash:"a".repeat(64),actor_label:f.label,created_at:f.s.now};
    const root=await f.s.insert("inventory_operation_requests",{...common,command_type:"SALES_BACKORDER_BATCH_RESERVE"}),child=await f.s.insert("inventory_operation_requests",{...common,command_type:"SALES_BACKORDER_LINE_RESERVE",source_line_id:String(f.s.lineId)});
    const reservation=await f.s.insert("inventory_reservations",{create_operation_id:child,warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,original_quantity:amount,outstanding_quantity:amount,purpose:"SALE",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
    await f.s.insert("sales_order_line_reservations",{sales_order_line_id:f.s.lineId,inventory_reservation_id:reservation,inventory_operation_id:root,source_event_id:event,original_base_quantity:amount,outstanding_base_quantity:amount,status:"ACTIVE",inventory_version:1,created_at:f.s.now,updated_at:f.s.now});
    members.push(reservation);
  }
  const [mappings]=await f.db.query("SELECT id,inventory_reservation_id FROM sales_order_line_reservations ORDER BY id");
  for(const mapping of mappings.slice(0,50))await f.s.insert("fulfillment_line_reservation_claims",{fulfillment_id:existing.id,fulfillment_line_id:existing.line,sales_order_line_reservation_id:mapping.id,inventory_reservation_id:mapping.inventory_reservation_id,original_claimed_quantity:1,active_claimed_quantity:1,status:"ACTIVE",inventory_version:1,created_at:f.s.now,updated_at:f.s.now});
  await f.db.execute("UPDATE sales_order_lines SET ordered_quantity=101,ordered_base_quantity=101,reserved_outstanding_base_quantity=101,line_amount=101,version=version+1 WHERE id=?",[f.s.lineId]);
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=101,version=version+1 WHERE warehouse_id=? AND sku_id=?",[f.s.warehouseId,f.s.skuId]);
  const result=await f.create({...f.body(),lines:[{salesOrderLineId:f.s.lineId,plannedBaseQuantity:"51"}]});
  const [claims]=await f.db.query("SELECT * FROM fulfillment_line_reservation_claims WHERE fulfillment_id=?",[result.outcome.id]);
  assert.equal(claims.length,1);assert.equal(String(claims[0].inventory_reservation_id),String(members.at(-1)));assert.equal(String(claims[0].active_claimed_quantity),"51");
});

nativeTest("Create returns original outcome separately from current detail and terminal SO quantities on replay",async t=>{
  const f=await setup(t),body=f.body(),first=await f.create(body);
  assert.equal(first.outcome.status,"DRAFT");assert.equal(first.fulfillment.status,"DRAFT");assert.equal(first.fulfillment.lines[0].baseUom.name,"Each");assert.equal(first.salesOrder.lines[0].reservedOutstandingBaseQuantity,"1");
  await f.db.execute("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[first.outcome.id]);
  await f.db.execute("UPDATE sales_orders SET status='CANCELLED',version=version+1 WHERE id=?",[f.s.orderId]);
  const replay=await f.create(body);assert.deepEqual(replay.outcome,first.outcome);assert.equal(replay.fulfillment.status,"CANCELLED");assert.equal(replay.fulfillment.version,2);assert.equal(replay.salesOrder.status,"CANCELLED");
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.operation'",[f.roleId]);
  await assert.rejects(()=>f.create(body),{code:"PERMISSION_STALE"});
});

nativeTest("Current detail batches use one RR snapshot when another transaction edits between header and lines",async t=>{
  const f=await setup(t),created=await f.create(f.body()),{FulfillmentInquiryService}=await import("../../src/modules/fulfillment/FulfillmentInquiryService.js");
  const original=f.database.withTransaction.bind(f.database);let changed=false;
  f.database.withTransaction=(work,options)=>original(async tx=>{
    const query=tx.query.bind(tx);tx.query=async(sql,values)=>{
      const result=await query(sql,values);
      if(!changed&&sql==="SELECT * FROM fulfillments WHERE id=?"){
        changed=true;await f.db.execute("UPDATE fulfillments SET notes='Concurrent edit',version=version+1 WHERE id=?",[created.outcome.id]);await f.db.execute("UPDATE fulfillment_lines SET version=version+1 WHERE fulfillment_id=?",[created.outcome.id]);
      }
      return result;
    };return work(tx);
  },options);
  const read=()=>f.context.storage.run({databaseTransaction:null,signal:null,auth:{claims:f.claims},startedAt:f.time.nowMs()},()=>new FulfillmentInquiryService({database:f.database}).detail(created.outcome.id));
  const first=await read();assert.equal(first.fulfillment.version,1);assert.equal(first.fulfillment.lines[0].version,1);assert.equal(changed,true);
  const current=await read();assert.equal(current.fulfillment.version,2);assert.equal(current.fulfillment.lines[0].version,2);
});

nativeTest("Postcommit current-read failure preserves SUCCEEDED and same-event retry returns the original Create",async t=>{
  const f=await setup(t),body=f.body(),original=f.database.withTransaction.bind(f.database);let failed=false;
  f.database.withTransaction=(work,options)=>{
    if(options?.isolationLevel==="REPEATABLE READ"&&!failed){failed=true;return Promise.reject(new Error("Synthetic current-read failure after business commit"));}
    return original(work,options);
  };
  await assert.rejects(()=>f.create(body),error=>error.code==="FULFILLMENT_DEPENDENCY_UNAVAILABLE"&&typeof error.publicDetails.correlationId==="string"&&!Object.hasOwn(error.publicDetails,"statusUrl"));
  const [[operation]]=await f.db.query("SELECT status,target_id FROM fulfillment_operation_requests WHERE event_id=?",[body.eventId]);assert.equal(operation.status,"SUCCEEDED");
  const replay=await f.create(body);assert.equal(replay.outcome.id,String(operation.target_id));assert.equal(replay.fulfillment.status,"DRAFT");
  assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillments"))[0][0].n),1);assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_audit_logs"))[0][0].n),1);
});

nativeTest("Any second-line owner conflict prevents the whole Create; valid complete lines commit together",async t=>{
  const f=await setup(t),line={...f.before.line};delete line.id;
  const [[sourceSku]]=await f.db.query("SELECT * FROM item_skus WHERE id=?",[f.s.skuId]);delete sourceSku.id;
  const skuId=await f.s.insert("item_skus",{...sourceSku,sku_code:"SECOND-LINE-SKU"});
  const skuUomId=await f.s.insert("item_sku_uoms",{sku_id:skuId,uom_id:f.s.uomId,to_base_factor:1,is_base:1,is_default_sale:1,created_at:f.s.now,updated_at:f.s.now});
  const lineId=await f.s.insert("sales_order_lines",{...line,line_no:2,sku_id:skuId,sku_uom_id:skuUomId});
  const event=randomUUID(),common={source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(f.s.orderId),source_event_id:event,request_hash:"a".repeat(64),actor_label:f.label,created_at:f.s.now};
  const root=await f.s.insert("inventory_operation_requests",{...common,command_type:"SALES_BACKORDER_BATCH_RESERVE"}),child=await f.s.insert("inventory_operation_requests",{...common,command_type:"SALES_BACKORDER_LINE_RESERVE",source_line_id:String(lineId)});
  const reservation=await f.s.insert("inventory_reservations",{create_operation_id:child,warehouse_id:f.s.warehouseId,sku_id:skuId,original_quantity:1,outstanding_quantity:1,purpose:"SALE",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
  await f.s.insert("sales_order_line_reservations",{sales_order_line_id:lineId,inventory_reservation_id:reservation,inventory_operation_id:root,source_event_id:event,original_base_quantity:1,outstanding_base_quantity:1,status:"ACTIVE",inventory_version:1,created_at:f.s.now,updated_at:f.s.now});
  await f.db.execute("UPDATE sales_orders SET line_count=2,total_amount=2,version=version+1 WHERE id=?",[f.s.orderId]);await f.s.insert("inventory_stock_controls",{warehouse_id:f.s.warehouseId,sku_id:skuId,reserved_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  await f.db.execute("UPDATE inventory_reservations SET outstanding_quantity=0,released_quantity=1,version=version+1 WHERE id=?",[reservation]);
  const body={...f.body(),salesOrderVersion:2,lines:[...f.body().lines,{salesOrderLineId:lineId,plannedBaseQuantity:"1"}]},before=await facts(f);
  await assert.rejects(()=>f.create(body),{code:"FULFILLABLE_QUANTITY_CHANGED"});assert.deepEqual(await facts(f),before);
  for(const table of ["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_status_history","fulfillment_audit_logs","fulfillment_operation_requests"])assert.equal(Number((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n),0);
  await f.db.execute("UPDATE inventory_reservations SET outstanding_quantity=1,released_quantity=0,version=version+1 WHERE id=?",[reservation]);
  const result=await f.create(body);assert.equal(result.fulfillment.lines.length,2);assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_line_reservation_claims"))[0][0].n),2);
});
