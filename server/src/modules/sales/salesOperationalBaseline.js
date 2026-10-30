import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {salesPayloadHash} from "./salesCanonicalHash.js";
const files=["./salesOperationalBaseline.js","./salesOperationalObservations.js","./salesMetrics.js","./salesTransactionObservations.js","./SalesIntakeService.js","./SalesIntakeWorker.js","./SalesImportPrecheckWorker.js","../../../scripts/activateSalesObservations.js","./SalesOperationalObservationService.js","./salesEngineMetrics.js","./salesDomainObservations.js","./SalesOperationService.js","./SalesOrderConfirmationService.js","./SalesOrderService.js","./SalesQuotationService.js","./SalesArchiveBatchService.js","./SalesBackorderService.js","./salesCanonicalHash.js","../inventory/InventoryReservationService.js","../inventory/inventoryValidation.js","../item/ItemLookupService.js","../../services/salesJobs/SalesJobRuntimeService.js","../../services/scheduler/jobs/SalesMetricsJob.js","../../services/salesJobs/jobs/SalesBackorderAllocationJob.js","../../services/scheduler/SchedulerService.js","../../services/mysqldatabase/MySqlDatabaseService.js","../../services/time/SystemTimeService.js","../../services/time/timeFormat.js"];
let sourceDigest;
// Immutable deployed source is fingerprinted once per process; never trust a caller-provided artifact label.
export function getSalesObservationBaseline(config){
 if(!sourceDigest){const digest=createHash("sha256");for(const file of files){const bytes=readFileSync(new URL(file,import.meta.url));digest.update(file+"\0"+bytes.length+"\0");digest.update(bytes);}sourceDigest=digest.digest("hex");}
 return createHash("sha256").update(sourceDigest+":"+salesPayloadHash({timeZone:config?.application?.timeZone??null,sales:config?.sales??null,backorderJob:config?.scheduler?.jobs?.["sales.backorderAllocate"]??null,metricsJob:config?.scheduler?.jobs?.["sales.metrics"]??null,schedulerEnabled:config?.scheduler?.enabled??null})).digest("hex");
}
