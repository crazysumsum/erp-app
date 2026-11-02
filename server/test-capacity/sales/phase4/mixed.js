import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {Readable} from "node:stream";
import {setTimeout as delay} from "node:timers/promises";
import {SALES_CSV_COLUMNS} from "../../../src/modules/sales/salesCsv.js";
import {quantiles} from "./http.js";
const require=createRequire(import.meta.url),{stringify}=require("csv-stringify");

async function upload(c,actor,runId){
 const eventId=randomUUID(),boundary="capacity-"+runId,digest=createHash("sha256");let bytes=0,rows=0;
 async function* body(){
  yield `--${boundary}\r\nContent-Disposition: form-data; name="eventId"\r\n\r\n${eventId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="capacity10000.csv"\r\nContent-Type: text/csv\r\n\r\n`;
  function* records(){
   yield SALES_CSV_COLUMNS.map(column=>column.name);
   for(let order=0;order<10000;order++)for(let line=0;line<5;line++){
    const key="MIX-"+runId+"-"+order,sku=c.binding.skus[line],record={templateVersion:"1.0",sourceOrderKey:key,channelCode:"SYNTHETIC",externalOrderId:key,customerId:String(c.binding.customers[30+order%45]),warehouseCode:c.binding.warehouses[order%10].code,orderDate:c.app.services.require("time").fileDate(),requestedDeliveryDate:"",currencyCode:c.binding.currency,paymentTermCode:"",customerPoReference:"",orderNotes:"Synthetic capacity mixed import",skuCode:sku.code,salesUomCode:c.binding.uomCode,quantity:"1",unitSellingPrice:"1",lineNote:""};rows++;yield SALES_CSV_COLUMNS.map(column=>record[column.name]);
   }
  }
  for await(const chunk of Readable.from(records()).pipe(stringify({record_delimiter:"\r\n"}))){bytes+=Buffer.byteLength(chunk);digest.update(chunk);yield chunk;}
  yield `\r\n--${boundary}--\r\n`;
 }
 const started=performance.now(),result=await c.http(actor,"/api/v1/sales-imports/upload",{method:"POST",eventId,contentType:`multipart/form-data; boundary=${boundary}`,stream:true,body:Readable.from(body())});const data=c.successful(result,201);assert.equal(rows,50000);assert.ok(bytes<=50*1024*1024);
 const [[stored]]=await c.db.query("SELECT file_sha256,file_size_bytes FROM sales_import_jobs WHERE id=?",[data.importJob.id]);assert.equal(Buffer.from(stored.file_sha256).toString("hex"),digest.digest("hex"));assert.equal(Number(stored.file_size_bytes),bytes);
 return {id:data.importJob.id,start:started,bytes,rows,uploadMs:performance.now()-started};
}
export async function mixedLoad(c,{archiveDuringLoad}={}){
 const [[initial]]=await c.db.query("SELECT COUNT(*) AS n,SUM(line_count) AS line_total FROM sales_orders");assert.equal(Number(initial.n),1000000);assert.equal(Number(initial.line_total),5000000);
 const [[archived]]=await c.db.query("SELECT id,sales_order_number FROM sales_orders_archive ORDER BY id LIMIT 1");assert.ok(archived,"Mixed Archive reads require genuinely moved rows");
 const [details]=await c.db.query("SELECT id,sales_order_number FROM sales_orders WHERE source_type='CSV' ORDER BY id LIMIT 50");assert.equal(details.length,50);
 const recovery=await c.create(c.actors[0],1),recoveryEvent=randomUUID();
 await c.app.services.require("context").storage.run({databaseTransaction:null,signal:null,auth:{claims:{sub:String(c.binding.claims.actorId),roles:c.binding.claims.claimedRoles,permissions:c.binding.claims.claimedPermissions}}},()=>c.jobs.confirmation.startConfirmation({claims:c.binding.claims,id:recovery.id,input:{eventId:recoveryEvent,version:recovery.version}}));
 await c.db.execute("UPDATE sales_operation_requests SET lease_until=0 WHERE event_id=?",[recoveryEvent]);
 const replenished=c.binding.skus[2],warehouse=c.binding.warehouses[0];
 const [[balance]]=await c.db.query("SELECT COUNT(*) AS n FROM inventory_stock_balances WHERE warehouse_id=? AND sku_id=?",[warehouse.id,replenished.id]);assert.equal(Number(balance.n),0,"Controlled initially zero-stock SKU must not overwrite an existing balance");
 await c.db.execute("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,created_at,updated_at)VALUES(?,?,?,'AVAILABLE',100,?,?)",[warehouse.id,warehouse.bin,replenished.id,Date.now(),Date.now()]);
 const baseline=process.memoryUsage(),peak={...baseline},pool=c.app.services.require("mysqldatabase").pool.pool;let peakQueue=0,peakInFlight=0,stage="ramp",jobId=null,stop=false;
 const samples=[],failures=[],bursts={precheck:new Set(),processing:new Set()},exports=[],runId=randomUUID(),started=performance.now(),rampEnd=started+60000,steadyEnd=rampEnd+900000,drainEnd=steadyEnd+300000;
 const monitor=setInterval(()=>{const now=process.memoryUsage();for(const key of Object.keys(peak))peak[key]=Math.max(peak[key],now[key]);peakQueue=Math.max(peakQueue,pool._connectionQueue.length);peakInFlight=Math.max(peakInFlight,pool._allConnections.length-pool._freeConnections.length);},100);monitor.unref();

 const slots=c.actors.map(()=>Promise.resolve()),actorInFlight=c.actors.map(()=>0),actorMaxInFlight=c.actors.map(()=>0);
 async function journey(actor,work){
  const prior=slots[actor.index],current=Promise.withResolvers();slots[actor.index]=current.promise;
  await prior;assert.equal(actorInFlight[actor.index],0);actorInFlight[actor.index]++;actorMaxInFlight[actor.index]=Math.max(actorMaxInFlight[actor.index],actorInFlight[actor.index]);try{return await work();}finally{actorInFlight[actor.index]--;current.resolve();}
 }
 let burstControl=null;
 const phaseOf=status=>status==="VALIDATING"?"precheck":status==="PROCESSING"?"processing":null;
 async function currentPhase(){if(!jobId)return null;const [[facts]]=await c.db.query("SELECT status FROM sales_import_jobs WHERE id=?",[jobId]);return phaseOf(facts.status);}
 const clients=c.actors.map(actor=>(async()=>{
  await delay(actor.index*1200);let round=0;
  while(!stop&&performance.now()<steadyEnd){
   if(burstControl){const control=burstControl;control.ready.add(actor.index);await control.release.promise;if(stop)break;await delay(10000);continue;}
   const began=performance.now();let kind;
   try{await journey(actor,async()=>{
    const slot=(round+++actor.index)%10;
    if(slot>=8){kind="confirm";const order=await c.create(actor,actor.index%10===0?100:1),cohort=await currentPhase(),result=await c.confirm(actor,order);samples.push({...result,kind,cohort,burst:false,startedMs:began-started});}
    else if(slot<4){kind="list";const route=(slot===0?"/api/v1/outstanding-sales-orders":"/api/v1/sales-orders")+"?customerId="+c.binding.customers[30+actor.index%45]+"&pageSize=20",result=await c.http(actor,route),data=c.successful(result);assert.ok(data.total>0);samples.push({kind,actor:actor.index,ms:result.sample.ms,startedMs:began-started});}
    else if(slot<7){kind="detail";const result=await c.http(actor,"/api/v1/sales-orders/"+details[actor.index].id),data=c.successful(result);assert.equal(data.number,details[actor.index].sales_order_number);samples.push({kind,actor:actor.index,ms:result.sample.ms,startedMs:began-started});}
    else{kind="archive";const result=await c.http(actor,"/api/v1/archived-sales-orders?number="+encodeURIComponent(archived.sales_order_number)),data=c.successful(result);assert.equal(data.total,1);assert.equal(data.items[0].id,Number(archived.id));samples.push({kind,actor:actor.index,ms:result.sample.ms,startedMs:began-started});}
   });}catch(error){failures.push({actor:actor.index,kind,stage,startedMs:began-started,ms:performance.now()-began,error:error.code??error.name,message:error.message});stop=true;break;}
   if(!stop&&performance.now()<steadyEnd)await delay(10000);
  }
 })());
 async function burst(cohort){
  assert.equal(burstControl,null);const control={ready:new Set(),release:Promise.withResolvers()};burstControl=control;const preparationAt=performance.now()-started,dispatches=[];
  try{
   // Join each regular client's journey boundary. Import timers/worker are never paused or modified.
   while(control.ready.size<50){assert.equal(failures.length,0,JSON.stringify(failures));assert.equal(await currentPhase(),cohort,"Actual Import stage ended before all50clients became idle");assert.ok(performance.now()<steadyEnd,"Stage burst missed steady window");await delay(100);}
   const prepared=await Promise.allSettled(c.actors.map(actor=>journey(actor,()=>c.create(actor,actor.index%10===0?100:1))));assert.ok(prepared.every(row=>row.status==="fulfilled"),"Every real burst Draft must be created");assert.equal(await currentPhase(),cohort,"Actual Import stage ended during genuine Draft preparation");
   const sent=await Promise.allSettled(c.actors.map((actor,index)=>(async()=>{const dispatchedAt=performance.now()-started;dispatches.push({actor:actor.index,atMs:dispatchedAt});const result=await journey(actor,()=>c.confirm(actor,prepared[index].value));samples.push({...result,kind:"confirm",cohort,burst:true,startedMs:dispatchedAt});bursts[cohort].add(actor.index);return result;})()));
   await c.save("mixed-burst-"+cohort+".json",{cohort,preparationAt,dispatches,settled:sent.map(row=>row.status==="fulfilled"?{status:row.status,result:row.value}:{status:row.status,error:row.reason?.code??row.reason?.name,message:row.reason?.message}),phaseAtCompletion:await currentPhase(),qualification:"All50 idle actors dispatched together in one Promise.allSettled cohort after actual stage read; every response/poll retained; original worker continues unchanged"});
   assert.ok(sent.every(row=>row.status==="fulfilled"),"A real50user confirmation burst failed; no outcome excluded");assert.equal(dispatches.length,50);assert.equal(new Set(dispatches.map(r=>r.actor)).size,50);assert.equal(bursts[cohort].size,50);
  }catch(error){stop=true;failures.push({kind:"stage-burst",cohort,code:error.code,message:error.message});throw error;}
  finally{burstControl=null;control.release.resolve();}
 }
 const workerStats=()=>["sales.importWorker","sales.confirmationRecovery","sales.backorderAllocate","sales.exportWorker","sales.metrics"].map(name=>({name,...c.scheduler.stats.get(name)}));
 let imported,archiveTask,importResult,mainFailure,cleanupFailure;
 try{
  await c.enableCalendars();await delay(Math.max(0,rampEnd-performance.now()));assert.equal(failures.length,0,JSON.stringify(failures));stage="upload";imported=await journey(c.actors[0],()=>upload(c,c.actors[0],runId));jobId=imported.id;stage="precheck";
  archiveTask=archiveDuringLoad?.().catch(error=>{failures.push({kind:"archive-worker",code:error.code,message:error.message});stop=true;});
  let nextExport=0,nextExportAt=rampEnd;
  for(;;){
   assert.equal(failures.length,0,JSON.stringify(failures));assert.ok(performance.now()-imported.start<1800000,"Full10000order import exceeded30minutes");await c.reserve();
   if(nextExport<5&&performance.now()>=nextExportAt){const actor=c.actors[nextExport],eventId=randomUUID(),result=await journey(actor,()=>c.http(actor,"/api/v1/sales-exports/create",{method:"POST",eventId,body:{eventId,scope:"ACTIVE",filters:{warehouseId:c.binding.warehouses[nextExport].id,sortBy:"number",descending:false}}}));exports.push({actor:actor.index,...c.successful(result,202)});assert.equal(new Set(exports.map(row=>row.id)).size,exports.length,"Each request must yield a distinct Export job");nextExport++;nextExportAt=rampEnd+nextExport*180000;}
   const [[job]]=await c.db.query("SELECT * FROM sales_import_jobs WHERE id=?",[jobId]);assert.ok(!["FAILED","CANCELLED","PARTIAL_SUCCESS"].includes(job.status),JSON.stringify({status:job.status,error:job.error_code}));
   if(job.status==="VALIDATING"&&bursts.precheck.size===0)await burst("precheck");
   if(job.status==="PROCESSING"&&bursts.processing.size===0)await burst("processing");
   if(job.status==="READY"){
    assert.equal(Number(job.source_order_count),10000);assert.equal(Number(job.total_row_count),50000);assert.equal(Number(job.valid_count),10000);assert.equal(bursts.precheck.size,50,"Real precheck phase must contain all50 actors; no Import-worker pause");stage="processing";const eventId=randomUUID();c.successful(await journey(c.actors[0],()=>c.http(c.actors[0],`/api/v1/sales-imports/${jobId}/confirm`,{method:"POST",eventId,body:{eventId,version:Number(job.version)}})),202);
   }
   if(job.status==="COMPLETED"&&!importResult){assert.equal(Number(job.success_count),10000);assert.equal(Number(job.failed_count),0);importResult={jobId,elapsedMs:performance.now()-imported.start,success:10000,failed:0};stage="completed";assert.equal(bursts.processing.size,50,"Real processing phase must contain all50 actors");}
   const stats=workerStats();assert.ok(stats.every(s=>s.failures===0&&s.timeouts===0),JSON.stringify(stats));
   if(performance.now()>=steadyEnd){await Promise.all(clients);stage="drain";const [states]=await c.db.query("SELECT id,status,row_count,error_code FROM sales_export_jobs WHERE id IN (?)",[exports.map(r=>r.id)]);assert.equal(states.length,exports.length,"No queued Export identity may disappear");assert.deepEqual(states.map(r=>Number(r.id)).sort((a,b)=>a-b),exports.map(r=>Number(r.id)).sort((a,b)=>a-b));assert.ok(states.every(s=>s.status!=="FAILED"),JSON.stringify(states));if(importResult&&exports.length===5&&states.every(s=>s.status==="COMPLETED")){for(const state of states){assert.ok(Number(state.row_count)>=45000);assert.ok(Number(state.row_count)<=250000);}break;}assert.ok(performance.now()<drainEnd,"Mixed5minute drain failed to settle");}
   await delay(1000);
  }
  await archiveTask;
 }catch(error){mainFailure=error;throw error;}finally{stop=true;burstControl?.release.resolve();const cleanup=[];try{await c.pauseCalendars();}catch(error){cleanup.push({stage:"pauseCalendars",code:error.code,message:error.message});}await Promise.allSettled(clients);await Promise.allSettled(slots);if(archiveTask)await Promise.allSettled([archiveTask]);clearInterval(monitor);await c.save("mixed-raw.json",{samples,failures,bursts:{precheck:[...bursts.precheck],processing:[...bursts.processing]},exports,imported,importResult,baseline,peak,peakQueue,peakInFlight,durationMs:performance.now()-started,initial,workerStats:workerStats(),rampMs:60000,steadyMs:900000,thinkMs:10000,drainMaxMs:300000,actorMaxInFlight,actorInFlightAtEnd:actorInFlight,cleanupErrors:cleanup,mainFailure:mainFailure?{code:mainFailure.code,message:mainFailure.message}:null,plannedRegularMix:{list:40,detail:30,archive:10,confirm:20},extraBurstWork:"one50actor1/100line burst in each actual precheck/processing phase; no discarded samples"});if(cleanup.length)cleanupFailure=new Error("Mixed scheduled worker cleanup failed");}
 if(cleanupFailure)throw cleanupFailure;
 assert.equal(failures.length,0);assert.ok(actorInFlight.every(value=>value===0));assert.ok(actorMaxInFlight.every(value=>value===1));assert.equal(exports.length,5);assert.equal(new Set(samples.map(s=>s.actor)).size,50);assert.ok(performance.now()>=steadyEnd);
 const confirmation=quantiles(samples.filter(s=>s.kind==="confirm")),steady= samples.filter(s=>s.startedMs>=60000&&s.startedMs<960000),report={confirmation,byKind:{},byStage:{},offeredJourneys:samples.length,steadyJourneys:steady.length,achievedSteadyJourneysPerSecond:steady.length/900};
 for(const kind of ["list","detail","archive","confirm"]){report.byKind[kind]=quantiles(samples.filter(s=>s.kind===kind));assert.ok(report.byKind[kind].p95<=(kind==="archive"?3000:kind==="confirm"?3000:2000));}
 for(const cohort of ["precheck","processing"]){const all=samples.filter(s=>s.kind==="confirm"&&s.cohort===cohort),burstSamples=all.filter(s=>s.burst);report.byStage[cohort]={...quantiles(all),burstCount:burstSamples.length,burstOneLine:burstSamples.filter(s=>s.lineCount===1).length,burstHundredLine:burstSamples.filter(s=>s.lineCount===100).length};assert.ok(all.length>=50);assert.equal(burstSamples.length,50);assert.equal(report.byStage[cohort].burstOneLine,45);assert.equal(report.byStage[cohort].burstHundredLine,5);assert.ok(report.byStage[cohort].p95<=3000);}
 await c.save("mixed-complete.json",report);assert.ok(confirmation.p95<=3000);assert.ok(workerStats().every(s=>s.runs>0&&s.failures===0&&s.timeouts===0));
 const [[business]]=await c.db.query("SELECT COUNT(DISTINCT o.id) AS orders,COUNT(l.id) AS line_total FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=o.id JOIN sales_intake_orders i ON i.id=o.source_intake_order_id WHERE i.import_job_id=?",[jobId]);assert.equal(Number(business.orders),10000);assert.equal(Number(business.line_total),50000);
 const [[effects]]=await c.db.query("SELECT (SELECT status FROM sales_operation_requests WHERE event_id=?) AS recovered,(SELECT COUNT(*) FROM sales_order_line_reservations m JOIN sales_order_lines l ON l.id=m.sales_order_line_id JOIN inventory_operation_requests p ON p.id=m.inventory_operation_id WHERE l.sku_id=? AND p.actor_label='sales.backorderAllocate' AND m.outstanding_base_quantity>0) AS real_allocations",[recoveryEvent,replenished.id]);assert.equal(effects.recovered,"SUCCEEDED");assert.ok(Number(effects.real_allocations)>0);await c.save("mixed-business-effects.json",{business,effects,syntheticOpeningStock:100,skuId:replenished.id,warehouseId:warehouse.id});
 return report;
}
