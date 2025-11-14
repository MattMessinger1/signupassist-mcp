/**
 * Test Script: New AAP Triage System
 * 
 * Tests the new structured AAP (Age-Activity-Provider) triage system
 * with the three critical test cases from the migration plan.
 */

import "dotenv/config";
import { triageAAP } from "../mcp_server/ai/aapTriageTool.js";
import { planProgramDiscovery } from "../mcp_server/ai/aapDiscoveryPlanner.js";
import type { AAPTriad, AAPAskedFlags } from "../mcp_server/types/aap.js";

console.log("🧪 Testing New AAP Triage System\n");
console.log("=" .repeat(60));

// Test Case 1: "Blackhawk ski" loop fix
async function testCase1() {
  console.log("\n📋 TEST CASE 1: Blackhawk Ski Loop Fix");
  console.log("-".repeat(60));
  
  // Turn 1: User mentions provider + activity, missing age
  const turn1Messages = [
    { role: 'user', content: "I'd like to sign up my kids for blackhawk ski" }
  ];
  
  const askedFlags1: AAPAskedFlags = {
    asked_age: false,
    asked_activity: false,
    asked_provider: false
  };
  
  const result1 = await triageAAP(turn1Messages, null, {}, askedFlags1);
  
  console.log("\n✅ Turn 1 Results:");
  console.log("AAP State:", JSON.stringify(result1.aap, null, 2));
  console.log("Follow-up Questions:", result1.followup_questions);
  console.log("Ready for Discovery:", result1.ready_for_discovery);
  console.log("Asked Flags After:", { ...askedFlags1, asked_age: true });
  
  // Validate Turn 1
  const pass1 = 
    result1.aap.activity?.status === 'known' &&
    result1.aap.provider?.status === 'known' &&
    result1.aap.age?.status === 'unknown' &&
    result1.followup_questions.length === 1 &&
    !result1.ready_for_discovery;
  
  console.log(pass1 ? "✅ PASS" : "❌ FAIL");
  
  // Turn 2: User provides age
  const turn2Messages = [
    { role: 'user', content: "I'd like to sign up my kids for blackhawk ski" },
    { role: 'assistant', content: result1.followup_questions[0] },
    { role: 'user', content: "9" }
  ];
  
  const askedFlags2: AAPAskedFlags = {
    asked_age: true,
    asked_activity: false,
    asked_provider: false
  };
  
  const result2 = await triageAAP(turn2Messages, result1.aap, {}, askedFlags2);
  
  console.log("\n✅ Turn 2 Results:");
  console.log("AAP State:", JSON.stringify(result2.aap, null, 2));
  console.log("Follow-up Questions:", result2.followup_questions);
  console.log("Ready for Discovery:", result2.ready_for_discovery);
  
  // Validate Turn 2
  const pass2 = 
    result2.aap.activity?.status === 'known' &&
    result2.aap.provider?.status === 'known' &&
    result2.aap.age?.status === 'known' &&
    result2.followup_questions.length === 0 &&
    result2.ready_for_discovery;
  
  console.log(pass2 ? "✅ PASS - No provider re-ask!" : "❌ FAIL - Provider was re-asked");
  
  return pass1 && pass2;
}

// Test Case 2: Declined provider
async function testCase2() {
  console.log("\n📋 TEST CASE 2: Declined Provider");
  console.log("-".repeat(60));
  
  // Turn 1: Age + Activity, no provider
  const turn1Messages = [
    { role: 'user', content: "I want ski lessons for my 9 year old" }
  ];
  
  const askedFlags1: AAPAskedFlags = {
    asked_age: false,
    asked_activity: false,
    asked_provider: false
  };
  
  const result1 = await triageAAP(turn1Messages, null, {}, askedFlags1);
  
  console.log("\n✅ Turn 1 Results:");
  console.log("AAP State:", JSON.stringify(result1.aap, null, 2));
  console.log("Follow-up Questions:", result1.followup_questions);
  
  // Turn 2: User declines to specify provider
  const turn2Messages = [
    { role: 'user', content: "I want ski lessons for my 9 year old" },
    { role: 'assistant', content: result1.followup_questions[0] || "Do you have a provider in mind?" },
    { role: 'user', content: "not sure" }
  ];
  
  const askedFlags2: AAPAskedFlags = {
    asked_age: false,
    asked_activity: false,
    asked_provider: true
  };
  
  const result2 = await triageAAP(turn2Messages, result1.aap, {}, askedFlags2);
  
  console.log("\n✅ Turn 2 Results:");
  console.log("AAP State:", JSON.stringify(result2.aap, null, 2));
  console.log("Follow-up Questions:", result2.followup_questions);
  console.log("Ready for Discovery:", result2.ready_for_discovery);
  console.log("Assumptions:", result2.assumptions);
  
  const pass = 
    result2.aap.provider?.status === 'unknown' &&
    result2.followup_questions.length === 0 &&
    result2.ready_for_discovery;
  
  console.log(pass ? "✅ PASS - No more provider questions" : "❌ FAIL - Asked provider again");
  
  return pass;
}

// Test Case 3: All-at-once
async function testCase3() {
  console.log("\n📋 TEST CASE 3: All-At-Once");
  console.log("-".repeat(60));
  
  const messages = [
    { role: 'user', content: "Sign up my 9 year old for blackhawk ski lessons" }
  ];
  
  const askedFlags: AAPAskedFlags = {
    asked_age: false,
    asked_activity: false,
    asked_provider: false
  };
  
  const result = await triageAAP(messages, null, {}, askedFlags);
  
  console.log("\n✅ Results:");
  console.log("AAP State:", JSON.stringify(result.aap, null, 2));
  console.log("Follow-up Questions:", result.followup_questions);
  console.log("Ready for Discovery:", result.ready_for_discovery);
  
  const pass = 
    result.aap.age?.status === 'known' &&
    result.aap.activity?.status === 'known' &&
    result.aap.provider?.status === 'known' &&
    result.followup_questions.length === 0 &&
    result.ready_for_discovery;
  
  console.log(pass ? "✅ PASS - Immediate discovery" : "❌ FAIL - Asked unnecessary questions");
  
  // Test discovery planner
  if (pass) {
    console.log("\n🔍 Testing Discovery Planner...");
    const plan = await planProgramDiscovery(result.aap, "Sign up my 9 year old for blackhawk ski lessons");
    console.log("Discovery Plan:", JSON.stringify(plan, null, 2));
  }
  
  return pass;
}

// Run all tests
(async () => {
  try {
    const results = await Promise.all([
      testCase1(),
      testCase2(),
      testCase3()
    ]);
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 FINAL RESULTS");
    console.log("=".repeat(60));
    console.log(`Test Case 1 (Blackhawk Loop): ${results[0] ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`Test Case 2 (Declined Provider): ${results[1] ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`Test Case 3 (All-At-Once): ${results[2] ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`\nOverall: ${results.every(r => r) ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);
    
    process.exit(results.every(r => r) ? 0 : 1);
  } catch (error) {
    console.error("\n❌ Test Error:", error);
    process.exit(1);
  }
})();
