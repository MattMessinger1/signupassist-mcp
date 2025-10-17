import AIOrchestrator from "../mcp_server/ai/AIOrchestrator";

const orchestrator = new AIOrchestrator();
const session = "parent123";

console.log("=== Testing Context Management ===\n");

// Test 1: Update provider context
console.log("Test 1: Update provider context");
orchestrator.updateContext(session, { 
  provider: { name: "Blackhawk Ski Club", orgRef: "blackhawk-ski" } 
});
console.log("\n---\n");

// Test 2: Update child context
console.log("Test 2: Update child context");
orchestrator.updateContext(session, { 
  child: { name: "Alice", birthdate: "2018-01-20" } 
});
console.log("\n---\n");

// Test 3: Get full context
console.log("Test 3: Get full context after updates");
const context = orchestrator.getContext(session);
console.log("Full context:", JSON.stringify(context, null, 2));
console.log("\n---\n");

// Test 4: Update prerequisites
console.log("Test 4: Update prerequisites");
orchestrator.updateContext(session, {
  prerequisites: {
    membership: "ok",
    waiver: "required",
    payment: "missing"
  }
});
console.log("\n---\n");

// Test 5: Check context before reset
console.log("Test 5: Context before reset");
console.log("Context:", JSON.stringify(orchestrator.getContext(session), null, 2));
console.log("\n---\n");

// Test 6: Reset context
console.log("Test 6: Reset context");
orchestrator.resetContext(session);
console.log("\n---\n");

// Test 7: Check context after reset (should be empty and auto-initialize)
console.log("Test 7: Context after reset");
const resetContext = orchestrator.getContext(session);
console.log("Context:", JSON.stringify(resetContext, null, 2));
console.log("Is empty?", Object.keys(resetContext).length === 0);
console.log("\n---\n");

console.log("=== All context tests complete ===");
