# TASK-042 Import read API developer checkpoint

TASK-042 DONE; TASK-043 IN_PROGRESS. IMPLEMENT only; P3 remains incomplete, with no CI/PR/merge or formal acceptance claimed.

Product0986c5d and native proof f49af1a add bounded fresh-view Job summaries, filters, Intake pagination and exact parent-owned safe errors. Empty-path pre-admission stages are hidden; retained purged summaries remain readable. Payload, private paths/hashes/leases, processing events and raw input summaries are excluded. Global authorized business reads follow the approved API, while child errors always bind to their requested Job. Allowed actions use fresh import permission and the explicit READY/QUEUED state diagram.

Actual Sales regression161 and owner/registry57 unit cases passed, zero failure/skip; one native real HTTP case covers authenticated filtering/detail/errors, foreign-parent and absent uniform404, hostile sorts/offset/date400, noJWT401, pre-admission hiding, purge retention and fresh permission revocation403. Full lint passed. Separate reviewer /root/sales_p1_review independently ran4unit/lint/SQLUnicode probes and observed actual author-native XML; final APPROVE exact6file hashes in private task042-r1-reviewer-proof.json. Source55081ca86002c5da4fd1a0d71d953979dab9a6de1edf7aa9e4af494a0290ee37; DESIGN20b065e88164b06e91c89116f211e2e44d143e2948d18c0578281e3338925a33; PLANc11e2acd3288a4b2a807e894cbf09edc9900daa34042b643d3994617e6a0605d.

Next implement authorized TASK-043–049 then full33 developer suites, current candidate five CI, separate final phase review and fresh-main authorized PR/merge. No production, real Channel transport, formal Technical Acceptance or business UAT authority is inferred.
