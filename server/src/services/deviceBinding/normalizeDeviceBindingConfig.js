function positiveInteger(value, key) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Device binding config "${key}" must be a positive integer`);
  }

  return number;
}

// 只接受 Node crypto 認得、且長度足以支撐 ECDSA 簽章的雜湊。留成清單而不是
// 寫死一個值，是為了日後換演算法時只改設定；但不接受任意字串——把一個打錯的
// 演算法名交給 crypto 只會在第一次驗簽時才炸，那時已經在正式環境了。
const HASH_ALGORITHMS = new Set(["sha256", "sha384", "sha512"]);
const NAMED_CURVES = new Set(["P-256", "P-384", "P-521"]);

export function normalizeDeviceBindingConfig(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("device binding config must be an object");
  }

  const signatureMaxSkewSeconds = positiveInteger(
    source.signatureMaxSkewSeconds ?? 60,
    "signatureMaxSkewSeconds"
  );
  const nonceRetentionSeconds = positiveInteger(
    source.nonceRetentionSeconds ?? 300,
    "nonceRetentionSeconds"
  );

  // 一個 timestamp 為 T 的簽章在 T + skew 之前都還會被接受。nonce 若比那個時點
  // 早刪掉，同一份請求在剩下的窗裡重放就會成功——防重放漏掉一個尾巴，而且完全
  // 沒有症狀：日誌上看不出差別，被重放的請求跟正常請求長得一模一樣。
  //
  // 所以擋在啟動，跟 tokenRevocation 那條 maxFailOpen >= maxStaleness 同一個
  // 道理：跨設定的關係要有人檢查，否則它只會在出事時才被發現。
  if (nonceRetentionSeconds < signatureMaxSkewSeconds) {
    throw new Error(
      `Device binding config "nonceRetentionSeconds" (${nonceRetentionSeconds}s) must be at ` +
        `least "signatureMaxSkewSeconds" (${signatureMaxSkewSeconds}s). A shorter retention ` +
        "would drop nonces while their signatures are still being accepted, silently " +
        "reopening the replay window."
    );
  }

  const namedCurve = String(source.namedCurve ?? "P-256");

  if (!NAMED_CURVES.has(namedCurve)) {
    throw new Error(
      `Device binding config "namedCurve" must be one of: ${[...NAMED_CURVES].join(", ")}`
    );
  }

  const hashAlgorithm = String(source.hashAlgorithm ?? "sha256");

  if (!HASH_ALGORITHMS.has(hashAlgorithm)) {
    throw new Error(
      `Device binding config "hashAlgorithm" must be one of: ${[...HASH_ALGORITHMS].join(", ")}`
    );
  }

  const unusedApprovedRetentionDays = positiveInteger(
    source.unusedApprovedRetentionDays ?? 14,
    "unusedApprovedRetentionDays"
  );
  const staleDeviceRetentionDays = positiveInteger(
    source.staleDeviceRetentionDays ?? 30,
    "staleDeviceRetentionDays"
  );

  return Object.freeze({
    signatureMaxSkewSeconds,
    nonceRetentionSeconds,
    unusedApprovedRetentionDays,
    staleDeviceRetentionDays,
    namedCurve,
    hashAlgorithm
  });
}
