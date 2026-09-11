# Item Management Traceability Matrix

## Requirement-to-acceptance traceability

| Requirement | Design | Phase | Task | Technical Test | UAT | UAT Applicability | Status | Origin / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FR-001–FR-010 (list/search/filter/export/states) | DES-001, DES-014, DES-015 | PHASE-002, PHASE-006 | TASK-012, TASK-013, TASK-031, TASK-044 | TC-002, TC-011, TC-012 | UAT-001, UAT-012, UAT-015 | APPLICABLE | IMPLEMENTED; independent NOT_RUN | EXISTING; current UI filter breadth should be confirmed |
| FR-011–FR-015 (detail/history/inventory boundary) | DES-011, DES-012, DES-014, DES-015, DES-020 | PHASE-002, PHASE-003, PHASE-006 | TASK-012, TASK-017, TASK-025, TASK-026, TASK-037, TASK-039, TASK-043 | TC-002, TC-008, TC-010, TC-013 | UAT-002, UAT-010, UAT-013 | APPLICABLE | PARTIAL / HIGH gaps | EXISTING; projection and audit UI remediation open |
| FR-016–FR-024 (create/copy/activate/idempotency) | DES-003, DES-004, DES-008, DES-015 | PHASE-002, PHASE-003, PHASE-006 | TASK-014, TASK-015, TASK-020, TASK-023, TASK-024, TASK-037, TASK-038 | TC-003, TC-011, TC-013 | UAT-003, UAT-004 | APPLICABLE | PARTIAL / owner decision | EXISTING; standalone add-SKU unresolved |
| FR-025–FR-031 (edit/version/critical changes) | DES-003, DES-004, DES-008, DES-020 | PHASE-002, PHASE-006 | TASK-016, TASK-017, TASK-020, TASK-037, TASK-043 | TC-004, TC-010, TC-013 | UAT-005, UAT-013 | APPLICABLE | IMPLEMENTED with deferred reference integration | EXISTING |
| FR-032–FR-038 (lifecycle/catalog/delete) | DES-003, DES-009, DES-020 | PHASE-001, PHASE-002, PHASE-006 | TASK-005, TASK-006, TASK-018, TASK-019, TASK-020, TASK-040, TASK-043 | TC-005, TC-007, TC-014 | UAT-006, UAT-013 | APPLICABLE | PARTIAL / likely delete-error defect | EXISTING |
| FR-039–FR-043 (UOM/barcode/lookup) | DES-005, DES-010 | PHASE-001, PHASE-002 | TASK-006, TASK-009, TASK-010, TASK-021 | TC-006, TC-007 | UAT-007 | APPLICABLE | IMPLEMENTED; independent NOT_RUN | EXISTING |
| FR-044–FR-049 (price) | DES-006 | PHASE-002, PHASE-004 | TASK-010, TASK-014, TASK-016, TASK-031 | TC-003, TC-004, TC-007 | UAT-008 | APPLICABLE | IMPLEMENTED; independent NOT_RUN | EXISTING |
| FR-050–FR-058 (import/export) | DES-013 | PHASE-004, PHASE-006 | TASK-027, TASK-028, TASK-029, TASK-030, TASK-031, TASK-034, TASK-041 | TC-009, TC-015 | UAT-009, UAT-014 | APPLICABLE | PARTIAL / HIGH audit gap | EXISTING |
| FR-059–FR-064 (audit) | DES-002, DES-012, DES-013 | PHASE-002, PHASE-004, PHASE-006 | TASK-011, TASK-020, TASK-029, TASK-039, TASK-041 | TC-010, TC-015 | UAT-010, UAT-011, UAT-014 | APPLICABLE | PARTIAL / HIGH UI and import gaps | EXISTING |
| NFR-001–NFR-005 (availability/performance/capacity) | DES-014, DES-017 | PHASE-005, PHASE-006 | TASK-035, TASK-044 | TC-002, TC-009, TC-012 | UAT-001, UAT-015 | PARTIAL: observable experience only | Developer evidence; independent NOT_RUN | EXISTING |
| NFR-006 (transactional business change + audit) | DES-003, DES-007, DES-012, DES-013 | PHASE-002, PHASE-004, PHASE-006 | TASK-011, TASK-014, TASK-016, TASK-018, TASK-041 | TC-003, TC-004, TC-005, TC-009, TC-010, TC-015 | UAT-003, UAT-005, UAT-006, UAT-009, UAT-010 | APPLICABLE via business outcomes | HIGH import gap | ENHANCED alias for duplicate legacy NFR-005 |
| NFR-007–NFR-013 (deployability/security/retention/accessibility) | DES-007, DES-011, DES-015, DES-017, DES-018, DES-019 | PHASE-005, PHASE-006 | TASK-025, TASK-026, TASK-034, TASK-035, TASK-036, TASK-044 | TC-001, TC-008, TC-010, TC-011, TC-012, TC-016 | UAT-009, UAT-011, UAT-012, UAT-014, UAT-015 | PARTIAL / otherwise N/A | Conditional; sign-offs pending | EXISTING with canonical renumbering |
| NFR-014 (RTO <=4h) | DES-018, DES-019 | PHASE-005, PHASE-006 | TASK-036, TASK-044 | TC-016 | UAT-015 | Business continuity sign-off; technical proof primary | NOT_RUN | NEW; user-approved 2026-09-11 |
| NFR-015 (RPO <=15m) | DES-018, DES-019 | PHASE-005, PHASE-006 | TASK-036, TASK-044 | TC-016 | UAT-015 | Business continuity sign-off; technical proof primary | NOT_RUN | NEW; user-approved 2026-09-11 |
| SEC-001–SEC-006 (auth/authz/re-auth) | DES-002, DES-008, DES-012, DES-013 | PHASE-001, PHASE-002, PHASE-004, PHASE-006 | TASK-002, TASK-011, TASK-014, TASK-016, TASK-020, TASK-029, TASK-039, TASK-041, TASK-044 | TC-003, TC-004, TC-005, TC-009, TC-010 | UAT-010, UAT-011 | APPLICABLE | Developer evidence; independent NOT_RUN | EXISTING |
| SEC-007–SEC-009 (input/data/file/output protection) | DES-004, DES-005, DES-007, DES-009, DES-011, DES-013, DES-014, DES-017, DES-018 | PHASE-001–PHASE-006 | TASK-004, TASK-008, TASK-009, TASK-010, TASK-025, TASK-026, TASK-027, TASK-028, TASK-029, TASK-030, TASK-034, TASK-035, TASK-040, TASK-041, TASK-044 | TC-001, TC-006, TC-007, TC-008, TC-009, TC-010, TC-012, TC-013, TC-014, TC-015, TC-016 | UAT-002, UAT-007, UAT-009, UAT-010, UAT-012, UAT-015 | PARTIAL / otherwise N/A | Open HIGH findings; independent NOT_RUN | EXISTING |

