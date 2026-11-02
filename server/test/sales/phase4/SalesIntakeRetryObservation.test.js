import assert from 'node:assert/strict';
import test from 'node:test';
import {SalesIntakeWorker} from '../../../src/modules/sales/SalesIntakeWorker.js';
import {getSalesTransactionObservations} from '../../../src/modules/sales/salesTransactionObservations.js';
test('OBS-T07 actual worker second-attempt claim selects its persisted source and reaches business processing exactly once',async()=>{
 const signal=new AbortController().signal,row={id:1,processing_event_id:'d6a0ca0e-96a0-4ba4-bf25-343344315f66',attempt_count:1,source_type:'CHANNEL'},writes=[];let processed=0;
 const tx={async query(sql){if(sql.includes('FROM fr_job_leases'))return [[{owner:'worker',expires_at:200}]];if(sql.includes(' AS now_ms'))return [[{now:100,now_ms:100000}]];if(sql.includes('FROM sales_import_jobs j'))return [[]];if(sql.includes("FROM sales_intake_orders WHERE source_type='CHANNEL'")){const selected=sql.slice('SELECT '.length,sql.indexOf(' FROM ')).split(',').map(field=>field.trim());return [[Object.fromEntries(selected.map(field=>[field,row[field]]))]];}throw Error('Unexpected worker fixture SQL');},async execute(sql){writes.push(sql);return [{affectedRows:1}];}};
 const database={withTransaction:async work=>work(tx)},worker=new SalesIntakeWorker({database,time:{},authorizeSalesImport:()=>({leaseOwner:'worker',signal}),intakeService:{async process(input){processed++;assert.equal(input.intakeOrderId,1);return {status:'SUCCEEDED'};}}});
 const result=await worker.runBatch({signal});assert.equal(result.succeeded,1);assert.equal(processed,1);assert.equal(writes.length,1);assert.equal(getSalesTransactionObservations(database).intakeRecords.CHANNEL.retried,'1');
});
