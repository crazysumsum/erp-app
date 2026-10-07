# TASK-030 confirmation primitives — developer verification

Adopted DEC-021 remains unchanged. Original-user recovery reads the active user and current directory roles/permissions without constructing token claims; both sales.view and sales.mgmt are mandatory. Confirmation success/failure audit uses existing fixed transition projection. Inventory contract mismatch has stable 503.

Actual separate reviewer /root/sales_p1_review, TASK030-primitives-R1-20261007 APPROVE on HEAD81f043b and four-file digest b60d31513b7cc299eb432f929a0a64ee907e750f5477197607b33c84ab725059. Independent 54 unit PASS, zero skips; focused lint PASS. Parent focused five tests PASS. First missing-export failure and audit assertion correction were observed before passing. Reviewer proof is retained privately at /private/tmp/sales-p2-private/task030-primitives-reviewer-source.json.

This slice does not complete TASK-030, native Phase B, recovery jobs, formal acceptance or the whole Phase merge gate. Next: actual atomic confirmation implementation and owned MySQL validation.
