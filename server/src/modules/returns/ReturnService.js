import { normalizeReturnAction, normalizeReturnDraft, runReturnCommand } from "./returnCommand.js";
import { returnError } from "./returnErrors.js";
import { assertReturnQuantities } from "./returnQuantities.js";
import { returnSourceId } from "./returnSourceScope.js";
import { assertReturnBins, lockReturnSource, lockReturnSourceDetails, readPostedReturnQuantities } from "./returnSources.js";
import { returnType } from "./returnTypes.js";

function commandResult(type, id, status, version) {
  return { id, returnNumber: `${type.prefix}${id}`, status, version };
}

export class ReturnService {
  constructor({ database, time, postInventory }) {
    Object.assign(this, { database, time, postInventory });
  }

  create({ kind, claims, input }) {
    const type = returnType(kind);
    const payload = normalizeReturnDraft(input, kind);
    return runReturnCommand({ database: this.database, time: this.time, type, claims, command: "CREATE", eventId: input.eventId, payload },
      async (tx, { actor, nowMs }) => {
        const source = await lockReturnSource(tx, kind, payload.sourceId);
        await this.#validateLines(tx, kind, source, payload.lines);
        const party = kind === "customer" ? {
          customer_id: source.customer_id,
          customer_code_snapshot: source.customer_code_snapshot,
          customer_name_snapshot: source.customer_name_snapshot
        } : {
          purchase_order_id: source.purchase_order_id,
          supplier_id: source.supplier_id,
          supplier_code_snapshot: source.supplier_code_snapshot,
          supplier_name_snapshot: source.supplier_name_snapshot
        };
        const [created] = await tx.query(`INSERT INTO ${type.header} SET ?`, {
          [type.source]: payload.sourceId, ...party, return_date: payload.returnDate, reason: payload.reason,
          created_by: actor.id, created_by_label: actor.username, created_at: nowMs, updated_at: nowMs
        });
        const id = returnSourceId(String(created.insertId));
        const hasStatus = kind === "supplier";
        const values = payload.lines.map((line, index) => [
          id, payload.sourceId, index + 1, line.sourceDetailId, line.baseQuantity, line.binId, ...(hasStatus ? [line.stockStatus] : [])
        ]);
        await tx.query(
          `INSERT INTO ${type.lines} (return_id, ${type.source}, line_no, ${type.detail}, base_quantity, bin_id${hasStatus ? ", stock_status" : ""})
           VALUES ?`, [values]);
        return commandResult(type, id, "DRAFT", 1);
      });
  }

