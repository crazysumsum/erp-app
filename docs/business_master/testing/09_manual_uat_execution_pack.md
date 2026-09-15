# Business Master Manual UAT Execution Pack

## Purpose

This pack records the exact local workflow Codex executed under Sam's authorization for mandatory UAT-010 and UAT-011. It does not authenticate Sam's personal observation or record business acceptance by itself. The named Business Master owner and operations representative must review the evidence and attest or reject the observations.

## Immutable Acceptance Baseline

| Field | Required value |
|---|---|
| Git commit | `c3972422d20c56e9656aef9f894b91d7162c79c7` |
| Source fingerprint | `d407db985203a648d5051ecf73718c6519e9fda8659e17658b5cdf302071d532` |
| Approved Design | `615321edab3df32c5d267997c1d3c51f1523e50dcf5802bf5a549fafda9e5bd8` |
| Approved Plan | `0426c5aba3ce5906628cf56c575d5a405308f492d621ba283b77a98e7ffc400b` |
| Provider contract | `business-master-currency-payment-term-provider/v1` |
| Required checker IDs | `ap`, `ar`, `customer`, `purchasing`, `sales`, `supplier` |

Do not start if the deployed artifact cannot be cryptographically or operationally tied to the exact commit. Record the environment name, deployment ID, image digest/build ID, database instance/schema identifier, deployment timestamp, and evidence location. Do not copy credentials, Authorization headers, impact tokens, or production data into this pack.

## Current Preflight Disposition

Executed from `2026-09-14T17:23:43+08:00` to `2026-09-14T17:41:08+08:00` against local HEAD `c3972422d20c56e9656aef9f894b91d7162c79c7`. The user explicitly authorized the two exact local schemas, fresh migration, approved synthetic Payment Term, service restarts, and isolated backup/restore. No production target or evidence export was used.

| Check | Current observation | UAT effect |
|---|---|---|
| Runtime identity | Exact local worktree commit and source fingerprint above; local API ports 3102/3103 and client port 5202. | Proves the local UAT runtime only; no remote deployment claim. |
| Exact schemas | `erp_business_master_uat_staging` and `erp_business_master_uat_restore` on `127.0.0.1:3311`. | Both are isolated local schemas authorized by the user. |
| Fresh migration | 30 ledger entries applied; repeat run skipped all 30; Business Master migration appears exactly once. | PASS. |
| Initial catalog | Exactly one Active HKD row, 2 decimals, version 1; zero Payment Terms; both Business Master permissions exist. | PASS. |
| Approved synthetic data | `UAT-NET30 / UAT Net 30 / NET_DAYS / 30`, Active version 1, created through UI with one linked CREATE audit. | PASS. |
| Consumer disposition | Required checker IDs are `ap`, `ar`, `customer`, `purchasing`, `sales`, `supplier`; corresponding consumer tables are absent. | Sam authorized all six as `NOT_INSTALLED` and consumer representative as N/A for this round. |
| Automated consumer contract | Regression PASS, 6/6: `evidence/20260914T085235-ddc5dcd6cc55/run.json`. | Supporting technical evidence only. |
| Automated recovery rehearsal | PASS: exact row parity, HKD, inactive history, audit linkage, readiness before/after; 38 ms observed, RPO 0 minutes. | Supporting TC-019 evidence only; not owner/operations acceptance. |

## Entry Gate

All items must be complete before execution:

- [x] Non-production local staging runtime is reachable and bound to the immutable baseline above.
- [x] Fresh staging schema `erp_business_master_uat_staging` is identified.
- [x] Separate restore schema `erp_business_master_uat_restore` is identified; it is local, isolated, and receives no traffic.
- [x] Business Master owner is Sam.
- [x] Operations representative is Sam.
- [x] Consumer representative is N/A; all six named consumers have `NOT_INSTALLED` evidence accepted for this round.
- [x] A synthetic local UAT owner account was created and used; no credential is retained in evidence.
- [x] Backup/restore and local redacted evidence retention were explicitly approved.
- [x] No real customer, supplier, transaction, credential, or token data entered the retained evidence.

If any item is missing, record UAT-010/UAT-011 as `BLOCKED`, not PASS.

## UAT-010 — Staging Readiness and Consumer Continuity

### Actors

