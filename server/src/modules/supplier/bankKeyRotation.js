/**
 * Bank key 輪替嘅核心邏輯。設計 §5.8、§2.7，SEC-010／SEC-011、NFR-009／NFR-010。
 *
 * 邏輯放喺呢度而唔係 `server/scripts/`，有兩個原因。一係測試：呢度收 `database`、
 * `crypto`、`clock` 做參數，所以單元測試唔使真 MySQL 都行得到（CLAUDE.md §7）。
 * 二係邊界：`server/scripts/` 唔喺本模組 scope 入面（HD-034 決定咗接受嗰個
 * OUTSIDE_MODULE），所以住喺嗰度嘅嘢愈少愈好 —— 嗰兩個檔案而家係薄 shim。
 *
 * ## 兩條命令做緊乜，同點解要分開
 *
 * Encryption 輪替：解密 → 用 active key 重新加密。`crypto_context` 同 `supplier_id`
 * 冇變，所以 AAD 綁定原封不動 —— 換句話講，重加密**唔會**令一行變成可以搬去第二個
 * Supplier。Blind index 完全唔郁。
 *
 * Lookup 輪替：用 active lookup key 重算 blind index。呢個要攞明文，所以佢**一樣要**
 * encryption ring 解密 —— 兩條命令都要兩個 ring 齊全，唔係得一邊。
 *
 * 分開係因為佢哋可以獨立進行：換 encryption key 唔影響查重，換 lookup key 唔影響
 * 密文。夾埋做就要一次過改四個欄位，而中途死咗之後就分唔清邊個 key 換咗一半。
 *
 * ## 續跑
 *
 * 兩條都係「揀 id 大過 `after` 而且仲係舊 key 嘅行，順住 id 做，一次最多
 * `batchSize` 行」。續跑唔使記住任何進度檔案：**條件本身就係進度** —— 做完嘅行
 * 個 key id 已經唔再係 `from`，所以下次查根本揀唔中佢。一個崩咗嘅 run 同一個做完
 * 一半嘅 run 喺呢個查詢眼中係同一件事。
 */

/**
 * 把一個錯誤變成一個可以印出嚟嘅理由。
 *
 * **唔可以**直接用 `error.message`。我上一版咁做，理由係「crypto 拋嘅訊息唔含密文
 * 或者 key」—— 嗰句對 crypto 嚟講係啱嘅（七個 throw site 都查過），但個 `catch`
 * 同時包住 `connection.execute`，而 MySQL 喺 `ER_DUP_ENTRY` 嘅訊息入面會**嵌住
 * 撞咗嗰個 key 嘅值**：
 *
 *   Duplicate entry '\xC0\x18\x83D\xAA\xBB…' for key 'supplier_bank_accounts.uq_supplier_bank_blind_index'
 *
 * 而對嗰條 UNIQUE 嚟講，撞咗嗰個值**就係 blind index**。即係一個重覆就會把半個
 * HMAC 連同 supplier_id 印落 report 度。T36 AC3 冇條件咁禁止呢件事。（REV-051 F-M1）
 *
 * 我原本個掃描亦都捉唔到：佢揾 base64 同 43 字元 base64，而呢個係
 * `\xC0\x18\x83D` 咁樣走出嚟嘅。掃描本身冇錯，係我由佢推出嚟嗰個結論窄過事實。
 *
 * 所以呢度**唔轉發任何驅動程式訊息**。Constraint 名同 errno 唔係祕密，照出；
 * 其餘一律收成一個固定字串。
 */
function safeReason(error) {
  const chain = [error, error?.cause, error?.cause?.cause].filter(Boolean);
  const duplicate = chain.find((link) => Number(link.errno) === 1062 || link.code === "ER_DUP_ENTRY");
  if (duplicate) {
    // 淨係抽 constraint 名 —— 佢係 schema 嘅一部分，唔係資料。
    const constraint = /for key '(?:[^'.]*\.)?([A-Za-z0-9_]+)'/u.exec(
      String(duplicate.sqlMessage ?? duplicate.message ?? "")
    );
    return { reason: "DUPLICATE_KEY", constraint: constraint?.[1] ?? "unknown" };
  }
  // Crypto 自己嘅錯誤有 publicCode／code，兩個都係固定識別碼。
  const named = chain.find((link) => typeof link.publicCode === "string" || typeof link.code === "string");
  if (named) return { reason: named.publicCode ?? named.code };
  return { reason: "UNKNOWN" };
}

