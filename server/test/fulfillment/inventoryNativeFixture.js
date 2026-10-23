import { createMySqlDatabasePool } from "../../src/services/mysqldatabase/connection.js";
import { nativeDatabase } from "./nativeDatabase.js";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";

export async function inventoryNativeFixture(t) {
  let pool=null;
  const f=await nativeDatabase(t,{migrateAuth:true,beforeClose:async()=>{if(pool)await pool.end();}});
  for (const name of ["0011_create_item_categories","0012_create_item_brands","0013_create_item_uoms","0014_create_items","0015_create_item_skus","0016_create_item_sku_uoms",
    "0055_seed_inventory_permissions","0056_create_inventory_operations","0057_create_inventory_audit","0058_create_inventory_master","0059_create_inventory_stock","0060_create_inventory_movements","0063_create_inventory_reservations","0091_seed_fulfillment_permissions"]) await (await import(`../../database/migrations/${name}.js`)).up(f.db);
  const insert=async(sql,args=[])=>String((await f.db.execute(sql,args))[0].insertId);
  const actorId=Number(await insert("INSERT INTO users(username,password_hash,created_at,updated_at) VALUES('Synthetic','unused',1,1)"));
  const role=await insert("INSERT INTO roles(name,created_at) VALUES('synthetic-fulfillment',1)");
  const permissions=["fulfillment.view","fulfillment.operation","fulfillment.reverse","inventory.fefo.override"];
  await f.db.execute("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",[actorId,role]);
  await f.db.execute(`INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name IN (${permissions.map(()=>"?").join(",")})`,[role,...permissions]);
  const category=await insert("INSERT INTO item_categories(name,created_at,updated_at) VALUES('Synthetic',1,1)");
  const brand=await insert("INSERT INTO item_brands(name,created_at,updated_at) VALUES('Synthetic',1,1)");
  const uomId=await insert("INSERT INTO item_uoms(code,name,created_at,updated_at) VALUES('EA','Each',1,1)");
  const itemId=await insert("INSERT INTO items(name,category_id,brand_id,product_type,status,created_at,updated_at) VALUES('Synthetic',?,?,'variant','active',1,1)",[category,brand]);
  const skuId=await insert("INSERT INTO item_skus(item_id,sku_code,sku_name,status,sellable,inventory_tracked,tracking_policy,created_at,updated_at) VALUES(?,'SYN','Synthetic','active',0,1,'none',1,1)",[itemId]);
  await insert("INSERT INTO item_sku_uoms(sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES(?,?,1,1,1,1)",[skuId,uomId]);
  const warehouseId=await insert("INSERT INTO inventory_warehouses(warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES('SYN','syn','Synthetic',1,1)");
  const binId=await insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'A','a',1,1)",[warehouseId]);
  const balanceId=await insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,allocated_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',20,0,'2026-10-01',1,1)",[warehouseId,binId,skuId]);
  await insert("INSERT INTO inventory_stock_controls(warehouse_id,sku_id,reserved_quantity,created_at,updated_at) VALUES(?,?,0,1,1)",[warehouseId,skuId]);
  const time={nowMs:()=>Date.parse("2026-10-21T01:00:00Z"),fileDate:()=>"2026-10-21",timestamp:()=>"2026-10-21T01:00:00Z"};
  const context=new RequestContextService({services:{require:()=>time}}),logger={async info(){},async warn(){},async error(){}};
  const config={...f.options,database:f.name,connectionLimit:4,waitForConnections:true,queueLimit:10,acquireTimeoutMs:5000,queryTimeoutMs:10000,transactionTimeoutMs:20000,abandonedConnectionAction:"destroy"};
  pool=createMySqlDatabasePool(config);
  const database=new MySqlDatabaseService({pool,config,context,logger});
  const actor={userId:actorId,serviceName:"",claimedRoles:["synthetic-fulfillment"],claimedPermissions:permissions};
  const withActor=(work,options={})=>context.storage.run({auth:{claims:{sub:String(actorId),roles:actor.claimedRoles,permissions}},databaseTransaction:null},()=>database.withTransaction(work,options));
  const operations=new InventoryOperationService();
  const reservation=async(lineId,quantity="5",eventId=`seed-${lineId}`)=>{
    const claim=await operations.claim(f.db,{commandType:"SALES_LINE_RESERVE",source:{module:"SALES",documentType:"SALES_ORDER",documentId:"1",lineId,eventId},payload:{lineId,quantity},actorUserId:actorId,actorLabel:"Synthetic",createdAt:1});
    const id=await insert("INSERT INTO inventory_reservations(create_operation_id,warehouse_id,sku_id,original_quantity,outstanding_quantity,purpose,status,created_at,updated_at) VALUES(?,?,?,?,?,'SALE','ACTIVE',1,1)",[claim.operationId,warehouseId,skuId,quantity,quantity]);
    await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=reserved_quantity+? WHERE warehouse_id=? AND sku_id=?",[quantity,warehouseId,skuId]);
    await operations.complete(f.db,{operationId:claim.operationId,resultType:"RESERVATION",resultId:id,resultSummary:{reservationId:id},completedAt:1});
    return id;
  };
  return {...f,insert,actor,time,context,logger,database,withActor,operations,reservation,warehouseId,binId,balanceId,skuId,uomId,itemId};
}
