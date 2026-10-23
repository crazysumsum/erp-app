import { createHash } from "node:crypto";
import { inventoryOperationHash } from "./InventoryOperationService.js";
import { inventoryError } from "./inventoryErrors.js";
import { parseInventorySummary } from "./inventorySafeJson.js";
import { purchaseReceiptBusinessPayload, purchaseSourceId } from "./inventoryPurchaseValidation.js";

const ROOT = "PURCHASE_RECEIPT_BATCH", MEMBER = "PURCHASE_RECEIPT_LINE";
const ROOT_FIELDS = new Set(["status", "operationId", "rowCount", "membershipDigest"]);
const MEMBER_FIELDS = new Set(["status", "sourceLineId", "operationId", "movementId", "movementGroupId", "baseQuantity",
  "rootOperationId", "skuId", "trackingPolicy", "baseUomId", "baseUomCode"]);
const conflict = () => { throw inventoryError("INVENTORY_SOURCE_CONFLICT"); };
const sortMembers = members => [...members].sort((a, b) => Number(a.sourceLineId) - Number(b.sourceLineId));

function positive(value) {
  const number = typeof value === "string" && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number <= 0) conflict();
  return number;
}

function scalarPositive(value) {
  if (!Number.isSafeInteger(value) || value <= 0) conflict();
  return value;
}

function digest(members) {
  const tuples = sortMembers(members).map(m => [m.sourceLineId, positive(m.operationId), m.requestHash]);
  return createHash("sha256").update(JSON.stringify(tuples), "utf8").digest("hex");
}

export async function claimPurchaseReceipt(tx, { command, actorLabel, requestId, timestamp, operations }) {
  const source = { module: "PURCHASING_RECEIVING", documentType: "GOODS_RECEIPT", ...command.source, lineId: "" };
  const input = (commandType, lineId, payload) => ({ commandType, source: { ...source, lineId }, payload,
    actorUserId: command.actor.userId, actorLabel, requestId, correlationId: command.correlationId, createdAt: timestamp });
  const payload = purchaseReceiptBusinessPayload(command), rootInput = input(ROOT, "", payload);
  const requestHash = inventoryOperationHash(rootInput), root = await operations.claim(tx, rootInput);
  const batch = { operationId: positive(root.operationId), requestHash, source, members: [], replay: Boolean(root.replay),
    timestamp, operations };
  for (const line of payload.lines) {
    const memberInput = input(MEMBER, line.sourceLineId, { rootRequestHash: requestHash, line });
    const member = await operations.claim(tx, memberInput);
    if (Boolean(member.replay) !== batch.replay) conflict();
    batch.members.push({ line, sourceLineId: line.sourceLineId, operationId: positive(member.operationId),
      requestHash: inventoryOperationHash(memberInput) });
  }
  return batch;
}

function lineResult(value, member) {
  if (!value || Object.keys(value).some(key => !["sourceLineId", "operationId", "movementId", "movementGroupId", "baseQuantity"].includes(key)) ||
      value.sourceLineId !== member.sourceLineId || value.operationId !== member.operationId ||
      value.baseQuantity !== member.line.baseQuantity || typeof value.movementGroupId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value.movementGroupId)) conflict();
  scalarPositive(value.movementId); scalarPositive(value.baseQuantity); scalarPositive(value.operationId);
  return value;
}

export async function completePurchaseReceipt(tx, batch, results) {
  if (batch.replay || !Array.isArray(results) || results.length !== batch.members.length ||
      new Set(results.map(r => r.sourceLineId)).size !== results.length) conflict();
  const entries = batch.members.map(member => ({ member,
    result: lineResult(results.find(r => r.sourceLineId === member.sourceLineId), member) }));
  for (const { member, result } of entries) {
    const snapshot = member.line.commitment;
    await batch.operations.complete(tx, { operationId: member.operationId, resultType: MEMBER, resultId: member.sourceLineId,
      resultSummary: { status: "POSTED", ...result, rootOperationId: batch.operationId, skuId: member.line.skuId,
        trackingPolicy: snapshot.trackingPolicySnapshot, baseUomId: snapshot.baseUomIdSnapshot, baseUomCode: snapshot.baseUomCodeSnapshot },
      completedAt: batch.timestamp });
  }
  await batch.operations.complete(tx, { operationId: batch.operationId, resultType: ROOT, resultId: batch.source.documentId,
    resultSummary: { status: "POSTED", operationId: batch.operationId, rowCount: batch.members.length,
      membershipDigest: digest(batch.members) }, completedAt: batch.timestamp });
}

