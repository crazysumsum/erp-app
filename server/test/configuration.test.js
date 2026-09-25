import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  defaultConfigurationSource,
  validateApplicationConfiguration
} from "../src/framework/configuration/applicationConfiguration.js";
import { ConfigurationError } from "../src/framework/configuration/ConfigurationError.js";

test("global configuration validation normalizes every configuration section", () => {
  const configuration = validateApplicationConfiguration(
    defaultConfigurationSource()
  );

  assert.deepEqual(Object.keys(configuration).sort(), [
    "api",
    "application",
    "customer",
    "database",
    "deviceBinding",
    // idempotency 也是一個 service，設定自己一個區塊、自己一個檔案。
    "idempotency",
    "inventory",
    "item",
    "jwt",
    "logging",
    "request",
    // 限流器是一個 service，所以它的設定自己一個區塊、自己一個檔案。
    "requestLimiter",
    "scheduler",
    "security",
    "supplier",
    // 撤銷也是一個 service，所以設定自己一個區塊、自己一個檔案。
    "tokenRevocation"
  ]);
  assert.equal(configuration.application.timeZone, "Asia/Hong_Kong");
  assert.equal(configuration.application.requestTimeoutMs, 30000);
  assert.equal(configuration.api.defaults.authType, "jwt");
  assert.equal(configuration.api.defaults.version, "v1");
  assert.equal(configuration.api.versioning.defaultVersion, "v1");
  assert.equal(configuration.idempotency.headerName, "Idempotency-Key");
  // 預設是 mysql：memory adapter 的狀態在各自的行程裡，多實例部署下同一個 key
  // 打到不同實例會各自執行一次，而那是負載平衡下的常態。
  assert.equal(configuration.idempotency.storeAdapter, "mysql");
  assert.equal(configuration.inventory.openingLeaseMs, 60000);
  assert.equal(configuration.item.categoryMaxDepth, 8);
  assert.equal(configuration.supplier.duplicateNameThreshold, 0.85);
  assert.match(configuration.item.mediaDirectory, /storage\/items$/);
  assert.equal(configuration.logging.loggers.request.filePrefix, "requests");
  assert.equal(configuration.logging.loggers.request.minimumLevel, "info");
  assert.equal(configuration.logging.loggers.system.filePrefix, "system");
  assert.equal(configuration.logging.loggers.system.minimumLevel, "info");
  assert.equal(configuration.requestLimiter.maxConcurrentRequests, 100);
  assert.equal(configuration.request.validation.input.enabled, true);
  assert.equal(configuration.request.validation.output.runtimeEnabled, true);
  assert.equal(Object.isFrozen(configuration), true);
  assert.equal(Object.isFrozen(configuration.database), true);
  assert.equal(Object.isFrozen(configuration.logging.loggers), true);
});

test("logging configuration accepts additional named logger profiles", () => {
  const source = defaultConfigurationSource();
  const configuration = validateApplicationConfiguration({
    ...source,
    logging: {
      ...source.logging,
      loggers: {
        ...source.logging.loggers,
        audit: {
          ...source.logging.loggers.system,
          directory: "logs/audit",
          filePrefix: "audit"
        }
      }
    }
  });

  assert.equal(configuration.logging.loggers.audit.filePrefix, "audit");
  assert.match(configuration.logging.loggers.audit.directory, /logs\/audit$/);
});

test("production response validation is secure by default and can be explicitly disabled", () => {
  const source = defaultConfigurationSource();
  const enabled = validateApplicationConfiguration(source, {
    environment: "production"
  });
  const disabled = validateApplicationConfiguration(
    {
      ...source,
      request: {
        ...source.request,
        validation: {
          ...source.request.validation,
          output: {
            ...source.request.validation.output,
            validateInProduction: false
          }
        }
      }
    },
    { environment: "production" }
  );

  assert.equal(enabled.request.validation.output.runtimeEnabled, true);
  assert.equal(disabled.request.validation.output.runtimeEnabled, false);
});

test("API defaults inherit the merged versioning default", () => {
  const source = defaultConfigurationSource();
  const configuration = validateApplicationConfiguration({
    ...source,
    api: {
      ...source.api,
      versioning: {
        ...source.api.versioning,
        defaultVersion: "v2",
        supportedVersions: ["v1", "v2"]
      }
    }
  });

  assert.equal(configuration.api.versioning.defaultVersion, "v2");
  assert.equal(configuration.api.defaults.version, "v2");
});

