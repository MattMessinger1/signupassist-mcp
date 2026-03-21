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

// Test Case 1: "AIM Design" loop fix
async function testCase1() {
  console.log("\n📋 TEST CASE 1: AIM Design Loop Fix");
  console.log("-".repeat(60));
  
  // Turn 1: User mentions provider + activity, missing age
  const turn1Messages = [
    { role: 'user', content: "I'd like to sign up my kids for AIM Design classes" }
  ];
  
  const askedFlags1: AAPAskedFlags = {
    asked_age: false,
    asked_activity: false,
    asked_provider: false,
    asked_location: false
  };
  
  const result1 = await triageAAP(turn1Messages, null, {}, askedFlags1, "I'd like to sign up my kids for AIM Design classes");
  
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
    { role: 'user', content: "I'd like to sign up my kids for AIM Design classes" },
    { role: 'assistant', content: result1.followup_questions[0] },
    { role: 'user', content: "9" }
  ];
  
  const askedFlags2: AAPAskedFlags = {
    asked_age: true,
    asked_activity: false,
    asked_provider: false,
    asked_location: false
  };
  
  const result2 = await triageAAP(turn2Messages, result1.aap, {}, askedFlags2, "9");
  
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

// Test Case 4: Local search with IP location
async function testCase4() {
  console.log("\n📋 TEST CASE 4: Local Search (IP Location)");
  console.log("-".repeat(60));
  
  // User provides age + activity, location from IP
  const messages = [
    { role: 'user', content: "I want ski lessons for my 9 year old" }
  ];
  
  const requestHints = {
    childAge: 9,
    location: {
      lat: 43.0731,
      lng: -89.4012,
      city: "Madison",
      region: "Wisconsin",
      country: "US",
      radiusKm: 25,
      source: 'ip' as const
    }
  };
  
  const askedFlags: AAPAskedFlags = {
    asked_age: false,
    asked_activity: false,
    asked_provider: false,
    asked_location: false
  };
  
  const result = await triageAAP(messages, null, requestHints, askedFlags, "I want ski lessons for my 9 year old");
  
  console.log("\n✅ Results:");
  console.log("AAP State:", JSON.stringify(result.aap, null, 2));
  console.log("Follow-up Questions:", result.followup_questions);
  console.log("Ready for Discovery:", result.ready_for_discovery);
  
  // Validate: Should use local mode
  const pass = 
    result.aap.age?.status === 'known' &&
    result.aap.activity?.status === 'known' &&
    result.aap.provider?.status === 'unknown' &&
    result.aap.provider?.mode === 'local' &&
    result.aap.provider?.locationHint?.city === 'Madison' &&
    result.followup_questions.length === 0 &&
    result.ready_for_discovery;
  
  console.log(pass ? "✅ PASS - Local mode with location!" : "❌ FAIL");
  
  // Test discovery planner with location
  if (pass) {
    console.log("\n🔍 Testing Discovery Planner with Location:");
    const plan = await planProgramDiscovery(result.aap, "I want ski lessons for my 9 year old");
    console.log("Discovery Plan:", JSON.stringify(plan, null, 2));
    
    const planPass = 
      plan.feed_query.category === 'skiing' &&
      plan.feed_query.location?.lat === 43.0731 &&
      plan.feed_query.location?.lng === -89.4012 &&
      plan.feed_query.location?.radiusKm === 25;
    
    console.log(planPass ? "✅ PASS - Location in feed query!" : "❌ FAIL - Missing location");
    return planPass;
  }
  
  return pass;
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
    asked_provider: false,
    asked_location: false
  };
  
  const result1 = await triageAAP(turn1Messages, null, {}, askedFlags1, "I want ski lessons for my 9 year old");
  
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
    asked_provider: true,
    asked_location: false
  };
  
  const result2 = await triageAAP(turn2Messages, result1.aap, {}, askedFlags2, "not sure");
  
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

// Test Case 4: Local search with IP location
async function testCase4() {
  console.log("\n📋 TEST CASE 4: Local Search (IP Location)");
  console.log("-".repeat(60));
  
  // User provides age + activity, location from IP
  const messages = [
    { role: 'user', content: "I want ski lessons for my 9 year old" }
  ];
  
  const requestHints = {
    childAge: 9,
    location: {
      lat: 43.0731,
      lng: -89.4012,
      city: "Madison",
      region: "Wisconsin",
      country: "US",
      radiusKm: 25,
      source: 'ip' as const
    }
  };
  
  const askedFlags: AAPAskedFlags = {
    asked_age: false,
    asked_activity: false,
    asked_provider: false,
    asked_location: false
  };
  
  const result = await triageAAP(messages, null, requestHints, askedFlags, "I want ski lessons for my 9 year old");
  
  console.log("\n✅ Results:");
  console.log("AAP State:", JSON.stringify(result.aap, null, 2));
  console.log("Follow-up Questions:", result.followup_questions);
  console.log("Ready for Discovery:", result.ready_for_discovery);
  
  // Validate: Should use local mode
  const pass = 
    result.aap.age?.status === 'known' &&
    result.aap.activity?.status === 'known' &&
    result.aap.provider?.status === 'unknown' &&
    result.aap.provider?.mode === 'local' &&
    result.aap.provider?.locationHint?.city === 'Madison' &&
    result.followup_questions.length === 0 &&
    result.ready_for_discovery;
  
  console.log(pass ? "✅ PASS - Local mode with location!" : "❌ FAIL");
  
  // Test discovery planner with location
  if (pass) {
    console.log("\n🔍 Testing Discovery Planner with Location:");
    const plan = await planProgramDiscovery(result.aap, "I want ski lessons for my 9 year old");
    console.log("Discovery Plan:", JSON.stringify(plan, null, 2));
    
    const planPass = 
      plan.feed_query.category === 'skiing' &&
      plan.feed_query.location?.lat === 43.0731 &&
      plan.feed_query.location?.lng === -89.4012 &&
      plan.feed_query.location?.radiusKm === 25;
    
    console.log(planPass ? "✅ PASS - Location in feed query!" : "❌ FAIL - Missing location");
    return planPass;
  }
  
  return pass;
}

// Test Case 3: All-at-once
async function testCase3() {
  console.log("\n📋 TEST CASE 3: All-At-Once");
  console.log("-".repeat(60));
  
  const messages = [
    { role: 'user', content: "Sign up my 9 year old for AIM Design robotics" }
  ];
  
  const askedFlags: AAPAskedFlags = {
    asked_age: false,
    asked_activity: false,
    asked_provider: false,
    asked_location: false
  };
  
  const result = await triageAAP(messages, null, {}, askedFlags, "Sign up my 9 year old for AIM Design robotics");
  
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
    const plan = await planProgramDiscovery(result.aap, "Sign up my 9 year old for AIM Design robotics");
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
      testCase3(),
      testCase4()  // NEW: Local search test
    ]);
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 FINAL RESULTS");
    console.log("=".repeat(60));
    console.log(`Test Case 1 (AIM Design Loop): ${results[0] ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`Test Case 2 (Declined Provider): ${results[1] ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`Test Case 3 (All-At-Once): ${results[2] ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`Test Case 4 (Local Search): ${results[3] ? "✅ PASS" : "❌ FAIL"}`);  // NEW
    console.log(`\nOverall: ${results.every(r => r) ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);
    
    process.exit(results.every(r => r) ? 0 : 1);
  } catch (error) {
    console.error("\n❌ Test Error:", error);
    process.exit(1);
  }
})();