const DEFAULT_BATCH_SIZE = 200;
const MAX_RING_SIZE = 3;
const MAX_TRANSITION_DAYS = 30;
const DAY_MS = 86_400_000;

export const ROTATION_KINDS = Object.freeze({ ENCRYPTION: "encryption", LOOKUP: "lookup" });

function assertTarget(kind, crypto, to) {
  const active = kind === ROTATION_KINDS.ENCRYPTION ? crypto.activeEncryptionKeyId : crypto.activeLookupKeyId;
  // `--to` 係一個**確認**，唔係一個選擇器。`encryptAccountNumber` 同 `blindIndex`
  // 一定用 active key（設計 §5.8：新增／修改只用 active），所以如果 caller 心目中
  // 嘅目標同 active 唔同，佢對緊一個唔存在嘅輪替落命令 —— 嗰陣要停，唔係靜靜雞
  // 寫入 active key 然後回報成功。
  if (to !== active) {
    throw new Error(`--to must be the active ${kind} key id (${active}); refusing to rotate towards a different key`);
  }
  return active;
}

function assertDistinct(from, to) {
  if (!from) throw new Error("--from is required");
  if (from === to) throw new Error("--from and --to are the same key id; nothing to rotate");
}

/**
 * Ring 健康。兩個都係**警告**唔係錯誤：一個正喺輪替途中嘅系統本來就會短暫超標，
 * 而喺嗰一刻叫停會令人為咗令腳本收聲而去做更危險嘅事（例如提早剷走舊 key）。
 */
export function ringWarnings({ crypto, transitionStartedAt = null, now = Date.now() } = {}) {
  const warnings = [];
  // 兩個 ring 各自睇。之前呢個迴圈拆走 lookup 嗰半都冇測試會紅 —— 補咗。
  for (const [kind, ring] of [["encryption", crypto.encryptionKeyIds], ["lookup", crypto.lookupKeyIds]]) {
    if (ring.length > MAX_RING_SIZE) {
      warnings.push({
        code: "RING_TOO_LARGE", kind, count: ring.length, limit: MAX_RING_SIZE,
        message: `${kind} key ring holds ${ring.length} keys, above the ${MAX_RING_SIZE} the design allows`
      });
    }
  }
  if (transitionStartedAt) {
    const days = Math.floor((now - transitionStartedAt) / DAY_MS);
    if (days > MAX_TRANSITION_DAYS) {
      warnings.push({
        code: "TRANSITION_TOO_LONG", days, limit: MAX_TRANSITION_DAYS,
        message: `key transition has been open for ${days} days, above the ${MAX_TRANSITION_DAYS} the design allows`
      });
    }
  }
  return warnings;
}

/** 剩低幾多行未換。舊 key 可唔可以剷走，就係睇呢個數係咪 0。 */
export async function remainingRows(database, kind, keyId) {
  const column = kind === ROTATION_KINDS.ENCRYPTION ? "encryption_key_id" : "blind_index_key_id";
  const [[row]] = await database.query(
    `SELECT COUNT(*) AS remaining FROM supplier_bank_accounts WHERE ${column} = ?`, [keyId]
  );
  return Number(row.remaining);
}

async function selectBatch(database, kind, from, after, batchSize) {
  const column = kind === ROTATION_KINDS.ENCRYPTION ? "encryption_key_id" : "blind_index_key_id";
  // 條件本身就係進度 —— 做完嘅行唔再 match，所以續跑唔使外部狀態。
  const [rows] = await database.query(
    `SELECT id, supplier_id, crypto_context, account_ciphertext, account_iv, account_auth_tag,
            encryption_key_id, blind_index_key_id
       FROM supplier_bank_accounts
      WHERE ${column} = ? AND id > ?
      ORDER BY id
      LIMIT ${Number(batchSize)}`,
    [from, after]
  );
  return rows;
}

function plaintextOf(crypto, row) {
  return crypto.decryptAccountNumber({
    supplierId: row.supplier_id,
    cryptoContext: row.crypto_context,
    ciphertext: row.account_ciphertext,
    iv: row.account_iv,
    authTag: row.account_auth_tag,
    encryptionKeyId: row.encryption_key_id
  });
}

