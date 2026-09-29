import assert from "node:assert/strict";
import test from "node:test";

import { AuthenticationError, AuthStrategyRegistry } from "../src/framework/auth/authStrategyRegistry.js";
import {
  AuthorizationError,
  createAuthorizationPolicyRegistry
} from "../src/framework/authorization/authorizationPolicyRegistry.js";
import * as binHandlers from "../src/handlers/inventory/binHandlers.js";
import * as inquiryHandlers from "../src/handlers/inventory/inquiryHandlers.js";
import * as postingHandlers from "../src/handlers/inventory/postingHandlers.js";
import * as warehouseHandlers from "../src/handlers/inventory/warehouseHandlers.js";

const handlers = [warehouseHandlers, binHandlers, postingHandlers, inquiryHandlers]
  .flatMap((module) => Object.values(module))
  .filter((value) => typeof value === "function" && value.api);
const sensitive = /password|token|secret|credential|request_hash|password_hash/iu;

function schemaKeys(schema, found = []) {
  if (!schema || typeof schema !== "object") return found;
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    found.push(key);
    schemaKeys(value, found);
  }
  schemaKeys(schema.items, found);
  for (const value of Object.values(schema.oneOf ?? {})) schemaKeys(value, found);
  return found;
}

function strategies() {
  const registry = new AuthStrategyRegistry();
  for (const type of ["jwt", "jwt-password", "jwt-device-password"]) {
    registry.register(type, async (req) => {
      if (!req.token) throw new AuthenticationError();
      if (req.actorState !== "active") throw new AuthorizationError("ACTOR_STALE");
      return { type, claims: { sub: "7", permissions: req.permissions ?? [] } };
    });
  }
  return registry;
}

test("TASK-018 every Core endpoint fails closed for missing, unauthorized and stale actors", async () => {
  assert.equal(handlers.length, 24);
  const authentication = strategies();
  const authorization = createAuthorizationPolicyRegistry();

  for (const Handler of handlers) {
    const route = Handler.api;
    const authType = route.authType ?? "jwt";
    assert.notEqual(authType, "public", Handler.handlerName);
    await assert.rejects(
      () => authentication.authenticate(authType, {}),
      (error) => error.statusCode === 401,
      `${Handler.handlerName} must reject an unauthenticated request`
    );
    await assert.rejects(
      () => authentication.authenticate(authType, { token: "test", actorState: "disabled" }),
      (error) => error.statusCode === 403,
      `${Handler.handlerName} must reject a stale actor`
    );
    const auth = await authentication.authenticate(authType, { token: "test", actorState: "active" });
    await assert.rejects(
      () => authorization.authorize(route.authorizationPolicies, { auth }, route),
      (error) => error.statusCode === 403,
      `${Handler.handlerName} must reject missing permissions`
    );
  }
});

test("TASK-018 every Core endpoint keeps strict inputs and sensitive fields out of responses", () => {
  for (const Handler of handlers) {
    for (const [location, schema] of Object.entries(Handler.api.requestSchema)) {
      assert.equal(schema.additionalProperties, false, `${Handler.handlerName}.${location}`);
    }
    for (const schema of Object.values(Handler.api.responseSchema)) {
      const leaked = schemaKeys(schema).filter((key) => sensitive.test(key));
      assert.deepEqual(leaked, [], `${Handler.handlerName} response exposes ${leaked.join(", ")}`);
    }
  }
});

test("TASK-018 Bin endpoints carry the Warehouse owner in every child path", () => {
  const binPaths = Object.values(binHandlers)
    .filter((value) => typeof value === "function" && value.api)
    .map((Handler) => Handler.api.path);
  assert.ok(binPaths.every((path) => path.includes("/:warehouseId/bins")));
  assert.ok(binPaths.filter((path) => path.includes(":binId")).every((path) => path.includes(":warehouseId")));
});
