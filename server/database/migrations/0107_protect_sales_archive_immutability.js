import {installSalesArchiveProtection} from "../../src/modules/sales/salesArchiveProtectionSchema.js";
// Forward-only: no expiry, override, purge or change to historical migration bodies.
export async function up(connection){await installSalesArchiveProtection(connection);}
