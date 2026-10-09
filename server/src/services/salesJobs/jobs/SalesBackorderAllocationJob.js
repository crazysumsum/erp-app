import { BaseService } from "../../../framework/services/BaseService.js";

export class SalesBackorderAllocationJob extends BaseService {
 static service=Object.freeze({name:"job.salesBackorderAllocation",lifecycle:"singleton",dependencies:["scheduler","salesJobs"],eager:true});
 static jobs=Object.freeze([{name:"sales.backorderAllocate",method:"run",scope:"cluster",intervalMs:300000,timeoutMs:30000}]);
 constructor({config,services,options={}}={}){super({config,services,options});this.scheduler=services.require("scheduler");this.runtime=services.require("salesJobs");}
 async initialize(){this.scheduler.register(this);this.runtime.bindBackorderScheduler(this.scheduler);}
 run(signal){return this.runtime.allocateBackorders(signal);}
}
