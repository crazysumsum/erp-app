import config from "./vitest.config.js";

// The capacity runner supplies exact files, case names and its PASS count gate.
export default {
  ...config,
  test: { ...config.test, include: ["test/**/*.test.js", "test-capacity/**/*.capacity.js"] }
};
