import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { readFile,readdir } from "node:fs/promises";
import { fileURLToPath,pathToFileURL } from "node:url";
import path from "node:path";
import { createTestCurrency } from "../phase1/fixtures.js";
import { SalesFulfillmentService } from "../../../src/modules/sales/SalesFulfillmentService.js";
import { MySqlDatabaseService } from "../../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { RequestContextService } from "../../../src/services/context/RequestContextService.js";

async function createSalesProviderDatabase(t){
  if(process.env.DB_INTEGRATION_TESTS!=="1"||typeof process.env.DB_NAME!=="string"||! /^[A-Za-z0-9_]{1,30}$/u.test(process.env.DB_NAME))throw new Error("Explicit isolated Sales provider environment required");
  const name=`${process.env.DB_NAME}_sf_${randomUUID().replaceAll("-","").slice(0,12)}`;
  const connectionOptions={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),socketPath:process.env.DB_SOCKET_PATH,user:process.env.DB_ADMIN_USER??process.env.DB_USER,password:process.env.DB_ADMIN_PASSWORD??process.env.DB_PASSWORD,multipleStatements:true};
  const admin=await mysql.createConnection(connectionOptions),cleanup={shutdown:null};let db=null,created=false;
  t.after(async()=>{
    const errors=[];
    for(const close of [()=>cleanup.shutdown?.(),()=>db?.end(),()=>created&&admin.query(`DROP DATABASE \`${name}\``),()=>admin.end()]){try{await close();}catch(error){errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,"Sales provider owned resource cleanup failed");
  });
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);created=true;db=await mysql.createConnection({...connectionOptions,database:name});
  await db.query("CREATE TABLE fr_schema_migrations(name VARCHAR(190) PRIMARY KEY,applied_at BIGINT UNSIGNED NOT NULL)");
  const directory=fileURLToPath(new URL("../../../database/",import.meta.url));
  // The named P0 contribution is independent of unpublished Sales0089/0090 and every withdrawn owner installer.
  const migrations=(await readdir(path.join(directory,"migrations"))).filter(file=>/^[0-9]{4}_.*\.(?:js|sql)$/u.test(file)&&Number(file.slice(0,4))<=88).sort();
  for(const name of ["framework/idempotency.sql","framework/jwt.sql","framework/scheduler.sql",...migrations.map(file=>"migrations/"+file)]){
    if(name.endsWith(".js"))await (await import(pathToFileURL(path.join(directory,name)).href)).up(db);else await db.query(await readFile(path.join(directory,name),"utf8"));
    await db.execute("INSERT INTO fr_schema_migrations(name,applied_at) VALUES (?,?)",[name,Date.now()]);
  }
  return {db,name,connectionOptions,cleanup};
}

async function seedFulfillmentSalesOrder(db) {
  const label="fa_"+randomUUID().slice(0,12),now=1700000000000;
  const insert=async(table,row)=>Number((await db.query(`INSERT INTO ${table} SET ?`,row))[0].insertId);
  const currency=await createTestCurrency(db,[],now);
  const customerId=await insert("customers",{customer_code:label,customer_code_key:label,legal_name:label,legal_name_key:label,default_currency_code:currency,status:"active",created_at:now,updated_at:now});
  const warehouseId=await insert("inventory_warehouses",{warehouse_code:label,normalized_code:label,warehouse_name:label,status:"ACTIVE",created_at:now,updated_at:now});
  const uomId=await insert("item_uoms",{code:label,name:"Each",status:"active",created_at:now,updated_at:now});
  const itemId=await insert("items",{name:label,status:"active",created_at:now,updated_at:now});
  const skuId=await insert("item_skus",{item_id:itemId,sku_code:label,sku_name:label,status:"active",created_at:now,updated_at:now});
  const skuUomId=await insert("item_sku_uoms",{sku_id:skuId,uom_id:uomId,to_base_factor:1,is_base:1,is_default_sale:1,created_at:now,updated_at:now});
  const addressId=await insert("customer_addresses",{customer_id:customerId,label:"Synthetic",address_line1:"Synthetic only",created_at:now,updated_at:now});
  const orderId=await insert("sales_orders",{sales_order_number:label,status:"CANCELLED",source_type:"MANUAL",customer_id:customerId,customer_code_snapshot:label,customer_name_snapshot:label,currency_code:currency,fulfillment_warehouse_id:warehouseId,warehouse_code_snapshot:label,warehouse_name_snapshot:label,order_date:"2023-11-14",line_count:1,total_amount:"1.0000",created_at:now,updated_at:now,last_business_updated_at:now});
  const lineId=await insert("sales_order_lines",{sales_order_id:orderId,line_no:1,sku_id:skuId,sku_uom_id:skuUomId,item_name_snapshot:label,sku_code_snapshot:label,sku_name_snapshot:label,uom_code_snapshot:"EA",uom_name_snapshot:"Each",to_base_factor_snapshot:1,tracking_policy_snapshot:"none",ordered_quantity:"1.000000",ordered_base_quantity:1,unit_selling_price:"1.0000",price_source:"MANUAL",line_amount:"1.0000",cancelled_base_quantity:1,created_at:now,updated_at:now});
  return {orderId,lineId,customerId,warehouseId,uomId,skuId,skuUomId,addressId,now,insert};
}