  cancel({ kind, id, claims, input }) {
    const type = returnType(kind);
    const targetId = returnSourceId(id);
    const payload = normalizeReturnAction(input);
    return runReturnCommand({ database: this.database, time: this.time, type, claims, command: "CANCEL", targetId, eventId: input.eventId, payload },
      async (tx, { actor, nowMs }) => {
        // Release-only, with no return to a parent lock. Reversal can safely observe a draft and refuse.
        await this.#lockDraft(tx, type, targetId, payload.version);
        const [updated] = await tx.execute(
          `UPDATE ${type.header} SET status = 'CANCELLED', cancelled_by = ?, cancelled_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
          [actor.id, nowMs, nowMs, targetId]);
        if (updated.affectedRows !== 1) throw returnError("CONCURRENT_OPERATION");
        return commandResult(type, targetId, "CANCELLED", payload.version + 1);
      });
  }

  post({ kind, id, claims, input, req }) {
    const type = returnType(kind);
    const targetId = returnSourceId(id);
    const payload = normalizeReturnAction(input);
    return runReturnCommand({ database: this.database, time: this.time, type, claims, command: "POST", targetId, eventId: input.eventId, payload },
      async (tx, { actor, nowMs }) => {
        const [[route]] = await tx.query(`SELECT ${type.source} AS source_id FROM ${type.header} WHERE id = ?`, [targetId]);
        if (!route) throw returnError("RETURN_NOT_FOUND");
        const source = await lockReturnSource(tx, kind, String(route.source_id));
        // Discover source detail IDs before taking the return locks, then revalidate the locked rows.
        const readLines = lock => tx.query(
          `SELECT id, ${type.detail} AS source_detail_id, base_quantity, bin_id, inventory_movement_id
                  ${kind === "supplier" ? ", stock_status" : ""}
             FROM ${type.lines} WHERE return_id = ? ORDER BY line_no${lock ? " FOR UPDATE" : ""}`, [targetId]);
        const projectLine = row => ({
          sourceLineId: String(row.id), sourceDetailId: String(row.source_detail_id), baseQuantity: String(row.base_quantity),
          binId: String(row.bin_id), ...(kind === "supplier" ? { stockStatus: row.stock_status } : {})
        });
        const [unlocked] = await readLines(false);
        if (!unlocked.length) throw returnError("RETURN_SOURCE_CONFLICT");
        const details = await lockReturnSourceDetails(tx, kind, source, unlocked.map(projectLine));
        const draft = await this.#lockDraft(tx, type, targetId, payload.version);
        if (String(draft[type.source]) !== String(source.id)) throw returnError("RETURN_SOURCE_CONFLICT");
        const [locked] = await readLines(true);
        if (locked.length !== unlocked.length || locked.some(row => row.inventory_movement_id !== null)) {
          throw returnError("RETURN_SOURCE_CONFLICT");
        }
        const lines = locked.map(projectLine);
        await this.#validateLines(tx, kind, source, lines, details);

        if (typeof this.postInventory !== "function") throw returnError("RETURN_INVENTORY_UNAVAILABLE");
        const command = {
          actor: { userId: actor.id, claimedRoles: claims.roles, claimedPermissions: claims.permissions },
          source: { documentId: targetId, eventId: input.eventId },
          lines: lines.map(({ sourceLineId, sourceDetailId, baseQuantity, binId, stockStatus }) => ({
            sourceLineId, originalMovementId: String(details.get(sourceDetailId).inventory_movement_id), baseQuantity, binId,
            ...(kind === "supplier" ? { stockStatus } : {})
          }))
        };
        const lockedFacts = lines.map(({ sourceLineId, sourceDetailId }) => {
          const detail = details.get(sourceDetailId);
          return {
            sourceLineId, originalMovementId: String(detail.inventory_movement_id), warehouseId: String(detail.warehouse_id),
            skuId: String(detail.sku_id), lotId: detail.lot_id === null ? null : String(detail.lot_id)
          };
        });
        const result = await this.postInventory(tx, { kind, req, command, lockedFacts });
        if (!Array.isArray(result?.lines) || result.lines.length !== lines.length) throw returnError("RETURN_INVENTORY_UNAVAILABLE");
        const movements = new Map(result.lines.map(row => [String(row.sourceLineId), String(row.movementId)]));
        if (movements.size !== lines.length || new Set(movements.values()).size !== lines.length) throw returnError("RETURN_INVENTORY_UNAVAILABLE");

        for (const { sourceLineId } of lines) {
          const movementId = movements.get(sourceLineId);
          if (!movementId || !/^[1-9][0-9]{0,15}$/u.test(movementId) || !Number.isSafeInteger(Number(movementId))) {
            throw returnError("RETURN_INVENTORY_UNAVAILABLE");
          }
          const [updated] = await tx.execute(`UPDATE ${type.lines} SET inventory_movement_id = ? WHERE id = ?`, [movementId, sourceLineId]);
          if (updated.affectedRows !== 1) throw returnError("CONCURRENT_OPERATION");
        }
        const [updated] = await tx.execute(
          `UPDATE ${type.header} SET status = 'POSTED', posted_event_id = ?, posted_by = ?, posted_by_label = ?,
                  posted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
          [input.eventId, actor.id, actor.username, nowMs, nowMs, targetId]);
        if (updated.affectedRows !== 1) throw returnError("CONCURRENT_OPERATION");
        return commandResult(type, targetId, "POSTED", payload.version + 1);
      });
  }

  async #lockDraft(tx, type, id, version) {
    const [[row]] = await tx.query(`SELECT * FROM ${type.header} WHERE id = ? FOR UPDATE`, [id]);
    if (!row) throw returnError("RETURN_NOT_FOUND");
    if (Number(row.version) !== version) throw returnError("VERSION_CONFLICT", { currentVersion: Number(row.version) });
    if (row.status !== "DRAFT") throw returnError("RETURN_STATE_CONFLICT");
    return row;
  }

  async #validateLines(tx, kind, source, lines, lockedDetails) {
    const details = lockedDetails ?? await lockReturnSourceDetails(tx, kind, source, lines);
    const prior = await readPostedReturnQuantities(tx, kind, String(source.id), [...details.keys()]);
    assertReturnQuantities(lines, details, prior);
    await assertReturnBins(tx, kind, source, details, lines);
  }
}
