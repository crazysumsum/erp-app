import assert from 'node:assert/strict';
import test from 'node:test';
import {getSalesObservationBaseline} from '../../../src/modules/sales/salesOperationalBaseline.js';
test('OBS-H03 runtime coverage binding uses source/config bytes and canonical policy rather than a supplied artifact label',()=>{
 const a={application:{timeZone:'Asia/Hong_Kong'},sales:{confirmationLeaseMs:1000,archiveBatchSize:500},scheduler:{jobs:{'sales.backorderAllocate':{enabled:true}}}},hash=getSalesObservationBaseline(a);
 assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(hash,getSalesObservationBaseline({...a,sales:{archiveBatchSize:500,confirmationLeaseMs:1000},baselineHash:'forged'}));assert.notEqual(hash,getSalesObservationBaseline({...a,sales:{...a.sales,confirmationLeaseMs:2000}}));assert.notEqual(hash,getSalesObservationBaseline({...a,scheduler:{jobs:{'sales.backorderAllocate':{enabled:false}}}}));
});
test('OBS-H03 actual metrics cadence policy changes cannot reuse previous persisted continuity baseline',()=>{const a={application:{timeZone:'Asia/Hong_Kong'},sales:{},scheduler:{enabled:true,jobs:{'sales.metrics':{intervalMs:300000}}}};assert.notEqual(getSalesObservationBaseline(a),getSalesObservationBaseline({...a,scheduler:{...a.scheduler,jobs:{'sales.metrics':{intervalMs:60000}}}}));});
