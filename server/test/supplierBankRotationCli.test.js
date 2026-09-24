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

import { parseArguments, USAGE } from "../scripts/supplierBankRotationCli.js";

const REQUIRED = ["--from=e1", "--to=e2"];

test("the two key ids are required", () => {
  assert.throws(() => parseArguments([]), /both --from and --to are required/u);
  assert.throws(() => parseArguments(["--from=e1"]), /both --from and --to are required/u);
  assert.throws(() => parseArguments(["--to=e2"]), /both --from and --to are required/u);
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