## Progress and evidence traceability

| Evidence source | Interpretation | Status |
| --- | --- | --- |
| Legacy T01–T22, T24–T36 index checkmarks | Maintainer-recorded completion | PRESERVED |
| Legacy T23 unchecked index plus completed detailed record | Contradictory historical state | STATUS_INCONSISTENT; TASK-042 |
| Legacy Checkpoint L staging/sign-off boxes | Explicit remaining release work | OPEN; TASK-044 |
| Legacy test Round 1 | Developer self-test / CI evidence for `f4d6d8d` and PR #73 | PRESERVED; not independent PASS |
| Current code/static inspection | Design/implementation comparison | Findings DR-001–DR-009; not executed FAIL |
| This review's product tests | None | NOT_RUN |

## Semantic audit

- Every canonical FR group maps to Design, Phase/Task, Technical Test and UAT.
- Every NFR/SEC maps to Technical Acceptance; UAT is used only where a business user can meaningfully observe or approve the outcome.
- Every canonical Task belongs to a Phase. New remediation Tasks remain `PLANNED` and do not rewrite completed legacy Tasks.
- PHASE-006 defines a branch/PR boundary, self-test/CI/review merge trigger, rollback and cleanup expectation.
- Open HIGH findings have explicit remediation Tasks and targeted Technical Tests.
