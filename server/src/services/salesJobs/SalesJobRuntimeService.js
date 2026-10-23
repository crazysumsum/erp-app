import {SalesArchiveService} from "../../modules/sales/SalesArchiveService.js";
import {SalesArchiveBatchService} from "../../modules/sales/SalesArchiveBatchService.js";
import {SchedulerService} from "../scheduler/SchedulerService.js";
import {getActiveTransactionIsolation} from "../mysqldatabase/MySqlDatabaseService.js";
import {SalesExportService} from "../../modules/sales/SalesExportService.js";
import {SalesImportService} from "../../modules/sales/SalesImportService.js";
import { BaseService } from "../../framework/services/BaseService.js";
import { SalesQuotationService } from "../../modules/sales/SalesQuotationService.js";
import { SalesOrderConfirmationService } from "../../modules/sales/SalesOrderConfirmationService.js";
import { SalesBackorderService } from "../../modules/sales/SalesBackorderService.js";
import { salesError } from "../../modules/sales/salesErrors.js";

export class SalesJobRuntimeService extends BaseService {
  #archiveScopes=new WeakMap();#archiveScheduler;#archiveJob;#archiveSource;#archiveBatch;
  static service = Object.freeze({ name: "salesJobs", lifecycle: "singleton", dependencies: ["mysqldatabase", "time", "logging"], eager: true });
  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.logger = services.require("logging").logger;
    this.exports=new SalesExportService({database:services.require("mysqldatabase"),time:services.require("time"),config:config?.sales,authorizeSalesExport:()=>this.exportPrincipal()});
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
  bindExportScheduler(scheduler){const job=scheduler.jobs.get("sales.exportWorker");if(job?.serviceName!=="job.salesExport"||job.scope!=="cluster"||job.method!=="run")throw new Error("Sales Export job registration invalid");this.exportScheduler=scheduler;this.exportJob=job;}
  exportPrincipal(){const scheduler=this.exportScheduler,job=this.exportJob;if(scheduler?.started!==true||scheduler.stopped!==false||scheduler.schedulerConfig.enabled!==true||job?.enabled!==true||scheduler.jobs.get(job.name)!==job)return null;const signal=scheduler.running.get(job.name)?.controller.signal;return signal?.aborted===false?{leaseOwner:scheduler.owner,signal}:null;}
  async processExports(signal){if(signal!==this.exportPrincipal()?.signal)throw new Error("Sales Export worker unavailable");let result;try{result=await this.exports.runBatch({signal});}catch{throw new Error("Sales Export processing failed");}if(result.processed)await this.logger.info("sales.export_completed","Sales export batch completed",result);return result;}
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
  async bindArchiveScheduler(scheduler){
    const job=scheduler?.jobs?.get("sales.archive");
    if(!(scheduler instanceof SchedulerService)||scheduler!==await this.services.resolve("scheduler")||job?.serviceName!=="job.salesArchive"||job.scope!=="cluster"||job.method!=="run")throw new Error("Sales Archive job registration invalid");
    if(this.#archiveScheduler&&(this.#archiveScheduler!==scheduler||this.#archiveJob!==job))throw new Error("Sales Archive job already registered");
    this.#archiveScheduler=scheduler;this.#archiveJob=job;
  }
  #archivePrincipal(){
    if(this.config?.scheduler?.jobs?.["sales.archive"]?.enabled!==true)return null;
    const scheduler=this.#archiveScheduler,job=this.#archiveJob;
    if(scheduler?.started!==true||scheduler.stopped!==false||scheduler.schedulerConfig.enabled!==true||job?.enabled!==true||scheduler.jobs.get("sales.archive")!==job)return null;
    const signal=scheduler.running.get(job.name)?.controller.signal;
    return signal?.aborted===false?{leaseOwner:scheduler.owner,signal}:null;
  }
  async #liveArchiveScope(tx){
    const scope=this.#archiveScopes.get(tx),principal=this.#archivePrincipal(),database=this.services.require("mysqldatabase");
    if(!scope||!principal||scope.signal!==principal.signal||scope.leaseOwner!==principal.leaseOwner||database.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="REPEATABLE READ")return null;
    // These exact rows were locked before all operation/domain locks; rechecking them takes no new lock rank.
    const [[lease]]=await tx.query("SELECT owner,expires_at FROM fr_job_leases WHERE job_name='sales.archive' FOR UPDATE"),[[batch]]=await tx.query("SELECT status,cutoff_at,lease_owner,lease_until FROM sales_archive_batches WHERE id=? FOR UPDATE",[scope.archiveBatchId]),[[clock]]=await tx.query("SELECT UNIX_TIMESTAMP() AS now,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");
    if(lease?.owner!==scope.leaseOwner||Number(lease.expires_at)<=Number(clock.now)||!batch||!["RUNNING","PARTIAL"].includes(batch.status)||batch.lease_owner!==scope.leaseToken||Number(batch.lease_until)<=Number(clock.now_ms)||Number(batch.cutoff_at)!==scope.cutoffMs||this.#archivePrincipal()?.signal!==scope.signal||scope.signal.aborted)return null;
    return scope;
  }
  async authorizeArchiveInTransaction(tx,command){
    const scope=this.#archiveScopes.get(tx);if(!scope||!command||Reflect.ownKeys(command).sort().join(",")!=="archiveBatchId,cutoffMs,orderId"||["orderId","archiveBatchId","cutoffMs"].some(k=>Object.getOwnPropertyDescriptor(command,k)?.value!==scope[k]))return false;
    return await this.#liveArchiveScope(tx)!==null;
  }
  async authorizeArchiveReadInTransaction(tx,command){
    const scope=this.#archiveScopes.get(tx);if(!scope||!command||Reflect.ownKeys(command).sort().join(",")!=="atMs,orderId"||Object.getOwnPropertyDescriptor(command,"orderId")?.value!==scope.orderId||Object.getOwnPropertyDescriptor(command,"atMs")?.value!==scope.readAtMs)return false;
    return await this.#liveArchiveScope(tx)!==null;
  }
  async #executeLockedArchive(tx,scope){
    const principal=this.#archivePrincipal();
    if(!principal||principal.signal!==scope.signal||principal.leaseOwner!==scope.leaseOwner||this.#archiveScopes.has(tx))throw new Error("Sales Archive worker unavailable");
    this.#archiveScopes.set(tx,scope);
    try{
      if(await this.#liveArchiveScope(tx)===null)throw new Error("Sales Archive worker unavailable");
      return await this.#archiveSource.archiveOrderInTransaction(tx,{orderId:scope.orderId,archiveBatchId:scope.archiveBatchId,cutoffMs:scope.cutoffMs,archivedAtMs:scope.archivedAtMs});
    }finally{this.#archiveScopes.delete(tx);}
  }
  async processArchives(signal){
    if(signal!==this.#archivePrincipal()?.signal)throw new Error("Sales Archive worker unavailable");
    if(!this.#archiveBatch){
      const database=this.services.require("mysqldatabase"),time=this.services.require("time");
      const resolveParticipant=async()=>{try{return await this.services.resolve("fulfillmentArchive");}catch{throw Object.assign(new Error("OPEN_MATTER_UNKNOWN"),{code:"OPEN_MATTER_UNKNOWN"});}};
      this.#archiveSource=new SalesArchiveService({database,authorizeArchive:(tx,scope)=>this.authorizeArchiveInTransaction(tx,scope),getArchiveReadTime:async tx=>(await this.#liveArchiveScope(tx))?.readAtMs,openMatter:{getOrderArchiveStatusInTransaction:async(tx,scope)=>{try{return await(await this.services.resolve("fulfillmentOpenMatter")).getOrderArchiveStatusInTransaction(tx,scope);}catch{return {version:"1",status:"UNKNOWN",reasonCodes:["PROVIDER_UNAVAILABLE"]};}}},participant:{prepareOrderInTransaction:async(tx,command)=>(await resolveParticipant()).prepareOrderInTransaction(tx,command),archiveOrderInTransaction:async(tx,command)=>(await resolveParticipant()).archiveOrderInTransaction(tx,command)}});
      this.#archiveBatch=new SalesArchiveBatchService({database,time,config:this.config?.sales,authorizeJob:()=>this.#archivePrincipal(),executeLockedArchive:(tx,scope)=>this.#executeLockedArchive(tx,scope)});
    }
    const result=await this.#archiveBatch.runBatch({signal});
    await this.logger.info("sales_archive.completed","Sales Archive worker batch completed",result);
    if(result.failed||result.stopped){await this.logger.error("sales_archive.failed","Sales Archive has unresolved orders",result);throw new Error("Sales Archive processing incomplete");}
    return result;
  }

}
