# TASK-039 — CSV V1 and template developer checkpoint

DEC-025 approved DESIGN `e9995444bf53fe06b2a9fd106631343ac95bfb4d81ed5c8e448f1bb3349ab629`, PLAN `0a77edbc9764415f4bd8d96046e47d3f24832700eff0e9dc62a06caba8cc53fe` remain unchanged.

The existing CSV libraries, exact decimal helpers and formula sanitizer implement strict UTF-8/RFC4180 V1 parsing, bounded private disk grouping for non-contiguous orders, normalized 128 KiB payload and 100-line limits, bounded safe errors and live cancellation. Whole-file structural validation completes before order callbacks. No Sales Order, reservation or External Key is written. The versioned template endpoint freshly requires view plus import, uses synthetic sample data and exposes field descriptions for the later import guide.

Developer checks: **21 PASS, zero failure/skip**; affected existing Sales/handler/import regression **136 PASS, zero failure/skip**; lint PASS and module boundary LOCAL_CHECKS_PASS. Actual limit cases include 100001 rows, 10001 distinct orders and 50 MiB+1 input, with no order callback and owned spool cleanup.

Actual independent `/root/sales_p1_review` R1 found four issues. All four were reproduced RED, corrected and independently rechecked R2 APPROVE: final formula-neutralized text length, measuring normalized safe payload rather than spool bookkeeping, error-overflow summary and prompt abort of stalled input. Original-note conflicts remain detectable after formula neutralization. The final independent run also reports 21 PASS and lint PASS. Scoped four-file SHA/provenance and failure history remain private in `task039-r1-reviewer-proof.json` and `task039-r2-reviewer-proof.json`.

Raw logs/XML remain in the private runtime directory and are excluded from Git. These are developer checks for TC-034, not whole-P3 CI, browser, formal acceptance, business UAT or release evidence. Next: TASK-040 managed disk upload and recoverable Import Job admission.
