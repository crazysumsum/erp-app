# Customer Management Technical Test Specification

## 1. Status and Evidence Boundary

All cases are specifications with status `PLANNED`. No test, build, migration, browser flow, load run or restore drill was executed during `REVIEW_AND_ALIGN`. Formal execution belongs to `TEST_AND_VERIFY` against a declared commit/build, environment and data baseline.

Priorities: `P0` protects authorization, sensitive data, data integrity and irreversible outcomes; `P1` covers principal behavior/recovery/performance; `P2` covers safely recoverable secondary behavior.

Each run must capture build SHA, environment, actor/permission set, request/operation IDs, initial state, sanitized evidence, cleanup and defect ID. Sensitive evidence must never contain bank plaintext, keys or restricted file content.

## 2. Foundation, Schema and Core

| ID / title | Type / priority | Requirement / design / task | Preconditions / data | Trigger / steps | Expected technical result | Acceptance criterion | Cleanup | Auto | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 Migration allocation and rerun | Migration/P0 | NFR-006, NFR-011; DES-022; TASK-001 | Fresh and upgrade DB; latest main | Allocate, migrate, rerun | Unique sequence; complete schema; rerun no-op | Schema/index/seed manifest exact; no partial incompatible table | Drop test DB | YES | PLANNED |
| TC-002 Permission catalogue/seed | DB/Auth/P0 | SEC-001..SEC-008; DES-015; TASK-002 | Fresh roles/users | Migrate and compare catalogue/DB | Six permissions exact; no implicit inheritance/bank grant | Role matrix equals design | Reset DB | YES | PLANNED |
| TC-003 Shared catalog ownership | Contract/DB/P1 | FR-004, FR-005, FR-022, FR-029; DES-002, DES-004; TASK-004 | Existing/absent compatible tables | Install both paths; read/inactivate values | One owner; HKD valid; inactive values preserved/not assignable | No duplicate table/service semantics | Reset DB | YES | PLANNED |
| TC-004 Customer Code normalization | Unit/P0 | FR-018, FR-019; DES-003; TASK-003 | Unicode/case/space/control vectors | Normalize/validate | Display trim only; canonical key deterministic; invalid rejected | Expected vector equality exact | None | YES | PLANNED |
| TC-005 Legal Name normalization | Unit/P0 | FR-020, FR-021, FR-028; DES-003; TASK-003 | NFKC, accent, punctuation, suffix vectors | Normalize and compare | Only defined transformations collapse values | Distinct legal entities not over-collapsed | None | YES | PLANNED |
| TC-006 Identifier normalization | Unit/P0 | FR-049; DES-003; TASK-003, TASK-008 | Types/countries/format variants | Normalize/validate | Type-aware key, no invented national rule | Stable key/error for each vector | None | YES | PLANNED |
| TC-007 Concurrent canonical uniqueness | MySQL/Concurrency/P0 | FR-019..FR-021, FR-049; DES-003, DES-004; TASK-003 | Two connections, same canonical key | Barrier inserts/updates | Exactly one commit; safe conflict for loser | DB count=1, no orphan/audit mismatch | Rollback fixture | YES | PLANNED |
| TC-008 Binary-key collation proof | MySQL/P0 | FR-020; DES-003; TASK-003 | Accent/case/punctuation pairs | Insert normalized keys | DB equality matches application bytes exactly | Service and DB result matrices identical | Reset DB | YES | PLANNED |
| TC-009 Audit atomic rollback | MySQL/Fault/P0 | FR-097, FR-098; NFR-006; DES-007, DES-021; TASK-005 | Force audit insert failure | Execute each mutation family | Domain write rolls back; safe error/correlation | No successful mutation without audit | Remove fault | YES | PLANNED |
| TC-010 Create Draft aggregate | API/Integration/P0 | FR-017..FR-025; DES-004, DES-007, DES-014; TASK-005, TASK-006 | manager with unique root/optional children | POST create, GET detail/audit | Whole aggregate created version1 Draft | Fields/children/audit exact or nothing | Delete qualified Draft | YES | PLANNED |
| TC-011 Direct activation minimum | API/P0 | FR-022..FR-025; DES-005, DES-010; TASK-011, TASK-012, TASK-013 | approval OFF; active/inactive currency | Create/activate combinations | Only code/name/active currency block; warnings remain non-blocking | State/audit/minimum exact | Archive fixture | YES | PLANNED |
| TC-012 List/search/filter/page | API/Query/P1 | FR-001..FR-010; DES-018, DES-019; TASK-006 | Representative root/child data | Exact/token-prefix/filter/sort/page | Stable order, exact priority, archived default excluded, safe states | No missing/duplicate rows; bounded query | Reset data | YES | PLANNED |
| TC-013 Detail projection/large children | API/Security/P0 | FR-011..FR-016; DES-014, DES-019; TASK-005, TASK-006 | >100 children; mixed sensitivity | GET detail/child pages by roles | Allowlisted data, masked bank, pagination | Zero restricted/internal fields | Reset data | YES | PLANNED |
| TC-014 Root CAS conflict | API/Concurrency/P0 | FR-026..FR-033; NFR-007; DES-004, DES-007; TASK-006 | Two editors version N | Save A then B | A succeeds N+1; B 409; no lost update | DB/audit only A | Restore fixture | YES | PLANNED |
| TC-015 Mass assignment and validation | API/Security/P0 | FR-026..FR-033; SEC-009, SEC-013; DES-014; TASK-006 | Extra/protected fields and malformed IDs | Submit create/update | 400/403 safe error; no side effect | `additionalProperties:false`; Code not updateable | None | YES | PLANNED |
| TC-016 Create idempotency | API/Idempotency/P0 | FR-017..FR-025; NFR-008; DES-006; TASK-006 | Same/different key/payload | Repeat concurrent requests | Same outcome for same pair; conflict for changed payload; one Customer | One resource/audit effect | Delete Draft | YES | PLANNED |
| TC-017 Commit-unknown reconciliation | Fault/Recovery/P0 | NFR-008; DES-006; TASK-006 | Disconnect at commit | Create/update then query operation/resource | Client can determine one outcome without new-key duplicate | One or zero effect consistent with outcome | Clear fault | PARTIAL | PLANNED |
| TC-018 Child ownership/IDOR | API/Security/P0 | FR-042..FR-049; SEC-009; DES-008, DES-014; TASK-007, TASK-008 | Customer A/B and child A | Use child A under B | Safe absent/denial; no metadata/state leak | A unchanged; equivalent absent response | None | YES | PLANNED |
| TC-019 Address default race | MySQL/Concurrency/P0 | FR-042, FR-043, FR-046; DES-008; TASK-007 | Two active shipping addresses | Barrier set both default | At most one default; one safe conflict/reload | Unique slot and service invariant hold | Restore default | YES | PLANNED |
| TC-020 Contact default/purpose | API/MySQL/P0 | FR-044..FR-047; DES-008; TASK-007 | Multi-contact/multi-purpose | Replace purposes/default/deactivate | Multiple contacts allowed; one default per purpose; inactive not default | Mapping/root versions/audit exact | Reset fixture | YES | PLANNED |
| TC-021 Identifier CRUD/race | API/MySQL/P0 | FR-049; DES-003, DES-004; TASK-008 | Cross-customer duplicate vectors | Create/update/deactivate/concurrent create | Global key cannot be reused; safe conflict | One owner, history retained | Reset DB | YES | PLANNED |
| TC-022 Credit null/zero/hold | Unit/API/P0 | FR-050..FR-056; DES-009; TASK-008 | No row, null, zero, positive, hold | Save/get/clear | Three semantics remain distinct in API/DB/provider | Decimal string exact; no exposure calculation | Clear policy | YES | PLANNED |
| TC-023 Credit invalid combinations | API/P1 | FR-050..FR-054; DES-009, DES-014; TASK-008 | Negative, bad precision, inactive/missing currency | Save | Stable validation; no write/audit | All invalid vectors rejected atomically | None | YES | PLANNED |
| TC-024 Credit create/clear CAS | Concurrency/P0 | FR-050..FR-054; NFR-007; DES-007, DES-009; TASK-008 | Two first creates/two clears | Barrier commands | One winner; no lost update/double audit | State/version/audit consistent | Clear fixture | YES | PLANNED |
| TC-025 Credit audit redaction | Security/P0 | FR-053, FR-054, FR-094..FR-100; DES-021; TASK-008 | Notes/reason with sensitive markers | Save/query logs/audit | Required before/after/reason; forbidden data absent | Controlled search count=0 | Delete fixture | YES | PLANNED |
| TC-026 Provider registry readiness | Contract/Resilience/P0 | FR-037..FR-041; NFR-010; DES-020; TASK-009 | READY/UNKNOWN/missing providers | Delete/archive/read health | Destructive command only on all READY/NO_REFERENCE | Unknown never treated as clear | Restore provider | YES | PLANNED |
| TC-027 Purpose lookup matrix | Contract/P0 | FR-034, FR-047, FR-048, FR-054..FR-056; DES-017; TASK-009 | All statuses/purposes | Call named lookup/assert | Matrix exact; unknown purpose rejected; minimal projection | No status or data overreach | None | YES | PLANNED |
| TC-028 Query plan/deep data | MySQL/Performance/P1 | FR-001..FR-016; NFR-001..NFR-003; DES-018, DES-019; TASK-010 | 100k distribution | EXPLAIN and representative queries | Indexed exact/prefix/EXISTS; stable paging | No leading-wildcard standard path/cartesian count | Drop dataset | PARTIAL | PLANNED |
| TC-029 Public error/log redaction | Security/P0 | SEC-009..SEC-014; DES-014, DES-021, DES-023; TASK-005, TASK-010 | SQL/file/bank/secret markers | Trigger validation/DB/internal errors | Stable public codes; no stack/path/index/plaintext | Controlled response/log scan zero hits | Remove fixtures | YES | PLANNED |

