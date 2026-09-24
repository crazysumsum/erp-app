import { CustomerImportService } from "../../modules/customer/CustomerImportService.js";
import { customerImportError } from "../../modules/customer/customerErrors.js";
import { CustomerImportStorage } from "../../services/customerImport/CustomerImportStorage.js";

export function customerImportService(services) {
  const config = services.config.customer.import;
  return config ? new CustomerImportService({
    database: services.require("mysqldatabase"), time: services.require("time"),
    storage: new CustomerImportStorage({ config })
  }) : null;
}

export function requireCustomerImport(service) {
  if (!service) throw customerImportError("CUSTOMER_IMPORT_UNAVAILABLE", 503, "客戶匯入功能目前未啟用");
  return service;
}

export function customerImportActor(req) {
  return {
    actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}
