# REV-141: independent review of HD-158 and HD-159 (design review on 5003b391)

- **Reviewer:** `agent-skills:code-reviewer`, a separate agent. I did not write this change.
- **Baseline:** branch `claude/supplier-technical-acceptance-4` at `e39bde67`, reviewed as the Supplier diff `6d84ee45..HEAD` (main merged in at `376bc9a5`, other modules only).
- **Scope:** the formal run on the HD-157 baseline and its records (DEF-050 closed, DEF-051, HD-158), the HD-158 plan revision (TC-101 online general operations p95 < 5 s during a 10,000-row import), and the HD-159 refresh of the consumed Purchasing pin. This is also the design review on design `5003b391`.
- **Verdict:** **APPROVED**. open_critical 0, open_high 0; no Medium, 6 Low and 3 nits.

## What the reviewer confirmed

- **Code.**
  - `--general-limit-ms` defaults to 2,000 and is refused unless it is a safe integer ≥ 1.
  - Only the during-import load gets 5,000. The mixed and for-SKU loads keep 2,000 and 3,000.
  - TC-101's check requires the report's limit to be exactly 5,000. TC-128 still requires 2,000.
  - The unit test has 49 cases, and both the 2,000 and the 10,000 limits fail the check.
  - No code reads the old check id.
- **Specs.** 01 NFR-004, 06 §0 and IMP-016, the TC map row, the performance report and the code comments agree. Apart from L1 and L5, no current document still states 2 s during an import.
- **Evidence numbers.** The DEF-051 table matches all eight runs' `load-during-import.json` and `import.json`. So do the COUNT averages, the throughput and the statement slow-down range. "Cause: not proven" is stated honestly.
- **07 report.** The 16 `run.json` files match the table. All have code `309aa9eb`, `code_unchanged` and `spec_unchanged` true, and plan `8b31fcdd`.
- **Ledger.**
  - HD-158 and HD-159 quote the Product Owner verbatim. HD-158 says the consequences were set out after the answer, and it corrects the import-time range.
  - DEF-050 is CLOSED with matching evidence, and DEF-051 is OPEN.
  - The mode changes follow the precedent.
  - The 14 `-HD158` approvals equal the observed baselines, and no older approval changed.
  - The developer-check observation matches the raw outputs, and the mutation backup is byte-identical to the restored file.
- **The 03 choice (L1)** is accepted: §11.5 has no number of its own, 01 is the authority, and keeping 03 keeps Purchasing's pin `e49ac37d` valid.

## Disposition

| Finding | Disposition |
| --- | --- |
| **L1.** 03 §11.5 "並保持線上query p95", read with the 2 s bullet before it, implies 2 s during an import | Fixed as recommended: 03 stays unchanged, and the follow-up is recorded in DEF-051 (`testing/04_defect_register.md`) and in HD-158's implementation note. §11.5 is reworded with the next change that has to touch 03 anyway, so Purchasing re-pins once. |
| **L2.** `next_safe_action` still listed 03 §11.5 | Fixed: rewritten, with 03 left unchanged. |
| **L3.** `performance_report.md` said `update` had run close to 2 s | Fixed: `list.missingFilter` at 1.4–2.0 s, `update` at about 0.8 s, both over 2 s once. |
| **L4.** The 07 report misquoted the earlier load averages | Fixed: the six earlier end values 8.4–11.9 are listed, and 13.9 is noted as the highest of the eight. |
| **L5.** UAT-044 said nothing about the 5 s during-import limit | Fixed: UAT-044's expected result adds 匯入期間一般操作p95<5秒（HD-158）, and the 07 §0 修訂 row records it. This moves the plan baseline, so the 11 approvals bound to the plan are re-recorded (`-HD158-R1`). The 3 DESIGN approvals stay valid, because the design baseline does not move. |
| **L6.** With `--base 6d84ee45` the boundary check reports the merged main content | Fixed: the PR's boundary check is run against the main parent of the latest merge, and that base is recorded. |
| **N1.** 821 vs 820 ms for `update` at TECHNICAL | Fixed: 820 everywhere, the same rounding as 1,443 (1,443.5). |
| **N2.** The 06 §0 row cited LIST-001 for NFR-001's 2 s | Fixed: OPS-001 only. |
| **N3.** DEF-051 `source_ids` listed NFR-001 | Fixed: removed. The governing requirement is NFR-004. |

Main moved again during the review (PR #307, Purchasing harness state, a report and a test). It was merged in at `02dffa59`, with no Supplier file changed and no Purchasing 03 change.

## Follow-up verdict (REV-142, at `f24bec92`)

The same reviewer re-checked `git diff e39bde67..HEAD -- docs/supplier_management`: **APPROVED**, open_critical 0, open_high 0, nothing new.

- All six Lows and three nits are fixed correctly and completely.
- The 11 `-HD158-R1` approvals equal the observed plan `cfb4af71`. The three DESIGN `-HD158` approvals still equal the design `5003b391`. Nothing older changed.
- `validate_traceability` STRUCTURE_PASS; `verify_gate PLAN_READY` LOCAL_CHECKS_PASS. The boundary check against `68a8d00b` gives only the two covered `server/scripts` files.
- Main `68a8d00b` is an ancestor of HEAD. Its merge changed no Supplier file, and Purchasing's 03 still hashes to the pinned `366abb1f`.
- Noted, no action: 820 for 820.5 (and 1,443 for 1,443.5) is rounding half down, while other values are rounded normally. No conclusion depends on it.