## 3. Lifecycle, Approval and Browser Core

| ID / title | Type / priority | Requirement / design / task | Preconditions / data | Trigger / steps | Expected technical result | Acceptance criterion | Cleanup | Auto | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-030 Lifecycle state matrix | Unit/API/P0 | FR-034..FR-041; DES-005; TASK-011 | Every state/action pair | Invoke commands | Only listed transitions; reason/auth/version enforced | State/audit exactly match matrix | Reset data | YES | PLANNED |
| TC-031 Suspend/reactivate downstream | Contract/P0 | FR-034..FR-036; DES-005, DES-017; TASK-011 | Active with existing/new transactions | Suspend then consumer calls | New sale rejected; existing obligation purpose still valid | No historical snapshot rewrite | Reactivate | YES | PLANNED |
| TC-032 Archive/delete guards | Integration/P0 | FR-037..FR-041; DES-005, DES-020; TASK-011 | Referenced/unreferenced/ever-active/provider-down | Archive/delete | Safe blockers/UNKNOWN; only pristine Draft deletes | No cascade loss/audit absence | Reset fixture | YES | PLANNED |
| TC-033 Settings CAS/non-retroactivity | API/Concurrency/P0 | FR-078..FR-083; DES-010; TASK-012 | OFF/ON and pending request | Concurrent setting update | One winner; pending unchanged; audit exact | Effective/version value correct | Restore OFF | YES | PLANNED |
| TC-034 Approval submit eligibility | API/P0 | FR-023..FR-025, FR-071..FR-073; DES-010, DES-015; TASK-013 | self/disabled/no-permission/valid approver | Submit | Only different active authorized approver accepted | Customer/request states atomic | Withdraw valid | YES | PLANNED |
| TC-035 Approval snapshot invalidation | API/MySQL/P0 | FR-073, FR-075; DES-007, DES-010; TASK-013 | Pending version/hash | Critical/noncritical edits | Critical edit invalidates and returns Draft in same tx; safe snapshot | No bank/restricted data in snapshot | Reset fixture | YES | PLANNED |
| TC-036 Approval decision race | Concurrency/Idempotency/P0 | FR-074..FR-077; NFR-007, NFR-008; DES-006, DES-010; TASK-014 | One pending request | Barrier approve/reject/double click | One terminal decision; replay reports existing result | One state/audit/effect | Reset DB | YES | PLANNED |
| TC-037 Withdraw/reassign authorization | API/Security/P0 | FR-075, FR-076; SEC-004, SEC-009; DES-010, DES-015; TASK-014 | requester/other/approvers | Withdraw/reassign | Actor/state restrictions exact; safe denial | Queue/assignment/history consistent | Reset fixture | YES | PLANNED |
| TC-038 Block/unblock authorization | API/Security/P0 | FR-035, FR-036; SEC-004, SEC-012; DES-005, DES-015; TASK-014 | roles/high-auth states | Block/unblock | Approval+device/password/reason required; unblock->Suspended | Fresh revoked permission denied | Restore state | YES | PLANNED |
| TC-039 Client contract/error mapping | Client/P1 | FR-001..FR-083; NFR-011; DES-014, DES-016; TASK-015 | All stable error fixtures | Service calls/abort/version responses | Typed mapping and Chinese safe message; no stale request overwrite | No server detail leakage | None | YES | PLANNED |
| TC-040 Customer browser happy path | Playwright/P1 | FR-001..FR-056; DES-016; TASK-016, TASK-017 | Running app; manager actor | Create/search/edit/address/contact/credit | Observable state/audit and URL refresh correct | No relevant console/network failures | Archive fixture | YES | PLANNED |
| TC-041 Browser permission and direct URL | Playwright/Security/P0 | SEC-001..SEC-009; DES-015, DES-016; TASK-016, TASK-018 | Viewer/manager/approver/no-access | Navigate and invoke controls/direct routes | UI only exposes legal actions; server rejects bypass | No data/metadata leak | None | YES | PLANNED |
| TC-042 Browser validation/conflict | Playwright/P1 | FR-010, FR-026..FR-033; DES-016; TASK-016, TASK-017 | Invalid fields/two sessions | Submit errors and stale version | Focusable summary/field errors; input recoverable; no overwrite | Keyboard-only flow succeeds | Reset fixture | YES | PLANNED |
| TC-043 Approval/settings browser flow | Playwright/P1 | FR-071..FR-083; DES-010, DES-016; TASK-018 | Manager/approver/settings actors | Toggle, submit, decide, stale case | Scope/diff/impact/reason/re-auth visible and correct | Refresh/back states accurate; no console/network errors | Restore OFF | YES | PLANNED |
| TC-044 Responsive/accessibility core | Playwright/A11y/P1 | NFR-014; DES-016; TASK-016..TASK-019 | 375/768/1024/1440; keyboard/screen reader checks | Core journeys | No inaccessible action/overflow blocker; headings/labels/status/focus/contrast valid | Automated scan plus manual keyboard checklist | None | PARTIAL | PLANNED |

