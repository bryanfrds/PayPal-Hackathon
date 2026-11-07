import { defineConfig } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT ?? 3005);
const baseURL = `http://localhost:${e2ePort}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL,
  },
  webServer: {
    command: `${npmCommand} run dev -- -p ${e2ePort}`,
    url: `${baseURL}/sign-in`,
    reuseExistingServer,
    timeout: 60000,
    env: {
      PORT: String(e2ePort),
      NODE_ENV: "test",
      DATABASE_URL: "",
      PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com",
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      CRON_SECRET: "test-cron-secret-12345",
      AUTH_SECRET: "local-development-secret-that-is-at-least-32-chars-long",
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
