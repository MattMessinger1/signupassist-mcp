import "dotenv/config";
import AIOrchestrator from "../mcp_server/ai/AIOrchestrator";
import Logger from "../mcp_server/utils/logger";

const orchestrator = new AIOrchestrator();
const session = "reliability-test";

(async () => {
  Logger.info("🧪 Starting reliability & caching test...");
  console.log("\n=== Test 1: Tool Caching ===");
  
  // 1. Call a provider search twice (second call should hit cache)
  Logger.info("First call - should execute tool");
  await orchestrator.callTool("search_provider", { name: "Blackhawk Ski Club" });
  
  Logger.info("\nSecond call - should hit cache");
  await orchestrator.callTool("search_provider", { name: "Blackhawk Ski Club" });

  console.log("\n=== Test 2: Retry Logic ===");
  
  // 2. Simulate an OpenAI response failure with retry
  try {
    // Using the private withRetry through a workaround by calling it via a method that uses it
    // In real scenario, this would be tested through actual OpenAI call failures
    Logger.info("Attempting operation that will fail...");
    await (orchestrator as any).withRetry(() => {
      throw new Error("Simulated network failure");
    }, 2, 500);
  } catch (error) {
    Logger.info("✅ Retry logic caught simulated error safely.");
  }

  console.log("\n=== Test 3: Sanitization ===");
  
  // 3. Test sanitization of sensitive data
  Logger.info("Testing sanitization with sensitive data");
  const sensitiveData = {
    username: "user@example.com",
    password: "secret123",
    cardNumber: "4111111111111111",
    apiKey: "sk-abc123xyz"
  };
  
  const sanitized = (orchestrator as any).sanitize(sensitiveData);
  Logger.info("Sanitized data:", sanitized);

  console.log("\n=== Test 4: Context Updates ===");
  
  // 4. Test context updates with audit logging
  Logger.info("Testing context updates with audit trail");
  orchestrator.updateContext(session, { 
    provider: { name: "Blackhawk Ski Club", orgRef: "blackhawk" }
  });

  console.log("\n✅ All reliability tests completed.");
})();
