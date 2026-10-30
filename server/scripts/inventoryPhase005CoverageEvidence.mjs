import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const hash = value => createHash("sha256").update(value).digest("hex");
const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const thresholds = { lines: 92, branches: 83, functions: 90 };
const json = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function validateCiContext(env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "A real GitHub job is required");
  assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/u);
  assert.match(env.GITHUB_RUN_ID ?? "", /^[1-9][0-9]*$/u);
  assert.match(env.GITHUB_RUN_ATTEMPT ?? "", /^[1-9][0-9]*$/u);
  assert.ok(["server-tests", "regression"].includes(env.GITHUB_JOB), "Unexpected CI job");
  if (env.GITHUB_JOB === "server-tests") assert.match(env.INVENTORY_CI_MYSQL_CONTAINER ?? "", /^[a-f0-9]{64}$/u);
  return { commit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT), job: env.GITHUB_JOB };
}

export function validateContainerIdentity(container, expectedId) {
  assert.match(expectedId, /^[a-f0-9]{64}$/u);
  assert.equal(container.Id, expectedId, "Foreign service container");
  assert.equal(container.Config.Image, "mysql:26.7.0");
  assert.match(container.Image, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(container.State.OOMKilled, false);
  assert.equal(container.State.Dead, false);
  return { id: container.Id, image: container.Image, configuredImage: container.Config.Image };
}

export function validateTerminalState(state) {
  for (const key of ["connections", "transactions", "locks"]) assert.equal(state[key], 0, `SQL ${key} not terminal`);
  assert.equal(state.observerSocketClosed, true);
  assert.equal(state.containerExitCode, 0);
  assert.equal(state.forced, false);
  return state;
}

export function buildMergeRecord({ before, after, outcome, lcovSha256, parts }) {
  assert.deepEqual(before, after, "Coverage execution inputs changed");
  assert.ok(hex(before.source) && hex(before.plan));
  assert.match(before.commit, /^[a-f0-9]{40}$/u);
  assert.match(before.node, /^v26\./u);
  assert.match(before.npm, /^[0-9]+\.[0-9]+\.[0-9]+/u);
  assert.ok(path.isAbsolute(before.cwd));
  assert.equal(before.command, "npm run test:coverage:merge --workspace server");
  assert.deepEqual(before.thresholds, thresholds);
  assert.ok(before.inputs && Object.keys(before.inputs).length > 0);
  assert.deepEqual(outcome, { exitCode: 0, signal: null });
  assert.ok(hex(lcovSha256));
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.map(part => part.shard).sort(), [1, 2, 3, 4]);
  assert.equal(new Set(parts.map(part => part.sha256)).size, 4);
  const first = parts[0];
  for (const part of parts) {
    assert.ok(hex(part.sha256));
    assert.equal(part.commit, before.commit);
    assert.equal(part.run_id, first.run_id);
    assert.equal(part.attempt, first.attempt);
    assert.match(String(part.run_id), /^[1-9][0-9]*$/u);
    assert.ok(Number.isSafeInteger(part.attempt) && part.attempt > 0);
  }
  return { kind: "NATIVE_EXECUTION", ...before, outcome, lcovSha256, parts };
}

