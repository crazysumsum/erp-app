# TASK-026 — Active sales order read API

Status: implemented; independent R2 approved; final Phase checks and current CI remain pending.

Fresh Sales view authorization precedes bounded parameterized Active filtering. Exact number/external key matching, binary external-ID equality and channel isolation remain explicit; Archive is not silently searched. One transaction counts, pages IDs, then reads only the named safe header projection in page order. Detail returns frozen snapshots, bounded line/history collections with truncation notice, separate safe current master references and server-owned P1 allowedActions. Financial quantities and amounts remain strings.

Independent R1 correctly identified that direct wide-header pagination deviated from Design7.9 despite green tests. The correction restores count -> bounded IDs -> safe projection. R2 actual unit5/lint/native4 PASS, zero skip, plus a native forged-hash binary exactness probe PASS. Scoped6-file digest6bea73f4b9d924f47f09542fcd66eab7a41a311ad3fb5c2f5f13400000f40ffe held unchanged during review; global reviewed sourcedf6e4e4f50a79e42adc2f876ea89d77b3f8d94187be23f55c5ff3d40711fea30. R1/R2 provenance and logs retained. Later TC019/TC018 title prefixes only reconcile existing traceability, not acceptance scope.

Primary actual quotation/manual/expiry/read native30 PASS, zero failure/skip. Strict HTTP schema, invalid/withdrawn authorization, snapshot/current-master separation, history truncation, wildcard escaping, key equality and pagination all execute against owned MySQL26.7.0. No Task/Phase merge or formal acceptance is claimed here.
