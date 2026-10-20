import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { requiresCapacity, checkResults } from "./sales-import-capacity.mjs";

test("main, schedules and manual runs always require capacity", () => {
  for (const event of ["push", "schedule", "workflow_dispatch", "unknown"]) {
    assert.equal(requiresCapacity(event, ["README.md"]), true);
  }
});

test("PRs touching Sales, its dependencies or unknown paths require capacity", () => {
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
    "client/src/pages/sales/SalesImportsPage.vue",
    "client/src/services/salesImport.js",
    "client/src/framework/http/HttpClient.js",
    "client/package.json", "server/package.json", "package-lock.json",
    ".github/workflows/ci.yml", ".github/scripts/sales-import-capacity.mjs",
    "server/src/modules/newModule/service.js", "unknown-file"
  ]) assert.equal(requiresCapacity("pull_request", ["README.md", file]), true, file);
  assert.equal(requiresCapacity("pull_request", []), true);
});

test("known unrelated PR files do not require the mixed-load test", () => {
  assert.equal(requiresCapacity("pull_request", [
    "README.md", "docs/items_management/item_handoff_authoritative_gr.md",
    "client/src/components/suppliers/SupplierCard.vue",
    "client/test/pages/customer.test.js",
    "server/src/modules/supplier/SupplierAuditService.js",
    "server/src/handlers/suppliers/supplierAuditHandlers.js",
    "server/test/integration/supplierAuditAcceptance.integration.test.js",
    "server/test/supplierLookup.test.js", "server/test/supplier/fixtures.js"
  ]), false);
  // Configuration stored beside prose is executable input and stays conservative.
  assert.equal(requiresCapacity("pull_request", ["docs/sales_order_management/00_project_profile.json"]), true);
});

const successful = required => ({
  changes: { result: "success", outputs: { required: String(required) } },
  regression: { result: "success" }, audit: { result: "success" },
  lint: { result: "success" }, build: { result: "success" }, e2e: { result: "success" },
  "sales-import-capacity": { result: required ? "success" : "skipped" }
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
    const needs = successful(true); needs["sales-import-capacity"].result = result;
    assert.throws(() => checkResults(needs));
  }
  for (const output of [undefined, "", "invalid"]) {
    const needs = successful(false); needs.changes.outputs.required = output;
    assert.throws(() => checkResults(needs));
  }
  assert.throws(() => checkResults({}));
});

test("real git PR diff includes old renamed paths; unavailable history runs capacity", t => {
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
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha } } }));
    const stdout = execFileSync(process.execPath, [script], {
      cwd, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_NAME: event,
        GITHUB_OUTPUT: output, GITHUB_EVENT_PATH: eventPath }
    });
    return { output: readFileSync(output, "utf8"), stdout };
  };
  assert.equal(run("pull_request", git("rev-parse", "HEAD")).output, "required=false\n");
  assert.equal(run("push", "unused").output, "required=true\n");
  mkdirSync(path.join(cwd, "server/src/modules/supplier"), { recursive: true });
  renameSync(path.join(cwd, "server/src/modules/sales/service.js"), path.join(cwd, "server/src/modules/supplier/service.js"));
  git("add", "server"); git("commit", "-qm", "rename dependency");
  assert.equal(run("pull_request", git("rev-parse", "HEAD")).output, "required=true\n");
  const fallback = run("pull_request", "0".repeat(40));
  assert.equal(fallback.output, "required=true\n");
  assert.match(fallback.stdout, /Unable to determine/u);
});
