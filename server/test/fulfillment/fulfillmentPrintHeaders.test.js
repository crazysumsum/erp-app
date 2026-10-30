import test from "node:test";
import assert from "node:assert/strict";
import {sendSuccess,sendError} from "../../src/framework/http/apiResponse.js";
const time={timestamp:()=>"2026-10-26T00:00:00.000Z"};
function response(method,header,requestHeader){const headers=new Map(header===undefined?[]:[["cache-control",header]]);return {req:{method,headers:{"cache-control":requestHeader},requestId:"test-request"},setHeader(name,value){headers.set(name.toLowerCase(),value);},getHeader(name){return headers.get(name.toLowerCase());},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};}
test("HD021 only successful GET/HEAD preserve the exact trusted private no-store literal",()=>{
 for(const method of ["GET","HEAD"])for(const statusCode of [200,201,202,204,299]){const res=response(method,"private, no-store");sendSuccess(res,{value:"safe"},{statusCode,time});assert.equal(res.getHeader("cache-control"),"private, no-store");assert.equal(res.statusCode,statusCode);assert.deepEqual(res.body,{success:true,data:{value:"safe"},meta:{requestId:"test-request",timestamp:time.timestamp()}});}
});
test("HD021 defaults, arbitrary response policies, request headers and command methods cannot opt into caching",()=>{
 for(const method of ["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS",undefined,"get"])for(const policy of [undefined,"public, max-age=300","private","no-store","private,no-store","PRIVATE, NO-STORE","private, no-store, max-age=0",["private, no-store"],[]]){const res=response(method,policy,"private, no-store");sendSuccess(res,null,{time});assert.equal(res.getHeader("cache-control"),"no-store");assert.equal(res.body.success,true);assert.equal(res.body.data,null);}
 for(const method of ["POST","PUT","PATCH","DELETE","OPTIONS",undefined,"get"]){const res=response(method,"private, no-store");sendSuccess(res,null,{time});assert.equal(res.getHeader("cache-control"),"no-store");}
 const res=response("GET");delete res.getHeader;sendSuccess(res,null,{time});assert.equal(res.body.success,true);
});
test("HD021 errors and non2xx success serialization always override a trusted read header",()=>{
 for(const method of ["GET","HEAD","POST"])for(const statusCode of [300,304,400,403,409,500,503]){const res=response(method,"private, no-store");sendSuccess(res,null,{statusCode,time});assert.equal(res.getHeader("cache-control"),"no-store");const error=response(method,"private, no-store");sendError(error,{statusCode,code:"SAFE_ERROR",message:"Safe",time});assert.equal(error.getHeader("cache-control"),"no-store");assert.equal(error.body.success,false);assert.deepEqual(error.body.error,{code:"SAFE_ERROR",message:"Safe"});}
});
