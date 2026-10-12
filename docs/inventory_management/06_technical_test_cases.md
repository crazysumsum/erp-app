# Inventory Management Technical Test Specification

## Status and execution boundary

All cases are specification-only and `NOT_RUN`. The 0.4 design/plan is approved, but no test execution, Technical Acceptance or UAT sign-off has occurred. Database integration cases must run against a server that reports exactly MySQL Server 26.7.0; version mismatch or inability to prove the version blocks the suite.

## TC-001 — Authentication, authorization and boundary validation

### Preconditions and data
Authenticated role/device fixtures, stale-role cases and malicious boundary inputs in an isolated environment.

### Steps
Exercise 401/403, ID substitution, stale authorization, strict schemas, injection/XSS/CSV payloads and sensitive-data redaction.

### Expected result
Every unauthorized or invalid path fails closed with stable safe errors, no state change and sufficient non-sensitive audit evidence.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-002 — Warehouse and Bin master integrity

### Preconditions and data
Fresh and referenced Warehouse/Bin fixtures with concurrent writers.

### Steps
Test CRUD, uniqueness, ownership, versions, deactivate/reference guards and deactivate-versus-posting races through API and database assertions.

### Expected result
Master state and ownership remain consistent; exactly one valid concurrent transition wins and no inactive location receives new stock.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-003 — Stock, Lot, expiry and quantity invariants

### Preconditions and data
SKUs for none, batch, batch-expiry and serial policies; expiry boundaries and mixed Stock Status buckets.

### Steps
Verify schema constraints, Lot identity, Base-UOM integers, expiry/minimum-life rules, Serial SKU posting rejection, the Active-Serial Go-Live guard, immutable movements and reconciliation invariants.

### Expected result
All bucket and Lot invariants hold; every Serial SKU posting fails closed, any Active inventory-tracked Serial SKU blocks Go-Live, and unsupported or inconsistent tracking input creates no partial persistence.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-004 — Atomic posting, idempotency and immutable audit

### Preconditions and data
Receipt/Issue operations with stable source events, low-life and Expired Lots, Receiving actors with and without `receiving.expiry.override`, fault injection and two database connections.

### Steps
Execute success, replay, conflicting payload, timeout/unknown result, duplicate race, incomplete low-life evidence, Expired override attempts and failure at state/movement/audit/commit boundaries.

### Expected result
One source event creates at most one complete effect; only authorized non-Expired low-life input with complete per-detail evidence succeeds; Expired override and all injected failures reconcile to zero partial effect.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-005 — Reservation, allocation, ATP and FEFO concurrency

### Preconditions and data
Competing reservation/allocation actors across eligible/ineligible Lots and Bins.

### Steps
Test ATP boundaries, duplicate requests, 20–100-way concurrency, FEFO/FIFO ordering, override authorization, release/reallocate and Issue consumption.

### Expected result
Reserved/allocated quantities never exceed eligible stock; ordering is deterministic and only authorized eligible overrides succeed.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-006 — Bin movement and cross-Warehouse transfer

### Preconditions and data
Multi-line same-Warehouse moves and cross-Warehouse Draft/In-Transit/Receive fixtures.

### Steps
Test whole-document transitions, reserved-stock protection, lock conflicts, duplicate dispatch/receive, invalid destinations and rollback of one invalid line.

### Expected result
Paired movements and In-Transit totals reconcile; partial dispatch/receive never occurs and retries do not duplicate effects.

#### TASK-030 Bin Move subcases（§5.4.1；developer及後續正式驗證）

Trace: FR-063～069 → DES-005 → PHASE-004 → TASK-030 → TC-006；共同auth風險沿用SEC-001／TC-001。下列是scenario labels，不新增formal IDs／typed mappings；全部初始NOT_RUN。Unit／故障注入不能冒充真MySQL／HTTP／P4 Stocktake工作流證據。

