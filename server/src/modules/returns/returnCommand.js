import { createHash } from "node:crypto";
import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { returnError } from "./returnErrors.js";
import { RETURN_STOCK_STATUSES } from "./returnTypes.js";

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
export const MAX_RETURN_LINES = 100;

function invalid(field) {
  return returnError("RETURN_INPUT_INVALID", { field });
}

function object(value, fields, field) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))) {
    throw invalid(field);
  }
  return value;
}

function positiveIntegerString(value, field) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw invalid(field);
  }
  return value;
}

export function normalizeReturnDraft(input, kind) {
  object(input, ["eventId", "sourceId", "returnDate", "reason", "lines"], "body");
  const { returnDate } = input;
  const timestamp = typeof returnDate === "string" && DATE.test(returnDate) ? Date.parse(returnDate) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== returnDate) throw invalid("returnDate");
  if (typeof input.reason !== "string" || !input.reason.isWellFormed()) throw invalid("reason");
  const reason = input.reason.trim();
  const characters = [...reason];
  if (characters.length < 1 || characters.length > 500) throw invalid("reason");
  for (const character of characters) {
    const code = character.codePointAt(0);
    const whitespace = code === 9 || code === 10 || code === 13;
    if ((code < 32 && !whitespace) || code === 127) throw invalid("reason");
  }
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_RETURN_LINES) throw invalid("lines");
  const lines = input.lines.map((line, index) => {
    const field = `lines.${index}`;
    const fields = ["sourceDetailId", "baseQuantity", "binId"];
    if (kind === "supplier") fields.push("stockStatus");
    object(line, fields, field);
    const normalized = {
      sourceDetailId: positiveIntegerString(line.sourceDetailId, `${field}.sourceDetailId`),
      baseQuantity: positiveIntegerString(line.baseQuantity, `${field}.baseQuantity`),
      binId: positiveIntegerString(line.binId, `${field}.binId`)
    };
    if (kind === "supplier") {
      if (!RETURN_STOCK_STATUSES.includes(line.stockStatus)) throw invalid(`${field}.stockStatus`);
      normalized.stockStatus = line.stockStatus;
    }
    return normalized;
  });
  return { sourceId: positiveIntegerString(input.sourceId, "sourceId"), returnDate, reason, lines };
}

export function normalizeReturnAction(input) {
  object(input, ["eventId", "version"], "body");
  if (!Number.isInteger(input.version) || input.version < 1 || input.version >= 4294967295) throw invalid("version");
  return { version: input.version };
}

export async function runReturnCommand({ database, time, type, claims, command, targetId = "0", eventId, payload }, work) {
  if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) throw invalid("eventId");
  const hash = createHash("sha256").update(JSON.stringify({ command, type: type.code, targetId, payload })).digest("hex");
  const nowMs = time.nowMs();
  const actorId = Number(claims?.sub);
  if (!Number.isSafeInteger(actorId) || actorId < 1) throw permissionStaleError();

  try {
    return await database.withTransaction(async tx => {
      const actor = await assertActorFresh(tx, { actorId, claimedRoles: claims.roles, claimedPermissions: claims.permissions });
      if (!actor.permissions.includes(type.permission)) throw permissionStaleError();
      let operationId;
      try {
        const [created] = await tx.execute(
          `INSERT INTO returns_operation_requests
             (event_id, command_type, target_type, target_id, request_hash, actor_user_id, actor_label, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [eventId, command, type.code, targetId, hash, actor.id, actor.username, nowMs]
        );
        operationId = created.insertId;
      } catch (error) {
        if ((error.cause?.code ?? error.code) !== "ER_DUP_ENTRY") throw error;
        const [[prior]] = await tx.query(
          `SELECT request_hash, actor_user_id, result_summary, completed_at
             FROM returns_operation_requests WHERE event_id = ? FOR UPDATE`, [eventId]);
        if (!prior || prior.request_hash !== hash || String(prior.actor_user_id) !== String(actor.id) ||
            prior.completed_at === null || prior.result_summary === null) throw returnError("RETURN_EVENT_CONFLICT");
        const replay = typeof prior.result_summary === "string" ? JSON.parse(prior.result_summary) : prior.result_summary;
        return { ...replay, replayed: true };
      }
      const result = await work(tx, { actor, nowMs });
      await tx.execute(
        "UPDATE returns_operation_requests SET result_summary = ?, completed_at = ? WHERE id = ?",
        [JSON.stringify(result), nowMs, operationId]
      );
      return { ...result, replayed: false };
    }, { isolationLevel: "REPEATABLE READ" });
  } catch (error) {
    if (error.code === "DATABASE_TRANSACTION_INDETERMINATE") throw returnError("TRANSACTION_OUTCOME_UNKNOWN");
    if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.cause?.code ?? error.code)) throw returnError("CONCURRENT_OPERATION");
    throw error;
  }
}
