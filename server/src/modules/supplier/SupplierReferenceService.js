export class SupplierReferenceService {
  constructor({ checkers = [] } = {}) {
    const names = checkers.map((checker) => checker.name);
    if (new Set(names).size !== names.length) {
      throw new TypeError("Supplier reference checker names must be unique");
    }
    if (checkers.some((checker) => !checker.name || typeof checker.count !== "function")) {
      throw new TypeError("Supplier reference checkers require a name and count function");
    }
    this.checkers = [...checkers].sort((left, right) => left.name.localeCompare(right.name));
  }

  async describeReferences(connection, supplierId) {
    const references = {};
    for (const checker of this.checkers) {
      const count = Number(await checker.count(connection, supplierId));
      if (!Number.isInteger(count) || count < 0) {
        throw new TypeError(`Supplier reference checker ${checker.name} must return a non-negative integer`);
      }
      references[checker.name] = count;
    }
    return {
      references,
      total: Object.values(references).reduce((sum, count) => sum + count, 0)
    };
  }
}
