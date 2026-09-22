import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import baseConfig from "../../vite.config.js";

export default defineConfig((environment) => {
  const config = typeof baseConfig === "function" ? baseConfig(environment) : baseConfig;
  const clientRoot = fileURLToPath(new URL("../..", import.meta.url));
  return {
    ...config,
    root: clientRoot,
    server: {
      ...config.server,
      fs: { ...config.server?.fs, allow: [...(config.server?.fs?.allow ?? []), realpathSync(fileURLToPath(new URL("../../../node_modules", import.meta.url)))] }
    }
  };
});
