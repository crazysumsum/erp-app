// Kind keeps a quotation and an order with the same numeric ID distinct.
const documents = `
  SELECT 'quotation' AS kind, id FROM sales_quotations WHERE customer_id = ?
  UNION ALL SELECT 'order', id FROM sales_orders WHERE customer_id = ?`;

const unknown = Object.freeze({ status: "UNKNOWN", referenceCount: null, watermark: null });

function nonnegativeInteger(value) {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid Sales aggregate");
  return value;
}

export class SalesCustomerReferenceProvider {
  id = "sales";
  contract = "sales-customer-references/v1";

  constructor({ database }) {
    this.database = database;
  }

  async inspectReadiness() {
    // Draft customer replacement history and archive coverage remain incomplete.
    return { status: "NOT_READY" };
  }

  async checkCustomerReferences(customerId) {
    if (!Number.isSafeInteger(customerId) || customerId < 1) throw new TypeError("Invalid customerId");
    try {
      const [rows] = await this.database.query(
        `SELECT COUNT(*) AS reference_count, COALESCE(MAX(copies), 0) AS max_copies
           FROM (SELECT kind, id, COUNT(*) AS copies
                   FROM (${documents}) AS sources GROUP BY kind, id) AS logical_documents`,
        [customerId, customerId]
      );
      if (!Array.isArray(rows) || rows.length !== 1) return unknown;
      const referenceCount = nonnegativeInteger(rows[0].reference_count);
      const maxCopies = nonnegativeInteger(rows[0].max_copies);
      if (referenceCount === 0 || maxCopies !== 1) return unknown;

      // A partial live observation, never a change fingerprint or write authority.
      return { status: "REFERENCE", referenceCount, watermark: `sales-live:v1:${referenceCount}` };
    } catch {
      return unknown;
    }
  }
}