## 4. Bank, Files and Bulk

| ID / title | Type / priority | Requirement / design / task | Preconditions / data | Trigger / steps | Expected technical result | Acceptance criterion | Cleanup | Auto | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-045 Sensitive delegation boundary | Security/P0 | SEC-005..SEC-007, SEC-012; DES-015; TASK-020 | protected admin/ordinary admin/roles | Delegate and access routes | Only approved flow delegates; delegator lacks route access unless separately assigned | No privilege escalation/replay; full audit | Remove test roles | YES | PLANNED |
| TC-046 Bank crypto vectors/AAD | Unit/Security/P0 | FR-057..FR-063; DES-011; TASK-021 | Keys, tamper, cross-owner ciphertext | Encrypt/decrypt/move/tamper | Valid round-trip; tamper/cross-owner/unknown key fail closed | No plaintext in error/log | Zero buffers/fixtures | YES | PLANNED |
| TC-047 Bank schema/default/duplicate race | MySQL/P0 | FR-057..FR-063; DES-011; TASK-021 | Two banks/connections/rotating keys | Create/default/duplicate barriers | One same-owner account/default; cross-owner warning only | Constraints and safe error exact | Reset DB | YES | PLANNED |
| TC-048 Bank permission matrix | API/Security/P0 | SEC-002, SEC-005, SEC-006; DES-011, DES-015; TASK-022 | All permission combinations | list/create/update/default/deactivate/reveal | Masked list broadly safe; full/rewrite only exact permission+auth | Unauthorized side effects=0 | Reset fixture | YES | PLANNED |
| TC-049 Bank reveal memory/cache/audit | API/Browser/P0 | FR-058, FR-062; SEC-005, SEC-014; DES-011, DES-016; TASK-022 | Authorized actor/browser | Reveal, timeout, unmount, back/cache | Audit precedes value; no-store; DOM/state cleared | Plaintext absent from logs/storage/history/snapshots | Close browser/clear data | PARTIAL | PLANNED |
| TC-050 Cross-customer bank warning token | API/Security/P0 | FR-057, FR-063; DES-006, DES-011; TASK-022 | Same canonical bank under A/B | Precheck/confirm tampered/replayed token | Valid actor+payload+target+expiry only; no other data leak | One controlled result/audit | Deactivate fixture | YES | PLANNED |
| TC-051 Bank rotation/reindex recovery | Integration/P0 | NFR-009; DES-011, DES-024; TASK-022 | old/new key rings; interrupted batches | Rotate/reindex/resume/retire | New writes new key; all reads; idempotent resume; zero-old proof | Counts reconcile; no plaintext report | Restore keys/test DB | PARTIAL | PLANNED |
| TC-052 Bank config/backup failure | Resilience/P0 | SEC-010; NFR-009, NFR-015; DES-011, DES-024; TASK-021, TASK-022 | missing/wrong keys and restored DB | Start/reveal/restore | Capability/readiness fails closed; correct set restores | No silent data loss or plaintext workaround | Destroy test restore | PARTIAL | PLANNED |
| TC-053 File type/path/scan validation | Security/P0 | FR-064..FR-070; SEC-013; DES-012; TASK-023 | Valid, polyglot, SVG, traversal, infected/error files | Upload | Only allowlisted clean signature accepted; temp cleaned safely | No metadata/orphan for rejected input | Purge fixtures | YES | PLANNED |
| TC-054 File finalize crash recovery | Fault/Recovery/P0 | NFR-006, NFR-008; DES-012; TASK-023 | Fault at stream/metadata/move/finalize | Upload then restart recovery | Deterministic operation becomes one active or storage_error; no duplicate/orphan | Hash/size/DB/object counts reconcile | Purge fixtures | PARTIAL | PLANNED |
| TC-055 File permission/IDOR matrix | API/Security/P0 | FR-064..FR-070; SEC-002, SEC-005, SEC-006, SEC-009; DES-012, DES-015; TASK-024 | General/sensitive files, all roles | list/preview/download/update/deactivate/delete | Exact projection/access; safe cross-owner/absent behavior | Restricted filename/path never leaked | Reset fixture | YES | PLANNED |
| TC-056 Download headers/range/session | API/Security/P1 | FR-065..FR-068; DES-012, DES-014; TASK-024 | Image/PDF/sensitive large file | Download/preview/range/replay | no-store/nosniff/sandbox/disposition; bounded session bound to actor/file | Audit once per authorized session; expired replay denied | Remove files | YES | PLANNED |
| TC-057 File delete/orphan cleanup | Fault/Storage/P0 | FR-067..FR-070; DES-012; TASK-023, TASK-024 | referenced/unreferenced/stale/deleting files | Delete with injected failures; run cleanup | Referenced retained; only proven orphans removed; delete resumes | DB/object/audit invariant exact | Reset storage | PARTIAL | PLANNED |
| TC-058 Sensitive file browser lifecycle | Playwright/Security/P0 | FR-064..FR-070; DES-016; TASK-024 | Bank viewer/non-viewer | list/upload/re-auth/preview/back | Restricted metadata hidden; authorized flow clears state and has no failures | No plaintext/path in DOM/cache/network logs | Clear browser | PARTIAL | PLANNED |
| TC-059 CSV parser/header safety | Unit/Security/P0 | FR-084..FR-087, FR-091; DES-013; TASK-025 | RFC4180/BOM/UTF8/duplicate/unknown/sensitive headers | Precheck | Deterministic safe row errors; reserved fields rejected | Precheck changes no Customer data | Purge source | YES | PLANNED |
| TC-060 Import row aggregate atomicity | MySQL/P0 | FR-087..FR-090; NFR-006; DES-007, DES-013; TASK-026 | Mixed valid/invalid with children | Confirm/execute | Valid rows all-or-none with audit+applied marker; invalid no write | Counts and row evidence exact | Delete Draft rows | YES | PLANNED |
| TC-061 Import lease/crash/idempotency | Fault/Concurrency/P0 | FR-089, FR-090, FR-093; NFR-008; DES-006, DES-013; TASK-026 | Two workers/crash/commit unknown | Claim/kill/restart/replay confirm | Terminal rows never replay; one effect; outcome reconcilable | Job summary recomputed from rows | Reset jobs | PARTIAL | PLANNED |
| TC-062 Import activation/approval snapshot | Integration/P0 | FR-087..FR-090; DES-010, DES-013; TASK-026 | setting OFF/ON changed after confirm | Import activate rows | Confirm snapshot governs; eligible approver; no self approval | UI/API/import parity | Withdraw pending | YES | PLANNED |
| TC-063 Import file/result recovery | Fault/Storage/P0 | FR-084..FR-093; DES-012, DES-013; TASK-026 | Crash during source/result finalize | Restart/recover/download | One source/result object or explicit error; no false completed state | Hash/row counts reconcile | Purge test files | PARTIAL | PLANNED |
| TC-064 Import 10k performance | Performance/P1 | NFR-004; DES-013, DES-023; TASK-028 | 10k representative rows | Precheck+execute | <10m excluding user delay; bounded heap/locks; responsive core API | Reproducible p50/p95/resources recorded | Drop dataset | PARTIAL | PLANNED |
| TC-065 Import UI/recovery | Playwright/P1 | FR-084..FR-093; DES-016; TASK-027 | Valid/error/partial/failed/expired jobs | Template-upload-precheck-confirm-poll-result | States/counts/errors/expiry visible; invalid cannot force | No console/network failures; refresh resumes | Cancel/purge job | YES | PLANNED |
| TC-066 Export filter/security/ownership | API/Playwright/P0 | FR-091..FR-093; SEC-013, SEC-014; DES-013, DES-016; TASK-027 | Filters, two owners, dangerous cells, sensitive data | Create/poll/download/replay | Exact allowed rows/columns; formula neutralized; owner/expiry enforced | Bank/file/creditNotes absent; audit exists | Expire result | YES | PLANNED |
| TC-067 Audit query/immutability/privilege | DB/API/Security/P0 | FR-094..FR-100; DES-021; TASK-005, TASK-033 | All action families/runtime DB role | Query and attempt update/delete | Cursor/filter works; app/runtime cannot mutate history | Required actions correlated; forbidden data zero | None | PARTIAL | PLANNED |
| TC-068 Sensitive UI responsive/a11y | Playwright/A11y/P1 | NFR-011, NFR-014; DES-016; TASK-022, TASK-024, TASK-027 | Four viewports/keyboard | Bank/file/import/export journeys | Accessible controls/status/focus and no blocking overflow | Scan+manual checklist passes | Clear browser | PARTIAL | PLANNED |
| TC-069 Phase-3 regression/no-secret scan | Regression/Security/P0 | SEC-010..SEC-014; DES-023, DES-025; TASK-028 | Candidate build and synthetic secrets | Full Phase suite plus scans | All gates pass; no secret fixture in outputs | No skipped/deleted coverage; report complete | Remove artifacts | PARTIAL | PLANNED |

