export const INVENTORY_FAILURE_POINTS = Object.freeze([
  "operation",
  "current_state",
  "movement",
  "audit",
  "commit"
]);

const FAILURE_POINTS = new Set(INVENTORY_FAILURE_POINTS);

export function createFakeInventoryDatabase({
  initialState = {},
  failAt = null,
  query = async () => [[]],
  execute = async () => [{ affectedRows: 1 }]
} = {}) {
  if (failAt !== null && !FAILURE_POINTS.has(failAt)) {
    throw new TypeError(`Unknown Inventory failure point: ${failAt}`);
  }
  let committed = structuredClone(initialState);
  const calls = [];

  function checkpoint(point) {
    if (!FAILURE_POINTS.has(point)) throw new TypeError(`Unknown Inventory failure point: ${point}`);
    if (point === failAt) {
      const error = new Error(`Injected Inventory failure at ${point}`);
      error.faultPoint = point;
      throw error;
    }
  }

  return {
    calls,
    get state() { return structuredClone(committed); },
    async withTransaction(work) {
      if (typeof work !== "function") throw new TypeError("Inventory fake transaction work must be a function");
      const draft = structuredClone(committed);
      const transaction = {
        state: draft,
        checkpoint,
        async query(sql, params = []) {
          calls.push({ method: "query", sql: String(sql), params });
          return query({ sql: String(sql), params, state: draft });
        },
        async execute(sql, params = []) {
          calls.push({ method: "execute", sql: String(sql), params });
          return execute({ sql: String(sql), params, state: draft });
        }
      };
      const result = await work(transaction);
      checkpoint("commit");
      committed = draft;
      return result;
    }
  };
}

export function createInventoryBarrier(parties = 2) {
  if (!Number.isSafeInteger(parties) || parties < 2) {
    throw new TypeError("Inventory barrier requires at least two parties");
  }
  let arrivals = 0;
  let released = false;
  let release;
  const promise = new Promise((resolve) => { release = resolve; });

  return {
    async wait() {
      if (released) throw new Error("Inventory barrier already released");
      arrivals += 1;
      if (arrivals === parties) {
        released = true;
        release();
      }
      return promise;
    }
  };
}
