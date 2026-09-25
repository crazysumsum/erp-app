import { createConnection } from "node:net";

const TERMINATOR = Buffer.alloc(4);

export function parseClamdResponse(value) {
  const response = String(value ?? "").replace(/\0+$/u, "").trim();
  if (/:\s+OK$/u.test(response)) return { status: "clean" };
  if (/:\s+.+\s+FOUND$/u.test(response)) return { status: "infected" };
  throw new Error("Customer attachment malware scanner returned an invalid response");
}

export class ClamdScanner {
  constructor({ host, port, timeoutMs, connect = createConnection } = {}) {
    if (!host || !Number.isSafeInteger(port) || !Number.isSafeInteger(timeoutMs)) {
      throw new TypeError("ClamdScanner requires host, port and timeoutMs");
    }
    this.config = { host, port, timeoutMs };
    this.connect = connect;
  }

  scan(content) {
    if (!Buffer.isBuffer(content)) throw new TypeError("ClamdScanner content must be a Buffer");
    return new Promise((resolve, reject) => {
      const socket = this.connect({ host: this.config.host, port: this.config.port });
      const response = [];
      let responseBytes = 0;
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error); else resolve(result);
      };
      socket.setTimeout(this.config.timeoutMs);
      socket.once("timeout", () => finish(new Error("Customer attachment malware scanner timed out")));
      socket.once("error", (error) => finish(error));
      socket.once("close", () => finish(new Error("Customer attachment malware scanner closed without a response")));
      socket.on("data", (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes > 4096) return finish(new Error("Customer attachment malware scanner response is too large"));
        response.push(chunk);
        if (chunk.includes(0)) {
          try { finish(null, parseClamdResponse(Buffer.concat(response).toString("utf8"))); }
          catch (error) { finish(error); }
        }
      });
      socket.once("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < content.length; offset += 65536) {
          const chunk = content.subarray(offset, offset + 65536);
          const size = Buffer.allocUnsafe(4); size.writeUInt32BE(chunk.length);
          socket.write(size); socket.write(chunk);
        }
        socket.write(TERMINATOR);
      });
    });
  }
}
