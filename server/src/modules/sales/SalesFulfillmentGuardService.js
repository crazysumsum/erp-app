import { salesError } from "./salesErrors.js";

export class SalesFulfillmentGuardService {
  constructor({ services } = {}) { this.services = services; }
  async assertAllowed(tx, command) {
    try {
      if (typeof this.services?.names !== "function" || typeof this.services.resolve !== "function") throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
      const names = this.services.names();
      if (!Array.isArray(names) || names.some(name => typeof name !== "string")) throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
      if (names.includes("fulfillmentOpenMatter")) {
        const provider = await this.services.resolve("fulfillmentOpenMatter");
        if (typeof provider?.assertSalesLifecycleAllowedInTransaction !== "function") throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
        const result = await provider.assertSalesLifecycleAllowedInTransaction(tx, command);
        if (result?.status === "OPEN") throw salesError("OPEN_FULFILLMENT_EXISTS");
        if (result !== undefined && result?.status !== "CLOSED") throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
        return "ALLOWED";
      }
      // DEC021 UNINSTALLED_FULFILLMENT_V1: current facts, never a cached or synthetic CLOSED.
      const [[tables]] = await tx.query(`SELECT COUNT(*) AS owned_count FROM information_schema.tables WHERE table_schema=DATABASE()
        AND (LOWER(TABLE_NAME) IN ('fulfillments','shipments') OR LEFT(LOWER(TABLE_NAME),12)='fulfillment_' OR LEFT(LOWER(TABLE_NAME),13)='fulfillments_' OR LEFT(LOWER(TABLE_NAME),9)='shipment_' OR LEFT(LOWER(TABLE_NAME),10)='shipments_')`);
      const [history] = await tx.query("SELECT name FROM fr_schema_migrations WHERE LOWER(name) REGEXP ? LIMIT 1 LOCK IN SHARE MODE",["(^|[/_])(fulfillment|fulfillments|shipment|shipments)(_|[.])"]);
      if (!Number.isSafeInteger(Number(tables?.owned_count)) || Number(tables.owned_count) !== 0 || history.length) throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
      return "NOT_REQUIRED";
    } catch (error) {
      if (error.code === "OPEN_FULFILLMENT_EXISTS") throw error;
      throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    }
  }
}
