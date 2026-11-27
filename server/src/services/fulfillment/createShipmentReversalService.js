import { findShipmentInvoiceClaimsInTransaction } from "../../modules/ar/findShipmentInvoiceClaimsInTransaction.js";
import { ShipmentReversalService } from "../../modules/fulfillment/ShipmentReversalService.js";
import { InventoryLookupService } from "../../modules/inventory/InventoryLookupService.js";
import { findShipmentReturnsInTransaction } from "../../modules/returns/findShipmentReturnsInTransaction.js";

export function createShipmentReversalService(options) {
  return new ShipmentReversalService({
    ...options,
    downstreamProviders: {
      invoicing: { findShipmentInvoiceClaimsInTransaction },
      returns: { findShipmentReturnsInTransaction }
    },
    issueCostProvider: new InventoryLookupService(options)
  });
}
