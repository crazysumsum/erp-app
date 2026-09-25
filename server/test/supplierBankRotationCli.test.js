/**
 * `parseArguments` —— operator 唯一接觸得到嗰個面。
 *
 * 呢個檔案係 REV-053 M-4 嘅結果：`supplierBankRotationCli.js` 整份 export 出嚟，
 * 但成個 `server/test` 冇一個檔案 import 過佢。即係旗解析、exit code 合約、進度
 * 列印 —— 全部淨係靠實作報告入面一次手動 run 撐住，而 REV-052 M-1（一個從來冇
 * 驗證過嘅 `--from`）正正就係住喺呢一片無人測嘅面上。
 *
 * `parseArguments` 係純函數，收一個 array，所以呢度唔使任何 harness。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { ROTATION_KINDS } from "../src/modules/supplier/bankKeyRotation.js";
import { exitCodeFor, main, parseArguments, progressReporter, USAGE }
  from "../scripts/supplierBankRotationCli.js";

const REQUIRED = ["--from=e1", "--to=e2"];

test("the two key ids are required, and an empty one is a different complaint", () => {
  assert.throws(() => parseArguments([]), /both --from and --to are required/u);
  assert.throws(() => parseArguments(["--from=e1"]), /both --from and --to are required/u);
  assert.throws(() => parseArguments(["--to=e2"]), /both --from and --to are required/u);
  // `--from=` 係寫咗但空咗，唔係冇寫 —— 報「required」等於話 operator 冇打過佢。
  assert.throws(() => parseArguments(["--from=", "--to=e2"]), /--from needs a key id/u);
  assert.throws(() => parseArguments(["--from=e1", "--to="]), /--to needs a key id/u);
});

// REV-054 L-3：隔籬 `rotateCustomerBankEncryption.js` 兩頭都封，呢個之前淨係封低。
test("--batch-size is bounded at both ends", () => {
  assert.equal(parseArguments([...REQUIRED, "--batch-size=1000"]).batchSize, 1000);
  assert.throws(() => parseArguments([...REQUIRED, "--batch-size=1001"]), /must not exceed 1000/u);
  assert.match(USAGE, /--batch-size.*1 to 1000/u, "and the usage says so");
});

test("defaults leave batch size and limit to the module", () => {
  assert.deepEqual(parseArguments(REQUIRED),
    { batchSize: undefined, limit: undefined, transitionStarted: null, json: false, from: "e1", to: "e2" });
});

/**
 * 呢條就係 M-4 本身。`--limit=0` 之前合法，而 `runRotation` 入面 `limit = 0` 係
 * 「冇上限」—— 所以打 `--limit=0` 當試探嘅 operator 會改寫成張表，再收到一句
 * 「舊 key 可以剷」。隔籬嗰個 `--batch-size=0` 又一行都唔做。
 */
test("0 is refused on both bounding flags, and --limit says what to do instead", () => {
  assert.throws(() => parseArguments([...REQUIRED, "--limit=0"]),
    /--limit must be a positive integer; omit it to rotate every remaining row/u);
  assert.throws(() => parseArguments([...REQUIRED, "--batch-size=0"]),
    /--batch-size must be a positive integer/u);
  for (const bad of ["-1", "1.5", "abc", ""]) {
    assert.throws(() => parseArguments([...REQUIRED, `--limit=${bad}`]), /--limit must be/u, `--limit=${bad}`);
    assert.throws(() => parseArguments([...REQUIRED, `--batch-size=${bad}`]), /--batch-size must be/u, `--batch-size=${bad}`);
  }
  assert.equal(parseArguments([...REQUIRED, "--limit=1"]).limit, 1);
  assert.equal(parseArguments([...REQUIRED, "--batch-size=1"]).batchSize, 1);
});