| Scenario／priority | Preconditions／synthetic data | Steps／input | Expected result | Required evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Move-document P0 | Active W-A的A1/A2/A3；none／batch／batch_expiry及三種Status；source10／allocated2／Reserved8；部分目的不存在 | 兩行以上Base UOM Move；再查Balance／group／Audit／Operation及source replay | 全部paired BIN_MOVE legs同Operation/group；每維度總量守恆；來源合法free減量、目的等量增加；Reserved／Allocation不變，200 whitelist／FIFO anchors正確；目的可原子建立 | Service/handler assertions、real MySQL before/after ledger及real HTTP response | NOT_RUN |
| Move-input P1 | 合法source tuple及Bucket fixture；strict Bin Move及另一未選用route；已成功HTTP key cache | 0／101行、unknown fields、missing/null source version、omitted destination version、null/positive destination mismatch、ID／quantity／versions的numeric strings／booleans、非法IDs／quantity／超長或control reason；嘗試改SKU/Lot/Status/UOM；用已成功key重送型別非法body；非法inputCoercion metadata啟動 | Bin Move在schema/cache/handler前拒絕非數字；null不能免檢；dimensions不能被替換；無Balance／Movement／成功Audit／Operation半套；其他route維持原轉型/defaults/trim/unknown-field政策；metadata僅省略或false，其餘啟動失敗 | Schema/domain與三個shared framework regression；real API安全body、cache前拒絕及DB zero-effects | NOT_RUN |
| Move-ownership-lock P0 | 同Bin／cross-Warehouse／inactive或missing Bin／SKU及合法Lot；来源或目的Counting signal | 每一不合法行放在合法行後，提交whole document | 所有權／profile／同Bin／任一active lock皆拒絕整份；不得把缺表或query故障普遍當unlocked | Unit + real MySQL/HTTP rollback；P4未交付時注入lock signal須明列限制，不宣告real Stocktake workflow PASS | NOT_RUN |
| Move-shared-bucket P0 | source10 allocated3；兩行OUT各4至不同目的；另有共享目的及source同時是另一行destination | 測gross OUT不足、不能用IN抵OUT、expected versions互相矛盾、shared destination safe-integer overflow及合法shared stock | 不足／overflow／不一致全部回滾；合法合計成功，leg before/after/version連續；永不移走allocated量 | Deterministic unit／real MySQL前後完整snapshot與paired-leg reconciliation | NOT_RUN |
| Move-reserved-expiry P0 | 同倉有效Reserved但未Allocation；有因時間流逝既存uncovered／expired Lot | 合法同倉保維度Move；比較當下eligible／Reserved／uncovered，另提交會移走Allocation的量 | 合法守恆Move不改Reserved／eligible／既存uncovered；不新增全面coverage前置門檻，過量／allocated OUT拒絕；不改效期或Reservation policy | Fixed-date unit + real MySQL eligible/Reserved/Allocation before-after | NOT_RUN |
| Move-replay-auth P0 | 同一source事件；有／無view、operation JWT及已撤權actor | same payload重送；改qty／line order／reason重送；完成後撤權再重送；查group及Operation | fresh auth必須先通過；成功重送同immutable receipt、無新legs；changed payload source conflict；撤權不回成功結果；401/403／安全500沿用框架 | Real HTTP/MySQL、Operation hash/receipt及grant/revocation fixture，safe logs | NOT_RUN |
| Move-races P0 | 兩連線讀同來源version／同已存在目的version；同missing目的；Issue/Dispatch競爭同source | barrier控制同version moves、目的先被更改／建立、Move vs Issue／Dispatch；拒絕任意sleep當同步 | locked當下version／free stock重驗；stale/loser衝突且零effects；不存在目的不能因upsert忽略null契約；stock與ledger守恆無deadlock破壞 | Real two-connection MySQL／API可重現barrier及結果／最終ledger | NOT_RUN |
| Move-failure P0 | 合法多行及可失敗transaction checkpoints | 在早期行後、OUT/IN兩leg間、Balance／Movement／Audit／completion注入failure再用同事件重試 | failure包含新zero Bucket／Operation全部回滾；retry只一次完整成功；原始失敗證據保留 | Real MySQL snapshots／transaction evidence及unit failure checkpoints | NOT_RUN |

新案例沿用既有configured discovery／zero-skip／34 floors及current-source證據規則，不把TASK030有限developer結果改標成full-P3或formal TC006 PASS。無frontend變更的service/API增量不需要Playwright；後續UI及其實際browser／console／network驗證義務不變。

#### TASK-029 SKU lookup subcases（§5.6.1；developer及後續正式驗證）

Trace: FR-070／071 → DES-005 → PHASE-004 → TASK-029 → TC-006；權限風險沿用SEC-001／TC-001的共同auth基線。下列是TC-006內的scenario labels，不另建formal IDs或改typed graph。全部初始NOT_RUN，計畫不是執行證据；單元mock不替代real API／MySQL／Playwright。

| Scenario／priority | Preconditions／synthetic data | Steps／input | Expected result | Required evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Lookup-auth P0 | Inventory-view-only JWT（無Item grants）、Item-only JWT、missing/expired JWT、撤權actor；同一SKU | GET code；撤權後以舊token重查 | Inventory-only200；Item-only403；missing/expired401；撤權依框架403/PERMISSION_STALE，拒絕時不呼叫Item；不擴大grant | Real HTTP／safe logs、claims與grant fixture、拒絕呼叫assertion | NOT_RUN |
| Lookup-shape P1 | Eligible tracked none/batch/batch_expiry SKU、Base UOM factor1；一SKU完全無Balance；另一Item discontinued/SKU active | Code查找；讀取keys；無Balance SKU建立／修改Draft，再Dispatch | 200 data精確whitelist且不含行政／價格資料；無Balance也可選，Draft不動stock；Dispatch按既有stock規則失敗且Draft／ledger不變；discontinued Item依profile允許 | API JSON／schema、前後DB ledger/stock、unit/client、實際Playwright流程 | NOT_RUN |
| Lookup-input P1 | 1／190／191 code-point code（含non-BMP）、空白、control／DEL、mixed-case、literal%/_、unknown code | 缺code、extra query、code重複、非string、越界及合法trim／等值查找 | Schema拒絕400 REQUEST_VALIDATION_FAILED；trim空白400 SKU_CODE_INVALID；unknown404；大小寫沿用DB collation；%/_不是wildcard；無SQL拼接或barcode／模糊結果 | Unit schema + real API request/response、DB fixture | NOT_RUN |
| Lookup-eligibility P1 | 非tracked、inactive/archived SKU、archived Item、serial；缺Base UOM／factor不為1 | 各code查找後嘗試以舊skuId提交Draft | Lookup使用既有profile及Transfer錯誤400 SKU_NOT_INVENTORY_TRACKED／INVENTORY_INPUT_INVALID／SERIAL_TRACKING_UNSUPPORTED／UOM_CONVERSION_INVALID；不能選，直接寫入同樣重驗；零stock／ledger寫入 | API／service assertions、before/after DB；故障資料只在owned schema | NOT_RUN |
| Lookup-snapshot P1 | 有效SKU；第二連線在code lookup與profile read之間改碼／停用；之後重新查找 | barrier控制並發，檢查executor／snapshot；提交舊選料；撤權重送 | 同一REPEATABLE READ snapshot，不混入另一SKU或不同時點profile；後續request看到新狀態；舊選料不能免除write-time驗證，改碼不自動換SKU；GET零業務寫入 | Deterministic unit + real two-connection MySQL/API、query/DB evidence；非固定sleep | NOT_RUN |
| Lookup-UI/error P1 | Inventory-only actor、兩個查找response順序反轉、404／400／403／500／network failure | keyboard查找／選料；Code改變／clear；較早response最後返回；保存失敗、refresh及unsaved離開 | Code變動清除該行SKU/Lot；舊response不覆蓋新輸入；loading/empty/errors明確、無未選SKU保存；其他Draft輸入保留、不auto-resubmit或替換；refresh依既有Draft／unsaved規則；console/network無未預期錯誤 | Client/component、production build、真API Playwright happy/error流；可控response競態另用component，mock不冒充real E2E | NOT_RUN |

