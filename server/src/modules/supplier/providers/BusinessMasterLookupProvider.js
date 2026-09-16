import { BusinessMasterProvider } from "../../businessMaster/BusinessMasterProvider.js";

function notReady(details) {
  const error = new Error("Business Master is not ready for Supplier Management");
  error.code = "BUSINESS_MASTER_NOT_READY";
  error.publicCode = "BUSINESS_MASTER_NOT_READY";
  error.statusCode = 503;
  error.details = details;
  return error;
}

export class BusinessMasterLookupProvider {
  static contract = BusinessMasterProvider.contract;

  constructor({ provider, readiness } = {}) {
    if (!provider || !readiness) {
      throw new TypeError("BusinessMasterLookupProvider requires provider and readiness");
    }
    this.provider = provider;
    this.readiness = readiness;
  }

  async assertReady() {
    const result = await this.readiness.inspect();
    if (
      result.status !== "READY" ||
      result.providerContract !== BusinessMasterLookupProvider.contract
    ) {
      throw notReady({
        status: result.status,
        providerContract: result.providerContract
      });
    }
    return result;
  }

  listCurrencies(input) {
    return this.provider.listActiveCurrencies(input);
  }

  listPaymentTerms(input) {
    return this.provider.listActivePaymentTerms(input);
  }

  getCurrencyHistory(code) {
    return this.provider.getCurrencyHistory(code);
  }

  getPaymentTermHistory(id) {
    return this.provider.getPaymentTermHistory(id);
  }

  async assertSupplierDefaultsInTransaction(connection, {
    currencyCode,
    currencyVersion,
    paymentTermId,
    paymentTermVersion,
    purpose = "new_assignment"
  }) {
    const currency = await this.provider.assertCurrencyUsableInTransaction(connection, {
      code: currencyCode,
      expectedVersion: currencyVersion,
      purpose
    });
    const paymentTerm = paymentTermId === null || paymentTermId === undefined
      ? null
      : await this.provider.assertPaymentTermUsableInTransaction(connection, {
        id: paymentTermId,
        expectedVersion: paymentTermVersion,
        purpose
      });
    return { currency, paymentTerm };
  }
}