## 5. Consumers, Capacity and Recovery

| ID / title | Type / priority | Requirement / design / task | Preconditions / data | Trigger / steps | Expected technical result | Acceptance criterion | Cleanup | Auto | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-070 Sales new-customer contract | Contract/P0 | FR-034, FR-050..FR-056; DES-017; TASK-029 | Real Sales consumer; all statuses/policies | Create/submit SO around status/policy change | Active-only new sale; no address at order; current policy/default snapshot | Real consumer/provider versions and errors match | Cancel fixture SO | YES | PLANNED |
| TC-071 Fulfillment existing-order contract | Contract/P0 | FR-042..FR-048; DES-017; TASK-030 | Confirmed SO; customer later non-Active | Select/submit shipment with address races | Customer status alone does not block existing order; child invalidity does | Exact immutable snapshot | Reverse fixture shipment | YES | PLANNED |
| TC-072 Invoice existing-shipment/manual split | Contract/P0 | FR-034, FR-050..FR-056; DES-017; TASK-031 | Real Invoicing consumer | Invoice shipped source/manual for all statuses | Existing source allowed per contract; manual Active-only | No generic eligibility bypass | Void Draft fixture | YES | PLANNED |
| TC-073 AR existing-document contract | Contract/P0 | FR-050..FR-056; DES-009, DES-017; TASK-031 | Existing invoice/credit/receipt | Suspend/block customer then settle/query | Existing AR continues; credit policy null/zero/hold exact | Customer update does not rewrite finance snapshot | Reverse test receipt | YES | PLANNED |
| TC-074 Returns/refund purpose contract | Contract/Security/P0 | FR-047, FR-048, FR-057..FR-063; DES-011, DES-017; TASK-031 | Real consumer where implemented | Historical return/refund bank select then change | Historical return status-tolerant; bank active/owned/audited | Absent consumer marked BLOCKED, never faked PASS | Reset fixture | PARTIAL | PLANNED |
| TC-075 Consumer provider version/readiness | Contract/Resilience/P0 | NFR-010, NFR-011; DES-020, DES-025; TASK-029..TASK-032 | Compatible/incompatible/unavailable provider | Start/health/call | Incompatible fails readiness; optional failure isolated; no fallback rule copy | Health identifies safe dependency without sensitive detail | Restore provider | YES | PLANNED |
| TC-076 IDOR across every resource | Security/P0 | SEC-009; DES-014, DES-015; TASK-032, TASK-033 | Two Customers/all child IDs/jobs/files | Substitute IDs on all endpoints | Safe same-shape denial/absence; no timing/metadata leak | Zero cross-owner data/effects | None | YES | PLANNED |
| TC-077 Auth revocation during operation | Security/Concurrency/P0 | SEC-001..SEC-008, SEC-012; DES-015; TASK-033 | Token before user/role revoke | Write/reveal/approve/worker submit after revoke | Fresh checks deny high-risk/commit point; safe worker actor policy | No stale privilege effect | Re-enable actor | YES | PLANNED |
| TC-078 Injection/output security suite | Security/P0 | SEC-013; DES-014, DES-016; TASK-033 | SQL/XSS/CSV/path/header payloads | Submit/search/render/export/download | No execution/query manipulation/path escape/content sniff | Stable safe behavior and zero secret leak | Remove payloads | YES | PLANNED |
| TC-079 Resource exhaustion/backpressure | Resilience/P1 | NFR-001..NFR-005; DES-019, DES-023; TASK-034 | Pool/upload/worker/query limits | Saturate bounded resources | Bounded 429/503/queue; core health remains meaningful | No unbounded memory/queue/lock | Stop load | PARTIAL | PLANNED |
| TC-080 Structured logs/metrics/alerts | Observability/P1 | FR-094..FR-100; DES-023; TASK-033 | Trigger success/conflict/denial/integrity/stuck cases | Inspect telemetry/alerts | Correlation works; low-cardinality labels; alerts fire/reset | Sensitive marker scan zero; runbook actionable | Reset alerts | PARTIAL | PLANNED |
| TC-081 Runtime DB privilege separation | Security/DB/P0 | FR-099; DES-021; TASK-033 | Runtime/migration/emergency DB roles | Attempt DDL/audit mutation with runtime | Runtime denied; migration path controlled and logged | App functions normally with least privilege | Revoke test session | PARTIAL | PLANNED |
| TC-082 100k/50-user latency | Performance/P1 | NFR-001..NFR-005; DES-018, DES-019, DES-023; TASK-034 | Declared dataset/mix/environment | Warm and fixed-window load | p95<2s target/error<1%; invariant zero; metrics complete | Reproducible report with plans/resources | Drop dataset | PARTIAL | PLANNED |
| TC-083 Default/approval contention load | Concurrency/P0 | NFR-007; DES-007, DES-008, DES-010; TASK-034 | 100 concurrent conflicting commands | Barrier load | No double default/decision/lost update; bounded conflict | DB invariants and audit reconcile | Reset DB | PARTIAL | PLANNED |
| TC-084 Dependency outage degradation | Resilience/P0 | NFR-010; DES-020, DES-025; TASK-032, TASK-033 | Scanner/key/storage/provider outage | Operate core/sensitive/destructive paths | Core safe reads continue where designed; sensitive/delete fail closed | No eligibility relaxation/data exposure | Restore dependency | PARTIAL | PLANNED |
| TC-085 Backup restore completeness | Recovery/P0 | NFR-009, NFR-015; DES-024; TASK-035 | Backup with DB/keys/files/audit/import | Isolated restore and smoke | Every sampled resource decrypts/downloads/traces; bad/missing key fails closed | Counts/hashes/references reconcile | Destroy restore | PARTIAL | PLANNED |
| TC-086 RPO measurement | DR/P0 | NFR-015; DES-024; TASK-035 | Timed writes before simulated loss | Restore latest permitted point | Maximum confirmed data loss <=15m | Timeline and reconciliation prove bound | Destroy restore | NO | PLANNED |
| TC-087 RTO measurement | DR/P0 | NFR-015; DES-024; TASK-035 | Declared incident start/runbook/team | Restore, reconcile, readiness, smoke | Safe service recovered <=4h | Timer includes keys/files/provider reconciliation | Destroy restore | NO | PLANNED |
| TC-088 Compatible deployment/rollback | Deployment/P0 | NFR-006, NFR-011; DES-022, DES-025; TASK-036 | Previous/new app and upgrade DB | Deploy mixed window then rollback app | No corrupt writes/unknown states; disabled capabilities safe | Forward schema and old app compatibility proven | Reset environment | PARTIAL | PLANNED |
| TC-089 Full regression and coverage | Regression/P0 | FR-001..FR-100; SEC-001..SEC-014; NFR-001..NFR-015; DES-001..DES-025; TASK-036 | Candidate build | Run lint, coverage, server/client, MySQL, Playwright, security | Required suites pass with no skips/lowered floors | Evidence tied to build; defects triaged | Reset test env | PARTIAL | PLANNED |
| TC-090 Formal testing handoff integrity | Review/P0 | All canonical requirements; DES-025; TASK-036 | Complete implementation evidence | Audit traceability/baseline/runbooks | Test team can execute independently; blockers explicit | Status only READY_FOR_TESTING, never accepted | None | NO | PLANNED |

