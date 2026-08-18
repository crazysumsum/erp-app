/**
 * 密碼雜湊與驗證。
 *
 * 用 node:crypto 的 scrypt，不引入 bcrypt／argon2：那兩個都要 node-gyp 原生編譯，
 * 而這個專案的 npm 設定預設擋下安裝腳本（見 `npm install-scripts ls`）。scrypt 是
 * 記憶體困難的 KDF，內建於 Node，對這個用途夠用。
 *
 * 雜湊字串自帶演算法與參數：
 *
 *   scrypt$N=65536,r=8,p=1$<salt base64>$<derived key base64>
 *
 * 參數寫進字串而不是寫死在驗證邏輯裡，是為了讓成本參數日後可以調高而不必一次
 * 重算所有既有密碼——舊密碼仍以簽發當下的參數驗證，新密碼用新參數。
 * （目前不會自動重算：要讓既有帳號升級到新參數，需要在驗證成功後偵測參數落後
 * 並重新雜湊，那是另一段邏輯，等真的要調參數時再加。）
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// N=2^16 約 64MB、86ms（本機實測）。OWASP 對 scrypt 的建議下限是 N=2^17，
// 這裡刻意低一階：登入端點的記憶體用量會隨併發線性放大，2^17 是每個進行中的
// 登入 128MB，一波併發登入就足以把記憶體壓力變成一個攻擊面。離線破解的防護
// 由這個成本、帳號鎖定與 IP 限流共同承擔，而不是全押在單一參數上。
const PARAMETERS = Object.freeze({ N: 65536, r: 8, p: 1 });
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const ALGORITHM = "scrypt";

// scrypt 的預設 maxmem 是 32MB，低於上面的參數所需，不放寬會直接丟錯。
// 留兩倍餘裕，讓參數微調不必同步改這裡。
function maxmemFor({ N, r }) {
  return 256 * N * r;
}

function formatParameters({ N, r, p }) {
  return `N=${N},r=${r},p=${p}`;
}

function parseParameters(text) {
  const parsed = Object.fromEntries(
    String(text)
      .split(",")
      .map((pair) => {
        const [key, value] = pair.split("=");
        return [key, Number(value)];
      })
  );

  for (const key of ["N", "r", "p"]) {
    if (!Number.isInteger(parsed[key]) || parsed[key] < 1) {
      throw new Error(`Password hash has an invalid ${key} parameter`);
    }
  }

  return parsed;
}

async function deriveKey(password, salt, parameters) {
  return scryptAsync(String(password), salt, KEY_LENGTH, {
    ...parameters,
    maxmem: maxmemFor(parameters)
  });
}

/**
 * 雜湊一個密碼，回傳可直接存進 users.password_hash 的字串。
 */
export async function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("Password must be a non-empty string");
  }

  const salt = randomBytes(SALT_LENGTH);
  const derived = await deriveKey(password, salt, PARAMETERS);

  return [
    ALGORITHM,
    formatParameters(PARAMETERS),
    salt.toString("base64"),
    derived.toString("base64")
  ].join("$");
}

/**
 * 驗證密碼是否符合先前產生的雜湊字串。
 *
 * 格式錯誤會丟錯而不是回 false：那代表資料壞了或被人改過，靜靜當成「密碼不對」
 * 會讓一整批登不進去的帳號看起來像使用者自己打錯密碼。
 */
export async function verifyPassword(password, storedHash) {
  const parts = String(storedHash ?? "").split("$");

  if (parts.length !== 4 || parts[0] !== ALGORITHM) {
    throw new Error("Password hash is malformed");
  }

  const [, parameterText, saltText, expectedText] = parts;
  const parameters = parseParameters(parameterText);
  const expected = Buffer.from(expectedText, "base64");

  if (expected.length !== KEY_LENGTH) {
    throw new Error("Password hash has an unexpected key length");
  }

  const actual = await deriveKey(
    password,
    Buffer.from(saltText, "base64"),
    parameters
  );

  // 逐位元比較會在第一個不同的位元組就返回，比較時間因此洩漏正確前綴的長度。
  return timingSafeEqual(actual, expected);
}
