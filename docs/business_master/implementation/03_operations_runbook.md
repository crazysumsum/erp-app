# Business Master Operations Runbook

## Purpose and safety boundary

This runbook covers the `business-master-currency-payment-term-provider/v1` catalog, its startup readiness,
consumer impact checks, backup/restore and forward-only recovery. It does not authorize production access,
schema reset, direct catalog deletion, credential export or bypass of the application permission model.

Use the normal secret manager/environment injection for database and JWT values. Do not put secrets in command
history, reports, screenshots or tickets. Run destructive recovery only through the environment's approved backup
procedure and change record.

## Deployment order

1. Back up the MySQL database at one consistent recovery point. The backup set must include `currencies`,
   `payment_terms`, `business_master_audit_logs`, permissions/roles and every installed consumer reference table.
2. Apply migrations in repository order. Migration `0027_create_business_master.js` is forward-only and must never
   be edited after deployment.
3. Start the API. Do not expose the admin UI or switch a consumer until startup logs
   `business_master.readiness.ready` with `status=READY` and provider contract
   `business-master-currency-payment-term-provider/v1`.
4. Verify `GET /api/v1/health` reports `status=ok` and `database=connected`.
5. Verify the readiness context: `schemaReady`, `hkdReady` and `permissionsReady` are true; checker IDs are exactly
   `ap`, `ar`, `customer`, `purchasing`, `sales`, `supplier`; active counts are plausible for the environment.
6. Enable the Currency and Payment Term UI. Create only owner-approved Payment Terms; production migration seeds
   none. Switch each consumer only after its own-permission handler and provider contract regression pass.

If any step fails, stop the rollout. Do not recreate tables, insert a fake Payment Term or mark an unknown consumer
as zero references.

## Readiness dashboard and alerts

Use these existing signals; Phase 2 deliberately adds no new monitoring infrastructure:

| Signal | Healthy | Alert / action |
|---|---|---|
| Startup event `business_master.readiness.ready` | `status=READY`; all three readiness flags true | Missing event or startup failure: keep instance out of service and inspect schema/HKD/permissions |
| `/api/v1/health` | HTTP 200, database `connected` | 503 or database `unknown`: route no new traffic; restore DB connectivity |
| `activeCurrencyCount` | At least 1; HKD exists as Active with 2 decimal places | Zero or unexpected drop: block consumer cutover and investigate audit/catalog |
| `activePaymentTermCount` | Environment-owner expected value; zero is valid immediately after migration | Unexpected change: compare approved setup and Business Master audit |
| Impact preview result | Every checker is `READY` or a schema-proven `NOT_INSTALLED` | `IMPACT_CHECK_UNAVAILABLE`, timeout or unknown: block the high-impact command and repair that checker |
| Version conflicts | Occasional 409 with user reload | Sustained increase: investigate concurrent automation or stale clients |
| Mutation/audit errors | No unexplained failures; catalog mutation and success audit commit together | Any rollback/500: retain correlation ID and inspect DB/app logs; do not replay with a new idempotency key |
| List/lookup/calculate latency | p95 < 2 s, p99 < 4 s; error rate < 1% under approved capacity test | Threshold breach: inspect query plan, DB saturation and pool waits before scaling or changing indexes |

Logs and dashboards must not contain Authorization headers, impact tokens, full request bodies or user credentials.
Retain only the minimum correlation ID, entity type/key, action, result, duration and checker status needed to triage.

## Consumer impact failure and inactive-default remediation

- `NOT_INSTALLED` is valid only when `information_schema` proves the consumer table does not exist and all counts
  are zero.
- If a consumer table exists without a real checker, impact preview fails closed with
  `IMPACT_CHECK_UNAVAILABLE`. Deploy that consumer's read-only checker; do not replace it with a constant-zero result.
- A valid preview displays active-default, open-use and historical counts. Confirm recomputes the same watermark;
  `IMPACT_CHANGED` or an expired/invalid token requires a fresh preview.
- After an approved deactivation, identify each active default from the preview, assign an approved Active
  replacement through the owning consumer module, and rerun preview until active-default count is zero.
- Historical references and transaction snapshots remain unchanged. Never mass-update history to the current
  Currency precision or Payment Term rule.
- For a lost/unknown response, retry with the same idempotency key. A confirmed version/impact conflict is a new
  intent and receives a new preview and key.

## Backup, restore and continuity check

Recovery objectives are RTO at most 4 hours and RPO at most 15 minutes. The repository rehearsal is:

```sh
node server/scripts/runBusinessMasterRecoveryAcceptance.js --output /approved/local/evidence/business-master-recovery.json
```

Run it only with environment-injected connection values against an approved isolated schema. The report must prove:

- source/restored row counts match for Currency, Payment Term and audit;
- HKD remains exactly one Active row with two decimal places;
- Inactive Currency and Payment Term versions remain readable through the history provider;
- audit entries still link to the exact entity keys;
- readiness is `READY` before and after migration rerun/provider restart;
- observed RTO/RPO meet the objectives.

For a real incident, restore the whole consistent backup set, start a replacement instance without traffic, run the
same semantic checks, then switch traffic through the approved operations process. Do not copy the three Business
Master tables independently of their role/permission and consumer reference dependencies.

## Forward fix and application rollback

- Application rollback may hide the new UI/routes and return application code to a compatible version.
- Keep migration `0027`, catalog rows and audit data. Do not run a down migration or delete the tables.
- Schema or data-shape defects use a new reviewed forward migration after backup and compatibility analysis.
- A breaking provider change requires an additive compatibility period and every consumer contract suite; do not
  introduce a second shadow catalog or a parallel generic lookup endpoint.
- Preserve failed correlation IDs, exact candidate commit, readiness output and checker status in the incident/change
  record. Test artifacts remain local unless evidence export is separately approved.

## Verification commands

From a clean candidate worktree, with the approved isolated test environment injected:

```sh
npm run lint
npm run build --workspace client
npm test --workspace client -- --config test/business-master/vitest.config.js
npx playwright test --config client/e2e/business-master/playwright.config.js
DB_INTEGRATION_TESTS=1 node --test --import ./server/test-support/testEnv.js server/test/business-master/*.test.js
node --test --import ./server/test-support/testEnv.js server/test/business-master/consumer-contract/*.test.js
```

Use the module harness runner for durable developer/formal JUnit and JSON evidence. A developer run does not equal
Technical Acceptance, business UAT acceptance or release approval.
