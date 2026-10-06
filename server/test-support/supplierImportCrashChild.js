/**
 * TASK-045 fault injection：一個真 worker process。
 *
 *   node --import ./test-support/testEnv.js test-support/supplierImportCrashChild.js <before|after|run> <importRoot> <logRoot>
 *
 * - before：真 applyRow 寫完 Supplier（未 commit）就 SIGKILL 自己 —— MySQL 見 connection 斷咗會 rollback。
 * - after：第一列 commit 咗、未做下一列就 SIGKILL 自己。
 * - run：照常執行（用 caller 俾嘅環境，例如好短嘅 DB timeout），將拋出嘅錯誤 code 以 JSON 印出嚟。
 * 放喺 test-support 而唔係 test/：`node --test` 會將 test/ 下面所有 .js 當測試跑。
 */
import path from "node:path";

const [point, importRoot, logRoot] = process.argv.slice(2);
const { createApplication } = await import("../src/framework/application/createApplication.js");
const { defaultConfigurationSource } = await import("../src/framework/configuration/applicationConfiguration.js");
const { SUPPLIER_IMPORT_JOB_NAMES } = await import("../src/services/supplierImport/supplierImportFiles.js");
const source = defaultConfigurationSource();
const application = await createApplication({
  configurationSource: { ...source, application: { ...source.application, port: 0 },
    scheduler: { ...source.scheduler, jobs: { ...source.scheduler.jobs,
      [SUPPLIER_IMPORT_JOB_NAMES.precheck]: { enabled: false }, [SUPPLIER_IMPORT_JOB_NAMES.worker]: { enabled: false } } },
    supplier: { ...source.supplier, import: { ...source.supplier.import, root: importRoot } },
    logging: { loggers: {
      request: { ...source.logging.loggers.request, directory: path.join(logRoot, "requests") },
      system: { ...source.logging.loggers.system, directory: path.join(logRoot, "system") } } } }
});
const worker = application.services.require("job.supplierImportWorker");
const die = () => {
  process.kill(process.pid, "SIGKILL");
  return new Promise(() => {});
};
if (point === "run") {
  const outcome = await worker.runExecution(new AbortController().signal)
    .then((result) => ({ status: result.status }), (error) => ({ code: error?.code ?? null, causeCode: error?.cause?.code ?? null }));
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  process.exit(0);
}
if (point === "before") {
  const real = worker.applyRow;
  worker.applyRow = async (connection, context) => {
    await real(connection, context);
    return die();
  };
} else {
  const service = worker.importService;
  const original = service.processNextRow.bind(service);
  service.processNextRow = async (input) => {
    const result = await original(input);
    return result?.status === "applied" ? die() : result;
  };
}
await worker.runExecution(new AbortController().signal);
process.exit(3); // 唔應該行到呢度：冇列可以做
