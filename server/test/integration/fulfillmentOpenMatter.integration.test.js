import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";
import { createFulfillmentArchiveDatabase } from "../sales/phase4/fulfillmentArchiveFixtures.js";
import { seedCancelledFulfillment, seedFulfillmentSalesOrder, seedFulfillmentClaim, seedFulfillmentAllocation } from "../sales/phase4/fulfillmentOwnerFixtures.js";
import { FulfillmentOpenMatterService } from "../../src/modules/fulfillment/FulfillmentOpenMatterService.js";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { FulfillmentOpenMatterRuntimeService } from "../../src/services/fulfillmentArchive/FulfillmentOpenMatterRuntimeService.js";
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
  const transaction=work=>context.storage.run({databaseTransaction:null,signal:null,auth:null,startedAt:time.nowMs()},()=>database.withTransaction(work));
  return {database,context,time,service,transaction,queries};
}
integrationTest("TC-045 TC-047 native missing owner schema never yields CLOSED",async t=>{
  const f=await createFulfillmentArchiveDatabase(t),r=actualRuntime(t,f);
  assert.deepEqual(await r.service.getOrderArchiveStatus("1",{atMs:r.time.nowMs()}),{version:"1",status:"UNKNOWN",reasonCodes:["SCHEMA_MISSING"]});
});
integrationTest("TC-045 TC-047 real Open Matter, lifecycle and transaction contracts",async t=>{
  const f=await createFulfillmentArchiveDatabase(t,{baseOnly:false}),r=actualRuntime(t,f),db=f.db;
  const status=orderId=>r.service.getOrderArchiveStatus(String(orderId),{atMs:r.time.nowMs()});
  const closed=await seedCancelledFulfillment(db);
  await t.test("full current schema and version ledger with no documents returns CLOSED without HTTP context",async()=>{
    assert.equal(r.context.get(),null);assert.deepEqual(await status("9007199254740991"),{version:"1",status:"CLOSED",reasonCodes:[]});assert.equal(r.context.get(),null);
  });
  await t.test("a real terminal owner with complete lines returns CLOSED",async()=>assert.equal((await status(closed.orderId)).status,"CLOSED"));
  await t.test("transaction-aware method uses actual executor and never commits caller work",async()=>{
    const marker=randomUUID();await assert.rejects(()=>r.transaction(async tx=>{
      await tx.query("INSERT INTO fulfillment_operation_requests(event_id,operation_type,target_type,sales_order_id,payload_hash,status,correlation_id,created_at,updated_at) VALUES (?,'CREATE','FULFILLMENT',?,?,'FAILED',?,1,1)",[marker,closed.orderId,"a".repeat(64),randomUUID()]);
      assert.equal((await r.service.getOrderArchiveStatusInTransaction(tx,{orderId:String(closed.orderId),atMs:r.time.nowMs()})).status,"CLOSED");
      throw new Error("Intentional outer rollback");
    }));assert.equal((await db.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests WHERE event_id=?",[marker]))[0][0].n,0);
  });
  await t.test("nonterminal Fulfillment blocks and status read preserves business timestamps",async()=>{
    const a=await seedCancelledFulfillment(db);await db.query("UPDATE fulfillments SET status='DRAFT' WHERE id=?",[a.fulfillmentId]);
    const [[before]]=await db.query("SELECT * FROM fulfillments WHERE id=?",[a.fulfillmentId]);
    assert.ok((await status(a.orderId)).reasonCodes.includes("FULFILLMENT_NONTERMINAL"));
    assert.deepEqual((await db.query("SELECT * FROM fulfillments WHERE id=?",[a.fulfillmentId]))[0][0],before);
  });
  await t.test("an unassigned in-progress operation blocks by nonnull authoritative order route",async()=>{
    const a=await seedFulfillmentSalesOrder(db);
    await a.insert("fulfillment_operation_requests",{event_id:randomUUID(),operation_type:"CREATE",target_type:"FULFILLMENT",sales_order_id:a.orderId,payload_hash:"a".repeat(64),status:"IN_PROGRESS",correlation_id:randomUUID(),created_at:a.now,updated_at:a.now});
    assert.deepEqual(await status(a.orderId),{version:"1",status:"OPEN",reasonCodes:["OPERATION_IN_PROGRESS"]});
  });
  await t.test("real Inventory-backed Sales claim blocks Archive",async()=>{
    const a=await seedFulfillmentClaim(db);assert.ok((await status(a.orderId)).reasonCodes.includes("CLAIM_ACTIVE"));
  });
  await t.test("actual owner allocation projection blocks until its Inventory allocation is consumed/released",async()=>{
    const a=await seedFulfillmentAllocation(db);assert.ok((await status(a.orderId)).reasonCodes.includes("ALLOCATION_OUTSTANDING"));
  });
  await t.test("Shipment draft and reversal intent are observed as OPEN using real owner persistence",async()=>{
    const a=await seedFulfillmentAllocation(db);
    const shipmentId=await a.insert("shipments",{shipment_number:"SHP-"+randomUUID().slice(0,12),fulfillment_id:a.fulfillmentId,sales_order_id:a.orderId,customer_id:a.customerId,warehouse_id:a.warehouseId,status:"DRAFT",shipping_address_id:a.addressId,shipping_address_version:1,line_count:1,last_business_updated_at:a.now,created_at:a.now,updated_at:a.now});
    await a.insert("shipment_lines",{shipment_id:shipmentId,fulfillment_id:a.fulfillmentId,fulfillment_line_id:a.fulfillmentLineId,line_no:1,sales_order_line_id:a.lineId,sku_id:a.skuId,base_uom_id:a.uomId,sku_code_snapshot:"Synthetic",sku_name_snapshot:"Synthetic",base_uom_code_snapshot:"EA",shipped_base_quantity:1,created_at:a.now,updated_at:a.now});
    assert.ok((await status(a.orderId)).reasonCodes.includes("SHIPMENT_NONTERMINAL"));
    await db.query("UPDATE shipments SET status='REVERSING' WHERE id=?",[shipmentId]);
    await a.insert("shipment_reversals",{reversal_number:"REV-"+randomUUID().slice(0,12),shipment_id:shipmentId,status:"REVERSING",event_id:randomUUID(),correlation_id:randomUUID(),reason:"Synthetic reversal",goods_under_company_control:1,goods_returned_to_original_bins:1,created_at:a.now});
    assert.ok((await status(a.orderId)).reasonCodes.includes("REVERSAL_IN_PROGRESS"));
  });
  await t.test("read-only Export intents have no order scope and cannot block unrelated Sales documents",async()=>{
    await db.query("INSERT INTO fulfillment_operation_requests(event_id,operation_type,target_type,payload_hash,status,correlation_id,created_at,updated_at) VALUES (?,'EXPORT','EXPORT',?,'IN_PROGRESS',?,1,1)",[randomUUID(),"a".repeat(64),randomUUID()]);
    assert.equal((await status(closed.orderId)).status,"CLOSED");
  });
  await t.test("future owner business timestamp is UNKNOWN",async()=>{
    await db.query("UPDATE fulfillments SET last_business_updated_at=? WHERE id=?",[r.time.nowMs()+1,closed.fulfillmentId]);assert.equal((await status(closed.orderId)).status,"UNKNOWN");
    await db.query("UPDATE fulfillments SET last_business_updated_at=? WHERE id=?",[closed.now,closed.fulfillmentId]);
  });
  await t.test("owner line-count inconsistency is UNKNOWN rather than an empty result",async()=>{
    await db.query("UPDATE fulfillments SET line_count=2 WHERE id=?",[closed.fulfillmentId]);assert.deepEqual((await status(closed.orderId)).reasonCodes,["OWNER_STATE_INCONSISTENT"]);await db.query("UPDATE fulfillments SET line_count=1 WHERE id=?",[closed.fulfillmentId]);
  });
  await t.test("current schema drift is UNKNOWN and cannot use cached CLOSED",async()=>{
    await db.query("ALTER TABLE fulfillment_operation_requests MODIFY public_error_code VARCHAR(81) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''");
    assert.deepEqual((await status(closed.orderId)).reasonCodes,["SCHEMA_INCOMPATIBLE"]);
    await db.query("ALTER TABLE fulfillment_operation_requests MODIFY public_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''");assert.equal((await status(closed.orderId)).status,"CLOSED");
  });
  await t.test("missing installed migration version is UNKNOWN despite complete physical tables",async()=>{
    const [[version]]=await db.query("SELECT * FROM fr_schema_migrations WHERE name='migrations/0093_protect_fulfillment_archive_contracts.js'");
    await db.query("DELETE FROM fr_schema_migrations WHERE name=?",[version.name]);assert.deepEqual((await status(closed.orderId)).reasonCodes,["SCHEMA_VERSION_UNAVAILABLE"]);
    await db.query("INSERT INTO fr_schema_migrations SET ?",version);
  });
  await t.test("real installed lifecycle adapter permits CLOSED and rejects OPEN without absent-provider fallback",async()=>{
    const services={require:name=>({mysqldatabase:r.database,context:r.context,time:r.time})[name]};
    const adapter=new FulfillmentOpenMatterRuntimeService({services});
    const guard=new SalesFulfillmentGuardService({services:{names:()=>["fulfillmentOpenMatter"],resolve:async()=>adapter}});
    const command={orderId:closed.orderId,action:"CANCEL",eventId:randomUUID(),expectedVersion:1};
    await r.transaction(async tx=>{await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[closed.orderId]);assert.equal(await guard.assertAllowed(tx,command),"ALLOWED");});
    await db.query("UPDATE fulfillments SET status='DRAFT' WHERE id=?",[closed.fulfillmentId]);
    await assert.rejects(()=>r.transaction(async tx=>{await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[closed.orderId]);return guard.assertAllowed(tx,command);}),error=>error.code==="OPEN_FULFILLMENT_EXISTS");
    await db.query("UPDATE fulfillments SET status='CANCELLED' WHERE id=?",[closed.fulfillmentId]);
  });
  await t.test("application discovery injects the real provider into the full Sales lifecycle and rolls back blocked cancellation",async()=>{
    const a=await seedFulfillmentClaim(db),label="fa-"+randomUUID().slice(0,12),userId=await a.insert("users",{username:label,password_hash:"synthetic-only",display_name:"Synthetic",created_at:a.now,updated_at:a.now}),roleId=await a.insert("roles",{name:label,created_at:a.now});
    await db.query("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)",[userId,roleId]);
    await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name IN ('sales.view','sales.mgmt')",[roleId]);
    await db.query("UPDATE sales_orders SET status='CONFIRMED' WHERE id=?",[a.orderId]);
    await db.query("UPDATE sales_order_lines SET cancelled_base_quantity=0,reserved_outstanding_base_quantity=1 WHERE id=?",[a.lineId]);
    const source=defaultConfigurationSource();
    const app=await createApplication({handlers:{},configurationSource:{...source,application:{...source.application,port:0},database:{...source.database,database:f.name,user:f.connectionOptions.user,password:f.connectionOptions.password},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.confirmationRecovery":{enabled:false},"sales.backorderAllocate":{enabled:false},"sales.importWorker":{enabled:false},"sales.exportWorker":{enabled:false}}}}});
    try {
      assert.ok(app.services.names().includes("fulfillmentOpenMatter"));
      assert.ok(app.services.require("fulfillmentOpenMatter") instanceof FulfillmentOpenMatterRuntimeService);
      const database=app.services.require("mysqldatabase"),context=app.services.require("context"),time=app.services.require("time");
      const lifecycle=new SalesOrderLifecycleService({database,time,services:app.services,logger:app.services.require("logging").logger});
      await assert.rejects(()=>context.storage.run({databaseTransaction:null,signal:null,auth:null,startedAt:time.nowMs()},()=>lifecycle.cancel({claims:{actorId:userId,claimedRoles:[label],claimedPermissions:["sales.view","sales.mgmt"]},id:a.orderId,input:{eventId:randomUUID(),version:1,reason:"Synthetic cancellation"}})),error=>error.code==="OPEN_FULFILLMENT_EXISTS");
      assert.equal((await db.query("SELECT status FROM sales_orders WHERE id=?",[a.orderId]))[0][0].status,"CONFIRMED");
      assert.equal((await db.query("SELECT outstanding_quantity FROM inventory_reservations WHERE id=?",[a.reservationId]))[0][0].outstanding_quantity,1);
      assert.equal((await db.query("SELECT active_claimed_quantity FROM fulfillment_line_reservation_claims WHERE id=?",[a.claimId]))[0][0].active_claimed_quantity,1);
    } finally {await app.shutdown("owner-provider-native-test-complete");}
  });
  await t.test("current locking reads see an intent committed after the caller opened its RR snapshot",async()=>{
    const a=await seedFulfillmentSalesOrder(db);
    await r.transaction(async tx=>{
      await tx.query("SELECT COUNT(*) FROM fulfillment_operation_requests");
      await a.insert("fulfillment_operation_requests",{event_id:randomUUID(),operation_type:"CREATE",target_type:"FULFILLMENT",sales_order_id:a.orderId,payload_hash:"a".repeat(64),status:"IN_PROGRESS",correlation_id:randomUUID(),created_at:a.now,updated_at:a.now});
      await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[a.orderId]);
      assert.ok((await r.service.getOrderArchiveStatusInTransaction(tx,{orderId:String(a.orderId),atMs:r.time.nowMs()})).reasonCodes.includes("OPERATION_IN_PROGRESS"));
    });
  });
  await t.test("caller Sales lock serializes a competing future business intent writer",async()=>{
    const a=await seedCancelledFulfillment(db),writer=await mysql.createConnection({...f.connectionOptions,database:f.name});
    try {
      await writer.query("SET SESSION innodb_lock_wait_timeout=1");
      await r.transaction(async tx=>{
        await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[a.orderId]);
        assert.equal((await r.service.getOrderArchiveStatusInTransaction(tx,{orderId:String(a.orderId),atMs:r.time.nowMs()})).status,"CLOSED");
        await writer.beginTransaction();await assert.rejects(()=>writer.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[a.orderId]),{code:"ER_LOCK_WAIT_TIMEOUT"});await writer.rollback();
      });
      await writer.beginTransaction();await writer.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[a.orderId]);
      await writer.query("INSERT INTO fulfillment_operation_requests(event_id,operation_type,target_type,sales_order_id,payload_hash,status,correlation_id,created_at,updated_at) VALUES (?,'CREATE','FULFILLMENT',?,?,'IN_PROGRESS',?,1,1)",[randomUUID(),a.orderId,"a".repeat(64),randomUUID()]);await writer.commit();
      assert.ok((await status(a.orderId)).reasonCodes.includes("OPERATION_IN_PROGRESS"));
    } finally {await writer.rollback();await writer.end();}
  });
  await t.test("native business query plans expose indexed order paths and every query is bounded",async()=>{
    const other=await seedCancelledFulfillment(db);
    const rows=Array.from({length:1000},(_,i)=>["PLAN-"+i,other.orderId,String(other.orderId),other.customerId,"Synthetic","Synthetic",other.warehouseId,"Synthetic","Synthetic","CANCELLED",1,other.now,other.now,other.now]);
    await db.query("INSERT INTO fulfillments(fulfillment_number,sales_order_id,sales_order_number_snapshot,customer_id,customer_code_snapshot,customer_name_snapshot,warehouse_id,warehouse_code_snapshot,warehouse_name_snapshot,status,line_count,last_business_updated_at,created_at,updated_at) VALUES ?",[rows]);
    await db.query("INSERT INTO fulfillment_operation_requests(event_id,operation_type,target_type,sales_order_id,payload_hash,status,correlation_id,created_at,updated_at) VALUES ?",[rows.map(()=>[randomUUID(),"CREATE","FULFILLMENT",other.orderId,"a".repeat(64),"IN_PROGRESS",randomUUID(),other.now,other.now])]);
    await db.query("INSERT INTO shipments(shipment_number,fulfillment_id,sales_order_id,customer_id,warehouse_id,status,shipping_address_id,shipping_address_version,line_count,last_business_updated_at,created_at,updated_at) SELECT CONCAT('PLAN-SHP-',id),id,sales_order_id,customer_id,warehouse_id,'CANCELLED',?,1,1,last_business_updated_at,created_at,updated_at FROM fulfillments WHERE sales_order_id=?",[other.addressId,other.orderId]);
    for(const table of ["fulfillments","shipments","fulfillment_operation_requests"])await db.query(`ANALYZE TABLE ${table}`);
    const start=r.queries.length;assert.equal((await status(closed.orderId)).status,"CLOSED");
    const business=r.queries.slice(start).filter(entry=>entry.sql.startsWith("SELECT")&&!entry.sql.includes("information_schema")&&!entry.sql.includes("fr_schema_migrations"));
    assert.equal(business.length,22);
    for(const {sql,parameters}of business) {
      const [[plan]]=await db.query("EXPLAIN FORMAT=JSON "+sql,parameters);
      const parsed=JSON.parse(plan.EXPLAIN),tables=[];
      const collect=value=>{if(!value||typeof value!=="object")return;if(value.table_name)tables.push(value);for(const child of Object.values(value))if(typeof child==="object")collect(child);};collect(parsed);
      assert.ok(tables.length);assert.ok(tables.every(table=>table.index_access_type ? ["index_range_scan","index_lookup","unique_index_lookup"].includes(table.index_access_type) : !["ALL","index"].includes(table.access_type)),JSON.stringify(parsed));assert.match(sql,/LIMIT (?:1|500) FOR UPDATE$/u);
    }
  });
  await t.test("provider connection failure returns safe UNKNOWN",async()=>{
    await r.database.shutdown();assert.deepEqual((await status(closed.orderId)).reasonCodes,["PROVIDER_UNAVAILABLE"]);
  });
});