回歸沿用Transfer權限／whole-document／idempotency／Audit rollback、Item lookup與既有profile suites；保留既有限流／SQL safe error／timeout與不公開內部資料。新PLAN的正式TC-006及business UAT-060須重新取得實際證據，不由舊API8或文檔結構PASS推定完成。

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-007 — Adjustment, status transfer and reversal

### Preconditions and data
Authorized/unauthorized adjustment actors and reversible/non-reversible movement fixtures.

### Steps
Test positive/negative adjustments, all seven approved reason categories, unknown categories, `OTHER` with and without detailed text, status transfers, reservation protection, reversal links, stale versions and direct ledger tampering.

#### TASK031 named developer scenarios — planned, not executed

These17 scenarios implement §5.4.2 / HD112–122 A. Developer verification is not formal TC007 PASS and does not execute TASK032 Reversal. Every row must appear as actual named cases in current-source/PLAN runner reports; aggregate legacy test counts cannot satisfy new coverage. DEF009/010 require targeted retest and impact regression before closure; the earlier21PASS/3FAIL native result is not current-candidate proof.

| Case | Synthetic setup/action | Required observed result | Evidence | Status |
| --- | --- | --- | --- | --- |
| ADJ031-HTTP-BOUNDARY | Two opted-in strong-auth routes; ordinary omitted route; invalid metadata/missing hooks/prepared input/replay callback | Startup fail closed for invalid capability; auth→authz→strict schema→credential-free preparation→cache claim→handler order; existing defaults/auth/lease/response behavior unchanged | Resolver/dispatcher/Idempotency native regressions | NOT_RUN |
| ADJ031-INPUT | Both Adjustment variants/Status; unknown/mixed fields, numeric strings/bool, unsafe IDs/versions, absent/null guards, missing uomId, same-status, auth-only fields forged | Before HTTP/domain effects reject; strict normalization also when global validation disabled; existing routes unchanged | Schema/domain/unit and real API DB snapshot | NOT_RUN |
| ADJ031-REASON | Seven categories, unknown; Unicode 500/501 UTF8 bytes; OTHER9/10 nonwhite code points; empty/control/DEL; Status text | Exact reason policy/category preserved; no truncation or success artifacts on rejection | Unit/API and Movement/Audit values | NOT_RUN |
| ADJ031-PROOF | PlainJWT/no device/bad password; no/copied/JSON proof; wrong actor/device/action/source/payload; original/future timestamp boundaries | Existing auth code rejects; domain fail closed; no credentials/context in command/hash/result/Audit/log/cache fingerprint; waits do not renew | Security/handler tests and actual strong-auth API | NOT_RUN |
| ADJ031-HTTP-REPLAY | Successful source/key; new valid password/signature/nonce same business; changed business; nonce reuse | Original200 data/no extra stock or success Audit; Idempotency-Replayed only after guard; changed input409, nonce reuse rejected; native lease/TTL>=7d/conflict preserved | Real API and HTTP store fingerprint/DB before-after | NOT_RUN |
| ADJ031-CACHE-WAIT | Gate cache begin; commit actor/permission/device/token revoke or advance signed/JWT deadline; release gate | Current replay guard rejects after store wait before response; no success replay/header/callback or key overwrite/deletion; safe failure Audit allowed | Controlled real API/MySQL barrier and logs | NOT_RUN |
| ADJ031-DOMAIN-REPLAY | Same source/payload differentHTTP key; wait for originalunique claim; change currentSKU/UOM/Lot/Balances after original | Fresh guard then originalimmutable result from scalar summary; no recompute/duplicate; changed payload source conflict | Real MySQL/API plus Operation summary | NOT_RUN |
| ADJ031-UOM | Base factor1/Pack integerfactor; missing/foreign/inactive/fractional factor, overflow; factor change at wait | Existing Item contract used; explicit input/Base projection exact, safe integers only; current eligibility rechecked before new mutation | Posting unit/realDB; Receipt contract regression | NOT_RUN |
| ADJ031-IN-LOT | Existing/absentBucket and new/same Lot; none/batch/batch_expiry/serial; NULL/date mismatch; newLot concurrency | Controlled Lot creation same tx; immutableexisting dates, null expected-absent race409; policy/serial failure zero artifacts | MySQL Lot/Balance/ledger and API | NOT_RUN |
| ADJ031-LIFE-FIFO | Each Status IN; expired/today/minlife edges; local-midnight wait; new/existing Lot, 0/positive/zero noLot balance | No expiry/minlife override; latestlocaldate/profile; newLotdate systemposting nothistorical, existingdate unchanged; FIFO anchor policy exact | Time injection/unit and native MySQL values | NOT_RUN |
| ADJ031-OUT-RESERVED | OnHand10 allocated4; reserved coverage; naturally expireduncovered; reservation races under sameControl | Onlyfree deducted; no Alloc/Reserved mutation or increaseduncovered; olduncovered notnewfull-coverage gate | Real concurrent DB barrier, snapshots/invariants | NOT_RUN |
| ADJ031-STATUS | Allsix distinctStatuspairs with same WH/Bin/SKU/Lot; allocations/AVAILABLEexpiry/Reserved; absentdest | Exactlypaired OUT/IN STATUS_TRANSFER legs, totalconservation/versionchain; noLot creation/retarget; expiredAVAILABLE non-saleable notblanketban | DB ledgers/Audit/result shape | NOT_RUN |
| ADJ031-LOCKS-VERSION | Active/inactiveWH/Bin/profile; Counting source/dest; sameversionrace; concurrentdestcreator; overflow | One validwinner or whole reject; current originalpresence read underControl; no zero-row remnants | MySQL concurrency/failure/unit | NOT_RUN |
| ADJ031-REVOKE-ORDER | Real0056/0059FKs; establishRRsnapshot; gate Warehouse and a post-new-Lot Bucketwait separately; commit actor/role/device/token invalidation beforefinalguard; secondcasefinalsecurity readlocksfirst | Revoke writer completes beforewait release (notjustattempted); currentguard rejects despiteoldsnapshot; no earlyuserlock fromOperation/Lot; guardfirst laterrevocation waits untiltxends; boundlocktimeouts/whole rollback/no proofrenewal | RealMySQL deterministic barriers, writercompletion/currentguard/order/stock assertions; realadmin-token-first path also regressed | NOT_RUN |
| ADJ031-ACTOR-BIND | NewAdjustment IN/OUT and allStatus directions; genuinelynewLot vs existingLot inclNULLcreator; domain/HTTP replay; inject Operation/newLot bind row0/DBerror/deadline/abort | Beforefinalguard onlyowneduncommitted Operation/newLot actorNULL; afterguard each exactrow boundonce totrusted actor; commit actor/audit attribution matches; cannotbackfill existingNULLLot/change replay/othercommand; bindfailure rollsback Operation/Lot/zeroBalance/stock/Movement/successAudit; caller cannot select staging | Unitred→green and real0056/0059MySQL ownership/commit/rollback/lock-wait snapshots; Receipt/Issue/BinMove/Transfer compatibility | NOT_RUN |
| ADJ031-ROLLBACK | Inject Operation/Lot/Balance/actorbindings/each pairedleg/Audit/completion failure or deadline/abort; deadlock/DB-unavailable | All business changes rollback includingtemporary actor metadata/newLot/zerorows/Operation; safe独立failureAudit allowed; successAudit required; secrets absent | Native snapshots/checkpoints and safe errors; prove each intendedinjector was reached (earlierDATE validation failure is notAudit rollback proof) | NOT_RUN |
| ADJ031-COMPATIBILITY | Omittedcapability route, originalstrongauth/nonce/request rules, Receipt/Issue/BinMove/Transfer plus ownedAudit fields | Onlytwo newroutes opted; oldproduct contracts unchanged; fullnative gates/floors/zero-skip; UI unchanged | Fullserver/Inventory/client/lint/build/coverage and existingactualTransfer browser | NOT_RUN |

