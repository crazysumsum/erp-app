import assert from "node:assert/strict";
import test, {after} from "node:test";
import {openCapacity} from "./http.js";
import {datasetShape,activeQueries,archiveQueries} from "./queries.js";
import {prepareArchive,drainArchive} from "./archive.js";
import {mixedLoad} from "./mixed.js";
import {reconcileCapacity} from "./reconcile.js";
let context,halted,archiveState;
function capacityCase(name,work){test(name,{timeout:21600000},async()=>{if(halted)throw new Error("Prior capacity case failed; no further workload is permitted");try{await work();}catch(error){halted=error;throw error;}});}
after(async()=>{if(context){await context.close();context=null;}});
capacityCase("TC-053 full1m Active/5m lines exact shape and legitimate source graph",async()=>{context=await openCapacity();await datasetShape(context);});
capacityCase("TC-053 full Active query matrix, two100sample cache phases, independent exact oracle",async()=>{await activeQueries(context);});
capacityCase("TC-055 full50JWT mixed load with actual10000order Import,5Export jobs and500Archive",async()=>{
 archiveState=await prepareArchive(context);const c=context,{batchId,moved}=archiveState,created=[];
 for(let index=0;index<moved.length;index++){const order=await c.create(c.actors[index%50],Number(moved[index].line_count));created.push({id:order.id,lineCount:order.lineCount});}
 // New current-date Drafts with new IDs refill cardinality; no data restoration or cloned history.
 const [[shape]]=await c.db.query("SELECT COUNT(*) AS n,SUM(line_count) AS line_total FROM sales_orders"),[histogram]=await c.db.query("SELECT line_count,COUNT(*) AS n FROM sales_orders GROUP BY line_count ORDER BY line_count");assert.equal(Number(shape.n),1000000);assert.equal(Number(shape.line_total),5000000);assert.deepEqual(histogram.map(r=>[Number(r.line_count),Number(r.n)]),[[1,245000],[5,695000],[20,59000],[100,1000]]);
 await c.save("mixed-cardinality-refill.json",{created,shape,histogram,qualification:"500realcurrentDraft writers withnewIDs, notbackup/restore; original300kcandidate set andbatch unchanged"});
 let archiveTick;
 const report=await mixedLoad(c,{archiveDuringLoad:async()=>{
  const [[before]]=await c.db.query("SELECT archived_count FROM sales_archive_batches WHERE id=?",[batchId]);archiveTick=await c.tick("sales.archive");const [[after]]=await c.db.query("SELECT * FROM sales_archive_batches WHERE id=?",[batchId]);assert.equal(Number(after.archived_count)-Number(before.archived_count),500);assert.ok(archiveTick.ms<=600000);assert.equal(Number(after.failed_count),0);assert.equal(Number(after.skipped_count),0);assert.equal(after.lease_owner,null);archiveState.invocations.push({phase:"mixed",ms:archiveTick.ms,delta:500,total:Number(after.archived_count),status:after.status});await c.save("mixed-archive-tick.json",{before,after,ms:archiveTick.ms});return archiveTick;
 }});
 await c.pauseCalendars();await reconcileCapacity(c,"mixed");const previous=c.root;await c.close();context=null;
 context=await openCapacity();await context.save("previous-capacity-stage.json",{root:previous,batchId,report,qualification:"Fresh default logged pool resumes same existingbatch/cutoff/cursor afterallmixedmutatorssettled; no reset"});
});
capacityCase("TC-054 complete original300k monthly Archive, samebatch,18class digests andInventory preservation",async()=>{assert.ok(archiveState);await drainArchive(context,archiveState);await reconcileCapacity(context,"after-300k");});
capacityCase("TC-054 final300k Archive query matrix and bounded invalid-range behavior",async()=>{await archiveQueries(context);});