## 6. Entry and Exit Criteria

Entry requires approved aligned artifacts, a declared implementation baseline, production-like MySQL/configuration, synthetic data, real consumers for contract cases, test keys/scanner/encrypted storage, Playwright-capable running app and isolated load/restore environments.

Technical Acceptance exit requires all P0 PASS, all P1 executed or formally accepted with owner/date/risk, no unresolved S1/S2, measurable NFR evidence, complete failure triage/retest/regression and a traceability audit. A detailed test plan or developer verification is not a PASS.

## 7. Coverage Manifest

The complete requirement set under test is:

- FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100.
- NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011, NFR-012, NFR-013, NFR-014, NFR-015.
- SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014.

<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Formal Technical Test Definitions

## TC-001 — Migration allocation and rerun

### Preconditions and data

Fresh and upgrade DB; latest main

### Steps

Allocate, migrate, rerun

### Expected result

Unique sequence; complete schema; rerun no-op

### Acceptance criteria

Schema/index/seed manifest exact; no partial incompatible table Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Drop test DB

## TC-002 — Permission catalogue/seed

### Preconditions and data

Fresh roles/users

### Steps

Migrate and compare catalogue/DB

### Expected result

Six permissions exact; no implicit inheritance/bank grant

### Acceptance criteria

Role matrix equals design Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset DB

## TC-003 — Shared catalog ownership

### Preconditions and data

Existing/absent compatible tables

### Steps

Install both paths; read/inactivate values

### Expected result

One owner; HKD valid; inactive values preserved/not assignable

### Acceptance criteria

No duplicate table/service semantics Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset DB

## TC-004 — Customer Code normalization

### Preconditions and data

Unicode/case/space/control vectors

### Steps

Normalize/validate

### Expected result

Display trim only; canonical key deterministic; invalid rejected

### Acceptance criteria

Expected vector equality exact Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-005 — Legal Name normalization

### Preconditions and data

NFKC, accent, punctuation, suffix vectors

### Steps

Normalize and compare

### Expected result

Only defined transformations collapse values

### Acceptance criteria

Distinct legal entities not over-collapsed Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-006 — Identifier normalization

### Preconditions and data

Types/countries/format variants

### Steps

Normalize/validate

### Expected result

Type-aware key, no invented national rule

### Acceptance criteria

Stable key/error for each vector Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-007 — Concurrent canonical uniqueness

### Preconditions and data

Two connections, same canonical key

### Steps

Barrier inserts/updates

### Expected result

Exactly one commit; safe conflict for loser

### Acceptance criteria

DB count=1, no orphan/audit mismatch Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Rollback fixture

## TC-008 — Binary-key collation proof

### Preconditions and data

Accent/case/punctuation pairs

### Steps

Insert normalized keys

### Expected result

DB equality matches application bytes exactly

### Acceptance criteria

Service and DB result matrices identical Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset DB

## TC-009 — Audit atomic rollback

### Preconditions and data

Force audit insert failure

### Steps

Execute each mutation family

### Expected result

Domain write rolls back; safe error/correlation

### Acceptance criteria

No successful mutation without audit Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Remove fault

## TC-010 — Create Draft aggregate

### Preconditions and data

manager with unique root/optional children

### Steps

POST create, GET detail/audit

### Expected result

Whole aggregate created version1 Draft

### Acceptance criteria

Fields/children/audit exact or nothing Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Delete qualified Draft

## TC-011 — Direct activation minimum

### Preconditions and data

approval OFF; active/inactive currency

### Steps

Create/activate combinations

### Expected result

Only code/name/active currency block; warnings remain non-blocking

### Acceptance criteria

State/audit/minimum exact Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Archive fixture

## TC-012 — List/search/filter/page

### Preconditions and data

Representative root/child data

### Steps

Exact/token-prefix/filter/sort/page

### Expected result

Stable order, exact priority, archived default excluded, safe states

### Acceptance criteria

No missing/duplicate rows; bounded query Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset data

## TC-013 — Detail projection/large children

### Preconditions and data

>100 children; mixed sensitivity

### Steps

GET detail/child pages by roles

### Expected result

Allowlisted data, masked bank, pagination

### Acceptance criteria

Zero restricted/internal fields Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset data

## TC-014 — Root CAS conflict

### Preconditions and data

Two editors version N

### Steps

Save A then B

### Expected result

A succeeds N+1; B 409; no lost update

### Acceptance criteria

DB/audit only A Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Restore fixture

## TC-015 — Mass assignment and validation

### Preconditions and data

Extra/protected fields and malformed IDs

### Steps

Submit create/update

### Expected result

400/403 safe error; no side effect

### Acceptance criteria

