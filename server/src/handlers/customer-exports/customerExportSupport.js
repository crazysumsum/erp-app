import { CustomerExportService } from "../../modules/customer/CustomerExportService.js";
import { customerExportError } from "../../modules/customer/customerErrors.js";
import { CustomerImportStorage } from "../../services/customerImport/CustomerImportStorage.js";

export function customerExportService(services) {
  const config = services.config.customer.import;
  return config ? new CustomerExportService({
    database: services.require("mysqldatabase"), time: services.require("time"),
    storage: new CustomerImportStorage({ config }), maxRows: config.maxRows
  }) : null;
}

export function requireCustomerExport(service) {
  if (!service) throw customerExportError("CUSTOMER_EXPORT_UNAVAILABLE", 503, "客戶匯出功能目前未啟用");
  return service;
}

export function customerExportActor(req) {
  return {
    actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}
