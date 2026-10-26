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
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      PORT: "3005",
      NODE_ENV: "test",
      DATABASE_URL: "",
      PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com",
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      CRON_SECRET: "test-cron-secret-12345",
      AUTH_SECRET: "local-development-secret-that-is-at-least-32-chars-long",
      NEXT_PUBLIC_APP_URL: "http://localhost:3005",
    },
  },
});
