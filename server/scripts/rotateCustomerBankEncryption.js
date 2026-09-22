import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { CustomerBankCrypto } from "../src/modules/customer/CustomerBankCrypto.js";
import { CustomerBankMaintenanceService } from "../src/modules/customer/CustomerBankMaintenanceService.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

export function parseArguments(argv) {
  const options = { afterId: 0, batchSize: 100, reason: "" };
  const names = { "--after-id": "afterId", "--batch-size": "batchSize", "--reason": "reason" };
  for (let index = 0; index < argv.length; index += 2) {
    const name = names[argv[index]];
    if (!name || argv[index + 1] === undefined) throw new Error("Usage: --after-id <id> --batch-size <1..1000> --reason <text>");
    options[name] = name === "reason" ? String(argv[index + 1]).trim() : Number(argv[index + 1]);
  }
  if (!options.reason || !Number.isSafeInteger(options.afterId) || options.afterId < 0 ||
      !Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1000) {
    throw new Error("Usage: --after-id <id> --batch-size <1..1000> --reason <text>; batch-size must be 1..1000");
  }
  return options;
}

export async function runCustomerBankMaintenance(operation, argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const [{ defaultConfigurationSource, validateApplicationConfiguration }, { createMySqlDatabasePool }] = await Promise.all([
    import("../src/framework/configuration/applicationConfiguration.js"),
    import("../src/services/mysqldatabase/connection.js")
  ]);
  const { customer, database: databaseConfig } = validateApplicationConfiguration(defaultConfigurationSource());
  if (!customer.bankEncryption) throw new Error("Customer bank key rings are not configured");
  const pool = createMySqlDatabasePool(databaseConfig);
  const database = {
    query: (...args) => pool.query(...args),
    async withTransaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  };
  try {
    const service = new CustomerBankMaintenanceService({
      database,
      crypto: new CustomerBankCrypto({ encryption: customer.bankEncryption, lookup: customer.bankLookup }),
      time: { nowMs: () => Date.now() }
    });
    const method = operation === "reindex" ? "reindexBatch" : "rotateEncryptionBatch";
    console.log(JSON.stringify(await service[method](options)));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCustomerBankMaintenance("rotate").catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
