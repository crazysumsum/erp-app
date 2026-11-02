import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {shipmentFixture} from "../fulfillment/shipmentFixture.js";
import {SalesArchiveLockService} from "../../src/modules/sales/SalesArchiveLockService.js";
const native=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function fixture(t){const f=await shipmentFixture(t);return {...f,locks:new SalesArchiveLockService({database:f.database}),rr:work=>f.run({claims:f.claims},work,{isolationLevel:"REPEATABLE READ"})};}
async function insert(db,type,target,created=1,status="FAILED"){
 return db.execute("INSERT INTO sales_operation_requests(event_id,command_type,target_type,target_id,request_hash,status,actor_label,created_at,updated_at) VALUES (?,'ARCHIVE_TEST',?,?,?,?,'Synthetic',?,?)",[randomUUID(),type,target,"a".repeat(64),status,created,created]);
}
async function waited(f,connection){const end=performance.now()+5000;while(performance.now()<end){const [[row]]=await f.db.query("SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads th ON th.THREAD_ID=w.REQUESTING_THREAD_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='sales_operation_requests' AND th.PROCESSLIST_ID=?",[f.f.name,connection]);if(Number(row.n)>0)return;await delay(10);}assert.fail("competing intent must enter an actual Sales operation lock wait");}
native("Archive Sales operation prefixes require the actual bound RR executor and exact canonical scope before SQL",async t=>{
 const f=await fixture(t);let calls=0,closed;const forged={query(){calls++;throw Error("unexpected SQL");}};
 for(const tx of [forged,f.db])await assert.rejects(f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:[]}),TypeError);
 await f.rr(async tx=>{closed=tx;});await assert.rejects(f.locks.lockOrderOperationsInTransaction(closed,{orderId:String(f.s.orderId),shipmentIds:[]}),TypeError);
 await assert.rejects(f.run({claims:f.claims},tx=>f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:[]})),e=>e instanceof TypeError||e.cause instanceof TypeError);
 await f.rr(async tx=>{const query=tx.query.bind(tx);tx.query=(...args)=>{calls++;return query(...args);};for(const scope of [{orderId:1,shipmentIds:[]},{orderId:"01",shipmentIds:[]},{orderId:String(f.s.orderId),shipmentIds:["2","2"]},{orderId:String(f.s.orderId),shipmentIds:["3","2"]},{orderId:String(f.s.orderId),shipmentIds:[],grant:true}])await assert.rejects(f.locks.lockOrderOperationsInTransaction(tx,scope),TypeError);});assert.equal(calls,0);
});
native("Archive Sales source prefix uses the real Shipment ID independently of the SO ID",async t=>{
 const f=await fixture(t),shipmentId=String(f.s.orderId+1000);await f.s.insert("shipments",{...f.row,id:Number(shipmentId)});
 await insert(f.db,"SALES_ORDER",f.s.orderId,0,"SUCCEEDED");await insert(f.db,"FULFILLMENT_SOURCE",shipmentId,0,"IN_PROGRESS");await insert(f.db,"FULFILLMENT_SOURCE",f.s.orderId,0,"IN_PROGRESS");
 await f.rr(async tx=>{const queries=[],query=tx.query.bind(tx);tx.query=(sql,args)=>{queries.push({sql,args});return query(sql,args);};assert.deepEqual(await f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:[shipmentId]}),{operationCount:2,hasInProgress:true});assert.equal(queries.length,2);assert.deepEqual(queries.map(q=>q.args.slice(0,2)),[["FULFILLMENT_SOURCE",shipmentId],["SALES_ORDER",String(f.s.orderId)]]);for(const q of queries){assert.match(q.sql,/FORCE INDEX \(idx_sales_operations_target\)/u);assert.match(q.sql,/ORDER BY created_at,id LIMIT 500 FOR UPDATE$/u);assert.doesNotMatch(q.sql,/NOWAIT|SKIP LOCKED/u);}});
});
native("Archive Sales immutable timestamp-ID cursor includes equal timestamps, mixed statuses and the exact empty tail",async t=>{
 const f=await fixture(t),rows=Array.from({length:1000},(_,i)=>[randomUUID(),"UPDATE_ORDER","SALES_ORDER",f.s.orderId,"a".repeat(64),["FAILED","IN_PROGRESS","SUCCEEDED"][i%3],"Synthetic",i<500?0:1,1]);await f.db.query("INSERT INTO sales_operation_requests(event_id,command_type,target_type,target_id,request_hash,status,actor_label,created_at,updated_at) VALUES ?",[rows]);
 await f.rr(async tx=>{const pages=[],query=tx.query.bind(tx);tx.query=async(sql,args)=>{const result=await query(sql,args);pages.push(result[0].length);return result;};assert.deepEqual(await f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:[]}),{operationCount:1000,hasInProgress:true});assert.deepEqual(pages,[500,500,0]);});
});
for(const type of ["SALES_ORDER","FULFILLMENT_SOURCE"])native(`Archive empty Sales ${type} prefix blocks a new intent before the Sales root`,async t=>{
 const f=await fixture(t),target=type==="SALES_ORDER"?String(f.s.orderId):String(f.s.orderId+1000);let release,entered,writerEntered;const hold=new Promise(r=>{release=r;}),locked=new Promise(r=>{entered=r;}),started=new Promise(r=>{writerEntered=r;});
 const archive=f.rr(async tx=>{await f.locks.lockOrderOperationsInTransaction(tx,{orderId:String(f.s.orderId),shipmentIds:type==="SALES_ORDER"?[]:[target]});await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[f.s.orderId]);entered();await hold;});await locked;
 const writer=f.run({claims:f.claims},async tx=>{const [[row]]=await tx.query("SELECT CONNECTION_ID() AS id");writerEntered(row.id);await insert(tx,type,target);});const joined=Promise.allSettled([archive,writer]);try{await waited(f,await started);}finally{release();}for(const result of await joined)if(result.status==="rejected")throw result.reason;
});

