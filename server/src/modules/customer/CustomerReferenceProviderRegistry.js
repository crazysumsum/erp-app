const REFERENCE_RESULTS = new Set(["REFERENCE", "NO_REFERENCE"]);

function validDescriptor(value) {
  return value && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.contract === "string" && value.contract.length > 0;
}

function unknownResult(id) {
  return { id, status: "UNKNOWN", referenceCount: null, watermark: null };
}

export class CustomerReferenceProviderRegistry {
  static contract = "customer-reference-provider-registry/v1";

  constructor({ providers = [], requiredProviders = [], timeoutMs = 2_000 } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
    if (!requiredProviders.every(validDescriptor)) throw new TypeError("Customer reference provider requirements are invalid");
    const required = new Map(requiredProviders.map((entry) => [entry.id, { ...entry }]));
    if (required.size !== requiredProviders.length) throw new TypeError("Duplicate required Customer reference provider");
    const registered = new Map();
    for (const provider of providers) {
      if (!validDescriptor(provider) || !required.has(provider.id)) throw new TypeError("Unknown Customer reference provider");
      if (registered.has(provider.id)) throw new TypeError("Duplicate Customer reference provider");
      registered.set(provider.id, provider);
    }
    this.required = new Map([...required].sort(([left], [right]) => left.localeCompare(right)));
    this.providers = registered;
    this.timeoutMs = timeoutMs;
  }

  async inspectReadiness() {
    const providers = [];
    for (const [id, requirement] of this.required) {
      providers.push({ id, contract: requirement.contract, status: await this.#isReady(id, requirement) ? "READY" : "NOT_READY" });
    }
    return {
      status: providers.length > 0 && providers.every((provider) => provider.status === "READY") ? "READY" : "NOT_READY",
      contract: CustomerReferenceProviderRegistry.contract,
      providers
    };
  }

  async checkCustomerReferences(customerId) {
    if (!Number.isSafeInteger(customerId) || customerId < 1) throw new TypeError("customerId must be a positive integer");
    const results = [];
    for (const [id, requirement] of this.required) {
      const provider = this.providers.get(id);
      if (!await this.#isReady(id, requirement)) {
        results.push(unknownResult(id));
        continue;
      }
      try {
        const result = await this.#bounded(provider.checkCustomerReferences(customerId));
        const validCount = Number.isSafeInteger(result?.referenceCount) && result.referenceCount >= 0;
        const validStatus = REFERENCE_RESULTS.has(result?.status) &&
          ((result.status === "REFERENCE" && result.referenceCount > 0) || (result.status === "NO_REFERENCE" && result.referenceCount === 0));
        if (!validCount || !validStatus || typeof result.watermark !== "string" || !result.watermark) throw new Error("malformed result");
        results.push({ id, status: result.status, referenceCount: result.referenceCount, watermark: result.watermark });
      } catch {
        results.push(unknownResult(id));
      }
    }
    const status = results.length === 0 || results.some((result) => result.status === "UNKNOWN")
      ? "UNKNOWN"
      : results.some((result) => result.status === "REFERENCE") ? "REFERENCE" : "NO_REFERENCE";
    return { status, providers: results };
  }

  async #isReady(id, requirement) {
    const provider = this.providers.get(id);
    if (!provider || provider.contract !== requirement.contract || typeof provider.inspectReadiness !== "function" || typeof provider.checkCustomerReferences !== "function") return false;
    try {
      return (await this.#bounded(provider.inspectReadiness()))?.status === "READY";
    } catch {
      return false;
    }
  }

  async #bounded(promise) {
    let timeout;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Customer reference provider timeout")), this.timeoutMs);
          timeout.unref?.();
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}
