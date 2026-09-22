import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import baseConfig from "../../vite.config.js";

export default defineConfig((environment) => {
  const config = typeof baseConfig === "function" ? baseConfig(environment) : baseConfig;
  return {
    ...config,
    server: {
      ...config.server,
      fs: { ...config.server?.fs, allow: [...(config.server?.fs?.allow ?? []), realpathSync(fileURLToPath(new URL("../../../node_modules", import.meta.url)))] }
    }
  };
});
