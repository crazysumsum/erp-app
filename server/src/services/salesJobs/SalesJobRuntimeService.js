import {SalesImportService} from "../../modules/sales/SalesImportService.js";
import { BaseService } from "../../framework/services/BaseService.js";
import { SalesQuotationService } from "../../modules/sales/SalesQuotationService.js";
import { SalesOrderConfirmationService } from "../../modules/sales/SalesOrderConfirmationService.js";
import { SalesBackorderService } from "../../modules/sales/SalesBackorderService.js";
import { salesError } from "../../modules/sales/salesErrors.js";

export class SalesJobRuntimeService extends BaseService {
  static service = Object.freeze({ name: "salesJobs", lifecycle: "singleton", dependencies: ["mysqldatabase", "time", "logging"], eager: true });
  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.logger = services.require("logging").logger;
    this.quotation = new SalesQuotationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
    this.confirmation = new SalesOrderConfirmationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger, config: config?.sales });
  }
  async expireQuotations(signal) {
    let result;
    try { result = await this.quotation.expire({ signal }); }
    catch (error) { throw new Error("Quotation expiry failed", { cause: error }); }
    await this.logger.info("sales.quotation_expiry_completed", "Quotation expiry batch completed", result);
    return result;
  }
  async recoverConfirmations(signal) {
    let result;
    try { result = await this.confirmation.recover({ signal }); }
    catch { throw new Error("Sales confirmation recovery failed"); }
    await this.logger.info("sales.confirmation_recovery_completed", "Confirmation recovery batch completed", result);
    if (result.oldestAgeMs > 300000) await this.logger.error("sales.confirmation_recovery_overdue", "Confirmation recovery exceeds five minutes", result);
    if (result.deferred) throw new Error("Sales confirmation recovery incomplete");
    return result;
  }
  bindImportScheduler(scheduler) {
    const job=scheduler.jobs.get("sales.importWorker");
    if(job?.serviceName!=="job.salesImport"||job.scope!=="cluster"||job.method!=="run")throw new Error("Sales Import job registration invalid");
    this.importScheduler=scheduler;this.importJob=job;
    this.importer=new SalesImportService({database:this.services.require("mysqldatabase"),time:this.services.require("time"),logger:this.logger,config:this.config?.sales,authorizeSalesImport:()=>this.importPrincipal()});
  }
  importPrincipal() {
    const scheduler=this.importScheduler,job=this.importJob;
    if(scheduler?.started!==true||scheduler.stopped!==false||scheduler.schedulerConfig.enabled!==true||job?.enabled!==true||scheduler.jobs.get("sales.importWorker")!==job)return null;
    const signal=scheduler.running.get(job.name)?.controller.signal;
    return signal?.aborted===false?{leaseOwner:scheduler.owner,signal}:null;
  }
  async processImports(signal) {
    const principal=this.importPrincipal();if(!principal||signal!==principal.signal)throw new Error("Sales Import worker unavailable");
    let result,intake;try{result=await this.importer.runPrecheckBatch({signal});intake=await this.importer.runProcessingBatch({signal});}catch{throw new Error("Sales Import processing failed");}
    if(result.processed)await this.logger.info("sales.import_precheck_completed","Import precheck batch completed",result);
    if(intake.processed)await this.logger.info("sales.intake_processing_completed","Intake processing batch completed",intake);
    return {...result,intake};
  }
  bindBackorderScheduler(scheduler) {
    const job=scheduler.jobs.get("sales.backorderAllocate");
    if(job?.serviceName!=="job.salesBackorderAllocation"||job.scope!=="cluster"||job.method!=="run")throw new Error("Sales Backorder job registration invalid");
    this.scheduler=scheduler;this.backorderJob=job;
    this.backorder=new SalesBackorderService({database:this.services.require("mysqldatabase"),time:this.services.require("time"),logger:this.logger,config:this.config?.sales,authorizeSalesBackorder:()=>this.backorderPrincipal()});
  }
  #activeBackorderJob() {
    const scheduler=this.scheduler,job=this.backorderJob;
    return scheduler?.started===true&&scheduler.stopped===false&&scheduler.schedulerConfig.enabled===true&&job?.enabled===true&&scheduler.jobs.get("sales.backorderAllocate")===job?job:null;
  }
  backorderPrincipal() {
    const job=this.#activeBackorderJob(),signal=job&&this.scheduler.running.get(job.name)?.controller.signal;
    return signal?.aborted===false?{leaseOwner:this.scheduler.owner,signal}:null;
  }
  async allocateBackorders(signal) {
    if(signal!==this.backorderPrincipal()?.signal)throw new Error("Sales Backorder worker unavailable");
    let result;try{result=await this.backorder.runBatch({signal});}catch{throw new Error("Sales Backorder allocation failed");}
    await this.logger.info("sales.backorder_allocation_completed","Backorder FIFO allocation batch completed",result);
    if(result.deferred)throw new Error("Sales Backorder allocation incomplete");
    return result;
  }
  async wakeBackorders(request) {
    const job=this.#activeBackorderJob();if(!job)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    const result=await this.backorder.wake(request);
    if(this.#activeBackorderJob()!==job)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    // Use the scheduler's existing overlap and cluster-lease admission; no new timer or allocator.
    void this.scheduler.execute(job).catch(()=>this.logger.error("sales.backorder_wake_failed","Backorder wake failed",{deferred:1}));
    return result;
  }
}