`additionalProperties:false`; Code not updateable Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-016 — Create idempotency

### Preconditions and data

Same/different key/payload

### Steps

Repeat concurrent requests

### Expected result

Same outcome for same pair; conflict for changed payload; one Customer

### Acceptance criteria

One resource/audit effect Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Delete Draft

## TC-017 — Commit-unknown reconciliation

### Preconditions and data

Disconnect at commit

### Steps

Create/update then query operation/resource

### Expected result

Client can determine one outcome without new-key duplicate

### Acceptance criteria

One or zero effect consistent with outcome Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Clear fault

## TC-018 — Child ownership/IDOR

### Preconditions and data

Customer A/B and child A

### Steps

Use child A under B

### Expected result

Safe absent/denial; no metadata/state leak

### Acceptance criteria

A unchanged; equivalent absent response Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-019 — Address default race

### Preconditions and data

Two active shipping addresses

### Steps

Barrier set both default

### Expected result

At most one default; one safe conflict/reload

### Acceptance criteria

Unique slot and service invariant hold Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Restore default

## TC-020 — Contact default/purpose

### Preconditions and data

Multi-contact/multi-purpose

### Steps

Replace purposes/default/deactivate

### Expected result

Multiple contacts allowed; one default per purpose; inactive not default

### Acceptance criteria

Mapping/root versions/audit exact Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset fixture

## TC-021 — Identifier CRUD/race

### Preconditions and data

Cross-customer duplicate vectors

### Steps

Create/update/deactivate/concurrent create

### Expected result

Global key cannot be reused; safe conflict

### Acceptance criteria

One owner, history retained Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset DB

## TC-022 — Credit null/zero/hold

### Preconditions and data

No row, null, zero, positive, hold

### Steps

Save/get/clear

### Expected result

Three semantics remain distinct in API/DB/provider

### Acceptance criteria

Decimal string exact; no exposure calculation Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Clear policy

## TC-023 — Credit invalid combinations

### Preconditions and data

Negative, bad precision, inactive/missing currency

### Steps

Save

### Expected result

Stable validation; no write/audit

### Acceptance criteria

All invalid vectors rejected atomically Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-024 — Credit create/clear CAS

### Preconditions and data

Two first creates/two clears

### Steps

Barrier commands

### Expected result

One winner; no lost update/double audit

### Acceptance criteria

State/version/audit consistent Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Clear fixture

## TC-025 — Credit audit redaction

### Preconditions and data

Notes/reason with sensitive markers

### Steps

Save/query logs/audit

### Expected result

Required before/after/reason; forbidden data absent

### Acceptance criteria

Controlled search count=0 Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Delete fixture

## TC-026 — Provider registry readiness

### Preconditions and data

READY/UNKNOWN/missing providers

### Steps

Delete/archive/read health

### Expected result

Destructive command only on all READY/NO_REFERENCE

### Acceptance criteria

Unknown never treated as clear Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Restore provider

## TC-027 — Purpose lookup matrix

### Preconditions and data

All statuses/purposes

### Steps

Call named lookup/assert

### Expected result

Matrix exact; unknown purpose rejected; minimal projection

### Acceptance criteria

No status or data overreach Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-028 — Query plan/deep data

### Preconditions and data

100k distribution

### Steps

EXPLAIN and representative queries

### Expected result

Indexed exact/prefix/EXISTS; stable paging

### Acceptance criteria

No leading-wildcard standard path/cartesian count Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Drop dataset

## TC-029 — Public error/log redaction

### Preconditions and data

SQL/file/bank/secret markers

### Steps

Trigger validation/DB/internal errors

### Expected result

Stable public codes; no stack/path/index/plaintext

### Acceptance criteria

Controlled response/log scan zero hits Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Remove fixtures

## TC-030 — Lifecycle state matrix

### Preconditions and data

Every state/action pair

### Steps

Invoke commands

### Expected result

Only listed transitions; reason/auth/version enforced

### Acceptance criteria

State/audit exactly match matrix Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset data

## TC-031 — Suspend/reactivate downstream

### Preconditions and data

Active with existing/new transactions

### Steps

Suspend then consumer calls

### Expected result

New sale rejected; existing obligation purpose still valid

### Acceptance criteria

No historical snapshot rewrite Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reactivate

## TC-032 — Archive/delete guards

### Preconditions and data

Referenced/unreferenced/ever-active/provider-down

### Steps

Archive/delete

### Expected result

Safe blockers/UNKNOWN; only pristine Draft deletes

### Acceptance criteria

No cascade loss/audit absence Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset fixture

## TC-033 — Settings CAS/non-retroactivity

### Preconditions and data

OFF/ON and pending request

### Steps

Concurrent setting update

### Expected result

One winner; pending unchanged; audit exact

### Acceptance criteria

Effective/version value correct Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Restore OFF

## TC-034 — Approval submit eligibility

### Preconditions and data

self/disabled/no-permission/valid approver

### Steps

Submit

### Expected result

Only different active authorized approver accepted

### Acceptance criteria

Customer/request states atomic Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Withdraw valid

## TC-035 — Approval snapshot invalidation

### Preconditions and data

Pending version/hash

### Steps

Critical/noncritical edits

### Expected result

Critical edit invalidates and returns Draft in same tx; safe snapshot

### Acceptance criteria

No bank/restricted data in snapshot Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset fixture

## TC-036 — Approval decision race

### Preconditions and data

One pending request

### Steps

Barrier approve/reject/double click

### Expected result

One terminal decision; replay reports existing result

### Acceptance criteria

One state/audit/effect Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset DB

## TC-037 — Withdraw/reassign authorization

### Preconditions and data

requester/other/approvers

### Steps

Withdraw/reassign

### Expected result

Actor/state restrictions exact; safe denial

### Acceptance criteria

Queue/assignment/history consistent Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset fixture

## TC-038 — Block/unblock authorization

### Preconditions and data

roles/high-auth states

### Steps

Block/unblock

### Expected result

Approval+device/password/reason required; unblock->Suspended

### Acceptance criteria

Fresh revoked permission denied Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Restore state

## TC-039 — Client contract/error mapping

### Preconditions and data

All stable error fixtures

### Steps

Service calls/abort/version responses

### Expected result

Typed mapping and Chinese safe message; no stale request overwrite

### Acceptance criteria

No server detail leakage Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-040 — Customer browser happy path

### Preconditions and data

Running app; manager actor

### Steps

Create/search/edit/address/contact/credit

### Expected result

Observable state/audit and URL refresh correct

### Acceptance criteria

No relevant console/network failures Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Archive fixture

## TC-041 — Browser permission and direct URL

### Preconditions and data

Viewer/manager/approver/no-access

### Steps

Navigate and invoke controls/direct routes

### Expected result

UI only exposes legal actions; server rejects bypass

### Acceptance criteria

No data/metadata leak Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-042 — Browser validation/conflict

### Preconditions and data

Invalid fields/two sessions

### Steps

Submit errors and stale version

### Expected result

Focusable summary/field errors; input recoverable; no overwrite

### Acceptance criteria

Keyboard-only flow succeeds Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset fixture

## TC-043 — Approval/settings browser flow

### Preconditions and data

Manager/approver/settings actors

### Steps

