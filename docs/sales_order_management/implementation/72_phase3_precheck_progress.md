# P3 TASK-041 developer checkpoint

Status: IN_PROGRESS; IMPLEMENT mode only. TASK-038–040 remain DONE; TASK-042–049 remain pending. No P3 PR, CI, merge, Technical Acceptance or business UAT is claimed.

The owner-provider slice is committed at4afa5ec: Customer snapshots and Item SKU/UOM resolution use caller-owned transactions and bounded batches of at most100 distinct members. Missing/inactive members remain per-member results. Actual55 unit tests, one native MySQL case and lint passed; independent reviewer `/root/sales_p1_review` approved the exact five files. Private proof: `task041-provider-r1-reviewer-proof.json`.

The deployment-owned controlled channel catalogue is committed at ef4ee5a and bad2d1d. Default is empty; startup rejects duplicate/malformed/oversize codes and the lookup requires fresh view/import permissions. R1 found sparse arrays bypassing `.some`; an actual RED regression was added and the shared guard now checks a dense copy. Actual seven unit tests and lint passed; separate R2 approved the six exact files. R1/R2 proofs and sparse RED/GREEN XML remain under the owned private evidence directory.

Mechanical binding under the previously approved DEC-025/026 authority updates only the current Item source SHA and the two unchanged NFR-014/015 UAT_NA approval references. DESIGN20b065e88164b06e91c89116f211e2e44d143e2948d18c0578281e3338925a33; PLANc11e2acd3288a4b2a807e894cbf09edc9900daa34042b643d3994617e6a0605d. New `*-DEC026-SOURCE041` derived approval records disclose that these hashes were computed by Codex; original human approvals remain intact. No business/API/scope/test threshold changes or new human approval is inferred.

Classifier and lease-fenced worker remain in progress. Classifier R1 findings, fixes and actual partial checks are preserved privately; completion requires independent final review and registered worker recovery/abort/lease/native proofs. Raw runtime accounts, env, SQL details and evidence are not exported into the repository.

Next: complete TASK-041, then TASK-042–049 and the full33 developer suites, current-candidate five CI checks, separate phase review and fresh-main merge gates. Existing commit/PR/main merge and owned synthetic runtime authority persists. Formal verification, production use and real Channel transport remain separate.
