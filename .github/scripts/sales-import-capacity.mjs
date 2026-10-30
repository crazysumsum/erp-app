import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath, URL } from "node:url";
import { cases, validateCatalog } from "./capacity-cases.mjs";

// Positive workload dependencies, not an exemption list for the whole repository.
const runtime = /^(?:package(?:-lock)?\.json|\.node-version|\.nvmrc|\.github\/workflows\/ci\.yml|\.github\/scripts\/(?:capacity-cases|capacity-runner|sales-import-capacity|fulfillment-capacity)\.mjs)$/u;
const serverRuntime = /^server\/(?:package(?:-lock)?\.json|test-support\/testEnv\.js)$/u;
const integrationRuntime = /^server\/(?:database\/|src\/framework\/|src\/services\/(?:mysqldatabase|context|time|logging|scheduler|auth|authorization|idempotency|requestLimiter|tokenRevocation|deviceBinding)\/|src\/modules\/(?:user|role|authorization|audit)\/|config\/(?:api|application|database|jwt|request|requestLimiter|security|logging|scheduler|idempotency|tokenRevocation|deviceBinding)\.js)/u;
const nativeScopes = new Set(["sales-confirm", "sales-import", "sales-sequence", "fulfillment", "supplier-import", "supplier-duplicates", "supplier-sku", "customer-contention"]);
const scopes = {
  upload: /^server\/(?:src\/(?:framework\/|services\/filetype\/)|config\/(?:request|security|application|api)\.js|test-support\/.*(?:file|upload))/iu,
  auth: /^server\/(?:src\/(?:modules\/(?:user|authorization)\/|services\/(?:auth|context|time|logging)\/)|config\/(?:jwt|security)\.js)/u,
  limiter: /^server\/(?:src\/(?:services\/requestLimiter\/|framework\/.*(?:[Ll]imit|[Rr]ate))|config\/requestLimiter\.js)/u,
  "supplier-csv": /^server\/(?:src\/modules\/supplier\/(?:import\/|.*[Cc]sv)|src\/services\/supplierImport\/|config\/supplier\.js)/u,
  "supplier-import": /^server\/(?:src\/(?:modules\/(?:supplier|businessMaster)\/|handlers\/(?:suppliers|supplier-[a-z-]+)\/|services\/supplierImport\/)|config\/supplier\.js|test\/(?:supplier\/|integration\/supplier(?:HttpHarness|AcceptanceRunner|ScratchDatabase)\.js))/u,
  "supplier-duplicates": /^server\/(?:src\/modules\/supplier\/(?:.*(?:[Dd]uplicate|[Nn]ame|[Cc]sv)|import\/)|config\/supplier\.js|test\/integration\/supplier(?:HttpHarness|AcceptanceRunner|ScratchDatabase)\.js)/u,
  "supplier-sku": /^server\/(?:src\/modules\/(?:supplier\/(?:.*(?:[Ss]ku|[Ss]upply|[Oo]peration|[Aa]udit)|.*[Cc]ontext)|item\/)|config\/(?:supplier|item)\.js|test\/integration\/supplier(?:HttpHarness|AcceptanceRunner|ScratchDatabase)\.js)/u,
  "customer-contention": /^server\/(?:src\/(?:modules\/(?:customer|businessMaster)\/|handlers\/customers\/)|config\/customer\.js|test-support\/customer)/u,
  "sales-confirm": /^server\/(?:src\/(?:modules\/(?:sales\/|inventory\/|customer\/|item\/|businessMaster\/)|handlers\/sales(?:-[a-z-]+)?\/|services\/salesJobs\/)|config\/(?:sales|inventory|customer|item)\.js|test\/sales\/phase[124]\/)/u,
  "sales-import": /^server\/(?:src\/(?:modules\/(?:sales\/|customer\/|item\/|inventory\/|businessMaster\/)|handlers\/sales(?:-[a-z-]+)?\/|services\/salesJobs\/)|config\/(?:sales|customer|item|inventory)\.js|test\/sales\/phase[123]\/)/u,
  "sales-csv": /^server\/(?:src\/modules\/sales\/(?:salesCsv|salesCsvGrouping|salesCsvSpool|salesImport|salesChannel|salesDocument|salesQuantity|salesMoney|normalizeSales|salesConstants)|config\/sales\.js|test\/sales\/phase3\/.*(?:[Ff]ixture|[Cc]sv))/u,
  "sales-sequence": /^server\/(?:src\/modules\/sales\/(?:SalesDocumentSequence|SalesSequence|salesSequence|salesDocumentNumber)|config\/sales\.js|test\/sales\/phase1\/fixtures\.js)/u,
  fulfillment: /^server\/(?:src\/(?:modules\/(?:fulfillment\/|inventory\/|item\/|businessMaster\/|customer\/CustomerLookup|sales\/(?:Sales(?:Order|Fulfillment|Lifecycle|Backorder|Confirmation)|sales(?:Order|Fulfillment|Lifecycle|Inventory|Backorder|Confirmation|Document|Constants)))|handlers\/(?:fulfillments|fulfillment-queue)\/|services\/fulfillment\/)|config\/(?:fulfillment|inventory|item|sales)\.js|test\/fulfillment\/|test\/sales\/(?:phase[124]\/.*(?:[Ff]ixture|commitmentReconciliation)))/u,
  "fulfillment-client": /^client\/(?:package(?:-lock)?\.json|(?:vite|vitest)\.config\.js|config\/|src\/(?:components\/fulfillment\/|pages\/fulfillment\/|services\/fulfillment\.js|framework\/|stores\/session\.js|router\/|locales\/|i18n\/|styles\/))/u
};

