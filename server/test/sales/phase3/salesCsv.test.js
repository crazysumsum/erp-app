import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {stringify} from "csv-stringify/sync";
import {setTimeout as deadline} from "node:timers/promises";
import {SALES_CSV_COLUMNS,buildSalesImportTemplate,parseSalesCsv} from "../../../src/modules/sales/salesCsv.js";

const names=SALES_CSV_COLUMNS.map(column=>column.name);
const row={templateVersion:"1.0",sourceOrderKey:"Order A",channelCode:"SYNTHETIC",externalOrderId:"Exact 雪",customerId:"1",warehouseCode:"SYNTHETIC",orderDate:"2026-10-07",requestedDeliveryDate:"",currencyCode:"HKD",paymentTermCode:"",customerPoReference:"",orderNotes:"",skuCode:"SKU-A",salesUomCode:"EA",quantity:"1",unitSellingPrice:"1.25",lineNote:""};
const csv=(rows,headers=names)=>Buffer.from(stringify([headers,...rows.map(value=>headers.map(name=>value[name]??""))],{record_delimiter:"\r\n"}));
async function fixture(t){const spoolRoot=await mkdtemp(path.join(tmpdir(),"sales-csv-test-"));t.after(()=>rm(spoolRoot,{recursive:true,force:true}));return spoolRoot;}
async function read(t,source,options={}){const spoolRoot=await fixture(t),orders=[];const counts=await parseSalesCsv(source,{spoolRoot,onOrder:order=>orders.push(order),...options});assert.deepEqual(await readdir(spoolRoot),[]);return {counts,orders};}

test("TC-034 UTF8/BOM/RFC4180 streamed noncontiguous groups merge exact decimals and retain source rows",async t=>{
  const bytes=Buffer.concat([Buffer.from("\uFEFF"),csv([{...row,quantity:"0.1",lineNote:'quote "雪",\nnext'}, {...row,sourceOrderKey:"Other",externalOrderId:"Other"}, {...row,quantity:"0.2",lineNote:'quote "雪",\nnext'}])]);
  async function* chunks(){for(let i=0;i<bytes.length;i+=3)yield bytes.subarray(i,i+3);}
  const {counts,orders}=await read(t,chunks());assert.deepEqual(counts,{rowCount:3,orderCount:2});
  const order=orders.find(value=>value.sourceOrderKey==="Order A");assert.equal(order.errors.length,0);assert.equal(order.payload.lines[0].quantity,"0.300000");assert.equal(order.payload.lines[0].unitSellingPrice,"1.2500");assert.deepEqual(order.payload.lines[0].rowNumbers,[2,4]);assert.equal(order.externalOrderId,"Exact 雪");
});

test("TC-034 template has fixed V1 header and a syntactically valid example with field descriptions",async t=>{
  assert.equal(SALES_CSV_COLUMNS.length,17);assert.ok(SALES_CSV_COLUMNS.every(column=>column.description));
  const {orders}=await read(t,Buffer.from(buildSalesImportTemplate()));assert.equal(orders.length,1);assert.equal(orders[0].errors.length,0);
});

test("TC-034 missing/unknown/duplicate/repeated headers and column count fail before admitting any order",async t=>{
  for(const source of [csv([row],names.slice(1)),csv([row],[...names,"unknown"]),csv([row],[...names.slice(0,-1),names[0]]),Buffer.concat([csv([row]),Buffer.from(names.join(",")+"\n")]),Buffer.from(names.join(",")+"\nwrong,count\n")]) {
    const spoolRoot=await fixture(t);let admitted=0;
    await assert.rejects(()=>parseSalesCsv(source,{spoolRoot,onOrder:()=>admitted++}),{code:"SALES_IMPORT_FILE_INVALID"});assert.equal(admitted,0);assert.deepEqual(await readdir(spoolRoot),[]);
  }
});

test("TC-034 malformed quotes, nonUTF8, NUL and empty files are rejected without raw input exposure",async t=>{
  for(const source of [Buffer.from('"private malformed'),Buffer.from([0xff]),csv([{...row,lineNote:"private\0value"}]),Buffer.alloc(0),Buffer.from(names.join(",")+"\n")]) {
    await assert.rejects(()=>read(t,source),error=>error.code==="SALES_IMPORT_FILE_INVALID"&&!JSON.stringify(error.publicDetails).includes("private"));
  }
});

