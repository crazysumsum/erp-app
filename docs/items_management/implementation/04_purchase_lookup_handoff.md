# TASK-046 — Item purchase lookup handoff implementation

Scope: PHASE008, FR065/066, DES021, TC017/018; authoritative Supplier handoff HD093 A and Sam's actual new DESIGN/PLAN approval (APR048/049, HD010). Latest main/entry `a71f348879bb04df38cdeda4348d9031ec10d7f3`; isolated branch `codex/item-purchase-lookup-handoff`. Planning checkpoint `34207893f0c543cfb7a82857a50736c6e80c4974`, PR210. This is IMPLEMENT/developer verification, not formal TC/UAT/business/release acceptance.

Approved DESIGN `f7431c0934377f3331fd0a537e236eca8044df41f359d36202153803c4aca315`; PLAN `d6db1f524df15257eca36eb0d4117efe8f20352a07e931b6511df7d8795e5de4`. Current source fingerprint `726268dd250d995748d8487522c1193bec75cd7f8045f0ceeca4d02bf5de95e2`.

## Delivered behavior

Only ItemLookupService product changes (30 added/changed lines): purchase-purpose UOMs add association `skuUomId`, master name and master status while retaining every old field/value/entry and existing eligibility/reasons. Non-purchase generic, Inventory and existing Sales behavior is unchanged.

New `searchForPurchase({q,page,pageSize})` uses current purchase predicates, inclusive dates and SEARCH-only active-UOM EXISTS, shared count/page WHERE at one clock time, literal-prefix escaping, stable code/ID paging and batched UOM loading. At most3 queries, 2 for an empty page. Serial/non-sellable purchases remain eligible. No Supplier code/pin, endpoint, migration file/schema, permission, lock, transaction-version, barcode or frontend change.

Discovery remains advisory; consumers authorize and revalidate current SKU/UOM on submit. Inactive UOMs remain in lookup/search projections for historical display; the consumer owns refusing them as new choices. No new audit/data writes or sensitive logging; user q stays in SQL parameters, with string/control/length/numeric/offset validation before SQL.

## Actual developer verification

- TDD: six new unit cases first FAILED for absent metadata/search; minimal implementation then full lookup unit49/49 PASS, zero skips.
- Real-MySQL full Item lookup integration14/14 PASS, zero skips: mapping/master identities, inactive metadata retention, old purposes, all statuses/purchasable/dates including equality, serial/non-sellable, all-inactive-UOM SEARCH-only exclusion, literal `%_!`, totals and static-page ordering.
- Mutation check: temporarily removed only new search active-UOM gate; real TC018 failed with total6 versus expected5. Reverse patch restored exact bytes (cmp PASS) and fingerprint726 before official suites; mutant/failed diagnostic is not shipped or promoted to acceptance.
- Four configured developer suites on source726/approved PLAN: lint/build PASS, server509/509 and client860/860, zero failures/skips/not-run. Local run IDs: `20261013T071952-44df4fe3d5d9`, `20261013T071957-3834f342b77f`, `20261013T072003-afb4bd495d57`, `20261013T072010-c821362edb23`.
- Actual separate reviewer `/root/item_supplier_handoff_review` APPROVED source726 with no actionable findings; independently reran Item/Supplier/Inventory/Sales non-DB compatibility72/72 PASS, zero skips. Exact frozen candidate audit and fresh five-job CI remain required.

Task-private MySQL26.7.0, socket-only `/private/tmp/erp-item-purchase-mysql.4wDOc0/mysql.sock`, new synthetic schema `erp_item_purchase_20261013`; existing migrations through0081 applied there without editing migrations or shared services/data. Task-owned `npm ci --offline` follows existing lockfile (429 installed, no new dependency/lock change). Fixture teardown touches only this isolated schema. This backend-only internal provider has no new browser surface; manual UAT017 remains NOT_RUN and belongs to later TEST_AND_VERIFY, not these developer results.

## Consumer handoff / remaining gates

New Item provided document SHA256: `1bbb882f0f1faed296615b5b253f3e6169d79b6289d1a6300e078377400e4a7f` (manifest refreshed). Supplier/Purchasing/Inventory/Sales owners review/refresh their own pins; Item does not edit their documents or contact their threads without authority. Handoff question1: discontinued Item/SKU is not allowed for new purchase; active-UOM is a discovery filter only, not a generic purchase-policy change. Question2: implementation/local regression is complete; integration availability depends on current candidate CI/review and actual merge, so no fabricated date is given.

Extra raw run packages are local-only; no repository export inferred from older PR198 batch approval. The tracked checkpoint keeps its original25 evidence pointers; runtime journal will register new runs locally after freezing the candidate, and all history/evidence is preserved before any cleanup. PR198's real merge/cleanup and Recovery owner waiver/TC016 NOT_RUN remain historical, not current test credit.

No aggregate TASK043 completion is claimed: Supplier reference/GR-history increment C and formal acceptance D remain separate. New candidate must pass exact review and all five CI jobs; actual merge/cleanup still needs authority for PR210. Until then TASK046 is IN_PROGRESS, PR/worktree retained. The obsolete empty provisional Item worktree was archived recoverably after confirming no unique commit/dirty files; its empty branch was removed non-force, other modules untouched.
