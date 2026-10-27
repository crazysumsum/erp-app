import { BaseService } from "../../framework/services/BaseService.js";
import { collectSupplierMetrics, supplierAlerts } from "../../modules/supplier/supplierMetrics.js";

/**
 * 每 5 分鐘寫一條 `supplier.metrics`，過咗門檻就寫告警 event（TASK-050；設計 §12.4；HD-083 A）。
 * Cluster scope 係互斥鎖，唔係「每段時間只行一次」：每個 instance 各自計時，所以 N 個 instance 會各寫一條
 * （REV-124 R2）。Bank 次數因此用對齊嘅時間桶，同一個桶可以靠 `bank.bucketStart` 去重。
 */
export class SupplierMetricsJob extends BaseService {
  static service = Object.freeze({
    name: "job.supplierMetrics",
    lifecycle: "singleton",
    dependencies: ["scheduler", "mysqldatabase", "logging", "time"],
    eager: true
  });

  static jobs = Object.freeze([
    { name: "supplier.metrics", method: "report", scope: "cluster", intervalMs: 300_000, timeoutMs: 60_000 }
  ]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler");
    this.database = services.require("mysqldatabase");
    this.logger = services.require("logging").logger;
    this.time = services.require("time");
  }

  async initialize() {
    this.scheduler.register(this);
  }

  async report() {
    const metrics = await collectSupplierMetrics(this.database, this.time.nowMs());
    void this.logger?.info?.("supplier.metrics", "Supplier operational metrics", metrics);
    for (const { event, level, context } of supplierAlerts(metrics)) {
      void this.logger?.[level]?.(event, "Supplier metric over its alert threshold", context);
    }
    return metrics;
  }
}