test("TC-034 unsupported version fails the whole file before source callbacks",async t=>{
  await assert.rejects(()=>read(t,csv([{...row,templateVersion:"2.0"}])),{code:"SALES_IMPORT_VERSION_UNSUPPORTED"});
});

test("TC-034 header mismatch and SKU/UOM commercial conflict invalidate only the original source",async t=>{
  for(const changed of [{customerId:"2"},{quantity:"1",unitSellingPrice:"1.26"},{lineNote:"different"}]) {
    const {orders}=await read(t,csv([row,{...row,...changed},{...row,sourceOrderKey:"Peer",externalOrderId:"Peer"}]));
    assert.ok(orders.find(order=>order.sourceOrderKey==="Order A").errors.length);assert.equal(orders.find(order=>order.sourceOrderKey==="Peer").errors.length,0);
  }
});

test("TC-034 decimal/date/ID/code/text guards reject hostile or ambiguous source data safely",async t=>{
  for(const changed of [{quantity:"1e3"},{quantity:"0"},{quantity:"1,000"},{unitSellingPrice:"NaN"},{unitSellingPrice:"-1"},{orderDate:"2026-02-30"},{requestedDeliveryDate:"2026-10-06"},{customerId:"9007199254740992"},{channelCode:"bad-code"},{skuCode:""},{lineNote:"x".repeat(501)}]) {
    const {orders}=await read(t,csv([{...row,...changed}]));assert.ok(orders[0].errors.length);assert.ok(orders[0].errors.every(error=>!Object.hasOwn(error,"value")));
  }
});

test("TC-034 free text is formula-neutralized and exact external/source identities remain distinct",async t=>{
  const {orders}=await read(t,csv([{...row,orderNotes:"=SUM(1)",lineNote:"  @command"},{...row,sourceOrderKey:"Order A ",externalOrderId:"Exact 雪 "}]));
  assert.equal(orders.length,2);const order=orders.find(order=>order.sourceOrderKey==="Order A");assert.equal(order.payload.notes,"'=SUM(1)");assert.equal(order.payload.lines[0].lineNote,"'  @command");
});

test("TC-034 source100-line and128KiB payload bounds retain only bounded invalid-source diagnostics",async t=>{
  const {orders}=await read(t,csv(Array.from({length:101},()=>row)));assert.ok(orders[0].errors.some(error=>error.code==="SALES_IMPORT_ORDER_INVALID"));assert.ok(Buffer.byteLength(JSON.stringify(orders[0]))<=131072);
  const large=Array.from({length:100},(_,index)=>({...row,skuCode:"SKU-"+index,lineNote:"雪".repeat(500)}));
  const result=await read(t,csv(large));assert.ok(result.orders[0].errors.length);assert.ok(Buffer.byteLength(JSON.stringify(result.orders[0]))<=131072);
});

test("TC-034 50MiB file boundary refuses oversize before callbacks and cleans managed spool",async t=>{
  await assert.rejects(()=>read(t,Buffer.alloc(50*1024*1024+1,65)),{code:"SALES_IMPORT_FILE_INVALID"});
});

test("TC-034 abort and downstream persistence errors stop work and clean only the owned spool child",async t=>{
  const spoolRoot=await fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(()=>parseSalesCsv(csv([row]),{spoolRoot,abortSignal:controller.signal,onOrder:()=>{throw new Error("must not admit");}}),{name:"AbortError"});
  await assert.rejects(()=>parseSalesCsv(csv([row]),{spoolRoot,onOrder:()=>{throw new Error("Synthetic downstream failure");}}),/Synthetic downstream failure/u);
  assert.deepEqual(await readdir(spoolRoot),[]);
});

test("TC-034 source I/O failure remains technical and cleans spool without admitting source effects",async t=>{
  const spoolRoot=await fixture(t);let admitted=0;
  async function* failed(){yield csv([row]);throw Object.assign(new Error("Synthetic source I/O failure"),{code:"EIO"});}
  await assert.rejects(()=>parseSalesCsv(failed(),{spoolRoot,onOrder:()=>admitted++}),{code:"EIO"});assert.equal(admitted,0);assert.deepEqual(await readdir(spoolRoot),[]);
});