// REV-053 L-9：`split("=")` 兩位解構之前靜靜雞截走第二個 `=` 之後嘅嘢。Base64 key
// material 本身帶 `=` padding，所以一個貼錯嘅值會變成一個睇落合理嘅 key id。
test("a value containing '=' survives intact instead of being silently truncated", () => {
  assert.equal(parseArguments(["--from=e1", "--to=e2=x"]).to, "e2=x");
  assert.equal(parseArguments(["--from=YWJj==", "--to=e2"]).from, "YWJj==");
});

test("--json takes no value", () => {
  assert.equal(parseArguments([...REQUIRED, "--json"]).json, true);
  assert.throws(() => parseArguments([...REQUIRED, "--json=false"]), /--json takes no value/u);
});

// REV-053 L-8：一個打錯位置嘅 key value 唔應該走入 stderr 同 shell history。
test("an unknown flag is reported by name, without echoing its value", () => {
  assert.throws(() => parseArguments([...REQUIRED, "--oops=super-secret"]), (error) => {
    assert.equal(error.message, "unknown argument --oops");
    assert.ok(!error.message.includes("super-secret"), "the value must not be echoed back");
    return true;
  });
  assert.throws(() => parseArguments(["not-a-flag"]), /unknown argument/u);
});

test("--transition-started must be a date", () => {
  assert.equal(parseArguments([...REQUIRED, "--transition-started=2026-09-01T00:00:00Z"]).transitionStarted,
    Date.parse("2026-09-01T00:00:00Z"));
  assert.throws(() => parseArguments([...REQUIRED, "--transition-started=soon"]), /must be an ISO date/u);
});

test("--help short-circuits, and the usage names every flag the parser accepts", () => {
  assert.deepEqual(parseArguments(["--help"]), { help: true });
  assert.deepEqual(parseArguments([...REQUIRED, "--help"]), { help: true });
  for (const flag of ["--from", "--to", "--batch-size", "--limit", "--transition-started", "--json", "--help"]) {
    assert.ok(USAGE.includes(flag), `${flag} must appear in the usage text`);
  }
});

/**
 * REV-054 M-3。`main` 之前**成個 repo 冇一個測試 import 過佢**。REV-053 M-4 嗰句
 * 點名咗四個冇人睇嘅面 —— 旗解析、exit code 合約、進度列印、pool 接線 —— 而
 * remediation 只係測咗第一個。REV-054 把 REV-053 喺 `main` 入面嗰個修正
 * （`attempted % 100`）原封不動 revert 返，25 條測試全綠。
 *
 * 呢兩條唔掂資料庫：兩條路都喺開 pool 之前就返。
 */
test("main returns the exit code its own contract promises, without a stack trace", async () => {
  const stderr = [];
  const originalError = process.stderr.write.bind(process.stderr);
  const originalOut = process.stdout.write.bind(process.stdout);
  const stdout = [];
  process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
  process.stdout.write = (chunk) => { stdout.push(String(chunk)); return true; };
  try {
    assert.equal(await main(ROTATION_KINDS.ENCRYPTION, ["--from=e1", "--to=e2", "--oops=super-secret"]), 2,
      "a bad flag is exit 2, not 1 — 1 means the rotation ran and rows failed");
    assert.equal(await main(ROTATION_KINDS.ENCRYPTION, ["--help"]), 0);
  } finally {
    process.stderr.write = originalError;
    process.stdout.write = originalOut;
  }
  const complaint = stderr.join("");
  assert.match(complaint, /unknown argument --oops/u);
  assert.ok(!complaint.includes("super-secret"), "the value must not reach stderr or the shell history");
  assert.ok(!/\n\s+at /u.test(complaint), `an operator typo must not print a stack trace:\n${complaint}`);
  assert.match(complaint, /Usage:/u, "and it must say how to type it correctly");
  assert.match(stdout.join(""), /Usage:/u, "--help prints the usage on stdout");
});

