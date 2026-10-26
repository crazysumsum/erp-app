import { createHash } from "node:crypto";
import { inventoryOperationHash } from "./InventoryOperationService.js";
import { inventoryError } from "./inventoryErrors.js";
import { parseInventorySummary } from "./inventorySafeJson.js";
import { purchaseReceiptBusinessPayload, purchaseReversalBusinessPayload, purchaseSourceId } from "./inventoryPurchaseValidation.js";

const ROOT = "PURCHASE_RECEIPT_BATCH", MEMBER = "PURCHASE_RECEIPT_LINE";
const ROOT_FIELDS = new Set(["status", "operationId", "rowCount", "membershipDigest"]);
const MEMBER_FIELDS = new Set(["status", "sourceLineId", "operationId", "movementId", "movementGroupId", "baseQuantity",
  "rootOperationId", "skuId", "trackingPolicy", "baseUomId", "baseUomCode"]);
const REVERSE_FIELDS = new Set(["status", "sourceLineId", "operationId", "movementId", "movementGroupId", "baseQuantity",
  "rootOperationId", "originalMovementId"]);
const CONTRACTS = Object.freeze({
  GOODS_RECEIPT: { root: ROOT, member: MEMBER, fields: MEMBER_FIELDS, payload: purchaseReceiptBusinessPayload },
  GOODS_RECEIPT_REVERSAL: { root: "PURCHASE_REVERSE_BATCH", member: "PURCHASE_REVERSE_LINE", fields: REVERSE_FIELDS,
    payload: purchaseReversalBusinessPayload }
});
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

export function claimPurchaseReceipt(tx, input) { return claimPurchaseBatch(tx, input, "GOODS_RECEIPT"); }
export function claimPurchaseReversal(tx, input) { return claimPurchaseBatch(tx, input, "GOODS_RECEIPT_REVERSAL"); }

async function claimPurchaseBatch(tx, { command, actorLabel, requestId, timestamp, operations }, documentType) {
  const contract = CONTRACTS[documentType];
  const source = { module: "PURCHASING_RECEIVING", documentType, ...command.source, lineId: "" };
  const input = (commandType, lineId, payload) => ({ commandType, source: { ...source, lineId }, payload,
    actorUserId: command.actor.userId, actorLabel, requestId, correlationId: command.correlationId, createdAt: timestamp });
  const payload = contract.payload(command), rootInput = input(contract.root, "", payload);
  const requestHash = inventoryOperationHash(rootInput), root = await operations.claim(tx, rootInput);
  const batch = { operationId: positive(root.operationId), requestHash, source, members: [], replay: Boolean(root.replay),
    timestamp, operations };
  for (const line of payload.lines) {
    const memberInput = input(contract.member, line.sourceLineId, { rootRequestHash: requestHash, line });
    const member = await operations.claim(tx, memberInput);
    if (Boolean(member.replay) !== batch.replay) conflict();
    batch.members.push({ line, sourceLineId: line.sourceLineId, operationId: positive(member.operationId),
      requestHash: inventoryOperationHash(memberInput) });
  }
  return batch;
}

function lineResult(value, member, reversal = false) {
  const allowed = ["sourceLineId", "operationId", "movementId", "movementGroupId", "baseQuantity", ...(reversal ? ["originalMovementId"] : [])];
  if (!value || Object.keys(value).some(key => !allowed.includes(key)) ||
      value.sourceLineId !== member.sourceLineId || value.operationId !== member.operationId ||
      value.baseQuantity !== member.line.baseQuantity || typeof value.movementGroupId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value.movementGroupId)) conflict();
  scalarPositive(value.movementId); scalarPositive(value.baseQuantity); scalarPositive(value.operationId);
  if (reversal) {
    scalarPositive(value.originalMovementId);
    if (value.originalMovementId !== member.line.originalMovementId || value.originalMovementId === value.movementId) conflict();
  }
  return value;
}

export function completePurchaseReceipt(tx, batch, results) { return completePurchaseBatch(tx, batch, results, "GOODS_RECEIPT"); }
export function completePurchaseReversal(tx, batch, results) { return completePurchaseBatch(tx, batch, results, "GOODS_RECEIPT_REVERSAL"); }

