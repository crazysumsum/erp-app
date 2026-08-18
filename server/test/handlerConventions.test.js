import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * `src/handlers/` 底下的子目錄名稱就是 API 路徑的前綴：`handlers/user/loginHandler.js`
 * 的路徑是 `/api/v1/user/login`。放在最上層的 handler 沒有前綴。
 *
 * 框架不強制這件事——它照目錄遞迴發現 handler，路徑則完全由 static api.path 決定，
 * 兩者之間沒有任何連結。所以這個約定只能靠這裡守著：不然新增的 handler 會慢慢
 * 漂移，最後目錄結構跟 URL 結構各說各話，而不會有任何東西出聲。
 */

const handlersDirectory = fileURLToPath(new URL("../src/handlers/", import.meta.url));

async function handlerFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await handlerFiles(entryPath, entry.name)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push({ prefix, name: entry.name, url: pathToFileURL(entryPath).href });
    }
  }

  return files;
}

function handlerClasses(moduleNamespace) {
  return Object.values(moduleNamespace).filter(
    (value) => typeof value === "function" && Object.hasOwn(value, "api")
  );
}

test("every handler's directory matches its URL prefix", async () => {
  const files = await handlerFiles(handlersDirectory);

  // 一個空的清單會讓這個測試永遠通過。
  assert.ok(files.length > 0, "no handlers were found");

  for (const file of files) {
    const module = await import(file.url);

    for (const HandlerClass of handlerClasses(module)) {
      const { path: apiPath } = HandlerClass.api;
      // /api/<version>/<剩下的部分>
      const [, , , ...segments] = apiPath.split("/");
      const expected = file.prefix ? [file.prefix] : [];
      const actual = segments.slice(0, expected.length);

      assert.deepEqual(
        actual,
        expected,
        `${HandlerClass.name} is in handlers/${file.prefix || "."} but its path is ${apiPath}`
      );

      // 最上層的 handler 不該有前綴段落：`handlers/healthHandler.js` 是
      // /api/v1/health，不是 /api/v1/system/health——後者的檔案該搬進
      // handlers/system/。
      if (!file.prefix) {
        assert.equal(
          segments.length,
          1,
          `${HandlerClass.name} is at the top level but its path ${apiPath} has a prefix; move the file into that directory`
        );
      }
    }
  }
});
