import {salesPoolWaitWindow,salesPoolWaitAlerts} from "../../../modules/sales/salesPoolWaitMetrics.js";
import {BaseService} from "../../../framework/services/BaseService.js";
import {collectSalesQueueMetrics,salesQueueAlerts} from "../../../modules/sales/salesMetrics.js";

// Instance observations: global queue gauges must be deduplicated with max, never summed across instances.
export class SalesMetricsJob extends BaseService{
 static service=Object.freeze({name:"job.salesMetrics",lifecycle:"singleton",dependencies:["scheduler","mysqldatabase","time","logging"],eager:true});
 static jobs=Object.freeze([{name:"sales.metrics",method:"report",scope:"instance",intervalMs:300000,timeoutMs:30000}]);
 constructor({config,services,options={}}={}){super({config,services,options});this.scheduler=services.require("scheduler");this.database=services.require("mysqldatabase");this.time=services.require("time");this.logger=services.require("logging").logger;this.poolWaitSample=null;}
 async initialize(){this.scheduler.register(this);}
 async report(signal){
  try{
   const flush=this.scheduler.describeJobs().find(job=>job.name==="scheduler.statsFlush");
   const statsFreshnessMs=flush?.enabled===true?flush.intervalMs*this.config.scheduler.stats.staleAfterRuns:undefined;
   const metrics=await collectSalesQueueMetrics({database:this.database,nowMs:this.time.nowMs(),archiveEnabled:this.config?.scheduler?.jobs?.["sales.archive"]?.enabled===true,config:this.config?.sales,statsFreshnessMs,signal});
   const sample={atMs:this.time.nowMs(),metrics:this.database.getConnectionWaitMetrics()};
   metrics.poolWait=salesPoolWaitWindow(this.poolWaitSample,sample);
   await this.logger.info("sales.metrics","Readonly Sales operational queue observations",metrics);
   for(const alert of [...salesQueueAlerts(metrics),...salesPoolWaitAlerts(metrics.poolWait)])await this.logger[alert.level](alert.event,"Sales operational queue alert",alert.context);
   this.poolWaitSample=sample;
   return metrics;
  }catch{throw new Error("Sales operational metrics unavailable");}
 }
}