#### TASK032 named developer scenarios — planned, not executed

These16 scenarios cover §5.4.3 only after actual Sam exact-candidate approval. HD127 A selects current versions, not unseen source/expiry/proof contracts. All16 must appear as actual named cases in current-source/approved-PLAN native reports; aggregate old counts/TASK031 evidence do not satisfy them. TC004 provides concurrent-operation linkage; formal TC007 and UAT remain NOT_RUN. Existing17 ADJ031 rows/history are preserved, not silently relabelled as new-baseline PASS.

| Case | Synthetic setup/action | Required observed result | Evidence | Status |
| --- | --- | --- | --- | --- |
| REV032-HTTP-BOUNDARY | Third fixed strong-auth route; plainJWT/bad password/permission/device/nonce; cross-purpose copied/JSON context; auth/global validation modes | Only view+adjust and trusted movement.reverse route/path/actor/device/source/intent allowed; auth→authz→strict preparation→claim; existing routes/defaults unchanged; no credential leakage | Handler/security unit and actual API/framework regression | NOT_RUN |
| REV032-INPUT | Canonical/noncanonical/unsafe path id; unexpected query/body fields; missing/null/string/unsafe versions and IDs; duplicate/extra/missing guards; reasons500/501bytes/Cc/DEL | Reject before effects; body no coercion, params explicitly safe-parsed; exact1..200 unique sorted guards; full-group identity only, no caller quantity/UOM/target | Schema/unit and real API DB zero-effect snapshots | NOT_RUN |
| REV032-GROUP | Allfive allowed types; Transfer/Stocktake/Opening/InTransit/Reversal; mixed/incomplete group/op summary/paired legs and >200 legs | Full server-derived immutable group only, count/identity/conservation checked; fixed nonreversible vs malformed rejection; original rows never updated/deleted | Real original Operation/Movement fixtures and native ledgers | NOT_RUN |
| REV032-VERSIONS | Historicalversion5,current9; submit9 vs5; missing historical Bucket; multiple legs shareBucket; overflow | Current9 can succeed only if invariants pass; stale5 whole409; no bucket recreation; guard snapshot once and exact perleg version chain | Unit/native MySQL current reads and snapshots | NOT_RUN |
| REV032-RECEIPT | Reverse original Receipt after later legitimate events; allocated/free/currentReserved constraint | Complete inverseOUT only if current free/eligible coverage safe; no Receiving workflow/history mutation or zero-row artifacts on reject | Movement DB and real API | NOT_RUN |
| REV032-ISSUE | One/multiline originalIssue inclConsumed Reservation/Allocation; changed currentPack factor | Original Base quantities IN to same buckets, no re-conversion; workflow counters/states immutable; onlynewREVERSAL/Operation/Audit/stock effects | Native DB original/new links, workflow snapshots and Item compatibility | NOT_RUN |
| REV032-ADJUSTMENT | Reverse IN/OUT Adjustment at allthree Statuses | Exact opposite original Base legs, no newreasonCategory policy, current free/tracking/active/Counting rules, original values unchanged | Unit/Movement/API plus all17 ADJ031 regression | NOT_RUN |
| REV032-PAIRS | One/multiline BinMove and allsix Status directions inclsharedBucket; allocated OUT and expected IN funding | Entirepaired group undo in deterministic reverseID order; OUT aggregate limited by original currentfree, notfutureIN; conservation, exact links/version chains | Real DB and failure snapshots | NOT_RUN |
| REV032-RESERVED | Current Reserved/eligible/allocated, naturallyexpired prioruncovered; competing Issue/Dispatch/Reserve | SameWH/SKU Control serializes; no increaseduncovered, no Reserved/Allocation writes; olduncovered notblanketfullcoverage gate | TC004 deterministic concurrent MySQL barriers/invariants | NOT_RUN |
| REV032-LOT-LIFE-FIFO | Existing expired/today/low-life Lot, midnight wait; active/tracking/serial; noLot0/positive/zero | Approved restoration only originalBucket, nevernewLot/retarget/date change; current Sale eligibility excludesexpired and respectsReserved; FIFO/DATE policy exact; Receipt/positiveAdjustment expiry ban unchanged | Time/unit/SQL DATE_FORMAT and native DB/API | NOT_RUN |
| REV032-ONCE | Same originalgroup, different source/key/anchor concurrent; partialpriorlinks; exactuniqueconstraint failure | Onecomplete winner; loser alreadyreversed or currentguard conflict, no partialgroup; completedsource replay immutable; unrelatedduplicates notmisclassified | Native DB current locking/unique barriers and group reconciliation | NOT_RUN |
| REV032-HTTP-REPLAY | Same normalizedguards permuted; freshpassword/signature; changedversion/path/source intent; revoke/deadline duringcache wait | Original200/no extra effects after freshguard; changedintent conflict; nonce protections; callback once, no key overwrite/deletion on denied replay; 7day TTL unchanged | Real API/cache fingerprints/native DB and existing HTTP regression | NOT_RUN |
| REV032-DOMAIN-REPLAY | Samebusinesssource/differentHTTP key; wait originalclaim; change currentstock/Item/Lot after success; revoke/deadline atwait | Fresh currentauth then original4scalar immutable result without stockrecomputation; source conflict on intentchange; no duplicate Audit/mutation/attribution change | MySQL/API Operation summary and originalresult assertions | NOT_RUN |
| REV032-REVOKE-ORDER | OriginalRRsnapshot; gate Warehouse/Lot/Bucket/claim separately; actualadmin token-first/actor/role/device revocation writerCOMMIT before release; guardfirstcase | NoearlyusersFK from ownOperation; afterwait currentguard rejects committedrevoke; guardfirstwriter waits; exact actor binding, no proofrenewal, boundedrollback | Real0056/0059 MySQL deterministic barriers/writercompletion and API | NOT_RUN |
| REV032-ROLLBACK | Bindrow0/error, eachBalance/leg/link/requiredAudit/completion injector; abort/deadline/deadlock/DBunavailable | Intendedinjector reached; wholezeroeffects inclplaceholder/Operation/links/stock/Audit; originalhistory/workflows immutable; safe independentfailureAudit only | Unitred→green and realDB before-after snapshots, safeerror/secret checks | NOT_RUN |
| REV032-COMPATIBILITY | Existingordinary/auth/preparation routes, Receipt/Issue/BinMove/Transfer/Adjustment/Status, audit/pins/floors | No shared/framework/DDL/dependency/Item changes; fullnative global/floor checks unchanged, focusedfunctional0skip; existing Transfer realbrowser regression; noTASK033 claim | Fullserver/Inventory/client/lint/build/34floors/DB/API/Playwright native reports | NOT_RUN |

