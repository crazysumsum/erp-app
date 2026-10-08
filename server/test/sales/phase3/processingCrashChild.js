// Executed only by the owned synthetic MySQL integration test through fork/IPC.
import {createApplication} from "../../../src/framework/application/createApplication.js";
import {defaultConfigurationSource} from "../../../src/framework/configuration/applicationConfiguration.js";
import {SchedulerService} from "../../../src/services/scheduler/SchedulerService.js";
import {SalesJobRuntimeService} from "../../../src/services/salesJobs/SalesJobRuntimeService.js";
import {SalesImportJob} from "../../../src/services/salesJobs/jobs/SalesImportJob.js";
import {SalesIntakeService} from "../../../src/modules/sales/SalesIntakeService.js";
if(process.env.DB_INTEGRATION_TESTS!=="1"||!process.send)throw Error("Owned integration IPC required");
const [mode,root,tempRoot]=process.argv.slice(2),source=defaultConfigurationSource(),app=await createApplication({configurationSource:{...source,sales:{...source.sales,importChannelCodes:["SYNTHETIC"],importWorkerBatchSize:3},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.importWorker":{enabled:false}}}}}),database=app.services.require("mysqldatabase"),time=app.services.require("time"),logger=app.services.require("logging").logger,sources={mysqldatabase:database,time,logging:{logger}},services={require:key=>sources[key]},config={...app.configuration,scheduler:{...app.configuration.scheduler,startupJitterRatio:0,jobs:{}}},scheduler=new SchedulerService({config,services}),runtime=new SalesJobRuntimeService({config,services});sources.scheduler=scheduler;sources.salesJobs=runtime;const job=new SalesImportJob({config,services});await job.initialize();runtime.importer.root=root;runtime.importer.tempRoot=tempRoot;
const hold=async event=>{process.send({event});await new Promise(()=>{});};
if(mode==="after-commit"){
 const intake=new SalesIntakeService({database,time,logger,config:config.sales,authorizeSalesImport:()=>runtime.importPrincipal()});let first=true;runtime.importer.workerOptions.intakeService={async process(request){const result=await intake.process(request);if(first&&result.status==="SUCCEEDED"){first=false;await hold("source-committed");}return result;}};
}else if(mode==="result-write"){
 runtime.importer.database={withTransaction:database.withTransaction.bind(database),async query(sql,...args){const result=await database.query(sql,...args);if(sql.startsWith("SELECT i.id,COALESCE(e.id,0) AS error_id"))await hold("result-writing");return result;}};
}else throw Error("Unknown crash window");
await scheduler.start();await scheduler.execute(scheduler.jobs.get("sales.importWorker"));throw Error("Crash window was not reached");
