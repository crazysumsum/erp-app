import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_PERMISSION_NAMES,
  CUSTOMER_ROUTE_POLICIES
} from "../src/modules/customer/customerPermissions.js";
import { up as seedCustomerPermissions } from "../database/migrations/0038_seed_customer_permissions.js";
import { PERMISSION_NAMES } from "../src/modules/authorization/permissionCatalogue.js";

const CUSTOMER_PERMISSIONS = [
  "customer.view",
  "customer.mgmt",
  "customer.approval",
  "customer.bank.view",
  "customer.bank.mgmt",
  "customer.settings"
];

function seedConnection() {
  const roles = new Map([["system-admin", { id: 1, description: "System Admin" }]]);
  const permissions = new Map();
  const rolePermissions = new Set();
  let nextPermissionId = 1;

  return {
    permissions,
    rolePermissions,
    connection: {
      async query(sql, [first, second] = []) {
        if (sql.includes("SELECT id FROM roles")) {
          const role = roles.get(first);
          return [role ? [{ id: role.id }] : []];
        }

        if (sql.includes("SELECT id FROM permissions")) {
          const permission = permissions.get(first);
          return [permission ? [{ id: permission.id }] : []];
        }

        if (sql.includes("SELECT 1 FROM role_permissions")) {
          return [rolePermissions.has(`${first}:${second}`) ? [{ 1: 1 }] : []];
        }

        throw new Error(`unexpected query: ${sql}`);
      },
      async execute(sql, [first, second] = []) {
        if (sql.includes("INSERT INTO permissions")) {
          permissions.set(first, { id: nextPermissionId, description: second });
          return [{ insertId: nextPermissionId++ }];
        }

        if (sql.includes("INSERT INTO role_permissions")) {
          rolePermissions.add(`${first}:${second}`);
          return [{ affectedRows: 1 }];
        }

        throw new Error(`unexpected execute: ${sql}`);
      }
    }
  };
}

test("Customer permissions are explicit and route policies require the intended sets", () => {
  assert.deepEqual(CUSTOMER_PERMISSION_NAMES, CUSTOMER_PERMISSIONS);

  for (const name of CUSTOMER_PERMISSION_NAMES) {
    assert.ok(PERMISSION_NAMES.includes(name), `${name} must be in the catalogue`);
  }

  assert.deepEqual(CUSTOMER_ROUTE_POLICIES.generalRead.options.permissions, ["customer.view"]);
  assert.deepEqual(CUSTOMER_ROUTE_POLICIES.generalManage.options.permissions, [
    "customer.view",
    "customer.mgmt"
  ]);
  assert.deepEqual(CUSTOMER_ROUTE_POLICIES.approval.options.permissions, [
    "customer.view",
    "customer.approval"
  ]);
  assert.deepEqual(CUSTOMER_ROUTE_POLICIES.bankReveal.options.permissions, [
    "customer.view",
    "customer.bank.view"
  ]);
  assert.deepEqual(CUSTOMER_ROUTE_POLICIES.bankManage.options.permissions, [
    "customer.view",
    "customer.bank.view",
    "customer.bank.mgmt"
  ]);
  assert.deepEqual(CUSTOMER_ROUTE_POLICIES.settings.options.permissions, [
    "customer.view",
    "customer.settings"
  ]);
});

test("Customer permission seed grants system-admin only the four non-bank permissions", async () => {
  const { connection, permissions, rolePermissions } = seedConnection();

  await seedCustomerPermissions(connection);

  assert.deepEqual([...permissions.keys()], CUSTOMER_PERMISSIONS);

  const grantedNames = CUSTOMER_PERMISSIONS.filter((name) =>
    rolePermissions.has(`1:${permissions.get(name).id}`)
  );

  assert.deepEqual(grantedNames, [
    "customer.view",
    "customer.mgmt",
    "customer.approval",
    "customer.settings"
  ]);
  assert.equal(rolePermissions.has(`1:${permissions.get("customer.bank.view").id}`), false);
  assert.equal(rolePermissions.has(`1:${permissions.get("customer.bank.mgmt").id}`), false);
});

test("Customer permission seed converges when rerun", async () => {
  const { connection, permissions, rolePermissions } = seedConnection();

  await seedCustomerPermissions(connection);
  const firstPermissionIds = [...permissions.entries()].map(([name, permission]) => [name, permission.id]);
  const firstRolePermissions = [...rolePermissions];

  await seedCustomerPermissions(connection);

  assert.deepEqual([...permissions.entries()].map(([name, permission]) => [name, permission.id]), firstPermissionIds);
  assert.deepEqual([...rolePermissions], firstRolePermissions);
});
