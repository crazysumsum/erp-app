import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { ClamdScanner, parseClamdResponse } from "../src/services/customerFile/ClamdScanner.js";

test("Clamd scanner sends bounded INSTREAM frames and accepts only an explicit clean response", async () => {
  const writes = [];
  const socket = Object.assign(new EventEmitter(), {
    setTimeout() {}, destroy() {},
    write(value) {
      const chunk = Buffer.from(value); writes.push(chunk);
      if (chunk.length === 4 && chunk.equals(Buffer.alloc(4))) {
        process.nextTick(() => this.emit("data", Buffer.from("stream: OK\0")));
      }
    }
  });
  const scanner = new ClamdScanner({ host: "127.0.0.1", port: 3310, timeoutMs: 1000, connect: () => socket });
  process.nextTick(() => socket.emit("connect"));
  assert.deepEqual(await scanner.scan(Buffer.from("safe")), { status: "clean" });
  assert.equal(writes[0].toString(), "zINSTREAM\0");
  assert.equal(writes[1].readUInt32BE(), 4);
  assert.equal(writes[2].toString(), "safe");
  assert.deepEqual(writes.at(-1), Buffer.alloc(4));
});

test("Clamd response parsing distinguishes malware and fails closed on scanner errors", () => {
  assert.deepEqual(parseClamdResponse("stream: Eicar-Test-Signature FOUND\0"), { status: "infected" });
  assert.throws(() => parseClamdResponse("stream: size limit exceeded ERROR\0"), /invalid response/u);
});

test("Clamd scanner rejects a connection closed before a complete response", async () => {
  const socket = Object.assign(new EventEmitter(), {
    setTimeout() {}, destroy() {}, write() {}
  });
  const scanner = new ClamdScanner({ host: "127.0.0.1", port: 3310, timeoutMs: 1000, connect: () => socket });
  process.nextTick(() => { socket.emit("connect"); socket.emit("close"); });
  await assert.rejects(() => scanner.scan(Buffer.from("safe")), /closed without a response/u);
});
