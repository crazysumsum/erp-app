import assert from 'node:assert/strict';
import test from 'node:test';
import {observeSalesDomain,getSalesDomainObservations,recordSalesDomainDuration} from '../../../src/modules/sales/salesDomainObservations.js';
test('OBS-D01 fixed duration counters preserve success, errors, transaction unknown and rollback without business labels',async()=>{
 const db={},values=[10,31,40,90,100,160];let index=0;const clock=()=>values[index++];
 assert.equal(await observeSalesDomain(db,'create_order',async()=>7,{clock}),7);
 const failure=Object.assign(Error('secret/customer'),{code:'CONCURRENT_OPERATION',cause:{code:'ER_LOCK_DEADLOCK'}});
 await assert.rejects(()=>observeSalesDomain(db,'create_order',async()=>{throw failure;},{clock}),error=>error===failure);
 const unknown=Object.assign(Error('secret'),{code:'TRANSACTION_OUTCOME_UNKNOWN'});
 await assert.rejects(()=>observeSalesDomain(db,'create_order',async()=>{throw unknown;},{clock}));
 const row=getSalesDomainObservations(db).operations.find(row=>row.operation==='create_order');assert.equal(row.observations,3);assert.equal(row.durationSumMs,131);assert.deepEqual(row.outcomes,{success:1,error:1,unknown:1,archived:0,skipped:0,failed:0});assert.equal(row.deadlocks,1);assert.equal(row.buckets.reduce((a,b)=>a+b,0),3);assert.ok(!JSON.stringify(row).includes('secret'));
 const snapshot=getSalesDomainObservations(db);snapshot.operations[0].buckets[0]=999;assert.notEqual(getSalesDomainObservations(db).operations[0].buckets[0],999);
});
test('OBS-D01 Archive settled outcomes and delayed Confirmation terminal elapsed are recorded without invented clocks or dimensions',async()=>{
 const db={};await observeSalesDomain(db,'archive_order',async()=>({outcome:'SKIPPED'}));
 assert.equal(getSalesDomainObservations(db).operations.find(row=>row.operation==='archive_order').outcomes.skipped,1);
 assert.equal(recordSalesDomainDuration(db,'confirm_order','success',50000),true);assert.equal(recordSalesDomainDuration(db,'confirm_order','success',-1),false);assert.equal(recordSalesDomainDuration(db,'confirm_order','success',NaN),false);
 assert.equal(getSalesDomainObservations(db).operations.find(row=>row.operation==='confirm_order').observations,1);
 await assert.rejects(()=>observeSalesDomain(db,'SO-PRIVATE',async()=>1),/Unknown/);
});
