# REV-118 — independent review of address and contact ordering (DEF-037, HD-129 A, HD-136)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def037-ordering` at `6335ce90`, reviewed as `git diff origin/main..HEAD` (base `1e57380e`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Two Medium, three Low, several Info.

## What the reviewer confirmed

- The change matches HD-136: the migration and its backfill order, the endpoints, the Audit actions, the list order, `sortOrder` in responses, the 0032/0033 inspectors with `up()` untouched, and design §5.5, §5.6 and §6.
- Suites: server 719 passed, 0 skipped; client 195 passed; technical Playwright 50 passed; UAT 20 passed and 5 skipped. UAT-048 passes, including after a reload.
- A separate browser probe of contacts showed the same behaviour as addresses.
- The ledger check found the 12 `-HD129` copies exact and nothing else edited. The manifest hash equals the design file's hash. The harness shows only COMMIT_CHANGED.
- Without 0103, the startup self-check already refused to start (E5).

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: two creates at the same time could get the same `sort_order`. Transactions run at REPEATABLE READ, and `MAX(sort_order)` was a plain read inside the read view taken before the Supplier lock. A tie could then make one move jump two places. | `nextSortOrder` and the swap now use locking reads (`FOR UPDATE`). Before swapping, rows that share an order are renumbered 1..n in display order, so a move is always one place. A regression test holds the Supplier lock while two creates queue, and expects distinct orders and a one-place move. A second test seeds tied rows. The non-locking read and the no-renumber mutant are both red. |
| M-2: no test proved a deployment without 0103 refuses to start (S05 survived). | New startup case 「missing column supplier_contacts.sort_order (0103)」. It expects the refusal and restores with 0103's own `up()`. S05 is red. |
| L-1: there was no written rollback. | The 0103 header now gives the manual rollback (drop both columns and remove the ledger row), says why the old build needs it, and notes that the users' ordering is lost. |
| L-2: S06, S07, S10 and S03 survived. | Unit tests: the 0032/0033 inspectors accept `sort_order` but refuse any other extra column and any missing one; the 0103 inspector refuses a nullable, a non-INT and a no-default column; the Purchasing ordering address has no `sortOrder`. S06, S07 and S10 are red. The Supplier lock is covered by the M-1 concurrency test. |
| L-3: the neighbour's version was bumped, which gave a needless 409 to anyone editing it, and the neighbour was not audited. | Only the moved row's version changes; the neighbour's content does not change. The Audit detail records the neighbour as `metadata.swappedWith {id, before, after}` (`metadata` is already an allowed key). Tests pin the unchanged neighbour version and the Audit detail. A mutant that bumps the neighbour's version is red. |
| I-1: after a refused move the list stayed out of date. | The panel reloads after a refused move. vitest covers it. |
| I-2 to I-6 (list sort cost; no `ALGORITHM=INSTANT`; performance fixture rows at 0; one flaky run of DEF-033; Purchasing's pin) | No change. Notes:<br>• I-3: the header explains why `ALGORITHM` is not stated.<br>• I-4: ties are now renumbered on the first move.<br>• I-6: Purchasing's owner must refresh its pin. |

## Verification after the fixes

The scratch MySQL had to be recreated. Its data directory was gone when this session resumed, so erp_t51 was migrated from empty.

- Server suite: 723 passed, 0 skipped. Client: 196 passed. Technical Playwright: 50 passed.
- UAT on the real backend: 20 passed, 5 skipped.
- eslint and the client build: exit 0.
- REV-118 survivors rerun, all red: S03b (non-locking next order), S05, S06, S07, S08 (neighbour version bumped), S09 (no renumber on ties), S10. Files were restored and checked with `cmp`.