// Static imports supplement the dynamic module/provider scopes above. In particular,
// shared CSV/decimal helpers and test fixtures must not depend on filename guesses.
const root = fileURLToPath(new URL("../../", import.meta.url));
const imports = new Map();
function dependencyFiles(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  if (!imports.has(file)) {
    const source = readFileSync(path.join(root, file), "utf8"), dependencies = [];
    for (const [, name] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bnew URL\s*\()\s*["']([^"']+)["']/gu)) {
      const resolved = name.startsWith(".") ? path.resolve(root, path.dirname(file), name)
        : name.startsWith("@/") ? path.join(root, "client/src", name.slice(2))
          : name.startsWith("@config/") ? path.join(root, "client/config", name.slice(8)) : null;
      if (resolved?.startsWith(root) && existsSync(resolved) && statSync(resolved).isFile()) dependencies.push(path.relative(root, resolved));
    }
    imports.set(file, dependencies);
  }
  for (const dependency of imports.get(file)) dependencyFiles(dependency, seen);
  return seen;
}

function knownPath(file) {
  // These namespaces have an explicit owner or are independent test/document assets.
  if (/^(?:docs\/|\.github\/|server\/(?:test\/|test-support\/|scripts\/|database\/|src\/framework\/))/u.test(file)) return true;
  if (/^client\/(?:test\/|e2e\/|public\/|config\/|src\/(?:pages|components|composables|framework|services|stores|css|assets)\/|(?:package(?:-lock)?\.json|(?:vite|vitest)\.config\.js|index\.html|src\/(?:App\.vue|main\.js))$)/u.test(file)) return true;
  if (/^server\/src\/services\/(?:auth|authorization|context|customerFile|customerImport|deviceBinding|filetype|fulfillment|idempotency|itemImport|itemMedia|logging|mysqldatabase|requestLimiter|salesJobs|scheduler|supplierImport|supplierMetrics|time|tokenRevocation)\//u.test(file)) return true;
  if (/^server\/src\/handlers\/(?:audit|business-master|catalog|customer(?:s|-[a-z-]+)|device|fulfillment(?:s|-queue)|inventory|item(?:s|-[a-z-]+)|permissions|roles|sales(?:-[a-z-]+)?|skus|supplier(?:s|-[a-z-]+)|users?)\//u.test(file) || file === "server/src/handlers/healthHandler.js") return true;
  if (/^server\/config\/(?:api|application|customer|database|deviceBinding|fulfillment|idempotency|inventory|item|jwt|logging|request|requestLimiter|sales|scheduler|security|supplier|tokenRevocation)\.js$/u.test(file) || file === "server/config/itemRecoveryTrustPolicy.json") return true;
  if (/^server\/src\/modules\/(?:audit|authorization|businessMaster|customer|fulfillment|inventory|item|purchasing|role|sales|supplier|user)\//u.test(file)) return true;
  return /^(?:[^/]+\.md|\.gitignore|\.gitattributes|eslint\.config\.js|server\/src\/index\.js)$/u.test(file) || runtime.test(file) || serverRuntime.test(file);
}

export function selectCapacity(files) {
  assert.ok(Array.isArray(files), "A verified diff is required");
  const dependenciesByCase = new Map(cases.map(c => [c.id, dependencyFiles(c.file)]));
  for (const file of files) assert.ok(typeof file === "string" && (knownPath(file) || [...dependenciesByCase.values()].some(dependencies => dependencies.has(file))), `Unmapped change; classify impact before capacity execution: ${file}`);
  return cases.flatMap(entry => {
    const dependencies = dependenciesByCase.get(entry.id);
    const hits = files.filter(file => runtime.test(file) || file === entry.file || scopes[entry.scope].test(file)
      || dependencies.has(file)
      || (entry.group !== "client" && serverRuntime.test(file))
      || (nativeScopes.has(entry.scope) && integrationRuntime.test(file))
      || (entry.scope === "upload" && file === "server/src/index.js"));
    return hits.length ? [{ ...entry, changedFiles: hits }] : [];
  });
}

export function checkResults(needs) {
  for (const job of ["changes", "regression", "audit", "lint", "build", "e2e"]) {
    assert.equal(needs[job]?.result, "success", `${job} must succeed`);
  }
  for (const [job, output] of [["server-capacity", "server_required"], ["client-capacity", "client_required"]]) {
    const required = needs.changes.outputs?.[output];
    assert.ok(required === "true" || required === "false", `Missing ${output} decision`);
    assert.equal(needs[job]?.result, required === "true" ? "success" : "skipped", `${job} must pass when selected, or be explicitly inapplicable`);
  }
}

export function changedFiles(eventName, event, head = process.env.GITHUB_SHA) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  let base;
  if (eventName === "pull_request") {
    base = event.pull_request?.base?.sha; head = event.pull_request?.head?.sha;
  } else if (eventName === "push") {
    base = event.before; head = event.after;
  } else if (eventName === "schedule" || eventName === "workflow_dispatch") {
    // Routine scheduled/manual checks remain available; no baseline means no capacity request.
    base = event.inputs?.capacity_base;
    if (!base) return [];
  } else {
    throw new Error(`Unsupported capacity event: ${eventName}`);
  }
  for (const sha of [base, head]) {
    assert.match(sha ?? "", /^[a-f0-9]{40}$/u, "Capacity comparison requires full commit SHAs");
    assert.notEqual(sha, "0".repeat(40), "Missing history must not start a capacity sweep");
  }
  if (eventName === "pull_request") base = git("merge-base", base, head);
  else git("merge-base", "--is-ancestor", base, head);
  // Keep deleted paths and both sides of a rename.
  return execFileSync("git", ["diff", "--name-only", "-z", "--no-renames", base, head, "--"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "check") {
    checkResults(JSON.parse(process.env.CI_RESULTS));
  } else {
    validateCatalog();
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const files = changedFiles(process.env.GITHUB_EVENT_NAME, event);
    const selected = selectCapacity(files);
    const groups = [...new Set(selected.filter(c => c.group !== "client").map(c => c.group))].sort();
    const outputs = { server_required: groups.length > 0, client_required: selected.some(c => c.group === "client"),
      matrix: JSON.stringify({ group: groups }), selection: JSON.stringify(selected.map(c => c.id)) };
    for (const [key, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    process.stdout.write(JSON.stringify({ event: process.env.GITHUB_EVENT_NAME, files,
      selected: selected.map(c => ({ id: c.id, scope: c.scope, cases: c.names, changedFiles: c.changedFiles })) }, null, 2) + "\n");
  }
}
