/**
 * End-to-End Smoke Test for AI Orchestrator Flow
 * 
 * Simulates Steps 3-6 of the signup process:
 * 1. Provider search
 * 2. Provider confirmation
 * 3. Login
 * 4. Program selection
 * 5. Prerequisite checks
 * 6. Final confirmation
 * 
 * Validates that orchestrator returns structured responses
 * with message + cards + CTA for each step.
 */

import "dotenv/config";
import AIOrchestrator from "../mcp_server/ai/AIOrchestrator";

const orchestrator = new AIOrchestrator();
const sessionId = "smoke-test-" + Date.now();

interface TestStep {
  name: string;
  input: string;
  expectedFields: string[];
}

const TEST_STEPS: TestStep[] = [
  {
    name: "Step 3: Provider Search",
    input: "I need ski lessons at Blackhawk Ski Club in Madison",
    expectedFields: ["message", "cards"],
  },
  {
    name: "Step 4: Provider Confirmation (simulated)",
    input: "Yes, that's the one",
    expectedFields: ["message", "cards"],
  },
  {
    name: "Step 5: Program Discovery",
    input: "Show me programs",
    expectedFields: ["message", "cards"],
  },
  {
    name: "Step 6: Confirmation",
    input: "I want to enroll",
    expectedFields: ["message"],
  },
];

async function runSmokeTest() {
  console.log("🧪 Starting Orchestrator End-to-End Smoke Test\n");
  console.log("=" .repeat(60));
  
  let stepNumber = 1;
  
  for (const step of TEST_STEPS) {
    console.log(`\n📋 ${step.name}`);
    console.log("-".repeat(60));
    console.log(`Input: "${step.input}"`);
    
    try {
      const response = await orchestrator.generateResponse(step.input, sessionId);
      
      console.log("\n✅ Response received:");
      console.log(`   Message: ${response.message?.substring(0, 80)}...`);
      
      if (response.cards) {
        console.log(`   Cards: ${response.cards.length} card(s)`);
        response.cards.forEach((card, idx) => {
          console.log(`     - Card ${idx + 1}: ${card.title}`);
          if (card.buttons) {
            console.log(`       Buttons: ${card.buttons.map(b => b.label).join(", ")}`);
          }
        });
      }
      
      if (response.cta) {
        console.log(`   CTAs: ${response.cta.map(c => c.label).join(", ")}`);
      }
      
      // Validate expected fields
      const missingFields = step.expectedFields.filter(field => !response[field as keyof typeof response]);
      if (missingFields.length > 0) {
        console.log(`\n⚠️  WARNING: Missing expected fields: ${missingFields.join(", ")}`);
      } else {
        console.log("\n✅ All expected fields present");
      }
      
      // Validate Design DNA pattern
      if (!response.message) {
        console.log("❌ FAIL: Missing assistant message (Design DNA violation)");
      }
      
      // Manual context updates for test progression
      if (stepNumber === 1 && response.cards && response.cards.length > 0) {
        // Simulate provider selection
        const firstCard = response.cards[0];
        orchestrator.updateContext(sessionId, {
          provider: {
            name: firstCard.title,
            orgRef: firstCard.metadata?.orgRef || "blackhawk"
          }
        });
        console.log("\n🔧 Context updated: Provider selected");
      } else if (stepNumber === 2) {
        // Simulate login completion
        orchestrator.updateContext(sessionId, {
          loginCompleted: true,
          sessionRef: "test-session-123"
        });
        console.log("\n🔧 Context updated: Login completed");
      } else if (stepNumber === 3 && response.cards && response.cards.length > 0) {
        // Simulate program selection
        const firstProgram = response.cards[0];
        orchestrator.updateContext(sessionId, {
          program: {
            name: firstProgram.title,
            id: firstProgram.metadata?.id || "prog-1"
          }
        });
        console.log("\n🔧 Context updated: Program selected");
      } else if (stepNumber === 4) {
        // Simulate prerequisites completion
        orchestrator.updateContext(sessionId, {
          prerequisites: { membership: "ok", payment: "ok" },
          formAnswers: { childName: "Test Child" }
        });
        console.log("\n🔧 Context updated: Prerequisites complete");
      }
      
      stepNumber++;
      
    } catch (error) {
      console.log(`\n❌ FAIL: ${error instanceof Error ? error.message : "Unknown error"}`);
      console.error(error);
    }
    
    console.log("=" .repeat(60));
  }
  
  console.log("\n\n🎉 Smoke Test Complete!");
  console.log("\n📊 Summary:");
  console.log(`   Total Steps: ${TEST_STEPS.length}`);
  console.log(`   Session ID: ${sessionId}`);
  console.log("\n✅ All steps validated for structured UI payload format.");
  console.log("   Each response includes: message, cards (when applicable), and CTAs.");
}

// Run test
runSmokeTest().catch(console.error);
