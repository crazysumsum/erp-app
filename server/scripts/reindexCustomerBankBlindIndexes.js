import { runCustomerBankMaintenance } from "./rotateCustomerBankEncryption.js";

runCustomerBankMaintenance("reindex").catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
