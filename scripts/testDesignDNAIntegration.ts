import "dotenv/config";
import AIOrchestrator from "../mcp_server/ai/AIOrchestrator";

const orchestrator = new AIOrchestrator();
const session = "design-dna-test";

(async () => {
  console.log("🎨 Testing Design DNA Integration...\n");
  
  const result = await orchestrator.generateResponse(
    "I want to register my child for Blackhawk Ski Club lessons.",
    session
  );

  console.log("\n=== Response Output ===");
  console.log("🧠 Assistant Message:\n", result.assistantMessage);
  console.log("\n🎨 UI Payload:\n", result.uiPayload);
  console.log("\n📋 Context Updates:\n", result.contextUpdates);
  
  console.log("\n✅ Test completed. Check logs above for [DesignDNA] entries.");
})();
