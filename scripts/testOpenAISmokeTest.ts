/**
 * Standalone runner for OpenAI smoke test
 * Run with: npx tsx scripts/testOpenAISmokeTest.ts
 */

import "dotenv/config";
import { runOpenAISmokeTests } from "../mcp_server/startup/openaiSmokeTest";

(async () => {
  console.log("🧪 Running OpenAI smoke tests...\n");
  
  try {
    const success = await runOpenAISmokeTests({ failFast: true });
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error("❌ Smoke test failed with error:", error);
    process.exit(1);
  }
})();
