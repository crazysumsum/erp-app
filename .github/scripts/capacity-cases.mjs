import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { cases as fulfillmentCases } from "./fulfillment-capacity.mjs";

// Sam approved moving these 32 existing definitions/families on 2026-10-30.
// No workload, assertion, threshold or dormant opt-in suite is added here.
export const auditedCases = [
  {
    "id": "audit-01",
    "group": "framework",
    "scope": "upload",
    "file": "server/test/fileTransfer.test.js",
    "names": [
      "TC-004 bounds warmed 50 MiB disk HTTP upload memory and records the 5 MiB baseline"
    ]
  },
  {
    "id": "audit-02",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/fulfillment/freshReadProofIndexes.test.js",
    "names": [
      "Fresh proof joins retain all100lines/5000members, original order, Short quantities and immutable inputs"
    ]
  },
  {
    "id": "audit-03",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/fulfillment/freshReadProofIndexes.test.js",
    "names": [
      "Cancel fresh grouping preserves allclaims, missinglink rejection and returned-goods requirement"
    ]
  },
  {
    "id": "audit-04",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/fulfillment/fulfillmentAllocationPreview.test.js",
    "names": [
      "HD024 preserves500 Unicode codepoints and complete5000-member request limits"
    ]
  },
  {
    "id": "audit-05",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/fulfillment/fulfillmentPrintProjection.test.js",
    "names": [
      "Pick List admits the full100-line/5000 current-row bound without silently dropping rows"
    ]
  },
  {
    "id": "audit-06",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/fulfillment/inventoryBatchValidation.test.js",
    "names": [
      "Inventory allocation/release/reallocation use a single event payload and independently bound old/new sets"
    ]
  },
  {
    "id": "audit-07",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/fulfillment/postingCandidatePages.test.js",
    "names": [
      "posting candidate bounded cache fallback preserves all rows for oversized prefixes"
    ]
  },
  {
    "id": "audit-08",
    "group": "customer",
    "scope": "customer-contention",
    "file": "server/test/integration/customerOperationalGuards.integration.test.js",
    "names": [
      "LOCAL-083-DEFAULT: 100 same-version commands reconcile defaults, versions and real audit"
    ],
    "parent": "Local TC-080/081/083 real Customer security and contention",
    "prerequisites": [
      "LOCAL-081-DML: real actor, idempotent create, read, update and correlated audit"
    ]
  },
  {
    "id": "audit-09",
    "group": "customer",
    "scope": "customer-contention",
    "file": "server/test/integration/customerOperationalGuards.integration.test.js",
    "names": [
      "LOCAL-083-DECISION: 100 approve/reject contenders produce exactly one audited transition"
    ],
    "parent": "Local TC-080/081/083 real Customer security and contention",
    "prerequisites": [
      "LOCAL-081-DML: real actor, idempotent create, read, update and correlated audit"
    ]
  },
  {
    "id": "audit-10",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/integration/fulfillmentInventoryAllocation.integration.test.js",
    "names": [
      "P0 native100x50 allocation and old/new5000 reallocation complete within the configured transaction budget"
    ]
  },
  {
    "id": "audit-11",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/integration/fulfillmentInventoryAllocation.integration.test.js",
    "names": [
      "P0 legal5000-Reservation membership does not narrow100-line/5000-leg capacity"
    ]
  },
  {
    "id": "audit-12",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/integration/fulfillmentPendingClaims.integration.test.js",
    "names": [
      "HD016 5001 source mappings support planned one and fully claimed earlier 5000 without shrinking the command limit"
    ]
  },
  {
    "id": "audit-13",
    "group": "sales",
    "scope": "sales-confirm",
    "file": "server/test/integration/salesCapacity.integration.test.js",
    "names": [
      "TC-032 50 distinct interactive users with mixed1/100-line HTTP confirmation and actual background jobs (no confirmation warmup)",
      "TC-032 50 distinct interactive users with mixed1/100-line HTTP confirmation and actual background jobs (five confirmation warmups)"
    ],
    "sourceMarker": "`TC-032 50 distinct interactive users with mixed1/100-line HTTP confirmation and actual background jobs (${warm?\"five confirmation warmups\":\"no confirmation warmup\"})`"
  },
  {
    "id": "audit-14",
    "group": "sales",
    "scope": "sales-import",
    "file": "server/test/integration/salesImportPrecheck.integration.test.js",
    "names": [
      "TC-035 real registered worker completes bounded50MiB/100000-row ingestion inside its unchanged30-second deadline"
    ],
    "children": [
      "1000-orders",
      "10000-orders"
    ]
  },
  {
    "id": "audit-15",
    "group": "sales",
    "scope": "sales-sequence",
    "file": "server/test/integration/salesSequenceOperation.integration.test.js",
    "names": [
      "TC-013 Sales sequence service serializes 100 parallel document creates and respects HKT boundaries"
    ]
  },
  {
    "id": "audit-16",
    "group": "supplier",
    "scope": "supplier-duplicates",
    "file": "server/test/integration/supplierDuplicateCandidates.integration.test.js",
    "names": [
      "TASK-050 (HD-084): the bounded search returns what comparing every Supplier would, among names full of common grams"
    ]
  },
  {
    "id": "audit-17",
    "group": "supplier",
    "scope": "supplier-import",
    "file": "server/test/integration/supplierImport.integration.test.js",
    "names": [
      "TASK-043 (REV-064 H-2, IMP-003): a 10,000-row file finishes precheck against 2,000 Suppliers well inside the job timeout"
    ]
  },
  {
    "id": "audit-18",
    "group": "supplier",
    "scope": "supplier-import",
    "file": "server/test/integration/supplierImport.integration.test.js",
    "names": [
      "TASK-045 (HD-048 3): each row, job lock included, finishes far inside DB_TRANSACTION_TIMEOUT_MS"
    ]
  },
  {
    "id": "audit-19",
    "group": "supplier",
    "scope": "supplier-duplicates",
    "file": "server/test/integration/supplierSimilarNameReport.integration.test.js",
    "names": [
      "HD-057 A: thousands of identical or near-identical names finish with bounded output"
    ]
  },
  {
    "id": "audit-20",
    "group": "supplier",
    "scope": "supplier-sku",
    "file": "server/test/integration/supplierSkuRelations.integration.test.js",
    "names": [
      "TASK-038 (REV-086 M-1): creates and first projections above the pool size all succeed"
    ]
  },
  {
    "id": "audit-21",
    "group": "framework",
    "scope": "limiter",
    "file": "server/test/rateLimitKeySpace.test.js",
    "names": [
      "the key space has a hard ceiling, whatever the flood"
    ]
  },
  {
    "id": "audit-22",
    "group": "framework",
    "scope": "limiter",
    "file": "server/test/rateLimitKeySpace.test.js",
    "names": [
      "eviction keeps the source that is actually being limited"
    ]
  },
  {
    "id": "audit-23",
    "group": "sales",
    "scope": "sales-csv",
    "file": "server/test/sales/phase3/salesCsv.test.js",
    "names": [
      "TC-034 50MiB file boundary refuses oversize before callbacks and cleans managed spool"
    ]
  },
  {
    "id": "audit-24",
    "group": "sales",
    "scope": "sales-csv",
    "file": "server/test/sales/phase3/salesCsv.test.js",
    "names": [
      "TC-034 actual10000-order and100000-row limits fail before any precheck callback"
    ]
  },
  {
    "id": "audit-25",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/salesFulfillmentService.test.js",
    "names": [
      "legal 5000-member intent is retained and 5001 members are refused before hashing/journaling"
    ]
  },
  {
    "id": "audit-26",
    "group": "fulfillment",
    "scope": "fulfillment",
    "file": "server/test/salesFulfillmentService.test.js",
    "names": [
      "HD016 pending complete-source capacity never relaxes the selected command 5000-member limit"
    ]
  },
  {
    "id": "audit-27",
    "group": "supplier",
    "scope": "supplier-csv",
    "file": "server/test/supplierCsvSchema.test.js",
    "names": [
      "a file of 10 MB of commas is refused quickly at upload and at precheck (REV-066 M-1)"
    ]
  },
  {
    "id": "audit-28",
    "group": "supplier",
    "scope": "supplier-csv",
    "file": "server/test/supplierCsvSchema.test.js",
    "names": [
      "precheck lets the event loop run while it parses a large file (REV-067 L-1)"
    ]
  },
  {
    "id": "audit-29",
    "group": "framework",
    "scope": "auth",
    "file": "server/test/userService.test.js",
    "names": [
      "authenticate spends the same work on an unknown user as on a wrong password"
    ]
  },
  {
    "id": "audit-30",
    "group": "framework",
    "scope": "auth",
    "file": "server/test/userService.test.js",
    "names": [
      "authenticate spends comparable time on a locked account as on a wrong password"
    ]
  },
  {
    "id": "audit-31",
    "group": "client",
    "scope": "fulfillment-client",
    "file": "client/test/pages/fulfillment/fulfillmentPickListPrint.test.js",
    "names": [
      "renders every returned allocation without local sorting, pagination or quantity arithmetic"
    ]
  },
  {
    "id": "audit-32",
    "group": "client",
    "scope": "fulfillment-client",
    "file": "client/test/pages/fulfillment/fulfillmentPickModel.test.js",
    "names": [
      "reads past5000 retired rows and preserves all current rows and actual CAS"
    ]
  }
];

