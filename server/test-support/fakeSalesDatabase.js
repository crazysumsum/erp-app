// Test-only transactional state; native locking/uniqueness remains a MySQL CI concern.
export function createFakeSalesDatabase({ initialState = {}, query = async () => [[]],
  execute = async () => [{ affectedRows: 1 }], failCommit = false } = {}) {
  let committed = structuredClone(initialState);
  return {
    get state() { return structuredClone(committed); },
    async withTransaction(work) {
      const state = structuredClone(committed);
      const transaction = {
        state,
        query: (sql, params = []) => query({ sql, params, state }),
        execute: (sql, params = []) => execute({ sql, params, state })
      };
      const result = await work(transaction);
      if (failCommit) throw new Error("Injected Sales commit failure");
      committed = state;
      return result;
    }
  };
}
