import "../../../test-support/testEnv.js";
import process from "node:process";
import {createApplication} from "../../../src/framework/application/createApplication.js";
import {defaultConfigurationSource} from "../../../src/framework/configuration/applicationConfiguration.js";
import {SalesOrderConfirmationService} from "../../../src/modules/sales/SalesOrderConfirmationService.js";
import {InventoryReservationService} from "../../../src/modules/inventory/InventoryReservationService.js";

process.once("message",async({runId,boundary,request})=>{
 let stage="startup";
 const reached=async()=>{process.send({runId,boundary,pid:process.pid,uid:process.getuid(),script:process.argv[1]});await new Promise(()=>{});};
 try{
  const source=defaultConfigurationSource(),app=await createApplication({configurationSource:{...source,scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.confirmationRecovery":{enabled:false},"sales.backorderAllocate":{enabled:false}}}}}),database=app.services.require("mysqldatabase"),options={database,time:app.services.require("time"),logger:app.services.require("logging").logger},inventory=new InventoryReservationService(options);
  if(boundary==="inventory")options.inventory={async reserveAvailableForSalesBatchInTransaction(...args){const result=await inventory.reserveAvailableForSalesBatchInTransaction(...args);await reached();return result;}};
  if(["beforeCommit","afterCommit"].includes(boundary))options.database={query:(...args)=>database.query(...args),withTransaction:async(work,configuration)=>{
   const result=await database.withTransaction(async tx=>{const value=await work(tx);if(boundary==="beforeCommit"&&value?.salesOrder?.status==="CONFIRMED")await reached();return value;},configuration);
   if(boundary==="afterCommit"&&result?.salesOrder?.status==="CONFIRMED")await reached();return result;
  }};
  stage="phaseA";const service=new SalesOrderConfirmationService(options),intent=await service.startConfirmation(request);if(boundary==="phaseA")await reached();stage="phaseB";await service.completeConfirmation({eventId:intent.eventId,claims:request.claims,leaseOwner:intent.leaseOwner});throw Error("Expected crash boundary was not reached");
 }catch(error){process.send({runId,error:"crash worker failed",stage,code:error.code??error.name,sections:error.issues?.map(issue=>issue.section)});process.exitCode=1;}
});
