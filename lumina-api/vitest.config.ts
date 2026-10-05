import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      LUMINA_MASTER_KEY: "test-master-key-0123456789abcdef-0123456789abcdef",
      LUMINA_DB_PATH: "./data/test.db",
      LUMINA_MOCK: "true",
      LUMINA_POOL_DAILY_LIMIT: "3",
    },
    testTimeout: 20000,
  },
});
