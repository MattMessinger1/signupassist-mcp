import 'dotenv/config';
import AIOrchestrator from "../mcp_server/ai/AIOrchestrator";

const orchestrator = new AIOrchestrator();

(async () => {
  console.log("=== Testing AI Orchestrator ===\n");
  
  // Test 1: Basic provider search query
  console.log("Test 1: Provider search");
  const result1 = await orchestrator.generateResponse(
    "I want to sign up for Blackhawk Ski Club", 
    "session123"
  );
  console.log("Response:", JSON.stringify(result1, null, 2));
  console.log("\n---\n");

  // Test 2: Follow-up question
  console.log("Test 2: Follow-up question");
  const result2 = await orchestrator.generateResponse(
    "What programs do they have?", 
    "session123"
  );
  console.log("Response:", JSON.stringify(result2, null, 2));
  console.log("\n---\n");

  // Test 3: Tool invocation test
  console.log("Test 3: Tool invocation");
  try {
    const toolResult = await orchestrator.callTool("search_provider", {
      name: "Blackhawk Ski Club",
      location: "Madison, WI"
    });
    console.log("Tool result:", JSON.stringify(toolResult, null, 2));
  } catch (error) {
    console.error("Tool error:", error);
  }
  console.log("\n---\n");

  // Test 4: Check context persistence
  console.log("Test 4: Context persistence");
  const context = orchestrator.getContext("session123");
  console.log("Session context:", JSON.stringify(context, null, 2));
  console.log("\n---\n");

  // Test 5: Update context
  console.log("Test 5: Update context");
  orchestrator.updateContext("session123", {
    selectedProvider: "Blackhawk Ski Club",
    step: "programSelection"
  });
  const updatedContext = orchestrator.getContext("session123");
  console.log("Updated context:", JSON.stringify(updatedContext, null, 2));
  console.log("\n---\n");

  // Test 6: Get prompt template
  console.log("Test 6: Prompt templates");
  const template = orchestrator.getPromptTemplate("programSelection");
  console.log("Program selection template:", template);

  console.log("\n=== All tests complete ===");
})();