native("Archive Sales domain locks use bounded line-number points and mapping primary-key points after the root",async t=>{
 const f=await fixture(t);await f.rr(async tx=>{const trace=[],query=tx.query.bind(tx);tx.query=async(sql,args)=>{trace.push(sql);return query(sql,args);};const rows=await f.locks.lockOrderRowsInTransaction(tx,String(f.s.orderId));assert.equal(String(rows.header.id),String(f.s.orderId));assert.deepEqual(rows.lines.map(row=>String(row.id)),[String(f.s.lineId)]);assert.deepEqual(rows.mappings.map(row=>String(row.id)),[String(f.mappingId)]);
 assert.match(trace[0],/FROM sales_orders WHERE id=\? FOR UPDATE$/u);assert.match(trace[1],/FORCE INDEX \(uq_sales_order_line_number\)/u);assert.match(trace[1],/line_no IN \(\?\)/u);
 const discovery=trace.findIndex(sql=>sql.includes("FROM sales_order_line_reservations")&&!sql.endsWith("FOR UPDATE"));assert.ok(discovery>1);assert.match(trace[discovery],/LIMIT 500$/u);assert.ok(trace.some(sql=>sql.includes("FROM sales_order_line_reservations FORCE INDEX (PRIMARY)")&&sql.endsWith("FOR UPDATE")));assert.ok(trace.every(sql=>!sql.includes("sales_order_line_reservations")||!sql.endsWith("FOR UPDATE")||sql.includes("FORCE INDEX (PRIMARY)")));});
});
native("Archive Sales domain lock refuses a current incomplete line set before mapping discovery",async t=>{
 const f=await fixture(t);await f.db.execute("UPDATE sales_orders SET line_count=2 WHERE id=?",[f.s.orderId]);await f.rr(async tx=>{const trace=[],query=tx.query.bind(tx);tx.query=(sql,args)=>{trace.push(sql);return query(sql,args);};await assert.rejects(f.locks.lockOrderRowsInTransaction(tx,String(f.s.orderId)),TypeError);assert.ok(trace.every(sql=>!sql.includes("sales_order_line_reservations")));});
});
native("Archive Sales domain rows require the actual RR executor and never certify arbitrary old snapshots",async t=>{
 const f=await fixture(t);let calls=0;const forged={query(){calls++;throw Error("unexpected SQL");}};await assert.rejects(f.locks.lockOrderRowsInTransaction(forged,String(f.s.orderId)),TypeError);await assert.rejects(f.run({claims:f.claims},tx=>f.locks.lockOrderRowsInTransaction(tx,String(f.s.orderId))),e=>e instanceof TypeError||e.cause instanceof TypeError);assert.equal(calls,0);
});

