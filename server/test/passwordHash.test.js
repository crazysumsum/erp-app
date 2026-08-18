import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/module/user/passwordHash.js";

// 密碼雜湊的失效模式全部都是安靜的：鹽沒隨機、比較不是定時、參數解析錯掉，
// 症狀都是「登入照常運作」。只有針對性的測試會發現。

test("password hash round-trips", async () => {
  const hash = await hashPassword("correct horse battery staple");

  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
});

test("password hash rejects the wrong password", async () => {
  const hash = await hashPassword("right");

  assert.equal(await verifyPassword("wrong", hash), false);
});

test("password hash rejects a password that is a prefix of the real one", async () => {
  const hash = await hashPassword("longpassword");

  assert.equal(await verifyPassword("long", hash), false);
});

test("password hash uses a fresh salt each time", async () => {
  const first = await hashPassword("same password");
  const second = await hashPassword("same password");

  // 相同密碼產生相同雜湊，代表沒有加鹽——一張彩虹表就能一次破掉所有重複密碼。
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("same password", first), true);
  assert.equal(await verifyPassword("same password", second), true);
});

test("password hash records the parameters it was produced with", async () => {
  const hash = await hashPassword("whatever");
  const [algorithm, parameters] = hash.split("$");

  // 參數存在字串裡，是「日後調高成本不必重算既有密碼」的前提。
  assert.equal(algorithm, "scrypt");
  assert.match(parameters, /^N=\d+,r=\d+,p=\d+$/);
});

test("password hash fits the password_hash column", async () => {
  const hash = await hashPassword("whatever");

  // users.password_hash 是 VARCHAR(255)。超過會被 MySQL 截斷，而截斷過的雜湊
  // 永遠驗不過——症狀是使用者改完密碼就登不進去。
  assert.ok(hash.length <= 255, `hash length ${hash.length} exceeds the column`);
});

test("password hash verifies against a hash produced with different parameters", async () => {
  // 手工造一個用較低成本參數產生的雜湊，模擬「調高參數之前存下的密碼」。
  const { scrypt } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const scryptAsync = promisify(scrypt);
  const salt = Buffer.from("0123456789abcdef");
  const parameters = { N: 16384, r: 8, p: 1 };
  const derived = await scryptAsync("legacy password", salt, 32, {
    ...parameters,
    maxmem: 256 * parameters.N * parameters.r
  });
  const legacyHash = [
    "scrypt",
    "N=16384,r=8,p=1",
    salt.toString("base64"),
    derived.toString("base64")
  ].join("$");

  assert.equal(await verifyPassword("legacy password", legacyHash), true);
  assert.equal(await verifyPassword("wrong", legacyHash), false);
});

test("password hash rejects an empty password", async () => {
  await assert.rejects(() => hashPassword(""), TypeError);
  await assert.rejects(() => hashPassword(undefined), TypeError);
});

test("password hash reports a malformed stored hash instead of failing the login", async () => {
  // 回 false 會讓一整批壞掉的雜湊看起來像使用者自己打錯密碼。
  await assert.rejects(() => verifyPassword("x", "garbage"), /malformed/);
  await assert.rejects(() => verifyPassword("x", ""), /malformed/);
  await assert.rejects(() => verifyPassword("x", null), /malformed/);
  await assert.rejects(
    () => verifyPassword("x", "bcrypt$N=1,r=1,p=1$c2FsdA==$aGFzaA=="),
    /malformed/
  );
});

test("password hash rejects invalid cost parameters", async () => {
  await assert.rejects(
    () => verifyPassword("x", "scrypt$N=abc,r=8,p=1$c2FsdA==$aGFzaA=="),
    /invalid N parameter/
  );
  await assert.rejects(
    () => verifyPassword("x", "scrypt$N=16384,r=0,p=1$c2FsdA==$aGFzaA=="),
    /invalid r parameter/
  );
});

test("password hash rejects a stored key of the wrong length", async () => {
  // 長度不對就直接說出來：交給 timingSafeEqual 會丟一個看不出原因的
  // RangeError，而這是資料壞掉，不是密碼錯。
  await assert.rejects(
    () => verifyPassword("x", "scrypt$N=16384,r=8,p=1$c2FsdA==$c2hvcnQ="),
    /unexpected key length/
  );
});
