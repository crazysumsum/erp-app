# HD123 — TASK031 exact actor-binding replacement candidate

Status: PROPOSED_NOT_APPLIED. Sam's actual latest `A` answers HD122 and authorizes this proposal, not the unseen replacement or new-Lot extension. Canonical specs and product source remain unchanged. Harness IMPLEMENT / TASK031 IN_PROGRESS / BLOCKED.

## Exact review baseline

| Binding | SHA-256 |
| --- | --- |
| Proposed DESIGN | `ccd54a79438c2bb7e1cfcc58c9b8878b47120f0a3f91110a13d7d28202e05853` |
| Proposed PLAN | `4c074a4e344599e912aab7e351e93abfc5f447085657f59625f7c7a95c69440a` |
| Four-file patch | `c48ceae8cc7380926a896c8344b2f26d5ae7c865e8af6e07a2f82cc095e21ae7` |

Observed HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source fingerprint `20ec89c06143f630bd00a5c4307d3ceb94936601b587fb610f8c5d74196aa00b`. [Exact patch](task031-actor-binding-proposal.patch) / [file hashes and scope](task031-actor-binding-proposal.json). Candidate changes only manifest provided-contract version/pin, design §5.4.2, TASK031 plan and TC007 developer scenario text. Requirements/UAT/typed ledger/matrix/command profile remain byte-identical; no public request/result/permission/hash/TTL changes.

## Why A also needs a new-Lot clause

DEF009 native evidence identified the Operation users FK before Warehouse waits. Review additionally found unchanged0059 `fk_inventory_lots_created_by`: the current positive Adjustment resolver inserts actorUserId when creating Lot, before subsequent Bucket locking reads. From the schema/source and [MySQL26.7 FK-lock rule](https://dev.mysql.com/doc/refman/26.7/en/innodb-locks-set.html), this can recreate the same early user-lock problem after Operation-only deferral. This additional Lot path has not been newly executed or proven fixed; it requires explicit Sam approval as part of this exact candidate.

## Proposed transaction and minimum scope

1. Existing strong auth, credential-free input and initial non-locking guard; claim new Operation with temporary NULL actor_user_id, retain original actor_label and trusted context. Source/hash/claim uniqueness unchanged.
2. Existing stock/Lot/Bucket/Item/UOM waits. Only a Lot actually INSERTed by this transaction may have temporary NULL created_by. Identify actual creation by successful INSERT, not snapshot absence, NULL creator, timestamps or ambiguous upsert row counts. A unique race safely rejects/rolls back, with no automatic retry. Existing Lot—including a legitimate NULL creator—must not be backfilled or relabelled.
3. Final ordered current security guard; conditional bind exact incomplete NULL-actor Operation and exact owned new Lot, each affectedRows=1. Recheck original proof/abort, then stock/Movement/success Audit/Operation completion atomically. Every failure rolls back the entire transaction, including temporary metadata. No commit-then-repair or independently committed placeholder.
4. Successful commit has true trusted actor/new-Lot creator and immutable original result. Later existing ON DELETE SET NULL semantics remain unchanged. HTTP/domain replay never updates existing attribution and still requires fresh current guard after waits.

Keep this inside the existing Posting owner/Adjustment helper. No generic binder, new Operation service, public defer flag, DDL/FK removal/check disabling or shared auth/admin edit. Receipt/Issue/BinMove/Transfer attribution and public contracts stay unchanged. The existing13 owned source/test paths suffice; all8 shared framework/test paths are byte-identical and need only new-PLAN scope rebind, along with byte-identical existing0064/previously authorized synthetic migration use. No new allowed path or module/table ownership.

## Verification still required after exact approval

All17 named developer scenarios are NOT_RUN on the replacement baseline. The new ADJ031-ACTOR-BIND covers exact ownership, successful attribution, existing NULL Lot preservation, replay immutability and binding-zero/error/deadline/abort rollback. Expanded REVOKE-ORDER requires real0056/0059 FKs, Warehouse and post-new-Lot Bucket barriers, and actual writer COMMIT before release—not merely a pending update. Guard-first revocation must wait through commit; real admin token-first behavior also remains a compatibility check.

DEF010 is an established representation fix, not a weaker date policy: reuse owned SQL DATE_FORMAT, no global/fixture-only dateStrings, timezone date slicing or weakened validation. Tests must prove the intended Audit injector was reached rather than accepting an earlier DATE error as rollback evidence. Fresh MySQL26.7/API/focused/full-server/client/lint/build/34 floors/zero-skip/actual Transfer Playwright regression and final actual Sam source review remain required. No skip, floor/parser or capacity waiver.

## Current observed results and provenance

Docs-only Codex /root SELF_REVIEW is not independent. Candidate structural traceability, unchanged matrix/profile/pins and fresh-copy exact four-file replay PASS. Current active state/traceability/boundary remain consistent; full candidate approval is pending Sam. DEF009/010 stay HIGH OPEN.

Original native result remains21PASS/3FAIL/24total/0skip, unchanged on its original source/PLAN. All164 evidence references retained; no promotion of older2160-pass source or focused110 checks to this replacement. Owned runtime was already precisely cleaned; this turn starts no runtime and exports no evidence. Formal TC/UAT NOT_RUN; no TASK031 DONE/full-P3/release claim.

## Decision Required — HD123

Please independently review this exact patch/baselines and approve canonical adoption plus the new-Lot deferral clause, existing precise path/0064 scope rebind, and TASK031-only local remediation/developer checks. Your HD122 A selected Operation deferral; HD123 would additionally authorize only genuinely new Lot creator deferral needed to preserve the same final-guard contract.

Recommendation: approve after review. Alternative: request amendments; keeping Operation-only A leaves the discovered new-Lot early-FK path unresolved. Default hold canonical/source writes and completion until actual response. This is not future implementation acceptance or authority to stage/commit/push/PR/remoteCI/merge/main-adopt, execute TASK032+/UI, add DDL/permissions/dependencies/global auth/config changes, or grant formal/business/release acceptance.
