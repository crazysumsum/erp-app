# P2 Shipment UI and original-event polling increment

Status: bounded UI/polling developer increment saved locally; overall P2 implementation remains in progress. No full TASK, P2, CI, UAT or NFR completion claim.

Authority remains the approved P2 plan and actual HD025–027 decisions. Actual proposal75 **B** admits the finite functional cases and browser wiring; it does not admit the three additional capacity scenarios. Current project policy defers all NFR execution until the related feature has completed UAT. The application transaction limit remains20,000ms.

## Reviewable behavior

- The existing PICKED Fulfillment detail embeds Shipment creation. A server-owned `createShipment` action requires operation permission, no pending root work and no active Shipment. No additional create-page route is introduced.
- Shipment list/detail use the planned `/shipments` and `/shipments/:id` routes. Filters survive in the URL; lines, Issue/history pagination, SO/Fulfillment links and server-owned actions are displayed.
- Address/Contact choices contain their saved source version. Refreshing choices cannot silently upgrade a stale selection. Weight remains an exact decimal string with KG/G and no rounding.
- Update, Cancel and Confirm share a parent-owned pending exclusion. Unknown results retain only the original three-field event reference and use GET to query it; no automatic command resubmission occurs. Confirm reserves its confirmation dialog before awaiting user input.
- Unsaved Draft fields disable Confirm. A successful own update aligns fields to the actual accepted server projection, including canonical exact weight; failed updates and external refreshes preserve input. Historical successful operation outcomes are compared with target identity/version, without requiring the current Shipment to remain in its former DRAFT state.
- Confirmation uses the existing validated complete Pick List projection for SKU/Bin/Lot/picked quantity display. It does not calculate inventory availability or change quantities in the browser.
- Same-event polling is bounded and stops on terminal results, identity changes and component disposal. The displayed last lookup time explicitly describes a local query attempt, not an invented backend attempt timestamp.
- Delivery Note and Packing List share `/shipments/:id/delivery-note/print`, with a fixed packing view selector. Escaped server snapshots, A4 styling and visible ineffective/historical warnings are retained. Print refreshes authorization/projection before `window.print()`.

## Exact component evidence and review boundaries

At the original local HEAD `e370f804ee2f4736d1c2fe980d8414639f547536`, the reviewed dirty source fingerprint was `3190e088c47170ffb6c0d56ab77674e7723f11f447e2a4a1cd02934df4d4919f`. That original execution identity is retained; it is not relabeled as a later commit or a CI result.

The final mechanical alignment places the byte-identical polling helper beside existing owned Fulfillment helpers at `client/src/components/fulfillment/useShipmentOperationPolling.js`. Only its one SFC import and the private pure probe's two module-path strings change; manifest, approved plan, APIs and behavior remain unchanged. Original helper/panel/probe copies are preserved privately. Final source fingerprint is `5f972e9d922036541a6e6c0ce9e8baa3d91a8fae6434173b6bf34b88d25f4d01`, saved as local source commits `d1a56d2a00266dcc11623342c9a33e031a428abb` (two polling files) and `1542e1e1c5e3b06c4f64df672fba343f02f84cb5` (eleven UI/action files).

Private evidence is under `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/`:

