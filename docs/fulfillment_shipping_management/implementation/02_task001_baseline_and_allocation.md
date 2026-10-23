# TASK-001 — Baseline, provider inventory and migration allocation

Candidate: developer readiness only, pending independent final reconciliation review. Entry/core provider evidence is in [the entry report](00_implementation_readiness.md). HD-008 A and [HD-009 A1](01_archive_foundation_dependency.md) are actual direct human decisions; no acceptance waiver is created.

## Baseline and evidence

The final allocation preflight fetched/pruned origin again and observed main still exactly `76223f40480d94a1d3a2ae6e0e7b91292bd98b82`. All 85 existing migration files retain their original bytes and unique prefixes (highest0087). Actual current local worktree migration inventories were checked: primary main, this P0 worktree, Inventory P4 and Supplier T51r have no prefix above0087. Only Sales P4 contains0088–0093. This observation is not a distributed lock or a claim about unobserved repositories.

Existing provider core focused checks: 76 PASS / 0 FAIL / 0 SKIP. `npm run lint` PASS. Four provider core locations, source identities/owners and missing dedicated extensions are explicitly recorded in entry report. Their extensions remain BLOCKED until TASK-004–006 and Checkpoint0B; TASK-001 does not claim those contracts PASS.

## Single writer assignment

Sales' actual coordination document112 explicitly accepts P0 as sole active/schema/minimum-lifecycle owner and says0091–0093 will exit its final P4 PR as independent installers, with exact replacement numbering to be recorded once by this coordinator. That acceptance plus Sam's later A1 prerequisite decision permits this allocation. The coordinator sent the exact inventory to the existing Sales chat; further acknowledgement is retained separately when observed. Both sides preserve old source/evidence; none is relabelled as a new migration test PASS.

| Prefix / final intended file | Owner / delivery | Logical slice / ordering |
| --- | --- | --- |
|0088_create_sales_archive_batches.js|Sales owner; exact two-table contribution in complete P0 PR|Batch/manifest predecessor, reviewed handoff SHA b6eeecb12fd08e3f4a6129c8448b1c9346c4f55ca73bda458653b93d7a410946; main0070/0083 helpers exist.|
|0089_create_sales_archive_tables.js|Sales; later complete P4 PR|Retained Sales mirrors; P0 does not author this file.|
|0090_create_sales_export_jobs.js|Sales; later complete P4 PR|Retained Sales Export; P0 does not author this file.|
|0091_seed_fulfillment_permissions.js|P0 TASK-002|Logical1 permissions only; existing0063 owns fulfillment.operation.|
|0092_create_fulfillment_operations_and_sequences.js|P0 TASK-007|Remainder of logical1; Checkpoint0B prerequisite.|
|0093_create_fulfillment_documents.js|P0 TASK-008|Logical2 headers/lines/claims/history; Sales/Inventory/master tables precede FKs.|
|0094 reserved — no new file|P0 TASK-005/008 reconciliation|Logical3 is already satisfied by historical0059/0063; no redundant migration or no-op.|
|0095_create_fulfillment_allocations.js|P0 TASK-008|Logical4; document/Inventory dependencies first.|
|0096_create_shipments.js|P0 TASK-009|Logical5 Shipment, circular FK and history.|
|0097_create_shipment_issues_and_reversals.js|P0 TASK-009|Logical6 Issue/Reversal details and immutable guards.|
|0098_create_fulfillment_audit_and_exports.js|P0 TASK-010|Logical7 audit/export.|
|0099_create_fulfillment_archives.js|P0 TASK-010|Logical8 mirrors/hash/guards;0088 batch FK predecessor required.|

P0 physical allocation spans0091–0099;0094 requires no new file because historical0059/0063 already supply FIFO/override. logical1 is physically split so TASK-002 permission seed can be developed separately from operation persistence. 0089/0090 gaps in the P0 candidate are intentional reserved Sales ownership, not missing P0 prerequisites. Existing unpublished Sales0091–0093 source identities are withdrawn/replaced from that stream's final candidate; this table does not install their old bodies or run both sets. Their prior native results remain historical reference only.

Freshness must be rechecked before each new migration file and before the complete P0 PR; any new observed collision pauses the affected path. No deployed migration is renumbered or edited. No new migration or schema has been executed. The actual0088 source transfer is deferred until its planned owner contribution slice; the file remains byte-identified in the Sales handoff.

## Execution handoff

TASK-001 can be marked DONE only after this inventory/HD-009 amendment has its actual independent review and structural checks pass. This closes inventory/allocation readiness, not provider extensions, runtime authority, Checkpoint0B or full P0 delivery. TASK-002 is split into 2A config/startup/tests (five primary files), 2B allowlists/public errors and 2C permission seed/catalogue/mapping verification. Full TASK-002 stays incomplete until all slices and its native/UI-relevant checks pass.

Independent R8 final disposition: **APPROVED**, actual current DESIGN8618ff25 / PLAN6a954bdf, reviewer `/root/fulfillment_independent_review`, method `SEPARATE_AGENT`, 0 open CRITICAL/HIGH/MEDIUM; reviewed report SHA256 `df8edb79d969fc634744502c66bd6e51868573a37930deb07984187aa2087c49`. TASK-001 inventory/allocation is developer DONE. Exact-inventory followup acknowledgement is not invented; source transfer/new migration remains gated as recorded. TASK-0022A configuration/startup/tests has no blocking predecessor.
