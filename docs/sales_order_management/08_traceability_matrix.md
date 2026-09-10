# Sales Order Management Traceability Matrix

## 1. Mapping Rules

- Canonical-to-legacy one-to-one mappings are defined in `01_requirement_spec.md`, `05_development_tasks.md` and `07_uat_test_cases.md`.
- Every ID listed in a grouped row inherits the complete downstream mapping in that row; ranges in prose are convenience labels only.
- `COMPLETE` means the specification chain exists. It does not mean application code exists or tests passed.
- `BLOCKED IMPLEMENTATION` preserves a complete planning chain while identifying a required Phase-entry decision/evidence.

## 2. Requirement-to-Acceptance Matrix

| Requirement | Legacy source | Design | Phase | Task | Technical Test | UAT | UAT applicability | Origin | Status / Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017 | FR-QUOTE-001–017 | DES-002,003,007,009,012–014 | PHASE-001→002 | TASK-006–022 | TC-003,007–020,060 | UAT-001–021 | REQUIRED | EXISTING | COMPLETE SPEC |
| FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041 | FR-SO-001–024 | DES-002,003,007,009,012–016 | PHASE-001→002→005 | TASK-006–027,052–053 | TC-003,007–010,013,016–020,044,046,060 | UAT-001–007,022–037,092–104 | REQUIRED | EXISTING | COMPLETE SPEC |
| FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061 | FR-CONF-001–020 | DES-002–007,009,013–015 | PHASE-001→003 | TASK-007–011,028–037 | TC-001,003,007–010,018,021–033,060 | UAT-001–007,038–050 | REQUIRED | EXISTING | BLOCKED IMPLEMENTATION: DR-001/002/004 |
| FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075 | FR-LIFE-001–014 | DES-002–007,009,013–015 | PHASE-001→003 | TASK-007–011,028–037 | TC-001,003,007–010,021,024–033,060 | UAT-001–007,051–064 | REQUIRED | EXISTING | BLOCKED IMPLEMENTATION: DR-001/002/004 |
| FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095 | FR-CSV-001–020 | DES-007,009,010,012–015 | PHASE-001→004 | TASK-002–008,011,038–049 | TC-003–010,024–026,034–043,060 | UAT-001–007,065–082 | REQUIRED | EXISTING | BLOCKED IMPLEMENTATION: DR-003/004 |
| FR-096, FR-097, FR-098, FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108 | FR-CH-001–013 | DES-001,003,004,007,009,011,013–015 | PHASE-001→003→004 | TASK-001,006–011,029–032,038,044–049 | TC-001,003,007–010,021–026,037–043,060 | UAT-001–007,083–091 | REQUIRED for canonical contract; real Adapter UAT deferred | EXISTING | CORE SPEC COMPLETE; ADAPTER GO-LIVE BLOCKED DR-007 |
| FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119, FR-120 | FR-INQ-001–012 | DES-008,009,012–016 | PHASE-002→005 | TASK-013–027,050–056,060–063 | TC-003,009,019,020,044–046,050,052–055,060 | UAT-001–007,092–104,120–129 | REQUIRED | EXISTING | COMPLETE SPEC |
| FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140 | FR-ARC-001–020 | DES-003,007,008,009,012,014–020 | PHASE-001→005 | TASK-001,006,009–011,050–063 | TC-001–003,008–010,044–060 | UAT-001–007,105–129 | REQUIRED for business-visible archive/restore | EXISTING | BLOCKED ENABLEMENT: DR-008/009 |
| NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008 | NFR-PERF-001–008 | DES-010,015,016,018,019 | PHASE-001→005 | TASK-002–005,010–011,037,049,052–063 | TC-004–006,010,019,032–033,042–043,044–055,060 | UAT-120–129 where user-visible | PARTIAL: objective technical thresholds dominate | EXISTING | BLOCKED ACCEPTANCE: OI-002 |
| NFR-009, NFR-010, NFR-011, NFR-012, NFR-013, NFR-016 | requirement §13.2–13.6 and archive FR | DES-004,007,008,010–020 | PHASE-001→005 | TASK-001–063 | TC-001–060 | UAT-001–129 where business-observable | PARTIAL; infra details N/A | ENHANCED | COMPLETE SPEC |
| NFR-014, NFR-015 | User-approved DR target | DES-020 | PHASE-001→005 | TASK-001,011,062,063 | TC-056–060 | N/A | NOT_APPLICABLE: objective DR exercise | NEW — USER APPROVED | COMPLETE SPEC / NOT TESTED |
| SEC-001, SEC-002, SEC-003, SEC-004 | requirement §11.1 | DES-003,009,011,013–015 | PHASE-001→005 | TASK-006,009–011,016–063 | TC-001,003,008–010,018–020,030,033,040–046,050–052,060 | UAT-001–007 and each Phase role flow | REQUIRED | EXISTING/ENHANCED | COMPLETE SPEC |
| SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014, SEC-015 | requirement §11.2–11.3; design §5/8 | DES-002,007–015,017,018 | PHASE-001→005 | TASK-002–011,012–063 | TC-003–010,011–060 | UAT-001–007,019,034–037,065–129 as applicable | REQUIRED for visible controls; technical supplement mandatory | EXISTING/ENHANCED | COMPLETE SPEC |

## 3. Design Integrity

| Design IDs | Requirement / constraint rationale | Status |
| --- | --- | --- |
| DES-001–003 | Module ownership and upstream business/master dependencies | CONDITIONAL: provider implementation pending |
| DES-004–007 | Idempotent confirmation, Inventory consistency, backorder and dedupe | CONDITIONAL: Inventory/DBA proof pending |
| DES-008–012 | Persistence, API, files/intake/channel and UI behavior | CONDITIONAL: disk upload and Adapter gates pending |
| DES-013–019 | Security, operations, query/archive/config/performance | CONDITIONAL: implementation and workload evidence pending |
| DES-020 | Approved RTO/RPO and recoverability | SPECIFIED; execution evidence pending |

## 4. Phase / Task Integrity

- PHASE-001 contains TASK-001–011; PHASE-002 contains TASK-012–027; PHASE-003 contains TASK-028–037; PHASE-004 contains TASK-038–049; PHASE-005 contains TASK-050–063.
- Each Phase has an objective, related requirements/designs, entry/dependencies, integration impact, acceptance/technical test set, PR/rollback boundary, exit and status.
- Each canonical Task inherits the complete required fields from its one-to-one legacy task.
- No Phase or Task is complete; no test has been executed.
