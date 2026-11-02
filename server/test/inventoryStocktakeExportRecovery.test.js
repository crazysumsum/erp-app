import assert from "node:assert/strict";
import test, { mock } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { parse } from "csv-parse/sync";
import { InventoryStocktakeExportService } from "../src/modules/inventory/InventoryStocktakeExportService.js";

const NOW = 1791763200000;
const real = Object.fromEntries(["mkdtemp", "lstat", "chmod", "open", "unlink", "rmdir", "readdir", "realpath", "rename", "writeFile", "readFile", "symlink", "link"]
  .map(name => [name, fs[name].bind(fs)]));
const tmpdir = os.tmpdir.bind(os);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const fault = code => Object.assign(new Error(`controlled ${code}`), { code });
const unavailable = { code: "INVENTORY_DEPENDENCY_UNAVAILABLE", statusCode: 503 };
const timeout = { code: "REQUEST_TIMEOUT", statusCode: 504 };
function barrier() {
  let enter, release;
  return { entered: new Promise(resolve => { enter = resolve; }), held: new Promise(resolve => { release = resolve; }), enter, release };
}
async function absent(name) {
  await assert.rejects(real.lstat(name), { code: "ENOENT" });
}
async function entry(name) {
  try { return await real.lstat(name); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function altered(stat, changes) {
  return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, changes);
}

// SQL/auth are fake; every successful filesystem operation below is a real syscall.
async function fixture(options = {}) {
  const root = await real.mkdtemp(path.join(await real.realpath(tmpdir()), "inventory-task041-unit-"));
  const owned = new Map([[root, await real.lstat(root)]]), hooks = {}, events = [], audits = [], failures = [], logs = [];
  const f = { root, owned, hooks, events, audits, failures, logs, handles: [], writes: [], reads: [], directories: [], files: [],
    budget: { now: NOW }, readers: { created: 0, closed: 0 }, streams: [], options: {
      stocktakeId: 41, filters: {}, deadline: new Date(NOW + 120000).toISOString(), requestId: "unit041-export", ip: "",
      authorize: async () => ({ id: 7, username: "counter" })
    } };
  f.register = async name => { const stat = await real.lstat(name); owned.set(name, stat); return stat; };
  mock.method(os, "tmpdir", () => root);
  for (const name of ["mkdtemp", "lstat", "chmod", "open", "unlink", "rmdir"]) {
    mock.method(fs, name, async (...args) => {
      await hooks[`before${name}`]?.(...args);
      let result = await real[name](...args);
      events.push({ operation: name, path: args[0], stat: name === "lstat" ? result : undefined });
      if (name === "mkdtemp") {
        f.directory = result; f.directories.push(result); await f.register(result);
      }
      if (name === "open") {
        const handle = result, stat = handle.stat.bind(handle), writeFile = handle.writeFile.bind(handle), read = handle.read.bind(handle), close = handle.close.bind(handle);
        const record = { handle, stat, close, identity: await stat(), closes: 0, stats: 0, inFlight: 0 };
        f.handles.push(record); f.file = args[0]; f.files.push(args[0]); await f.register(args[0]);
        handle.stat = async (...values) => {
          await hooks.beforestat?.(record);
          const value = await stat(...values); record.stats++;
          events.push({ operation: "stat", fd: handle.fd, stat: value });
          return await hooks.stat?.(value, record) ?? value;
        };
        handle.writeFile = async (...values) => {
          const observation = { fd: handle.fd, stat: await stat(), file: await entry(f.file), directory: await entry(f.directory), bytes: Buffer.byteLength(values[0]) };
          f.writes.push(observation); events.push({ operation: "write", ...observation });
          record.inFlight++;
          try { await hooks.beforewrite?.(values, record); const value = await writeFile(...values); await hooks.afterwrite?.(values, record); return value; }
          finally { record.inFlight--; }
        };
        handle.read = async (...values) => {
          f.reads.push({ fd: handle.fd, stat: await stat() }); events.push({ operation: "read", fd: handle.fd });
          record.inFlight++;
          try { await hooks.beforeread?.(values, record); const value = await read(...values); await hooks.afterread?.(value, record); return value; }
          finally { record.inFlight--; }
        };
        handle.close = async (...values) => {
          assert.equal(record.inFlight, 0, "close must await all started I/O");
          record.closes++; events.push({ operation: "close", fd: handle.fd }); return close(...values);
        };
      }
      result = await hooks[name]?.(result, ...args) ?? result;
      return result;
    });
  }
  const size = options.size ?? 3, scopeCount = options.scopeCount ?? 2;
  const header = { id: 41, stocktake_number: "=ST-41", warehouse_id: 1, status: options.frozen ? "POSTED" : "COUNTING", version: 2,
    started_at: 10, ready_at: options.frozen ? 20 : null };
  const scopes = Array.from({ length: scopeCount }, (_, i) => ({ id: 101 + i, stocktake_id: 41, bin_id: i + 1, bin_code_snapshot: i ? "EMPTY" : "@OLD", bin_code: i ? "EMPTY" : "NOW" }));
  const rowAt = i => ({ id: 201 + i, stocktake_id: 41, stocktake_bin_id: 101, bin_id: 1, sku_id: 12, lot_id: null,
    stock_status: "AVAILABLE", stock_balance_id: 301, snapshot_quantity: 5, snapshot_balance_version: 1,
    counted_quantity: !options.frozen && i < 2 ? null : 3, is_not_found: !options.frozen && i === 1 ? 1 : 0,
    variance_quantity: options.frozen ? -2 : null, version: 2, counted_at: 17, counted_by: 7, movement_id: null,
    bin_code_snapshot: "@OLD", bin_code: "NOW", sku_code: "SKU12", sku_name: '中,"name"\nline',
    lot_number: null, base_uom_id: 1, base_uom_code: "EA" });
  const summary = { totalLines: size, countedLines: 0, notFoundLines: 0, uncountedLines: 0, gainLines: 0, lossLines: 0, zeroLines: 0, corruptLines: 0 };
  for (let i = 0; i < size; i++) {
    const row = rowAt(i), actual = row.is_not_found ? 0 : row.counted_quantity;
    if (row.is_not_found) summary.notFoundLines++;
    else if (row.counted_quantity === null) summary.uncountedLines++;
    else summary.countedLines++;
    const variance = options.frozen ? row.variance_quantity : actual === null ? null : actual - row.snapshot_quantity;
    if (variance === null) continue;
    if (variance > 0) summary.gainLines++;
    else if (variance < 0) summary.lossLines++;
    else summary.zeroLines++;
  }
  const tx = { query: async (sql, params) => {
    await hooks.query?.(sql, params);
    if (sql.includes("FROM inventory_stocktakes")) return [[header]];
    if (sql.includes("COUNT(*)") && sql.includes("inventory_stocktake_bins")) return [[{ total: scopeCount }]];
    if (sql.includes("COUNT(*)") && sql.includes("inventory_stocktake_lines")) return [[summary]];
    if (sql.includes("inventory_stocktake_lines")) {
      const first = Math.max(0, params.at(-2) - 200), length = Math.max(0, Math.min(size - first, params.at(-1)));
      return [Array.from({ length }, (_, i) => rowAt(first + i))];
    }
    if (sql.includes("inventory_stocktake_bins")) return [scopes.filter(scope => scope.id > params.at(-2)).slice(0, params.at(-1))];
    throw new Error("Unexpected export fixture query");
  }, execute: async (sql, params) => { assert.match(sql, /INSERT INTO inventory_audit_logs/u); await hooks.execute?.(sql, params); audits.push(params); return [{ affectedRows: 1 }]; } };
  const database = { query() {}, withTransaction: async work => work(tx) };
  f.service = new InventoryStocktakeExportService({ database, time: { nowMs: () => f.budget.now },
    logger: { error: (...args) => logs.push(args) }, config: { exportMaxRows: options.maxRows ?? 100000 } });
  f.service.createGenerationReader = () => {
    f.readers.created++;
    return { database, initialize: async () => database, close: async () => { f.readers.closed++; } };
  };
  const recordFailed = f.service.audit.recordFailed.bind(f.service.audit);
  f.service.audit.recordFailed = async input => { failures.push(input); return recordFailed(input); };
  f.prepare = async changes => {
    const result = await f.service.prepare({ ...f.options, ...changes }); f.streams.push(result.stream); return result;
  };
  f.csv = async changes => {
    const result = await f.prepare(changes), chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    return { ...result, rows: parse(Buffer.concat(chunks), { columns: true }) };
  };
  f.closed = async () => {
    for (const record of f.handles) {
      assert.equal(record.closes, 1, "owned descriptor closes exactly once");
      await assert.rejects(record.stat(), { code: "EBADF" });
    }
    assert.equal(f.readers.closed, f.readers.created);
  };
  f.noNames = async () => {
    for (const name of [...f.files, ...f.directories]) await absent(name);
    assert.deepEqual(await real.readdir(root), []);
  };
  f.dispose = async () => {
    for (const stream of f.streams) {
      if (!stream.closed) { const terminal = new Promise(resolve => { stream.once("close", resolve); }); stream.on("error", () => {}); stream.destroy(); await terminal; }
    }
    mock.restoreAll();
    for (const record of f.handles) if (record.handle.fd !== -1) await record.close();
    // Test cleanup removes only exact registered inodes; never recurse or sweep a prefix.
    for (const [name, identity] of [...owned].reverse()) {
      const current = await entry(name);
      if (!current) continue;
      assert.ok(same(current, identity), "test cleanup refuses a replacement inode");
      if (current.isDirectory() && !current.isSymbolicLink()) { assert.deepEqual(await real.readdir(name), []); await real.rmdir(name); }
      else await real.unlink(name);
    }
  };
  return f;
}
async function using(options, run) {
  const f = await fixture(options);
  try { await run(f); }
  finally { await f.dispose(); }
}
async function refused(f, changes) {
  let stream;
  try { const result = await f.prepare(changes); stream = result.stream; assert.fail("CSV preparation must fail closed"); }
  catch (error) { assert.equal(error.code, unavailable.code); assert.equal(error.statusCode, 503); }
  finally { if (stream) { const closed = once(stream, "close"); stream.destroy(); await closed; } }
  assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
  assert.equal(f.failures.at(-1)?.errorCode, unavailable.code);
  assert.equal(f.audits.at(-1)?.[7], "FAILED"); await f.closed();
}
async function anonymousWrites(f) {
  assert.ok(f.writes.length > 0);
  const original = f.handles[0].identity;
  for (const observation of f.writes) {
    assert.ok(same(observation.stat, original)); assert.equal(observation.stat.nlink, 0);
    assert.equal(observation.file, null); assert.equal(observation.directory, null);
  }
  assert.equal(f.writes[0].stat.size, 0);
  assert.ok(f.writes.at(-1).stat.size > 0);
  assert.ok(f.reads.every(read => same(read.stat, original) && read.stat.nlink === 0));
}

test("ST041-EU01 original descriptor becomes anonymous before any CSV byte", async () => {
  await using({}, async f => {
    f.hooks.beforewrite = async () => {
      if (f.writes.length !== 1) return;
      const stat = await f.handles[0].stat();
      assert.equal(stat.nlink, 0, "first write must use the original unlinked descriptor"); assert.equal(stat.size, 0);
      assert.ok(same(stat, f.handles[0].identity)); await absent(f.file); await absent(f.directory);
    };
    const result = await f.csv(); await anonymousWrites(f);
    const operations = f.events.map(event => event.operation);
    assert.ok(operations.indexOf("unlink") < operations.indexOf("rmdir"));
    assert.ok(operations.indexOf("rmdir") < operations.indexOf("write"));
    assert.equal(f.handles[0].identity.nlink, 1); assert.equal(f.handles[0].identity.size, 0);
    assert.equal(f.handles[0].identity.mode & 0o7777, 0o600);
    assert.deepEqual(result.rows.map(row => row.recordType), ["SCOPE", "SCOPE", "LINE", "LINE", "LINE", "SUMMARY"]);
    assert.equal(result.rows[2].skuNameCurrent, '中,"name"\nline'); assert.equal(result.rows[0].binCodeSnapshot, "'@OLD");
    assert.equal(result.rows.at(-1).exportedRows, "5"); assert.equal(result.rows.at(-1).truncated, "false");
    await f.closed(); await f.noNames();
  });
});

test("ST041-EU02 changed directory identity preserves the replacement and sentinel", async t => {
  await using({}, async f => {
    let injected = false, sentinel, before;
    f.hooks.open = async handle => {
      const moved = path.join(f.root, "owned-moved");
      await real.rename(f.directory, moved);
      f.owned.delete(f.directory); f.owned.delete(f.file);
      await f.register(moved); await f.register(path.join(moved, "stocktake.csv"));
      // Controlled replacement between acquisition and pre-unlink ownership verification.
      const replacement = await real.mkdtemp(path.join(f.root, "replacement-")); await real.rename(replacement, f.directory); await f.register(f.directory);
      sentinel = path.join(f.directory, "foreign"); await real.writeFile(sentinel, "foreign directory sentinel", { flag: "wx" }); await f.register(sentinel);
      before = digest(await real.readFile(sentinel)); injected = true; return handle;
    };
    await refused(f); assert.equal(injected, true);
    assert.equal(digest(await real.readFile(sentinel)), before);
    assert.ok(same(await real.lstat(f.directory), f.owned.get(f.directory)));
    assert.notEqual((await real.lstat(f.directory)).ino, f.owned.get(path.join(f.root, "owned-moved")).ino);
    assert.ok(f.logs.some(args => args[0] === "inventory.export.cleanup_failed"));
  });
  await t.test("ST041-EU02 directory pathname disappears before pre-unlink proof", async () => using({}, async f => {
    let moved, directoryIdentity, fileIdentity, injected = false;
    f.hooks.stat = async (stat, record) => {
      if (record.stats !== 1 || injected) return stat;
      assert.equal(stat.size, 0); assert.equal(stat.nlink, 1);
      directoryIdentity = await real.lstat(f.directory); fileIdentity = stat;
      moved = path.join(f.root, "owned-directory-disappeared"); await real.rename(f.directory, moved);
      f.owned.delete(f.directory); f.owned.delete(f.file);
      await f.register(moved); await f.register(path.join(moved, "stocktake.csv")); injected = true;
      return stat;
    };
    await refused(f); assert.equal(injected, true); await absent(f.directory); await absent(f.file);
    assert.ok(same(await real.lstat(moved), directoryIdentity));
    const preserved = await real.lstat(path.join(moved, "stocktake.csv"));
    assert.ok(same(preserved, fileIdentity)); assert.equal(preserved.size, 0); assert.equal(preserved.nlink, 1);
    assert.equal(digest(await real.readFile(path.join(moved, "stocktake.csv"))), digest(""));
    assert.deepEqual(await real.readdir(moved), ["stocktake.csv"]);
  }));
});

test("ST041-EU03 changed file inode and symlink preserve foreign data and entries", async t => {
  for (const kind of ["file", "symlink"]) await t.test(`ST041-EU03 ${kind}`, async () => using({}, async f => {
    let sentinel, before, replacement;
    f.hooks.open = async handle => {
      const moved = path.join(f.directory, "owned-empty"); await real.rename(f.file, moved); f.owned.delete(f.file); await f.register(moved);
      sentinel = path.join(f.root, "foreign-target"); await real.writeFile(sentinel, "foreign file sentinel", { flag: "wx" }); await f.register(sentinel);
      if (kind === "symlink") await real.symlink(sentinel, f.file);
      else await real.writeFile(f.file, "foreign replacement", { flag: "wx" });
      replacement = await f.register(f.file); before = digest(await real.readFile(sentinel)); return handle;
    };
    await refused(f); assert.equal(digest(await real.readFile(sentinel)), before);
    assert.ok(same(await real.lstat(f.file), replacement));
    if (kind === "file") assert.equal(digest(await real.readFile(f.file)), digest("foreign replacement"));
    else assert.equal((await real.lstat(f.file)).isSymbolicLink(), true);
  }));
  await t.test("ST041-EU03 file pathname disappears before pre-unlink proof", async () => using({}, async f => {
    const sentinel = path.join(f.root, "foreign-disappearance-sentinel");
    await real.writeFile(sentinel, "foreign disappearance sentinel", { flag: "wx" });
    const sentinelIdentity = await f.register(sentinel), before = digest(await real.readFile(sentinel)); let injected = false;
    f.hooks.stat = async (stat, record) => {
      if (record.stats !== 1 || injected) return stat;
      assert.equal(stat.size, 0); assert.equal(stat.nlink, 1);
      await real.unlink(f.file); injected = true; return stat;
    };
    await refused(f); assert.equal(injected, true); await absent(f.file);
    assert.ok(same(await real.lstat(sentinel), sentinelIdentity)); assert.equal(digest(await real.readFile(sentinel)), before);
  }));
});

test("ST041-EU04 every owner, permission, type, empty and link prerequisite fails closed", async t => {
  const cases = [
    ["directory owner", "directory", stat => ({ uid: stat.uid + 1 })],
    ["directory mode", "directory", () => ({ mode: 0o40755 })],
    ["directory type", "directory", () => ({ isDirectory: () => false })],
    ["directory symlink", "directory", () => ({ isSymbolicLink: () => true })],
    ["file owner", "file", stat => ({ uid: stat.uid + 1 })],
    ["file mode", "file", () => ({ mode: 0o100644 })],
    ["file type", "file", () => ({ isFile: () => false })],
    ["file symlink", "file", () => ({ isSymbolicLink: () => true })],
    ["file size", "file", () => ({ size: 1 })],
    ["file links zero", "file", () => ({ nlink: 0 })],
    ["file links two", "file", () => ({ nlink: 2 })]
  ];
  for (const [name, target, changes] of cases) await t.test(`ST041-EU04 ${name}`, async () => using({}, async f => {
    let touched = 0;
    // Controlled metadata injection; capability success is tested only with native stats in EU01/EU09.
    const inject = stat => { touched++; return altered(stat, changes(stat)); };
    f.hooks.lstat = (stat, name) => name === f.directory && target === "directory" ? inject(stat) : name === f.file && target === "file" ? inject(stat) : stat;
    f.hooks.stat = stat => target === "file" ? inject(stat) : stat;
    await refused(f); assert.ok(touched > 0, "the specified metadata branch was reached");
  }));
  for (const value of [undefined, NaN, "1000", -1]) await t.test(`ST041-EU04 effective UID ${String(value)}`, async () => using({}, async f => {
    let touched = 0;
    mock.method(process, "geteuid", () => { touched++; return value; });
    await refused(f); assert.ok(touched > 0);
  }));
});

test("ST041-EU05 unsupported unlink errno maps to safe 503 without fallback", async t => {
  for (const code of ["EPERM", "EACCES", "EBUSY", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "ENOTEMPTY", "EEXIST", "ENOENT"]) {
    await t.test(`ST041-EU05 ${code}`, async () => using({}, async f => {
      let injected = 0;
      f.hooks.beforeunlink = name => { if (name === f.file && injected++ === 0) throw fault(code); };
      await refused(f); assert.ok(injected > 0); await f.noNames();
      assert.equal(f.handles.length, 1, "no named/memory/alternate-root retry");
    }));
  }
});

test("ST041-EU06 post-unlink descriptor and pathname proof cannot be assumed", async t => {
  for (const kind of ["dev", "ino", "owner", "mode", "type", "size", "links", "entry still visible"]) await t.test(`ST041-EU06 ${kind}`, async () => using({}, async f => {
    let unlinked = false, injected = 0, foreign;
    f.hooks.unlink = async (_value, name) => {
      if (name !== f.file || unlinked) return;
      unlinked = true;
      if (kind === "entry still visible") { await real.writeFile(f.file, "foreign after unlink", { flag: "wx" }); foreign = await f.register(f.file); }
    };
    f.hooks.stat = stat => {
      if (!unlinked || kind === "entry still visible") return stat;
      injected++;
      const changes = { dev: { dev: stat.dev + 1 }, ino: { ino: stat.ino + 1 }, owner: { uid: stat.uid + 1 }, mode: { mode: 0o100644 },
        type: { isFile: () => false }, size: { size: 1 }, links: { nlink: 1 } };
      return altered(stat, changes[kind]);
    };
    await refused(f); assert.equal(unlinked, true);
    if (foreign) { assert.ok(same(await real.lstat(f.file), foreign)); assert.equal(digest(await real.readFile(f.file)), digest("foreign after unlink")); }
    else assert.ok(injected > 0);
  }));
});

test("ST041-EU07 empty-directory removal rejects unsupported, changed and visible results", async t => {
  for (const code of ["EPERM", "EACCES", "EBUSY", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "ENOTEMPTY", "EEXIST", "ENOENT"]) {
    await t.test(`ST041-EU07 ${code}`, async () => using({}, async f => {
      let injected = 0;
      f.hooks.beforermdir = name => { if (name === f.directory && injected++ === 0) throw fault(code); };
      await refused(f); assert.ok(injected > 0); await f.noNames();
    }));
  }
  for (const kind of ["foreign child", "changed identity", "visible after removal"]) await t.test(`ST041-EU07 ${kind}`, async () => using({}, async f => {
    let sentinel, identity, before, injected = false;
    const replace = async () => {
      const replacement = await real.mkdtemp(path.join(f.root, "foreign-dir-")); await real.rename(replacement, f.directory); await f.register(f.directory);
      sentinel = path.join(f.directory, "foreign"); await real.writeFile(sentinel, "foreign directory child", { flag: "wx" }); await f.register(sentinel);
      identity = await real.lstat(f.directory); before = digest(await real.readFile(sentinel));
    };
    if (kind === "visible after removal") f.hooks.rmdir = async (_value, name) => { if (name === f.directory && !injected) { injected = true; await replace(); } };
    else f.hooks.unlink = async (_value, name) => {
      if (name !== f.file || injected) return; injected = true;
      if (kind === "changed identity") {
        const moved = path.join(f.root, "owned-empty-dir"); await real.rename(f.directory, moved); f.owned.delete(f.directory); await f.register(moved); await replace();
      } else {
        sentinel = path.join(f.directory, "foreign"); await real.writeFile(sentinel, "foreign directory child", { flag: "wx" }); await f.register(sentinel);
        identity = await real.lstat(f.directory); before = digest(await real.readFile(sentinel));
      }
    };
    await refused(f); assert.equal(injected, true);
    assert.ok(same(await real.lstat(f.directory), identity)); assert.equal(digest(await real.readFile(sentinel)), before);
  }));
});

test("ST041-EU08 acquisition EIO retains error identity and closes acquired resources", async t => {
  for (const boundary of ["mkdtemp", "open", "chmod", "lstat", "first stat", "later stat", "post-unlink lstat"]) await t.test(`ST041-EU08 ${boundary}`, async () => using({}, async f => {
    const intended = fault("EIO"); let injected = 0, unlinked = false;
    f.hooks.unlink = () => { unlinked = true; };
    const failOnce = () => { if (!injected++) throw intended; };
    if (boundary === "first stat") f.hooks.beforestat = failOnce;
    else if (boundary === "later stat") f.hooks.beforestat = record => { if (record.stats >= 1) failOnce(); };
    else if (boundary === "post-unlink lstat") f.hooks.beforelstat = name => { if (unlinked && name === f.file) failOnce(); };
    else f.hooks[`before${boundary}`] = failOnce;
    await assert.rejects(f.csv(), error => error === intended);
    assert.ok(injected > 0); assert.equal(f.writes.length, 0); await f.closed(); await f.noNames();
    assert.equal(f.failures.at(-1)?.errorCode, "EIO"); assert.equal(f.audits.at(-1)?.[7], "FAILED");
  }));
  for (const point of ["mkdtemp acquired", "open acquired"]) await t.test(`ST041-EU08 ${point}`, async () => using({}, async f => {
    const controller = new AbortController(), intended = new Error("abort after acquisition");
    f.hooks[point.startsWith("mkdtemp") ? "mkdtemp" : "open"] = result => { controller.abort(intended); return result; };
    await assert.rejects(f.csv({ signal: controller.signal }), error => error === intended);
    assert.equal(f.writes.length, 0); await f.closed(); await f.noNames();
  }));
});

test("ST041-EU09 EOF preserves full, zero-line, frozen and row-limit CSV contracts", async t => {
  for (const options of [{ size: 3 }, { size: 0 }, { size: 3, frozen: true }, { size: 1200, maxRows: 503 }]) {
    await t.test(`ST041-EU09 ${JSON.stringify(options)}`, async () => using(options, async f => {
      const result = await f.csv(), rows = result.rows, summary = rows.at(-1);
      await anonymousWrites(f); assert.equal(summary.recordType, "SUMMARY"); assert.equal(summary.scopeCount, "2");
      assert.equal(summary.filteredLineCount, String(options.size));
      assert.equal(summary.exportedRows, String(Math.min(options.size + 2, options.maxRows ?? 100000)));
      assert.equal(rows.filter(row => row.recordType === "SCOPE").length, 2);
      assert.equal(rows.filter(row => row.recordType === "LINE").length, Math.min(options.size, (options.maxRows ?? 100000) - 2));
      assert.equal(summary.truncationReason, options.maxRows ? "ROW_LIMIT" : "NONE");
      assert.equal(summary.truncated, String(Boolean(options.maxRows))); assert.equal(summary.generationBudgetMs, "60000");
      assert.match(summary.filterHash, /^[a-f0-9]{64}$/u); assert.equal(summary.varianceStage, options.frozen ? "FROZEN" : "PREVIEW");
      if (options.size === 3 && !options.frozen) assert.deepEqual(rows.filter(row => row.recordType === "LINE").map(row => [row.actualQuantity, row.varianceQuantity, row.countState]),
        [["", "", "UNCOUNTED"], ["0", "-5", "NOT_FOUND"], ["3", "-2", "COUNTED"]]);
      assert.ok(f.reads.length >= 2, "EOF is read through the original descriptor");
      assert.equal(f.audits[0][7], "SUCCEEDED"); await f.closed(); await f.noNames();
    }));
  }
});

test("ST041-EU10 abort and destroy await started I/O and never disclose late chunks", async t => {
  await t.test("ST041-EU10 FAILED Audit settles before stream terminal events", async () => using({}, async f => {
    const intended = fault("EIO"), gate = barrier(), terminal = []; let chunks = 0;
    f.hooks.afterread = result => { assert.ok(result.bytesRead > 0); throw intended; };
    f.hooks.execute = async (_sql, params) => {
      if (params[7] !== "FAILED") return;
      gate.enter(); await gate.held;
    };
    const { stream } = await f.prepare(), writes = f.writes.length;
    const failedCount = () => f.audits.filter(params => params[7] === "FAILED").length;
    stream.on("error", error => terminal.push({ event: "error", error, failed: failedCount() }));
    stream.on("close", () => terminal.push({ event: "close", failed: failedCount() }));
    const closed = new Promise(resolve => { stream.once("close", resolve); });
    stream.on("data", () => { chunks++; });
    try {
      const reached = await Promise.race([gate.entered.then(() => true), closed.then(() => false)]);
      assert.equal(reached, true, "FAILED executor must be reached");
      assert.equal(failedCount(), 0, "FAILED executor is still held");
      assert.deepEqual(terminal, [], "terminal events must await FAILED Audit settlement");
      assert.equal(chunks, 0);
      gate.release(); await closed;
      assert.deepEqual(terminal, [{ event: "error", error: intended, failed: 1 }, { event: "close", failed: 1 }]);
      assert.equal(f.failures.length, 1); assert.equal(f.failures[0].errorCode, "EIO");
      assert.equal(failedCount(), 1); assert.equal(chunks, 0);
      assert.equal(f.reads.length, 1); assert.equal(f.writes.length, writes);
      await f.closed(); await f.noNames();
    } finally { gate.release(); await closed; }
  }));
  await t.test("ST041-EU10 abort after anonymous preparation before first write", async () => using({}, async f => {
    const controller = new AbortController(), intended = new Error("abort before CSV"), gate = barrier(); let held = false;
    f.hooks.rmdir = async (_value, name) => { if (name === f.directory && !held) { held = true; gate.enter(); await gate.held; } };
    const preparing = f.prepare({ signal: controller.signal }); void preparing.catch(() => {});
    try {
      const reached = await Promise.race([gate.entered.then(() => true), preparing.then(() => false, () => false)]);
      assert.equal(reached, true, "anonymous prewrite checkpoint must precede prepare completion");
      controller.abort(intended); assert.equal(f.handles[0].closes, 0); assert.equal(f.writes.length, 0);
      gate.release(); await assert.rejects(preparing, error => error === intended);
      assert.equal(f.writes.length, 0); await f.closed(); await f.noNames();
    } finally { gate.release(); }
  }));
  await t.test("ST041-EU10 destroy before first next", async () => using({}, async f => {
    const { stream } = await f.prepare(), terminal = once(stream, "close"); stream.destroy(); await terminal;
    assert.equal(f.reads.length, 0); await anonymousWrites(f); await f.closed(); await f.noNames();
  }));
  for (const kind of ["abort", "read error"]) await t.test(`ST041-EU10 ${kind} while native read is settling`, async () => using({}, async f => {
    const controller = new AbortController(), intended = fault(kind === "abort" ? "REQUEST_ABORTED" : "EIO"), gate = barrier(); let chunks = 0;
    f.hooks.afterread = async () => { gate.enter(); await gate.held; if (kind === "read error") throw intended; };
    const { stream } = await f.prepare({ signal: controller.signal });
    stream.on("data", () => { chunks++; });
    const terminal = new Promise(resolve => { stream.once("error", error => resolve(error)); stream.once("close", () => resolve(null)); });
    try {
      await gate.entered;
      if (kind === "abort") controller.abort(intended);
      assert.equal(f.handles[0].closes, 0); assert.equal(chunks, 0);
      gate.release(); assert.equal(await terminal, intended); if (!stream.closed) await once(stream, "close");
      assert.equal(chunks, 0); assert.equal(f.reads.length, 1); await f.closed(); await f.noNames();
    } finally { gate.release(); }
  }));
});

test("ST041-EU11 real I/O error objects remain failures with no later I/O", async t => {
  for (const code of ["EIO", "ENOSPC", "EDQUOT"]) for (const point of ["first write", "second write", "footer", "read"]) {
    await t.test(`ST041-EU11 ${point} ${code}`, async () => using({}, async f => {
      const intended = fault(code); let injected = 0, terminalWrites;
      f.hooks.beforewrite = values => {
        const selected = point === "first write" ? f.writes.length === 1 : point === "second write" ? f.writes.length === 2 :
          point === "footer" && parse(values[0], { relax_column_count: true })[0]?.[0] === "SUMMARY";
        if (selected) { injected++; terminalWrites = f.writes.length; throw intended; }
      };
      if (point === "read") f.hooks.beforeread = () => { injected++; terminalWrites = f.writes.length; throw intended; };
      await assert.rejects(f.csv(), error => error === intended);
      assert.equal(injected, 1); assert.equal(f.writes.length, terminalWrites);
      assert.equal(f.reads.length, point === "read" ? 1 : 0);
      assert.equal(f.failures.at(-1)?.errorCode, code); assert.equal(f.audits.at(-1)?.[7], "FAILED");
      await f.closed(); await f.noNames();
    }));
  }
});

test("ST041-EU12 unlink, rmdir and metadata waits spend the original generation budget", async t => {
  for (const point of ["unlink", "rmdir", "metadata"]) await t.test(`ST041-EU12 ${point}`, async () => using({}, async f => {
    const gate = barrier(); let held = false;
    const hold = async () => { if (held) return; held = true; gate.enter(); await gate.held; };
    if (point === "metadata") f.hooks.lstat = async (stat, name) => { if (f.file && name === f.directory) await hold(); return stat; };
    else f.hooks[point] = async (_value, name) => { if (name === (point === "unlink" ? f.file : f.directory)) await hold(); };
    const preparing = f.prepare({ deadline: new Date(NOW + 80000).toISOString() }); void preparing.catch(() => {});
    try {
      const reached = await Promise.race([gate.entered.then(() => true), preparing.then(() => false, () => false)]);
      assert.equal(reached, true, "budgeted prewrite checkpoint must precede prepare completion");
      f.budget.now = NOW + 40000;
      assert.equal(f.handles[0].closes, 0, "pending native operation is still owned"); assert.equal(f.writes.length, 0);
      gate.release(); await assert.rejects(preparing, timeout);
      assert.equal(f.writes.length, 0); await f.closed(); await f.noNames();
      assert.equal(f.failures.at(-1)?.errorCode, "REQUEST_TIMEOUT");
      f.budget.now = NOW; delete f.hooks.unlink; delete f.hooks.rmdir; delete f.hooks.lstat;
      const next = await f.csv(); assert.equal(next.rows.at(-1).generationBudgetMs, "60000");
      await f.closed(); await f.noNames();
    } finally { gate.release(); }
  }));
});
