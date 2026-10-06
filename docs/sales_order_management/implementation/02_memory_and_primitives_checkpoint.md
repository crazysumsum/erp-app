# TASK-005..008 scoped developer checkpoint

Mode: IMPLEMENT. This checkpoint is partial implementation, not Phase completion or formal test acceptance. Design/plan hashes are unchanged.

## TASK-005 measurement

`server/test/fileTransfer.test.js` starts an actual application server with fake DB in a separate Node process, warms a 1 MiB upload, then sends 5 MiB and 50 MiB multipart files from a separate streaming client in 64 KiB chunks. Server baseline/post-cleanup GC and 1 ms samples record heapUsed/external/arrayBuffers/RSS. Complete size/SHA-256 and bounded prefix/no-full-buffer metadata are asserted; request temp storage is empty afterward. The test currently records measurements, not an approved numeric memory gate.

Two developer runs on Node 26.6.0 yielded these sampled increases:

| Upload | Heap | External | RSS |
| --- | --- | --- | --- |
| 5 MiB | about 4.9 MiB | about 5.0 MiB | 2.7–3.3 MiB |
| 50 MiB | 7.8–8.1 MiB | about 20.9 MiB | 17.2–19.3 MiB |

After cleanup/GC, 50 MiB heap returned within about 0.2 MiB of baseline. Sampling does not prove every instantaneous peak or production capacity. Logs: `/private/tmp/sales-task005-memory.log`, `/private/tmp/sales-task005-memory-repeat.log`.

Sam's numeric developer threshold decision remains OPEN: proposed per-request increases heap <=16 MiB, external <=32 MiB, RSS <=64 MiB. Concurrency and full Phase checks remain separate. No formal TC-004 PASS is recorded.

## TASK-006..008 sources

Fresh actor checks reuse `assertActorFresh`, reject absent/inactive actors even with empty claims, and require exactly the current Sales permission. The constants/error catalogue and deployment normalizer are implemented without a public handler, UI or job. Deployment settings cannot override domain constants or reduce the approved file-retention floors.

BigInt scaled arithmetic fixes DECIMAL(19,4)/DECIMAL(20,6), positive exact integer base conversion and safe integer bounds. Duplicate SKU/UOM lines merge exact quantities only when normalized prices and notes match. Pure validation rejects server-controlled/unknown fields, invalid dates, excessive lengths and invalid merged line counts, and emits zero-price warnings.

Order/quotation/import/intake state primitives implement the approved transitions, including repeated partial fulfillment and shipment reversal restrictions. Reasons require 5–500 characters after trim. Quotation expiry uses an inclusive valid-until date. Canonical hashing sorts object keys, preserves decimal strings, array order and exact Unicode, and rejects unsupported/cyclic values. Callers must select the validated business payload; transport metadata is not implicitly filtered by key name.

Permission catalogue and migration remain held for migration owner allocation DEC-007. Application startup wiring is also withheld: the exact shared-path approval does not include `server/src/framework/configuration/applicationConfiguration.js`. The standalone normalizer is tested, but is not falsely represented as active application startup validation.

## Review and developer checks

Reviewer: Codex `/root/sales_readiness_review`, SEPARATE_AGENT, read-only; candidate: uncommitted TASK-005..008 sources after `ac9aeac0fcc7a08779e22f8460e74b856b44c855`, before these checkpoint commits.

Final disposition: APPROVE scoped implementation checkpoint, no remaining blocking code findings. Reviewer independently reran 17 primitive/directory tests, all passed, zero skipped, and checked whitespace. Reported author tests also pass: 17 primitive/directory tests; two isolated memory-measurement runs; lint. Tests use canonical TC-007 for primitive coverage and TC-008 for fresh actor coverage; labels are developer trace references, not formal PASS evidence.

Retain unfinished Tasks IN_PROGRESS until their complete DoD is established. Startup integration, migration/catalogue, approved memory gate, isolated full MySQL/workspace checks and TASK-009..011 are not complete. No partial Phase merge is authorized.
