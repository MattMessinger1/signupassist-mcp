/**
 * check-aap-first-turn.js
 * 
 * Validates that the AAP orchestrator does not repeat narrowing prompts
 * when a full triad (provider + activity + age) is provided on first turn.
 * 
 * Exits with code 1 if:
 * - Repeated narrowing questions are asked
 * - A second triad question is prompted
 * - ready_for_discovery is not true after full triad
 */

import "dotenv/config";
import AIOrchestrator from "../mcp_server/ai/AIOrchestrator.js";

const orchestrator = new AIOrchestrator();
const sessionId = `aap-first-turn-test-${Date.now()}`;

async function checkAAPFirstTurn() {
  console.log("🧪 Testing AAP First Turn Behavior...\n");

  try {
    // Provide a complete triad in the first message
    const fullTriadMessage = "I want to sign up my 8-year-old daughter for Blackhawk Ski Club lessons";
    
    console.log(`📝 User message: "${fullTriadMessage}"\n`);
    
    const result = await orchestrator.generateResponse(fullTriadMessage, sessionId);
    
    console.log("🔍 Analyzing response...\n");
    
    // Check 1: No repeated narrowing prompts
    const hasNarrowingQuestion = 
      /which provider|what activity|how old|child.*age|program.*type/i.test(result.assistantMessage);
    
    if (hasNarrowingQuestion) {
      console.error("❌ VIOLATION: Repeated narrowing detected after full triad provided");
      console.error("   Assistant message:", result.assistantMessage);
      process.exit(1);
    }
    console.log("✅ No repeated narrowing prompts");
    
    // Check 2: Should not ask for a second triad question
    const asksForMoreInfo = 
      /tell me more|need more information|could you provide/i.test(result.assistantMessage);
    
    if (asksForMoreInfo) {
      console.error("❌ VIOLATION: Asking for more information after full triad");
      console.error("   Assistant message:", result.assistantMessage);
      process.exit(1);
    }
    console.log("✅ No redundant information requests");
    
    // Check 3: Context should show ready_for_discovery or equivalent
    const context = orchestrator.getContext(sessionId);
    
    // Check if we have provider, activity/category, and age info
    const hasProvider = context.provider?.name || context.provider?.orgRef;
    const hasActivity = context.program?.category || context.activity;
    const hasAge = context.child?.age || context.child?.dob || context.age;
    
    if (!hasProvider || !hasActivity || !hasAge) {
      console.error("❌ VIOLATION: Context incomplete after full triad");
      console.error("   Provider:", hasProvider ? "✓" : "✗");
      console.error("   Activity:", hasActivity ? "✓" : "✗");
      console.error("   Age:", hasAge ? "✓" : "✗");
      console.error("   Context:", JSON.stringify(context, null, 2));
      process.exit(1);
    }
    console.log("✅ Context properly populated with full triad");
    
    // Check 4: Should be ready to proceed (not stuck in narrowing loop)
    const isStuck = /I need to know|please tell me|which one|what about/i.test(result.assistantMessage);
    
    if (isStuck) {
      console.error("❌ VIOLATION: Orchestrator appears stuck in narrowing loop");
      console.error("   Assistant message:", result.assistantMessage);
      process.exit(1);
    }
    console.log("✅ Not stuck in narrowing loop");
    
    console.log("\n✅ AAP First Turn Check: PASSED");
    console.log("   All validations successful. No repeated narrowing after full triad.\n");
    
    process.exit(0);
    
  } catch (error) {
    console.error("❌ AAP First Turn Check: FAILED");
    console.error("   Error:", error.message);
    console.error("   Stack:", error.stack);
    process.exit(1);
  }
}

// Run the check
checkAAPFirstTurn();
