import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Same "@/..." paths as tsconfig, so route handlers can be tested as written.
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // server-only throws outside a React Server Component. Tests run lib/paypal.ts
      // directly, so point the import at the package's no-op entry.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    env: {
      OWNER_EMAILS: "*",
    },
    // Agent worktrees (copies of the repo) live under .claude/; never run their tests here.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
