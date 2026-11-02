import {BaseService} from "../../../framework/services/BaseService.js";
export class SalesExportJob extends BaseService {
 static service=Object.freeze({name:"job.salesExport",lifecycle:"singleton",dependencies:["scheduler","salesJobs"],eager:true});
 static jobs=Object.freeze([{name:"sales.exportWorker",method:"run",scope:"cluster",intervalMs:5000,timeoutMs:30000}]);
 constructor({config,services,options={}}={}){super({config,services,options});this.scheduler=services.require("scheduler");this.runtime=services.require("salesJobs");}
 async initialize(){this.scheduler.register(this);this.runtime.bindExportScheduler(this.scheduler);}
 run(signal){return this.runtime.processExports(signal);}
}
