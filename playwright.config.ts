import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3005",
  },
  webServer: {
    command: "npm run start -- -p 3005",
    url: "http://localhost:3005/sign-in",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