async function completePurchaseBatch(tx, batch, results, documentType) {
  const contract = CONTRACTS[documentType], reversal = documentType === "GOODS_RECEIPT_REVERSAL";
  if (batch.replay || !Array.isArray(results) || results.length !== batch.members.length ||
      new Set(results.map(r => r.sourceLineId)).size !== results.length || batch.source.documentType !== documentType) conflict();
  const entries = batch.members.map(member => ({ member,
    result: lineResult(results.find(r => r.sourceLineId === member.sourceLineId), member, reversal) }));
  for (const { member, result } of entries) {
    const snapshot = member.line.commitment;
    await batch.operations.complete(tx, { operationId: member.operationId, resultType: contract.member, resultId: member.sourceLineId,
      resultSummary: { status: "POSTED", ...result, rootOperationId: batch.operationId, ...(reversal ? {} : { skuId: member.line.skuId,
        trackingPolicy: snapshot.trackingPolicySnapshot, baseUomId: snapshot.baseUomIdSnapshot, baseUomCode: snapshot.baseUomCodeSnapshot }) },
      completedAt: batch.timestamp });
  }
  await batch.operations.complete(tx, { operationId: batch.operationId, resultType: contract.root, resultId: batch.source.documentId,
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
      !Object.hasOwn(CONTRACTS, query.documentType) || typeof query.eventId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(query.eventId)) {
    throw inventoryError("INVENTORY_INPUT_INVALID");
  }
  const contract = CONTRACTS[query.documentType], reversal = query.documentType === "GOODS_RECEIPT_REVERSAL";
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
  const root = roots[0], rootSummary = summary(root, ROOT_FIELDS, contract.root, query.documentId);
  const members = rows.filter(r => r !== root).map(row => {
    try { purchaseSourceId(row.source_line_id, "sourceLineId"); } catch { conflict(); }
    const value = summary(row, contract.fields, contract.member, row.source_line_id);
    if (value.rootOperationId !== positive(root.id) || value.sourceLineId !== row.source_line_id) conflict();
    scalarPositive(value.baseQuantity);
    if (!reversal) {
      if (!["none", "batch", "batch_expiry"].includes(value.trackingPolicy) ||
          typeof value.baseUomCode !== "string" || !value.baseUomCode) conflict();
      scalarPositive(value.skuId); scalarPositive(value.baseUomId);
    }
    if (expectedBatch) {
      const expected = expectedBatch.members.find(m => m.sourceLineId === row.source_line_id)?.line;
      if (!expected || value.baseQuantity !== expected.baseQuantity || (reversal ? value.originalMovementId !== expected.originalMovementId :
        value.skuId !== expected.skuId ||
          value.trackingPolicy !== expected.commitment.trackingPolicySnapshot ||
          value.baseUomId !== expected.commitment.baseUomIdSnapshot || value.baseUomCode !== expected.commitment.baseUomCodeSnapshot)) conflict();
    }
    const result = { sourceLineId: value.sourceLineId, operationId: value.operationId, movementId: value.movementId,
      movementGroupId: value.movementGroupId, baseQuantity: value.baseQuantity, ...(reversal ? { originalMovementId: value.originalMovementId } : {}) };
    lineResult(result, { sourceLineId: row.source_line_id, operationId: positive(row.id),
      line: { baseQuantity: value.baseQuantity, ...(reversal ? { originalMovementId: value.originalMovementId } : {}) } }, reversal);
    return { sourceLineId: row.source_line_id, operationId: positive(row.id), requestHash: row.request_hash, result };
  });
  if (rootSummary.rowCount !== members.length || new Set(members.map(m => m.sourceLineId)).size !== members.length ||
      rootSummary.membershipDigest !== digest(members)) conflict();
  if (expectedBatch && (positive(root.id) !== expectedBatch.operationId || root.request_hash !== expectedBatch.requestHash ||
      rootSummary.membershipDigest !== digest(expectedBatch.members))) conflict();
  return { status: "COMPLETED", result: { status: "POSTED", operationId: positive(root.id),
    lines: sortMembers(members).map(m => m.result) } };
}
