import {BaseService} from "../../../framework/services/BaseService.js";
export class SalesArchiveJob extends BaseService{
 static service=Object.freeze({name:"job.salesArchive",lifecycle:"singleton",dependencies:["scheduler","salesJobs"],eager:true});
 static jobs=Object.freeze([{name:"sales.archive",method:"run",scope:"cluster",intervalMs:900000,timeoutMs:600000}]);
 constructor(options){super(options);this.scheduler=this.services.require("scheduler");this.runtime=this.services.require("salesJobs");}
 async initialize(){this.scheduler.register(this);await this.runtime.bindArchiveScheduler(this.scheduler);}
 run(signal){return this.runtime.processArchives(signal);}
}
