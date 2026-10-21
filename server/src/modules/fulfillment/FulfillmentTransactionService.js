import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";

export function assertFulfillmentTransaction(database, transaction) {
  if (!transaction || database.context?.get()?.databaseTransaction !== transaction ||
      getActiveTransactionIsolation(transaction) !== "READ COMMITTED") {
    throw new TypeError("Fulfillment requires its current active READ COMMITTED transaction");
  }
  return transaction;
}

export class FulfillmentTransactionService {
  constructor({ database }) { this.database = database; }

  withTransaction(work) {
    return this.database.withTransaction(transaction => work(assertFulfillmentTransaction(this.database, transaction)),
      { isolationLevel: "READ COMMITTED" });
  }
}
