import { createHash } from "node:crypto";

function uniqueBigrams(value) {
  const characters = Array.from(value);
  const grams = new Set();
  for (let index = 0; index < characters.length - 1; index += 1) {
    grams.add(`${characters[index]}${characters[index + 1]}`);
  }
  return grams;
}

export function hashNameBigrams(value) {
  return [...uniqueBigrams(value)]
    .sort()
    .map((gram) => createHash("sha256").update(gram, "utf8").digest());
}

export function bigramDiceScore(left, right) {
  if (left === right) return 1;
  const leftGrams = uniqueBigrams(left);
  const rightGrams = uniqueBigrams(right);
  if (leftGrams.size === 0 || rightGrams.size === 0) return 0;
  let common = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) common += 1;
  }
  return (2 * common) / (leftGrams.size + rightGrams.size);
}

export async function replaceSupplierNameGrams(connection, supplierId, nameKey) {
  await connection.execute("DELETE FROM supplier_name_grams WHERE supplier_id = ?", [supplierId]);
  const hashes = hashNameBigrams(nameKey);
  if (hashes.length === 0) return;
  const placeholders = hashes.map(() => "(?, ?)").join(", ");
  const values = hashes.flatMap((hash) => [supplierId, hash]);
  await connection.query(
    `INSERT INTO supplier_name_grams (supplier_id, gram_hash) VALUES ${placeholders}`,
    values
  );
}

// ponytail: 數到呢個數就當「常見」；全部 gram 都常見嘅名稱，候選集會大啲但結果唔變。
const RARITY_CAP = 2_000;
// ponytail: 最多對呢個數目嘅候選數齊 gram（按命中罕見 gram 數排先）。名稱嘅罕見 gram 都好常見時可能漏報，換成本有上限。
const CANDIDATE_CAP = 3_000;

export class SupplierDuplicateCandidates {
  constructor({ threshold = 0.85 } = {}) {
    this.threshold = threshold;
  }

  async find(connection, { nameKey, excludeSupplierId = null }) {
    const exclusion = excludeSupplierId === null ? "" : " AND id <> ?";
    const exactParams = excludeSupplierId === null ? [nameKey] : [nameKey, excludeSupplierId];
    const [exactRows] = await connection.query(
      `SELECT id, supplier_code, supplier_name, supplier_name_key
         FROM suppliers
        WHERE supplier_name_key = ?${exclusion}
        ORDER BY id
        LIMIT 50`,
      exactParams
    );

    const hashes = hashNameBigrams(nameKey);
    let gramRows = [];
    if (hashes.length > 0) {
      // T50：Dice = 2c/(a+b) ≥ t，而 b ≥ c，所以候選最少要同輸入共有 c ≥ ta/(2-t) 個 gram；佢最多缺 a-c 個，
      // 所以一定包含輸入任何 a-c+1 個 gram 之中嘅一個。揀最罕見嗰幾個搵候選，再對候選數齊共有 gram。
      // 結果同掃晒所有 gram 一樣（只係唔再計一定唔夠分嘅 Supplier），但唔使掃常見 gram 嘅成條 posting list。
      const minCommon = Math.max(1, Math.ceil((this.threshold * hashes.length) / (2 - this.threshold)));
      const rare = await this.#rarest(connection, hashes, hashes.length - minCommon + 1);
      const all = hashes.map(() => "?").join(", ");
      const exclusionSql = excludeSupplierId === null ? "" : " AND s.id <> ?";
      [gramRows] = await connection.query(
        `SELECT s.id, s.supplier_code, s.supplier_name, s.supplier_name_key, COUNT(*) AS common_grams
           FROM (SELECT supplier_id FROM supplier_name_grams WHERE gram_hash IN (${rare.map(() => "?").join(", ")})
                 GROUP BY supplier_id ORDER BY COUNT(*) DESC, supplier_id ASC LIMIT ${CANDIDATE_CAP}) c
           JOIN supplier_name_grams g ON g.supplier_id = c.supplier_id AND g.gram_hash IN (${all})
           JOIN suppliers s ON s.id = c.supplier_id
          WHERE 1 = 1${exclusionSql}
          GROUP BY s.id, s.supplier_code, s.supplier_name, s.supplier_name_key
         HAVING COUNT(*) >= ?
          ORDER BY common_grams DESC, s.id ASC
          LIMIT 50`,
        [...rare, ...hashes, ...(excludeSupplierId === null ? [] : [excludeSupplierId]), minCommon]
      );
    }

    const byId = new Map([...exactRows, ...gramRows].map((row) => [Number(row.id), row]));
    return [...byId.values()]
      .map((row) => ({
        supplierId: Number(row.id),
        supplierCode: row.supplier_code,
        supplierName: row.supplier_name,
        score: bigramDiceScore(nameKey, row.supplier_name_key),
        exact: nameKey === row.supplier_name_key,
        warningOnly: true
      }))
      .filter((row) => row.exact || row.score >= this.threshold)
      .sort((left, right) =>
        Number(right.exact) - Number(left.exact) ||
        right.score - left.score ||
        left.supplierId - right.supplierId
      )
      .slice(0, 10);
  }

  /** `count` 個最罕見嘅 gram。每個 gram 最多數到 RARITY_CAP 個 Supplier，所以成本有上限；夠罕見嘅排先。 */
  async #rarest(connection, hashes, count) {
    if (count >= hashes.length) return hashes;
    const [rows] = await connection.query(
      hashes.map(() => `SELECT ? AS i, COUNT(*) AS n FROM (SELECT 1 FROM supplier_name_grams WHERE gram_hash = ? LIMIT ${RARITY_CAP}) x`)
        .join(" UNION ALL "),
      hashes.flatMap((hash, index) => [index, hash])
    );
    return rows.map((row) => ({ index: Number(row.i), n: Number(row.n) }))
      .sort((left, right) => left.n - right.n || left.index - right.index)
      .slice(0, count)
      .map((row) => hashes[row.index]);
  }
}