export const cases = [
  ...auditedCases,
  ...fulfillmentCases.map(([file, name], index) => ({
    id: `fulfillment-${index + 1}`, group: "fulfillment", scope: "fulfillment",
    file: `server/test/integration/${file}.integration.test.js`, names: [name],
    ...(name.startsWith("HD020 full") || name.startsWith("HD024 full")
      ? { sourceMarker: name.startsWith("HD020") ? "`HD020 full100lines/5000members over ${100*balancesPerSku}" : "`HD024 full100lines/5000members over ${100*balancesPerSku}" } : {})
  })),
  { id: "tc042-business", group: "sales", scope: "sales-import",
    file: "server/test/integration/salesImportCapacity.integration.test.js",
    names: ["TC-042 CI business baseline actual2000-order10000-line streaming HTTP CSV with10 foreground users and fixed scheduled workers"] },
  { id: "tc042-grouping", group: "sales", scope: "sales-import",
    file: "server/test/integration/salesImportCapacity.integration.test.js",
    names: ["TC-042 isolated noncontiguous10MiB CSV grouping retains original Phase0 memory bounds"] }
];

export const escapePattern = name => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
export const exactPattern = names => `^(?:${names.map(escapePattern).join("|")})$`;

export function validateCatalog() {
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length, "Duplicate capacity ID");
  for (const entry of cases) {
    const source = readFileSync(fileURLToPath(new URL(`../../${entry.file}`, import.meta.url)), "utf8");
    for (const marker of entry.sourceMarker ? [entry.sourceMarker] : entry.names) {
      assert.ok(source.includes(marker), `Capacity case moved/renamed: ${entry.id}: ${marker}`);
    }
    if (entry.parent) assert.ok(source.includes(entry.parent), `Missing parent: ${entry.id}`);
  }
}

