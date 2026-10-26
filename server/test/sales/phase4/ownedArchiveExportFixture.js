import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {rm} from "node:fs/promises";
import path from "node:path";
import {archiveFactsFixture} from "../../fulfillment/archiveFactsFixture.js";
import {createApplication} from "../../../src/framework/application/createApplication.js";
import {defaultConfigurationSource} from "../../../src/framework/configuration/applicationConfiguration.js";
import {prepareDiskTempDirectory} from "../../../src/framework/upload/normalizeUploadConfig.js";
import {SalesSequenceService} from "../../../src/modules/sales/SalesSequenceService.js";
import {SalesOrderService} from "../../../src/modules/sales/SalesOrderService.js";
// Permanent mirrors survive row teardown; only this exact owned nonce schema is discarded after all pools close.
export async function ownedArchiveExportFixture(t){
 const owned=await archiveFactsFixture(t,{shipmentDate:"2023-11-14"});
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL("../../../scripts/migrate.js",import.meta.url))],{env:{...process.env,DB_NAME:owned.f.name,DB_USER:owned.f.connectionOptions.user,DB_PASSWORD:owned.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});
 const root=prepareDiskTempDirectory("storage/sales-export-test-"+randomUUID()),previousShutdown=owned.f.cleanup.shutdown,application={current:null};
 owned.f.cleanup.shutdown=async()=>{const errors=[];for(const work of [()=>application.current?.shutdown("guarded_archive_export_complete"),()=>previousShutdown?.(),async()=>{assert.match(path.basename(root),/^sales-export-test-[a-f0-9-]+$/u);await rm(root,{recursive:true});}])try{await work();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,"Owned Archive Export cleanup failed");};
 const source=defaultConfigurationSource(),app=await createApplication({configurationSource:{...source,database:{...source.database,database:owned.f.name,user:owned.f.connectionOptions.user,password:owned.f.connectionOptions.password,socketPath:owned.f.connectionOptions.socketPath},application:{...source.application,host:"127.0.0.1",port:0}},serviceOptions:{scheduler:{setTimer:()=>({unref(){}}),clearTimer(){}}}});
 application.current=app;
 const database=app.services.require("mysqldatabase"),time=app.services.require("time"),logger=app.services.require("logging").logger,exports=app.services.require("salesJobs").exports,scheduler=app.services.require("scheduler");exports.root=root;
 const [[parent]]=await owned.db.query("SELECT currency_code,sales_order_number FROM sales_orders WHERE id=?",[owned.s.orderId]),claims={actorId:owned.userId,claimedRoles:[owned.label],claimedPermissions:[...owned.permissions,"sales.view","sales.mgmt"]};
 await owned.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?",[parent.currency_code]);await owned.db.execute("UPDATE item_skus SET sellable=1 WHERE id=?",[owned.s.skuId]);
 // The controlled historical provider fixture supplied number1 directly; allocate its matching current-period slot before the new real writer.
 if(parent.sales_order_number.startsWith(`SO-${time.fileDate().slice(0,7).replace("-","")}-`))await database.withTransaction(async tx=>{assert.equal(await new SalesSequenceService({time}).nextNumberInTransaction(tx,{documentType:"SALES_ORDER",nowMs:time.nowMs()}),parent.sales_order_number);});
 const created=await new SalesOrderService({database,time,logger}).create({claims,input:{eventId:randomUUID(),customerId:owned.s.customerId,currencyCode:parent.currency_code,fulfillmentWarehouseId:owned.s.warehouseId,orderDate:time.fileDate(),lines:[{skuId:owned.s.skuId,skuUomId:owned.s.skuUomId,quantity:"10.000000",unitSellingPrice:"1.0000"}]}});
 await app.start();
 const run=async id=>{await scheduler.execute(scheduler.jobs.get("sales.exportWorker"));return (await owned.db.query("SELECT * FROM sales_export_jobs WHERE id=?",[id]))[0][0];};
 return {db:owned.db,app,database,time,logger,exports,claims,run,request:{id:created.salesOrder.id},customerId:owned.s.customerId,now:time.nowMs(),insert:owned.s.insert};
}
