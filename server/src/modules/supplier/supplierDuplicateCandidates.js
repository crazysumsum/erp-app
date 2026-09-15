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
      const placeholders = hashes.map(() => "?").join(", ");
      const exclusionSql = excludeSupplierId === null ? "" : " AND s.id <> ?";
      const params = excludeSupplierId === null ? hashes : [...hashes, excludeSupplierId];
      [gramRows] = await connection.query(
        `SELECT s.id, s.supplier_code, s.supplier_name, s.supplier_name_key, COUNT(*) AS common_grams
           FROM supplier_name_grams g
           JOIN suppliers s ON s.id = g.supplier_id
          WHERE g.gram_hash IN (${placeholders})${exclusionSql}
          GROUP BY s.id, s.supplier_code, s.supplier_name, s.supplier_name_key
          ORDER BY common_grams DESC, s.id ASC
          LIMIT 50`,
        params
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
}