test("global configuration validation reports errors from multiple sections", () => {
  const source = defaultConfigurationSource();
  const invalidSource = {
    ...source,
    application: {
      ...source.application,
      port: 70000,
      timeZone: "Invalid/TimeZone",
      requestTimeoutMs: 0
    },
    api: {
      ...source.api,
      defaults: { ...source.api.defaults, timeoutMs: 0 }
    },
    database: { ...source.database, connectionLimit: 0 },
    requestLimiter: { ...source.requestLimiter, maxQueueSize: -1 }
  };

  assert.throws(
    () => validateApplicationConfiguration(invalidSource),
    (error) => {
      assert.ok(error instanceof ConfigurationError);
      assert.equal(error.code, "CONFIGURATION_INVALID");
      assert.deepEqual(
        error.details.map(({ section }) => section),
        ["application", "api", "database", "requestLimiter"]
      );
      return true;
    }
  );
});

test("Customer and Supplier bank capabilities use the same owner-separated key rings", () => {
  const configuredSource = defaultConfigurationSource();
  const disabledBankKeyRings = {
    bankEncryption: { activeKeyId: undefined, keyRing: undefined },
    bankLookup: { activeKeyId: undefined, keyRing: undefined }
  };
  const source = {
    ...configuredSource,
    customer: { ...configuredSource.customer, ...disabledBankKeyRings },
    supplier: { ...configuredSource.supplier, ...disabledBankKeyRings }
  };
  const encryption = randomBytes(32).toString("base64");
  const lookup = randomBytes(32).toString("base64");
  const bankEncryption = { activeKeyId: "enc", keyRing: { enc: encryption } };
  const bankLookup = { activeKeyId: "lookup", keyRing: { lookup } };

  assert.doesNotThrow(() => validateApplicationConfiguration({
    ...source,
    customer: { bankEncryption, bankLookup },
    supplier: { ...source.supplier, bankEncryption, bankLookup }
  }));
  assert.throws(
    () => validateApplicationConfiguration({
      ...source,
      customer: { bankEncryption, bankLookup }
    }),
    /must be enabled together/
  );
  assert.throws(
    () => validateApplicationConfiguration({
      ...source,
      customer: { bankEncryption, bankLookup },
      supplier: {
        ...source.supplier,
        bankEncryption: { activeKeyId: "enc", keyRing: { enc: randomBytes(32).toString("base64") } },
        bankLookup
      }
    }),
    /must use the same key rings/
  );
});

test("Customer attachment orphan cleanup grace exceeds the complete request budget", () => {
  const source = defaultConfigurationSource();
  const bankEncryption = { activeKeyId: "enc", keyRing: { enc: randomBytes(32).toString("base64") } };
  const bankLookup = { activeKeyId: "lookup", keyRing: { lookup: randomBytes(32).toString("base64") } };
  const attachment = {
    generalRoot: "/private/tmp/customer-general", bankSensitiveRoot: "/private/tmp/customer-bank",
    tempRoot: "/private/tmp/customer-temp", orphanGraceMs: 20000,
    malwareScanner: { mode: "clamd", host: "127.0.0.1", port: 3310, timeoutMs: 15000 }
  };
  assert.throws(() => validateApplicationConfiguration({
    ...source, customer: { bankEncryption, bankLookup, attachment },
    supplier: { ...source.supplier, bankEncryption, bankLookup }
  }), /must exceed application.requestTimeoutMs/u);
});

test("every environment requires JWT_SECRET, not just production", () => {
  const source = defaultConfigurationSource();
  // 沒有 JWT_SECRET 時，config/jwt.js 的 secret 就是 undefined。
  const withoutSecret = { ...source, jwt: { ...source.jwt, secret: undefined } };

  // development 是 NODE_ENV 未設定時的預設值，正是舊實作會靜默放行的情況。
  for (const environment of ["development", "test", "staging", "production"]) {
    assert.throws(
      () => validateApplicationConfiguration(withoutSecret, { environment }),
      (error) => {
        assert.ok(error instanceof ConfigurationError);
        assert.equal(error.details[0].section, "jwt");
        assert.match(error.details[0].message, /JWT_SECRET is required/);
        return true;
      },
      `expected ${environment} to reject a missing JWT_SECRET`
    );
  }

  // 空白字元不算有效密鑰。
  assert.throws(
    () =>
      validateApplicationConfiguration({
        ...source,
        jwt: { ...source.jwt, secret: "   " }
      }),
    ConfigurationError
  );
});

test("configuration ships no fallback JWT secret", async () => {
  const { default: jwtConfig } = await import("../config/jwt.js");

  // 寫死的密鑰等同公開，任何人都能據此簽發任意 role 的 Token。
  assert.equal(jwtConfig.secret, process.env.JWT_SECRET);
  assert.ok(
    !Object.hasOwn(jwtConfig, "requireEnvironmentSecretInProduction"),
    "the NODE_ENV-gated opt-out must not come back"
  );
});
