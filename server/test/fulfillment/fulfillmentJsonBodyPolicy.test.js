import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import {createHash} from "node:crypto";
import express from "express";
import {createJsonBodyParser,normalizeJsonBodyLimit} from "../../src/framework/http/jsonBodyParser.js";
import {createBodyReceiveTimeoutMiddleware,bodyParsingComplete} from "../../src/framework/middleware/bodyReceiveTimeout.js";
import apiConfig from "../../config/api.js";
import {BaseRequestHandler} from "../../src/framework/api/BaseRequestHandler.js";
import {normalizeApiConfig} from "../../src/framework/api/normalizeApiConfig.js";
import {resolveApiDefinitions} from "../../src/framework/api/apiDefinitionResolver.js";
import {validateApiConfig} from "../../src/framework/middleware/apiDispatcher.js";
const LARGE=2097152;
function body(bytes){return Buffer.from(JSON.stringify({value:"x".repeat(bytes-12)}));}
async function fixture(t,routes,{defaultLimit="64b"}={}){
 const app=express(),initial={params:{outer:"kept"},route:{outer:true},baseUrl:"/outer"};
 app.use(createBodyReceiveTimeoutMiddleware({timeoutMs:10000,logger:{warn(){}},time:{nowMs:()=>Date.now(),timestamp:()=>new Date().toISOString()}}));
 const parse=createJsonBodyParser({routes,defaultLimit});
 app.use((req,res,next)=>{req.params=initial.params;req.route=initial.route;req.baseUrl=initial.baseUrl;parse(req,res,error=>{assert.equal(req.params,initial.params);assert.equal(req.route,initial.route);assert.equal(req.baseUrl,initial.baseUrl);assert.equal(req.apiRoute,undefined);next(error);});});
 app.use(bodyParsingComplete);
 app.use((req,res)=>{res.setHeader("x-body-bytes",String(req.rawBody?.length??0));res.json({bytes:req.rawBody?.length??0,hash:req.rawBody?createHash("sha256").update(req.rawBody).digest("hex"):null,length:req.body?.value?.length??0});});
 app.use((error,_req,res,_next)=>{res.status(error.status??500).json({code:error.type==="entity.too.large"?"REQUEST_BODY_TOO_LARGE":"TEST_ROUTE_ERROR"});});
 const server=http.createServer(app);await new Promise(resolve=>{server.listen(0,"127.0.0.1",resolve);});t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));return `http://127.0.0.1:${server.address().port}`;
}
async function request(origin,path,data,{method="POST",headers={},chunked=false}={}){
 if(!chunked&&method!=="HEAD"){const response=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...headers},body:data});return {status:response.status,bytes:response.headers.get("x-body-bytes"),body:await response.json()};}
 return new Promise((resolve,reject)=>{const req=http.request(origin+path,{method,headers:{"Content-Type":"application/json",...(method==="HEAD"?{"Content-Length":data.length}:{}),...headers}},response=>{const chunks=[];response.on("data",chunk=>chunks.push(chunk));response.on("end",()=>resolve({status:response.statusCode,body:method==="HEAD"?null:JSON.parse(Buffer.concat(chunks).toString())}));});req.on("error",reject);for(let offset=0;offset<data.length;offset+=32768)req.write(data.subarray(offset,offset+32768));req.end();});
}
test("HD022 registered body metadata has a strict positive2MiB ceiling",()=>{
 for(const value of [1,102400,LARGE])assert.equal(normalizeJsonBodyLimit(value),value);
 for(const value of [undefined,null,false,"2097152",0,-1,1.5,LARGE+1,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>normalizeJsonBodyLimit(value));
});
test("HD022 static and direct route startup validation reject invalid or unknown body metadata",()=>{
 class PolicyHandler extends BaseRequestHandler{static handlerName="policy";static api={method:"POST",path:"/api/v1/policy",description:"Bounded test policy",requestSchema:{},responseSchema:{200:{}},jsonBodyLimitBytes:LARGE};}
 const handlers={policy:new PolicyHandler({})},resolve=()=>resolveApiDefinitions(handlers,normalizeApiConfig(apiConfig).defaults),validate=route=>validateApiConfig([route],handlers,{has:()=>true},1000);
 const route=resolve()[0];assert.equal(route.jsonBodyLimitBytes,LARGE);assert.doesNotThrow(()=>validate(route));
 for(const value of [null,false,"2097152",0,-1,1.5,LARGE+1,Number.MAX_SAFE_INTEGER+1,undefined]){PolicyHandler.api.jsonBodyLimitBytes=value;assert.throws(resolve,/jsonBodyLimitBytes/u);assert.throws(()=>validate({...route,jsonBodyLimitBytes:value}),/jsonBodyLimitBytes/u);}
 delete PolicyHandler.api.jsonBodyLimitBytes;assert.equal(Object.hasOwn(resolve()[0],"jsonBodyLimitBytes"),false);PolicyHandler.api.jsonBodyLimitByte=LARGE;assert.throws(resolve,/unknown fields/u);
});
test("HD022 same Express route order/case/slash/method matching selects only registered policy and restores request metadata",async t=>{
 const routes=[{method:"POST",path:"/api/v1/default/:id"},{method:"POST",path:"/api/v1/default/special",jsonBodyLimitBytes:LARGE},{method:"POST",path:"/api/v1/batch/:id",jsonBodyLimitBytes:LARGE},{method:"GET",path:"/api/v1/head/:id",jsonBodyLimitBytes:LARGE}],origin=await fixture(t,routes),data=body(128);
 for(const path of ["/api/v1/batch/8","/API/V1/BATCH/8/","/api/v1/batch/abc"]){const result=await request(origin,path,data);assert.equal(result.status,200);assert.equal(result.body.bytes,128);}
 for(const path of ["/api/v1/default/special","/api/v1/batch/8/extra","/api/v1/unknown","/api/v1/batch/%ZZ"]){assert.equal((await request(origin,path,data,{headers:{"x-json-body-limit":"2097152"}})).status,413);}
 assert.equal((await request(origin,"/api/v1/default/8?jsonBodyLimitBytes=2097152",data)).status,413);
 for(const method of ["PUT","OPTIONS"])assert.equal((await request(origin,"/api/v1/batch/8",data,{method})).status,413);
 assert.equal((await request(origin,"/api/v1/head/8",data,{method:"HEAD"})).status,200);
});
test("HD022 exactcap/cap+1 including chunked requests and Unicode whitespace retain exact raw bytes",async t=>{
 const origin=await fixture(t,[{method:"POST",path:"/api/v1/batch/:id",jsonBodyLimitBytes:LARGE}]);
 for(const chunked of [false,true]){const accepted=await request(origin,"/api/v1/batch/8",body(LARGE),{chunked});assert.equal(accepted.status,200);assert.equal(accepted.body.bytes,LARGE);assert.equal((await request(origin,"/api/v1/batch/8",body(LARGE+1),{chunked})).status,413);}
 const raw=Buffer.from(' { "value" : "中文😀\\u4e2d" }\n'),result=await request(origin,"/api/v1/batch/8",raw);assert.equal(result.status,200);assert.equal(result.body.bytes,raw.length);assert.equal(result.body.hash,createHash("sha256").update(raw).digest("hex"));
});