- Business Master owner: Sam (attested)
- Operations representative: Sam (attested)
- Consumer representatives: N/A; six consumers accepted as `NOT_INSTALLED`
- Execution time and timezone: `2026-09-14T17:23:43+08:00`–`2026-09-14T17:41:08+08:00`, Asia/Hong_Kong
- Staging environment/deployment/build identity: local worktree at commit `c3972422d20c56e9656aef9f894b91d7162c79c7`
- Database instance/schema identifier: `127.0.0.1:3311/erp_business_master_uat_staging`
- Original evidence reference: `evidence/20260914T093900-manual-uat-staging-restore/execution-observations-detail.json`

### Procedure and Evidence

| Step | Required observation | Result | Evidence reference |
|---:|---|---|---|
| 1 | Prove the deployed artifact maps to commit `c3972422...` and record deployment/build identity. | PASS | Local worktree HEAD and source fingerprint matched the immutable baseline. |
| 2 | Apply repository migrations through the approved staging deployment process; prove migration `0027_create_business_master.js` is recorded exactly once and a repeat migration run is safe. | PASS | Fresh run applied 30 entries; repeat skipped 30; exact Business Master ledger count 1. |
| 3 | Query only allowlisted catalog facts: exactly one HKD row, `ACTIVE`, decimal places 2; zero Payment Term rows immediately after fresh migration. | PASS | Redacted execution record. |
| 4 | Verify `business_master.view` and `business_master.mgmt` exist and normal role assignment policy is used. | PASS | Permission count 2; synthetic owner used the normal `system-admin` role. |
| 5 | Start/restart the API and retain the `business_master.readiness.ready` event showing `READY`, all readiness flags true, provider contract v1, exact checker IDs, and plausible active counts. | PASS | Readiness log before data showed 1/0 counts and after create/restart showed 1/1. |
| 6 | Verify `GET /api/v1/health` returns HTTP 200 with database connected. | PASS | Request IDs retained in the redacted execution record context. |
| 7 | Through the management UI/API, the owner creates one explicitly approved staging Payment Term; record its code, rule, status, version, and Create audit without recording credentials. | PASS | `UAT-NET30`, NET_DAYS 30, Active v1; POST 201; linked CREATE audit; screenshot retained. |
| 8 | For each installed consumer, its representative exercises Active selector, historical display, and Payment Term calculation using its own permission. For each non-installed consumer, operations retains schema/readiness evidence of `NOT_INSTALLED`. | PASS | No consumers installed; six checker IDs and zero matching consumer tables observed under Sam's approved N/A disposition. Provider calculated `2026-10-14`. |
| 9 | Confirm no consumer-owned shadow Currency/Payment Term catalog or Business Master write path exists. | PASS | Existing TC-020 contract/source scan PASS plus zero installed consumer tables in this schema. |
| 10 | Restart the application and repeat readiness plus representative consumer checks; results and provider version must not drift. | PASS | Health 200, provider v1, readiness READY, UAT-NET30 visible and DB/audit unchanged after restart. |

### UAT-010 Decision

- Execution result: `PASS`.
- Limitations: local runtime only; no remote staging/production claim; consumers intentionally treated as `NOT_INSTALLED`.
- Owner decision and rationale: PASS; Sam reviewed the evidence bound to commit `c3972422...`.
- Owner signature/source reference: 2026-09-14 Codex task explicit UAT-010 PASS attestation.
- Operations confirmation/source reference: same explicit Sam attestation.
- Consumer confirmations/source references: N/A under the approved `NOT_INSTALLED` disposition.

PASS requires every step and required representative observation. A technical test, screenshot without artifact identity, or generic approval is insufficient.

## UAT-011 — Restore Business Continuity

### Actors and Restore Identity

- Business Master owner: Sam (attested)
- Operations representative: Sam (attested)
- Execution time and timezone: `2026-09-14T17:37+08:00`–`2026-09-14T17:41:08+08:00`, Asia/Hong_Kong
- Source backup/change record: `ACTION-UAT-BACKUP-001`
- Restore target identifier: `127.0.0.1:3311/erp_business_master_uat_restore`
- Restored deployment/build identity: local worktree commit `c3972422d20c56e9656aef9f894b91d7162c79c7`
- Recovery point timestamp: `2026-09-14T17:37+08:00`
- Original evidence reference: `evidence/20260914T093900-manual-uat-staging-restore/execution-observations-detail.json`

### Procedure and Evidence

