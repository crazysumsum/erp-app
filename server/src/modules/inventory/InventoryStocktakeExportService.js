import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { stringify } from "csv-stringify/sync";
import { sanitizeCsvCell } from "../item/csvSafety.js";
import { createStocktakeExportAudit } from "./inventoryStocktakeExportAudit.js";
import { inventoryError } from "./inventoryErrors.js";
import { normalizeInventoryConfig } from "./normalizeInventoryConfig.js";
import { stocktakeLineBatch, stocktakeSummary, stocktakeVarianceStage } from "./InventoryInquiryService.js";
import { MySqlDatabaseService } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { createMySqlDatabasePool } from "../../services/mysqldatabase/connection.js";
import { RequestTimeoutError } from "../../framework/middleware/requestTimeout.js";
import { ServiceContainer } from "../../framework/services/ServiceContainer.js";

const ACTIVE_GENERATIONS = new WeakSet();

const COLUMNS = Object.freeze(["recordType", "stocktakeId", "stocktakeNumber", "status", "cancelled", "varianceStage", "asOf", "workflowVersion",
  "scopeId", "binId", "binCodeSnapshot", "binCodeCurrent", "lineId", "lineVersion", "skuId", "skuCodeCurrent", "skuNameCurrent", "baseUomId", "baseUomCodeCurrent",
  "lotId", "lotNumberCurrent", "stockStatus", "snapshotBalanceId", "snapshotBalanceVersion", "snapshotQuantity", "countState", "actualQuantity", "varianceQuantity", "movementId",
  "filteredLineCount", "scopeCount", "exportedRows", "truncated", "truncationReason", "generationBudgetMs", "filterHash"]);
export function stocktakeCsv(records, header = false) {
  return stringify(records.map(record => Object.fromEntries(COLUMNS.map(field => {
    const value = record[field]; return [field, sanitizeCsvCell(typeof value === "boolean" ? String(value) : value)];
  }))), { header, columns: [...COLUMNS], record_delimiter: "\r\n" });
}
function safeCount(value) {
  const number = Number(value);
  if (value == null || !Number.isSafeInteger(number) || number < 0) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  return number;
}

export class InventoryStocktakeExportService {
  constructor({ database, time, logger, config } = {}) {
    this.database = database; this.time = time; this.logger = logger; this.config = normalizeInventoryConfig(config);
    this.audit = createStocktakeExportAudit({ database, time, logger });
  }

  createGenerationReader(workSignal) {
    const primary = this.database, transports = [], live = new Set();
    let closing = false, closePromise, initialization, database, settled = true, shutdownSettled = false, poolCreated = false;
    const config = { ...primary.config, connectionLimit: 1, queueLimit: 1, stream: options => {
      if (closing || live.size) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const settings = options.config;
      const socket = settings.socketPath ? net.createConnection(settings.socketPath) : net.createConnection(settings.port, settings.host);
      live.add(socket);
      const terminal = new Promise(resolve => { socket.once("close", () => { live.delete(socket); resolve(); }); });
      transports.push({ socket, terminal });
      if (!settings.socketPath) {
        if (settings.enableKeepAlive) socket.on("connect", () => socket.setKeepAlive(true, settings.keepAliveInitialDelay));
        socket.setNoDelay(true);
      }
      return socket;
    } };
    const container = new ServiceContainer({
      definitions: [{ ...MySqlDatabaseService.service, ServiceClass: MySqlDatabaseService }], config: { database: config },
      values: { logging: { logger: primary.logger }, context: {
        get: () => ({ ...primary.context.get(), signal: workSignal }), update: values => primary.context.update(values)
      } }, options: { mysqldatabase: { poolFactory: settings => {
        workSignal.throwIfAborted();
        if (closing || poolCreated) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
        poolCreated = true; return createMySqlDatabasePool(settings);
      } } }
    });
    const destroyTransports = () => { for (const { socket } of transports) socket.destroy(); };
    const abort = () => { closing = true; destroyTransports(); };
    workSignal.addEventListener("abort", abort, { once: true });
    return { get database() { return database; }, get closed() { return closing && settled && shutdownSettled && live.size === 0; },
      initialize: () => initialization ??= (async () => {
        settled = false;
        try {
          workSignal.throwIfAborted();
          if (closing) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
          database = await container.resolve("mysqldatabase");
          workSignal.throwIfAborted();
          if (closing) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
          return database;
        } finally { settled = true; }
      })(), close: () => closePromise ??= (async () => {
      closing = true;
      // Singleton shutdown does not await a pending initializer; keep it owned until it settles.
      if (!settled) destroyTransports();
      await initialization?.catch(() => {});
      const ending = container.shutdown().then(report => report.failures[0]?.error ?? null, error => error);
      // A successful pool.end is not terminal socket closure.
      destroyTransports();
      const [error] = await Promise.all([ending, ...transports.map(({ terminal }) => terminal)]);
      shutdownSettled = true; workSignal.removeEventListener("abort", abort);
      if (error) throw error;
    })() };
  }

