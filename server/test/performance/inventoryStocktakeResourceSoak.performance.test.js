import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parse} from 'csv-parse';

export async function verifyStocktakeSoakSupportingExamples(source,helperPath='ACTUAL_HELPER_SOURCE') {
const sha = value => createHash('sha256').update(value).digest('hex');
function section(name) {
  let start = source.indexOf(`export function ${name}(`);
  if(start<0)start=source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing actual helper ${name}`);
  let end = source.indexOf('\n// END ' + name, start);
  if(end<0&&name==='stocktakeSoakWriterPlan')end=source.indexOf('\nexport async function runStocktakeResourceSoak',start);
  if(end<0)end=source.indexOf('\nexport function ',start+1);
  assert.ok(end > start, `Missing helper boundary ${name}`);
  return source.slice(start, end).replace('export function ', 'function ');
}
const tokenFor = at => 'header.' + Buffer.from(JSON.stringify({ iat: Math.floor(at / 1000), exp: Math.floor(at / 1000) + 900 })).toString('base64url') + '.signature';
const cases = [];
async function check(name, run) {
  try { await run(); cases.push({ name, status: 'PASS' }); }
  catch (error) { cases.push({ name, status: 'FAIL', nameOfError: error.name, code: error.code ?? null, assertion: error.message,
    actual: ['string','number','boolean'].includes(typeof error.actual) ? error.actual : null,
    expected: ['string','number','boolean'].includes(typeof error.expected) ? error.expected : null }); }
}
const columnsText=source.match(/const stocktakeCsvColumns = ([\s\S]*?);/u)?.[1];
const stocktakeCsvColumns=columnsText?runInNewContext(columnsText):[];
const stocktakeCsvDigestColumns=stocktakeCsvColumns.filter(field=>field!=='asOf');
const stocktakeCsvExpectedCell=value=>value==null?'':typeof value==='string'&&/^[=+@\-\t\r]/u.test(value)?`'${value}`:String(value);
const load = name => runInNewContext(`${section(name)}; ${name}`, { assert: Object.assign(Object.create(assert), { deepEqual: (actual, expected, message) => assert.deepEqual(structuredClone(actual), structuredClone(expected), message) }), performance, WeakMap, WeakRef, Map, Set, Promise, Object,
  Number, String, Boolean, Array, Date, JSON, Error, TypeError, randomUUID, createHash, sha, AbortController, Buffer, WeakSet, globalThis, process, Readable, pipeline, parse, stocktakeCsvColumns,stocktakeCsvDigestColumns,stocktakeCsvExpectedCell,installStocktakeSoakExportObserver:name==='wrapStocktakeSoakHandlerModule'?load('installStocktakeSoakExportObserver'):undefined,stocktakeSoakTables:name==='stocktakeSoakTables'?undefined:source.includes('export function stocktakeSoakTables(')?load('stocktakeSoakTables'):undefined,resourceClock:()=>performance.timeOrigin+performance.now() });
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
await check('refresh due preserves fourth writer turns and both independent due events', async () => {
  const create = load('createStocktakeSoakLane');
  let now = 0, wall = 0, fetchCalls = 0;
  const actor = { id: 1, worker: 0, writer: true, token: 'private-token', issuedAt: 0, expiresAt: 900000,
    device: { headers: async () => ({ 'X-Signature': 'private-signature' }) } };
  const worker = { incarnation: 'synthetic-worker', origin: 'http://synthetic', quarantined: false };
  const report = { offers: [], requests: [], refreshes: [] };
  const lane = create({ workers: [worker], actors: [actor], report, epoch: 0, clock: () => now, wallClock: () => wall,
    fetch: async () => { fetchCalls++; return { status: 200, headers: { get: () => null }, json: async () => ({ data: { token: tokenFor(wall), expiresInSeconds: 900 } }) }; } });
  now = wall = 599000;
  let row = lane.offer(actor, 0, 599000, { family: 'WORKFLOW', route: '/api/v1/test', body: {} }); await row.pending;
  now = wall = 600000;
  row = lane.offer(actor, 3, 600000, { family: 'WORKFLOW', route: '/api/v1/test', body: {}, candidate: { family: 'FEFO_FIFO_CANDIDATES', route: '/api/v1/candidate' } }); await row.pending;
  assert.equal(row.family, 'FEFO_FIFO_CANDIDATES'); assert.equal(report.refreshes.length, 0);
  now = wall = 601250;
  row = lane.offer(actor, 4, 601250, { family: 'WORKFLOW', route: '/api/v1/test', body: {} }); await row.pending;
  assert.equal(row.family, 'REFRESH'); assert.equal(report.refreshes[0].dueAtMs, 600000);
  assert.equal(report.refreshes[0].dueDispatchLatenessMs, 1250); assert.equal(report.refreshes[0].signed, true);
  now = wall = 1200000;
  row = lane.offer(actor, 8, 1200000, { family: 'WORKFLOW', route: '/api/v1/test', body: {} }); await row.pending;
  assert.equal(report.refreshes.length, 2); assert.equal(report.refreshes[1].dueAtMs, 1200000);
  assert.equal(fetchCalls, 4); assert.equal(report.offers.length, 4); lane.verifyRefreshes(1800000);
  assert.ok(!JSON.stringify(report).includes('private'));
});
await check('busy exporter at refresh due retains original offers until its first idle own turn', async () => {
  const create = load('createStocktakeSoakLane');
  let now = 599000, wall = 599000; const body = defer(); let sends = 0;
  const actor = { id: 1, worker: 0, writer: false, token: 'secret', issuedAt: 0, expiresAt: 900000, device: { headers: async () => ({}) } };
  const report = { offers: [], requests: [], refreshes: [] };
  const lane = create({ workers: [{ origin: 'http://fake', incarnation: 'fake' }], actors: [actor], report, epoch: 0, clock: () => now, wallClock: () => wall,
    fetch: async () => { sends++; return { status: 200, headers: { get: () => null }, json: () => sends === 1 ? body.promise : Promise.resolve({ data: { token: tokenFor(wall), expiresInSeconds: 900 } }) }; } });
  const first = lane.offer(actor, 0, now, { family: 'CSV', route: '/export' });
  await Promise.resolve(); await Promise.resolve(); now = wall = 600250;
  const busy = lane.offer(actor, 1, now, { family: 'CSV', route: '/export' });
  assert.equal(busy.outcome, 'NOT_SENT_BUSY'); assert.equal(busy.family, 'REFRESH'); assert.equal(sends, 1);
  now = wall = 718999; body.resolve({ data: {} }); await first.pending;
  const refresh = lane.offer(actor, 2, now, { family: 'CSV', route: '/export' }); await refresh.pending;
  assert.equal(report.refreshes[0].dueDispatchLatenessMs, 118999); assert.equal(report.offers.length, 3); assert.equal(sends, 2);
});
await check('early expiry refresh does not satisfy future mandatory boundary', async () => {
  const create = load('createStocktakeSoakLane'); let now = 1000;
  const actor = { id: 1, worker: 0, token: 'secret', issuedAt: 0, expiresAt: 120999, device: { headers: async () => ({}) } };
  const report = { offers: [], requests: [], refreshes: [] };
  const lane = create({ workers: [{ origin: 'http://fake', incarnation: 'fake' }], actors: [actor], report, epoch: 0, clock: () => now, wallClock: () => now,
    fetch: async () => ({ status: 200, headers: { get: () => null }, json: async () => ({ data: { token: tokenFor(now), expiresInSeconds: 900 } }) }) });
  await lane.offer(actor, 0, now, { family: 'QUERY', route: '/query' }).pending;
  assert.equal(report.refreshes[0].dueAtMs, null); assert.equal(report.refreshes[0].expiryRequired, true);
  now = 600000; await lane.offer(actor, 1, now, { family: 'QUERY', route: '/query' }).pending;
  assert.equal(report.refreshes[1].dueAtMs, 600000); assert.throws(() => lane.verifyRefreshes(1800000));
});
await check('signing preparation reserves worker and final admission rejects stale tick without send', async () => {
  const create = load('createStocktakeSoakLane'); let now = 0; const sign = defer(); let sends = 0;
  const actors = [1,2].map(id => ({ id, worker: 0, token: 'secret', issuedAt: 0, expiresAt: 900000, device: { headers: () => sign.promise } }));
  const report = { offers: [], requests: [], refreshes: [] };
  const lane = create({ workers: [{ origin: 'http://fake', incarnation: 'fake' }], actors, report, epoch: 0, clock: () => now, wallClock: () => now,
    fetch: async () => { sends++; return { status: 200, headers: { get: () => null }, json: async () => ({ data: {} }) }; } });
  const first = lane.offer(actors[0], 0, 0, { family: 'POST', route: '/post', body: {}, signed: true });
  now = 125; const second = lane.offer(actors[1], 0, 125, { family: 'QUERY', route: '/query' });
  assert.equal(second.outcome, 'NOT_SENT_BUSY'); assert.equal(second.notSentReason, 'PREPARATION_BUSY');
  sign.resolve({}); await first.pending; assert.equal(first.outcome, 'NOT_SENT_LATE'); assert.equal(sends, 0); assert.equal(report.offers.length, 2);
});
await check('signing rejection preserves original error, releases preparation, never issues hidden request', async () => {
  const create = load('createStocktakeSoakLane'); let now = 0, sends = 0;
  const failure = Object.assign(new Error('private signing detail'), { code: 'SIGN_REJECTED' });
  const actors = [1,2].map(id => ({ id, worker: 0, token: 'secret', expiresAt: 900000, device: { headers: () => Promise.reject(failure) } }));
  const report = { offers: [], requests: [], refreshes: [] };
  const lane = create({ workers: [{ origin: 'http://fake', incarnation: 'fake' }], actors, report, epoch: 0, clock: () => now, wallClock: () => now,
    fetch: async () => { sends++; return { status: 200, headers: { get: () => null }, json: async () => ({ data: {} }) }; } });
  const first = lane.offer(actors[0], 0, 0, { family: 'POST', route: '/post', body: {}, signed: true });
  await assert.rejects(first.pending, error => error === failure); assert.equal(first.outcome, 'NOT_SENT_SIGNING_FAILED');
  await lane.settle(); assert.equal(lane.pending.size, 0); assert.equal(lane.busy.size, 0);
  now = 125; const next = lane.offer(actors[1], 0, now, { family: 'QUERY', route: '/query' }); await next.pending;
  assert.equal(next.outcome, 'NOT_SENT_BUSY'); assert.equal(next.notSentReason, 'RUN_STOPPED');
  assert.equal(next.admittedAt, null); assert.equal(next.dispatchAt, null); assert.equal(next.pending, undefined);
  assert.equal(sends, 0); assert.equal(report.requests.length, 1); assert.equal(report.offers.length, 2);
});
await check('post-sign quarantine and token-safety are checked before actual dispatch', async () => {
  for (const change of ['quarantine','expiry']) {
    const create = load('createStocktakeSoakLane'); let now = 0; const sign = defer(); let sends = 0;
    const actor = { id: 1, worker: 0, token: 'secret', expiresAt: 900000, device: { headers: () => sign.promise } };
    const worker = { incarnation: 'fake', origin: 'http://fake' }, report = { offers: [], requests: [], refreshes: [] };
    const lane = create({ workers: [worker], actors: [actor], report, epoch: 0, clock: () => now, wallClock: () => now,
      fetch: async () => { sends++; assert.fail('unsafe dispatch'); } });
    const row = lane.offer(actor, 0, 0, { family: 'POST', route: '/post', signed: true });
    if (change === 'quarantine') worker.quarantined = true; else actor.expiresAt = 1;
    now = 2; sign.resolve({}); await row.pending;
    assert.equal(row.outcome, 'NOT_SENT_BUSY'); assert.equal(sends, 0);
  }
});
await check('actual send spacing, body settlement and first original transport error are retained', async () => {
  const create = load('createStocktakeSoakLane'); let now = 0, sends = 0; const body = defer();
  const actor = { id: 1, worker: 0, token: 'secret', expiresAt: 900000 };
  const actor2 = { ...actor, id: 2 }, worker = { incarnation: 'fake', origin: 'http://fake' }, report = { offers: [], requests: [], refreshes: [] };
  const lane = create({ workers: [worker], actors: [actor, actor2], report, epoch: 0, clock: () => now, wallClock: () => now,
    fetch: async () => { sends++; return { status: 200, headers: { get: () => null }, json: () => body.promise }; } });
  const first = lane.offer(actor, 0, 0, { family: 'QUERY', route: '/query' }); await Promise.resolve(); await Promise.resolve();
  now = 124; assert.equal(lane.offer(actor2, 0, now, { family: 'QUERY', route: '/query' }).outcome, 'NOT_SENT_RATE');
  now = 125; assert.equal(lane.offer(actor, 1, now, { family: 'QUERY', route: '/query' }).outcome, 'NOT_SENT_BUSY');
  body.resolve({ data: {} }); await first.pending; assert.equal(sends, 1);
  const failure = Object.assign(new Error('original fetch failure'), { code: 'FETCH_FAILED' });
  const broken = create({ workers: [worker], actors: [actor], report: { offers: [], requests: [], refreshes: [] }, epoch: 0,
    clock: () => now, wallClock: () => now, fetch: () => Promise.reject(failure) });
  const bad = broken.offer(actor, 2, now, { family: 'QUERY', route: '/query' });
  await assert.rejects(bad.pending, error => error === failure); assert.equal(worker.quarantined, true); assert.equal(bad.resultObservation, 'UNKNOWN');
});
await check('immutable seed lower bound catches late lower commit, foreign row and moving-lower-bound mutant', async () => {
  const scanTable = load('scanStocktakeSoakTable');
  const scan=async(db,table,cutoff)=>{const rows=[];await scanTable(db,table,cutoff,row=>rows.push(row));return rows;};
  let visible = [{ id: 12, request_id: 'known-high' }]; const queries = [];
  const db = { execute: async (_sql, [after]) => { queries.push(after); return [visible.filter(row => row.id > after).slice(0, 500)]; } };
  const first = await scan(db, 'inventory_audit_logs', 10);
  assert.deepEqual([...first.map(row => row.id)], [12]);
  visible = [{ id: 11, request_id: 'late-low' }, ...visible];
  const second = await scan(db, 'inventory_audit_logs', 10);
  assert.deepEqual([...second.map(row => row.id)], [11,12]); assert.equal(queries[2], 10);
  const mutant = await scan(db, 'inventory_audit_logs', Math.max(...first.map(row => row.id)));
  assert.notDeepEqual([...mutant.map(row => row.id)], [11,12]);
  visible[0].request_id = 'foreign'; const foreign = await scan(db, 'inventory_audit_logs', 10);
  assert.equal(foreign[0].request_id, 'foreign');
  await assert.rejects(() => scan(db, 'arbitrary_table', 10));
});
await check('observer preserves Promise, generation return, emission/callback order and original errors', async () => {
  const install = load('installStocktakeSoakExportObserver');
  const events = [], order = []; let context = { requestId: 'req-1' }, generation, handlePromise, preparePromise;
  const tx = {}, stream = new EventEmitter(); stream.readableEnded = false; stream.destroyed = false;
  stream.pipe = function (destination) { order.push('pipe'); return destination; };
  stream._destroy = function (error, callback) { order.push('destroy'); callback(error); return 'destroy-return'; };
  let lastTransactionReturn,lastCallback,lastOptions;
  const database = { withTransaction(work, options) {lastCallback=work;lastOptions=options;return lastTransactionReturn=Promise.resolve(work.call(this, tx, options)); } };
  const audit = { recordSucceeded(_tx, _input) { return Promise.resolve(); }, recordFailed(_input) { return Promise.resolve(true); }, recordRejected(_input) { return Promise.resolve(true); } };
  const readerDb = { withTransaction(work, options) { generation = Promise.resolve(work.call(this, tx, options)); return generation; } };
  const reader = { initialize() { return Promise.resolve(readerDb); } };
  const exports = { database, audit: { ...audit }, createGenerationReader() { return reader; },
    prepare() { preparePromise = (async () => { const r = this.createGenerationReader(); await r.initialize();
      await r.database.withTransaction(() => ({ stocktakeId: 1, status: 'COUNTING', workflowVersion: 2, exportedRows: 100000, truncated: true, truncationReason: 'ROW_LIMIT' }));
      return { stream, asOf: 123, truncated: true, truncationReason: 'ROW_LIMIT', generationBudgetMs: 60000 }; })(); return preparePromise; } };
  Object.defineProperty(reader, 'database', { get: () => readerDb });
  const res = { finished: false, destroyed: false, headersSent: false };
  const handler = { database, exports, audit, handle(req, response) { handlePromise = (async () => { const value = await this.exports.prepare({ requestId: req.requestId });
    order.push('caller-got-prepare'); assert.ok(events.some(e => e.type === 'generation.return'));
    assert.ok(events.some(e => e.type === 'prepare.return')); assert.equal(value.stream.pipe(response), response); })(); return handlePromise; },
    auditFailure() { return Promise.resolve(); } };
  const observer = install(handler, { incarnation: 'worker', getContext: () => context, publish: event => { events.push(event); order.push(event.type); }, now: () => 123 });
  const pending = handler.handle({ requestId: 'req-1' }, res); assert.equal(pending, handlePromise); await pending; await Promise.resolve();
  assert.equal(stream.listenerCount('close'), 0); assert.equal(stream.listenerCount('error'), 0);
  stream.on('end', () => order.push('original-listener')); stream.readableEnded = true;
  assert.equal(stream.emit('end'), true); assert.ok(order.indexOf('stream.event') < order.indexOf('original-listener'));
  const original = Object.assign(new Error('private error'), { code: 'SOURCE_FAILED' }); let received;
  assert.equal(stream._destroy(original, error => { received = error; order.push('original-callback'); }), 'destroy-return');
  assert.equal(received, original); assert.ok(order.indexOf('stream.destroy.result') < order.indexOf('original-callback'));
  assert.ok(order.indexOf('generation.return') < order.indexOf('prepare.return')); assert.equal(observer.report().status, 'COMPLETE');
  assert.ok(!JSON.stringify(observer.report()).includes('private error'));
  context=null;const count=events.length,options={original:true},nonOwned=function(transaction,receivedOptions){assert.equal(this,database);assert.equal(transaction,tx);assert.equal(receivedOptions,options);return 'untouched';};
  const untouched=database.withTransaction(nonOwned,options);assert.equal(untouched,lastTransactionReturn);assert.equal(lastCallback,nonOwned);assert.equal(lastOptions,options);await untouched;assert.equal(events.length,count);
});
await check('original Audit false and unknown commit remain separate facts with every attempt retained', async () => {
  const install = load('installStocktakeSoakExportObserver'); const events = [];
  const failure = Object.assign(new Error('private DB error'), { code: 'DATABASE_TRANSACTION_INDETERMINATE' });
  const database = { withTransaction() { return Promise.reject(failure); } };
  const makeAudit = () => ({ recordSucceeded() { return Promise.resolve(); }, recordRejected(input) { return this.recordFailed(input); },
    recordFailed(input) { return database.withTransaction(() => input).then(() => true, () => false); } });
  const handler = { database, audit: makeAudit(), exports: { audit: makeAudit(), prepare() {}, createGenerationReader() {} },
    handle() { return Promise.resolve(); }, auditFailure() { return Promise.resolve(); } };
  const observer = install(handler, { incarnation: 'worker', getContext: () => ({ requestId: 'r' }), publish: e => events.push(e), now: () => 1 });
  await handler.handle({ requestId: 'r' }, {});
  const input = { actorUserId: 1, actorLabel: 'user:1', action: 'inventory.export', targetType: 'stocktake', targetLabel: '/api/v1/inventory/stocktakes/:id/export', requestId: 'r', correlationId: 'r' };
  assert.equal(await handler.audit.recordFailed(input), false); assert.equal(await handler.audit.recordFailed(input), false); await Promise.resolve();
  assert.equal(events.filter(e => e.type === 'audit.attempt').length, 2);
  assert.equal(events.filter(e => e.type === 'audit.transaction.error' && e.commitObservation === 'UNKNOWN_COMMIT').length, 2);
  assert.equal(events.filter(e => e.type === 'audit.result' && e.result === false).length, 2);
  assert.equal(observer.report().status, 'COMPLETE'); assert.ok(!JSON.stringify(events).includes('private DB error'));
});
await check('observation overflow/publication failure never changes original application result', async () => {
  const install = load('installStocktakeSoakExportObserver'); const pending = Promise.resolve('original');
  const handler = { database: { withTransaction() { return pending; } }, audit: {}, exports: { audit: {} }, handle() { return pending; }, auditFailure() { return pending; } };
  const observer = install(handler, { incarnation: 'fake', getContext: () => ({ requestId: 'r' }), publish() { throw new Error('publish'); }, maxEvents: 1, now: () => 1 });
  assert.equal(handler.handle({ requestId: 'r' }, {}), pending); await pending; await Promise.resolve();
  assert.equal(observer.report().status, 'INCOMPLETE'); assert.ok(observer.report().metrics.captureFailures + observer.report().metrics.droppedEvents > 0);
});
await check('exact lifecycle/Audit multiset rejects wrong actor target metadata duplicates false and unknown commit', async () => {
  const verify = load('verifyStocktakeSoakExportAudit');
  function fixture(branch = 'clean') {
    const intent = { requestId:'r', actorId:1,actorLabel:'actor', stocktakeId:2, stocktakeNumber:'ST-10',workflowVersion:2,filterHash:'hash',incarnation:'worker',expectedPreGenerationBusy:branch === 'busy' };
    const events = []; let sequence = 0;
    const event = (type,data = {}) => { const value = { incarnation:'worker',sequence:++sequence,atMs:sequence,atEpochMs:1000+sequence,requestId:'r',handler:'exportInventoryStocktake',invocationId:1,streamId:1,type,...data }; events.push(value); return value; };
    event('delivery.call');
    const data = { stocktakeId:2,stocktakeNumber:'ST-10',status:'COUNTING',cancelled:false,varianceStage:'PREVIEW',asOf:1000,workflowVersion:2,exportedRows:100000,truncated:true,truncationReason:'ROW_LIMIT',generationBudgetMs:60000,filterHash:'hash' };
    if (branch !== 'busy') event('generation.return',{ transactionId:1,metadata:data });
    const rows = []; let attemptId = 0;
    const audit = (scope,outcome) => {
      const success = outcome === 'SUCCEEDED';
      const input = { actorUserId:1,actorLabel:scope === 'DOMAIN' ? 'actor':'user:1',action:'inventory.export',targetType:'stocktake',
        ...(scope === 'DOMAIN' ? { targetId:2 }:{}),targetLabel:scope === 'DOMAIN' ? 'stocktake:2':'/api/v1/inventory/stocktakes/:id/export',requestId:'r',correlationId:'r',
        ...(success ? { reasonCategory:'EXPORT',reasonText:'filterHash=hash;truncated=true;reason=ROW_LIMIT;budgetMs=60000',afterSummary:{ stocktakeId:2,rowCount:100000,version:2,status:'COUNTING' } }:{}) };
      const call = event('audit.attempt',{ attemptId:++attemptId,generationTransactionId:branch==='busy'?null:1,scope,outcome,method:success ? 'recordSucceeded':outcome === 'FAILED' ? 'recordFailed':'recordRejected',input });
      event('audit.association',{attemptId,transactionId:attemptId+1,generationTransactionId:branch==='busy'?null:1,association:success?'ORIGINAL_CALLBACK_TRANSACTION':'SYNCHRONOUS_INDEPENDENT_AUDIT_INVOCATION'});
      event('audit.result',{ attemptId,result:success ? 'UNDEFINED':true });
      event('audit.transaction.result',{ attemptId,transactionId:attemptId+1,generationTransactionId:branch==='busy'?null:1,commitObservation:'ORIGINAL_TRANSACTION_FULFILLED' });
      rows.push({ id:20+attemptId,occurred_at:call.atEpochMs,actor_user_id:1,actor_label:input.actorLabel,action:input.action,target_type:'stocktake',target_id:input.targetId ?? null,target_label:input.targetLabel,
        outcome,reason_category:input.reasonCategory ?? '',reason_text:input.reasonText ?? '',before_summary:null,after_summary:input.afterSummary ?? null,operation_request_id:null,request_id:'r',correlation_id:'r',ip:'' });
    };
    if (branch !== 'busy') {
      audit('DOMAIN','SUCCEEDED'); event('prepare.return',{ descriptor:{ asOf:1000,truncated:true,truncationReason:'ROW_LIMIT',generationBudgetMs:60000 } });
      event('stream.pipe',{ responseMatched:true });
      if (branch === 'stream-error') { event('stream.destroy.call',{ errorPresent:true }); event('stream.event',{ event:'error' }); event('stream.destroy.result',{ errorPresent:true }); }
      else { event('stream.event',{ event:'end',readableEnded:true });event('stream.destroy.call',{errorPresent:false}); event('stream.destroy.result',{ errorPresent:false }); }
      event('stream.event',{ event:'close',destroyed:true });
    }
    if (branch === 'clean') event('delivery.return',{ pipe:true });
    else {
      event('delivery.error',{ streamId:branch==='busy'?null:1,pipe:branch !== 'busy',error:{ code:'DISCONNECT' } }); event('auditFailure.call',{ error:{ code:'DISCONNECT' } });
      if (branch === 'busy' || branch === 'stream-error') audit('DOMAIN','FAILED');
      audit('ROUTE','FAILED');event('auditFailure.result');
      if(branch==='busy')event('prepare.error',{error:{code:'INVENTORY_DEPENDENCY_UNAVAILABLE'}});
    }
    return { rows,intents:new Map([['r',intent]]),events };
  }
  for (const branch of ['clean','late','stream-error','busy']) assert.equal(verify(fixture(branch)).status,'COMPLETE');
  for (const change of [
    f => f.rows[0].actor_user_id++, f => f.rows[0].target_id++, f => f.rows[0].request_id = 'foreign', f => f.rows[0].occurred_at = 1,
    f => f.events.find(e => e.type === 'generation.return').metadata.workflowVersion++,
    f => f.events.find(e => e.type === 'generation.return').metadata.stocktakeNumber = 'other',
    f => f.events.find(e => e.type === 'audit.attempt').input.actorUserId++,
    f => f.rows.push({ ...f.rows[0],id:999 }), f => f.rows.length = 0,
    f => f.events.splice(f.events.findIndex(e => e.type === 'stream.pipe'),1),
    f => f.events.find(e => e.type === 'audit.result').result = false,
    f => { const e=f.events.find(e => e.type === 'audit.transaction.result'); e.type='audit.transaction.error'; e.commitObservation='UNKNOWN_COMMIT'; },
    f => { const e={ ...f.events.find(e => e.type === 'audit.attempt'),sequence:f.events.at(-1).sequence+1,attemptId:999 }; f.events.push(e); }
  ]) { const f=fixture(); change(f); assert.throws(() => verify(f)); }
  await check('cycle2 clean delivery rejects source error and contradictory normal destroy evidence',async()=>{
    for(const mutate of [
      f=>f.events.find(event=>event.type==='stream.event'&&event.event==='end').event='error',
      f=>f.events.find(event=>event.type==='stream.destroy.call').errorPresent=true,
      f=>f.events.find(event=>event.type==='stream.destroy.result').errorPresent=true
    ]){const f=fixture();mutate(f);assert.throws(()=>verify(f));}
  });
  await check('cycle2 delivery and dispatcher lifecycle call/result pairs are mandatory and exclusive',async()=>{
    for(const mutate of [
      f=>f.events.splice(f.events.findIndex(event=>event.type==='delivery.call'),1),
      f=>f.events.splice(f.events.findIndex(event=>event.type==='auditFailure.result'),1),
      f=>f.events.find(event=>event.type==='auditFailure.result').type='auditFailure.error',
      f=>f.events.push({...f.events.find(event=>event.type==='auditFailure.result'),type:'auditFailure.error',sequence:f.events.at(-1).sequence+1}),
      f=>f.events.push({...f.events[0],type:'unmatched.lifecycle',sequence:f.events.at(-1).sequence+1})
    ]){const f=fixture('late');mutate(f);assert.throws(()=>verify(f));}
  });
  await check('cycle2 Audit IDs and original callback/generation transaction associations must match',async()=>{
    for(const mutate of [
      f=>{for(const event of f.events)if(event.attemptId!==undefined)event.attemptId=0;},
      f=>{for(const event of f.events)if(event.transactionId!==undefined)event.transactionId='2';},
      f=>f.events.find(event=>event.type==='audit.transaction.result').transactionId=999,
      f=>f.events.find(event=>event.type==='audit.association').association='GUESSED',
      f=>f.events.splice(f.events.findIndex(event=>event.type==='audit.association'),1),
      f=>f.events.find(event=>event.type==='audit.attempt').generationTransactionId=999,
      f=>f.events.push({...f.events.find(event=>event.type==='audit.result'),attemptId:999,sequence:f.events.at(-1).sequence+1})
    ]){const f=fixture();mutate(f);assert.throws(()=>verify(f));}
  });
  const late = fixture('late'); assert.equal(late.rows.length,2); assert.equal(late.rows[1].target_id,null);
  const missing = fixture(); missing.events.splice(missing.events.findIndex(e => e.type === 'audit.transaction.result'),1);
  missing.rows = [];
  assert.equal(verify({ ...missing,live:true }).status,'PENDING'); assert.throws(() => verify(missing));
  const visibleFirst=fixture();visibleFirst.events=visibleFirst.events.filter(event=>event.sequence<=visibleFirst.events.find(value=>value.type==='generation.return').sequence);const pendingRows=verify({...visibleFirst,live:true});assert.equal(pendingRows.status,'PENDING');assert.deepEqual([...pendingRows.ids],[21]);assert.throws(()=>verify(visibleFirst));
});
await check('stream consumer validates actual prefix before scheduled first-byte abort and never calls it complete', async () => {
  const makePlan=load('stocktakeSoakCsvPlan');assert.ok(stocktakeCsvColumns.length>20);
  const common={stocktakeId:2,stocktakeNumber:'ST-10',status:'COUNTING',cancelled:false,varianceStage:'PREVIEW',workflowVersion:2,asOf:1000};
  const scope={...common,recordType:'SCOPE',scopeId:3,binId:801,binCodeSnapshot:'B-001',binCodeCurrent:'B-001'};
  const encode=record=>stocktakeCsvColumns.map(field=>stocktakeCsvExpectedCell(record[field])).join(',')+'\r\n';
  const expected={filterHash:'hash',hashes:[sha(JSON.stringify(stocktakeCsvDigestColumns.map(field=>stocktakeCsvExpectedCell(scope[field])))+'\n')]};
  const fixture={exportHeader:{id:2,version:2,stocktakeNumber:'ST-10'},report:{},workers:[{incarnation:'fake'}],soakExportIntents:new Map()};
  const actor={id:1,worker:0,username:'actor'},row={requestId:'r',intendedAt:0,dispatchAt:0};
  const plan=makePlan(fixture,actor,expected,10,'STEADY');plan.onOffer(row);plan.onDispatch(row);
  const controller=new AbortController();
  const response=new Response(stocktakeCsvColumns.join(',')+'\r\n'+encode(scope),{status:200,headers:{'x-request-id':'r','content-type':'text/csv'}});
  await plan.consume(response,controller.signal,row,error=>controller.abort(error));
  plan.complete({},row);assert.equal(row.outcome,'ABORTED_AFTER_FIRST_BYTE');assert.ok(row.bytes>0);
  assert.equal(fixture.report.exports[0].summary,null);assert.equal(fixture.report.exports[0].rows,1,JSON.stringify(fixture.report.exports[0]));
  const bad=makePlan(fixture,actor,{...expected,hashes:['wrong']},10,'STEADY');
  const wrongRow={...row,requestId:'wrong'};bad.onOffer(wrongRow);bad.onDispatch(wrongRow);
  const signal=new AbortController();
  const badResponse=new Response(stocktakeCsvColumns.join(',')+'\r\n'+encode(scope),{status:200,headers:{'x-request-id':'wrong','content-type':'text/csv'}});
  await assert.rejects(()=>bad.consume(badResponse,signal.signal,wrongRow,error=>signal.abort(error)),/independently ordered expected prefix/);
});
await check('actual streaming adapter settles scheduled abort body and keeps one send without quarantine', async()=>{
  const create=load('createStocktakeSoakLane'),makePlan=load('stocktakeSoakCsvPlan'),now=0;let sends=0;
  const scope={recordType:'SCOPE',stocktakeId:2,stocktakeNumber:'ST-10',status:'COUNTING',cancelled:false,varianceStage:'PREVIEW',workflowVersion:2,asOf:1000,scopeId:3,binId:801,binCodeSnapshot:'B-001',binCodeCurrent:'B-001'};
  const text=stocktakeCsvColumns.join(',')+'\r\n'+stocktakeCsvColumns.map(field=>stocktakeCsvExpectedCell(scope[field])).join(',')+'\r\n';
  const expected={filterHash:'hash',hashes:[sha(JSON.stringify(stocktakeCsvDigestColumns.map(field=>stocktakeCsvExpectedCell(scope[field])))+'\n')]};
  const actor={id:1,worker:0,username:'actor',token:'private',expiresAt:900000},worker={incarnation:'fake',origin:'http://fake',quarantined:false};
  const fixture={exportHeader:{id:2,version:2,stocktakeNumber:'ST-10'},report:{offers:[],requests:[],refreshes:[]},workers:[worker],soakExportIntents:new Map()};
  const lane=create({workers:[worker],actors:[actor],report:fixture.report,epoch:0,clock:()=>now,wallClock:()=>now,
    fetch:async(_url,options)=>{sends++;return new Response(text,{status:200,headers:{'content-type':'text/csv','x-request-id':options.headers['X-Request-ID']}});}});
  const row=lane.offer(actor,0,0,makePlan(fixture,actor,expected,10,'STEADY'));await row.pending;
  assert.equal(row.outcome,'ABORTED_AFTER_FIRST_BYTE');assert.equal(row.resultObservation,'HTTP_RESPONSE_CONSUMED');assert.equal(worker.quarantined,false);
  assert.equal(lane.pending.size,0);assert.equal(lane.busy.size,0);assert.equal(sends,1);assert.equal(fixture.soakExportIntents.size,1);
});
await check('loader wraps only owned export class with inherited static metadata and unchanged constructor/return/error',async()=>{
  const wrap=load('wrapStocktakeSoakHandlerModule');let constructed=0,installed=0,received;
  const service={pending:Promise.resolve('original')},database={withTransaction(work){return Promise.resolve(work({}));}};
  class Original {
    static handlerName='exportInventoryStocktake';static kind='export';static api={path:'/api/v1/inventory/stocktakes/:id/export'};
    constructor(services){constructed++;received=services;this.database=database;this.audit={};this.exports={audit:{}};}
    handle(){return service.pending;}auditFailure(){return service.pending;}
  }
  const other=class {},module={ExportInventoryStocktakeHandler:Original,Other:other};
  assert.equal(wrap({Other:other},{}).Other,other);
  const namespace=wrap(module,{incarnation:'fake',getContext:()=>null,publish(){},installed(){installed++;}});
  assert.equal(namespace.Other,other);assert.equal(module.ExportInventoryStocktakeHandler,Original);
  const Handler=namespace.ExportInventoryStocktakeHandler;
  assert.equal(Handler.handlerName,Original.handlerName);assert.equal(Handler.kind,Original.kind);assert.equal(Handler.api,Original.api);
  const handler=new Handler(service);assert.equal(received,service);assert.equal(constructed,1);assert.equal(installed,1);assert.ok(handler instanceof Original);
  assert.equal(handler.handle({requestId:'first'},{}),service.pending);await service.pending;
  const failure=Object.assign(new Error('original private rejection'),{code:'ORIGINAL_FAILURE'});service.pending=Promise.reject(failure);
  const rejected=handler.handle({requestId:'second'},{});assert.equal(rejected,service.pending);await assert.rejects(rejected,error=>error===failure);
});
await check('cycle2 replay receipt remains bound to its dispatched offer across later busy offers',async()=>{
  const make=load('stocktakeSoakWriterPlan'),result={id:2,operationId:3,status:'POSTED',version:4,rowCount:500};
  const receipt={requestId:'original',replays:[]},state={stage:'replay',header:result,round:0,startedAt:0,candidateIndex:0,candidates:[{route:'/candidate',expected:{}}],replay:{body:{source:{}},result,receipt}};
  const fixture={soakScopes:new Map([[1,{warehouseId:1,binIds:[20]}]]),report:{workflows:[]}},actor={id:1};
  const first=make(fixture,actor,state,'STEADY');first.onOffer({requestId:'sent'});first.onDispatch({requestId:'sent',dispatchAt:1});
  const later=make(fixture,actor,state,'STEADY');later.onOffer({requestId:'not-sent-busy'});
  first.complete({data:result},{requestId:'sent'});
  assert.equal(receipt.replays[0].result,result);assert.equal(receipt.replays[1].result,undefined);assert.equal(receipt.replays[1].dispatchAt,undefined);
});
await check('cycle2 final intended worker turn cannot actually dispatch beyond steady even below tick lateness',async()=>{
  const create=load('createStocktakeSoakLane'),now=1800027.5;let sends=0;
  const actor={id:1,worker:0,writer:true,token:'private',expiresAt:9000000},report={offers:[],requests:[],refreshes:[]};
  const lane=create({workers:[{origin:'http://fake',incarnation:'fake'}],actors:[actor],report,epoch:0,clock:()=>now,wallClock:()=>now,
    fetch:()=>{sends++;return Promise.resolve({status:200,headers:{get:()=>null},json:async()=>({data:{}})});}});
  const row=lane.offer(actor,1439,1799937.5,{phase:'STEADY',family:'QUERY',route:'/query',candidate:{route:'/query'}});if(row.pending)await row.pending;
  assert.equal(sends,0);assert.equal(row.dispatchAt,null);assert.equal(row.outcome,'NOT_SENT_LATE');assert.equal(row.notSentReason,'STEADY_WINDOW_CLOSED');assert.equal(report.offers.length,1);
});
await check('cycle2 actual body completion is recorded before callbacks and drain completions cannot satisfy query minima',async()=>{
  const create=load('createStocktakeSoakLane');let now=1799990;
  const actor={id:1,worker:0,writer:true,token:'private',expiresAt:9000000},report={offers:[],requests:[],refreshes:[]};
  const lane=create({workers:[{origin:'http://fake',incarnation:'fake'}],actors:[actor],report,epoch:0,clock:()=>now,wallClock:()=>now,
    fetch:()=>Promise.resolve({status:200,headers:{get:()=>null},json:async()=>{now=1800001;return {data:{}};}})});
  let observed;
  const plan={phase:'STEADY',family:'QUERY',route:'/query',complete(_value,offer){observed=offer.responseCompleteAt;}};plan.candidate=plan;
  const row=lane.offer(actor,1439,now,plan);await row.pending;
  assert.equal(observed,1800001);assert.equal(row.responseCompleteAt,1800001);
  const select=load('stocktakeSoakSteadyQueries');const all=[...Array.from({length:119},()=>({phase:'STEADY',responseCompleteAt:1799999})),{phase:'STEADY',responseCompleteAt:1800001}];
  assert.equal(select(all,1800000).length,119);assert.ok(select(all,1800000).length<120);assert.equal(select(all.slice(20),1800000).length,99);
});
await check('cycle2 observer capture failure forwards Symbol/getter errors and original synchronous failures unchanged',async()=>{
  const install=load('installStocktakeSoakExportObserver');
  for(const kind of ['symbol','getter','flags']){
    const stream=new EventEmitter();let destroys=0,emissions=0,failures=0,callbackError;
    stream.readableEnded=false;stream.destroyed=false;stream.pipe=destination=>destination;
    stream._destroy=(error,callback)=>{destroys++;callback(error);return 'original-destroy-return';};
    stream.on('error',error=>{emissions++;assert.equal(error,bad);});
    const original=Promise.resolve();const handler={database:{withTransaction(){return original;}},audit:{},exports:{audit:{},prepare(){return Promise.resolve({stream});}},handle(){return original;},auditFailure(){failures++;return original;}};
    const observer=install(handler,{incarnation:'fake',getContext:()=>({requestId:'r'}),publish(){}});
    const req={requestId:'r'};await handler.handle(req,{});await handler.exports.prepare({requestId:'r'});
    const bad={name:'Error'};if(kind==='symbol')bad.code=Symbol('unsafe');else if(kind==='getter')Object.defineProperty(bad,'code',{get(){throw new Error('getter-failure');}});else Object.defineProperty(stream,'destroyed',{get(){throw new Error('flag-failure');}});
    assert.doesNotThrow(()=>assert.equal(stream._destroy(bad,error=>{callbackError=error;}),'original-destroy-return'));
    assert.equal(destroys,1);assert.equal(callbackError,bad);
    assert.doesNotThrow(()=>stream.emit('error',bad));assert.equal(emissions,1);
    assert.equal(handler.auditFailure(req,bad),original);assert.equal(failures,1);
    assert.equal(observer.report().status,'INCOMPLETE');
  }
  const failure=Object.defineProperty(new Error('original'), 'code',{get(){throw new Error('capture-only');}});
  const handler={database:{withTransaction(){}},audit:{},exports:{audit:{}},handle(){throw failure;},auditFailure(){}};
  const observer=install(handler,{incarnation:'fake',getContext:()=>null,publish(){}});
  assert.throws(()=>handler.handle({requestId:'r'},{}),error=>error===failure);assert.equal(observer.report().status,'INCOMPLETE');
});
await check('cycle2 actual observer emits original Audit association and generation transaction linkage accepted by actual verifier',async()=>{
  const install=load('installStocktakeSoakExportObserver'),verify=load('verifyStocktakeSoakExportAudit'),events=[],rows=[];
  const requestId='actual-helper-r',intent={requestId,actorId:1,actorLabel:'actor',stocktakeId:2,stocktakeNumber:'ST-10',workflowVersion:2,filterHash:'hash',incarnation:'worker',expectedPreGenerationBusy:false};
  const metadata={stocktakeId:2,stocktakeNumber:'ST-10',status:'COUNTING',cancelled:false,varianceStage:'PREVIEW',asOf:1000,workflowVersion:2,exportedRows:100000,truncated:true,truncationReason:'ROW_LIMIT',generationBudgetMs:60000,filterHash:'hash'};
  const tx={},database={withTransaction(work){return Promise.resolve().then(()=>work.call(this,tx));}},readerDb={withTransaction(work){return Promise.resolve().then(()=>work.call(this,{}));}};
  const stream=new EventEmitter();stream.readableEnded=false;stream.destroyed=false;stream.pipe=destination=>destination;stream._destroy=(error,callback)=>callback(error);
  const response={finished:false,destroyed:false,headersSent:false};
  const audit={recordSucceeded(connection,input){assert.equal(connection,tx);rows.push({id:10,occurred_at:Date.now(),actor_user_id:input.actorUserId,actor_label:input.actorLabel,action:input.action,target_type:input.targetType,target_id:input.targetId,target_label:input.targetLabel,outcome:'SUCCEEDED',reason_category:input.reasonCategory,reason_text:input.reasonText,before_summary:null,after_summary:input.afterSummary,operation_request_id:null,request_id:requestId,correlation_id:requestId,ip:''});return Promise.resolve();},recordFailed(){return Promise.resolve(true);},recordRejected(){return Promise.resolve(true);}};
  const exports={audit,createGenerationReader(){return {database:readerDb,initialize(){return Promise.resolve(readerDb);}};},
    async prepare(){const reader=this.createGenerationReader();await reader.initialize();await reader.database.withTransaction(()=>metadata);
      await database.withTransaction(connection=>this.audit.recordSucceeded(connection,{actorUserId:1,actorLabel:'actor',action:'inventory.export',targetType:'stocktake',targetId:2,targetLabel:'stocktake:2',reasonCategory:'EXPORT',reasonText:'filterHash=hash;truncated=true;reason=ROW_LIMIT;budgetMs=60000',afterSummary:{stocktakeId:2,rowCount:100000,version:2,status:'COUNTING'},requestId,correlationId:requestId}));
      return {stream,asOf:1000,truncated:true,truncationReason:'ROW_LIMIT',generationBudgetMs:60000};}};
  const handler={database,exports,audit:{recordFailed(){return Promise.resolve(true);},recordRejected(){return Promise.resolve(true);}},async handle(req,res){const value=await this.exports.prepare({requestId:req.requestId});value.stream.pipe(res);stream.readableEnded=true;stream.emit('end');stream.destroyed=true;stream._destroy(null,()=>{});stream.emit('close');res.finished=true;},auditFailure(){return Promise.resolve();}};
  const observer=install(handler,{incarnation:'worker',getContext:()=>({requestId}),publish:event=>events.push(event)});
  await handler.handle({requestId},response);await Promise.resolve();
  const generation=events.find(event=>event.type==='generation.return'),attempt=events.find(event=>event.type==='audit.attempt'),association=events.find(event=>event.type==='audit.association'),commit=events.find(event=>event.type==='audit.transaction.result');
  assert.ok(association);assert.equal(attempt.generationTransactionId,generation.transactionId);assert.equal(association.transactionId,commit.transactionId);assert.notEqual(association.transactionId,generation.transactionId);
  assert.equal(observer.report().status,'COMPLETE');assert.equal(verify({rows,intents:new Map([[requestId,intent]]),events}).status,'COMPLETE');
});
await check('cycle3 observer entry and finally clock failures preserve original Promise and synchronous error',async()=>{
  const install=load('installStocktakeSoakExportObserver');
  for(const mode of ['entry','finally','epoch']){
    let reads=0,calls=0;const original=Promise.resolve('original'),clockError=new Error('observation-clock-only');
    const handler={database:{withTransaction(){return original;}},audit:{},exports:{audit:{}},handle(){calls++;return original;},auditFailure(){return original;}};
    const observer=install(handler,{incarnation:'fake',getContext:()=>null,publish(){},now(){reads++;if(mode==='entry'||(mode==='finally'&&reads===2))throw clockError;return 1;},epochNow(){if(mode==='epoch')throw clockError;return 1000;}});
    const returned=handler.handle({requestId:'r'},{});assert.equal(returned,original);assert.equal(calls,1);await returned;await Promise.resolve();
    assert.equal(observer.report().status,'INCOMPLETE');assert.ok(observer.report().metrics.captureFailures>0);
  }
  const originalError=new Error('original synchronous failure'),handler={database:{withTransaction(){}},audit:{},exports:{audit:{}},handle(){throw originalError;},auditFailure(){}};
  const observer=install(handler,{incarnation:'fake',getContext:()=>null,publish(){},now(){throw new Error('observation-clock-only');}});
  assert.throws(()=>handler.handle({requestId:'r'},{}),error=>error===originalError);assert.equal(observer.report().status,'INCOMPLETE');
});
await check('cycle3 settlement clock failures preserve original fulfillment/rejection without discarded Promise rejection',async()=>{
  const install=load('installStocktakeSoakExportObserver');
  for(const outcome of ['fulfilled','rejected']){
    const work=defer(),originalError=new Error('original async failure'),order=[],unhandled=[];let broken=false;
    const listener=error=>unhandled.push(error);process.on('unhandledRejection',listener);
    try{
      const handler={database:{withTransaction(){return work.promise;}},audit:{},exports:{audit:{}},handle(){order.push('original-handle');return work.promise;},auditFailure(){return work.promise;}};
      const observer=install(handler,{incarnation:'fake',getContext:()=>null,publish(){},now(){if(broken)throw new Error('settlement-clock-only');return 1;}});
      const returned=handler.handle({requestId:'r'},{});assert.equal(returned,work.promise);broken=true;order.push('original-settle');
      if(outcome==='fulfilled'){work.resolve('original-value');assert.equal(await returned,'original-value');order.push('caller-value');}
      else{work.reject(originalError);await assert.rejects(returned,error=>error===originalError);order.push('caller-error');}
      await new Promise(resolve=>{globalThis.setImmediate(resolve);});
      assert.deepEqual(order,['original-handle','original-settle',outcome==='fulfilled'?'caller-value':'caller-error']);
      assert.equal(unhandled.length,0,'Observation timing must not reject discarded settlement observer Promises');assert.equal(observer.report().status,'INCOMPLETE');
    }finally{process.removeListener('unhandledRejection',listener);}
  }
});
await check('cycle3 destroy timing failures retain original callback receiver arguments order and method return',async()=>{
  const install=load('installStocktakeSoakExportObserver');const stream=new EventEmitter(),order=[],callbackReceiver={},originalError=new Error('original destroy error');let broken=false;
  stream.readableEnded=false;stream.destroyed=false;stream.pipe=destination=>destination;
  stream._destroy=function(error,callback){assert.equal(this,stream);assert.equal(error,originalError);order.push('original-destroy');callback.call(callbackReceiver,error,'original-argument');return 'original-return';};
  const original=Promise.resolve(),handler={database:{withTransaction(){return original;}},audit:{},exports:{audit:{},prepare(){return Promise.resolve({stream});}},handle(){return original;},auditFailure(){return original;}};
  const observer=install(handler,{incarnation:'fake',getContext:()=>null,publish(){},now(){if(broken)throw new Error('callback-clock-only');return 1;}});
  await handler.handle({requestId:'r'},{});await handler.exports.prepare({requestId:'r'});broken=true;
  const returned=stream._destroy(originalError,function(error,argument){assert.equal(this,callbackReceiver);assert.equal(error,originalError);assert.equal(argument,'original-argument');order.push('original-callback');});
  assert.equal(returned,'original-return');assert.deepEqual(order,['original-destroy','original-callback']);assert.equal(observer.report().status,'INCOMPLETE');
});
// Preparation probes execute the actual closure and real lane with synthetic timers/HTTP only.
const preparationStart=source.indexOf('    const nextSetupDispatch=[0,0];'),preparationEnd=source.indexOf('\n    async function checkpoint()',preparationStart);
assert.ok(preparationStart>=0&&preparationEnd>preparationStart,'Missing actual prepareRequest closure');
const preparationSource=source.slice(preparationStart,preparationEnd);
function preparationHarness({at=1000,wake,sign}={}){
  const state={now:at,waits:[],signs:[],sends:[]},workers=[0,1].map(worker=>({origin:`http://synthetic-${worker}`,incarnation:`synthetic-${worker}`}));
  const actors=workers.map((_,worker)=>({id:worker+1,worker,writer:false,token:'synthetic',expiresAt:1e9,device:{async headers(){state.signs.push(state.now);await sign?.(state);return {};}}}));
  const report={offers:[],requests:[],refreshes:[],soakPreparation:[]},fixture={},create=load('createStocktakeSoakLane');
  const options={workers,actors,report,epoch:2700000,clock:()=>state.now,wallClock:()=>state.now,fetch:async(_url,options)=>{
    state.sends.push(state.now);return {status:200,headers:{get:name=>name==='x-request-id'?options.headers['X-Request-ID']:null},json:async()=>({data:{ok:true}})};
  }};
  const lane=create(options),prepare=runInNewContext(`${preparationSource}\nfixture.prepareRequest;`,{
    assert,workers,report,fixture,preparedLane:lane,performance:{now:()=>state.now},Date,
    oracle:{register(){assert.fail('Timing probes have no business intent');}},setTimeout:async delay=>{
      const event={at:state.now,delay};state.waits.push(event);assert.ok(state.waits.length<50,'Preparation must make clock progress');
      if(wake)await wake(state,workers,event);else state.now+=Math.max(1,Math.ceil(delay));
    }
  });
  return {state,workers,actors,report,lane,makeLane:()=>create(options),prepare:(worker=0,signed=false,phase='SETUP')=>prepare(actors[worker],'/synthetic',{},signed,null,phase)};
}
await check('preparation rechecks a fractional early wake before its single new offer and actual send',async()=>{
  let early=true;const h=preparationHarness({at:142412.235083,wake(state,_workers,event){if(early){early=false;state.now=142536.760708;}else state.now+=Math.max(1,Math.ceil(event.delay));}});
  await h.prepare();h.state.now=142536.12275;await h.prepare();
  assert.ok(h.state.waits.length>=2);assert.equal(h.report.offers.length,2);assert.equal(h.state.sends.length,2);
  assert.ok(h.state.sends[1]>=142537.235083);assert.ok(h.report.offers.every(row=>row.outcome==='COMPLETE'));
});
await check('preparation cleanup honors the shared latest dispatch after the steady lane advanced',async()=>{
  const h=preparationHarness();await h.prepare();h.state.now=5000;
  const steady=h.makeLane().offer(h.actors[0],0,h.state.now,{family:'QUERY',route:'/synthetic-steady',body:{}});await steady.pending;
  assert.equal(steady.outcome,'COMPLETE');h.state.now=5001;await h.prepare(0,false,'CLEANUP');
  assert.equal(h.state.sends.length,3);assert.ok(h.state.sends[2]>=5125);assert.equal(h.report.offers.length,3);
});
await check('preparation rechecks a shared dispatch that advances during its wait before signing',async()=>{
  let changed=false;const h=preparationHarness({wake(state,workers,event){state.now+=Math.max(1,Math.ceil(event.delay));if(!changed){changed=true;workers[0].soakLastDispatchAt=state.now-25;}}});
  await h.prepare();h.state.now=1001;await h.prepare(0,true);
  assert.equal(h.state.sends.length,2);assert.ok(h.state.signs[0]>=1225);assert.ok(h.state.sends[1]>=1225);assert.equal(h.report.offers.length,2);
});
await check('preparation workers remain independent while one worker waits for its boundary',async()=>{
  const release=defer(),started=defer(),h=preparationHarness({async wake(state,_workers,event){started.resolve();await release.promise;state.now=event.at+Math.ceil(event.delay);}});
  await h.prepare();h.state.now=1001;const zero=h.prepare();await started.promise;
  try{await h.prepare(1);assert.equal(h.state.sends.length,2);assert.equal(h.state.sends[1],1001);}finally{release.resolve();await zero;}
  assert.equal(h.state.sends.length,3);assert.ok(h.state.sends[2]>=1125);assert.equal(h.report.offers.length,3);
});
await check('preparation signing starts after the early timer wake is rechecked without offer retry',async()=>{
  let early=true;const h=preparationHarness({wake(state,_workers,event){if(early){early=false;state.now=1124.75;}else state.now+=Math.max(1,Math.ceil(event.delay));}});
  await h.prepare();h.state.now=1001;await h.prepare(0,true);
  assert.equal(h.state.signs.length,1);assert.ok(h.state.signs[0]>=1125);assert.equal(h.state.sends.length,2);assert.equal(h.report.offers.length,2);
});
await check('preparation retains the real post-sign tick guard without HTTP or hidden retry',async()=>{
  const h=preparationHarness({sign(state){state.now+=125;}});await assert.rejects(()=>h.prepare(0,true),error=>error.code==='ERR_ASSERTION');
  assert.equal(h.state.signs.length,1);assert.equal(h.state.sends.length,0);assert.equal(h.report.offers.length,1);
  assert.equal(h.report.offers[0].outcome,'NOT_SENT_LATE');assert.equal(h.report.offers[0].notSentReason,'TICK_EXPIRED');
});
await check('preparation retains the direct offer rate gate before signing and actual HTTP',async()=>{
  const h=preparationHarness();await h.prepare();h.state.now=1124.999;
  const row=h.lane.offer(h.actors[0],0,h.state.now,{family:'PREPARATION',phase:'SETUP',route:'/synthetic',body:{},signed:true});
  assert.equal(row.outcome,'NOT_SENT_RATE');assert.equal(row.notSentReason,'ACTUAL_DISPATCH_SPACING');
  assert.equal(h.state.signs.length,0);assert.equal(h.state.sends.length,1);assert.equal(h.report.offers.length,2);
});
await check('preparation quarantine while waiting prevents a new offer signing and actual HTTP',async()=>{
  const h=preparationHarness({wake(state,workers,event){state.now+=Math.ceil(event.delay);workers[0].quarantined=true;}});
  await h.prepare();h.state.now=1001;await assert.rejects(()=>h.prepare(0,true),error=>error.code==='ERR_ASSERTION'&&/quarantined/u.test(error.message));
  assert.equal(h.state.signs.length,0);assert.equal(h.state.sends.length,1);assert.equal(h.report.offers.length,1);
});
// These synthetic checks exercise the actual Audit matcher without SQL or a native/capacity claim.
const auditOracleAt=source.indexOf('export function createStocktakeSoakOracle(');
const auditUnionAt=source.indexOf(' row union`',auditOracleAt),auditClose=source.indexOf('\n    }\n',auditUnionAt);
const auditMatchEnd=source.indexOf('    return {headers,scopes,lines,locks,reservations,effects,controls,movements,exportRows};',auditClose);
assert.ok(auditOracleAt>=0&&auditUnionAt>=0&&auditClose>=0&&auditMatchEnd>auditClose,'Missing actual command Audit matcher');
const auditMatchSource=source.slice(auditClose+'\n    }\n'.length,auditMatchEnd);
const auditDependency=name=>{const at=source.indexOf(`const ${name}=`,auditOracleAt);assert.ok(at>=0,`Missing actual Audit ${name}`);return source.slice(at,source.indexOf('\n',at));};
function auditMatch(audits,actual){
  const metrics={work:0};
  const instrumentation=`
    const splice=Array.prototype.splice,shift=Array.prototype.shift,findIndex=Array.prototype.findIndex;
    Array.prototype.splice=function(start,count,...items){metrics.work+=Math.max(0,this.length-start-count);return splice.call(this,start,count,...items);};
    Array.prototype.shift=function(){metrics.work+=Math.max(0,this.length-1);return shift.call(this);};
    Array.prototype.findIndex=function(fn){return findIndex.call(this,(...args)=>{metrics.work++;return fn(...args);});};
    for(const method of ['get','set','has']){const original=Map.prototype[method];Map.prototype[method]=function(...args){metrics.work++;return original.apply(this,args);};}
  `;
  const dependencies=['parse','positive','when'].map(auditDependency).join('\n');
  const key=auditDependency('jsonKey').replace('const jsonKey=','const rawJsonKey=')+'\nconst jsonKey=value=>{metrics.work++;return rawJsonKey(value);};';
  const exports=runInNewContext(`${instrumentation}\n${section('stocktakeSoakAssertRow')}\n${dependencies}\n${key}\n(()=>{${auditMatchSource}\nreturn exportRows;})()`,{assert,audits,rows:{inventory_audit_logs:actual},metrics,snapshotEpoch:2000});
  return {exportRows:structuredClone(exports),work:metrics.work};
}
const auditExpected=(index,duplicate=false)=>({operationId:duplicate?1:index+1,action:'stocktake.cancel',before:{status:'COUNTING',nested:{a:1,z:2}},after:{status:'CANCELLED',version:2},targetId:11,targetLabel:'ST-11',reason:'reason',record:{actorId:7,actorLabel:'Actor 7',family:'STOCKTAKE',requestId:'request-7',dispatchEpoch:1000,completeEpoch:2000}});
const auditActual=(item,index)=>({id:index+101,occurred_at:1500,actor_user_id:item.record.actorId,actor_label:item.record.actorLabel,action:item.action,target_type:'stocktake',target_id:item.targetId,target_label:item.targetLabel,outcome:'SUCCEEDED',reason_category:'',reason_text:item.reason,before_summary:structuredClone(item.before),after_summary:structuredClone(item.after),operation_request_id:item.operationId,request_id:item.record.requestId,correlation_id:item.record.requestId,ip:''});
await check('command Audit FIFO preserves duplicate order canonical JSON null and export rows',async()=>{
  const first=auditExpected(0,true),second=structuredClone(first);second.record.actorId=8;second.record.actorLabel='Actor 8';
  const rows=[auditActual(first,0),auditActual(second,1)],exportRow={id:999,operation_request_id:null};rows.splice(1,0,exportRow);
  rows[0].before_summary=JSON.stringify({nested:{z:2,a:1},status:'COUNTING'});rows[0].after_summary=JSON.stringify({version:2,status:'CANCELLED'});rows[0].operation_request_id='1';
  assert.deepEqual(auditMatch([first,second],rows).exportRows,[exportRow]);
  assert.throws(()=>auditMatch([first,second],[auditActual(second,0),auditActual(first,1)]),/Audit:101.actor_user_id/u);
  const broken=auditActual(first,0);broken.actor_user_id=99;broken.target_id=999;
  assert.throws(()=>auditMatch([first,second],[broken,auditActual(second,1)]),/Audit:101.actor_user_id/u);
  first.before=null;const nullable=auditActual(first,0);nullable.before_summary='null';auditMatch([first],[nullable]);
  nullable.before_summary={};assert.throws(()=>auditMatch([first],[nullable]),/Unexpected or duplicate command Audit/u);
});
for(const field of ['before','after'])await check(`command Audit distinguishes ${field}-only object summaries within one operation and action`,async()=>{
  const first=auditExpected(0,true),second=structuredClone(first);second[field]={...second[field],status:'DISTINCT'};
  auditMatch([first,second],[auditActual(second,1),auditActual(first,0)]);
});
await check('command Audit retains every full-field assertion and exact row union',async()=>{
  const item=auditExpected(0),row=auditActual(item,0);
  for(const field of Object.keys(row)){
    const broken=structuredClone(row);broken[field]=typeof broken[field]==='number'?0:typeof broken[field]==='object'?{}:'foreign';
    assert.throws(()=>auditMatch([item],[broken]),error=>error.code==='ERR_ASSERTION',`Audit ${field} must be checked`);
  }
  const extra={...row,foreign_column:true},missing={...row};delete missing.ip;
  for(const broken of [extra,missing])assert.throws(()=>auditMatch([item],[broken]),/exact columns/u);
  assert.throws(()=>auditMatch([item],[row,{...row,id:102}]),/Unexpected or duplicate command Audit/u);
  assert.throws(()=>auditMatch([item],[]),/Every expected command Audit persisted exactly once/u);
});
await check('command Audit deterministic comparison and array-slot work stays linear including duplicate queues',async()=>{
  for(const layout of ['first','reverse','duplicates'])for(const count of [100,200,500]){
    const audits=Array.from({length:count},(_,index)=>auditExpected(index,layout==='duplicates')),rows=audits.map(auditActual);if(layout==='reverse')rows.reverse();
    const {work}=auditMatch(audits,rows);assert.ok(work<=12*count+32,`${layout}/${count}: ${work} work exceeds linear bound; supporting only, not native/capacity PASS`);
  }
});
  const result = {provenance:'SUPPORTING_NOT_NATIVE',helperPath,helperSha256:sha(source),supportSha256:sha(verifyStocktakeSoakSupportingExamples.toString()),nativeSoak:'NOT_RUN',cases,pass:cases.filter(row=>row.status==='PASS').length,fail:cases.filter(row=>row.status==='FAIL').length};
  if(result.fail){const error=new assert.AssertionError({message:'CS01 deterministic supporting checks failed',actual:result.fail,expected:0});error.supportingResult=result;throw error;}
  return result;
}

const enabled=process.env.DB_INTEGRATION_TESTS==='1'&&process.env.INVENTORY_STOCKTAKE_CHARACTERIZATION_TESTS==='1';
test('ST041-CS01 fresh full-capacity thirty-minute fixed-offer Stocktake resource soak',{skip:!enabled,timeout:2700000},async()=>{
  const helperUrl=new URL('../../test-support/inventoryStocktakePerformanceChild.js',import.meta.url);
  const helperSource=await readFile(helperUrl,'utf8');
  let supporting;
  try { supporting=await verifyStocktakeSoakSupportingExamples(helperSource,helperUrl.pathname); }
  catch(error) {
    if(process.env.HARNESS_RUN_DIR) {
      try { const diagnostic={kind:'CS01_SUPPORTING_PREFLIGHT_FAILURE',nativeSoak:'NOT_RUN',
        helperSha256:createHash('sha256').update(helperSource).digest('hex'),
        testSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
        error:{name:error.name,code:error.code??null,actual:error.actual,expected:error.expected},supporting:error.supportingResult??null,supportingExecution:error.supportingResult?'COMPLETED':'INCOMPLETE'};
      await writeFile(process.env.HARNESS_RUN_DIR+'/stocktake-resource-soak-supporting.json',JSON.stringify(diagnostic,null,2)+'\n',{flag:'wx',mode:0o600}); }
      catch(writeError) { error.supportingEvidenceError={name:writeError.name,code:writeError.code??null}; }
    }
    throw error;
  }
  const {createPerformanceFixture,runStocktakeResourceSoak,createStocktakeSoakProgressJournal}=await import(helperUrl);
  const journal=await createStocktakeSoakProgressJournal({runDir:process.env.HARNESS_RUN_DIR,helperSha256:createHash('sha256').update(helperSource).digest('hex'),testSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')});
  let fixture,primary;
  try{
    journal.checkpoint('FIXTURE','START');
    fixture=await createPerformanceFixture({mode:'CS01',cs01Journal:journal});fixture.report.supportingChecks=supporting;
    journal.checkpoint('FIXTURE','END');
    const observed=await runStocktakeResourceSoak(fixture);
    assert.equal(observed.status,'COMPLETE');assert.ok(observed.steadyStoppedAt-observed.steadyStartedAt>=1800000);
    assert.equal(fixture.report.performanceAcceptance,'NOT_EVALUATED_PENDING_APPROVED_NUMERIC_GATE');assert.equal(fixture.report.task041,'IN_PROGRESS');assert.equal(fixture.report.p4,'NOT_READY');
  }catch(error){primary=error;journal.checkpoint('OUTER_ORIGINAL_ERROR','ERROR',{originalError:primary});}
  finally{
    journal.checkpoint('PRE_CLOSE','CHECKPOINT',{originalError:primary});await journal.flush();
    try{await fixture?.close();}catch(error){if(primary)primary.cs01CleanupError={code:error.code??'UNKNOWN',name:error.name};else primary=error;}
    finally{journal.checkpoint('TERMINAL','TERMINAL',{originalError:primary,originalOutcome:primary?'THREW':'RETURNED'});await journal.close();}
  }
  if(primary)throw primary;
});
