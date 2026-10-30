import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { selectCapacity, changedFiles, checkResults } from "./sales-import-capacity.mjs";

test("scheduled/manual checks without a baseline never request capacity", () => {
  for (const event of ["schedule", "workflow_dispatch"]) assert.deepEqual(changedFiles(event, {}), []);
  assert.deepEqual(selectCapacity([]), []);
  assert.throws(() => changedFiles("unknown", {}));
  assert.throws(() => selectCapacity(["unknown-file"]), /Unmapped change/u);
});

test("Sales workload changes and actual shared dependencies select capacity", () => {
  for (const file of [
    "server/src/modules/sales/SalesCsvImportService.js",
    "server/src/modules/customer/CustomerLookupService.js",
    "server/src/modules/item/ItemLookupService.js",
    "server/src/modules/inventory/InventoryReservationService.js",
    "server/src/modules/businessMaster/CurrencyService.js",
    "server/src/modules/user/UserService.js",
    "server/src/framework/application/createApplication.js",
    "server/src/services/scheduler/SchedulerService.js",
    "server/database/migrations/0083_change_index.js",
    "server/test/sales/phase2/fixtures.js",
    "server/test/integration/salesImportCapacity.integration.test.js",
    "server/package.json", "package-lock.json",
    ".github/workflows/ci.yml", ".github/scripts/sales-import-capacity.mjs"
  ]) assert.ok(selectCapacity(["README.md", file]).some(c => c.group === "sales"), file);
});

test("unrelated UI, prose and independent modules do not select Sales or Fulfillment", () => {
  const selected = selectCapacity([
    "README.md", "docs/items_management/item_handoff_authoritative_gr.md",
    "client/src/components/suppliers/SupplierCard.vue", "client/test/pages/customer.test.js",
    "server/src/modules/supplier/SupplierAuditService.js",
    "server/src/handlers/suppliers/supplierAuditHandlers.js",
    "server/test/integration/supplierAuditAcceptance.integration.test.js",
    "server/test/supplierLookup.test.js", "server/test/supplier/fixtures.js"
  ]);
  assert.ok(selected.every(c => c.group === "supplier"));
  assert.deepEqual(selectCapacity(["docs/sales_order_management/00_project_profile.json"]), []);
});

const successful = required => ({
  changes: { result: "success", outputs: { server_required: String(required), client_required: String(required) } },
  regression: { result: "success" }, audit: { result: "success" },
  lint: { result: "success" }, build: { result: "success" }, e2e: { result: "success" },
  "server-capacity": { result: required ? "success" : "skipped" },
  "client-capacity": { result: required ? "success" : "skipped" }
});

test("the fixed check accepts capacity PASS or explicitly inapplicable capacity", () => {
  assert.doesNotThrow(() => checkResults(successful(true)));
  assert.doesNotThrow(() => checkResults(successful(false)));
});

test("failure, cancellation, missing results and unexpected skips block the fixed check", () => {
  for (const required of [true, false]) {
    for (const job of ["changes", "regression", "audit", "lint", "build", "e2e"]) {
      for (const result of ["failure", "cancelled", "skipped", undefined]) {
        const needs = successful(required); needs[job].result = result;
        assert.throws(() => checkResults(needs), undefined, `${job}:${result}`);
      }
    }
  }
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    const needs = successful(true); needs["server-capacity"].result = result;
    assert.throws(() => checkResults(needs));
  }
  for (const output of [undefined, "", "invalid"]) {
    const needs = successful(false); needs.changes.outputs.server_required = output;
    assert.throws(() => checkResults(needs));
  }
  assert.throws(() => checkResults({}));
});

test("real PR and push diffs preserve rename paths; unavailable history blocks execution", t => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ci-capacity-scope-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.name", "CI test"); git("config", "user.email", "ci@example.invalid");
  mkdirSync(path.join(cwd, "server/src/modules/sales"), { recursive: true });
  writeFileSync(path.join(cwd, "server/src/modules/sales/service.js"), "export const value = 1;\n");
  git("add", "."); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(path.join(cwd, "README.md"), "Documentation only\n");
  git("add", "."); git("commit", "-qm", "docs");
  const script = fileURLToPath(new URL("./sales-import-capacity.mjs", import.meta.url));
  const run = (event, sha) => {
    const output = path.join(cwd, "output"), eventPath = path.join(cwd, "event.json");
    writeFileSync(output, "");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha } }, before: base, after: sha }));
    const stdout = execFileSync(process.execPath, [script], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GITHUB_EVENT_NAME: event,
        GITHUB_OUTPUT: output, GITHUB_EVENT_PATH: eventPath }
    });
    return { output: Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map(line => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; })), stdout };
  };
  assert.equal(run("pull_request", git("rev-parse", "HEAD")).output.server_required, "false");
  assert.equal(run("push", git("rev-parse", "HEAD")).output.server_required, "false");
  mkdirSync(path.join(cwd, "server/src/modules/supplier"), { recursive: true });
  renameSync(path.join(cwd, "server/src/modules/sales/service.js"), path.join(cwd, "server/src/modules/supplier/service.js"));
  git("add", "server"); git("commit", "-qm", "rename dependency");
  assert.equal(run("pull_request", git("rev-parse", "HEAD")).output.server_required, "true");
  assert.throws(() => run("pull_request", "0".repeat(40)), /Missing history/u);
});
