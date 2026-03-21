import "dotenv/config";
import AIOrchestrator from "../mcp_server/ai/AIOrchestrator";

const orchestrator = new AIOrchestrator();

(async () => {
  const result = await orchestrator.generateResponse(
    "I want to sign up my daughter for AIM Design robotics classes",
    "session-openai-test"
  );

  console.log("\n🧠 Assistant Message:\n", result.assistantMessage);
  console.log("\n📦 Structured Output:\n", result);
})();
