import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {issueFixture} from "../fulfillment/shipmentFixture.js";
import {lifecycleFixture} from "../fulfillment/lifecycleFixture.js";
import {document as ownerDocument} from "../fulfillment/aggregateFixture.js";
import mysql from "mysql2/promise";
import { createFulfillmentArchiveDatabase } from "../sales/phase4/fulfillmentArchiveFixtures.js";
import { seedCancelledFulfillment, seedDraftFulfillment, seedFulfillmentSalesOrder } from "../sales/phase4/fulfillmentOwnerFixtures.js";
import { FulfillmentOpenMatterService } from "../../src/modules/fulfillment/FulfillmentOpenMatterService.js";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { FulfillmentOpenMatterService as FulfillmentOpenMatterRuntimeService } from "../../src/services/fulfillment/FulfillmentOpenMatterService.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { SalesOrderLifecycleService } from "../../src/modules/sales/SalesOrderLifecycleService.js";
import { SalesFulfillmentGuardService } from "../../src/modules/sales/SalesFulfillmentGuardService.js";

const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
function actualRuntime(t,f){
  const time={timestamp:()=>1700000000001,nowMs:()=>1700000000001};
  const context=new RequestContextService({services:{require:()=>time}});
  const pool=mysql.createPool({...f.connectionOptions,database:f.name,multipleStatements:false,connectionLimit:2});
  const queries=[],seen=new WeakSet(),getConnection=pool.getConnection.bind(pool);
  pool.getConnection=async()=>{const connection=await getConnection();if(!seen.has(connection)){seen.add(connection);const query=connection.query.bind(connection);connection.query=(sql,parameters)=>{queries.push({sql:typeof sql==="string"?sql:sql.sql,parameters:parameters??[]});return query(sql,parameters);};}return connection;};
  const database=new MySqlDatabaseService({pool,context,logger:{},config:{queryTimeoutMs:5000,transactionTimeoutMs:15000,acquireTimeoutMs:5000,abandonedConnectionAction:"destroy"}});
  t.after(()=>database.shutdown());
  const service=new FulfillmentOpenMatterService({database,context,time});
  const transaction=(work,{jwt=null,isolationLevel="REPEATABLE READ"}={})=>context.storage.run({databaseTransaction:null,signal:null,auth:jwt?{claims:jwt}:null,startedAt:time.nowMs()},()=>database.withTransaction(work,{isolationLevel}));
  return {database,context,time,service,transaction,queries};
}
async function currentOwnerFixture(t,factory=issueFixture){const f=await factory(t),migrate=fileURLToPath(new URL("../../scripts/migrate.js",import.meta.url));await promisify(execFile)(process.execPath,[migrate],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});return f;}
function pendingIntent(f){return {event_id:randomUUID(),operation_type:"CREATE",target_type:"FULFILLMENT",sales_order_id:f.orderId,payload_hash:"a".repeat(64),status:"IN_PROGRESS",lease_owner:"synthetic-owner",lease_expires_at:f.now+60000,attempt_count:1,correlation_id:randomUUID(),created_at:f.now,updated_at:f.now};}
async function writeActor(f,db){const label="native-"+randomUUID().slice(0,12),userId=await f.insert("users",{username:label,password_hash:"synthetic-only",display_name:"Synthetic",created_at:f.now,updated_at:f.now}),roleId=await f.insert("roles",{name:label,created_at:f.now});await f.insert("user_roles",{user_id:userId,role_id:roleId});for(const name of ["sales.view","sales.mgmt"])await db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?",[roleId,name]);return {sub:String(userId),roles:[label],permissions:["sales.view","sales.mgmt"]};}
integrationTest("TC-047 native missing owner schema never yields CLOSED",async t=>{
  const f=await createFulfillmentArchiveDatabase(t),r=actualRuntime(t,f);
  assert.deepEqual(await r.service.getOrderArchiveStatus("1",{atMs:r.time.nowMs()}),{version:"1",status:"UNKNOWN",reasonCodes:["SCHEMA_MISSING"]});
});
integrationTest("TC-047 real Open Matter, lifecycle and transaction contracts",async t=>{
  const f=await createFulfillmentArchiveDatabase(t,{baseOnly:false}),r=actualRuntime(t,f),db=f.db;
  const status=orderId=>r.service.getOrderArchiveStatus(String(orderId),{atMs:r.time.nowMs()});
  const closed=await seedCancelledFulfillment(db);
  await t.test("full current schema and version ledger with no documents returns CLOSED without HTTP context",async()=>{
    assert.equal(r.context.get(),null);assert.deepEqual(await status("9007199254740991"),{version:"1",status:"CLOSED",reasonCodes:[]});assert.equal(r.context.get(),null);
  });
  await t.test("a real terminal owner with complete lines returns CLOSED",async()=>assert.equal((await status(closed.orderId)).status,"CLOSED"));
  await t.test("untrusted transaction read cannot grant Archive authority or commit caller work",async()=>{
    const marker=randomUUID(),rollback=new Error("Intentional outer rollback");let reached=false;
    await assert.rejects(()=>r.transaction(async tx=>{
      await tx.query("INSERT INTO fulfillment_operation_requests SET ?",{event_id:marker,operation_type:"CREATE",target_type:"FULFILLMENT",sales_order_id:closed.orderId,payload_hash:"a".repeat(64),status:"FAILED",attempt_count:1,completed_at:closed.now,public_error_code:"VERSION_CONFLICT",correlation_id:randomUUID(),created_at:closed.now,updated_at:closed.now});
      assert.deepEqual(await r.service.getOrderArchiveStatusInTransaction(tx,{orderId:String(closed.orderId),atMs:r.time.nowMs()}),{version:"1",status:"UNKNOWN",reasonCodes:["PROVIDER_UNAVAILABLE"]});reached=true;throw rollback;
    }),error=>error===rollback||error.cause===rollback);
    assert.equal(reached,true,"The intended rollback must be reached after a valid native intent and safe private-scope refusal");assert.equal((await db.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests WHERE event_id=?",[marker]))[0][0].n,0);
  });
  await t.test("nonterminal Fulfillment blocks and status read preserves business timestamps",async()=>{
    const a=await seedDraftFulfillment(db);
    const [[before]]=await db.query("SELECT * FROM fulfillments WHERE id=?",[a.fulfillmentId]);
    assert.ok((await status(a.orderId)).reasonCodes.includes("FULFILLMENT_NONTERMINAL"));
    assert.deepEqual((await db.query("SELECT * FROM fulfillments WHERE id=?",[a.fulfillmentId]))[0][0],before);
  });
  await t.test("an unassigned in-progress operation blocks by nonnull authoritative order route",async()=>{
    const a=await seedFulfillmentSalesOrder(db);
    await a.insert("fulfillment_operation_requests",pendingIntent(a));
    assert.deepEqual(await status(a.orderId),{version:"1",status:"OPEN",reasonCodes:["OPERATION_IN_PROGRESS"]});
  });
  await t.test("real Inventory-backed Sales claim blocks Archive",async(child)=>{
    const a=await currentOwnerFixture(child,t=>issueFixture(t,{beforeIssue:true})),service=new FulfillmentOpenMatterService({database:a.database}),value=await service.getOrderArchiveStatus(String(a.s.orderId),{atMs:Date.now()});const [[inventory]]=await a.db.query("SELECT outstanding_quantity FROM inventory_reservations WHERE id=?",[a.reservationId]),[[owner]]=await a.db.query("SELECT active_claimed_quantity FROM fulfillment_line_reservation_claims WHERE id=?",[a.claim]);assert.ok(BigInt(inventory.outstanding_quantity)>0n);assert.ok(BigInt(owner.active_claimed_quantity)>0n);assert.equal(value.status,"OPEN");assert.ok(value.reasonCodes.includes("CLAIM_ACTIVE"));
  });
  await t.test("actual owner allocation projection prevents active commitments from being mistaken for CLOSED",async(child)=>{
    const a=await currentOwnerFixture(child,t=>issueFixture(t,{beforeIssue:true})),service=new FulfillmentOpenMatterService({database:a.database}),value=await service.getOrderArchiveStatus(String(a.s.orderId),{atMs:Date.now()});const [[inventory]]=await a.db.query("SELECT outstanding_quantity FROM inventory_allocations WHERE id=?",[a.inventoryAllocationId]),[[owner]]=await a.db.query("SELECT status,allocated_base_quantity,picked_base_quantity,released_base_quantity FROM fulfillment_allocations WHERE id=?",[a.projection]);assert.ok(BigInt(inventory.outstanding_quantity)>0n);assert.equal(owner.status,"ACTIVE");assert.ok(BigInt(owner.allocated_base_quantity)>BigInt(owner.released_base_quantity));assert.equal(value.status,"OPEN");assert.ok(value.reasonCodes.includes("ALLOCATION_OUTSTANDING"));
  });
  await t.test("Shipment draft and reversal intent are observed as OPEN using real owner persistence",async(child)=>{
    const draft=await currentOwnerFixture(child,t=>issueFixture(t,{beforeIssue:true})),draftService=new FulfillmentOpenMatterService({database:draft.database}),draftState=await draftService.getOrderArchiveStatus(String(draft.s.orderId),{atMs:Date.now()});assert.equal((await draft.db.query("SELECT status FROM shipments WHERE id=?",[draft.shipment]))[0][0].status,"DRAFT");assert.equal(draftState.status,"OPEN");assert.ok(draftState.reasonCodes.includes("SHIPMENT_NONTERMINAL"));
    const issued=await currentOwnerFixture(child),event=randomUUID();await issued.db.execute("UPDATE shipments SET status='REVERSING',reversal_event_id=?,version=version+1 WHERE id=?",[event,issued.shipment]);await issued.s.insert("shipment_reversals",{reversal_number:"REV-"+randomUUID().slice(0,12),shipment_id:issued.shipment,status:"REVERSING",event_id:event,correlation_id:randomUUID(),reason:"Synthetic reversal",goods_under_company_control:1,goods_returned_to_original_bins:1,created_at:issued.s.now});
    const reversing=await new FulfillmentOpenMatterService({database:issued.database}).getOrderArchiveStatus(String(issued.s.orderId),{atMs:Date.now()});assert.equal(reversing.status,"OPEN");assert.ok(reversing.reasonCodes.includes("SHIPMENT_NONTERMINAL"));assert.ok(reversing.reasonCodes.includes("REVERSAL_IN_PROGRESS"));
  });
  await t.test("read-only Export intents have no order scope and cannot block unrelated Sales documents",async()=>{
    await db.query("INSERT INTO fulfillment_operation_requests(event_id,operation_type,target_type,payload_hash,status,lease_owner,lease_expires_at,attempt_count,correlation_id,created_at,updated_at) VALUES (?,'EXPORT','EXPORT',?,'IN_PROGRESS','synthetic-owner',1700000060001,1,?,1,1)",[randomUUID(),"a".repeat(64),randomUUID()]);
    assert.equal((await status(closed.orderId)).status,"CLOSED");
  });
  await t.test("future owner business timestamp is UNKNOWN",async()=>{
    await db.query("UPDATE fulfillments SET last_business_updated_at=?,version=version+1 WHERE id=?",[r.time.nowMs()+1,closed.fulfillmentId]);assert.equal((await status(closed.orderId)).status,"UNKNOWN");
    await db.query("UPDATE fulfillments SET last_business_updated_at=?,version=version+1 WHERE id=?",[closed.now,closed.fulfillmentId]);
  });
  await t.test("owner line-count inconsistency is UNKNOWN rather than an empty result",async()=>{
    await db.query("UPDATE fulfillments SET line_count=2,version=version+1 WHERE id=?",[closed.fulfillmentId]);assert.deepEqual((await status(closed.orderId)).reasonCodes,["OWNER_STATE_INCONSISTENT"]);await db.query("UPDATE fulfillments SET line_count=1,version=version+1 WHERE id=?",[closed.fulfillmentId]);
  });
  await t.test("current schema drift is UNKNOWN and cannot use cached CLOSED",async()=>{
    await db.query("ALTER TABLE fulfillment_operation_requests MODIFY public_error_code VARCHAR(81) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''");
    assert.deepEqual((await status(closed.orderId)).reasonCodes,["SCHEMA_INCOMPATIBLE"]);
    await db.query("ALTER TABLE fulfillment_operation_requests MODIFY public_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''");assert.equal((await status(closed.orderId)).status,"CLOSED");
  });
  await t.test("missing installed migration version is UNKNOWN despite complete physical tables",async()=>{
    const [[version]]=await db.query("SELECT * FROM fr_schema_migrations WHERE name='migrations/0106_protect_fulfillment_archive_contracts.js'");
    await db.query("DELETE FROM fr_schema_migrations WHERE name=?",[version.name]);assert.deepEqual((await status(closed.orderId)).reasonCodes,["SCHEMA_VERSION_UNAVAILABLE"]);
    await db.query("INSERT INTO fr_schema_migrations SET ?",version);
  });
  await t.test("real installed lifecycle adapter permits CLOSED and rejects OPEN without absent-provider fallback",async()=>{
    const services={require:name=>({mysqldatabase:r.database,context:r.context,time:r.time})[name]},adapter=new FulfillmentOpenMatterRuntimeService({services}),guard=new SalesFulfillmentGuardService({services:{names:()=>["fulfillmentOpenMatter"],resolve:async()=>adapter}}),jwt=await writeActor(closed,db),command={orderId:closed.orderId,action:"CANCEL",eventId:randomUUID(),expectedVersion:1};
    await r.transaction(async tx=>{await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[closed.orderId]);assert.equal(await guard.assertAllowed(tx,command),"ALLOWED");},{jwt,isolationLevel:"READ COMMITTED"});
    const [[header]]=await db.query("SELECT * FROM fulfillments WHERE id=?",[closed.fulfillmentId]),[[line]]=await db.query("SELECT * FROM fulfillment_lines WHERE id=?",[closed.fulfillmentLineId]);delete header.id;header.fulfillment_number="FUL-"+randomUUID().slice(0,12);header.status="DRAFT";header.version=1;const id=await closed.insert("fulfillments",header);delete line.id;line.fulfillment_id=id;await closed.insert("fulfillment_lines",line);
    await assert.rejects(()=>r.transaction(async tx=>{await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[closed.orderId]);return guard.assertAllowed(tx,command);},{jwt,isolationLevel:"READ COMMITTED"}),error=>error.code==="OPEN_FULFILLMENT_EXISTS");await db.query("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[id]);
  });
  await t.test("application discovery injects the real provider into the full Sales lifecycle and rolls back blocked cancellation",async(child)=>{
    const a=await currentOwnerFixture(child,lifecycleFixture),doc=await ownerDocument(a);await a.db.execute("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[doc.id]);const claimId=await a.s.insert("fulfillment_line_reservation_claims",{fulfillment_id:doc.id,fulfillment_line_id:doc.line,sales_order_line_reservation_id:a.mappingId,inventory_reservation_id:a.reservationId,original_claimed_quantity:1,active_claimed_quantity:1,status:"ACTIVE",inventory_version:1,created_at:a.s.now,updated_at:a.s.now});
    const source=defaultConfigurationSource(),app=await createApplication({handlers:{},configurationSource:{...source,application:{...source.application,port:0},database:{...source.database,database:a.f.name,user:a.f.connectionOptions.user,password:a.f.connectionOptions.password},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.confirmationRecovery":{enabled:false},"sales.backorderAllocate":{enabled:false},"sales.importWorker":{enabled:false},"sales.exportWorker":{enabled:false}}}}});
    try{assert.ok(app.services.names().includes("fulfillmentOpenMatter"));assert.ok(await app.services.resolve("fulfillmentOpenMatter") instanceof FulfillmentOpenMatterRuntimeService);const database=app.services.require("mysqldatabase"),context=app.services.require("context"),time=app.services.require("time"),lifecycle=new SalesOrderLifecycleService({database,time,services:app.services,logger:app.services.require("logging").logger}),eventId=randomUUID();
      await assert.rejects(()=>context.storage.run({databaseTransaction:null,signal:null,auth:{claims:a.jwt},startedAt:time.nowMs()},()=>lifecycle.cancel({claims:a.claims,id:a.s.orderId,input:{eventId,version:1,reason:"Synthetic cancellation"}})),error=>error.code==="OPEN_FULFILLMENT_EXISTS");assert.equal((await a.db.query("SELECT status FROM sales_orders WHERE id=?",[a.s.orderId]))[0][0].status,"CONFIRMED");assert.equal((await a.db.query("SELECT outstanding_quantity FROM inventory_reservations WHERE id=?",[a.reservationId]))[0][0].outstanding_quantity,1);assert.equal((await a.db.query("SELECT active_claimed_quantity FROM fulfillment_line_reservation_claims WHERE id=?",[claimId]))[0][0].active_claimed_quantity,1);assert.equal((await a.db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?",[eventId]))[0][0].n,0);
    }finally{await app.shutdown("owner-provider-native-test-complete");}
  });
  await t.test("stale untrusted RR view cannot grant CLOSED; a fresh advisory sees the committed intent",async()=>{
    const a=await seedFulfillmentSalesOrder(db);
    await r.transaction(async tx=>{const [[before]]=await tx.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests WHERE sales_order_id=?",[a.orderId]);assert.equal(before.n,0);await a.insert("fulfillment_operation_requests",pendingIntent(a));const [[stale]]=await tx.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests WHERE sales_order_id=?",[a.orderId]);assert.equal(stale.n,0);
      await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[a.orderId]);assert.deepEqual(await r.service.getOrderArchiveStatusInTransaction(tx,{orderId:String(a.orderId),atMs:r.time.nowMs()}),{version:"1",status:"UNKNOWN",reasonCodes:["PROVIDER_UNAVAILABLE"]});
    });assert.ok((await status(a.orderId)).reasonCodes.includes("OPERATION_IN_PROGRESS"));
  });
  await t.test("caller Sales lock serializes a competing future business intent writer",async()=>{
    const a=await seedCancelledFulfillment(db),writer=await mysql.createConnection({...f.connectionOptions,database:f.name});
    try{await writer.query("SET SESSION innodb_lock_wait_timeout=1");await r.transaction(async tx=>{await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[a.orderId]);assert.deepEqual(await r.service.getOrderArchiveStatusInTransaction(tx,{orderId:String(a.orderId),atMs:r.time.nowMs()}),{version:"1",status:"UNKNOWN",reasonCodes:["PROVIDER_UNAVAILABLE"]});
      await writer.beginTransaction();await assert.rejects(()=>writer.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[a.orderId]),{code:"ER_LOCK_WAIT_TIMEOUT"});await writer.rollback();
    });await writer.beginTransaction();await writer.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[a.orderId]);await writer.query("INSERT INTO fulfillment_operation_requests SET ?",pendingIntent(a));await writer.commit();assert.ok((await status(a.orderId)).reasonCodes.includes("OPERATION_IN_PROGRESS"));}finally{await writer.rollback();await writer.end();}
  });
  await t.test("native business query plans expose indexed order paths and every query is bounded",async()=>{
    const other=await seedCancelledFulfillment(db),rows=Array.from({length:1000},(_,i)=>["PLAN-"+i,other.orderId,String(other.orderId),other.customerId,"Synthetic","Synthetic",other.warehouseId,"Synthetic","Synthetic","PICKED",1,other.now,other.now,other.now]);
    await db.query("INSERT INTO fulfillments(fulfillment_number,sales_order_id,sales_order_number_snapshot,customer_id,customer_code_snapshot,customer_name_snapshot,warehouse_id,warehouse_code_snapshot,warehouse_name_snapshot,status,line_count,last_business_updated_at,created_at,updated_at) VALUES ?",[rows]);
    const [parents]=await db.query("SELECT id FROM fulfillments WHERE fulfillment_number LIKE 'PLAN-%' ORDER BY id"),lineRows=parents.map(row=>[row.id,other.orderId,other.lineId,1,1,other.skuId,"Synthetic","Synthetic",other.uomId,"Each","Each","none",1,1,1,other.now,other.now]);
    await db.query("INSERT INTO fulfillment_lines(fulfillment_id,sales_order_id,sales_order_line_id,line_no,sales_order_line_no,sku_id,sku_code_snapshot,sku_name_snapshot,base_uom_id,base_uom_code_snapshot,base_uom_name_snapshot,tracking_policy_snapshot,planned_base_quantity,allocated_base_quantity,picked_base_quantity,created_at,updated_at) VALUES ?",[lineRows]);
    const intents=rows.map(()=>pendingIntent(other)),columns=Object.keys(intents[0]);await db.query(`INSERT INTO fulfillment_operation_requests (${columns.join(",")}) VALUES ?`,[intents.map(row=>columns.map(key=>row[key]))]);
    // Synthetic unrelated selectivity rows use legal current storage transitions; positive business flows above use actual Inventory services.
    await db.query("INSERT INTO shipments(shipment_number,fulfillment_id,sales_order_id,customer_id,warehouse_id,status,shipping_address_id,shipping_address_version,line_count,last_business_updated_at,created_at,updated_at) SELECT CONCAT('PLAN-SHP-',id),id,sales_order_id,customer_id,warehouse_id,'DRAFT',?,1,1,last_business_updated_at,created_at,updated_at FROM fulfillments WHERE sales_order_id=? AND fulfillment_number LIKE 'PLAN-%'",[other.addressId,other.orderId]);
    await db.query("INSERT INTO shipment_lines(shipment_id,fulfillment_id,fulfillment_line_id,line_no,sales_order_line_id,sku_id,base_uom_id,sku_code_snapshot,sku_name_snapshot,base_uom_code_snapshot,shipped_base_quantity,created_at,updated_at) SELECT s.id,s.fulfillment_id,l.id,1,l.sales_order_line_id,l.sku_id,l.base_uom_id,l.sku_code_snapshot,l.sku_name_snapshot,l.base_uom_code_snapshot,1,l.created_at,l.updated_at FROM shipments s JOIN fulfillment_lines l ON l.fulfillment_id=s.fulfillment_id WHERE s.shipment_number LIKE 'PLAN-SHP-%'");
    await db.query("UPDATE shipments SET status='CANCELLED',version=version+1 WHERE shipment_number LIKE 'PLAN-SHP-%'");for(const table of ["fulfillments","fulfillment_lines","shipments","shipment_lines","fulfillment_operation_requests"]){const [[shape]]=await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table==="fulfillments"?"fulfillment_number LIKE 'PLAN-%'":table==="shipments"?"shipment_number LIKE 'PLAN-SHP-%'":table==="fulfillment_operation_requests"?"sales_order_id="+other.orderId:"fulfillment_id IN (SELECT id FROM fulfillments WHERE fulfillment_number LIKE 'PLAN-%')"}`);assert.equal(Number(shape.n),1000,table);}
    for(const table of ["fulfillments","fulfillment_lines","shipments","fulfillment_operation_requests"])await db.query(`ANALYZE TABLE ${table}`);
    const start=r.queries.length;assert.equal((await status(closed.orderId)).status,"CLOSED");const business=r.queries.slice(start).filter(entry=>entry.sql.startsWith("SELECT")&&!entry.sql.includes("information_schema")&&!entry.sql.includes("fr_schema_migrations")&&/\bFROM\s+[a-z_]+/u.test(entry.sql));const expectedFamilies=["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_allocations","fulfillment_status_history","shipments","fulfillment_audit_logs","fulfillment_operation_requests"].sort(),families=business.map(entry=>entry.sql.match(/\bFROM\s+([a-z_]+)/u)?.[1]).sort();assert.deepEqual(families,expectedFamilies,"Every current advisory owner family must be read exactly once for this closed aggregate");
    for(const {sql,parameters}of business){assert.doesNotMatch(sql,/FOR UPDATE/u,"Fresh advisory must not claim coordinator lock authority");assert.match(sql,/LIMIT (?:1|500)$|\bid IN \(/u);for(const match of sql.matchAll(/\bIN \(([^)]+)\)/gu))assert.ok((match[1].match(/\?/gu)??[]).length<=500,"Each primary-key or parent batch remains bounded to500");
      const [[plan]]=await db.query("EXPLAIN FORMAT=JSON "+sql,parameters),parsed=JSON.parse(plan.EXPLAIN),tables=[];const collect=value=>{if(!value||typeof value!=="object")return;if(value.table_name)tables.push(value);for(const child of Object.values(value))if(typeof child==="object")collect(child);};collect(parsed);assert.ok(tables.length);
      for(const table of tables){assert.ok(expectedFamilies.includes(table.table_name),"Only the fixed current owner catalogue may be accessed");const mode=table.index_access_type??table.access_type,indexed=table.index_access_type?["index_range_scan","index_lookup","unique_index_lookup"].includes(mode):["system","const","eq_ref","ref","ref_or_null","range","index_merge"].includes(mode),scan=table.index_access_type?["table_scan","full_table_scan","index_scan","full_index_scan"].includes(mode):["ALL","index"].includes(mode);assert.ok(indexed||scan,"Unknown access mode must fail closed: "+JSON.stringify(parsed));if(scan){assert.match(table.table_name,/^[a-z_]+$/u);const [[actual]]=await db.query(`SELECT COUNT(*) AS n FROM ${table.table_name}`);assert.equal(Number(actual.n),0,"Only a genuinely empty physical table has no rows to scan; populated owner paths must use an index: "+JSON.stringify(parsed));}}
    }
  });
  await t.test("provider connection failure returns safe UNKNOWN",async()=>{
    await r.database.shutdown();assert.deepEqual((await status(closed.orderId)).reasonCodes,["PROVIDER_UNAVAILABLE"]);
  });
});
