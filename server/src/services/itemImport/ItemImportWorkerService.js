/**
 * CSV 匯入嘅 scheduler lifecycle adapter。設計說明見
 * docs/items_management/design_spec.md §8.6。
 *
 * 薄：只註冊 job 及呼叫對應嘅獨立函式（`validateItemImportJob()` 等），
 * 唔喺呢個檔案入面放商品規則——同 §8.6 對呢個 class 嘅定位一致。真正嘅
 * parse／validate 邏輯住喺 `ItemImportProcessor.js`（business module），
 * DB 讀寫住喺 `ItemImportService.js`。
 *
 * `itemImport.validate` 冇 `scope: "cluster"`：同 media／device-binding 嗰啲
 * cluster-scope job（表係全部實例共用，每台各行一次就係重複 DELETE）唔
 * 同——job 之間嘅互斥已經由 `ItemImportService.claimNextUploadedJobForValidation()`
 * 用 DB compare-and-set＋`lease_owner`／`lease_until` 喺 job 呢一層做到（同
 * Job 只有一個 owner，見 §8.6），多個實例各自 tick 反而可以並行處理唔同嘅
 * job，增加吞吐量，唔會重複做同一份工作。
 */
import { randomUUID } from "node:crypto";
import { BaseService } from "../../framework/services/BaseService.js";
import { ItemImportService } from "../../modules/item/ItemImportService.js";
import { executeItemImportJob } from "./jobs/executeItemImportJob.js";
import { validateItemImportJob } from "./jobs/validateItemImportJob.js";

export class ItemImportWorkerService extends BaseService {
  static service = Object.freeze({
    name: "job.itemImportWorker",
    lifecycle: "singleton",
    dependencies: ["scheduler", "mysqldatabase", "logging", "time"],
    eager: true
  });

  static jobs = Object.freeze([
    {
      name: "itemImport.validate",
      method: "runValidation",
      // 使用者上傳 CSV 之後等緊 preflight 結果，用比 purge 呢類背景清理工作
      // 短得多嘅間距，令「上傳完幾多秒內見到驗證結果」貼近互動式體驗。
      intervalMs: 5_000,
      // 對齊 config.item.importTransactionTimeoutMs 嘅預設值，作為單次
      // validation run 嘅時間上限。
      timeoutMs: 120_000
    },
    {
      // 獨立嘅 job 名稱／lock key，同 `itemImport.validate` 分開——acceptance
      // criterion 要求 validation／execution／retention cleanup 唔可以共用
      // lock key，理由係三者嘅工作內容同失敗處理完全唔同，共用一個名會令
      // 「邊個 job 卡住咗」呢類故障排查無從入手。
      name: "itemImport.execute",
      method: "runExecution",
      // Confirm 之後使用者一樣等緊結果，但 execution 本身可能要處理成千
      // 行 SQL，冇必要好似 validate 咁密——5 秒一次已經令使用者感覺唔到分別，
      // 但唔會無謂咁頻密掃 queued 狀態。
      intervalMs: 5_000,
      timeoutMs: 120_000
    }
  ]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler");
    this.logger = services.require("logging").logger;
    this.time = services.require("time");
    this.leaseOwner = options.instanceId || randomUUID();
    this.importDirectory = config.item.importDirectory;
    this.importMaxRows = config.item.importMaxRows;
    this.importBatchSize = config.item.importBatchSize;
    this.importTransactionTimeoutMs = config.item.importTransactionTimeoutMs;
    // Lease 長度用 timeoutMs 加緩衝，同 scheduler 框架自己 cluster lease 嘅
    // 算法（clusterLeaseGraceMs）同一個道理：owner 若果喺執行途中崩潰，lease
    // 要喺呢段時間之後先過期，等第二個 tick（或者第二個實例）可以接手。
    this.leaseDurationMs = ItemImportWorkerService.jobs[0].timeoutMs + 30_000;
    this.database = services.require("mysqldatabase");
    this.importService = new ItemImportService({
      database: this.database,
      logger: this.logger,
      time: this.time
    });
  }

  async initialize() {
    this.scheduler.register(this);
  }

  async runValidation() {
    return validateItemImportJob({
      importService: this.importService,
      database: this.database,
      logger: this.logger,
      importDirectory: this.importDirectory,
      maxRows: this.importMaxRows,
      batchSize: this.importBatchSize,
      leaseOwner: this.leaseOwner,
      leaseDurationMs: this.leaseDurationMs
    });
  }

  async runExecution() {
    return executeItemImportJob({
      importService: this.importService,
      database: this.database,
      logger: this.logger,
      time: this.time,
      importDirectory: this.importDirectory,
      transactionTimeoutMs: this.importTransactionTimeoutMs,
      leaseOwner: this.leaseOwner,
      leaseDurationMs: this.leaseDurationMs
    });
  }
}
