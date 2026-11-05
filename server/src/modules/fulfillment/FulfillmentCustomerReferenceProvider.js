// A Fulfillment and a Shipment can have the same numeric ID. Each document
// belongs to exactly one route (live or archived) in a committed snapshot.
const documents = `
  SELECT 'fulfillment' AS kind, id, updated_at FROM fulfillments WHERE customer_id = ?
  UNION ALL SELECT 'fulfillment', id, updated_at FROM fulfillments_archive WHERE customer_id = ?
  UNION ALL SELECT 'shipment', id, updated_at FROM shipments WHERE customer_id = ?
  UNION ALL SELECT 'shipment', id, updated_at FROM shipments_archive WHERE customer_id = ?`;

const unknown = Object.freeze({ status: "UNKNOWN", referenceCount: null, watermark: null });

function nonnegativeInteger(value) {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid Fulfillment aggregate");
  return value;
}

export class FulfillmentCustomerReferenceProvider {
  id = "fulfillment";
  contract = "fulfillment-customer-references/v1";

  constructor({ database }) {
    this.database = database;
  }

  async inspectReadiness() {
    try {
      await this.database.query(`SELECT * FROM (${documents}) AS sources LIMIT 0`, [0, 0, 0, 0]);
      return { status: "READY" };
    } catch {
      return { status: "NOT_READY" };
    }
  }

  async checkCustomerReferences(customerId) {
    if (!Number.isSafeInteger(customerId) || customerId < 1) throw new TypeError("Invalid customerId");
    try {
      const [[row]] = await this.database.query(
        `SELECT COUNT(*) AS reference_count, COALESCE(MAX(copies), 0) AS max_copies,
                COALESCE(MAX(last_updated_at), 0) AS last_updated_at
           FROM (SELECT kind, id, COUNT(*) AS copies, MAX(updated_at) AS last_updated_at
                   FROM (${documents}) AS sources GROUP BY kind, id) AS logical_documents`,
        [customerId, customerId, customerId, customerId]
      );
      const referenceCount = nonnegativeInteger(row.reference_count);
      const maxCopies = nonnegativeInteger(row.max_copies);
      const lastUpdatedAt = nonnegativeInteger(row.last_updated_at);
      if (maxCopies !== (referenceCount > 0 ? 1 : 0)) return unknown;

      // An observation of document use. This watermark never authorizes a write.
      return { status: referenceCount > 0 ? "REFERENCE" : "NO_REFERENCE", referenceCount,
        watermark: `fulfillment:${customerId}:${referenceCount}:${lastUpdatedAt}` };
    } catch {
      return unknown;
    }
  }
}
