import { createHash } from "node:crypto";
import { ItemLookupService } from "../../item/ItemLookupService.js";
import { InventoryOperationService, inventoryOperationHash } from "../InventoryOperationService.js";
import { InventoryAuditService } from "../InventoryAuditService.js";
import { InventoryLockService } from "../InventoryLockService.js";
import { consumeInventoryHighRiskContext } from "../inventoryHighRiskContext.js";
import { applyInventoryOpeningRows } from "./inventoryOpeningPosting.js";
import { inventoryError } from "../inventoryErrors.js";
import { precheckInventoryOpeningCsv } from "./inventoryOpeningPrecheck.js";

function json(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function id(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "id" });
  return result;
}

export async function openingControl(tx, { lock = false } = {}) {
  const [[control]] = await tx.query(
    `SELECT lifecycle_status, version FROM inventory_control WHERE id = 1${lock ? " FOR UPDATE" : ""}`
  );
  if (!control) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
  return { status: control.lifecycle_status, version: Number(control.version) };
}

function openingSnapshotHash(rows) {
  return inventoryOperationHash({ commandType: "OPENING_POST", payload: rows });
}

function assertOpeningAllowed(control) {
  if (control.status === "LIVE") throw inventoryError("OPENING_CLOSED");
  if (control.status !== "PRE_GO_LIVE") throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
}

export class InventoryOpeningService {
  constructor({ database, time, logger }) {
    this.database = database;
    this.time = time;
    this.logger = logger;
  }

