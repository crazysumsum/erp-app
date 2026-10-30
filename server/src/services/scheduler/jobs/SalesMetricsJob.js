import {getSalesTransactionObservations} from "../../../modules/sales/salesTransactionObservations.js";
import {SalesOperationalObservationService} from "../../../modules/sales/SalesOperationalObservationService.js";
import {salesOperationalAlerts} from "../../../modules/sales/salesOperationalObservations.js";
import {collectSalesEngineMetrics} from "../../../modules/sales/salesEngineMetrics.js";
import {getSalesDomainObservations} from "../../../modules/sales/salesDomainObservations.js";
import {getSalesObservationBaseline} from "../../../modules/sales/salesOperationalBaseline.js";
import {InventoryReservationService} from "../../../modules/inventory/InventoryReservationService.js";
import {getActiveTransactionIsolation} from "../../mysqldatabase/MySqlDatabaseService.js";
import {getSalesQueryObservations,salesQueryObservationWindow,salesQueryObservationAlerts} from "../../../modules/sales/salesQueryObservations.js";
import {salesPoolWaitWindow,salesPoolWaitAlerts} from "../../../modules/sales/salesPoolWaitMetrics.js";
import {BaseService} from "../../../framework/services/BaseService.js";
import {collectSalesQueueMetrics,salesQueueAlerts} from "../../../modules/sales/salesMetrics.js";

// Instance observations: global queue gauges must be deduplicated with max, never summed across instances.
export class SalesMetricsJob extends BaseService{
 #job;#inventory;#readScopes=new WeakMap();
 static service=Object.freeze({name:"job.salesMetrics",lifecycle:"singleton",dependencies:["scheduler","mysqldatabase","time","logging"],eager:true});
 static jobs=Object.freeze([{name:"sales.metrics",method:"report",scope:"instance",intervalMs:300000,timeoutMs:30000}]);
 constructor({config,services,options={}}={}){super({config,services,options});this.scheduler=services.require("scheduler");this.database=services.require("mysqldatabase");this.time=services.require("time");this.logger=services.require("logging").logger;this.poolWaitSample=null;this.querySample=null;this.domainFaultSample=null;this.observations=new SalesOperationalObservationService({database:this.database,baselineHash:getSalesObservationBaseline(this.config),authorizeMetrics:()=>this.#principal()});}
 async initialize(){this.scheduler.register(this);const job=this.scheduler.jobs.get("sales.metrics");if(job?.serviceName!=="job.salesMetrics"||job.scope!=="instance"||job.method!=="report")throw new Error("Sales metrics job registration invalid");this.#job=job;}
 #principal(){const scheduler=this.scheduler,job=this.#job;if(scheduler.started!==true||scheduler.stopped!==false||scheduler.schedulerConfig.enabled!==true||job?.enabled!==true||scheduler.jobs.get("sales.metrics")!==job)return null;const signal=scheduler.running.get(job.name)?.controller.signal;return signal?.aborted===false?{leaseOwner:scheduler.owner,signal}:null;}
 #observationPrincipal(tx){const signal=this.#readScopes.get(tx),principal=this.#principal();return signal&&principal?.signal===signal&&this.database.context?.get()?.databaseTransaction===tx&&getActiveTransactionIsolation(tx)==="REPEATABLE READ"?principal:null;}
 async #readAvailability(tx,demands,atMs,signal){
  if(this.#principal()?.signal!==signal||this.#readScopes.has(tx))throw new Error("Sales Inventory observation unavailable");
  this.#inventory??=new InventoryReservationService({database:this.database,time:this.time,logger:this.logger,authorizeSalesObservation:connection=>this.#observationPrincipal(connection)});
  this.#readScopes.set(tx,signal);try{return await this.#inventory.readSalesAvailabilityForObservationInTransaction(tx,{version:"1",observedAtMs:atMs,demands});}finally{this.#readScopes.delete(tx);}
 }
 async report(signal){
  // Instance jobs enter Scheduler.running after run() first yields its promise.
  await Promise.resolve();
  try{
   const principal=this.#principal();if(!principal||principal.signal!==signal)throw new Error("Sales metrics worker unavailable");
   const flush=this.scheduler.describeJobs().find(job=>job.name==="scheduler.statsFlush");
   const statsFreshnessMs=flush?.enabled===true?flush.intervalMs*this.config.scheduler.stats.staleAfterRuns:undefined;
   const metrics=await collectSalesQueueMetrics({database:this.database,nowMs:this.time.nowMs(),archiveEnabled:this.config?.scheduler?.jobs?.["sales.archive"]?.enabled===true,config:this.config?.sales,statsFreshnessMs,signal});
   metrics.operational=await this.observations.collect({signal,providerUnknown:metrics.archive.providerUnknown>0,readAvailability:(tx,demands,atMs)=>this.#readAvailability(tx,demands,atMs,signal)});
   Object.assign(metrics.backorder,metrics.operational.history);
   metrics.engine=await collectSalesEngineMetrics({database:this.database,signal});
   metrics.domainOperations=getSalesDomainObservations(this.database);
   metrics.transactionOperations=getSalesTransactionObservations(this.database);
   const sample={atMs:this.time.nowMs(),metrics:this.database.getConnectionWaitMetrics()};
   metrics.poolWait=salesPoolWaitWindow(this.poolWaitSample,sample);
   const querySample={atMs:sample.atMs,metrics:getSalesQueryObservations(this.database)};
   metrics.queryOperations=salesQueryObservationWindow(this.querySample,querySample);
   await this.logger.info("sales.metrics","Sales operational observations",metrics);
   for(const alert of [...salesQueueAlerts(metrics),...salesOperationalAlerts(metrics.operational),...salesPoolWaitAlerts(metrics.poolWait),...salesQueryObservationAlerts(metrics.queryOperations)])await this.logger[alert.level](alert.event,"Sales operational queue alert",alert.context);
   for(const [fault,count]of Object.entries(metrics.domainOperations.faults)){const previous=this.domainFaultSample?.[fault]??0;if(count>previous)await this.logger.error("sales.alert."+fault,"Sales observed domain fault",{count:count-previous,coverage:this.domainFaultSample?"SINCE_LAST_COMPLETED_PUBLICATION_ATTEMPT":"PROCESS_LIFETIME"});}
   if(metrics.engine.coverage==="UNKNOWN")await this.logger.warn("sales.alert.engine_observation_unavailable","Sales engine observation unavailable",{reason:metrics.engine.reason});
   this.poolWaitSample=sample;this.querySample=querySample;this.domainFaultSample={...metrics.domainOperations.faults};
   return metrics;
  }catch{throw new Error("Sales operational metrics unavailable");}
 }
}
