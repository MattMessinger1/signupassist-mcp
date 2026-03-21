import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    outDir: 'dist/client',
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    exclude: [
      'node_modules/**',
      'dist/**',
      // Deno tests (import from https:// URLs)
      'tests/fingerprint-crypto.test.ts',
      'tests/useDiscoveryHelpers.test.ts',
      // Node test runner tests (use node:test, not vitest)
      'mcp_server/tests/piiCrypto.test.ts',
      'mcp_server/tests/user.pii.integration.test.ts',
    ],
  },
}));
