import assert from "node:assert/strict";
import test,{after} from "node:test";
import {openCapacity} from "./http.js";
import {datasetShape,activeMergeQueries,archiveQueries} from "./queries.js";
import {boundedMergeArchive} from "./archive.js";
let context,halted;
function capacityCase(name,work){test(name,{timeout:21600000},async()=>{if(halted)throw new Error("Prior capacity case failed; no further workload is permitted");try{await work();}catch(error){halted=error;throw error;}});}
after(async()=>{if(context){await context.close();context=null;}});
capacityCase("TC-053 DEC047C original1m Active/5m detail shape",async()=>{context=await openCapacity();await datasetShape(context);});
capacityCase("TC-053 DEC047C remaining12 Active query classes100x2; Outstanding200 reused separately",async()=>{await activeMergeQueries(context);});
capacityCase("TC-054 DEC047C quiet2x500 Archive with10 readers and selected18class complete proof",async()=>{await boundedMergeArchive(context);});
capacityCase("TC-054 DEC047C bounded1000 Archive3query classes100x2 and invalid ranges",async()=>{await archiveQueries(context);});
capacityCase("TC-060 DEC047C operational storage footprint from read-only engine and actual row counts",async()=>{
 const c=context,tables=["sales_operational_job_runs","sales_operational_alert_state"],footprint=[];
 for(const table of tables){const [[size]]=await c.db.query("SELECT TABLE_NAME AS name,TABLE_ROWS AS estimated_rows,DATA_LENGTH AS data_bytes,INDEX_LENGTH AS index_bytes FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",[table]),[[count]]=await c.db.query(`SELECT COUNT(*) AS n FROM ${table}`);assert.ok(size);footprint.push({...size,actualRows:String(count.n),estimateQualification:"InnoDB table statistics estimates; not allocated filesystem bytes"});}
 const [outcomes]=await c.db.query("SELECT outcome,COUNT(*) AS n,COUNT(DISTINCT lease_owner) AS contributing_lease_owners FROM sales_operational_job_runs GROUP BY outcome ORDER BY outcome"),[signals]=await c.db.query("SELECT signal_type,state,COUNT(*) AS n FROM sales_operational_alert_state GROUP BY signal_type,state ORDER BY signal_type,state"),[[backlog]]=await c.db.query("SELECT COUNT(*) AS open_entries,COUNT(DISTINCT warehouse_id,sku_id) AS warehouse_sku_scopes,SUM(outstanding_base_quantity) AS outstanding_quantity FROM sales_backorder_entries WHERE status='OPEN'");
 await c.reserve();await c.save("merge-operational-footprint.json",{footprint,outcomes,signals,backlog,history24h:"UNKNOWN until actual version/coverage activation and continuous24h evidence exist",readOnly:true,noActivation:true,noDR:true});
});
