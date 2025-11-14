/**
 * check-response-latency.js
 * 
 * Measures response time for orchestrator requests and fails if latency
 * exceeds the acceptable budget (10 seconds).
 * 
 * Exits with code 1 if response time > 10,000ms
 */

import "dotenv/config";
import AIOrchestrator from "../mcp_server/ai/AIOrchestrator.js";

const orchestrator = new AIOrchestrator();
const sessionId = `latency-test-${Date.now()}`;

const MAX_LATENCY_MS = 10000; // 10 seconds

async function checkResponseLatency() {
  console.log("🧪 Testing Orchestrator Response Latency...\n");
  console.log(`⏱️  Maximum allowed latency: ${MAX_LATENCY_MS}ms\n`);

  try {
    const testMessage = "I want to sign up for Blackhawk Ski Club";
    
    console.log(`📝 Sending test message: "${testMessage}"\n`);
    
    const startTime = Date.now();
    
    await orchestrator.generateResponse(testMessage, sessionId);
    
    const endTime = Date.now();
    const latency = endTime - startTime;
    
    console.log(`⏱️  Response time: ${latency}ms\n`);
    
    if (latency > MAX_LATENCY_MS) {
      console.error("❌ VIOLATION: Response latency exceeds budget");
      console.error(`   Measured: ${latency}ms`);
      console.error(`   Budget: ${MAX_LATENCY_MS}ms`);
      console.error(`   Exceeded by: ${latency - MAX_LATENCY_MS}ms\n`);
      
      console.error("💡 Suggestions to reduce latency:");
      console.error("   - Check for redundant API calls");
      console.error("   - Review prompt complexity");
      console.error("   - Verify no unnecessary sequential operations");
      console.error("   - Check for database query bottlenecks\n");
      
      process.exit(1);
    }
    
    const percentageOfBudget = ((latency / MAX_LATENCY_MS) * 100).toFixed(1);
    
    console.log("✅ Response Latency Check: PASSED");
    console.log(`   Response time within budget (${percentageOfBudget}% of max)\n`);
    
    // Warning if we're using more than 80% of budget
    if (latency > MAX_LATENCY_MS * 0.8) {
      console.warn("⚠️  WARNING: Response time is using >80% of latency budget");
      console.warn(`   Consider optimizing to maintain headroom\n`);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error("❌ Response Latency Check: FAILED");
    console.error("   Error:", error.message);
    console.error("   Stack:", error.stack);
    process.exit(1);
  }
}

// Run the check
checkResponseLatency();