### Expected result
Only authorized new compensating movements using the fixed reason allowlist occur; unknown categories and insufficient `OTHER` detail fail closed, totals and reservations remain valid, and immutable history cannot be changed.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

### TASK033 named developer scenarios — proposed, not executed

These12 UI033 prefixes specify §7.8.1 and the HD130 A recovery direction. They supplement existing TC004/TC007 intent without changing formal mappings or asserting formal PASS. Each prefix must appear in current-source native results; aggregate counts cannot replace the actual scenario. All rows are NOT_RUN until executed against the approved candidate; no existing TASK031/032 proof is relabelled UI evidence.

| Case | Required synthetic setup/action | Required observable result | Native evidence | Status |
| --- | --- | --- | --- | --- |
| UI033-AUTH | view+adjust, view-only, operation/FEFO-only, missing view, changed actor/revoked permissions | Adjustments route/actions require both permissions; ordinary Movement history remains view-only; current strong auth rejects write/replay with no effects, cleared confirmation | Unit and actual browser/API | NOT_RUN |
| UI033-SELECTORS | exact Code none/batch/batch_expiry, no-Balance SKU, unavailable/unknown lookup, active WH/Bin, late lookup responses | Clear old selection, explicit labels/Base unit, no numeric-ID or Item-management fallback, incomplete reads cannot confirm | Adjustment unit and actual browser | NOT_RUN |
| UI033-VALIDATION | quantity0/negative/float/unsafe, date/unknown status, seven categories, OTHER Unicode10/nonempty500-byte reasons | Safe local field/summary errors, no POST, existing server validation unchanged; Base uomId explicit and no guessed Pack conversion | Unit/service and actual browser | NOT_RUN |
| UI033-CURRENT-GUARDS | IN present/confirmed absent, OUT/Status source+destination, zero buckets, paginated Lot ambiguity, Reversal unique buckets/current versions unlike history | Full dimensions and current guards shown; failed/partial read not absence; missing/duplicate/>200 Reversal guards block, 409 doesn't substitute versions or retarget | Unit and actual browser/API | NOT_RUN |
| UI033-IN-LOT | new/old tracked Lot and immutable dates; expiry/min-life refusal; six Status directions/expired warning | Correct input shape and original dates, all statuses supported; expired cannot become saleable, no override/blanket new rule, rejected submission no partial effects | Unit, real browser, unchanged native domain/API regression | NOT_RUN |
| UI033-CONFIRM-SECRETS | submit/cancel/hide/unmount/actor change, invalid password/reason, form keyboard, sensitive capture settings | Password never reactive/store/URL/storage/intent/cache/log or event; transient read/DOM clear and fresh entry; focus trap/return; no credential trace/video/raw artifacts | Unit/service and actual browser safe boolean checks | NOT_RUN |
| UI033-SIGNED-INTENT | actual browser device/signature/current password, duplicate click, later input changes | One supplied key/source/body per intent, no duplicate POST; fresh nonce/signature on explicit retry, no caller auth assertions or shared auth changes | Service/unit and actual browser/API/DB | NOT_RUN |
| UI033-UNKNOWN-QUERY | real committed POST loses response; null source query, query error/in-progress/indeterminate error | UNKNOWN distinct from failure; query exact source first, completed resolves original result, null/error never authorizes new event or auto resend; one group/Audit effect | Unit and native transport-fault browser/API/DB | NOT_RUN |
| UI033-RETRY | pre-forward transport abort, null source, explicit unchanged retry, completed-before-retry, later rejection after unknown | No automatic retry; only original page/fresh password/current auth/new signature+nonce/same body-source-key; completed query prevents POST, later rejection doesn't discard earlier UNKNOWN | Unit/service and real browser/API/DB | NOT_RUN |
| UI033-REFRESH | refresh/leave before response, account change, malformed/mismatched recovery metadata, sessionStorage failure | Minimal actor-namespaced source/action/movement ID only, persist before POST; storage failure blocks; recovered state query-only/no guessed retry, another actor never sees it; closure limitations explicit | Unit and real browser | NOT_RUN |
| UI033-RECONCILE | paired reversal and all allowlisted types, unsupported Transfer/Stocktake/Opening/Reversal, resultSummary flattened fields, group/source collisions | Whole-group effects/current facts, no immutable history mutation/workflow resurrection; locate full exact source and operation/group; original/reversal links both ways; unsupported actions absent | Movement unit, real browser, native domain/API regression | NOT_RUN |
| UI033-UI-REGRESSION | late Movement detail/error after newer selection, loading/error/empty/success, literal XSS text, keyboard/back/refresh/320/768/1024/1440 | No stale target/data/action, escaped rendering, usable focus/labels/layout; zero unexpected console/page errors or API/network failures, sanctioned injected failures explicitly matched | Native client suites, real high-risk8+Transfer8, ordinary browser18, sanitized explicit screenshots | NOT_RUN |

