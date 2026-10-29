// Strict diagnostic-only source transformation; no hook registration on import.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const {parse}=createRequire(import.meta.url)("acorn");
export const postingTraceManifest={
 "inventoryFulfillmentAllocation.js": {
  "sha256": "154a0e0d5a189ff59ee543feab6edb1893c882ce7e294db76534af3ed9f6ef45",
  "targets": {
   "lockAllocationSet": {
    "label": "LOCK_SCOPE",
    "nodeType": "FunctionDeclaration"
   },
   "assessFulfillmentAllocationSelection": {
    "label": "CANDIDATE_ASSESS",
    "nodeType": "FunctionDeclaration"
   },
   "selection": {
    "label": "CANDIDATE_SELECTION",
    "nodeType": "FunctionDeclaration"
   },
   "postFulfillmentAllocationBatch": {
    "label": "POST_BATCH",
    "nodeType": "FunctionDeclaration"
   }
  }
 },
 "InventoryPickSequenceService.js": {
  "sha256": "9d20eb43ce91b9b0370537e3af0a15a03a2463ab148cd0ae04327278954c42c8",
  "targets": {
   "rankInventoryCandidates": {
    "label": "CANDIDATE_SORT",
    "nodeType": "FunctionDeclaration"
   },
   "loadCandidates": {
    "label": "CANDIDATE_LOAD",
    "nodeType": "FunctionDeclaration"
   }
  }
 },
 "InventoryLockService.js": {
  "sha256": "edd2eec39bfb3d51b17181833b89a4aa6aa37bc608a0840850abc78b7bbabb0b",
  "targets": {
   "upsertAndLockBalances": {
    "label": "BALANCE_LOCK",
    "nodeType": "FunctionDeclaration"
   },
   "lockForCommand": {
    "label": "LOCK_COMMAND",
    "nodeType": "MethodDefinition"
   }
  }
 },
 "inventoryFulfillmentReceipts.js": {
  "sha256": "890fea3f7da2a9aa4c580d7e71636f5ba1de0ed0b837f7ff82e4c13f28a07f6d",
  "targets": {
   "completeFulfillmentInventoryBatch": {
    "label": "RECEIPT_COMPLETE",
    "nodeType": "FunctionDeclaration"
   },
   "readFulfillmentInventoryBatch": {
    "label": "RECEIPT_READ",
    "nodeType": "FunctionDeclaration"
   }
  }
 },
 "InventoryAuditService.js": {
  "sha256": "0fba82466237a4eb8c5b15d9feb556c3aaaa8e1b1ee8bb447d61232da85febef",
  "targets": {
   "values": {
    "label": "AUDIT_VALUES",
    "nodeType": "MethodDefinition"
   },
   "flush": {
    "label": "AUDIT_FLUSH",
    "nodeType": "VariableDeclarator"
   },
   "record": {
    "label": "AUDIT_RECORD",
    "nodeType": "Property"
   }
  }
 }
};
const canonical=value=>JSON.stringify(value,(key,item)=>["start","end","raw"].includes(key)?undefined:typeof item==="bigint"?{diagnosticBigInt:item.toString()}:item);
function strip(node){
 if(!node||typeof node!=="object")return node;
 if(node.type==="BlockStatement"&&node.body.length===1){const call=node.body[0].argument;if(node.body[0].type==="ReturnStatement"&&call?.type==="CallExpression"&&["tracePostingSync","tracePostingAsync"].includes(call.callee.name))return strip(call.arguments[1].body);}
 for(const key of Object.keys(node)){const value=node[key];if(Array.isArray(value))node[key]=value.map(strip);else if(value&&typeof value==="object")node[key]=strip(value);}
 return node;
}
export function transformPostingSource(name,source,helper){
 assert.ok(Object.hasOwn(postingTraceManifest,name),"Unknown diagnostic module");const entry=postingTraceManifest[name];
 assert.equal(createHash("sha256").update(source).digest("hex"),entry.sha256,"Posting trace source baseline changed");
 assert.equal(/tracePostingSync|tracePostingAsync/u.test(source),false);
 const ast=parse(source,{ecmaVersion:"latest",sourceType:"module"}),found=new Set(),insertions=[];
 function visit(node){
  if(!node||typeof node!=="object")return;
  let name,fn;
  if(node.type==="FunctionDeclaration"){name=node.id?.name;fn=node;}
  if(node.type==="MethodDefinition"){name=node.key.name;fn=node.value;}
  if(node.type==="VariableDeclarator"&&node.init?.type==="ArrowFunctionExpression"){name=node.id.name;fn=node.init;}
  if(node.type==="Property"&&node.value?.type==="ArrowFunctionExpression"){name=node.key.name;fn=node.value;}
  const target=Object.hasOwn(entry.targets,name)?entry.targets[name]:null,label=target&&target.nodeType===node.type?target.label:null;
  if(label){
   assert.equal(fn.body.type,"BlockStatement");assert.equal(Boolean(fn.generator),false);assert.equal(node.kind==="constructor",false);assert.equal(found.has(name),false,"Duplicate posting trace target");
   assert.ok(!fn.body.body.some(item=>item.directive),"Diagnostic wrapping cannot move directives");
   const checkEval=n=>{if(!n||typeof n!=="object")return;assert.ok(!(n.type==="CallExpression"&&n.callee.type==="Identifier"&&n.callee.name==="eval"),"Direct eval is not supported");for(const v of Object.values(n))if(Array.isArray(v))v.forEach(checkEval);else if(v&&typeof v==="object")checkEval(v);};checkEval(fn.body);
   found.add(name);insertions.push({position:fn.body.start+1,text:`return ${fn.async?"tracePostingAsync":"tracePostingSync"}(${JSON.stringify(label)},${fn.async?"async ":""}()=>{`},{position:fn.body.end-1,text:"});"});
  }
  for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==="object")visit(value);}
 }
 visit(ast);assert.deepEqual([...found].sort(),Object.keys(entry.targets).sort(),"Missing posting trace target");
 let transformed=source;for(const edit of insertions.sort((a,b)=>b.position-a.position))transformed=transformed.slice(0,edit.position)+edit.text+transformed.slice(edit.position);
 transformed=`import {tracePostingSync,tracePostingAsync} from ${JSON.stringify(helper)};\n`+transformed;
 const decoded=parse(transformed,{ecmaVersion:"latest",sourceType:"module"});decoded.body.shift();assert.equal(canonical(strip(decoded)),canonical(ast),"Business AST changed beyond diagnostic wrappers");
 return {source:transformed,proof:{postingTraceSource:true,file:name,originalSha256:entry.sha256,transformedSha256:createHash("sha256").update(transformed).digest("hex"),spans:Object.values(entry.targets).map(target=>target.label),businessAstEquivalent:true}};
}
