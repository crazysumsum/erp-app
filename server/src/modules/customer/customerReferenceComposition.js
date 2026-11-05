import { CustomerReferenceService } from "../../services/customer/CustomerReferenceService.js";
import { FulfillmentCustomerReferenceProvider } from "../fulfillment/FulfillmentCustomerReferenceProvider.js";

const requiredProviders = [
  { id: "sales", contract: "sales-customer-references/v1" },
  { id: "fulfillment", contract: "fulfillment-customer-references/v1" },
  { id: "returns", contract: "returns-customer-references/v1" },
  { id: "receivables", contract: "ar-customer-references/v1" },
  { id: "payment-refund", contract: "payment-refund-customer-references/v1" }
];

// Opt-in factory for the existing singleton; missing owners remain required.
export async function createCustomerReferenceService({ services, options = {} }) {
  const database = await services.resolve("mysqldatabase");
  return new CustomerReferenceService({
    options: {
      timeoutMs: options.timeoutMs,
      requiredProviders,
      providers: [new FulfillmentCustomerReferenceProvider({ database })]
    }
  });
}
