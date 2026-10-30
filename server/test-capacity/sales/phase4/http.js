import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createServer,request as requestHttp} from "node:http";
import {createRequire} from "node:module";
import {readFile,writeFile,mkdir,statfs} from "node:fs/promises";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {createApplication} from "../../../src/framework/application/createApplication.js";
import {defaultConfigurationSource} from "../../../src/framework/configuration/applicationConfiguration.js";
import {prepareDiskTempDirectory} from "../../../src/framework/upload/normalizeUploadConfig.js";
const require=createRequire(import.meta.url);
const mysql=require("mysql2/promise");
export const privateRoot="/Users/sam/.codex/worktrees/sales-p4-archive/phase4-private";
export function quantiles(samples){
 assert.ok(samples.length>0);const sorted=samples.map(s=>typeof s==="number"?s:s.ms).sort((a,b)=>a-b);
 return {count:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],p99:sorted[Math.ceil(sorted.length*.99)-1],max:sorted.at(-1)};
}
export async function openCapacity(){
 const binding=JSON.parse(await readFile(path.join(privateRoot,"source-capacity-r1/dataset.json"),"utf8"));
 const completed=JSON.parse(await readFile(path.join(privateRoot,"source-capacity-r1/complete-1000000.json"),"utf8"));
 assert.equal(binding.status,"CONFIRMED");assert.equal(Number(completed.headers.n),1000000);assert.equal(Number(completed.lines),5000000);
 const runtime=JSON.parse(await readFile(path.join(privateRoot,"capacity-runtime-r1.json"),"utf8"));
 assert.equal(binding.runtimeUuid,runtime.server_uuid);assert.equal(process.env.DB_SOCKET_PATH,runtime.socket);
 const db=await mysql.createConnection({socketPath:runtime.socket,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:binding.schema,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true});
 const [[identity]]=await db.query("SELECT DATABASE() AS name,@@server_uuid AS uuid,@@skip_networking AS local_only,@@global.log_bin AS global_log,@@session.sql_log_bin AS session_log,@@innodb_thread_concurrency AS threads");
 assert.equal(identity.name,binding.schema);assert.equal(identity.uuid,runtime.server_uuid);
 for(const key of ["local_only","global_log","session_log"])assert.equal(Number(identity[key]),1);
 assert.equal(Number(identity.threads),2);assert.equal(binding.actors.length,50);
 const root=path.join(privateRoot,"performance-"+randomUUID());await mkdir(root,{mode:0o700});
 const save=async(name,data)=>writeFile(path.join(root,name),JSON.stringify(data)+"\n",{flag:"wx",mode:0o600});
 const source=defaultConfigurationSource();
 const app=await createApplication({configurationSource:{...source,database:{...source.database,database:binding.schema},application:{...source.application,host:"127.0.0.1",port:0},sales:{...source.sales,importChannelCodes:["SYNTHETIC"]},security:{...source.security,reverseProxy:{...source.security.reverseProxy,trustProxy:"loopback"}},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.archive":{enabled:true},"sales.importWorker":{enabled:true},"sales.backorderAllocate":{enabled:true},"sales.confirmationRecovery":{enabled:true},"sales.exportWorker":{enabled:true}}}}});
 const scheduler=app.services.require("scheduler"),calendar=scheduler.schedule.bind(scheduler),securityJobName="tokenRevocation.refresh";
 const scheduleSecurityOnly=(job,delayMs)=>{if(job.name===securityJobName)return calendar(job,delayMs);};scheduler.schedule=scheduleSecurityOnly;
 const jobs=app.services.require("salesJobs"),storage=prepareDiskTempDirectory(binding.storageRelative);
 jobs.importer.root=prepareDiskTempDirectory(path.join(storage,"jobs"));jobs.importer.tempRoot=prepareDiskTempDirectory(path.join(storage,"temp"));jobs.exports.root=prepareDiskTempDirectory(path.join(storage,"measured-exports"));
 const {url}=await app.start(),target=new URL(url),actors=binding.actors.map((id,index)=>({id,index}));
 const securityJob=scheduler.jobs.get(securityJobName);assert.ok(securityJob?.enabled&&scheduler.timers.has(securityJobName),"Actual token revocation refresh must remain scheduled before capacity requests");
 async function bearer(actor){
  if(!actor.token||Date.now()-actor.issuedAt>480000){actor.token=await app.services.require("jwt").issue({roles:binding.claims.claimedRoles,permissions:binding.claims.claimedPermissions},{subject:String(actor.id),version:await app.services.require("tokenRevocation").currentVersion(String(actor.id)),authTime:Math.floor(Date.now()/1000)});actor.issuedAt=Date.now();}return actor.token;
 }
 for(const actor of actors)await bearer(actor);
 const proxy=createServer((req,res)=>{
  const match=/^\/client\/(\d{1,2})(\/api\/.*)$/u.exec(req.url??"");
  if(!match||Number(match[1])>=50){res.writeHead(404).end();return;}
  const upstream=requestHttp({hostname:target.hostname,port:target.port,path:match[2],method:req.method,headers:{authorization:req.headers.authorization??"","content-type":req.headers["content-type"]??"application/json","idempotency-key":req.headers["idempotency-key"]??"","x-forwarded-for":`192.0.2.${Number(match[1])+1}`}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
  upstream.on("error",()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
 });
 await new Promise(resolve=>{proxy.listen(0,"127.0.0.1",resolve);});const base=`http://127.0.0.1:${proxy.address().port}`;
 const allRequests=[];
 async function http(actor,route,{method="GET",body,contentType="application/json",eventId,stream=false}={}){
  const start=performance.now(),sample={actor:actor.index,route,method,startedAt:Date.now(),ms:null,status:null};allRequests.push(sample);
  try{
   const response=await fetch(`${base}/client/${actor.index}${route}`,{method,headers:{Authorization:`Bearer ${await bearer(actor)}`,"Content-Type":contentType,...(eventId?{"Idempotency-Key":eventId}:{})},body:body===undefined?undefined:stream?body:JSON.stringify(body),...(stream?{duplex:"half"}:{}) ,signal:AbortSignal.timeout(120000)});
   const value=await response.json();Object.assign(sample,{ms:performance.now()-start,status:response.status,error:value.error?.code??null});return {response,value,sample};
  }catch(error){Object.assign(sample,{ms:performance.now()-start,error:error.code??error.name});throw error;}
 }
 const successful=({response,value},status=200)=>{assert.equal(response.status,status,JSON.stringify(value));return value.data;};
 async function confirm(actor,order){
  const eventId=randomUUID(),start=performance.now(),first=await http(actor,`/api/v1/sales-orders/${order.id}/confirm`,{method:"POST",eventId,body:{eventId,version:order.version}});let polls=0,terminal;
  if(first.response.status===200){terminal=successful(first);assert.equal(terminal.salesOrder.status,"CONFIRMED");}
  else{successful(first,202);do{await delay(2000);terminal=successful(await http(actor,`/api/v1/sales-operations/by-event/${eventId}`));assert.notEqual(terminal.status,"FAILED");}while(terminal.status!=="SUCCEEDED"&&++polls<20);assert.equal(terminal.status,"SUCCEEDED");}
  return {actor:actor.index,id:order.id,lineCount:order.lineCount,ms:performance.now()-start,polls,eventId};
 }
 async function create(actor,lineCount=1){
  const eventId=randomUUID(),input={eventId,customerId:binding.customers[actor.index],currencyCode:binding.currency,fulfillmentWarehouseId:binding.warehouses[actor.index%10].id,orderDate:app.services.require("time").fileDate(),lines:binding.skus.slice(0,lineCount).map(sku=>({skuId:sku.id,skuUomId:sku.uom,quantity:"1.000000",unitSellingPrice:"1.0000"}))};
  return successful(await http(actor,"/api/v1/sales-orders",{method:"POST",eventId,body:input}),201).salesOrder;
 }
 async function tick(name){const job=scheduler.jobs.get(name);assert.ok(job?.enabled);const before=scheduler.stats.get(name)?.runs??0,start=performance.now();await scheduler.execute(job);const stats=scheduler.stats.get(name);assert.equal(stats.runs,before+1);assert.equal(stats.failures,0);assert.equal(stats.timeouts,0);return {name,ms:performance.now()-start,stats:{...stats}};}
 async function reserve(){const disk=await statfs(root);assert.ok(disk.bavail*disk.bsize>100*1024**3,"100GiB reserve");}
 async function assertLogged(){const database=app.services.require("mysqldatabase"),borrowed=await database.acquireConnection();try{const [[row]]=await borrowed.query("SELECT @@global.log_bin AS global_log,@@session.sql_log_bin AS session_log");assert.deepEqual(row,{global_log:1,session_log:1});}finally{borrowed.release();}}
 async function close(){await save("http-requests.json",allRequests);await new Promise(resolve=>{proxy.close(resolve);});await app.shutdown("phase4_capacity_complete");await db.end();}
 async function enableCalendars(){scheduler.schedule=calendar;for(const job of scheduler.jobs.values())if(job.enabled&&job.name!=="sales.archive"&&job.name!==securityJobName)calendar(job,scheduler.initialDelayFor(job));}
 async function pauseCalendars(){
  scheduler.schedule=scheduleSecurityOnly;for(const [name,timer]of scheduler.timers)if(name!==securityJobName){scheduler.clearTimer(timer);scheduler.timers.delete(name);}
  const deadline=Date.now()+600000;while(scheduler.running.size){assert.ok(Date.now()<deadline,"Actual scheduled workers failed to settle");await delay(100);}
 }
 assert.equal(app.configuration.database.connectionLimit,10);assert.equal(app.configuration.database.queueLimit,200);await assertLogged();
 await save("runtime.json",{identity,binding:{schema:binding.schema,actors:binding.actors.length,plannedRows:binding.plannedRows,plannedLines:binding.plannedLines},cache:"InnoDB/OS cache uncontrolled; real writer initialization preceded run; no cold-cache claim",pool:10,queueLimit:200,requestsPerIp:app.configuration.requestLimiter.maxRequestsPerIpPerWindow,calendar:"controlled Archive execute retains actual500/600s; real token revocation refresh always retains configured cadence, other business jobs resume when mixed starts",noDR:true});
 return {app,db,binding,actors,root,save,http,successful,create,confirm,tick,scheduler,jobs,reserve,assertLogged,close,enableCalendars,pauseCalendars,allRequests};
}
