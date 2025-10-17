import "dotenv/config";
import { parseProviderInput } from "../mcp_server/utils/parseInput";
import AIOrchestrator from "../mcp_server/ai/AIOrchestrator";

(async () => {
  const examples = [
    "Blackhawk ski club Madison",
    "Enroll at madison nordic ski",
    "I want Blackhawk in Middleton WI",
    "blackhawk sklub madisn"
  ];

  console.log("🧩 Heuristic parser tests:\n");
  examples.forEach(e => {
    const result = parseProviderInput(e);
    console.log(`Input: "${e}"`);
    console.log(`  → name: "${result.name}", city: ${result.city || "none"}\n`);
  });

  const orchestrator = new AIOrchestrator();
  console.log("\n🤖 AI-assisted parsing tests:\n");
  
  for (const example of examples) {
    try {
      // Access private method for testing (TypeScript workaround)
      const parsed = await (orchestrator as any).aiParseProviderInput(example);
      console.log(`Input: "${example}"`);
      console.log(`  → AI parsed:`, parsed);
      console.log("");
    } catch (error) {
      console.error(`Failed to parse "${example}":`, error);
    }
  }
  
  console.log("✅ Parser testing completed.");
})();