Toggle, submit, decide, stale case

### Expected result

Scope/diff/impact/reason/re-auth visible and correct

### Acceptance criteria

Refresh/back states accurate; no console/network errors Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Restore OFF

## TC-044 — Responsive/accessibility core

### Preconditions and data

375/768/1024/1440; keyboard/screen reader checks

### Steps

Core journeys

### Expected result

No inaccessible action/overflow blocker; headings/labels/status/focus/contrast valid

### Acceptance criteria

Automated scan plus manual keyboard checklist Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-045 — Sensitive delegation boundary

### Preconditions and data

protected admin/ordinary admin/roles

### Steps

Delegate and access routes

### Expected result

Only approved flow delegates; delegator lacks route access unless separately assigned

### Acceptance criteria

No privilege escalation/replay; full audit Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Remove test roles

## TC-046 — Bank crypto vectors/AAD

### Preconditions and data

Keys, tamper, cross-owner ciphertext

### Steps

Encrypt/decrypt/move/tamper

### Expected result

Valid round-trip; tamper/cross-owner/unknown key fail closed

### Acceptance criteria

No plaintext in error/log Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Zero buffers/fixtures

## TC-047 — Bank schema/default/duplicate race

### Preconditions and data

Two banks/connections/rotating keys

### Steps

Create/default/duplicate barriers

### Expected result

One same-owner account/default; cross-owner warning only

### Acceptance criteria

Constraints and safe error exact Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset DB

## TC-048 — Bank permission matrix

### Preconditions and data

All permission combinations

### Steps

list/create/update/default/deactivate/reveal

### Expected result

Masked list broadly safe; full/rewrite only exact permission+auth

### Acceptance criteria

Unauthorized side effects=0 Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset fixture

## TC-049 — Bank reveal memory/cache/audit

### Preconditions and data

Authorized actor/browser

### Steps

Reveal, timeout, unmount, back/cache

### Expected result

Audit precedes value; no-store; DOM/state cleared

### Acceptance criteria

Plaintext absent from logs/storage/history/snapshots Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Close browser/clear data

## TC-050 — Cross-customer bank warning token

### Preconditions and data

Same canonical bank under A/B

### Steps

Precheck/confirm tampered/replayed token

### Expected result

Valid actor+payload+target+expiry only; no other data leak

### Acceptance criteria

One controlled result/audit Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Deactivate fixture

## TC-051 — Bank rotation/reindex recovery

### Preconditions and data

old/new key rings; interrupted batches

### Steps

Rotate/reindex/resume/retire

### Expected result

New writes new key; all reads; idempotent resume; zero-old proof

### Acceptance criteria

Counts reconcile; no plaintext report Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Restore keys/test DB

## TC-052 — Bank config/backup failure

### Preconditions and data

missing/wrong keys and restored DB

### Steps

Start/reveal/restore

### Expected result

Capability/readiness fails closed; correct set restores

### Acceptance criteria

No silent data loss or plaintext workaround Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Destroy test restore

## TC-053 — File type/path/scan validation

### Preconditions and data

Valid, polyglot, SVG, traversal, infected/error files

### Steps

Upload

### Expected result

Only allowlisted clean signature accepted; temp cleaned safely

### Acceptance criteria

No metadata/orphan for rejected input Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Purge fixtures

## TC-054 — File finalize crash recovery

### Preconditions and data

Fault at stream/metadata/move/finalize

### Steps

Upload then restart recovery

### Expected result

Deterministic operation becomes one active or storage_error; no duplicate/orphan

### Acceptance criteria

Hash/size/DB/object counts reconcile Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Purge fixtures

## TC-055 — File permission/IDOR matrix

### Preconditions and data

General/sensitive files, all roles

### Steps

list/preview/download/update/deactivate/delete

### Expected result

Exact projection/access; safe cross-owner/absent behavior

### Acceptance criteria

Restricted filename/path never leaked Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset fixture

## TC-056 — Download headers/range/session

### Preconditions and data

Image/PDF/sensitive large file

### Steps

Download/preview/range/replay

### Expected result

no-store/nosniff/sandbox/disposition; bounded session bound to actor/file

### Acceptance criteria

Audit once per authorized session; expired replay denied Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Remove files

## TC-057 — File delete/orphan cleanup

### Preconditions and data

referenced/unreferenced/stale/deleting files

### Steps

Delete with injected failures; run cleanup

### Expected result

Referenced retained; only proven orphans removed; delete resumes

### Acceptance criteria

DB/object/audit invariant exact Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset storage

## TC-058 — Sensitive file browser lifecycle

### Preconditions and data

Bank viewer/non-viewer

### Steps

list/upload/re-auth/preview/back

### Expected result

Restricted metadata hidden; authorized flow clears state and has no failures

### Acceptance criteria

No plaintext/path in DOM/cache/network logs Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Clear browser

## TC-059 — CSV parser/header safety

### Preconditions and data

RFC4180/BOM/UTF8/duplicate/unknown/sensitive headers

### Steps

Precheck

### Expected result

Deterministic safe row errors; reserved fields rejected

### Acceptance criteria

Precheck changes no Customer data Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Purge source

## TC-060 — Import row aggregate atomicity

### Preconditions and data

Mixed valid/invalid with children

### Steps

Confirm/execute

### Expected result

Valid rows all-or-none with audit+applied marker; invalid no write

### Acceptance criteria

Counts and row evidence exact Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Delete Draft rows

## TC-061 — Import lease/crash/idempotency

### Preconditions and data

Two workers/crash/commit unknown

### Steps

Claim/kill/restart/replay confirm

### Expected result

Terminal rows never replay; one effect; outcome reconcilable

### Acceptance criteria

Job summary recomputed from rows Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset jobs

## TC-062 — Import activation/approval snapshot

### Preconditions and data

setting OFF/ON changed after confirm

### Steps

Import activate rows

### Expected result

Confirm snapshot governs; eligible approver; no self approval

### Acceptance criteria

UI/API/import parity Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Withdraw pending

## TC-063 — Import file/result recovery

### Preconditions and data

Crash during source/result finalize

### Steps

Restart/recover/download

### Expected result

One source/result object or explicit error; no false completed state

### Acceptance criteria

Hash/row counts reconcile Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Purge test files

## TC-064 — Import 10k performance

### Preconditions and data

10k representative rows

### Steps

Precheck+execute

### Expected result

<10m excluding user delay; bounded heap/locks; responsive core API

### Acceptance criteria

Reproducible p50/p95/resources recorded Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Drop dataset

## TC-065 — Import UI/recovery

### Preconditions and data

Valid/error/partial/failed/expired jobs

### Steps

Template-upload-precheck-confirm-poll-result

### Expected result

States/counts/errors/expiry visible; invalid cannot force

### Acceptance criteria

No console/network failures; refresh resumes Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Cancel/purge job

## TC-066 — Export filter/security/ownership

### Preconditions and data

Filters, two owners, dangerous cells, sensitive data

### Steps

Create/poll/download/replay

### Expected result

Exact allowed rows/columns; formula neutralized; owner/expiry enforced

### Acceptance criteria

Bank/file/creditNotes absent; audit exists Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Expire result

## TC-067 — Audit query/immutability/privilege

### Preconditions and data

