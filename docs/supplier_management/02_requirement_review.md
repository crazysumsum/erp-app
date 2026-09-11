# Supplier Management Independent Requirement Review

## Review decision

**ACCEPT WITH RECORDED DEPENDENCIES.** The aligned requirement is coherent, testable and appropriately scoped for a small／medium wholesale ERP. The two major-impact conflicts were decided by the Product Owner and incorporated. No unresolved requirement contradiction blocks design; implementation and deployment dependencies remain visible gates.

## Review lenses

| Lens | Assessment | Evidence / conclusion |
| --- | --- | --- |
| Business outcome | PASS | Enables a single authoritative Supplier record, safe activation, optional approval, purchasing eligibility and traceable maintenance without adding AP/payment complexity. |
| Scope simplicity | PASS | Optional child data remains non-blocking; Supplier–SKU is a soft relation; price, scorecard, qualification and payment are excluded. |
| Completeness | PASS | CRUD, lifecycle, duplicate behavior, children, bank, approval, settings, import/export, audit and downstream rules are represented by FR-001～FR-087. |
| Rule clarity | PASS | Supplier Code is case-insensitive unique; name duplication warns rather than blocks; identifier duplication blocks; default Currency is required; Payment Term and Bank are optional. |
| State integrity | PASS | Draft／Pending／Active／Suspended／Blocked／Archived transitions, reasons, restore behavior and deletion guard are explicit. |
| Authorization | PASS AFTER DECISION | `SEC-014` defines system-admin as highest permission while preserving separate daily roles and strong bank controls. |
| Data ownership | PASS AFTER DECISION | `DEC-021` makes Business Master sole Currency／Payment Term owner; Supplier is a consumer. |
| Integrations | PASS WITH GATE | Purchasing, Item, Receiving/Returns and AP/Payment use ID + snapshot and purpose-specific minimum projections; final provider readiness must be proven. |
| Measurability | PASS | Query, concurrency, Supplier volume, import throughput, retention, RTO and RPO are measurable. |
| Acceptance quality | PASS | AC-001～AC-040 cover the primary business journeys, denial paths and concurrency outcomes in Given／When／Then form. |

## Human decisions

| Decision | Question resolved | Approved result | Requirement impact |
| --- | --- | --- | --- |
| HD-001 | Does protected system-admin receive Supplier bank permissions? | Yes. It is the system's highest permission role and may view/manage bank data. Reauth, masking, audit, redaction and alerting still apply. | Role definition, SEC-014, DEC-008, AC/UAT security coverage |
| HD-002 | Which module owns Currency and Payment Term? | Shared Business Master. Supplier only reads, validates and references. | DEC-021, integration boundaries, settings scope and deployment readiness |

## Ambiguity and edge-case review

- A Supplier may activate with no address, contact, identifier, Payment Term or Bank; the UI presents completeness warnings only.
- Supplier name duplication remains warning-only; legal identifier duplication is a hard rejection.
- Approval policy changes do not retroactively change an existing Pending request.
- Removing a Block produces Suspended, not Active; restoring Archived also produces Suspended.
- An inactive Supplier remains visible for historical work but is never eligible for a new purchase submission.
- Purchasing may prioritize Suppliers with supply history but cannot treat the relationship as a whitelist.
- Supplier default changes do not mutate historical transaction snapshots.
- Bank access entitlement does not waive sensitive-data handling controls, including for system-admin.

## Open gates that do not require a new business answer now

| Gate | Owner | Required before |
| --- | --- | --- |
| Business Master provider and at least one Active Currency | Business Master owner | PHASE-001 implementation |
| Item SKU/UOM provider | Item owner | PHASE-004 Supplier–SKU implementation |
| Purchasing/Receiving/Returns/AP reference and history provider inventory | Respective module owners | Lifecycle release gate |
| Production secret store, key custody and rotation ownership | Security/Operations | PHASE-003 production enablement |
| Longer retention or legal-hold rule | Legal/Data owner | Any destructive purge beyond documented minimum |

## Reviewer conclusion

No new feature is recommended at this gate. The next correct action is to satisfy provider readiness, then implement PHASE-001 from the latest main in its own worktree. Requirement status remains `ALIGNED`, not `ACCEPTED IN PRODUCTION`.
