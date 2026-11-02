# TASK064 native upgrade checkpoint

Completed TASK064 after commit40b8ed4fc10e9c8c1b09a7b9fc9a2104218e3f1b and actual separate review e75913a2. The unchanged original export body SHA8923fbd0 now has identity0090; old0087 name/applied_at, Export rows and SHOW CREATE remain byte-equivalent through the real migration runner. Incompatible legacy columns are rejected without a0090 ledger entry. Native regression10PASS,0FAIL,0SKIP; scoped lint PASS. Current R4 PLAN_READY/boundary previously passed without modification.

TASK065 remains in progress. The separately reviewed18-case owner hash component is only partial implementation; native owner tables/mirrors, invariants, OpenMatter, participant and joint Sales coordinator remain pending. No Phase completion, current CI, formal acceptance or merge readiness is claimed.

Fresh origin/main35af2ab7 adds Customer readonly catalog validation and native regressions after64bee. Its BusinessMaster/Customer provider changes can affect Sales validation; integrate before final qualification and rerun affected original suites. No new migration numbers were added. Existing historical evidence and failures remain retained.