The eight new real browser cases cover: (1) minimal permissions/fresh revocation; (2) IN/new Lot/no-Balance SKU and OUT; (3) Status paired effects/current-rule errors; (4) whole-group Reversal/unsupported eligibility/links; (5) committed response loss queried without duplicate; (6) unchanged explicit same-page retry after unknown transport outcome; (7) refresh/account/storage/query-only recovery; (8) responsive keyboard/secret-lifecycle/error states. Retain real framework JWT/device/password/idempotency/limiter and MySQL26.7.0 transactional facts. Use no mocked successful API responses; only intentional transport loss for unknown-outcome scenarios. Disable high-risk trace/video/automatic screenshots; safe cleared-screen capture and boolean/allowlisted diagnostics only. Failure reports must be reviewed for credentials before retention/export, never saved session-state or raw request bodies. No formal acceptance or capacity waiver follows from developer checks.


#### TASK034 integrated developer cases (HD133 A; exact candidate pending)

These12 scenario labels supplement TC001/004/006/007 without creating formal IDs or changing their mandatory/blocking/applicability/suite contracts. All rows are NOT_RUN on the candidate. P0 inventory/security risks have impact5 and likelihood3 (risk15); P1 UI recovery risk has impact4 and likelihood3 (risk12). Native name mapping and original assertions must be inspected before reuse; aggregate counts, mocked outcomes, generic rejected SQL or a structural graph are not execution proof.

`T` = existing `inventory-p3-transfer-database`; `M` = `inventory-p3-movement-database`; `A` = `inventory-p3-api`; `B` = existing real `inventory-p3-browser` plus ordinary `inventory-p3-browser-regression`. Existing names below are literal source prefixes; execution reports must contain the actual full native names/leaf results and the stated assertions. Only missing coverage is added in the three owned server integration files. New native cases use the indicated INT034 prefix; existing tests are neither renamed nor replaced merely to fit labels.