// REV-054 M-3：`processed` 喺啲行一路失敗嗰陣唔郁，而 `0 % 100 === 0` —— 用佢做
// gate 就係一行資料一行 stdout，偏偏就係 operator 最需要睇住個輪替嗰陣。
test("the progress reporter counts attempts, not successes", () => {
  const lines = [];
  const report = progressReporter({ write: (line) => lines.push(line) });

  for (let attempted = 1; attempted <= 250; attempted += 1) {
    report({ processed: 0, attempted, lastId: attempted });   // 每一行都失敗
  }

  assert.deepEqual(lines, [
    "attempted=100 processed=0 lastId=100\n",
    "attempted=200 processed=0 lastId=200\n"
  ], "a table where every row fails must not print one line per row");
  assert.deepEqual(progressReporter({ json: true, write: () => assert.fail("--json must print nothing") })
    .call(null, { processed: 0, attempted: 100, lastId: 1 }), undefined);
});

/**
 * Exit code 合約 —— 由外面睇。
 *
 * REV-055 M-3：上面嗰兩條直接叫 `main` 嘅測試守住咗 `parseArguments` 嗰半，但
 * `main` 個 body catch 由 `return 2` 改成 `return 1`，三十三條單元加四條整合全部
 * 照綠；連「`main` 永遠回 0」都生還。即係「輪替失敗回 1、跑唔起回 2」呢個合約
 * —— 一個 runbook 或者 CI job 真係會讀嗰樣嘢 —— 由頭到尾冇嘢睇住。
 *
 * 呢度開子程序，因為呢幾條路要經過 config 載入，而 ESM 會 cache module ——
 * 同一個 process 入面改 `process.env` 係改唔郁佢嘅。隔籬個
 * `customerBankMaintenanceCli.test.js` 都係咁做。
 */
const ENTRY = new URL("../scripts/rotateSupplierBankEncryption.js", import.meta.url).pathname;
const CWD = new URL("..", import.meta.url).pathname;

function run(argv, env = {}) {
  return spawnSync(process.execPath, [ENTRY, ...argv], {
    cwd: CWD, encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

test("the CLI's exit codes mean what the contract says", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0, "--help is not a failure");
  assert.match(help.stdout, /Usage:/u);

  const badFlag = run(["--from=e1", "--to=e2", "--nope=x"]);
  assert.equal(badFlag.status, 2, "an operator typo is 2, never 1");

  // 爛 key ring：呢個係輪替期間最容易犯嗰個錯，而佢喺開 pool 之前就炸。
  const badRing = run(["--from=e1", "--to=e2"], { SUPPLIER_BANK_ENCRYPTION_KEYS: '{"e1": "not base64' });
  assert.equal(badRing.status, 2, "a broken key ring is 2: the rotation never ran");
  assert.ok(!/\n\s+at /u.test(badRing.stderr), `no stack trace for an operator error:\n${badRing.stderr}`);
  assert.ok(badRing.stderr.trim().length > 0, "and it must say something");

  // 連唔到資料庫亦都係「跑唔起」，唔係「有行失敗」。
  const noDatabase = run(["--from=e1", "--to=e2"], { DB_PORT: "1", DB_HOST: "127.0.0.1" });
  assert.equal(noDatabase.status, 2, "an unreachable database is 2, not 1");
});

// REV-055 M-1／M-3：呢個表之前一個 case 都冇人行過。
test("exitCodeFor distinguishes done, half-done, and could-not-count", () => {
  assert.equal(exitCodeFor({ failed: 0, remaining: 0 }), 0, "clean and drained");
  assert.equal(exitCodeFor({ failed: 0, remaining: 7 }), 0, "clean; rows left is the resume case, not a failure");
  assert.equal(exitCodeFor({ failed: 3, remaining: 0 }), 1, "rows failed");
  assert.equal(exitCodeFor({ failed: 3, remaining: 7 }), 1);
  assert.equal(exitCodeFor({ failed: 0, remaining: null }), 1,
    "the count could not be read: not knowing is not success");
  assert.equal(exitCodeFor({ failed: 2, remaining: null }), 1);
});