All action families/runtime DB role

### Steps

Query and attempt update/delete

### Expected result

Cursor/filter works; app/runtime cannot mutate history

### Acceptance criteria

Required actions correlated; forbidden data zero Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-068 — Sensitive UI responsive/a11y

### Preconditions and data

Four viewports/keyboard

### Steps

Bank/file/import/export journeys

### Expected result

Accessible controls/status/focus and no blocking overflow

### Acceptance criteria

Scan+manual checklist passes Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Clear browser

## TC-069 — Phase-3 regression/no-secret scan

### Preconditions and data

Candidate build and synthetic secrets

### Steps

Full Phase suite plus scans

### Expected result

All gates pass; no secret fixture in outputs

### Acceptance criteria

No skipped/deleted coverage; report complete Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Remove artifacts

## TC-070 — Sales new-customer contract

### Preconditions and data

Real Sales consumer; all statuses/policies

### Steps

Create/submit SO around status/policy change

### Expected result

Active-only new sale; no address at order; current policy/default snapshot

### Acceptance criteria

Real consumer/provider versions and errors match Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Cancel fixture SO

## TC-071 — Fulfillment existing-order contract

### Preconditions and data

Confirmed SO; customer later non-Active

### Steps

Select/submit shipment with address races

### Expected result

Customer status alone does not block existing order; child invalidity does

### Acceptance criteria

Exact immutable snapshot Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reverse fixture shipment

## TC-072 — Invoice existing-shipment/manual split

### Preconditions and data

Real Invoicing consumer

### Steps

Invoice shipped source/manual for all statuses

### Expected result

Existing source allowed per contract; manual Active-only

### Acceptance criteria

No generic eligibility bypass Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Void Draft fixture

## TC-073 — AR existing-document contract

### Preconditions and data

Existing invoice/credit/receipt

### Steps

Suspend/block customer then settle/query

### Expected result

Existing AR continues; credit policy null/zero/hold exact

### Acceptance criteria

Customer update does not rewrite finance snapshot Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reverse test receipt

## TC-074 — Returns/refund purpose contract

### Preconditions and data

Real consumer where implemented

### Steps

Historical return/refund bank select then change

### Expected result

Historical return status-tolerant; bank active/owned/audited

### Acceptance criteria

Absent consumer marked BLOCKED, never faked PASS Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset fixture

## TC-075 — Consumer provider version/readiness

### Preconditions and data

Compatible/incompatible/unavailable provider

### Steps

Start/health/call

### Expected result

Incompatible fails readiness; optional failure isolated; no fallback rule copy

### Acceptance criteria

Health identifies safe dependency without sensitive detail Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Restore provider

## TC-076 — IDOR across every resource

### Preconditions and data

Two Customers/all child IDs/jobs/files

### Steps

Substitute IDs on all endpoints

### Expected result

Safe same-shape denial/absence; no timing/metadata leak

### Acceptance criteria

Zero cross-owner data/effects Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.

## TC-077 — Auth revocation during operation

### Preconditions and data

Token before user/role revoke

### Steps

Write/reveal/approve/worker submit after revoke

### Expected result

Fresh checks deny high-risk/commit point; safe worker actor policy

### Acceptance criteria

No stale privilege effect Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Re-enable actor

## TC-078 — Injection/output security suite

### Preconditions and data

SQL/XSS/CSV/path/header payloads

### Steps

Submit/search/render/export/download

### Expected result

No execution/query manipulation/path escape/content sniff

### Acceptance criteria

Stable safe behavior and zero secret leak Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Remove payloads

## TC-079 — Resource exhaustion/backpressure

### Preconditions and data

Pool/upload/worker/query limits

### Steps

Saturate bounded resources

### Expected result

Bounded 429/503/queue; core health remains meaningful

### Acceptance criteria

No unbounded memory/queue/lock Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Stop load

## TC-080 — Structured logs/metrics/alerts

### Preconditions and data

Trigger success/conflict/denial/integrity/stuck cases

### Steps

Inspect telemetry/alerts

### Expected result

Correlation works; low-cardinality labels; alerts fire/reset

### Acceptance criteria

Sensitive marker scan zero; runbook actionable Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset alerts

## TC-081 — Runtime DB privilege separation

### Preconditions and data

Runtime/migration/emergency DB roles

### Steps

Attempt DDL/audit mutation with runtime

### Expected result

Runtime denied; migration path controlled and logged

### Acceptance criteria

App functions normally with least privilege Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Revoke test session

## TC-082 — 100k/50-user latency

### Preconditions and data

Declared dataset/mix/environment

### Steps

Warm and fixed-window load

### Expected result

p95<2s target/error<1%; invariant zero; metrics complete

### Acceptance criteria

Reproducible report with plans/resources Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Drop dataset

## TC-083 — Default/approval contention load

### Preconditions and data

100 concurrent conflicting commands

### Steps

Barrier load

### Expected result

No double default/decision/lost update; bounded conflict

### Acceptance criteria

DB invariants and audit reconcile Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset DB

## TC-084 — Dependency outage degradation

### Preconditions and data

Scanner/key/storage/provider outage

### Steps

Operate core/sensitive/destructive paths

### Expected result

Core safe reads continue where designed; sensitive/delete fail closed

### Acceptance criteria

No eligibility relaxation/data exposure Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Restore dependency

## TC-085 — Backup restore completeness

### Preconditions and data

Backup with DB/keys/files/audit/import

### Steps

Isolated restore and smoke

### Expected result

Every sampled resource decrypts/downloads/traces; bad/missing key fails closed

### Acceptance criteria

Counts/hashes/references reconcile Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Destroy restore

## TC-086 — RPO measurement

### Preconditions and data

Timed writes before simulated loss

### Steps

Restore latest permitted point

### Expected result

Maximum confirmed data loss <=15m

### Acceptance criteria

Timeline and reconciliation prove bound Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Destroy restore

## TC-087 — RTO measurement

### Preconditions and data

Declared incident start/runbook/team

### Steps

Restore, reconcile, readiness, smoke

### Expected result

Safe service recovered <=4h

### Acceptance criteria

Timer includes keys/files/provider reconciliation Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Destroy restore

## TC-088 — Compatible deployment/rollback

### Preconditions and data

Previous/new app and upgrade DB

### Steps

Deploy mixed window then rollback app

### Expected result

No corrupt writes/unknown states; disabled capabilities safe

### Acceptance criteria

Forward schema and old app compatibility proven Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset environment

## TC-089 — Full regression and coverage

### Preconditions and data

Candidate build

### Steps

Run lint, coverage, server/client, MySQL, Playwright, security

### Expected result

Required suites pass with no skips/lowered floors

### Acceptance criteria

Evidence tied to build; defects triaged Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

Reset test env

## TC-090 — Formal testing handoff integrity

### Preconditions and data

Complete implementation evidence

### Steps

Audit traceability/baseline/runbooks

### Expected result

Test team can execute independently; blockers explicit

### Acceptance criteria

Status only READY_FOR_TESTING, never accepted Required evidence must be baseline-bound, low-sensitive and show every mandatory assertion with no unexplained skip.

### Cleanup

No mutable fixture cleanup; preserve redacted evidence and never delete audit/failure evidence.
