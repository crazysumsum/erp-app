import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const publicJwt = workflow.match(/^\s*JWT_SECRET: (\S+)$/m)[1];
const ciEncryption = JSON.parse(workflow.match(/^\s*SUPPLIER_BANK_ENCRYPTION_KEYS: '(.+)'$/m)[1]);
const ciLookup = JSON.parse(workflow.match(/^\s*SUPPLIER_BANK_LOOKUP_KEYS: '(.+)'$/m)[1]);

function freshKeys() {
  const encryption = JSON.stringify({ active: randomBytes(32).toString("base64") });
  const lookup = JSON.stringify({ active: randomBytes(32).toString("base64") });
  return {
    JWT_SECRET: randomBytes(48).toString("base64"),
    SUPPLIER_BANK_ACTIVE_KEY_ID: "active", SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID: "active",
    CUSTOMER_BANK_ACTIVE_KEY_ID: "active", CUSTOMER_BANK_LOOKUP_ACTIVE_KEY_ID: "active",
    SUPPLIER_BANK_ENCRYPTION_KEYS: encryption, SUPPLIER_BANK_LOOKUP_KEYS: lookup,
    CUSTOMER_BANK_ENCRYPTION_KEYS: encryption, CUSTOMER_BANK_LOOKUP_KEYS: lookup
  };
}

function startup(overrides) {
  const env = { ...process.env, TZ: "UTC", NODE_ENV: "production", ...freshKeys(), ...overrides,
    // Stop after the production guard, before a test can connect to a database.
    FULFILLMENT_MAX_LINES_PER_DOCUMENT: "0" };
  const result = spawnSync(process.execPath, ["src/index.js"], {
    cwd: new URL("../", import.meta.url), env, encoding: "utf8", timeout: 10000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes("API listening"));
  const event = result.stderr.split("\n").filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line)).find(entry => entry.event === "application.startup_failed");
  assert.ok(event);
  return { error: event.context.error, output };
}

function assertDenied(variable, secret, overrides) {
  const { error, output } = startup(overrides);
  assert.ok(error.message.includes(variable));
  assert.ok(error.message.includes(variable === "JWT_SECRET" ? "openssl rand -base64 48" : "openssl rand -base64 32"));
  assert.ok(!output.includes(secret), "startup diagnostics must redact the key");
}

test("production rejects published or constant JWT secrets and names only the setting", () => {
  for (const [mode, secret] of [["production", publicJwt], ["development", publicJwt], ["", publicJwt], ["staging", "x".repeat(48)]]) {
    assertDenied("JWT_SECRET", secret, { NODE_ENV: mode, JWT_SECRET: " " + secret + " " });
  }
});

test("all four bank rings reject published material under any key ID including inactive versions", () => {
  for (const owner of ["SUPPLIER", "CUSTOMER"]) {
    for (const [kind, ring] of [["ENCRYPTION", ciEncryption], ["LOOKUP", ciLookup]]) {
      const variable = `${owner}_BANK_${kind}_KEYS`;
      const secret = Object.values(ring)[0];
      const keys = { active: randomBytes(32).toString("base64"), retired: secret };
      assertDenied(variable, secret, { [variable]: JSON.stringify(keys) });
    }
  }
});

test("a repeated-byte bank fixture and a published bank key reused as JWT are rejected", () => {
  const secret = Buffer.alloc(32, 9).toString("base64");
  assertDenied("SUPPLIER_BANK_LOOKUP_KEYS", secret, { SUPPLIER_BANK_LOOKUP_KEYS: JSON.stringify({ active: secret }) });
  const encoded = Object.values(ciEncryption)[0];
  assertDenied("JWT_SECRET", encoded, { JWT_SECRET: encoded });
});

test("fresh production keys and explicit nonproduction fixtures reach application configuration", () => {
  for (const overrides of [{}, { NODE_ENV: "test", JWT_SECRET: publicJwt }]) {
    const { error } = startup(overrides);
    assert.equal(error.code, "CONFIGURATION_INVALID");
    assert.ok(error.message.includes("maxLinesPerDocument"));
  }
});
