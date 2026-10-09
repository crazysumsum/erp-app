/**
 * Supplier 營運指標同告警（TASK-050；設計 §12.4；HD-083 A）。
 *
 * 系統冇 metrics 後台，所以跟 Sales 嘅做法：定時計幾個低基數數值寫 `supplier.metrics` log，超過門檻就寫告警
 * event。其餘指標本身已經有 log：API 次數／延遲／錯誤（request log 嘅 route、status、durationMs）、Bank integrity
 * 同 key 錯誤（`supplier.bank.integrity_failed`／`key_unavailable`，error 級）、purge 失敗（job 失敗同
 * `supplier.import.purge_failed`）、import 吞吐（`supplier.import.completed` 嘅計數）。
 */

const MINUTE_MS = 60_000;

/** 門檻（HD-083 2A：寫成常數，容量報告列明；運維要調先搬去 config）。 */
export const SUPPLIER_ALERT_THRESHOLDS = Object.freeze({
  approvalPendingMs: 24 * 60 * MINUTE_MS,
  importWaitingMs: 15 * MINUTE_MS,
  importStalledMs: 15 * MINUTE_MS
});

const age = (nowMs, since) => (since === null || since === undefined ? null : Math.max(0, nowMs - Number(since)));

/** 讀幾個數；兩條 query 都只掃未完成嘅 approval／import job。 */
export async function collectSupplierMetrics(database, nowMs, { stalledMs = SUPPLIER_ALERT_THRESHOLDS.importStalledMs } = {}) {
  const [[approvals]] = await database.query(
    "SELECT COUNT(*) AS pending, MIN(requested_at) AS oldest FROM supplier_activation_requests WHERE status = 'pending'");
  // 等緊嘅（uploaded 等預檢、queued 等執行）由上載／確認計；做緊嘅（validating、running）由 lease 計，
  // lease 已釋放（NULL）就由最後更新計：超過 stalledMs 都冇人接手就係卡住。
  const [imports] = await database.query(
    `SELECT status, COUNT(*) AS n,
            MIN(CASE WHEN status = 'queued' THEN confirmed_at ELSE created_at END) AS oldest,
            SUM(status IN ('validating', 'running') AND COALESCE(lease_until, updated_at) < ?) AS stalled
       FROM supplier_import_jobs
      WHERE status IN ('uploaded', 'validating', 'queued', 'running')
      GROUP BY status`,
    [nowMs - stalledMs]
  );
  const byStatus = Object.fromEntries(imports.map((row) => [row.status, row]));
  const waiting = ["uploaded", "queued"].map((status) => byStatus[status]?.oldest).filter((value) => value !== null && value !== undefined);
  return {
    approvals: { pending: Number(approvals.pending), oldestAgeMs: age(nowMs, approvals.oldest) },
    imports: {
      uploaded: Number(byStatus.uploaded?.n ?? 0), validating: Number(byStatus.validating?.n ?? 0),
      queued: Number(byStatus.queued?.n ?? 0), running: Number(byStatus.running?.n ?? 0),
      oldestWaitingMs: waiting.length === 0 ? null : age(nowMs, Math.min(...waiting.map(Number))),
      stalled: imports.reduce((sum, row) => sum + Number(row.stalled ?? 0), 0)
    }
  };
}

/** 邊啲數過咗門檻；回 `[{ event, level, context }]`。 */
export function supplierAlerts(metrics, thresholds = SUPPLIER_ALERT_THRESHOLDS) {
  const alerts = [];
  if (metrics.approvals.oldestAgeMs !== null && metrics.approvals.oldestAgeMs > thresholds.approvalPendingMs) {
    // 本期只報，唔自動升級或改派（設計 §12.4）。
    alerts.push({ event: "supplier.alert.approval_overdue", level: "warn", context: { ...metrics.approvals, thresholdMs: thresholds.approvalPendingMs } });
  }
  const waitingTooLong = metrics.imports.oldestWaitingMs !== null && metrics.imports.oldestWaitingMs > thresholds.importWaitingMs;
  if (waitingTooLong || metrics.imports.stalled > 0) {
    alerts.push({ event: "supplier.alert.import_stalled", level: "error", context: { ...metrics.imports,
      waitingThresholdMs: thresholds.importWaitingMs, stalledThresholdMs: thresholds.importStalledMs } });
  }
  return alerts;
}