| Evidence | Actual scope |
| --- | --- |
| `client-polling-1299123a343c/result.json` | Original exact2 red results, retained under their original source identity. |
| `client-polling-e665c665418a/result.json` | Exact2 pure client cases passed. Service/poller bytes remain unchanged; this is component reuse, not a new whole-source run. |
| `independent-p2-task031-client-polling-exact2-actual-green-review.json` | Actual-result closure SHA `7a6f5ead9d8b674b66f6f1a1d9f6f586fbc55a042bf2a9e484cb31d04137b19a`. |
| `independent-p2-shipment-ui-static-source-review.json` | Original13-file static review SHA `00c42ec6a5c64d8483dbc9b8e1986b4dfa42ce044eb7ab6d016578d7164f97a9`; original fingerprint retained. |
| `independent-p2-shipment-ui-local-lookup-timestamp-delta-review.json` | Local-time presentation delta SHA `2ebed805167778395d04bc39431b8b6eec3c33720e12bd4f840ed784246d0bf9`. |
| `independent-p2-shipment-ui-saved-draft-dirty-guard-delta-review.json` | Exact two-file dirty/canonical-save closure SHA `637d2faa1e02e9ab9e1086a8c19dbd106746d5cd48839e022e28530a3c98602c`. |
| `independent-p2-shipment-browser-saved-draft-delta-admission-review.json` | Original75B exact2 execution binding SHA `291b5f0162424afeab02b3499d981c501409253beed103c6165601d18fe71082`; admission is not execution PASS. |
| `shipment-browser-48712d7e242d/result.json` | Actual exact2 native browser PASS, raw SHA `52139293ddbbde0e709387ee210c9cbe51b2cc779696a6d2789b1ff62ab4e284`; original HEAD e370/source3190 retained. |
| `independent-p2-shipment-browser-exact2-actual-component-closure-review.json` | Actual-result closure SHA `89a4fba9902337d6589d506506e510715cad9684bef37d1fd30ffa1045c4ff2d`; no unexpected console/network errors beyond explicit expected faults. |
| `independent-p2-shipment-ui-existing-artifacts-visual-closure-review.json` | Independent existing-artifact visual closure SHA `3c02d4f364cfadc4c00f35079b136cce867bb0949f6a86c153f3aabe9be84e65`. Four Draft viewport crops and two printed views only. |
| `client-polling-d2d9c2dfca5d/result.json` | Actual pure exact2 PASS after module-path alignment, source5f972/HEAD e370. No DB/browser/POST or new cases. |
| `independent-p2-polling-path-alignment-actual-resolution-and-evidence-reuse-closure-review.json` | Actual moved-module/byte-bridge closure SHA `adc94d11ddc898a8af197c74f109d6df58f94e7c90d6a07cfaffaef494a75843`; new pure resolution and build satisfy limited reuse of prior browser/visual evidence, without rerunning four native fixtures. |
| `independent-p2-1542-source-checkpoint-bytebridge-review.json` | Exact13-file committed source bridge SHA `2276ec8edcc29c9494db32083db1a8028efb8ace751863fff4e5d773886c69b1`; no raw execution is relabeled as a new1542 run. |

Current direct developer `npm run lint` and client build passed after the path alignment; `shipment-polling-path-alignment/direct-static-observation.json` records the actual tool provenance. The existing build chunk-size warning remains. Separate formal `run_check` lint/build attempts stopped in PREP before running commands, because DEF029/030, the Inventory contract pin and the then-stale checkpoint were still blocking. Direct static checks do not waive those gates. The checkpoint now records actual1542/source5f972 at revision366, with both defects OPEN.

## Browser execution preparation

The initial wrapper stopped before launching Playwright, Vite, API or fixture creation. Its strict idle guard counted the owned MySQL internal `event_scheduler` Daemon as a client. UUID, datadir, networking and base-only schema checks matched. Original runner and observed failure are retained in `shipment-browser-preflight-blocked-20261103/`; `result.json` SHA is `4728a9fd3443cd493bd4ed7ce69164ce5b23bda3f6d8e2fbdd77f95f1975e3e5`. There were0 UI cases and no product transaction/performance timeout.

Only the exact identifiable internal daemon is excluded from the external-client count. Actual other clients must still be0, and all identity/schema guards remain. The wrapper also records future PREP_BLOCKED attempts explicitly. The narrow wrapper correction received its own review before the actual browser batch.

The admitted and executed browser assertions remain limited to the approved two journeys: one two-line cancel/recreate/successful Confirm fixture with two document views and Draft-detail checks at four widths; three serial small recovery fixtures, each at most one initial Confirm plus original-event reads. The error-note assertion checks saved input visibility; it does not dynamically prove unsaved Draft-update409 retention. Four Draft-detail screenshots do not prove every dialog/error/print screen at all four widths.

The corrected daemon guard was independently reviewed in `independent-p2-browser-daemon-preflight-delta-admission-review.json` SHA `38c1f02ef69a4424e8ee595ffa82de271ce1b5deab77849c1d6eb666a14fcfac`. The first actual batch `shipment-browser-66beb899b97c/result.json` failed1 case and skipped1 after fail-fast; exit1, no runner timeout, post-execution guards empty. Cancel/recreate succeeded before the375px assertion; Confirm, documents and the Recovery case were not executed.

