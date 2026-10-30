import assert from 'node:assert/strict';
import test from 'node:test';
import {SalesOrderService} from '../../../src/modules/sales/SalesOrderService.js';
import {SalesQuotationService} from '../../../src/modules/sales/SalesQuotationService.js';
import {getSalesDomainObservations} from '../../../src/modules/sales/salesDomainObservations.js';
test('OBS-D02 create and convert observations include rejected validation/transaction work without extra SQL or logging',async()=>{
 const failure=Error('synthetic transaction rejection');let calls=0;const database={withTransaction:async()=>{calls++;throw failure;}},options={database,time:{nowMs:()=>1},logger:{},customerProvider:{},itemProvider:{},businessMaster:{}};
 const order=new SalesOrderService(options),quotation=new SalesQuotationService(options);
 await assert.rejects(()=>order.create({claims:null,input:null}),error=>error===failure);
 await assert.rejects(()=>quotation.create({claims:null,input:null}),error=>error===failure);
 await assert.rejects(()=>quotation.convert({claims:null,input:null,id:1}));
 assert.equal(calls,2);for(const name of ['create_order','create_quotation','convert_quotation']){const row=getSalesDomainObservations(database).operations.find(row=>row.operation===name);assert.equal(row.observations,1);assert.equal(row.outcomes.error,1);}
});
test('OBS-D02 central transaction mapping counts real unknown/deadlock/provider-contract errors without changing public codes',async()=>{
 const {SalesOperationService}=await import('../../../src/modules/sales/SalesOperationService.js'),operations=new SalesOperationService(),database={withTransaction:async()=>{throw database.failure;}};
 for(const [failure,expected]of [[{code:'DATABASE_TRANSACTION_INDETERMINATE'},'TRANSACTION_OUTCOME_UNKNOWN'],[{cause:{code:'ER_LOCK_DEADLOCK'}},'CONCURRENT_OPERATION'],[{code:'INVENTORY_CONTRACT_MISMATCH'},'INVENTORY_CONTRACT_MISMATCH']]){database.failure=failure;await assert.rejects(()=>operations.run(database,()=>{}),error=>error.code===expected);}
 assert.deepEqual(getSalesDomainObservations(database).faults,{transaction_unknown:1,deadlock:1,provider_mismatch:1});
});