| Case | Priority / trace | Preconditions / synthetic data | Steps / input | Expected observable result | Required native evidence / reuse target | Status |
| --- | --- | --- | --- | --- | --- | --- |
| INT034-ISSUE-DISPATCH | P0; FR034/040/072/073 → TC004/006 | OnHand10 Available, legitimate Reservation7/Allocation7; Draft Dispatch7; distinct formal source events; two DB connections | Deterministic arrival/lock barrier races Issue7 and Dispatch7; repeat opposing arrival order without removing Reservation/Allocation guards | At most one committed effect; valid Issue7 consumed once; Dispatch rejects without legs/transit; final OnHand3/Allocated0/Reserved0, original Transfer Draft; no negative stock or extra Operation/successAudit | New `INT034-ISSUE-DISPATCH` in T; explicit outcomes/counters/ledger/Control snapshots; retain existing `TASK-028 concurrent Issue cannot let Dispatch consume allocated or reserved stock`4/7 regression | NOT_RUN |
| INT034-ADJUST-VERSION | P0; FR039/083/084/090 → TC004/007 | Existing Bucket OnHand10/versionV, two OUT4 intents, current fresh trusted credentials; enough stock for both | Barrier starts both same-version Adjustments with distinct events | Exactly one success; other VERSION_CONFLICT, no loser effects; OnHand6/versionV+1; one Adjustment group/Operation/successAudit; no overwritten version | New `INT034-ADJUST-VERSION` in M; retain `ADJ031-LOCKS-VERSION` expected-absent case and its actual guards | NOT_RUN |
| INT034-RESERVED-MOVE | P0; FR063/065/067/069 → TC006; AC022 | Same Warehouse two Active Bins, Reservation4 without Allocation, coherent current Buckets; expired-uncovered and allocated boundary fixtures separately | Move valid eligible quantity between Bins; attempt allocated/gross-OUT/ownership-invalid variants | Conserving Move leaves Reserved/eligible totals/workflow unchanged; valid unallocated reservation does not forbid move; invalid variant has zero-effects; no blanket new coverage rule | M exact existing `TASK-030 natural expiry/uncovered Reservation does not block a conserving Move or change Control`, `TASK-030 gross OUT cannot use incoming quantities or consume allocated stock` and missing unallocated Reservation fixture added only if absent | NOT_RUN |
| INT034-RECONCILE | P0; FR065/073/077/086/089 → TC006/007 | Real multi-line BinMove, Dispatch/Receive, six Status pairs and all reversible original types with chained versions/current guards | Query original/completed Operation, immutable legs, group links, Audit and final Buckets/InTransit; reverse eligible full groups | Per Bucket signed leg sums equal exact stock delta; same dimension conservation where required, Transfer custody correct; complete links/actor/version chain; no partial or ambiguous duplicate group | T `TASK-028` whole-document paired assertions; M `TASK-030 native multi-line document`, `REV032-PAIRS`, `ADJ031-STATUS`; exact names plus new combined check only for a demonstrated gap, safe before/after snapshots | NOT_RUN |
| INT034-ROLLBACK | P0; FR034/065/073/077/086/089, SEC012 → TC004/006/007/001 | Multi-line/paired/inverse operations; new destination/newLot/Operation placeholders; actual write/Audit/completion checkpoints | Inject reached fault between legs/after an earlier line, required Audit/completion/bind/precommit; retry same event after rollback | Business differences zero inclnew placeholders/legs/links, successful Audit absent; intended injector reached; safe independent rejection Audit allowed; retry exactly once | T `TASK-028 failure between paired legs or after an earlier line`; M `TASK-030 injected mid-leg`, `ADJ031-ROLLBACK`, `REV032-ROLLBACK`; A real Audit-failure cases; missing command/checkpoint coverage requires owned new `INT034-ROLLBACK` assertions | NOT_RUN |
| INT034-OWNERSHIP | P0; FR039/064/076, SEC008/009 → TC001/006/007 | Valid and foreign WH/Bin/SKU/Lot/Movement/group IDs; one invalid line after valid line; real route actor | Replace one identity/current guard or malformed source/action through actual HTTP and service paths | Stable specific rejection; no cross-owner effect or partial state; source/key do not authorize wrong target; no SQL/stack/request secret leak | A existing `DEV-029`/BinMove/`REV032` ownership tests, M `TASK-030 strict body, source/destination ownership`; add owned `INT034-OWNERSHIP` only for uncovered resource path | NOT_RUN |
| INT034-STRONG-AUTH | P0; FR082, SEC001–007/010/011 → TC001/007 | Anonymous/view-only/operation-only/mgmt/FEFO-only actors, ordinary JWT, valid strong actor/device; synthetic fresh passwords/signatures | Attempt Adjustment/Status/Reversal and ordinary Transfer/BinMove; copied-purpose/actor proofs, wrong password/device/signature | High-risk requires view+adjust and valid current trusted context; ordinary JWT rejected; operation/mgmt/FEFO do not replace adjust; ordinary/internal contracts unchanged; no effects or credential export | A `ADJ031-PROOF`/`REV032-HTTP-BOUNDARY` actual error assertions; existing security/handler/functional regressions and real browser permissions; new `INT034-STRONG-AUTH` only for coverage gap | NOT_RUN |
| INT034-REVOKE | P0; FR039, SEC010/013 → TC001/004/007 | Actual actor/role/device/token revocation writers; RR snapshot and stock/cache/source wait; unexpired then elapsed proof | Deterministic wait, commit revocation before releasing blocker; guard-first writer-waits contrast; repeat cached/domain replay | Current guard rejects revoke-before; entire business rollback; guard-first serialization holds; expired proof never renewed; cached success cannot bypass current permission/device/token | M `ADJ031-REVOKE-ORDER`, `REV032-REVOKE-ORDER`; A real cache/domain wait variants incladmin-token-first, specific error and committed writer evidence | NOT_RUN |
| INT034-REPLAY | P0; FR037/038/080/090, SEC008/010 → TC004/006/007/001 | Completed source/HTTP key; later legitimate stock/source state; same and changed body/path/event; lost committed response | Fresh signed same-intent replay/domain new-key retry; change quantity/source target/versions; query exact source after loss | Original immutable result once; no recomputation/extra effects; changed business intent conflicts; no actor attribution overwrite; null query stays unknown, no automatic new event | T source replay, A `DEV-029-API-07`, `ADJ031-HTTP-REPLAY`/`REV032-HTTP-REPLAY`/domain cases, B `TASK-033 @technical pre-forward abort`, `TASK-033 @technical real committed-response loss` and refresh/navigation cases; current reports and Operation hash/DB snapshots | NOT_RUN |
| INT034-IMMUTABLE | P0; FR041/089, SEC008/012 → TC004/007/001; AC018 | Existing real Movement/successAudit rows and trigger-bearing migrated owned schema; preserve original rows | Direct UPDATE and DELETE on both history tables via fixture connection; query afterward; unsupported edit/delete HTTP attempts where actual route exists | Actual `ER_SIGNAL_EXCEPTION`/SQLSTATE45000 with correct table immutable-trigger cause; exact rows unchanged; no arbitrary DB failure accepted; no edit/delete business endpoint becomes available | New/strengthened `INT034-IMMUTABLE` in M; exact0057/0060 trigger contract; existing weak generic UPDATE reject assertion retained/strengthened, never counted alone | NOT_RUN |
| INT034-ISSUE-REVERSAL | P0; FR034/041/089, SEC005 → TC004/007/001; AC018 | Original valid Issue consumed Reservation/Allocation and immutable rows; current free/Lot/status/version rules | Deny historical mutation; perform authorized whole-group reversal using current guards; replay/concurrent reversal | New linked compensating legs only; original consumed workflow never resurrected or edited; exactly-once compensation, current quantity/security invariants remain | M `REV032-ISSUE`, `REV032-ONCE` and A actual reversal routes, workflow/Movement/Operation/Audit snapshots | NOT_RUN |
| INT034-BROWSER | P1; FR038/041/090, SEC009/011/013 → TC001/004/007 | Existing actual Transfer/high-risk UI, synthetic real API/MySQL/device credentials; saved hostile text, transport loss, refresh/current actor | Run existing real16 and ordinary18 Playwright; inspect actual cleared responsive screens, keyboard/password lifecycle, visible source/result/links, errors/console/network | Literal escaped text/no script; same-intent retry and query-only refresh; no silent duplicates; no credential capture; no unexpected console/network failures; stable usable responsive actions | B exact current native full case names plus UI033 mapping and cleared screenshot hashes/visual review; mocked18 explicitly separate, not API/DB proof; no UI source/spec modification or new formal UAT claim | NOT_RUN |

