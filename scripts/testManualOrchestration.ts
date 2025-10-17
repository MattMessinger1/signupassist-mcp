import "dotenv/config";
import AIOrchestrator from "../mcp_server/ai/AIOrchestrator";

const orchestrator = new AIOrchestrator();
const session = "manual-orch-test";

(async () => {
  console.log("=== Testing Manual Orchestration Flow ===\n");
  
  console.log("STEP 1: Provider Search");
  let result = await orchestrator.generateResponse("Blackhawk Ski Club", session);
  console.log("Result:", JSON.stringify(result, null, 2));
  console.log("\n---\n");

  console.log("STEP 2: Program Selection");
  orchestrator.updateContext(session, { provider: { name: "Blackhawk Ski Club", orgRef: "blackhawk" } });
  result = await orchestrator.generateResponse("Show me programs", session);
  console.log("Result:", JSON.stringify(result, null, 2));
  console.log("\n---\n");

  console.log("STEP 3: Prerequisite Check");
  orchestrator.updateContext(session, { program: { name: "Beginner Ski Class", id: "prog1" } });
  result = await orchestrator.generateResponse("Check prerequisites", session);
  console.log("Result:", JSON.stringify(result, null, 2));
  console.log("\n---\n");

  console.log("STEP 4: Form Fill");
  orchestrator.updateContext(session, { prerequisites: { membership: "ok", payment: "ok" } });
  result = await orchestrator.generateResponse("Ready to fill form", session);
  console.log("Result:", JSON.stringify(result, null, 2));
  console.log("\n---\n");

  console.log("STEP 5: Confirmation");
  orchestrator.updateContext(session, { formAnswers: { child: "Alice" } });
  result = await orchestrator.generateResponse("Confirm registration", session);
  console.log("Result:", JSON.stringify(result, null, 2));
  console.log("\n---\n");

  console.log("=== Manual Orchestration Flow Complete ===");
})();
