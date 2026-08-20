import { ApplicationError } from "../../framework/errors/ApplicationError.js";

export const DEVICE_HEADERS = Object.freeze({
  id: "X-Device-Id",
  timestamp: "X-Device-Timestamp",
  nonce: "X-Device-Nonce",
  signature: "X-Device-Signature",
  publicKey: "X-Device-Public-Key"
});

/**
 * 從請求取出設備簽章的各個欄位。登入與續期共用。
 *
 * 走 header 而不是 body：handler 的 requestSchema 都是
 * `additionalProperties: false`，塞進 body 會讓每一支要簽名的端點都得改
 * schema；走 header 則同一套規格可以直接套用到日後任何端點。
 *
 * 這裡只負責取值與形狀檢查，不驗簽——驗簽在 DeviceBindingService，那裡才有
 * 公鑰與 nonce 表。
 */
export function readDeviceSignature(req) {
  const deviceId = String(req.get(DEVICE_HEADERS.id) || "").trim();
  const timestamp = String(req.get(DEVICE_HEADERS.timestamp) || "").trim();
  const nonce = String(req.get(DEVICE_HEADERS.nonce) || "").trim();
  const signature = String(req.get(DEVICE_HEADERS.signature) || "").trim();
  const publicKey = String(req.get(DEVICE_HEADERS.publicKey) || "").trim();

  if (!deviceId || !timestamp || !nonce || !signature) {
    throw new ApplicationError("Device signature headers are missing", {
      code: "DEVICE_SIGNATURE_REQUIRED",
      statusCode: 400,
      publicCode: "DEVICE_SIGNATURE_REQUIRED",
      publicMessage: "This request must be signed by a registered device"
    });
  }

  // thumbprint 是 SHA-256 的 hex，長度與字元集都是固定的。在這裡擋掉畸形的值，
  // 後面就不必擔心它被當成 SQL 參數或 Map 的 key 時有什麼意外形狀。
  if (!/^[0-9a-f]{64}$/.test(deviceId)) {
    throw new ApplicationError("Device id is not a SHA-256 thumbprint", {
      code: "DEVICE_SIGNATURE_INVALID",
      statusCode: 400,
      publicCode: "DEVICE_SIGNATURE_INVALID",
      publicMessage: "Device signature is invalid"
    });
  }

  return {
    deviceId,
    timestamp: Number(timestamp),
    nonce,
    signature: Buffer.from(signature, "base64url"),
    // 只有首次綁定申請會帶公鑰。已經有綁定的請求一律用資料庫裡那把，這裡帶
    // 什麼都會被忽略——否則任何人都能用自己的金鑰簽名再附上自己的公鑰。
    publicKeyDer: publicKey ? Buffer.from(publicKey, "base64url") : null,
    method: req.method,
    // originalUrl 帶 query string，簽章對不上。簽的是 route path，與客戶端
    // 送出的路徑一致。
    path: req.path
  };
}

/**
 * 驗簽失敗時對外的錯誤。
 *
 * 除了時鐘不同步之外，所有原因都收斂成同一個 DEVICE_SIGNATURE_INVALID：
 * 「簽章不符」「公鑰不對」「nonce 用過了」的差別會告訴攻擊者他離成功還差多遠。
 *
 * 時鐘不同步是例外，因為它是唯一一個**使用者自己修得好**的原因，而攻擊者從
 * 「你的時間差太多」學不到任何東西。收斂掉它只會換來一通查不出原因的客服電話。
 */
export function deviceSignatureError(reason) {
  if (reason === "timestamp_stale" || reason === "timestamp_invalid") {
    return new ApplicationError(`Device signature rejected: ${reason}`, {
      code: "DEVICE_SIGNATURE_STALE",
      statusCode: 400,
      publicCode: "DEVICE_SIGNATURE_STALE",
      publicMessage:
        "This device's clock is too far from the server's. Check the system time and try again."
    });
  }

  return new ApplicationError(`Device signature rejected: ${reason}`, {
    code: "DEVICE_SIGNATURE_INVALID",
    statusCode: 400,
    publicCode: "DEVICE_SIGNATURE_INVALID",
    publicMessage: "Device signature is invalid"
  });
}

/**
 * 綁定狀態不允許使用系統時對外的錯誤。
 *
 * 三種狀態刻意用三個不同的 code：全部混成一句「登入失敗」的話，使用者會以為
 * 是密碼打錯而一直重試，然後撞上登入節流——真正該做的事（等審批、找管理員）
 * 一個都不會發生。
 */
export function deviceStatusError(status) {
  const errors = {
    pending: {
      code: "DEVICE_PENDING_APPROVAL",
      message: "This device is waiting for approval before it can be used"
    },
    rejected: {
      code: "DEVICE_REJECTED",
      message: "This device was rejected. Contact an administrator."
    },
    revoked: {
      code: "DEVICE_REVOKED",
      message: "This device's access was revoked. Contact an administrator."
    }
  };

  const { code, message } = errors[status] ?? errors.rejected;

  return new ApplicationError(`Device binding is ${status}`, {
    code,
    statusCode: 403,
    publicCode: code,
    publicMessage: message
  });
}
