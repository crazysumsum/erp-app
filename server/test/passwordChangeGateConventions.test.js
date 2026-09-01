import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PASSWORD_CHANGE_GATE_EXEMPTIONS } from "../src/services/auth/passwordChangeGate.js";

/**
 * 豁免清單會不會跟著路徑改動而失效：會，而且失效的方式很糟——某支端點改了
 * 路徑，清單卻沒跟著改，使用者就會被永久鎖在改密碼頁，連改密碼那一支都打不
 * 通。這裡把 handler 目錄掃一遍、解析出所有已註冊的 route，斷言豁免清單裡的
 * 每一條都真的對得上一條。改路徑而忘了改清單，這裡會紅。設計說明見
 * docs/user-management.md §3.5。
 */

const handlersDirectory = fileURLToPath(new URL("../src/handlers/", import.meta.url));

async function handlerFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await handlerFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(pathToFileURL(entryPath).href);
    }
  }

  return files;
}

test("every password-change-gate exemption matches a registered route", async () => {
  const files = await handlerFiles(handlersDirectory);
  assert.ok(files.length > 0, "no handlers were found");

  const registered = new Set();

  for (const url of files) {
    const module = await import(url);

    for (const HandlerClass of Object.values(module)) {
      if (typeof HandlerClass !== "function" || !Object.hasOwn(HandlerClass, "api")) {
        continue;
      }

      registered.add(`${HandlerClass.api.method} ${HandlerClass.api.path}`);
    }
  }

  for (const exemption of PASSWORD_CHANGE_GATE_EXEMPTIONS) {
    assert.ok(
      registered.has(exemption),
      `"${exemption}" is in the password-change-gate exemption list but is not a registered route`
    );
  }
});

test("every exemption is a static path with no route parameters", () => {
  // 比對用的是 `${method} ${req.path}` 字串相等，不是 route 比對，所以豁免清單
  // 裡不能出現 :param——那樣的路徑永遠比對不到任何一個真的請求路徑。
  for (const exemption of PASSWORD_CHANGE_GATE_EXEMPTIONS) {
    assert.doesNotMatch(exemption, /:/, `"${exemption}" looks like it has a route parameter`);
  }
});