async function fileHash(filename) { return hash(await fs.readFile(filename)); }
async function command(executable, argv, timeout = 10000) {
  return execute(executable, argv, { timeout, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" });
}
async function atomicJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = filename + "." + randomUUID() + ".tmp";
  const handle = await fs.open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temporary, filename);
}
export async function sourceSnapshot(repo) {
  const { stdout } = await command("git", ["-C", repo, "ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const tracked = new Set((await command("git", ["-C", repo, "ls-files", "--cached", "-z"])).stdout.split("\0"));
  const records = [], outputs = {};
  for (const name of [...new Set(stdout.split("\0").filter(Boolean))].sort()) {
    if (name === "docs/inventory_management" || name.startsWith("docs/inventory_management/")) continue;
    assert.ok(!path.isAbsolute(name) && !name.split("/").includes(".."));
    const absolute = path.join(repo, name);
    let info;
    try { info = await fs.lstat(absolute); }
    catch (error) { if (error.code === "ENOENT") { records.push([name, "deleted"]); continue; } throw error; }
    if (["server/capacity.tap", "server/import-capacity.tap"].includes(name)) {
      assert.ok(!tracked.has(name) && info.isFile() && !info.isSymbolicLink(), "Generated output must not replace tracked source");
      outputs[name] = { sha256: await fileHash(absolute) }; continue;
    }
    if (info.isSymbolicLink()) records.push([name, "symlink", await fs.readlink(absolute)]);
    else { assert.ok(info.isFile()); records.push([name, Boolean(info.mode & 0o111), await fileHash(absolute)]); }
  }
  return { source: hash(json(records)), records, outputs };
}
async function installedSnapshot(repo) {
  const records = {};
  async function visit(relative) {
    const filename = path.join(repo, relative);
    let info;
    try { info = await fs.lstat(filename); }
    catch (error) { if (error.code === "ENOENT") { records[relative] = { absent: true }; return; } throw error; }
    if (info.isSymbolicLink()) {
      const target = await fs.realpath(filename);
      assert.ok(target.startsWith(repo + path.sep), "Unreviewed external installed dependency");
      const targetInfo = await fs.stat(target);
      records[relative] = { symlink: await fs.readlink(filename), realpath: target,
        targetSha256: targetInfo.isFile() ? await fileHash(target) : null };
    } else if (info.isDirectory()) {
      records[relative] = { directory: true };
      for (const name of (await fs.readdir(filename)).sort()) await visit(relative + "/" + name);
    } else {
      assert.ok(info.isFile()); records[relative] = { sha256: await fileHash(filename), executable: Boolean(info.mode & 0o111) };
    }
  }
  for (const base of ["node_modules", "server/node_modules", "client/node_modules"]) await visit(base);
  return records;
}
async function executableSnapshot(name) {
  const filename = (await command("which", [name])).stdout.trim();
  assert.ok(path.isAbsolute(filename));
  const realpath = await fs.realpath(filename);
  return { path: filename, realpath, sha256: await fileHash(realpath) };
}
async function npmSnapshot(executable) {
  let root = path.dirname(executable.realpath);
  for (;;) {
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
      if (metadata.name === "npm") break;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = path.dirname(root); assert.notEqual(parent, root, "Actual npm package root unknown"); root = parent;
  }
  const records = {};
  async function visit(name) {
    const filename = path.join(root, name), info = await fs.lstat(filename);
    if (info.isSymbolicLink()) {
      const resolved = await fs.realpath(filename); assert.ok(resolved.startsWith(root + path.sep));
      const target = await fs.stat(resolved); assert.ok(target.isFile(), "Unsupported npm directory symlink");
      records[name] = { link: await fs.readlink(filename), sha256: await fileHash(resolved) };
    } else if (info.isDirectory()) {
      records[name] = { directory: true };
      for (const child of (await fs.readdir(filename)).sort()) await visit(path.join(name, child));
    } else { assert.ok(info.isFile()); records[name] = { sha256: await fileHash(filename), executable: Boolean(info.mode & 0o111) }; }
  }
  await visit(""); return { root, records };
}
function immutableInputs(snapshot) {
  const immutable = { ...snapshot }; delete immutable.generatedOutputs; return immutable;
}
async function inputs(repo, identity, kind, container) {
  const source = await sourceSnapshot(repo);
  const executables = {};
  for (const name of kind === "shard" ? ["node", "npm", "git", "docker"] : ["node", "npm", "git"]) executables[name] = await executableSnapshot(name);
  const files = {};
  for (const name of ["package.json", "package-lock.json", "server/package.json", ".github/workflows/ci.yml",
    ".github/scripts/merge-server-coverage.test.mjs", "server/scripts/checkCoverageFloors.js",
    "server/scripts/inventoryPhase005CoverageEvidence.mjs", "docs/inventory_management/00_module_manifest.json",
    "docs/inventory_management/00_project_profile.json", "docs/inventory_management/08_traceability.json"]) files[name] = await fileHash(path.join(repo, name));
  const module = JSON.parse(await fs.readFile(path.join(repo, "docs/inventory_management/00_module_manifest.json"), "utf8"));
  const profile = JSON.parse(await fs.readFile(path.join(repo, "docs/inventory_management/00_project_profile.json"), "utf8"));
  const trace = JSON.parse(await fs.readFile(path.join(repo, "docs/inventory_management/08_traceability.json"), "utf8"));
  const specs = {};
  for (const [name, filename] of Object.entries(module.specs)) specs[name] = await fileHash(path.join(repo, module.docs_path, filename));
  const plan = hash(json({ manifest: module, profile, traceability: trace, specs }));
  return { generatedOutputs: source.outputs, source: source.source, commit: identity.commit, plan, node: process.version,
    npm: (await command("npm", ["--version"])).stdout.trim(), cwd: path.join(repo, "server"),
    command: kind === "merge" ? "npm run test:coverage:merge --workspace server" : "npm run test:coverage:shard --workspace server",
    inputs: { recipe: "CI_NODE_NATIVE", source: source.records, files, executables,
      installed: await installedSnapshot(repo), npm: await npmSnapshot(executables.npm), mysql: container,
      platform: { os: process.platform, arch: process.arch, runnerImage: process.env.ImageOS ?? null,
        runnerImageVersion: process.env.ImageVersion ?? null },
      unused: { python: "NOT_USED_BY_REVIEWED_NODE_CI_COMMANDS", harness: "NOT_USED_BY_REVIEWED_NODE_CI_COMMANDS" } },
    thresholds };
}
async function inspectContainer(id) {
  assert.match(id, /^[a-f0-9]{64}$/u);
  const values = JSON.parse((await command("docker", ["inspect", id])).stdout);
  assert.equal(values.length, 1); validateContainerIdentity(values[0], id); return values[0];
}
export async function closeSqlMonitor(db, socket, { timeoutMs = 5000, primary } = {}) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0);
  let timer, recoveryTimer, closed = socket.closed === true;
  const onClose = () => { closed = true; };
  socket.once("close", onClose);
  const close = new Promise(resolve => { if (closed) resolve(); else socket.once("close", resolve); });
  try {
    await Promise.race([Promise.all([Promise.resolve().then(() => db.end()), close]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Monitor end/socket close deadline")), timeoutMs); })]);
  } catch (error) {
    const failure = primary ?? error;
    try { db.destroy(); } catch { /* Preserve the original failure while closing only our transport. */ }
    try { if (!closed) socket.destroy(); } catch { /* A failed close remains UNKNOWN. */ }
    await Promise.race([close, new Promise(resolve => { recoveryTimer = setTimeout(resolve, Math.min(timeoutMs, 1000)); })]);
    const cleanup = { status: closed ? "FORCED_CLOSE_OBSERVED" : "UNKNOWN", observerSocketClosed: closed };
    try { failure.monitorCleanup = cleanup; } catch { /* Immutable external errors remain failures. */ }
    throw failure;
  } finally {
    clearTimeout(timer); clearTimeout(recoveryTimer); socket.removeListener("close", onClose);
  }
  if (primary) throw primary;
}

export async function captureMergeParts(repo, identity) {
  const parts = [];
  for (let shard = 1; shard <= 4; shard += 1) {
    const directory = path.join(repo, `server/coverage/shards/server-coverage-${shard}`);
    const text = await fs.readFile(path.join(directory, "inventory-proof/complete.json"), "utf8"), part = JSON.parse(text);
    assert.equal(part.kind, "CI_NATIVE_SHARD"); assert.equal(part.shard, shard);
    assert.equal(part.identity.commit, identity.commit); assert.equal(part.identity.runId, identity.runId);
    assert.equal(part.identity.attempt, identity.attempt); validateTerminalState(part.terminal);
    assert.equal(await fileHash(path.join(directory, "manifest.json")), part.manifestSha256);
    const files = (await fs.readdir(path.join(directory, "raw"))).sort();
    assert.ok(files.length > 0); assert.equal(part.rawFiles.length, files.length);
    const actual = [];
    for (const name of files) {
      assert.match(name, /^coverage-\d+-\d{13}-\d+\.json$/u);
      const filename = path.join(directory, "raw", name); assert.ok((await fs.lstat(filename)).isFile());
      actual.push({ path: "raw/" + name, sha256: await fileHash(filename) });
    }
    assert.deepEqual(actual, part.rawFiles);
    parts.push({ shard, sha256: hash(text), run_id: identity.runId, attempt: identity.attempt, commit: identity.commit,
      manifestSha256: part.manifestSha256, rawFiles: actual });
  }
  return parts;
}

async function sqlTerminal() {
  const mysql = await import("mysql2/promise");
  const db = await mysql.default.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD, connectTimeout: 2000 });
  const socket = db.connection.stream;
  let closed = false;
  socket.once("close", () => { closed = true; });
  let primary, state;
  try {
    const [[row]] = await db.query({ sql: `SELECT VERSION() AS version,
      (SELECT COUNT(*) FROM performance_schema.threads WHERE TYPE='FOREGROUND' AND PROCESSLIST_ID IS NOT NULL
       AND PROCESSLIST_ID<>CONNECTION_ID() AND PROCESSLIST_COMMAND<>'Daemon') AS connections,
      (SELECT COUNT(*) FROM information_schema.innodb_trx) AS transactions,
      (SELECT COUNT(*) FROM performance_schema.data_locks WHERE OBJECT_SCHEMA NOT IN ('mysql','performance_schema','sys','information_schema')) AS locks`, timeout: 10000 });
    assert.equal(row.version, "26.7.0");
    state = Object.fromEntries(["connections", "transactions", "locks"].map(key => [key, Number(row[key])]));
    for (const key of Object.keys(state)) assert.equal(state[key], 0, `Remaining ${key}`);
  } catch (error) { primary = error; }
  await closeSqlMonitor(db, socket, { timeoutMs: 5000, primary });
  assert.equal(closed, true);
  return { ...state, observerSocketClosed: true };
}

async function main() {
  const [mode, shardText] = process.argv.slice(2);
  assert.ok(["before-shard", "finish-shard", "before-merge", "finish-merge"].includes(mode));
  assert.equal(process.env.NODE_V8_COVERAGE, undefined, "Recorder must not contaminate native coverage");
  const identity = validateCiContext(process.env);
  const kind = mode.endsWith("shard") ? "shard" : "merge";
  assert.equal(identity.job, kind === "shard" ? "server-tests" : "regression");
  const shard = kind === "shard" ? Number(shardText) : null;
  assert.ok(kind === "merge" ? shardText === undefined : Number.isSafeInteger(shard) && shard >= 1 && shard <= 4);
  const repo = (await command("git", ["rev-parse", "--show-toplevel"])).stdout.trim();
  assert.equal(await fs.realpath(process.cwd()), await fs.realpath(repo));
  assert.equal((await command("git", ["rev-parse", "HEAD"])).stdout.trim(), identity.commit);
  const directory = path.join(repo, "server/coverage", kind === "shard" ? "shard/inventory-proof" : "inventory-proof");
  const beforeFile = path.join(directory, "before.json");
  let primary, container, terminal, before, after;
  try {
    if (kind === "shard") {
      const inspected = await inspectContainer(process.env.INVENTORY_CI_MYSQL_CONTAINER);
      container = validateContainerIdentity(inspected, process.env.INVENTORY_CI_MYSQL_CONTAINER);
      assert.equal(inspected.State.Running, true);
    }
    if (mode.startsWith("before-")) {
      const snapshot = await inputs(repo, identity, kind, container ?? null);
      assert.deepEqual(snapshot.generatedOutputs, {}, "Generated capacity outputs must be absent before this job");
      await atomicJson(beforeFile, { kind: "CI_INPUTS_BEFORE", identity, shard, snapshot, ...(kind === "merge" ? { parts: await captureMergeParts(repo, identity) } : {}), at: new Date().toISOString() });
      return;
    }
    before = JSON.parse(await fs.readFile(beforeFile, "utf8"));
    assert.deepEqual(before.identity, identity); assert.equal(before.shard, shard);
    after = await inputs(repo, identity, kind, container ?? null);
    assert.deepEqual(immutableInputs(before.snapshot), immutableInputs(after), "Source, installed dependencies or executable inputs changed");
    assert.equal(process.env.INVENTORY_NATIVE_OUTCOME, "success", "Original native command did not succeed");
    if (kind === "shard") terminal = await sqlTerminal();
  } catch (error) { primary = error; }
  finally {
    if (kind === "shard" && mode === "finish-shard" && container) {
      try {
        await command("docker", ["stop", "--time", "10", container.id], 15000);
        const stopped = await inspectContainer(container.id);
        assert.equal(stopped.State.Running, false);
        const stoppedState = { ...terminal, containerExitCode: stopped.State.ExitCode,
          forced: stopped.State.ExitCode !== 0 || stopped.State.OOMKilled };
        if (!primary) terminal = validateTerminalState(stoppedState);
      } catch (error) { primary ??= error; }
    }
  }
  const endedAt = new Date().toISOString();
  if (primary) {
    await atomicJson(path.join(directory, "failure.json"), { kind: "NATIVE_PROOF_FAILED", identity, shard,
      startedAt: before?.at ?? null, endedAt, error: { name: primary.name, code: primary.code ?? null, monitorCleanup: primary.monitorCleanup ?? null },
      originalOutcome: process.env.INVENTORY_NATIVE_OUTCOME ?? null, terminal: terminal ?? null });
    throw primary;
  }
  const proof = { kind: "CI_NATIVE_SHARD", identity, shard, startedAt: before.at, endedAt,
    before: before.snapshot, after, originalOutcome: "success", terminal };
  if (kind === "merge") {
    const parts = await captureMergeParts(repo, identity);
    assert.deepEqual(parts, before.parts, "Actual consumed manifest/native raw bytes changed during merge");
    const lcov = path.join(repo, "server/coverage/lcov.info");
    assert.match(await fs.readFile(lcov, "utf8"), /^SF:.+/mu);
    Object.assign(proof, buildMergeRecord({ before: immutableInputs(before.snapshot), after: immutableInputs(after),
      outcome: { exitCode: 0, signal: null }, lcovSha256: await fileHash(lcov), parts }));
    proof.kind = "CI_NATIVE_MERGE";
  } else {
    const rawDirectory = path.join(repo, "server/coverage/shard/raw");
    const reports = (await fs.readdir(rawDirectory)).sort(); assert.ok(reports.length);
    proof.rawFiles = await Promise.all(reports.map(async name => {
      assert.match(name, /^coverage-\d+-\d{13}-\d+\.json$/u);
      return { path: "raw/" + name, sha256: await fileHash(path.join(rawDirectory, name)) };
    }));
    proof.manifestSha256 = await fileHash(path.join(repo, "server/coverage/shard/manifest.json"));
  }
  await atomicJson(path.join(directory, "complete.json"), proof);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.name + ": " + error.message); process.exitCode = 1; });
}