export function routinePattern(client = false) {
  validateCatalog();
  const names = cases.filter(c => (c.group === "client") === client).flatMap(c => c.names);
  // Both runners can prefix a name with its parent/suite; match the complete suffix.
  const suffix = `(?:^| )(?:${names.map(escapePattern).join("|")})$`;
  return client ? `^(?!.*${suffix}).*$` : suffix;
}

export function nodePlan(selected) {
  const parents = [...new Set(selected.flatMap(c => c.parent ? [c.parent] : []))];
  const expected = [...selected.flatMap(c => [...c.names, ...(c.children ?? [])]), ...parents];
  const skips = [];
  for (const parent of parents) {
    const entries = selected.filter(c => c.parent === parent);
    const prerequisites = [...new Set(entries.flatMap(c => c.prerequisites ?? []))];
    expected.push(...prerequisites);
    // Node requires selecting the parent; exclude siblings while retaining its setup case.
    const children = [...entries.flatMap(c => c.names), ...prerequisites];
    skips.push(`^${escapePattern(parent)} (?!(?:${children.map(escapePattern).join("|")})$)`);
  }
  return {
    files: [...new Set(selected.map(c => c.file.slice("server/".length)))],
    pattern: exactPattern([...selected.filter(c => !c.parent).flatMap(c => c.names), ...parents]),
    skip: skips.length ? skips.join("|") : "(?!)",
    expected
  };
}
