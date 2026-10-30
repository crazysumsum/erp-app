import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {SalesIntakeService} from '../../../src/modules/sales/SalesIntakeService.js';
import {getSalesTransactionObservations} from '../../../src/modules/sales/salesTransactionObservations.js';
const input=JSON.parse(readFileSync(new URL('../phase3/channel-v1.fixture.json',import.meta.url),'utf8'));
test('OBS-T04 actual Channel entry records early validation and pre-admission dependency retry without SQL or false received/accepted records',async()=>{
 let calls=0;const database={withTransaction(){calls++;throw Error('Unexpected SQL');}},service=new SalesIntakeService({database,time:{},orderService:{},confirmationService:{}});
 assert.equal((await service.submit({...input,authenticated:true})).outcome,'VALIDATION_FAILED');assert.equal((await service.submit(input,{signal:new AbortController().signal})).outcome,'TECHNICAL_RETRY');
 const snapshot=getSalesTransactionObservations(database);assert.equal(snapshot.channelSubmissionRequests.invalid,'1');assert.equal(snapshot.channelSubmissionRequests.retry,'1');assert.equal(snapshot.intakeRecords.CHANNEL.received,'0');assert.equal(snapshot.intakeRecords.CHANNEL.accepted,'0');assert.equal(calls,0);
});
