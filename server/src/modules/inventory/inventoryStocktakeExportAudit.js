import { InventoryAuditService } from "./InventoryAuditService.js";
import { reportInternalFailure } from "../../framework/diagnostics/reportInternalFailure.js";

const OWNERS = new WeakMap();
const BUDGET_MS = 5000;

// Stocktake export only. A false result cannot prove a cancelled pool waiter ended.
export function createStocktakeExportAudit({ database, logger, time } = {}) {
  const succeeded = new InventoryAuditService({ database, logger, time });
  const diagnostic = (stage, input) => {
    reportInternalFailure("inventory.stocktake.failure_audit_unavailable", null, {
      stage,
      requestId: typeof input?.requestId === "string" && /^[\x20-\x7e]{0,64}$/u.test(input.requestId) ? input.requestId : ""
    });
  };
  const independent = (method, input) => {
    const deadline = performance.now() + BUDGET_MS;
    if (database.closed || OWNERS.has(database)) {
      diagnostic(database.closed ? "PRIMARY_CLOSED" : "OWNER_BUSY", input);
      return Promise.resolve(false);
    }
    const controller = new AbortController(), owner = { state: "ACTIVE" };
    OWNERS.set(database, owner);
    return new Promise(resolve => {
      let returned = false;
      const finish = result => {
        if (returned) return;
        returned = true;
        clearTimeout(timer);
        const success = result === true && performance.now() < deadline;
        if (success) OWNERS.delete(database);
        else owner.state = "QUARANTINED";
        resolve(success);
      };
      const timer = setTimeout(() => {
        controller.abort(Object.assign(new Error("Stocktake failure Audit deadline exceeded"), { code: "STOCKTAKE_FAILURE_AUDIT_TIMEOUT" }));
        diagnostic("DEADLINE", input);
        finish(false);
      }, Math.max(0, deadline - performance.now()));
      try {
        const snapshot = structuredClone(input);
        const audit = new InventoryAuditService({
          // Resolve the live method synchronously: CS01 associates this invocation.
          database: { withTransaction: work => database.withTransaction(work, { signal: controller.signal }) },
          logger, time
        });
        Promise.resolve(audit[method](snapshot)).then(finish, () => { diagnostic("AUDIT_REJECTED", snapshot); finish(false); });
      } catch {
        diagnostic("INPUT_OR_INVOCATION", input);
        finish(false);
      }
    });
  };
  return {
    recordSucceeded: (transaction, input) => succeeded.recordSucceeded(transaction, input),
    recordFailed: input => independent("recordFailed", input),
    recordRejected: input => independent("recordRejected", input)
  };
}