Its trace records resize start7400.272ms and the immediate width assertion7416.248ms, with the375px snapshot still containing desktop `padding-left:300px`. Existing QLayout uses a100ms ResizeObserver debounce; the eventual failure screenshot has already switched to mobile. This establishes an unawaited layout transition, without claiming persistent overflow has been excluded. The original probe, raw report, trace and screenshot remain unchanged; diagnostic `responsive-diagnostic.json` SHA `720bd0656022c3a5303c91b9f8cdb8e0ca0c5dc806567dc469b905cb32cea39d` identifies a one-expression correction: use the existing10s retryable Playwright assertion for exactly the same `scrollWidth<=innerWidth` condition. No product CSS, fixed sleep, width tolerance, data or business attempts are added. That correction was reviewed before the necessary revalidation recorded below; the initial failure remains a FAIL and is not an NFR timeout.

Independent correction review SHA `af6d0d86b2cba4d974b82c7ce4ec5634ce090ee05799aef4f5c526715f4caabd` preceded the necessary revalidation. Actual `shipment-browser-48712d7e242d` passed exactly2 cases,0 failed/skipped/not-run, exit0, no runner timeout and no post-execution guard errors. Happy/recovery raw durations are7.329s/17.966s; these whole-case durations include fixture/UI work and are not transaction or performance measurements. The original strict width predicate passes at all four planned Draft widths after real reflow. Native API, Vite, Chromium and synthetic DB data were used; expected stale409, revoked403 and deliberately lost202 response were retained, with only original-event lookup and one initial Confirm in each recovery fixture.

Root viewed the four existing viewport screenshots and rendered both existing PDFs with Poppler; independent visual review also viewed the existing images. Each PDF is one A4 page (594.96×841.92pt). Both show two Shipment lines, and Packing additionally two Bin rows; text wrapping is legible without visible overlap/clipping. No price/bank fields are rendered. This is limited SHIPPED sample evidence, not dynamic REVERSED, multipage, physical-printer or all-screen/all-width certification. Owned MySQL remains idle with only the base schema and0 external clients; it was not removed.

## Separate HD026 handoff

PM assigned the root agent as sole executor of Sam's explicitly approved one-time15-case local fake functional check. An isolated `codex/hd026-safety-20261103` worktree at immutable main `89c5a06757c1de18fd3ab5750f935be17f3f714a` contains only the independently pinned four-file candidate. Actual result `hd026-deadline15-once-e2ed1560fc0a/result.json` SHA `9ab78b23da2258c4d947978122a4ce30842a56efda5366059afc17d86873439f`:15 passed,0 failed/skipped/not-run, exit0, no runner timeout,0.98989479199372s, one worker and one invocation, no native DB/CI/push/merge/NFR. Original50ms fake transaction and400ms case deadline remain.

Independent actual-result closure SHA `5ded44e59383dae77c396f19369d83cb0e1b7604bf7766dd24d52095b86a7b4b` verifies all15 individual raw JUnit results and the exact four blobs. PM received the result and closure. This does not qualify the full P2 tree, shared-consumer coverage, CI or the separate Draft-membership compatibility issue. Original35 component results keep their original baseline; they were not rerun.

## Still required

Independent readiness reconciliation `independent-p2-functional-readiness-def029-def030-reconciliation-review.json` SHA `e0c796c05baae3b3c7e68072e2008f558d0ddf3dfe8501fb8e65348b3b62fe65` preserves both defects OPEN. That reconciliation was recorded before the subsequent bounded developer checks. The original75B owner refusals, remaining native rollback stages, fresh guards, intent races and zero-picked atomic variant have since passed with their exact limits in [implementation88](88_issue_owner_and_rollback_developer_checks.md); remaining terminal and delivery gates are stated there. Existing bounded Recovery proofs need no blanket rerun for UI-only changes. Inventory's whole-document pin drift requires an owner semantic-contract reconciliation; it is not blindly updated.

Remaining affected functional matrix, coverage, latest-main impact/integration, trusted test-blob admission and current-candidate mandatory CI must pass before a draft PR. No P2 push, PR or merge has occurred. All original failures, workload/quantity limits and safety checks remain; NFR evidence is deferred rather than marked passed.
