import { CustomerReferenceProviderRegistry } from "../../modules/customer/CustomerReferenceProviderRegistry.js";

// Startup observations and destructive commands use this same registry instance.
// Unconfigured providers remain NOT_READY/UNKNOWN; they never block core reads.
export class CustomerReferenceService extends CustomerReferenceProviderRegistry {
  static service = Object.freeze({
    name: "customer.references",
    lifecycle: "singleton",
    dependencies: [],
    eager: true
  });

  constructor({ options = {} } = {}) {
    super(options);
  }
}
