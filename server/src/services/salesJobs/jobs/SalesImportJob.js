import {BaseService} from "../../../framework/services/BaseService.js";
export class SalesImportJob extends BaseService {
 static service=Object.freeze({name:"job.salesImport",lifecycle:"singleton",dependencies:["scheduler","salesJobs"],eager:true});
 static jobs=Object.freeze([{name:"sales.importWorker",method:"run",scope:"cluster",intervalMs:2000,timeoutMs:30000}]);
 constructor({config,services,options={}}={}){super({config,services,options});this.scheduler=services.require("scheduler");this.runtime=services.require("salesJobs");}
 async initialize(){this.scheduler.register(this);this.runtime.bindImportScheduler(this.scheduler);}
 run(signal){return this.runtime.precheckImports(signal);}
}