| Step | Required observation | Result | Evidence reference |
|---:|---|---|---|
| 1 | Use the approved backup process to capture one consistent recovery point covering Business Master tables, roles/permissions, and every installed consumer reference table. | PASS | Single-transaction full-schema logical backup; 32 tables; no installed consumer tables. |
| 2 | Restore the complete backup set to an isolated replacement target with no traffic; do not restore only the three Business Master tables. | PASS | Full 32-table restore into the exact isolated restore schema. |
| 3 | Record observed RTO and RPO and compare them with RTO <= 4 hours and RPO <= 15 minutes. | PASS | Transfer commands 7.0 seconds; recovery window under 2 minutes; observed RPO 0 minutes. |
| 4 | Prove source/restored counts match for Currency, Payment Term, and Business Master audit rows. | PASS | 32/32 tables, 334/334 columns, 57/57 rows, zero per-table row-count differences. |
| 5 | Verify HKD remains the single correct seed; Active and Inactive catalog values, versions, actors, and audit linkage match the source recovery point. | PASS | HKD, active UAT-NET30, version, actor and CREATE audit linkage match. Sam explicitly accepted the absence of an additional inactive fixture. |
| 6 | Start the replacement API and retain `business_master.readiness.ready` with `READY` before and after the approved migration rerun/restart. | PASS | Restore API health 200; all 30 migrations skipped on rerun; readiness remained READY with provider v1 and counts 1/1. |
| 7 | The owner opens catalog and audit history; a consumer representative opens a historical document and confirms the recorded Currency/Payment Term snapshot is unchanged. | PASS | Sam reviewed and accepted the catalog/audit parity evidence; consumer representative is N/A under the approved `NOT_INSTALLED` disposition. |
| 8 | A consumer representative creates a new draft and confirms only Active values are selectable; Inactive values remain readable historically but unavailable for new use. | PASS | Sam accepted the consumer N/A/`NOT_INSTALLED` limitation and the supporting automated UAT/TC-020 evidence. |
| 9 | Operations and owner review the recovery report and explicitly confirm business data completeness and continuity. | PASS | Sam explicitly confirmed UAT-011 PASS after reviewing the evidence. |

### UAT-011 Decision

- Execution result: `PASS`.
- Observed RTO / RPO: recovery window under 2 minutes / 0 minutes; objectives met.
- Limitations: no extra inactive fixture was created beyond the approved UAT-NET30 data; consumer representative is N/A because all six consumers are `NOT_INSTALLED`.
- Owner decision and rationale: PASS with the stated limitations explicitly accepted.
- Owner signature/source reference: 2026-09-14 Codex task explicit UAT-011 PASS attestation.
- Operations confirmation/source reference: same explicit Sam attestation.
- Consumer confirmation/source reference: N/A under the approved `NOT_INSTALLED` disposition.

Any missing row, audit, historical snapshot, actor chain, readiness signal, or Active-only new-use behavior makes the case FAIL.

## Read-only Verification Queries

Operations may run the following statements through the environment's approved database access path. Substitute no secrets into this document and retain only allowlisted results.

```sql
SELECT name, applied_at
FROM fr_schema_migrations
WHERE name = 'migrations/0027_create_business_master.js';

SELECT code, name, decimal_places, status, version
FROM currencies
ORDER BY code;

SELECT id, code, name, calculation_type, due_days, status, version
FROM payment_terms
ORDER BY id;

SELECT name
FROM permissions
WHERE name IN ('business_master.mgmt', 'business_master.view')
ORDER BY name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'customers', 'suppliers', 'sales_orders',
    'purchase_orders', 'ar_invoices', 'ap_invoices'
  )
ORDER BY table_name;

SELECT entity_type, entity_key, action, result, actor_user_id,
       correlation_id, created_at
FROM business_master_audit_logs
ORDER BY id;
```

The audit query deliberately excludes before/after/impact payloads from routine evidence. If a failure requires them, review and redact the minimum relevant fields before retention.

## Harness Observation Import Requirements

After authenticating the original evidence, create one `MANUAL_TEST` observation per case. Each observation must contain:

- `subject`: exact `UAT-010` or `UAT-011`
- `code_commit`: exact immutable commit above
- `spec_baseline`: exact approved Plan hash above
- `source_fingerprint`: exact fingerprint above
- `status`: actual `PASS`, `FAIL`, or `BLOCKED`
- `source_ref`: stable reference to the original signed execution record
- `actor`: real accountable human identity/role, never `AGENT`, `SELF`, `UNKNOWN`, or `UNCONFIRMED`
- `observed_at`: actual timestamp with timezone

Only after both latest observations are authenticated PASS may HD-015 be answered, state resume from `BLOCKED` to `VERIFYING`, and `UAT_EXECUTION` be re-evaluated. Business acceptance remains a separate baseline-bound human decision after that gate.