  async prepare({ stocktakeId, filters = {}, authorize, deadline, signal, requestId = "", ip = "" }) {
    if (!Number.isSafeInteger(stocktakeId) || stocktakeId <= 0 || typeof authorize !== "function") throw inventoryError("INVENTORY_INPUT_INVALID");
    const deadlineMs = typeof deadline === "string" ? Date.parse(deadline) : NaN;
    if (!Number.isSafeInteger(deadlineMs)) throw inventoryError("INVENTORY_INPUT_INVALID");
    signal?.throwIfAborted();
    let actor, file, directory, fileName, fileIdentity, dirIdentity, cleanupPromise, failurePromise, reader, slot = false, generationTimer, generationAbort;
    let fileUnlinked = false, directoryRemoved = false;
    const sameIdentity = (current, expected) => current.dev === expected.dev && current.ino === expected.ino && !current.isSymbolicLink();
    const cleanup = () => cleanupPromise ??= (async () => {
      try {
        if (!directory || directoryRemoved) return;
        // Acquisition can complete before the next identity check fails or is aborted.
        dirIdentity ??= await fs.lstat(directory);
        if (file && !fileIdentity) fileIdentity = await file.stat();
        const dir = await fs.lstat(directory);
        if (!sameIdentity(dir, dirIdentity) || !dir.isDirectory()) throw new Error("Export directory ownership changed");
        if (fileIdentity && !fileUnlinked) {
          const current = await fs.lstat(fileName);
          if (!sameIdentity(current, fileIdentity) || !current.isFile()) throw new Error("Export file ownership changed");
          await fs.unlink(fileName); fileUnlinked = true;
        }
        await fs.rmdir(directory); directoryRemoved = true;
      } finally {
        // FileHandle.close waits for pending native I/O, even when pathname cleanup refuses.
        await file?.close();
      }
    })();
    const failure = async error => {
      if (!actor) return;
      failurePromise ??= this.audit.recordFailed({ actorUserId: actor.id, actorLabel: actor.username, action: "inventory.export", targetType: "stocktake",
        targetId: stocktakeId, targetLabel: `stocktake:${stocktakeId}`, requestId, correlationId: requestId, ip, errorCode: error.code });
      await failurePromise;
    };
    try {
      actor = await authorize(); signal?.throwIfAborted();
      if (ACTIVE_GENERATIONS.has(this.database)) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      ACTIVE_GENERATIONS.add(this.database); slot = true;
      const started = this.time.nowMs(), remaining = deadlineMs - started;
      if (!Number.isSafeInteger(started) || !Number.isSafeInteger(remaining) || remaining <= 1) throw inventoryError("INVENTORY_INPUT_INVALID");
      const generationBudgetMs = Math.min(this.config.exportTimeoutMs, Math.floor(remaining / 2)), stopAt = started + generationBudgetMs;
      const controller = new AbortController(), timeoutError = new RequestTimeoutError(generationBudgetMs);
      generationAbort = timeoutError;
      const workSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let awaiting = 0, acquiring = false;
      const assertWork = () => {
        signal?.throwIfAborted();
        if (this.time.nowMs() >= stopAt && !controller.signal.aborted) controller.abort(timeoutError);
        controller.signal.throwIfAborted();
      };
      const work = async operation => {
        assertWork(); awaiting++;
        try { const value = await operation(); assertWork(); return value; }
        catch (error) {
          // Map only our causal generation abort, never an independent DB/disk/request failure.
          if (!signal?.aborted && controller.signal.aborted && (error === timeoutError || error?.cause === timeoutError)) throw timeoutError;
          throw error;
        } finally { awaiting--; }
      };
      generationTimer = setTimeout(() => { if (awaiting || acquiring) controller.abort(timeoutError); }, generationBudgetMs);
      const maxRows = Math.min(this.config.exportMaxRows, 100000);
      const owner = typeof process.geteuid === "function" ? process.geteuid() : null;
      if (!Number.isSafeInteger(owner) || owner < 0) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      reader = this.createGenerationReader(workSignal);
      await work(() => reader.initialize());
      const root = await work(() => fs.realpath(os.tmpdir()));
      await work(async () => { directory = await fs.mkdtemp(path.join(root, "inventory-stocktake-export-")); });
      await work(async () => { dirIdentity = await fs.lstat(directory); }); await work(() => fs.chmod(directory, 0o700));
      fileName = path.join(directory, "stocktake.csv");
      await work(async () => { file = await fs.open(fileName, "wx+", 0o600); }); await work(async () => { fileIdentity = await file.stat(); });
      const privateDirectory = stat => sameIdentity(stat, dirIdentity) && stat.isDirectory() && stat.uid === owner && (stat.mode & 0o7777) === 0o700;
      const privateEmptyFile = (stat, links) => sameIdentity(stat, fileIdentity) && stat.isFile() && stat.uid === owner &&
        (stat.mode & 0o7777) === 0o600 && stat.size === 0 && stat.nlink === links;
      const requireAbsent = async name => {
        try { await fs.lstat(name); }
        catch (error) { if (error.code === "ENOENT") return; throw error; }
        throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      };
      const requirePresent = async name => {
        try { return await fs.lstat(name); }
        catch (error) {
          if (error.code === "ENOENT") throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
          throw error;
        }
      };
      const removeName = async (operation, name) => {
        try { await fs[operation](name); }
        catch (error) {
          if (["EPERM", "EACCES", "EBUSY", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "ENOTEMPTY", "EEXIST", "ENOENT"].includes(error.code)) {
            throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
          }
          throw error;
        }
      };
      if (!privateDirectory(await work(() => requirePresent(directory)))) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      const currentFile = await work(() => requirePresent(fileName));
      const descriptor = await work(() => file.stat());
      if (!privateEmptyFile(currentFile, 1) || !privateEmptyFile(descriptor, 1)) {
        throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      }
      // Remove both names before any CSV bytes; generation and delivery retain only this handle.
      await work(async () => { await removeName("unlink", fileName); fileUnlinked = true; });
      if (!privateEmptyFile(await work(() => file.stat()), 0)) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      await work(() => requireAbsent(fileName));
      if (!privateDirectory(await work(() => requirePresent(directory)))) throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
      await work(async () => { await removeName("rmdir", directory); directoryRemoved = true; });
      await work(() => requireAbsent(directory));
      acquiring = true;
      const result = await reader.database.withTransaction(async tx => {
        acquiring = false; assertWork();
        const data = { query: (...args) => work(() => tx.query(...args)) };
        const asOf = this.time.nowMs();
        const [[header]] = await data.query("SELECT * FROM inventory_stocktakes WHERE id = ?", [stocktakeId]);
        if (!header) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
        await stocktakeSummary(data, header);
        const filtered = await stocktakeSummary(data, header, filters);
        const [[count]] = await data.query("SELECT COUNT(*) AS total FROM inventory_stocktake_bins WHERE stocktake_id = ?", [stocktakeId]);
        const scopeCount = safeCount(count.total), total = safeCount(scopeCount + filtered.totalLines);
        const common = { stocktakeId, stocktakeNumber: header.stocktake_number, status: header.status, cancelled: header.status === "CANCELLED",
          varianceStage: stocktakeVarianceStage(header), asOf, workflowVersion: safeCount(header.version) };
        const filterHash = createHash("sha256").update(JSON.stringify({ stocktakeId, filters: Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))) })).digest("hex");
        let exportedRows = 0, confirmedRows = 0, truncationReason = "NONE";
        await work(() => file.writeFile(stocktakeCsv([], true), { signal: workSignal }));
        for (const type of ["SCOPE", "LINE"]) {
          let cursor = 0;
          while (true) {
            signal?.throwIfAborted();
            if (exportedRows === total) break;
            if (this.time.nowMs() >= stopAt && exportedRows < total) { truncationReason = "TIME_LIMIT"; break; }
            if (exportedRows >= maxRows && exportedRows < total) { truncationReason = "ROW_LIMIT"; break; }
            await work(() => authorize({ signal: workSignal }));
            const rows = type === "LINE" ? await stocktakeLineBatch(data, header, filters, cursor, 500) :
              (await data.query(`SELECT scope.*,bin.bin_code FROM inventory_stocktake_bins scope JOIN inventory_bins bin ON bin.id=scope.bin_id
                WHERE scope.stocktake_id=? AND scope.id>? ORDER BY scope.id ASC LIMIT ?`, [stocktakeId, cursor, 500]))[0];
            if (!rows.length) break;
            const records = [];
            for (const row of rows) {
              if (this.time.nowMs() >= stopAt) { truncationReason = "TIME_LIMIT"; exportedRows = confirmedRows; records.length = 0; break; }
              if (exportedRows >= maxRows) { truncationReason = "ROW_LIMIT"; break; }
              cursor = safeCount(row.id); exportedRows++;
              records.push(type === "SCOPE" ? { ...common, recordType: "SCOPE", scopeId: row.id, binId: row.bin_id,
                binCodeSnapshot: row.bin_code_snapshot, binCodeCurrent: row.bin_code } :
                { ...common, recordType: "LINE", scopeId: row.stocktakeBinId, binId: row.binId, binCodeSnapshot: row.binCodeSnapshot,
                  binCodeCurrent: row.binCodeCurrent, lineId: row.id, lineVersion: row.version, skuId: row.skuId, skuCodeCurrent: row.skuCodeCurrent,
                  skuNameCurrent: row.skuNameCurrent, baseUomId: row.baseUom.uomId, baseUomCodeCurrent: row.baseUom.uomCode,
                  lotId: row.lotId, lotNumberCurrent: row.lotNumberCurrent, stockStatus: row.stockStatus, snapshotBalanceId: row.snapshotBalanceId,
                  snapshotBalanceVersion: row.snapshotBalanceVersion, snapshotQuantity: row.snapshotQuantity, countState: row.countState,
                  actualQuantity: row.actualQuantity, varianceQuantity: row.varianceQuantity, movementId: row.movementId });
            }
            if (records.length) { await work(() => file.writeFile(stocktakeCsv(records), { signal: workSignal })); confirmedRows = exportedRows; }
            if (truncationReason !== "NONE") break;
          }
          if (truncationReason !== "NONE") break;
        }
        if (truncationReason === "NONE" && exportedRows !== total) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
        clearTimeout(generationTimer); signal?.throwIfAborted();
        const truncated = truncationReason !== "NONE";
        await file.writeFile(stocktakeCsv([{ ...common, recordType: "SUMMARY", scopeCount, filteredLineCount: filtered.totalLines,
          exportedRows, truncated, truncationReason, generationBudgetMs, filterHash }]), { signal });
        return { ...common, exportedRows, truncated, truncationReason, generationBudgetMs, filterHash };
      }, { isolationLevel: "REPEATABLE READ", signal: workSignal });
      clearTimeout(generationTimer); await reader.close(); ACTIVE_GENERATIONS.delete(this.database); slot = false;
      actor = await authorize(); signal?.throwIfAborted();
      await this.database.withTransaction(tx => this.audit.recordSucceeded(tx, { actorUserId: actor.id, actorLabel: actor.username,
        action: "inventory.export", targetType: "stocktake", targetId: stocktakeId, targetLabel: `stocktake:${stocktakeId}`, reasonCategory: "EXPORT",
        reasonText: `filterHash=${result.filterHash};truncated=${result.truncated};reason=${result.truncationReason};budgetMs=${result.generationBudgetMs}`,
        afterSummary: { stocktakeId, rowCount: result.exportedRows, version: result.workflowVersion, status: result.status }, requestId, correlationId: requestId, ip }));
      const stream = Readable.from((async function* () {
        try {
          let position = 0;
          while (true) {
            signal?.throwIfAborted();
            const buffer = Buffer.alloc(65536), { bytesRead } = await file.read(buffer, 0, buffer.length, position);
            await authorize(); signal?.throwIfAborted();
            if (!bytesRead) break;
            position += bytesRead; yield buffer.subarray(0, bytesRead);
          }
        } finally { await cleanup(); }
      })(), { objectMode: false, highWaterMark: 0 });
      // Destroying before the async generator's first next() does not enter its finally.
      // Complete owned cleanup before Node emits the stream's terminal error/close.
      const destroy = stream._destroy.bind(stream);
      stream._destroy = (error, callback) => destroy(error, iteratorError => {
        // Finish the existing request-bound Audit before pipeline closure aborts its signal.
        cleanup().then(async () => {
          if (error ?? iteratorError) await failure(error ?? iteratorError);
          callback(error ?? iteratorError);
        }, async cleanupError => {
          this.logger.error("inventory.export.cleanup_failed", "Owned export cleanup failed", { requestId, code: cleanupError.code ?? "CLEANUP_FAILED" });
          await failure(error ?? iteratorError ?? cleanupError);
          callback(error ?? iteratorError ?? cleanupError);
        });
      });
      const abort = () => stream.destroy(signal.reason instanceof Error ? signal.reason : new Error("Export aborted"));
      signal?.addEventListener("abort", abort, { once: true });
      stream.once("error", error => { void failure(error); });
      stream.once("close", () => { signal?.removeEventListener("abort", abort); });
      if (signal?.aborted) abort();
      return { stream, fileName: `stocktake-${stocktakeId}-${result.asOf}.csv`, asOf: result.asOf, truncated: result.truncated,
        truncationReason: result.truncationReason, generationBudgetMs: result.generationBudgetMs };
    } catch (error) {
      const primaryError = !signal?.aborted && generationAbort && (error === generationAbort || error?.cause === generationAbort) ? generationAbort : error;
      clearTimeout(generationTimer);
      if (reader && slot) {
        try { await reader.close(); ACTIVE_GENERATIONS.delete(this.database); slot = false; }
        catch (closeError) {
          if (reader.closed) { ACTIVE_GENERATIONS.delete(this.database); slot = false; }
          this.logger.error("inventory.export.reader_cleanup_failed", "Owned export reader cleanup failed", { requestId, code: closeError.code ?? "CLEANUP_FAILED" });
        }
      } else if (slot) { ACTIVE_GENERATIONS.delete(this.database); slot = false; }
      try { await cleanup(); }
      catch (cleanupError) { this.logger.error("inventory.export.cleanup_failed", "Owned export cleanup failed", { requestId, code: cleanupError.code ?? "CLEANUP_FAILED" }); }
      await failure(primaryError); throw primaryError;
    }
  }
}
