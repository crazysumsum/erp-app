> Superseded in part by DEC-040: Sam excluded this round’s disaster-recovery tests. The DR-inclusive4.03–6.35TiB estimates and6.5TiB resource recommendation below are historical, not the current capacity-only requirement. See155_capacity_only_no_dr_decision.md; no new disk/provisioning authorization implied.

# DEC-039 — P4 capacity storage admission / resource decision

Mode IMPLEMENT. Proposed resource decision only; no change to design/plan/acceptance gates, source/load/thresholds or permission to merge before all Gates. Current candidate3ef50098c5285cb7b4b4bfae2f49176cf54e47d0, sourcec2fc4515d7064c9c601a4105f2100d3080869aef3a327ef1f4e19f73fd300af0.

## Observed bounded pilot

The reviewed dedicated socket-only MySQL runtime used nice10, InnoDBconcurrency2 and actual1.125GiB bufferpool (engine rounded requested1GiB). The real-writer pilot passed1case/0FAIL/0SKIP in242.38seconds, with1000newActive headers/5000lines (245×1,695×5,59×20,1×100),3425SUCCEEDED unique External Keys,2625Archive external targets and all3625neworders readonlyreconciled. Source mix500CSV/300Channel/150Manual/50Quotation. All source/input/output files and normal durable binlogs were retained privately.

Archive partition construction used the explicitly reviewed controlled pending cutoff at current SQL time only to measure physical allocation; this is not a retention/monthlyTC054/real-calendar claim. Actual private worker guards/lease/500cap/real600s deadline stayed enabled.41Manual monthly reference orders used an owned injected2023 business clock for realcreate/cancel; normal mode used liveDate.now. No DB/global clock, guard/FK/CHECK or binlog disabled.

Actual tablespace allocated bytes were26689536baseline,206389248afterhistorical,214908928afterActive. Corresponding actual binlog bytes1174169,117001970,151169108. This is a small pilot, not the fullvolume/backup/restore measurement.

## Storage estimates and uncertainty

Full dataset remains7300000Active headers/36500000lines/25000000External Keys/300000monthly candidates,50clients, with original RTO/RPO/performance limits. At the pilot source mix,5840000keys targetActive and19160000targetArchive; unique key→uniqueOrder routing is preserved, not orphan/PROCESSING filler.

Two calculations use the same successful pilot without SQL reruns:

- Whole allocated-tablespace extent extrapolation, including source, independent restored copy, conservative1.25×uncompressed-backup budget, three file copies, source seed binlogs, restore-generated binlog budget,10GiB extra runtime/redo/temp and workload/recovery binlog margin:6.347TiB.
- Sensitivity comparison using ANALYZE-derived used data/index pages to reduce small-table extent/free-page overestimation:raw projectedsource0.430TiB; sourcebudget0.537TiB with explicit25%growth margin; source+backup+restore+files1.781TiB; current normal-binlog/runtime/recovery-inclusive budget4.031TiB.

These are planning estimates, not an observed minimum requirement. The extent method materially overestimates retained empty Active extents; page statistics and growth/backup multipliers are also estimates. Neither method is used to lower data, acceptance or merge gates. A concrete new runtime/backup/restore recipe must revalidate its actual budget before full writes.

Observed free disk was514157088768bytes (~478.85GiB); preserving100GiB leaves406782906368bytes (~378.85GiB). Both methods fail admission, even before source/restore binlogs in the page-based snapshot budget. /Volumes inventory showed only system/Recovery volumes sharing this APFS capacity; no independent test volume was discovered. Existing authoritative evidence is not deleted to create space. No fullvolume seed has started.

## Decision Required

Recommendation/default: provide an owned isolated test disk/host with at least6.5TiB free if retaining the current conservative normal-binlog plan, and identify its path/host plus access method. It preserves original data/load/gates and gives room for the conservative estimate plus100GiB reserve; actual admission still runs before mass writes. Do not purchase/provision resources automatically.

Alternative: keep current local resources and pause only the fullcapacity/restore path, while continuing applicable non-capacity work. FullP4 remains unmergeable. A future reviewed storage/backup/logging optimization may narrow resource estimates, but no blanket log disablement or smaller dataset is proposed/authorized here, and even the page-based snapshot budget exceeds current local space.

This asks for a material test-resource/cost/location decision under software-engineering-harness/SKILL.md: “Major impact means ask a human before choosing.” It does not repeat existing implementation/commit/PR/main-merge authorization. No host/disk provisioning, original evidence deletion, acceptance waiver, or new production access is implied.

## Evidence

Private actual receipt p4-capacity-writer-pilot-native-r1/receipt.json SHA b223d6b48b048298d81a9170a7525d28ad561f5669264b5a791a3f47bc689569; raw log SHA b9e3ddf32bd754467c0b6245aa7ba8494b0ccc5fb4485fd198a83da3b3012bac. Full checkpoints/summary under capacity-writer-pilot-r1; estimates capacity-storage-estimate-r1.json and capacity-storage-page-comparison-r1.json. Independent preexecution proofs and final result/resource review retained separately; no formalTechnicalAcceptance/UAT/release signoff.
