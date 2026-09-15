import baseConfig from "../../vitest.config.js";

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["test/business-master/**/*.test.js"]
  }
};
