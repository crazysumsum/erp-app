import { randomUUID, webcrypto } from "node:crypto";

/**
 * 一台模擬的設備：真的 P-256 金鑰，簽名格式跟前端 deviceKey.js 一樣。
 *
 * 用真金鑰而不是假簽章，是因為對真資料庫的整合測試要驗的正是接縫：原始 body
 * 有沒有被留住、IEEE P1363 有沒有被當成 DER、nonce 有沒有真的寫進表——這些在
 * 假 pool 上全部測不到。
 *
 * 原本只在 authFlow.integration.test.js 用；Phase 4 把用戶／角色管理的四支
 * 提權端點升級成 jwt-device-password 之後，這是第三個真的需要同一段簽名邏輯
 * 的地方，所以抽出來共用。
 */
export async function createTestDevice() {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const spki = new Uint8Array(await webcrypto.subtle.exportKey("spki", keyPair.publicKey));
  const digest = await webcrypto.subtle.digest("SHA-256", spki);
  const deviceId = Buffer.from(digest).toString("hex");

  return {
    deviceId,
    // 原始 SPKI bytes，給要直接把設備種成「已核准」的測試插進
    // user_devices.public_key 用（略過完整的申請／審批流程）。
    publicKeyDer: Buffer.from(spki),
    async headers({ method, path, body, token, includePublicKey = false }) {
      const nonce = randomUUID();
      const timestamp = Date.now();
      const sha256 = async (value) =>
        Buffer.from(await webcrypto.subtle.digest("SHA-256", Buffer.from(value))).toString(
          "base64url"
        );
      const bodyHash = body === undefined ? "" : await sha256(body);
      // 綁死在這個請求用的那一枚 token 上（RFC 9449 的 ath）。沒有 token 就空字串。
      const accessTokenHash = token ? await sha256(token) : "";
      // 鍵照字典序——跟 DeviceBindingService.signingInput() 逐字元一樣。
      const signingInput = JSON.stringify({
        accessTokenHash,
        bodyHash,
        deviceId,
        method: method.toUpperCase(),
        nonce,
        path,
        timestamp
      });
      const signature = await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.privateKey,
        Buffer.from(signingInput)
      );

      const headers = {
        "Content-Type": "application/json",
        "X-Device-Id": deviceId,
        "X-Device-Timestamp": String(timestamp),
        "X-Device-Nonce": nonce,
        "X-Device-Signature": Buffer.from(signature).toString("base64url")
      };

      if (includePublicKey) {
        headers["X-Device-Public-Key"] = Buffer.from(spki).toString("base64url");
      }

      return headers;
    }
  };
}
