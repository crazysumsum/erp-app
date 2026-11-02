import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

// The audited main after PR #313. Compare whole trees, including scheduled/manual
// runs: a missed or failed run cannot grandfather an unapproved case on main.
const baseline = "aae9c74444299539a3a5e275f37a5730e88f3378";
const receipts = ".github/test-admissions/";
const git = (...args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const oid = /^[0-9a-f]{40}$/u;
const regular = mode => mode === "100644" || mode === "100755";
const allow = new Set((process.env.CI_TEST_ADMISSION_DIGESTS ?? "").split(/\s+/u).filter(Boolean));

function tree(rev) {
  const result = new Map();
  for (const row of git("ls-tree", "-rz", "--full-tree", rev).toString().split("\0").filter(Boolean)) {
    const tab = row.indexOf("\t");
    const [mode, , blob] = row.slice(0, tab).split(" ");
    result.set(row.slice(tab + 1), { mode, blob });
  }
  return result;
}

function runnerName(file) {
  const name = path.posix.basename(file);
  if (!/\.(?:[cm]?[jt]sx?|py|sh|rb)$/iu.test(name)) return false;
  return /(?:^test(?:[-.]|$)|[._-](?:test|spec)(?:[._-]|$)|^(?:vitest|vite|playwright|jest|eslint)\.config\.)/iu.test(name);
}

// Audited output declarations in the original Supplier Playwright configs.
// A changed config or a read elsewhere cannot inherit either exception.
const junitOutputLines = new Set([
  "6cd22e3ac0626ba86dcff2ac48336bcd31c3d0aa:27",
  "8fca9c0857b622c7bdd079457c86e8ba0b83b91f:12"
]);

function referencedData(names, rev, files) {
  if (!names.length) return "";
  try {
    // One fixed-string scan per tree for all changed assets, including docs
    // consumed via readFile/path.join and inputs imported by test helpers.
    const lines = execFileSync("git", ["grep", "-n", "-I", "-F", "-f", "-", rev, "--",
      "server/test", "server/test-support", "server/scripts", "client/test", "client/e2e", ".github/scripts"],
    { input: names.join("\n") + "\n", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return lines.split("\n").flatMap(line => {
      const match = /^[^:]+:([^:]+):(\d+):(.*)$/u.exec(line);
      if (!match) return [line]; // Unknown grep format remains a possible input.
      const [, file, number, content] = match;
      return junitOutputLines.has(files.get(file)?.blob + ":" + number) ? [] : [content];
    }).join("\n");
  } catch (error) {
    if (error.status === 1) return "";
    throw error;
  }
}

function sensitive(file, entry, references) {
  if (file === "AGENTS.md" || file.startsWith(".github/") || runnerName(file)) return true;
  if (/(?:^|\/)(?:tests?|__tests__|test-support|test-capacity|e2e|fixtures?|__fixtures__|mocks?|__mocks__|benchmarks?|scripts|testdata)(?:\/|$)/iu.test(file)) return true;
  if (/(?:^|\/)(?:package(?:-lock)?\.json|\.npmrc|\.nvmrc|\.node-version|\.gitattributes|\.gitmodules)$/u.test(file)) return true;
  if (/^(?:server|client)\/config\/|^server\/database\/.*(?:seed|fixture)/iu.test(file)) return true;
  if (/(?:fixture|benchmark|capacity|loadtest|performance)/iu.test(path.posix.basename(file)) && !file.endsWith(".md")) return true;
  // Helpers/data outside product code are review inputs too. Within product code
  // catch test entry points even when the file has a production-looking name.
  if (!/^(?:server|client)\/(?:src|public|database)\//u.test(file)) {
    if (!file.startsWith("docs/") && !file.endsWith(".md")) return true;
  }
  if (!entry) return false;
  if (!/\.[cm]?[jt]sx?$/u.test(file)) return references.includes(path.posix.basename(file));
  if (!regular(entry.mode)) return true;
  return /["'](?:node:test(?:\/[^"']*)?|vitest|@playwright\/test)["']|(?<![\w.])(?:describe|test|it)(?:\.\w+)*\s*\(/u.test(git("cat-file", "blob", entry.blob).toString());
}

function textField(value, field) {
  assert.ok(typeof value === "string" && value.trim(), `Missing admission field: ${field}`);
}

function isDiscoveryInput(file) {
  return /^server\/(?:.*\/)?test\/|^client\/(?:test|e2e)\//u.test(file) ||
    (/^server\//u.test(file) && runnerName(file)) || /\.(test|spec)\.[cm]?[jt]sx?$/iu.test(file);
}

function registrations(entry, file) {
  if (!entry || !regular(entry.mode) || !/\.[cm]?[jt]sx?$/u.test(file)) return [];
  const source = git("cat-file", "blob", entry.blob).toString();
  const literals = /(?<![\w.])(?:test|it|[a-zA-Z_$][\w$]*Test)(?:\.(?:skip|todo|only|concurrent))*\s*\(\s*(["'`])((?:\\.|(?!\1)[^\r\n])*)\1/gu;
  return [...source.matchAll(literals)].map(match => match[2]);
}

function classify(file, declaration, previous, candidate, catalogClaims) {
  const { kind, cases, capacityIds } = declaration;
  assert.ok(["functional", "capacity", "mixed", "support", "manual"].includes(kind), `Unclassified: ${file}`);
  if (!candidate) return;
  assert.ok(regular(candidate.mode), `Test input must be a regular file: ${file}`);
  if (kind === "manual") {
    assert.ok(/^(server|client)\/test-capacity\//u.test(file) && !runnerName(file) && !/(?:^|\/)test\//u.test(file),
      `Manual capacity must be outside automatic test discovery: ${file}`);
  }
  if (kind !== "support") {
    assert.ok(Array.isArray(cases) && cases.length && cases.every(name => typeof name === "string" && name.trim()), `List affected cases or workload families: ${file}`);
  } else if (isDiscoveryInput(file)) {
    assert.fail(`A discovered test file requires a case classification: ${file}`);
  }
  const oldNames = new Set(registrations(previous, file));
  for (const name of registrations(candidate, file)) {
    if (!oldNames.has(name)) assert.ok(cases?.includes(name), `Unclassified new test in ${file}: ${name}`);
  }
  if (kind === "capacity" || kind === "mixed") {
    assert.ok(Array.isArray(capacityIds) && capacityIds.length && capacityIds.every(id => typeof id === "string" && id.trim()), `Capacity catalog IDs required: ${file}`);
    for (const id of capacityIds) catalogClaims.push({ file, id, names: cases });
  } else {
    assert.ok(capacityIds === undefined, `Capacity IDs require capacity or mixed classification: ${file}`);
  }
}

export function checkAdmission(base, head, approved = allow) {
  const before = tree(base), after = tree(head);
  const changed = new Map();
  const paths = [...new Set([...before.keys(), ...after.keys()])].filter(file => {
    const a = before.get(file), b = after.get(file);
    return a?.blob !== b?.blob || a?.mode !== b?.mode;
  });
  const assets = [...new Set(paths.filter(file => !/\.[cm]?[jt]sx?$/u.test(file)).map(file => path.posix.basename(file)))];
  const baseReferences = referencedData(assets, base, before), headReferences = referencedData(assets, head, after);
  for (const file of paths) {
    const a = before.get(file), b = after.get(file);
    if (file.startsWith(receipts)) continue;
    if (sensitive(file, a, baseReferences) || sensitive(file, b, headReferences)) changed.set(file, b);
  }

  const covered = new Set(), catalogClaims = [];
  for (const [file, entry] of after) {
    if (!file.startsWith(receipts)) continue;
    assert.ok(/^\.github\/test-admissions\/[a-z0-9-]+\.json$/u.test(file) && regular(entry.mode), `Invalid receipt: ${file}`);
    const bytes = git("cat-file", "blob", entry.blob);
    const digest = sha256(bytes);
    assert.ok(approved.has(digest), `Missing Sam approval for ${file}: ${digest}`);
    const record = JSON.parse(bytes.toString());
    assert.equal(record.version, 1);
    for (const key of ["decision", "purpose", "data", "concurrency", "repetitions", "thresholds", "trigger", "cost"]) textField(record[key], key);
    assert.ok(Array.isArray(record.files) && record.files.length, `Empty receipt: ${file}`);
    for (const item of record.files) {
      if (paths.includes(item.path)) changed.set(item.path, after.get(item.path));
    }
    // Workload approvals bind the entire case/fixture combination.
    if (!record.files.every(item => item.kind === "support" && (item.path.startsWith(".github/") || item.path === "AGENTS.md" || item.path === "client/vitest.capacity.config.js")) && !record.files.every(item => {
      const current = after.get(item.path);
      return item.blob === (current?.blob ?? null) && item.mode === (current?.mode ?? null);
    })) continue;
    for (const item of record.files) {
      textField(item.path, "path");
      assert.ok(item.blob === null || oid.test(item.blob), `Invalid blob: ${item.path}`);
      const candidate = after.get(item.path);
      if (item.blob !== (candidate?.blob ?? null) || item.mode !== (candidate?.mode ?? null)) continue;
      if (!changed.has(item.path) && !item.capacityIds) continue;
      classify(item.path, item, before.get(item.path), candidate, catalogClaims);
      if (changed.has(item.path)) {
        assert.ok(!covered.has(item.path), `Ambiguous approvals for ${item.path}`);
        covered.add(item.path);
      }
    }
  }
  const missing = [...changed].filter(([file]) => !covered.has(file));
  assert.equal(missing.length, 0, 'Unapproved test inputs (path, Git mode and blob; null means removed):\n' +
    missing.map(([file, entry]) => JSON.stringify([file, entry?.mode ?? null, entry?.blob ?? null])).join("\n"));
  return { inputs: changed.size, catalogClaims, changed: [...changed.keys()] };
}

async function auditedCatalog() {
  // Read only the two immutable modules at the reviewed baseline, without loading
  // test files or treating a PR-supplied catalog as its own comparison baseline.
  const dir = mkdtempSync(path.join(tmpdir(), "ci-admission-catalog-"));
  try {
    for (const name of ["capacity-cases.mjs", "fulfillment-capacity.mjs"]) {
      writeFileSync(path.join(dir, name), git("show", `${baseline}:.github/scripts/${name}`));
    }
    return (await import(pathToFileURL(path.join(dir, "capacity-cases.mjs")).href)).cases;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function verifyCatalog(result, catalog, audited, supportedScopes) {
  const claims = new Map(result.catalogClaims.map(c => [c.id, c]));
  for (const { file, id, names } of claims.values()) {
    const entry = catalog.find(c => c.id === id && c.file === file);
    assert.ok(entry && entry.names.every(name => names.includes(name)), `Missing exact capacity classification: ${file} / ${id}`);
  }
  for (const previous of audited) {
    assert.ok(catalog.some(c => c.id === previous.id), `Audited capacity removed: ${previous.id}`);
  }
  for (const entry of catalog) {
    assert.ok(supportedScopes.includes(entry.scope), `Unmapped capacity scope: ${entry.id}`);
    assert.ok(entry.group === "client" ? entry.file.startsWith("client/") : entry.file.startsWith("server/") &&
      ["customer", "framework", "fulfillment", "sales", "supplier"].includes(entry.group), `Invalid capacity group/platform: ${entry.id}`);
    const previous = audited.find(c => c.id === entry.id);
    // Existing mixed files keep named routine exclusions. New capacity belongs
    // outside automatic discovery, even if someone forgets a future name filter.
    if (!previous) {
      if (entry.group === "client") assert.ok(entry.file.endsWith(".capacity.js"), `Unsupported client capacity filename: ${entry.file}`);
      assert.ok(/^(server|client)\/test-capacity\//u.test(entry.file) && !isDiscoveryInput(entry.file) && !runnerName(entry.file),
        `New capacity needs a dedicated, non-discovered file: ${entry.id}`);
    }
    if (!previous || JSON.stringify(previous) !== JSON.stringify(entry) ||
        result.changed.includes(entry.file)) {
      assert.ok(claims.get(entry.id)?.file === entry.file, `Approve the affected capacity case and its scale: ${entry.id}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const head = process.env.GITHUB_SHA || "HEAD";
  const result = checkAdmission(baseline, head);
  // Import only after ALL changed CI scripts, tests, fixtures and routing files
  // are approved. Catalog validation reads sources, never executes test cases.
  if (process.argv.includes("--static-only")) {
    process.stdout.write(`Trusted admission accepted ${result.inputs} reviewed inputs at ${head}.\n`);
    process.exit(0);
  }
  const { capacityScopes } = await import(pathToFileURL(path.resolve(".github/scripts/sales-import-capacity.mjs")).href);
  const { cases, validateCatalog } = await import(pathToFileURL(path.resolve(".github/scripts/capacity-cases.mjs")).href);
  validateCatalog();
  verifyCatalog(result, cases, await auditedCatalog(), capacityScopes);
  process.stdout.write(`Test admission passed for ${head}: ${result.inputs} reviewed inputs; ${result.catalogClaims.length} capacity references.\n`);
}
