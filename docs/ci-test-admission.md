# Test admission before CI

The approved baseline is the verified installation commit
`942db2650a6c139ed38d33cc3228750a9d2b93a1`. It includes the trusted workflow
and the same application cases as the audited main at PR #313. Its history
must remain reachable from main; the installation PR uses a merge commit. The gate compares the actual candidate Git tree with this fixed tree
for every event, including main, manual and scheduled runs. An unrelated push
cannot turn a rejected change into an accepted baseline. Old reviewed files
need no receipt. No database, package installation or test discovery runs in
the static gate.

## Propose a workload

1. List new cases or parameterized families, the business risk and existing
   coverage gap, data/fixture sizes, concurrency, repetitions, thresholds,
   trigger, time/cost estimate and alternatives. Identify the exact helper,
   config, runner and case changes. Obtain Sam's explicit decision for this
   scope. An existing decision for the same content and scale is reusable.
2. Place one JSON receipt per independent workload under
   `.github/test-admissions/<decision>.json`. Each file binds the Git mode and
   Git blob from the candidate index (`git ls-files -s -- <file>`). Use null
   for both fields on a reviewed deletion. Include unchanged helper/fixture
   inputs that determine a workload as pins. Keep related data and concurrency
   in the same receipt. For governance-only changes a support receipt can bind
   independently reviewed files. The following illustrates the format.

   ```json
   {
     "version": 1,
     "decision": "Sam's verifiable decision reference",
     "purpose": "Check a duplicate receipt rolls back the second write",
     "data": "2 receipt lines; fixture has 1 warehouse",
     "concurrency": "1 transaction",
     "repetitions": "1",
     "thresholds": "No duplicate movement or audit row",
     "trigger": "Routine correctness regression",
     "cost": "Estimated under one second; no new job",
     "files": [
       {"path": "server/test/receipt.test.js", "mode": "100644",
        "blob": "<40-character Git blob>", "kind": "functional",
        "cases": ["duplicate receipt is rejected"]}
     ]
   }
   ```

3. The trusted approval administrator verifies the decision against the diff
   and the scale, computes `sha256sum .github/test-admissions/<decision>.json`
   and adds that digest to the repository Actions variable
   `CI_TEST_ADMISSION_DIGESTS` (whitespace-separated). Preserve other active
   grants. The PR author supplies the proposal. A decision reference, checkbox,
   label or change to the JSON cannot grant admission. The Actions token used
   for checking has no variables-management permission. Reserve that
   administrative credential for the approver or their authorized coordinator.
4. Classify the entire reviewed contents of a file as `functional`, `capacity`,
   `mixed`, `manual` or `support`. List affected exact names/families in
   `cases`, including newly added literal registrations. Dynamic registrations,
   loops and factories are admitted as **whole reviewed blobs**, not by executing
   a file to discover what it does. A protected test file cannot use a support
   declaration. Catalogued cases require their exact names and `capacityIds`.
   New CI capacity belongs in `server/test-capacity` or `client/test-capacity`,
   outside routine discovery. Use `*.capacity.js` in the client capacity lane.
   Manual workloads stay outside normal discovery and are not catalogued.
5. Ordinary test code, fixture and setup edits invalidate old blob approvals,
   including indirect increases in row/worker counts. Admission deliberately
   asks for review when it cannot infer a safe change. Keep fixture generators
   and workload controls in test/support/config paths, and explicitly pin
   externally located inputs. Changes to applications outside those paths are
   checked for test imports/registrations. Referenced document data such as the
   Supplier manifest is also included. This checks tracked inputs; reviewers
   must identify computed external inputs rather than treating numeric heuristics
   as proof of workload size.

## Execution and trust

For PRs into main, the controller runs the **base** version of the static policy
on the merge commit's Git objects. Its privileged job never checks out or runs
candidate code. On success it dispatches the CI workflow on a temporary tag at
that exact merge SHA. The CI job verifies the policy's SHA-256 against the
out-of-band `CI_TEST_ADMISSION_POLICIES` variable (one allowed hash per line),
checks receipts and catalog routing, and only then starts the test jobs. The
approved CI reports its required aggregate Test result directly on the PR head
as `Admitted PR CI` using an isolated job with no checkout or candidate code
execution. The tag is retained for authorized retries until the PR closes. The close handler removes the tags. Make this status required on main.
A rejected candidate needs a new push or a deliberate reopen after approval.

For dispatched PRs the capacity selector uses the actual two parents of the
admitted merge commit. Ordinary main pushes, scheduled and manual checks keep
their existing related-file rules. A manual request without a related baseline
selects no capacity. A shared capacity runner or CI runtime change can select
the existing full catalog. A receipt alone never triggers a capacity sweep.

Policy/workflow changes require the same external receipt; changes to the
verifier additionally require a verified policy hash in the repository
variable before activation. During a policy migration retain the approved old
and new hashes until active candidates finish. Ordinary agents must not hold
workflow/variable administration privileges to establish a security boundary
against independently creating workflows or changing GitHub settings.

The result job validates the tag, run attempt, two-parent merge, and current open
PR head and merge SHA before posting. A failed, skipped or cancelled aggregate
cannot publish success. If GitHub interrupts the callback, rerun only the base
admission controller for that event; it looks up and reuses the completed run
on the same immutable SHA, without dispatching a duplicate test batch.