Reused native names are only planning targets, not current-candidate PASS. Any missing assertion or required name stays NOT_RUN/BLOCKED until a real non-skip execution establishes it. Cross-case evidence must retain exact suite, native leaf, source/PLAN/HEAD, command contract, safe artifact hash and required invariant assertions; name-only aliases without behavior do not count. The writer inventory in TASK034's plan is validated by current source/handler/internal-alias pins and actual write-site discovery, not by a fabricated executable case or future P4 proof. Cleanup uses only owned synthetic instances/schema/accounts/cache/ports/roots.

## TC-008 — Stocktake locking, counting and variance posting

### Preconditions and data
Two Stocktakes competing for Bins, restartable services and multi-line variances.

### Steps
Test persistent lock acquisition, every Bin mutation guard, save/version conflicts, Ready completeness, all-or-nothing Post, Cancel and owner-safe unlock.

### Expected result
At most one active owner exists per Bin; locks survive restart and no partial variance or foreign unlock is possible.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-009 — Opening precheck, fencing and Go-Live

### Preconditions and data
Valid/invalid 10,000-row Opening files, stale prechecks, competing fenced workers, Active Serial data, separated/non-separated DB accounts, backup/restore evidence and Data Freeze/reconciliation fixtures.

### Steps
Test streaming limits, formula/encoding/header errors, no-write precheck, authorization, lease takeover, failure recovery, idempotency, Active Serial rejection, DB-account separation, backup/restore evidence, Data Freeze, Warehouse／Operations Lead reconciliation and Sam's irreversible Go-Live sign-off.

### Expected result
Invalid/stale work creates no inventory; one fenced worker commits one complete Opening; Go-Live remains blocked without every approved operational gate and Sam sign-off; LIVE permanently blocks new Opening commands.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## TC-010 — Inquiry, exports, performance and recovery

### Preconditions and data
Two-million-movement/index-equivalent fixtures, export payloads, dependency faults and an isolated restore target.

### Steps
Verify pagination/order, CSV safety, p95 targets, timeout/retry states, structured logs/metrics, six reconciliation invariants and backup/restore consistency.

### Expected result
Queries and exports are correct and bounded, no sensitive data leaks, and recovery/reconciliation results meet the approved operational baseline.

### Acceptance criteria
Mandatory: `true`; blocking: `true`; applicability: `APPLICABLE`; suite: `inventory-technical`. Every mapped case ID must be observed as PASS on the current approved baseline; zero discovery, skips or stale evidence block the gate.

### Cleanup
Remove only owned synthetic records and runtime resources from the isolated test instance; preserve redacted reports and do not touch shared or production data.

## P3 integrated-baseline developer compatibility cases

Supplement the existing TC-001/004/007 design/security coverage without renumbering cases, changing formal stages or declaring formal PASS. Execute these only as DEVELOPER on the adopted new source/PLAN; old task approvals remain historical local DoD.

| Coverage | Required observable behavior |
| --- | --- |
| Fixed worker authority | Missing registration, human/arbitrary service identity, extra permission/role, expired/wrong lease, abort/stop/disable reject before Inventory claim/effect, including completed replay. |
| Worker replay and transaction | Distinct worker root/child command hashes, exact original membership, partial/zero results and NULL-user fixed-label audit; lock the lease before Sales/Inventory owners; caller rollback removes all business effects. |
| Manual compatibility | Existing manual Sales reserve/release types, hashes, user authority, source guards, revocation and result membership remain unchanged; no worker release or new Inventory HTTP role grant. |
| Shared authorization order | Existing authentication/policy checks, optional handler preflight, upload/schema handling and P3 preparation remain in that order; preflight denial/abort never reads upload or claims idempotency work. |
| Combined replay | Authorized prepared202 replay emits only declared Retry-After after its guard, once; rejected guard emits no replay body/flags/headers/log;200 or missing retry setting has no new header. Preserve ordinary202 test, secret-free stored response and all P3 credential-free/preparation assertions. Add these cross-behavior regressions in the existing idempotency test file before considering the conflict resolved. |
| Integration regressions | Every original P3 suite/case, full native/functional consumer regression, real browser16/ordinary18, current ledger migration checks, global and34 file floors pass without forbidden skip. |
| Capacity | Complete existing Customer10k and Core100k/500k/2M wrapper assertions with exact budgets, concurrency/EXPLAIN/rollback and native measured output; no shortened fixture. |

Native worker/Confirmation/Backorder tests are supporting consumer evidence, not definitions of Inventory TC-022/031 or business acceptance. All current-source guarded skips require matching independently executed non-skip evidence. Schema, runtime or parsing problems stay BLOCKED; they are not converted to PASS by this appendix.
