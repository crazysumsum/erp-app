# TASK-038 — Intake persistence developer checkpoint

IMPLEMENT / PHASE-004. DEC-025 remains the authority: DESIGN `e9995444bf53fe06b2a9fd106631343ac95bfb4d81ed5c8e448f1bb3349ab629`, PLAN `0a77edbc9764415f4bd8d96046e47d3f24832700eff0e9dc62a06caba8cc53fe`. Integrated entry HEAD `b0b0bce431505779857c5fc2342a05ce34ca41af`; current main incorporated at `2afef5cdb271dbfa3ccefd913f7042c52c7be92b`.

Four forward migrations add Import Jobs, Intake Orders, bounded owner-linked errors, and the existing nullable SO Intake source UNIQUE/FK plus exact Intake reservation command pair. Existing External Key persistence is reused. Applied historical migrations remain immutable; manual/backorder pairs, ownership, quantity, Inventory truth and update identity guards remain enforced. Existing duplicates/orphans/schema drift stop migration without rewriting facts.

Independent review found and actual native RED reproduced the stale-snapshot error cap, mutable error owner, relocated Intake OR, and lease/source CHECK grouping drift. Corrections use parent locking/current count, immutable error owner, exact adjacent pair insertion and canonical parenthesis-preserving inspection for all new Job/Intake CHECKs. Reviewer-proposed count/payload bypasses were investigated: MySQL rejected the count expression, and the original inspector already rejected the payload expression. These are not claimed as observed defects; failure history and the reviewer correction are retained.

Developer checks (not formal Technical Acceptance):

- Current native suite: **16 PASS, 0 FAIL, 0 SKIP**, including two-connection Intake/External Key unique races, FK/limits, old snapshot error201, owner update, all three valid command pairs, mixed pairs, projection drift, interrupted DDL retry, incompatible index/trigger and grouped CHECK drift. `TC-037` covers the task; `TC-035` supplies related bounded error/limit checks. Existing task-to-case registry remains intact.
- Affected migration/native regression: **20 PASS, 0 FAIL, 0 SKIP**. Affected Sales behavior regression: **119 PASS, 0 FAIL, 0 SKIP**. Repository lint PASS; module boundary LOCAL_CHECKS_PASS.
- A fresh owned synthetic schema ran the entire repository migration chain through0083 successfully. Direct rerun of all four current migrations and strict existing External Key inspection PASS. Earlier failed/partial attempts and the original owned schema are retained rather than reset.

Actual separate review: `/root/sales_p1_review` tables R4 APPROVE and `/root/sales_readiness_review` forward R2 APPROVE, with scoped file hashes/provenance retained privately. R1/R3 changes requested and R1 capture-timing correction remain historical facts. Tables R4 explicitly corrects the unobserved extra bypass claims. Their combined scope covers these five product/test files, not the remaining Phase implementation or merge gate.

Raw logs/XML/reviewer proofs remain in private `/private/tmp/sales-p3-private` and are excluded from Git. Owned MySQL26.7 uses separate migration/fixture accounts; the application remains DML-only/SUPER=N. Trigger DDL runs without application writers. No shared/production schema, formal test, business acceptance or release is involved.

Next: TASK-039 CSV V1 streaming parser/grouping/template. P3 still requires its full33developer suites, current-candidate CI, final independent review and fresh-main merge gate.