export async function salesFulfillmentFixture(t){
  const f=await createSalesProviderDatabase(t),db=f.db,s=await seedFulfillmentSalesOrder(db),label="sf_"+randomUUID().slice(0,12),time={nowMs:()=>s.now+1,timestamp:()=>s.now+1};
  const userId=await s.insert("users",{username:label,password_hash:"synthetic-only",display_name:"Synthetic",created_at:s.now,updated_at:s.now}),roleId=await s.insert("roles",{name:label,created_at:s.now});
  await db.query("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)",[userId,roleId]);
  for(const name of ["fulfillment.view","fulfillment.operation","fulfillment.reverse"]){const [[permission]]=await db.query("SELECT id FROM permissions WHERE name=?",[name]);const id=permission?.id??await s.insert("permissions",{name,created_at:s.now});await db.query("INSERT INTO role_permissions(role_id,permission_id) VALUES (?,?)",[roleId,id]);}
  const reserveEvent=randomUUID(),root=await s.insert("inventory_operation_requests",{command_type:"SALES_BATCH_RESERVE",source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(s.orderId),source_event_id:reserveEvent,request_hash:"a".repeat(64),actor_label:label,created_at:s.now}),child=await s.insert("inventory_operation_requests",{command_type:"SALES_LINE_RESERVE",source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(s.orderId),source_line_id:String(s.lineId),source_event_id:reserveEvent,request_hash:"a".repeat(64),actor_label:label,created_at:s.now});
  const reservationId=await s.insert("inventory_reservations",{create_operation_id:child,warehouse_id:s.warehouseId,sku_id:s.skuId,original_quantity:1,outstanding_quantity:1,purpose:"SALE",status:"ACTIVE",created_at:s.now,updated_at:s.now});
  const mappingId=await s.insert("sales_order_line_reservations",{sales_order_line_id:s.lineId,inventory_reservation_id:reservationId,inventory_operation_id:root,source_event_id:reserveEvent,original_base_quantity:1,outstanding_base_quantity:1,status:"ACTIVE",inventory_version:1,created_at:s.now,updated_at:s.now});
  await db.query("UPDATE sales_orders SET status='CONFIRMED' WHERE id=?",[s.orderId]);await db.query("UPDATE sales_order_lines SET cancelled_base_quantity=0,reserved_outstanding_base_quantity=1 WHERE id=?",[s.lineId]);
  const context=new RequestContextService({services:{require:()=>time}}),pool=mysql.createPool({...f.connectionOptions,database:f.name,multipleStatements:false,connectionLimit:2});
  const database=new MySqlDatabaseService({pool,context,logger:{},config:{queryTimeoutMs:5000,transactionTimeoutMs:10000,acquireTimeoutMs:5000,abandonedConnectionAction:"destroy"}});f.cleanup.shutdown=()=>database.shutdown();
  const createService=options=>new SalesFulfillmentService({database,context,time,logger:{error(){}},...options});
  const service=createService(),permissions=["fulfillment.operation","fulfillment.reverse","fulfillment.view"],claims={sub:String(userId),roles:[label],permissions};
  const run=(auth,work,options={isolationLevel:"READ COMMITTED"})=>context.storage.run({databaseTransaction:null,signal:null,auth,startedAt:time.nowMs()},()=>database.withTransaction(work,options));
  const command=()=>({actor:{userId:String(userId),serviceName:"",claimedRoles:[label],claimedPermissions:permissions},purpose:"SHIPMENT_CONFIRMED",salesOrderId:String(s.orderId),expectedOrderVersion:1,shipmentId:"1",eventId:randomUUID(),inventoryRequestHash:"b".repeat(64),lines:[{salesOrderLineId:String(s.lineId),expectedVersion:1,baseQuantity:"1",reservations:[{claimId:"1",inventoryReservationId:String(reservationId),expectedVersion:1,baseQuantity:"1"}]}]});
  const before={order:(await db.query("SELECT * FROM sales_orders WHERE id=?",[s.orderId]))[0][0],line:(await db.query("SELECT * FROM sales_order_lines WHERE id=?",[s.lineId]))[0][0],mapping:(await db.query("SELECT * FROM sales_order_line_reservations WHERE id=?",[mappingId]))[0][0]};
  return {f,db,s,label,time,userId,roleId,reservationId,mappingId,root,reserveEvent,context,database,service,createService,permissions,claims,run,command,before};
}
