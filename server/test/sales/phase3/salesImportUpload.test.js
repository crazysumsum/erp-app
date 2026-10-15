import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {mkdtemp,writeFile,rm,readdir,symlink} from "node:fs/promises";
import {prepareDiskTempDirectory} from "../../../src/framework/upload/normalizeUploadConfig.js";
import {SalesImportService} from "../../../src/modules/sales/SalesImportService.js";
import {UploadSalesImportHandler} from "../../../src/handlers/sales-imports/uploadSalesImportHandler.js";

async function storage(t) {
 const base=prepareDiskTempDirectory(`storage/test-sales-upload-${randomUUID()}`),tempRoot=prepareDiskTempDirectory(path.join(base,"temp")),root=prepareDiskTempDirectory(path.join(base,"jobs"));
 t.after(()=>rm(base,{recursive:true,force:true}));
 const directory=await mkdtemp(path.join(tempRoot,"upload-")),storedName=randomUUID()+".csv",content="templateVersion,sourceOrderKey\r\n1.0,Synthetic\r\n";
 await writeFile(path.join(directory,".upload-owner"),"erp-disk-upload-v1\n",{mode:0o600});await writeFile(path.join(directory,storedName),content,{mode:0o600});
 return {root,tempRoot,file:{field:"file",path:path.join(directory,storedName),storedName,originalName:"synthetic.csv",mimeType:"text/csv",size:Buffer.byteLength(content),contentHash:createHash("sha256").update(content).digest("hex")}};
}
test("TC-034 upload declares bounded disk contract and authorizes before replay",()=>{
 const api=UploadSalesImportHandler.api;assert.equal(api.path,"/api/v1/sales-imports/upload");assert.equal(api.upload.storageMode,"disk");assert.equal(api.upload.maxFiles,1);assert.equal(api.upload.maxFileSizeBytes,50*1024*1024);
 assert.deepEqual(api.authorizationPolicies[0].options.permissions,["sales.view","sales.import"]);assert.equal(typeof UploadSalesImportHandler.prototype.authorizeRequest,"function");assert.equal(api.idempotency.enabled,true);
});
test("TC-034 invalid file metadata, foreign path, hash, symlink and abort fail before Job writes",async t=>{
 const f=await storage(t);let writes=0;
 const service=new SalesImportService({database:{withTransaction(){writes++;throw new Error("Unexpected DB");}},time:{nowMs:()=>1},root:f.root,tempRoot:f.tempRoot});
 for(const file of [{...f.file,field:"other"},{...f.file,size:52428801},{...f.file,contentHash:"bad"},{...f.file,path:"/private/tmp/foreign.csv"},{...f.file,contentHash:"0".repeat(64)}])
  await assert.rejects(()=>service.createFromUpload({claims:{},eventId:randomUUID(),file}),{code:"SALES_IMPORT_FILE_INVALID"});
 const link=randomUUID()+".csv";await symlink(f.file.path,path.join(path.dirname(f.file.path),link));
 await assert.rejects(()=>service.createFromUpload({claims:{},eventId:randomUUID(),file:{...f.file,path:path.join(path.dirname(f.file.path),link),storedName:link}}),{code:"SALES_IMPORT_FILE_INVALID"});
 const controller=new AbortController();controller.abort(new Error("owned abort"));await assert.rejects(()=>service.createFromUpload({eventId:randomUUID(),file:f.file,abortSignal:controller.signal}),/owned abort/u);
 assert.equal(writes,0);assert.deepEqual(await readdir(f.root),[]);
});