/**
 * 一行一個交易。全部一個交易會令一個大 ring 嘅輪替鎖住成張表幾分鐘，而一行一個
 * 交易嘅「代價」—— 中途死咗會留低做咗一半嘅狀態 —— 喺呢度根本唔係代價：每一行
 * 自己都係一致嘅，而未做嘅行仲係舊 key，下次續跑照樣揀得中。
 */
async function rotateRow(database, kind, crypto, row) {
  const accountNumber = plaintextOf(crypto, row);
  await database.withTransaction(async (connection) => {
    if (kind === ROTATION_KINDS.ENCRYPTION) {
      const sealed = crypto.encryptAccountNumber({
        supplierId: row.supplier_id, cryptoContext: row.crypto_context, accountNumber
      });
      await connection.execute(
        `UPDATE supplier_bank_accounts
            SET account_ciphertext = ?, account_iv = ?, account_auth_tag = ?, encryption_key_id = ?
          WHERE id = ? AND encryption_key_id = ?`,
        [sealed.ciphertext, sealed.iv, sealed.authTag, sealed.encryptionKeyId, row.id, row.encryption_key_id]
      );
    } else {
      const { index, keyId } = crypto.blindIndex(accountNumber);
      // Index 同 key id **同一個 UPDATE** —— 分開寫就會有一瞬間兩者對唔上，而查重
      // 係靠 (blind_index_key_id, account_blind_index) 嗰條 UNIQUE 嘅。
      await connection.execute(
        `UPDATE supplier_bank_accounts
            SET account_blind_index = ?, blind_index_key_id = ?
          WHERE id = ? AND blind_index_key_id = ?`,
        [index, keyId, row.id, row.blind_index_key_id]
      );
    }
  });
}

/**
 * 跑一次。`limit` 係呢次最多處理幾多行（`0` = 冇上限），`batchSize` 係每次查幾多行。
 *
 * 回傳嘅 report **唔含**任何 key material、明文、密文或者 blind index —— 淨係 id、
 * 數量同 key **id**（key id 唔係祕密，佢已經一行行寫咗喺資料庫度）。
 */
export async function runRotation({
  database, crypto, kind, from, to,
  batchSize = DEFAULT_BATCH_SIZE, limit = 0, after = 0,
  transitionStartedAt = null, now = Date.now(), onProgress = () => {}
}) {
  if (kind !== ROTATION_KINDS.ENCRYPTION && kind !== ROTATION_KINDS.LOOKUP) {
    throw new Error(`unknown rotation kind ${kind}`);
  }
  const active = assertTarget(kind, crypto, to);
  assertDistinct(from, active);

  const startedAt = now;
  let processed = 0;
  let lastId = Number(after) || 0;
  const failures = [];

  // `attempted` 唔係 `processed`：`--limit` 限嘅係**做幾多行**，唔係成功幾多行。
  // 之前用 `processed`，所以一批全部失敗嘅行永遠唔會令 room 縮細，而 `lastId`
  // 照樣行 —— `--limit=2` 落去一張全壞嘅表會掃晒成張表，每行一條 failures。
  // 一個謹慎嘅試探性 run 唔應該咁樣變成全表掃描。（REV-051 F-M2）
  let attempted = 0;
  for (;;) {
    const room = limit > 0 ? limit - attempted : batchSize;
    if (room <= 0) break;
    const rows = await selectBatch(database, kind, from, lastId, Math.min(batchSize, room));
    if (rows.length === 0) break;
    for (const row of rows) {
      attempted += 1;
      try {
        await rotateRow(database, kind, crypto, row);
        processed += 1;
      } catch (error) {
        // 一行壞唔應該停低成個輪替 —— 但亦都唔可以靜靜雞跳過，因為「舊 key row
        // count = 0」係剷 key 嘅前提。記低 id 同一個**分類過**嘅 reason。
        failures.push({ id: Number(row.id), ...safeReason(error) });
      }
      lastId = Number(row.id);
      onProgress({ processed, attempted, lastId, failures: failures.length });
      if (limit > 0 && attempted >= limit) break;
    }
  }

  const remaining = await remainingRows(database, kind, from);
  return {
    kind, from, to: active,
    processed, attempted, failed: failures.length, failures,
    lastId, remaining,
    // 剷得走舊 key 嘅唯一條件：冇行仲用緊佢，而且今次冇失敗行。
    safeToRemoveFromKey: remaining === 0 && failures.length === 0,
    warnings: ringWarnings({ crypto, transitionStartedAt, now }),
    startedAt, endedAt: now
  };
}