  async upload(bytes, { authorize, signal }) {
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    return this.database.withTransaction(async tx => {
      await authorize(tx);
      assertOpeningAllowed(await openingControl(tx));
      const lookup = new ItemLookupService({ database: tx, time: this.time, logger: this.logger });
      const { rows, errors, skippedRows } = await precheckInventoryOpeningCsv(bytes, { reader: tx, itemLookup: lookup });
      if (!errors.length && !rows.length) errors.push({ row: 1, field: "file", code: "OPENING_NO_POSITIVE_ROWS" });
      const snapshotHash = rows.length ? openingSnapshotHash(rows) : null;
      const status = errors.length ? "INVALID" : "READY";
      const diagnostics = JSON.stringify({ errors, skippedRows });
      const control = await openingControl(tx, { lock: true });
      assertOpeningAllowed(control);
      const actor = await authorize(tx);
      const [inserted] = await tx.execute(
        `INSERT INTO inventory_opening_jobs
          (status, source_file_hash, source_file_size, precheck_snapshot_hash, ready_rows, diagnostics, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [status, sourceHash, bytes.length, snapshotHash, rows.length, diagnostics, this.time.nowMs(), id(actor.id)]
      );
      const jobId = id(inserted.insertId);
      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100);
        await tx.execute(
          `INSERT INTO inventory_opening_rows (job_id, csv_row_number, normalized_input)
           VALUES ${batch.map(() => "(?, ?, ?)").join(", ")}`,
          batch.flatMap(row => [jobId, row.row, JSON.stringify(row)])
        );
      }
      await authorize(tx);
      return readOpeningJob(tx, jobId, control);
    }, { isolationLevel: "READ COMMITTED", signal });
  }

  async confirm(command, proof, { signal }) {
    const guard = consumeInventoryHighRiskContext(proof, command);
    const operations = new InventoryOperationService({ database: this.database });
    const audit = new InventoryAuditService({ database: this.database, logger: this.logger, time: this.time });
    const { jobId, expectedVersion, reason } = command.payload;
    return this.database.withTransaction(async tx => {
      await guard.check(tx);
      const control = await openingControl(tx, { lock: true });
      const [[job]] = await tx.query("SELECT * FROM inventory_opening_jobs WHERE id=? FOR UPDATE", [jobId]);
      if (!job) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
      const actor = await guard.check(tx);
      const now = this.time.nowMs();
      const claim = await operations.claim(tx, {
        commandType: "OPENING_POST", source: command.source,
        payload: { ...command.payload, actorId: actor.id },
        actorUserId: actor.id, actorLabel: actor.username, requestId: command.correlationId,
        correlationId: command.correlationId, createdAt: now
      });
      if (claim.replay) {
        if (job.status !== "COMPLETED" || Number(job.confirm_operation_id) !== claim.operationId ||
            claim.replay.resultType !== "OPENING" || claim.replay.resultId !== String(jobId)) {
          throw inventoryError("INVENTORY_SOURCE_CONFLICT");
        }
        await guard.check(tx, { locking: true });
        return readOpeningJob(tx, jobId, control);
      }
      assertOpeningAllowed(control);
      if (job.status !== "READY") throw inventoryError("OPENING_STATE_CONFLICT");
      if (Number(job.version) !== expectedVersion) throw inventoryError("VERSION_CONFLICT");
      const [stored] = await tx.query(
        "SELECT csv_row_number, normalized_input, movement_id FROM inventory_opening_rows WHERE job_id=? ORDER BY csv_row_number FOR UPDATE", [jobId]
      );
      const rows = stored.map(entry => json(entry.normalized_input));
      if (!rows.length || rows.length !== Number(job.ready_rows) ||
          stored.some((entry, i) => entry.movement_id !== null || rows[i].row !== Number(entry.csv_row_number)) ||
          openingSnapshotHash(rows) !== job.precheck_snapshot_hash) {
        throw inventoryError("OPENING_PRECHECK_STALE");
      }
      const day = this.time.fileDate();
      const movementGroupId = await applyInventoryOpeningRows(tx, rows, {
        jobId, claim, actor, reason, day, now, guard, locks: new InventoryLockService(),
        lookup: new ItemLookupService({ database: tx, time: this.time, logger: this.logger })
      });

      const [completed] = await tx.execute(
        `UPDATE inventory_opening_jobs SET status='COMPLETED', confirm_operation_id=?, completed_at=?, version=version+1
          WHERE id=? AND status='READY' AND version=?`, [claim.operationId, now, jobId, expectedVersion]
      );
      if (completed.affectedRows !== 1) throw inventoryError("VERSION_CONFLICT");
      const [changed] = await tx.execute("UPDATE inventory_control SET version=version+1 WHERE id=1 AND version=?", [control.version]);
      if (changed.affectedRows !== 1) throw inventoryError("VERSION_CONFLICT");
      await audit.recordSucceeded(tx, {
        actorUserId: actor.id, actorLabel: actor.username, action: "opening.post", targetType: "opening",
        targetId: jobId, targetLabel: String(jobId), reasonText: reason, requestId: command.correlationId,
        correlationId: command.correlationId, operationRequestId: claim.operationId,
        afterSummary: { openingJobId: jobId, rowCount: rows.length, movementGroupId, ...guard.audit }
      });
      await operations.complete(tx, {
        operationId: claim.operationId, resultType: "OPENING", resultId: String(jobId),
        resultSummary: { id: jobId, status: "COMPLETED", rowCount: rows.length, movementGroupId, operationId: claim.operationId },
        completedAt: now
      });
      await guard.check(tx, { locking: true });
      if (this.time.fileDate() !== day) throw inventoryError("CONCURRENT_OPERATION");
      return readOpeningJob(tx, jobId, { ...control, version: control.version + 1 });
    }, { isolationLevel: "READ COMMITTED", signal }).catch(error => {
      if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error?.cause?.code ?? error?.code)) {
        throw inventoryError("CONCURRENT_OPERATION");
      }
      throw error;
    });
  }

  async get(jobId, { authorize, signal }) {
    return this.database.withTransaction(async tx => {
      await authorize(tx);
      const result = await readOpeningJob(tx, jobId, await openingControl(tx));
      await authorize(tx);
      return result;
    }, { isolationLevel: "READ COMMITTED", signal });
  }

  async getControl({ authorize, signal }) {
    return this.database.withTransaction(async tx => {
      await authorize(tx);
      return openingControl(tx);
    }, { isolationLevel: "READ COMMITTED", signal });
  }

  async goLive(command, proof, { signal }) {
    const guard = consumeInventoryHighRiskContext(proof, command);
    const operations = new InventoryOperationService({ database: this.database });
    const audit = new InventoryAuditService({ database: this.database, logger: this.logger, time: this.time });
    const { expectedVersion, reason } = command.payload;
    return this.database.withTransaction(async tx => {
      await guard.check(tx);
      const control = await openingControl(tx, { lock: true });
      const actor = await guard.check(tx);
      const now = this.time.nowMs();
      const claim = await operations.claim(tx, {
        commandType: "INVENTORY_GO_LIVE", source: command.source,
        payload: { expectedVersion, reason, actorId: actor.id },
        actorUserId: actor.id, actorLabel: actor.username, requestId: command.correlationId,
        correlationId: command.correlationId, createdAt: now
      });
      if (claim.replay) {
        if (control.status !== "LIVE" || claim.replay.resultType !== "INVENTORY_CONTROL" || claim.replay.resultId !== "1") {
          throw inventoryError("INVENTORY_SOURCE_CONFLICT");
        }
        await guard.check(tx, { locking: true });
        return claim.replay.resultSummary;
      }
      assertOpeningAllowed(control);
      if (control.version !== expectedVersion) throw inventoryError("VERSION_CONFLICT");
      const [changed] = await tx.execute(`
        UPDATE inventory_control
           SET lifecycle_status='LIVE', go_live_at=?, go_live_by=?, go_live_reason=?, version=version+1
         WHERE id=1 AND lifecycle_status='PRE_GO_LIVE' AND version=?`, [now, actor.id, reason, expectedVersion]);
      if (changed.affectedRows !== 1) throw inventoryError("VERSION_CONFLICT");
      const result = { status: "LIVE", version: control.version + 1, operationId: claim.operationId, postedAt: now };
      await audit.recordSucceeded(tx, {
        actorUserId: actor.id, actorLabel: actor.username, action: "inventory.go_live", targetType: "inventory_control",
        targetId: 1, targetLabel: "Inventory", reasonText: reason, requestId: command.correlationId,
        correlationId: command.correlationId, operationRequestId: claim.operationId,
        beforeSummary: control, afterSummary: { status: "LIVE", version: result.version, ...guard.audit }
      });
      await operations.complete(tx, {
        operationId: claim.operationId, resultType: "INVENTORY_CONTROL", resultId: "1",
        resultSummary: result, completedAt: now
      });
      await guard.check(tx, { locking: true });
      return result;
    }, { isolationLevel: "READ COMMITTED", signal }).catch(error => {
      if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error?.cause?.code ?? error?.code)) {
        throw inventoryError("CONCURRENT_OPERATION");
      }
      throw error;
    });
  }
}

async function readOpeningJob(tx, jobId, control) {
  const [[job]] = await tx.query(
    `SELECT id, status, version, source_file_hash, ready_rows, diagnostics, completed_at, confirm_operation_id
       FROM inventory_opening_jobs WHERE id = ?`,
    [id(jobId)]
  );
  if (!job) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
  const { errors, skippedRows } = json(job.diagnostics);
  return {
    id: id(job.id), status: job.status, version: Number(job.version), control,
    sourceFileHash: job.source_file_hash, readyRows: Number(job.ready_rows), errors, skippedRows,
    completedAt: job.completed_at === null ? null : Number(job.completed_at),
    operationId: job.confirm_operation_id === null ? null : id(job.confirm_operation_id)
  };
}
