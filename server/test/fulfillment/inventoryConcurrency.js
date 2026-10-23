import assert from "node:assert/strict";

export function gate() {
  let release;
  const promise=new Promise(resolve=>{release=resolve;});
  return {promise,release};
}

export async function assertOwnedOperationWait(f,connectionId) {
  const deadline=performance.now()+3000;
  while (performance.now()<deadline) {
    const [[row]]=await f.db.query(`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w
      JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
      JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID
      WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='inventory_operation_requests' AND t.PROCESSLIST_ID=?`,[f.name,connectionId]);
    if (Number(row.n)>0) return;
    await new Promise(resolve=>{setImmediate(resolve);});
  }
  assert.fail("the owned connection must wait on this fixture's Inventory operation row");
}
