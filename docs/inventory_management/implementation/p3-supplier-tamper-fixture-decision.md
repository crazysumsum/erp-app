# HD139 — Supplier tamper-fixture scope decision

Status: PROPOSED_NOT_APPLIED. Inventory P3 is blocked at its mandatory developer gate, not resumed into P4.

The latest generic root report has 2,236 passed / 1 failed / 0 skipped. The single failure is the unchanged Supplier fixture which calls `.fill(0, 0, 1)` on a random authentication tag. If its first byte is already zero, no byte changes; the production crypto correctly decrypts the unchanged authentic row. A read-only minimal reproduction found this condition after 1,000 encryptions and verified that an actual single-bit alteration is rejected. This is a test-data bug, not evidence that the production crypto accepts a modified tag.

## Exact recommended option A

Approve the linked exact two-file patch: Supplier test fixture copies the tag, XORs its first byte with one, and adds an assertion that tampering changed it; Inventory manifest adds only that test to its approval-required paths. Keep all original assertions, random real crypto, test counts, zero-skip and coverage floors. The manifest scope change necessarily updates Harness DESIGN and PLAN hashes; the product design document and runtime crypto do not change.

Rebind the existing approved shared-source exceptions without further edits. Integrate the observed latest main `0feb9d712072048adb20afc470eb87abc8911475`, whose new changes are Item documentation handoff only; `ItemLookupService` remains byte-identical. This does not implement Item TASK-043 or claim its consumer/reference-guard acceptance. Then execute the complete current-baseline native DB, Sales compatibility, full-scale capacity, real Playwright and registered developer verification with the original gates.

## Option B

Keep P3 blocked and do not publish until the Supplier owner repairs the existing fixture on main. Do not select an older green result or retry random data until green as a waiver.

All 396 original report references and failed attempts remain unchanged. The full native command previously had 2,930 passed / 1 failed / 132 guarded skips because the coordinator omitted the existing isolated admin GRANT OPTION; its redacted failure is retained. The subsequent focused XML was misplaced by the temporary controller and preserved as an incomplete observation, not credited as PASS. The controller destination handling now asserts that placeholders are expanded. All three owned runtimes were precisely cleaned; no shared or production data was touched.

No push, P3 PR, candidate CI, final-head approval, formal Technical/UAT or deployment has occurred. Existing conditional publication authority and final exact-head Sam review/five CI/MERGE_READY/fresh-main requirements remain separate.

Patch SHA256: `800a6102648b628a9acceb839d833302e0a526e962096611d3d31cdbb2063459`

Proposed DESIGN: `b4720b69f67be272b7f605fa8bd83401792629ebd7ae16d1014aac2efcbf58ee`

Proposed PLAN: `151cf5757a465b4df8a64f34e1f876ca6759a3bcc438ec721fb22bf7ab965a44`

[Exact patch](p3-supplier-tamper-fixture-proposal.patch) · [File pins and baseline metadata](p3-supplier-tamper-fixture-proposal.json)