async function addLines(f,count){
 const [[base]]=await f.db.query("SELECT * FROM sales_order_lines WHERE id=?",[f.s.lineId]),[[sku]]=await f.db.query("SELECT item_id FROM item_skus WHERE id=?",[f.s.skuId]);
 for(let i=2;i<=count;i++){const code="archive-"+randomUUID(),id=await f.s.insert("item_skus",{item_id:sku.item_id,sku_code:code,sku_name:code,status:"active",created_at:f.s.now,updated_at:f.s.now}),uom=await f.s.insert("item_sku_uoms",{sku_id:id,uom_id:f.s.uomId,to_base_factor:1,is_base:1,is_default_sale:1,created_at:f.s.now,updated_at:f.s.now});const row={...base,line_no:i,sku_id:id,sku_uom_id:uom,reserved_outstanding_base_quantity:0,backordered_base_quantity:0,fulfilled_base_quantity:0,cancelled_base_quantity:base.ordered_base_quantity};delete row.id;await f.s.insert("sales_order_lines",row);}
}
native("Archive Sales domain refuses understated line_count instead of silently ignoring an extra real line",async t=>{
 const f=await fixture(t);await addLines(f,2);await f.rr(async tx=>{const trace=[],query=tx.query.bind(tx);tx.query=(sql,args)=>{trace.push(sql);return query(sql,args);};await assert.rejects(f.locks.lockOrderRowsInTransaction(tx,String(f.s.orderId)),TypeError);assert.ok(trace.every(sql=>!sql.includes("sales_order_line_reservations")));});
});
native("Archive Sales domain locks and verifies the complete actual 100-line boundary",async t=>{
 const f=await fixture(t);await addLines(f,100);await f.db.execute("UPDATE sales_orders SET line_count=100 WHERE id=?",[f.s.orderId]);await f.rr(async tx=>{const trace=[],query=tx.query.bind(tx);tx.query=(sql,args)=>{trace.push({sql,args});return query(sql,args);};const rows=await f.locks.lockOrderRowsInTransaction(tx,String(f.s.orderId));assert.equal(rows.lines.length,100);assert.equal(rows.mappings.length,1);assert.deepEqual(rows.lines.map(row=>Number(row.line_no)).sort((a,b)=>a-b),Array.from({length:100},(_,i)=>i+1));const points=trace.find(q=>q.sql.includes("FORCE INDEX (uq_sales_order_line_number)")&&q.sql.endsWith("FOR UPDATE"));assert.equal(points.args.length,101);assert.deepEqual(points.args.slice(1),Array.from({length:100},(_,i)=>i+1));});
});
async function addMappings(f,count){
 const operations=[],reservations=[],mappings=[];let op=Number((await f.db.query("SELECT MAX(id) AS id FROM inventory_operation_requests"))[0][0].id)+1,res=Number((await f.db.query("SELECT MAX(id) AS id FROM inventory_reservations"))[0][0].id)+1;
 for(let i=1;i<count;i++){const root=op++,child=op++,id=res++,event=randomUUID();operations.push([root,"SALES_BACKORDER_BATCH_RESERVE","SALES","SALES_ORDER",String(f.s.orderId),"",event,"a".repeat(64),f.label,f.s.now],[child,"SALES_BACKORDER_LINE_RESERVE","SALES","SALES_ORDER",String(f.s.orderId),String(f.s.lineId),event,"a".repeat(64),f.label,f.s.now]);reservations.push([id,child,f.s.warehouseId,f.s.skuId,1,1,"SALE","ACTIVE",f.s.now,f.s.now]);mappings.push([f.s.lineId,id,root,event,1,1,"ACTIVE",1,f.s.now,f.s.now]);}
 for(let i=0;i<operations.length;i+=100)await f.db.query("INSERT INTO inventory_operation_requests(id,command_type,source_module,source_document_type,source_document_id,source_line_id,source_event_id,request_hash,actor_label,created_at) VALUES ?",[operations.slice(i,i+100)]);
 for(let i=0;i<reservations.length;i+=100)await f.db.query("INSERT INTO inventory_reservations(id,create_operation_id,warehouse_id,sku_id,original_quantity,outstanding_quantity,purpose,status,created_at,updated_at) VALUES ?",[reservations.slice(i,i+100)]);
 for(let i=0;i<mappings.length;i+=100)await f.db.query("INSERT INTO sales_order_line_reservations(sales_order_line_id,inventory_reservation_id,inventory_operation_id,source_event_id,original_base_quantity,outstanding_base_quantity,status,inventory_version,created_at,updated_at) VALUES ?",[mappings.slice(i,i+100)]);
 const [[total]]=await f.db.query("SELECT SUM(outstanding_base_quantity) AS quantity FROM sales_order_line_reservations WHERE sales_order_line_id=?",[f.s.lineId]);await f.db.execute("UPDATE sales_order_lines SET ordered_quantity=?,ordered_base_quantity=?,reserved_outstanding_base_quantity=?,line_amount=? WHERE id=?",[total.quantity,total.quantity,total.quantity,total.quantity,f.s.lineId]);
}
for(const count of [500,501])native(`Archive Sales mapping discovery and primary locks cover ${count} actual source rows`,async t=>{
 const f=await fixture(t);await addMappings(f,count);const before=(await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0];await f.rr(async tx=>{const pages=[],locks=[],query=tx.query.bind(tx);tx.query=async(sql,args)=>{const result=await query(sql,args);if(sql.startsWith("SELECT id,sales_order_line_id FROM sales_order_line_reservations"))pages.push(result[0].length);if(sql.includes("sales_order_line_reservations FORCE INDEX (PRIMARY)"))locks.push(result[0].length);return result;};const rows=await f.locks.lockOrderRowsInTransaction(tx,String(f.s.orderId));assert.equal(rows.mappings.length,count);assert.equal(new Set(rows.mappings.map(r=>String(r.id))).size,count);assert.deepEqual(pages,count===500?[500,0]:[500,1]);assert.deepEqual(locks,count===500?[500]:[500,1]);});assert.deepEqual((await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0],before);
});
native("Archive Sales domain rejects cross-row reservation counter disagreement without modifying Inventory",async t=>{
 const f=await fixture(t),before=(await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0];await f.db.execute("UPDATE sales_order_lines SET backordered_base_quantity=reserved_outstanding_base_quantity,reserved_outstanding_base_quantity=0 WHERE id=?",[f.s.lineId]);await assert.rejects(f.rr(tx=>f.locks.lockOrderRowsInTransaction(tx,String(f.s.orderId))),e=>e.cause instanceof TypeError);assert.deepEqual((await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0],before);
});
native("Archive Sales domain read locks never commit an outer caller transaction",async t=>{
 const f=await fixture(t),marker="archive-rollback-"+randomUUID();await assert.rejects(f.rr(async tx=>{await tx.execute("INSERT INTO fr_job_leases(job_name,owner,acquired_at,expires_at) VALUES (?,'',0,0)",[marker]);await f.locks.lockOrderRowsInTransaction(tx,String(f.s.orderId));throw Error("actual outer rollback after locked rows");}),e=>e.cause?.message==="actual outer rollback after locked rows");assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fr_job_leases WHERE job_name=?",[marker]))[0][0].n),0);
});