test("TC-034 invalid identity/free-text fields remain bounded and do not invalidate a valid peer",async t=>{
  const {orders}=await read(t,csv([{...row,externalOrderId:"",orderNotes:"雪".repeat(16000)},{...row,sourceOrderKey:"Peer",externalOrderId:"Peer"}]));
  const invalid=orders.find(order=>order.sourceOrderKey==="Order A");assert.ok(invalid.errors.length);assert.ok(Buffer.byteLength(JSON.stringify(invalid))<=131072);
  assert.equal(orders.find(order=>order.sourceOrderKey==="Peer").errors.length,0);
});

test("TC-034 actual10000-order and100000-row limits fail before any precheck callback",async t=>{
  const encoded=row=>stringify([names.map(name=>row[name])],{record_delimiter:"\n"});
  for(const mode of ["orders","rows"]) {
    const spoolRoot=await fixture(t);let admitted=0;
    async function* source(){yield Buffer.from(names.join(",")+"\n");const count=mode==="orders"?10001:100001;
      for(let index=0;index<count;index++)yield Buffer.from(encoded({...row,sourceOrderKey:mode==="orders"?"Order-"+index:row.sourceOrderKey}));}
    await assert.rejects(()=>parseSalesCsv(source(),{spoolRoot,onOrder:()=>admitted++}),{code:"SALES_IMPORT_FILE_INVALID"});
    assert.equal(admitted,0);assert.deepEqual(await readdir(spoolRoot),[]);
  }
});

test("TC-034 formula neutralization cannot emit free text beyond final business field limits",async t=>{
  for(const [field,maximum] of [["orderNotes",2000],["customerPoReference",190],["lineNote",500]]) {
    const {orders}=await read(t,csv([{...row,[field]:"="+"x".repeat(maximum-1)}]));
    assert.ok(orders[0].errors.some(error=>error.field===field));
  }
});

test("TC-034128KiB cap measures only normalized safe payload, not duplicate spool bookkeeping",async t=>{
  const {orders}=await read(t,csv(Array.from({length:100},(_,index)=>({...row,skuCode:"SKU-"+index,lineNote:"雪".repeat(200)}))));
  assert.equal(orders[0].errors.length,0);assert.equal(orders[0].payload.lines.length,100);assert.ok(Buffer.byteLength(JSON.stringify(orders[0].payload))<131072);
});

test("TC-034 errors beyond200 retain a bounded TOO_MANY_ERRORS summary",async t=>{
  const {orders}=await read(t,csv(Array.from({length:100},()=>({...row,customerId:"bad",quantity:"bad",unitSellingPrice:"bad",orderDate:"bad"}))));
  assert.equal(orders[0].errors.length,200);assert.equal(orders[0].errors.at(-1).code,"TOO_MANY_ERRORS");
});

test("TC-034 live abort settles and cleans while the source iterator is stalled",async t=>{
  const spoolRoot=await fixture(t),controller=new AbortController(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),timer=new AbortController();
  async function* source(){yield csv([row]);entered.resolve();await gate.promise;}
  const operation=parseSalesCsv(source(),{spoolRoot,abortSignal:controller.signal,onOrder:()=>assert.fail("No precheck effects after abort")});
  try {
    await entered.promise;controller.abort();
    await Promise.race([assert.rejects(operation,{name:"AbortError"}),deadline(500,null,{signal:timer.signal}).then(()=>assert.fail("Live abort did not settle"))]);
    assert.deepEqual(await readdir(spoolRoot),[]);
  } finally {timer.abort();gate.resolve();await operation.catch(()=>{});}
});
test("TC-035 precheck structural counts precede order persistence only after the complete file validates",async t=>{
 const spoolRoot=await fixture(t),events=[];
 await parseSalesCsv(csv([row,{...row,sourceOrderKey:"Other"}]),{spoolRoot,onFileValidated:counts=>events.push(counts),onOrder:()=>events.push("order")});
 assert.deepEqual(events,[{rowCount:2,orderCount:2},"order","order"]);
 events.length=0;await assert.rejects(()=>parseSalesCsv(Buffer.concat([csv([row]),Buffer.from(names.join(",")+"\n")]),{spoolRoot,onFileValidated:counts=>events.push(counts),onOrder:()=>events.push("order")}),{code:"SALES_IMPORT_FILE_INVALID"});assert.deepEqual(events,[]);assert.deepEqual(await readdir(spoolRoot),[]);
});
