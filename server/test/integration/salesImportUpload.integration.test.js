import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {mkdtemp,writeFile,rm,readdir,readFile,unlink} from "node:fs/promises";
import {migrationFixture} from "../sales/phase1/fixtures.js";
import {createApplication} from "../../src/framework/application/createApplication.js";
import {defaultConfigurationSource} from "../../src/framework/configuration/applicationConfiguration.js";
import {prepareDiskTempDirectory} from "../../src/framework/upload/normalizeUploadConfig.js";
import {SalesImportService} from "../../src/modules/sales/SalesImportService.js";
import {buildSalesImportTemplate} from "../../src/modules/sales/salesCsv.js";
import {ApplicationError} from "../../src/framework/errors/ApplicationError.js";
const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function setup(t) {
 const f=await migrationFixture(t,[]),source=defaultConfigurationSource();
 const base=prepareDiskTempDirectory(`storage/test-sales-upload-native-${randomUUID()}`),tempRoot=prepareDiskTempDirectory(path.join(base,"temp")),root=prepareDiskTempDirectory(path.join(base,"jobs"));
 const app=await createApplication({configurationSource:{...source,application:{...source.application,port:0},api:{...source.api,upload:{...source.api.upload,diskTempDirectory:tempRoot}}}});
 t.after(()=>app.shutdown("sales_import_upload_complete"));t.after(()=>rm(base,{recursive:true,force:true}));
 const database=app.services.require("mysqldatabase"),time=app.services.require("time"),name="import-native-"+randomUUID().slice(0,8);
 const roleId=await f.insert("roles",{name,created_at:f.now}),userId=await f.insert("users",{username:name,password_hash:"synthetic-only",display_name:"Synthetic Importer",created_at:f.now,updated_at:f.now});
 await f.db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)",[userId,roleId]);
 for(const permission of ["sales.view","sales.import"])await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?",[roleId,permission]);
 f.beforeParents.push(async()=>{
  const [jobs]=await f.db.query("SELECT batch_number FROM sales_import_jobs WHERE created_by=?",[userId]);
  for(const job of jobs)await rm(path.join(prepareDiskTempDirectory("storage/sales-imports"),job.batch_number),{recursive:true,force:true});
  await f.db.execute("DELETE FROM sales_import_jobs WHERE created_by=?",[userId]);await f.db.execute("DELETE FROM sales_operation_requests WHERE actor_user_id=?",[userId]);
  await f.db.execute("DELETE FROM fr_token_versions WHERE subject=?",[String(userId)]);await f.db.execute("DELETE FROM role_permissions WHERE role_id=?",[roleId]);await f.db.execute("DELETE FROM user_roles WHERE user_id=?",[userId]);
 });
 const claims={actorId:userId,claimedRoles:[name],claimedPermissions:["sales.import","sales.view"]};
 const service=new SalesImportService({database,time,root,tempRoot});
 async function file(content=buildSalesImportTemplate()) {
  const directory=await mkdtemp(path.join(tempRoot,"upload-")),storedName=randomUUID()+".csv";
  await writeFile(path.join(directory,".upload-owner"),"erp-disk-upload-v1\n",{mode:0o600});await writeFile(path.join(directory,storedName),content,{mode:0o600});
  return {field:"file",path:path.join(directory,storedName),storedName,originalName:"synthetic.csv",mimeType:"text/csv",size:Buffer.byteLength(content),contentHash:createHash("sha256").update(content).digest("hex")};
 }
 const jobs=async()=>Number((await f.db.query("SELECT COUNT(*) AS n FROM sales_import_jobs WHERE created_by=?",[userId]))[0][0].n);
 return {...f,app,database,time,root,tempRoot,claims,userId,roleId,service,file,jobs};
}
integrationTest("TC-034 native upload atomically owns file, replays original event and only warns for same content",async t=>{
 const f=await setup(t),eventId=randomUUID(),file=await f.file(),result=await f.service.createFromUpload({claims:f.claims,eventId,file});
 assert.equal(result.importJob.status,"UPLOADED");assert.match(result.importJob.batchNumber,/^SI-\d{6}-\d{6}$/u);
 assert.equal(await readFile(path.join(f.root,result.importJob.batchNumber,"source.csv"),"utf8"),buildSalesImportTemplate());
 await assert.rejects(async()=>readFile(file.path),{code:"ENOENT"});
 assert.deepEqual(await f.service.createFromUpload({claims:f.claims,eventId,file:await f.file()}),result);assert.equal(await f.jobs(),1);
 await assert.rejects(async()=>f.service.createFromUpload({claims:f.claims,eventId,file:await f.file(buildSalesImportTemplate()+"\r\n")}),{code:"SALES_EVENT_CONFLICT"});
 const duplicateEvent=randomUUID(),duplicate=await f.service.createFromUpload({claims:f.claims,eventId:duplicateEvent,file:await f.file()});
 assert.deepEqual(duplicate.warnings,[{code:"SAME_FILE_PREVIOUSLY_UPLOADED"}]);assert.equal(await f.jobs(),2);
 assert.deepEqual(await f.service.createFromUpload({claims:f.claims,eventId:duplicateEvent,file:await f.file()}),duplicate);
 const [[effects]]=await f.db.query("SELECT (SELECT COUNT(*) FROM sales_orders WHERE created_by=?) AS orders,(SELECT COUNT(*) FROM sales_intake_orders WHERE import_job_id IN (SELECT id FROM sales_import_jobs WHERE created_by=?)) AS intake",[f.userId,f.userId]);assert.equal(effects.orders,0);assert.equal(effects.intake,0);
});
integrationTest("TC-034 native move failure compensates staging Job and original operation",async t=>{
 const f=await setup(t),file=await f.file(),eventId=randomUUID();let calls=0;
 const database={withTransaction:async(fn,options)=>{if(++calls===2)await unlink(file.path);return f.database.withTransaction(fn,options);}};
 const service=new SalesImportService({database,time:f.time,root:f.root,tempRoot:f.tempRoot});
 await assert.rejects(async()=>service.createFromUpload({claims:f.claims,eventId,file}),{code:"SALES_IMPORT_FILE_INVALID"});assert.equal(await f.jobs(),0);
 assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?",[eventId]))[0][0].n,0);assert.deepEqual(await readdir(f.root),[]);
 assert.equal((await f.service.createFromUpload({claims:f.claims,eventId,file:await f.file()})).importJob.status,"UPLOADED");
});
integrationTest("TC-034 native SQL rollback after move retains only recoverable private stage and retries original facts",async t=>{
 const f=await setup(t),eventId=randomUUID();let failed=false;
 const database={withTransaction:(fn,options)=>f.database.withTransaction(tx=>fn({query:tx.query.bind(tx),execute:async(sql,args)=>{
  if(!failed&&sql.startsWith("UPDATE sales_import_jobs SET source_file_path")){failed=true;throw new Error("synthetic admission rollback");}return tx.execute(sql,args);
 }}),options)};
 const service=new SalesImportService({database,time:f.time,root:f.root,tempRoot:f.tempRoot});
 await assert.rejects(async()=>service.createFromUpload({claims:f.claims,eventId,file:await f.file()}),error=>error.cause?.message==="synthetic admission rollback");
 const [[stage]]=await f.db.query("SELECT id,batch_number,source_file_path FROM sales_import_jobs WHERE created_by=?",[f.userId]);assert.equal(stage.source_file_path,"");
 assert.equal(await readFile(path.join(f.root,stage.batch_number,"source.csv"),"utf8"),buildSalesImportTemplate());
 const recovered=await f.service.createFromUpload({claims:f.claims,eventId,file:await f.file()});assert.equal(recovered.importJob.id,Number(stage.id));assert.equal(await f.jobs(),1);
});
integrationTest("TC-034 native lost COMMIT acknowledgements query original stage or success before retry",async t=>{
 for(const unknownAt of [1,2]) await t.test(`ack-${unknownAt}`,async t=>{
  const f=await setup(t),eventId=randomUUID();let calls=0;
  const database={withTransaction:async(fn,options)=>{const result=await f.database.withTransaction(fn,options);if(++calls===unknownAt)throw new ApplicationError("synthetic lost acknowledgement",{code:"DATABASE_TRANSACTION_INDETERMINATE",statusCode:500});return result;}};
  const service=new SalesImportService({database,time:f.time,root:f.root,tempRoot:f.tempRoot});
  await assert.rejects(async()=>service.createFromUpload({claims:f.claims,eventId,file:await f.file()}),{code:"TRANSACTION_OUTCOME_UNKNOWN"});assert.equal(await f.jobs(),1);
  const recovered=await f.service.createFromUpload({claims:f.claims,eventId,file:await f.file()});assert.equal(await f.jobs(),1);
  assert.equal(await readFile(path.join(f.root,recovered.importJob.batchNumber,"source.csv"),"utf8"),buildSalesImportTemplate());
 });
});
integrationTest("TC-034 native fresh permission revocation between staging and move denies admission and compensates",async t=>{
 const f=await setup(t),eventId=randomUUID();let calls=0;
 const database={withTransaction:async(fn,options)=>{const result=await f.database.withTransaction(fn,options);if(++calls===1)await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.import'",[f.roleId]);return result;}};
 const service=new SalesImportService({database,time:f.time,root:f.root,tempRoot:f.tempRoot});
 await assert.rejects(async()=>service.createFromUpload({claims:f.claims,eventId,file:await f.file()}),{code:"PERMISSION_STALE"});assert.equal(await f.jobs(),0);assert.deepEqual(await readdir(f.root),[]);
});
integrationTest("TC-034 real HTTP multipart enforces schema/file/auth, owned cleanup and fresh replay revocation",async t=>{
 const f=await setup(t),{url}=await f.app.start(),token=await f.app.services.require("jwt").issue({roles:f.claims.claimedRoles,permissions:f.claims.claimedPermissions},{subject:String(f.userId),version:await f.app.services.require("tokenRevocation").currentVersion(String(f.userId)),authTime:Math.floor(f.now/1000)});
 const eventId=randomUUID();
 async function upload({event=eventId,key=event,field="file",extra=false,auth=true,mime="text/csv",two=false}={}) {
  const form=new FormData();form.set("eventId",event);form.set(field,new Blob([buildSalesImportTemplate()],{type:mime}),"synthetic.csv");if(extra)form.set("unknown","invalid");if(two)form.append("file",new Blob([buildSalesImportTemplate()],{type:mime}),"other.csv");
  const response=await fetch(new URL("/api/v1/sales-imports/upload",url),{method:"POST",headers:{...(auth?{Authorization:`Bearer ${token}`}:{ }),"Idempotency-Key":key},body:form});return {status:response.status,data:await response.json()};
 }
 const first=await upload();assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(await f.jobs(),1);
 const replay=await upload();assert.equal(replay.status,201);assert.deepEqual(replay.data.data,first.data.data);assert.equal(await f.jobs(),1);
 for(const args of [{event:randomUUID(),field:"other"},{event:randomUUID(),extra:true},{event:randomUUID(),two:true},{event:randomUUID(),mime:"application/pdf"}])assert.ok([400,413,415].includes((await upload(args)).status));
 assert.equal((await upload({auth:false})).status,401);assert.equal(await f.jobs(),1);assert.deepEqual(await readdir(f.tempRoot),[]);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.import'",[f.roleId]);
 assert.equal((await upload()).status,403);assert.equal(await f.jobs(),1);assert.deepEqual(await readdir(f.tempRoot),[]);
});

integrationTest("TC-034 native compensation locks and rechecks moved stage before deleting original facts",async t=>{
 const f=await setup(t),eventId=randomUUID(),entered=Promise.withResolvers(),resume=Promise.withResolvers();let calls=0;
 const databaseA={withTransaction:async(fn,options)=>{
  const call=++calls;if(call===3){entered.resolve();await resume.promise;}
  return f.database.withTransaction(tx=>fn(call===2?{execute:tx.execute.bind(tx),query:async(sql,args)=>{
   if(sql.startsWith("SELECT status,target_id"))throw new Error("synthetic premove failure");return tx.query(sql,args);
  }}:tx),options);
 }};
 const serviceA=new SalesImportService({database:databaseA,time:f.time,root:f.root,tempRoot:f.tempRoot});
 const resultA=serviceA.createFromUpload({claims:f.claims,eventId,file:await f.file()});resultA.catch(()=>{});await entered.promise;
 const databaseB={withTransaction:(fn,options)=>f.database.withTransaction(tx=>fn({query:tx.query.bind(tx),execute:async(sql,args)=>{
  if(sql.startsWith("UPDATE sales_import_jobs SET source_file_path"))throw new Error("synthetic admission rollback");return tx.execute(sql,args);
 }}),options)};
 const serviceB=new SalesImportService({database:databaseB,time:f.time,root:f.root,tempRoot:f.tempRoot});
 try{await assert.rejects(async()=>serviceB.createFromUpload({claims:f.claims,eventId,file:await f.file()}),error=>error.cause?.message==="synthetic admission rollback");}finally{resume.resolve();}
 await assert.rejects(()=>resultA,error=>error.cause?.message==="synthetic premove failure");
 assert.equal(await f.jobs(),1);const recovered=await f.service.createFromUpload({claims:f.claims,eventId,file:await f.file()});
 assert.equal(await readFile(path.join(f.root,recovered.importJob.batchNumber,"source.csv"),"utf8"),buildSalesImportTemplate());assert.equal(await f.jobs(),1);
});
