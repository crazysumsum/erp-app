import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function startWithInvalidConfig(timeZone, environment, execArgv = []) {
  // The invalid setting stops the real entry point before it can access a database.
  const result = spawnSync(process.execPath, [...execArgv, "src/index.js"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, TZ: timeZone, NODE_ENV: environment, FULFILLMENT_MAX_LINES_PER_DOCUMENT: "0" },
    encoding: "utf8",
    timeout: 10000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /API listening/);
  const event = result.stderr.split("\n").filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line)).find(entry => entry.event === "application.startup_failed");
  assert.ok(event);
  return { error: event.context.error, stderr: result.stderr };
}

test("production and unspecified environments reject unsafe process time zones before application setup", () => {
  for (const [zone, mode, offset] of [
    ["Asia/Hong_Kong", "production", -480], ["Etc/GMT", "production", 0],
    ["Asia/Hong_Kong", "", -480], ["Asia/Hong_Kong", "staging", -480]
  ]) {
    const { error } = startWithInvalidConfig(zone, mode);
    assert.ok(error.message.includes(`TZ=${zone}`));
    assert.ok(error.message.includes(`getTimezoneOffset()=${offset}`));
    assert.match(error.message, /Set TZ=UTC/);
    assert.match(error.message, /APP_TIME_ZONE=Asia\/Hong_Kong/);
  }
  assert.match(startWithInvalidConfig("", "production").error.message, /Set TZ=UTC/);
});

test("a UTC label with a nonzero runtime offset still fails closed", () => {
  const { error } = startWithInvalidConfig("UTC", "production", [
    "--import", "data:text/javascript,Date.prototype.getTimezoneOffset = () => 60"
  ]);
  assert.match(error.message, /TZ=UTC, getTimezoneOffset\(\)=60/);
});

test("both permitted UTC settings reach application configuration in production", () => {
  for (const zone of ["UTC", "Etc/UTC"]) {
    const { error, stderr } = startWithInvalidConfig(zone, "production");
    assert.equal(error.code, "CONFIGURATION_INVALID");
    assert.doesNotMatch(stderr, /Set TZ=UTC/);
  }
});

test("explicit test and development modes warn and continue in Hong Kong time", () => {
  for (const mode of ["test", "development"]) {
    const { error, stderr } = startWithInvalidConfig("Asia/Hong_Kong", mode);
    assert.equal(error.code, "CONFIGURATION_INVALID");
    assert.match(stderr, /Set TZ=UTC/);
  }
});
