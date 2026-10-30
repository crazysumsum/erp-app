const fail=()=>{throw Object.assign(new Error("揀貨資料不完整或已變更，請重新載入後核對；原輸入仍保留"),{code:"FULFILLMENT_PICK_SCOPE_INVALID"});};
const id=value=>/^[1-9][0-9]{0,15}$/u.test(String(value))&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER);
const version=value=>Number.isInteger(value)&&value>0&&value<=4294967295;
const amount=value=>{if(typeof value!=="string"||!/^(0|[1-9][0-9]{0,15})$/u.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))fail();return BigInt(value);};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const reasonValid=value=>typeof value==="string"&&[...value].length<=500&&!/[\p{Cc}\p{Cf}]/u.test(value);
async function readPage(get,idValue,options){
 try{return await get(idValue,options);}catch(error){
  const seconds=error?.retryAfterSeconds;if(error?.status!==429||!Number.isInteger(seconds)||seconds<1||seconds>30||options.signal?.aborted)throw error;
  await new Promise((resolve,reject)=>{
   const abort=()=>{clearTimeout(timer);options.signal?.removeEventListener("abort",abort);reject(error);},timer=setTimeout(()=>{options.signal?.removeEventListener("abort",abort);resolve();},seconds*1000);
   options.signal?.addEventListener("abort",abort,{once:true});if(options.signal?.aborted)abort();
  });
  return get(idValue,options);
 }
}

export async function loadPickScope(get,idValue,expectedVersion,signal){
 if(!id(idValue)||!version(expectedVersion))fail();
 let cursor,signature,lines;const allocations=[],counts=new Map();
 do{
  if(signal?.aborted)fail();
  const response=await readPage(get,idValue,{...(cursor?{allocationAfterId:cursor}:{}),signal});
  if(signal?.aborted)fail();
  const document=response?.fulfillment;
  if(!document||document.id!==String(idValue)||document.version!==expectedVersion||document.status!=="PICKING"||!document.allowedActions?.includes("pickConfirm")||!Array.isArray(document.lines)||!document.lines.length||document.lines.length>100)fail();
  const current=JSON.stringify(document.lines);if(signature!==undefined&&signature!==current)fail();signature=current;lines=document.lines;
  if(new Set(lines.map(row=>row.id)).size!==lines.length||lines.some(row=>!id(row.id)||amount(row.plannedBaseQuantity)===0n))fail();
  const page=document.allocations;if(!page||!Array.isArray(page.items)||page.items.length>100||typeof page.hasMore!=="boolean"||page.hasMore&&!page.items.length)fail();
  let last=cursor??"0";
  for(const row of page.items){
   if(!id(row.id)||BigInt(row.id)<=BigInt(last)||!lines.some(line=>line.id===row.fulfillmentLineId))fail();last=row.id;
   const allocated=amount(row.allocatedBaseQuantity),released=amount(row.releasedBaseQuantity),picked=amount(row.pickedBaseQuantity);
   if(allocated<released||allocated-released<picked)fail();
   if(allocated>released){
    if(!["ACTIVE","PARTIALLY_RELEASED"].includes(row.status)||picked!==0n||!version(row.inventoryVersion))fail();
    const count=(counts.get(row.fulfillmentLineId)??0)+1;if(count>50||allocations.length>=5000)fail();counts.set(row.fulfillmentLineId,count);
    allocations.push({...row,availableBaseQuantity:(allocated-released).toString()});
   }
  }
  if(page.hasMore){if(page.nextCursor!==last||BigInt(last)<=BigInt(cursor??"0"))fail();cursor=last;}else cursor=null;
 }while(cursor);
 for(const line of lines){const total=allocations.filter(row=>row.fulfillmentLineId===line.id).reduce((sum,row)=>sum+amount(row.availableBaseQuantity),0n);if(total!==amount(line.plannedBaseQuantity))fail();}
 return {id:String(idValue),version:expectedVersion,lines,allocations};
}

export function validatePickIntent(body){
 if(!exact(body,["eventId","version","lines"])||typeof body.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.eventId)||!version(body.version)||!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100)fail();
 const lineIds=new Set(),allocationIds=new Set();let total=0n;
 for(const line of body.lines){
  if(!exact(line,["fulfillmentLineId","shortPickReason","allocations"])||!Number.isSafeInteger(line.fulfillmentLineId)||line.fulfillmentLineId<1||lineIds.has(line.fulfillmentLineId)||!reasonValid(line.shortPickReason)||!Array.isArray(line.allocations)||!line.allocations.length||line.allocations.length>50)fail();lineIds.add(line.fulfillmentLineId);
  for(const row of line.allocations){if(!exact(row,["fulfillmentAllocationId","inventoryAllocationVersion","pickedBaseQuantity"])||!Number.isSafeInteger(row.fulfillmentAllocationId)||row.fulfillmentAllocationId<1||allocationIds.has(row.fulfillmentAllocationId)||!version(row.inventoryAllocationVersion))fail();allocationIds.add(row.fulfillmentAllocationId);total+=amount(row.pickedBaseQuantity);}
 }
 if(total===0n)throw new Error("全部實揀量為零，請使用取消履約工作");
 return body;
}

export function buildPickIntent(scope,amounts,reasons,eventId){
 const lines=scope.lines.map(line=>{
  let short=0n;const allocations=scope.allocations.filter(row=>row.fulfillmentLineId===line.id).map(row=>{
   const actual=amount(amounts[row.id]),available=amount(row.availableBaseQuantity??(amount(row.allocatedBaseQuantity)-amount(row.releasedBaseQuantity)).toString());if(actual>available)fail();short+=available-actual;
   return {fulfillmentAllocationId:Number(row.id),inventoryAllocationVersion:row.inventoryVersion,pickedBaseQuantity:amounts[row.id]};
  }),shortPickReason=(reasons[line.id]??"").trim();
  if(!reasonValid(shortPickReason)||short>0n&&[...shortPickReason].length<5)throw new Error("短揀必須填寫5至500字原因；請核對所有行");
  return {fulfillmentLineId:Number(line.id),shortPickReason,allocations};
 });
 return validatePickIntent({eventId,version:scope.version,lines});
}

// Same-event successful replay bypasses these post-claim business checks.
export function isDefinitivePickRejection(error,wasUncertain){
 return error?.status===409&&["VERSION_CONFLICT","FULFILLMENT_STATE_CONFLICT","PICK_RESULT_INVALID","SHORT_PICK_REASON_REQUIRED"].includes(error.code)||!wasUncertain&&error?.status===400&&["FULFILLMENT_INPUT_INVALID","FULFILLMENT_QUANTITY_INVALID"].includes(error.code);
}
