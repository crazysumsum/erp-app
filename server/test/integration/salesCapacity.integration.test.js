import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createServer,request as httpRequest} from "node:http";
import {cpus,totalmem} from "node:os";
import {performance} from "node:perf_hooks";
import process from "node:process";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import {setup,stock} from "../sales/phase2/fixtures.js";
import {createTestCurrency} from "../sales/phase1/fixtures.js";
import {reconcileCommitments} from "../sales/phase2/commitmentReconciliation.js";
import {createApplication} from "../../src/framework/application/createApplication.js";
import {defaultConfigurationSource} from "../../src/framework/configuration/applicationConfiguration.js";
import {SalesOrderService} from "../../src/modules/sales/SalesOrderService.js";
import {SalesOrderConfirmationService} from "../../src/modules/sales/SalesOrderConfirmationService.js";

const it=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function capacity(t){
 const f=await setup(t);await stock(f,0);f.customerIds=[f.customerId];
 const source=defaultConfigurationSource(),app=await createApplication({configurationSource:{...source,application:{...source.application,port:0},security:{...source.security,reverseProxy:{...source.security.reverseProxy,trustProxy:"loopback"}},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.confirmationRecovery":{enabled:true},"sales.backorderAllocate":{enabled:true}}}}});
 t.after(()=>app.shutdown("sales_capacity_complete"));const database=app.services.require("mysqldatabase"),time=app.services.require("time"),logger=app.services.require("logging").logger,order=new SalesOrderService({database,time,logger}),confirmation=new SalesOrderConfirmationService({database,time,logger}),skus=[{skuId:f.skuId,skuUomId:f.skuUomId}],actors=[];
 const [[uom]]=await f.db.query("SELECT uom_id FROM item_sku_uoms WHERE id=?",[f.skuUomId]);
 for(let i=1;i<100;i++){const code=`capacity-${randomUUID()}`,skuId=await f.insert("item_skus",{item_id:f.itemId,sku_code:code,sku_name:code,status:"active",sellable:1,inventory_tracked:1,created_at:f.now,updated_at:f.now}),skuUomId=await f.insert("item_sku_uoms",{sku_id:skuId,uom_id:Number(uom.uom_id),to_base_factor:1,is_base:1,is_default_sale:1,created_at:f.now,updated_at:f.now});skus.push({skuId,skuUomId});}
 const [[bin]]=await f.db.query("SELECT id FROM inventory_bins WHERE warehouse_id=?",[f.warehouseId]);
 for(const sku of skus)await f.db.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,created_at,updated_at) VALUES (?,?,?,'AVAILABLE',100000,?,?)",[f.warehouseId,Number(bin.id),sku.skuId,f.now,f.now]);
 for(let index=0;index<50;index++){
  const code=`capacity-${randomUUID()}`,currencyCode=await createTestCurrency(f.db,f.cleanup,f.now);await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?",[currencyCode]);
  const customerId=await f.insert("customers",{customer_code:code,customer_code_key:code,legal_name:code,legal_name_key:code,default_currency_code:currencyCode,status:"active",version:1,created_at:f.now,updated_at:f.now}),userId=await f.insert("users",{username:code,password_hash:"synthetic-only",display_name:"Capacity synthetic user",created_at:f.now,updated_at:f.now});f.customerIds.push(customerId);await f.db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)",[userId,f.roleId]);
  f.beforeParents.push(async()=>{await f.db.execute("DELETE FROM sales_orders WHERE customer_id=?",[customerId]);await f.db.execute("DELETE FROM sales_audit_logs WHERE actor_user_id=?",[userId]);await f.db.execute("DELETE FROM sales_operation_requests WHERE actor_user_id=?",[userId]);await f.db.execute("DELETE FROM fr_token_versions WHERE subject=?",[String(userId)]);await f.db.execute("DELETE FROM user_roles WHERE user_id=?",[userId]);});
  const claims={...f.claims,actorId:userId},token=await app.services.require("jwt").issue({roles:claims.claimedRoles,permissions:claims.claimedPermissions},{subject:String(userId),version:await app.services.require("tokenRevocation").currentVersion(String(userId)),authTime:Math.floor(f.now/1000)});actors.push({index,customerId,currencyCode,claims,token});
 }
 async function create(actor,lineCount){const created=await order.create({claims:actor.claims,input:{eventId:randomUUID(),customerId:actor.customerId,currencyCode:actor.currencyCode,fulfillmentWarehouseId:f.warehouseId,orderDate:time.fileDate(),lines:skus.slice(0,lineCount).map(sku=>({...sku,quantity:"1.000000",unitSellingPrice:"1.0000"}))}});return {actor,id:created.salesOrder.id,eventId:randomUUID(),version:1,lineCount};}
 // Real owned lease rows are preserved; startup prepares them and both background jobs share the HTTP application's pool.
 for(const name of ["sales.confirmationRecovery","sales.backorderAllocate"]){const [[original]]=await f.db.query("SELECT * FROM fr_job_leases WHERE job_name=?",[name]);f.beforeParents.push(async()=>{if(original)await f.db.execute("UPDATE fr_job_leases SET owner=?,acquired_at=?,expires_at=? WHERE job_name=?",[original.owner,original.acquired_at,original.expires_at,name]);else await f.db.execute("DELETE FROM fr_job_leases WHERE job_name=?",[name]);});}
 const recovery=await create(actors[0],1);await confirmation.startConfirmation({claims:recovery.actor.claims,id:recovery.id,input:{eventId:recovery.eventId,version:1}});await f.db.execute("UPDATE sales_operation_requests SET lease_until=0,updated_at=0 WHERE event_id=?",[recovery.eventId]);
 // A genuinely queued Backorder is created before replenishment so the background allocator has a real Inventory effect.
 await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0 WHERE warehouse_id=? AND sku_id=?",[f.warehouseId,f.skuId]);const queued=await create(actors[1],1),intent=await confirmation.startConfirmation({claims:queued.actor.claims,id:queued.id,input:{eventId:queued.eventId,version:1}});await confirmation.completeConfirmation({eventId:intent.eventId,claims:queued.actor.claims,leaseOwner:intent.leaseOwner});await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=100000 WHERE warehouse_id=? AND sku_id=?",[f.warehouseId,f.skuId]);
 const {url}=await app.start(),target=new URL(url),proxy=createServer((req,res)=>{
  const match=/^\/client\/(\d{1,2})(\/api\/.*)$/u.exec(req.url??"");if(!match||Number(match[1])>=50){res.writeHead(404).end();return;}
  // This loopback-only test proxy assigns TEST-NET peers; incoming forwarding headers cannot choose an identity.
  const upstream=httpRequest({hostname:target.hostname,port:target.port,path:match[2],method:req.method,headers:{authorization:req.headers.authorization,"content-type":"application/json","idempotency-key":req.headers["idempotency-key"]??"","x-forwarded-for":`192.0.2.${Number(match[1])+1}`}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on("error",()=>{res.writeHead(502).end();});req.pipe(upstream);
 });await new Promise(resolve=>{proxy.listen(0,"127.0.0.1",resolve);});t.after(()=>new Promise(resolve=>{proxy.close(resolve);}));const proxyUrl=`http://127.0.0.1:${proxy.address().port}`;
 const scheduler=app.services.require("scheduler"),jobs=["sales.confirmationRecovery","sales.backorderAllocate"].map(name=>scheduler.jobs.get(name));
 async function confirm(request){
  const started=performance.now(),headers={Authorization:`Bearer ${request.actor.token}`,"Content-Type":"application/json","Idempotency-Key":request.eventId},root=`${proxyUrl}/client/${request.actor.index}`,response=await fetch(`${root}/api/v1/sales-orders/${request.id}/confirm`,{method:"POST",headers,body:JSON.stringify({eventId:request.eventId,version:request.version})});let value=await response.json(),polls=0;
  if(response.status===202){while(value.data?.status!=="SUCCEEDED"&&polls++<20){await delay(Number(response.headers.get("Retry-After")??2)*1000);const lookup=await fetch(`${root}/api/v1/sales-operations/by-event/${request.eventId}`,{headers});value=await lookup.json();if(lookup.status!==200)break;}}
  return {ms:performance.now()-started,lineCount:request.lineCount,httpStatus:response.status,polls,complete:response.status===200&&value.data?.salesOrder?.status==="CONFIRMED"||response.status===202&&value.data?.status==="SUCCEEDED",errorCode:value.error?.code??null};
 }
 f.beforeParents.push(async()=>{await new Promise(resolve=>{proxy.close(resolve);});await app.shutdown("sales_capacity_fixture_cleanup");});
 return {f,app,create,confirm,actors,scheduler,jobs,recovery,queued};
}
for(const warm of [false,true])it(`TC-032 50 distinct interactive users with mixed1/100-line HTTP confirmation and actual background jobs (${warm?"five confirmation warmups":"no confirmation warmup"})`,async t=>{
 const c=await capacity(t),samples=[],excludedFailures=[];let peakPoolQueue=0;
 assert.equal(c.app.configuration.database.connectionLimit,10);assert.equal(c.app.configuration.database.queueLimit,200);assert.equal(c.app.configuration.requestLimiter.maxRequestsPerIpPerWindow,20);assert.equal(c.app.configuration.requestLimiter.maxConcurrentRequests,100);assert.equal(c.app.configuration.requestLimiter.maxQueueSize,200);
 if(warm)for(let index=0;index<5;index++){const result=await c.confirm(await c.create(c.actors[index],index===4?100:1));assert.equal(result.complete,true);}
 const started=performance.now();
 for(let round=0;round<3;round++){
  const requests=[];for(const actor of c.actors)requests.push(await c.create(actor,actor.index%10===0?100:1));
  const pool=c.app.services.require("mysqldatabase").pool.pool,monitor=setInterval(()=>{peakPoolQueue=Math.max(peakPoolQueue,pool._connectionQueue.length);},5);monitor.unref();
  try{const work=c.jobs.map(job=>c.scheduler.execute(job)),results=await Promise.all(requests.map(request=>c.confirm(request)));await Promise.all(work);samples.push(...results);excludedFailures.push(...results.filter(result=>!result.complete));}finally{clearInterval(monitor);}
 }
 const sorted=samples.map(sample=>sample.ms).sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1],[[mysql]]=await c.f.db.query("SELECT VERSION() AS version,@@innodb_buffer_pool_size AS buffer_pool_bytes"),reconciliation=await reconcileCommitments(c.f),background=c.jobs.map(job=>c.scheduler.stats.get(job.name));
 const report={scenario:warm?"five confirmation warmups":"no confirmation warmup; cache already seeded",users:50,rounds:3,samples:samples.length,lineDistribution:{one:135,hundred:15},warmupRequests:warm?5:0,durationIncludingRoundPreparationMs:performance.now()-started,quantile:"nearest-rank ceil(n*0.95)",p50Ms:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:p95,maxMs:sorted.at(-1),latencySamplesMs:samples.map(sample=>Number(sample.ms.toFixed(3))),statuses:samples.reduce((counts,sample)=>({...counts,[sample.httpStatus]:(counts[sample.httpStatus]??0)+1}),{}),excludedDependencyFailures:excludedFailures,hardware:{cpu:cpus()[0].model,cpuCount:cpus().length,memoryBytes:totalmem()},node:process.version,mysql:mysql.version,bufferPoolBytes:Number(mysql.buffer_pool_bytes),pool:c.app.configuration.database.connectionLimit,queueLimit:c.app.configuration.database.queueLimit,rateLimit:c.app.configuration.requestLimiter.maxRequestsPerIpPerWindow,proxy:"loopback trusted only; 50 synthetic TEST-NET client peers",background:background.map(stats=>({runs:stats.runs,failures:stats.failures,timeouts:stats.timeouts})),reconciliation};
 const [[effects]]=await c.f.db.query("SELECT (SELECT status FROM sales_operation_requests WHERE event_id=?) AS recovered,(SELECT reserved_outstanding_base_quantity FROM sales_order_lines WHERE sales_order_id=?) AS allocated,(SELECT COUNT(*) FROM sales_order_line_reservations r JOIN sales_order_lines l ON l.id=r.sales_order_line_id JOIN inventory_operation_requests p ON p.id=r.inventory_operation_id WHERE l.sales_order_id=? AND p.actor_user_id IS NULL AND p.actor_label='sales.backorderAllocate') AS worker_mappings",[c.recovery.eventId,c.queued.id,c.queued.id]);report.backgroundEffects=effects;report.peakPoolQueue=peakPoolQueue;
 t.diagnostic(JSON.stringify(report));assert.equal(samples.length,150);assert.equal(excludedFailures.length,0,"Every confirmation must reach a correct terminal outcome; no dependency failure is hidden");assert.ok(background.every(stats=>stats.runs>=3&&stats.failures===0&&stats.timeouts===0));assert.deepEqual(effects,{recovered:"SUCCEEDED",allocated:1,worker_mappings:1});assert.ok(peakPoolQueue>0,"50 users must contend for the actual ten-connection pool");assert.deepEqual(reconciliation.mismatches,{conservation:0,mappings:0,queue:0,flags:0,reservations:0,controls:0});assert.ok(p95<=3000,`Completed confirmation P95 ${p95.toFixed(1)}ms exceeds 3000ms`);
});
