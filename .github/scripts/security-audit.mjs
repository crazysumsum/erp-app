import { spawnSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

// shortcut: Accept this advisory on this lock only; remove when official fixed dependencies are adopted.
const advisoryUrl = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const lockHash = "740e639b58b82ed6fe324f0f8c3303075805a93eacba4baa892a46b5221343e7";
const copies = {
  "node_modules/tinyglobby/node_modules/picomatch": "4.0.5",
  "node_modules/unplugin-utils/node_modules/picomatch": "4.0.5",
  "node_modules/unplugin/node_modules/picomatch": "4.0.5",
  "node_modules/vite/node_modules/picomatch": "4.0.5",
  "node_modules/vitest/node_modules/picomatch": "4.0.7",
  "node_modules/vue-router/node_modules/picomatch": "4.0.5"
};
const levels = ["info", "low", "moderate", "high", "critical"];
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export const auditArgs = Object.freeze([
  "audit", "--json", "--audit-level=high", "--audit=true", "--global=false", "--package-lock=true", "--package-lock-only=true", "--workspaces=true",
  "--workspace=client", "--workspace=server", "--include-workspace-root=true",
  "--include=prod", "--include=dev", "--include=optional", "--include=peer"
]);

export function auditEnvironment(environment) {
  const scopeKeys = new Set(["omit", "include", "workspace", "workspaces", "include_workspace_root", "global", "prefix", "package_lock", "package_lock_only", "production", "only"]);
  return Object.fromEntries(Object.entries(environment).filter(([key]) => {
    const normalized = key.toLowerCase().replaceAll("-", "_");
    return !normalized.startsWith("npm_config_") || !scopeKeys.has(normalized.slice(11));
  }));
}

export function evaluateAudit(stdout, nativeExit, lockBytes) {
  requireValue(nativeExit === 0 || nativeExit === 1, "Unexpected npm audit exit status");
  requireValue(createHash("sha256").update(lockBytes).digest("hex") === lockHash, "Exception lockfile drift");
  const lock = JSON.parse(lockBytes), report = JSON.parse(stdout);
  requireValue(object(report) && !Object.hasOwn(report, "error") && report.auditReportVersion === 2,
    "Unsupported or failed npm audit report");
  requireValue(object(report.vulnerabilities) && object(report.metadata?.vulnerabilities), "Missing audit data");
  for (const [path, version] of Object.entries(copies)) {
    requireValue(lock.packages?.[path]?.version === version, "Exception package/version mismatch");
  }
  const vulnerabilities = report.vulnerabilities, counts = Object.fromEntries(levels.map((level) => [level, 0]));
  function lockedDependency(path, name) {
    const dependencies = { ...lock.packages[path].dependencies, ...lock.packages[path].optionalDependencies, ...lock.packages[path].peerDependencies };
    if (!Object.hasOwn(dependencies, name)) return null;
    for (let at = path; ; at = at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : "") {
      const candidate = `${at ? at + "/" : ""}node_modules/${name}`;
      if (Object.hasOwn(lock.packages, candidate)) return candidate;
      if (!at) return null;
    }
  }
  for (const [name, value] of Object.entries(vulnerabilities)) {
    requireValue(object(value) && value.name === name && levels.includes(value.severity), "Unknown vulnerability entry");
    requireValue(Array.isArray(value.nodes) && value.nodes.length > 0 && new Set(value.nodes).size === value.nodes.length,
      "Missing or duplicate vulnerable nodes");
    requireValue(value.nodes.every((path) => typeof path === "string" && Object.hasOwn(lock.packages, path)
      && path.split("node_modules/").at(-1) === name), "Audit node does not match locked package");
    requireValue(Array.isArray(value.via) && value.via.length > 0, "Missing vulnerability provenance");
    for (const via of value.via) {
      requireValue(typeof via === "string" ? Object.hasOwn(vulnerabilities, via)
        : object(via) && typeof via.url === "string" && typeof via.name === "string"
          && typeof via.dependency === "string" && levels.includes(via.severity), "Unknown vulnerability provenance");
      if (typeof via === "string") {
        requireValue(value.nodes.some((path) => Array.isArray(vulnerabilities[via].nodes)
          && vulnerabilities[via].nodes.includes(lockedDependency(path, via))), "Audit provenance is not a locked dependency edge");
      }
    }
    counts[value.severity] += 1;
  }
  counts.total = Object.keys(vulnerabilities).length;
  requireValue(Object.entries(counts).every(([level, count]) => report.metadata.vulnerabilities[level] === count),
    "Inconsistent npm vulnerability counters");
  requireValue(nativeExit === (counts.high + counts.critical > 0 ? 1 : 0), "Audit status disagrees with high threshold");
  const roots = new Map(Object.entries(vulnerabilities).map(([name, value]) => [name,
    new Set(value.via.filter((via) => typeof via !== "string").map((via) => ({ owner: name, advisory: via })))
  ]));
  // Union direct advisory roots until stable; real npm peer cycles are valid, rootless graphs are not.
  let changed;
  do {
    changed = false;
    for (const [name, value] of Object.entries(vulnerabilities)) {
      for (const via of value.via.filter((item) => typeof item === "string")) {
        for (const root of roots.get(via)) {
          if (!roots.get(name).has(root)) {
            roots.get(name).add(root);
            changed = true;
          }
        }
      }
    }
  } while (changed);
  requireValue([...roots.values()].every((value) => value.size > 0), "Vulnerability provenance has no advisory root");
  const isAcceptedRoot = ({ owner, advisory }) => owner === "picomatch" && advisory.name === "picomatch"
    && advisory.dependency === "picomatch" && advisory.url === advisoryUrl && advisory.severity === "high";
  const gated = Object.keys(vulnerabilities).filter((name) => ["high", "critical"].includes(vulnerabilities[name].severity));
  const accepted = gated.filter((name) => {
    const highRoots = [...roots.get(name)].filter(({ advisory }) => ["high", "critical"].includes(advisory.severity));
    return vulnerabilities[name].severity === "high" && highRoots.length > 0 && highRoots.every(isAcceptedRoot);
  });
  if (accepted.length) {
    requireValue(vulnerabilities.picomatch?.severity === "high"
      && JSON.stringify([...vulnerabilities.picomatch.nodes].sort()) === JSON.stringify(Object.keys(copies).sort()),
    "Accepted advisory must cover exactly the six locked copies");
  }
  const otherDirectHigh = Object.entries(vulnerabilities).filter(([owner, value]) => value.via.some((via) =>
    typeof via !== "string" && ["high", "critical"].includes(via.severity) && !isAcceptedRoot({ owner, advisory: via })
  )).map(([name]) => name);
  return { nativeExit, accepted, blocking: [...new Set([...gated.filter((name) => !accepted.includes(name)), ...otherDirectHigh])], counts };
}

function main() {
  requireValue(process.argv.length === 2, "security:audit does not accept extra arguments");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  requireValue(JSON.stringify(manifest.workspaces) === JSON.stringify(["client", "server"]), "Audit workspace scope drift");
  const result = spawnSync("npm", [...auditArgs, `--prefix=${root}`], {
    cwd: root, env: auditEnvironment(process.env), encoding: "utf8", maxBuffer: 16 * 1024 * 1024
  });
  const stdout = result.stdout ?? "";
  try {
    console.log(JSON.stringify(JSON.parse(stdout), null, 2));
  } catch {
    console.error(JSON.stringify({ npmAuditStdout: stdout }));
    throw new Error("npm audit did not return valid JSON");
  }
  if (result.stderr) console.error(JSON.stringify({ npmAuditStderr: result.stderr }));
  requireValue(!result.error && !result.signal, "npm audit process failed");
  const decision = evaluateAudit(stdout, result.status, readFileSync(new URL("../../package-lock.json", import.meta.url)));
  console.log(JSON.stringify({
    status: decision.blocking.length ? "AUDIT_BLOCKED" : decision.accepted.length ? "AUDIT_ACCEPTED_EXCEPTION" : "AUDIT_NATIVE_PASS",
    advisory: advisoryUrl, ...decision,
    note: "Accepted exception is not zero vulnerabilities; all original counts and the complete npm report remain above."
  }));
  return decision.blocking.length ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(JSON.stringify({ status: "AUDIT_BLOCKED", reason: error.message }));
    process.exitCode = 1;
  }
}
