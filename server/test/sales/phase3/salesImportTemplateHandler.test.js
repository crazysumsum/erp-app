import assert from "node:assert/strict";
import test from "node:test";
import {GetCurrentSalesImportTemplateHandler} from "../../../src/handlers/sales-import-templates/getCurrentSalesImportTemplateHandler.js";

function fixture(permissions=["sales.import","sales.view"],active=true){
  const handler=Object.create(GetCurrentSalesImportTemplateHandler.prototype),headers={};
  handler.mysqlDatabase={withTransaction:fn=>fn({async query(sql){
    if(sql.includes("FROM users"))return [active?[{username:"synthetic"}]:[]];
    if(sql.includes("FROM roles"))return [[{name:"importer"}]];
    if(sql.includes("FROM permissions"))return [permissions.map(name=>({name}))];
    throw new Error("Unexpected template side effect");
  }})};handler.file=value=>value;
  return {handler,req:{auth:{claims:{sub:"1",roles:["importer"],permissions}},input:{params:{},query:{}}},res:{setHeader:(name,value)=>headers[name]=value},headers};
}
test("TC-034 template resource uses strict read schema and view/import without granting management",()=>{
  const api=GetCurrentSalesImportTemplateHandler.api;assert.equal(api.method,"GET");assert.equal(api.path,"/api/v1/sales-import-templates/current");
  assert.deepEqual(api.authorizationPolicies[0].options.permissions,["sales.view","sales.import"]);assert.equal(api.download.enabled,true);
  for(const schema of Object.values(api.requestSchema))assert.equal(schema.additionalProperties,false);
});
test("TC-034 template download rechecks fresh actor and returns versioned UTF8 CSV with no business writes",async()=>{
  const {handler,req,res,headers}=fixture();const result=await handler.execute(req,res);
  assert.equal(result.fileName,"sales-import-template-1.0.csv");assert.equal(result.contentType,"text/csv; charset=utf-8");assert.match(result.buffer.toString(),/^\uFEFFtemplateVersion,sourceOrderKey,/u);
  assert.equal(headers["X-Sales-Import-Template-Version"],"1.0");
});
test("TC-034 inactive, revoked, view-only and import-only actors cannot download",async()=>{
  for(const permissions of [["sales.view"],["sales.import"],[]]) {
    const {handler,req,res}=fixture(permissions);await assert.rejects(()=>handler.execute(req,res),{code:"FORBIDDEN"});
  }
  const inactive=fixture(undefined,false);await assert.rejects(()=>inactive.handler.execute(inactive.req,inactive.res),{code:"PERMISSION_STALE"});
  const stale=fixture(["sales.view"]);stale.req.auth.claims.permissions=["sales.view","sales.import"];await assert.rejects(()=>stale.handler.execute(stale.req,stale.res),{code:"PERMISSION_STALE"});
});