function summary(row, fields, type, id) {
  if (row.command_type !== type || row.result_type !== type || row.result_id !== id ||
      row.completed_at == null || !Number.isSafeInteger(Number(row.completed_at)) || Number(row.completed_at) < 0 ||
      typeof row.request_hash !== "string" || !/^[0-9a-f]{64}$/u.test(row.request_hash)) conflict();
  let value;
  try { value = parseInventorySummary(row.result_summary, fields, "Purchase receipt"); } catch { conflict(); }
  if (!value || value.status !== "POSTED" || value.operationId !== positive(row.id) ||
      Object.keys(value).length !== fields.size) conflict();
  return value;
}

export async function readPurchaseReceipt(tx, query, { locking = false, expectedBatch = null } = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query) ||
      Object.keys(query).some(k => !["documentType", "documentId", "eventId"].includes(k)) ||
      query.documentType !== "GOODS_RECEIPT" || typeof query.eventId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(query.eventId)) {
    throw inventoryError("INVENTORY_INPUT_INVALID");
  }
  purchaseSourceId(query.documentId, "documentId");
  const [rows] = await tx.query(`SELECT * FROM inventory_operation_requests
    WHERE source_module = 'PURCHASING_RECEIVING' AND source_document_type = ? AND source_document_id = ?
      AND source_event_id = ? ORDER BY id LIMIT 202${locking ? " FOR SHARE" : ""}`,
  [query.documentType, query.documentId, query.eventId]);
  if (rows.length === 0) {
    if (expectedBatch) conflict();
    return { status: "NOT_FOUND" };
  }
  if (rows.length < 2 || rows.length > 201 || new Set(rows.map(r => positive(r.id))).size !== rows.length ||
      rows.some(r => r.source_module !== "PURCHASING_RECEIVING" || r.source_document_type !== query.documentType ||
        r.source_document_id !== query.documentId || r.source_event_id !== query.eventId)) conflict();
  const roots = rows.filter(r => r.source_line_id === "");
  if (roots.length !== 1) conflict();
  const root = roots[0], rootSummary = summary(root, ROOT_FIELDS, ROOT, query.documentId);
  const members = rows.filter(r => r !== root).map(row => {
    try { purchaseSourceId(row.source_line_id, "sourceLineId"); } catch { conflict(); }
    const value = summary(row, MEMBER_FIELDS, MEMBER, row.source_line_id);
    if (value.rootOperationId !== positive(root.id) || value.sourceLineId !== row.source_line_id ||
        !["none", "batch", "batch_expiry"].includes(value.trackingPolicy) ||
        typeof value.baseUomCode !== "string" || !value.baseUomCode) conflict();
    scalarPositive(value.skuId); scalarPositive(value.baseUomId); scalarPositive(value.baseQuantity);
    if (expectedBatch) {
      const expected = expectedBatch.members.find(m => m.sourceLineId === row.source_line_id)?.line;
      if (!expected || value.baseQuantity !== expected.baseQuantity || value.skuId !== expected.skuId ||
          value.trackingPolicy !== expected.commitment.trackingPolicySnapshot ||
          value.baseUomId !== expected.commitment.baseUomIdSnapshot || value.baseUomCode !== expected.commitment.baseUomCodeSnapshot) conflict();
    }
    const result = { sourceLineId: value.sourceLineId, operationId: value.operationId, movementId: value.movementId,
      movementGroupId: value.movementGroupId, baseQuantity: value.baseQuantity };
    lineResult(result, { sourceLineId: row.source_line_id, operationId: positive(row.id), line: { baseQuantity: value.baseQuantity } });
    return { sourceLineId: row.source_line_id, operationId: positive(row.id), requestHash: row.request_hash, result };
  });
  if (rootSummary.rowCount !== members.length || new Set(members.map(m => m.sourceLineId)).size !== members.length ||
      rootSummary.membershipDigest !== digest(members)) conflict();
  if (expectedBatch && (positive(root.id) !== expectedBatch.operationId || root.request_hash !== expectedBatch.requestHash ||
      rootSummary.membershipDigest !== digest(expectedBatch.members))) conflict();
  return { status: "COMPLETED", result: { status: "POSTED", operationId: positive(root.id),
    lines: sortMembers(members).map(m => m.result) } };
}
