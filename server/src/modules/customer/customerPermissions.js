const hasPermissions = (permissions) =>
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze([...permissions]) })
  });

export const CUSTOMER_PERMISSION_NAMES = Object.freeze([
  "customer.view",
  "customer.mgmt",
  "customer.approval",
  "customer.bank.view",
  "customer.bank.mgmt",
  "customer.settings"
]);

export const CUSTOMER_ROUTE_POLICIES = Object.freeze({
  generalRead: hasPermissions(["customer.view"]),
  generalManage: hasPermissions(["customer.view", "customer.mgmt"]),
  approval: hasPermissions(["customer.view", "customer.approval"]),
  bankReveal: hasPermissions(["customer.view", "customer.bank.view"]),
  bankManage: hasPermissions(["customer.view", "customer.bank.view", "customer.bank.mgmt"]),
  settings: hasPermissions(["customer.view", "customer.settings"])
});
