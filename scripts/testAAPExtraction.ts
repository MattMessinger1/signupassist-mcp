/**
 * Test script for AAP (Age-Activity-Provider) extraction
 * 
 * Tests the AI-powered intent parsing to ensure proper extraction of:
 * - Provider names (especially aim-design / Bookeo orgs)
 * - Activity categories
 * - Child ages
 * 
 * Run with: npm run test:aap-extraction
 */

import "dotenv/config";
import { parseIntentWithAI } from "../mcp_server/lib/aiIntentParser.js";
import { mapIntentToAAP } from "../mcp_server/ai/preLoginNarrowing.js";

const testCases = [
  {
    description: "First message - provider only",
    input: "I'd like to sign up my kids for AIM Design",
    expectedProvider: "aim-design",
    expectedCategory: null,
    expectedAge: null
  },
  {
    description: "Second message - age and activity",
    input: "9 and ski lessons",
    expectedProvider: null,
    expectedCategory: "lessons",
    expectedAge: 9
  },
  {
    description: "Combined message - all three",
    input: "AIM Design robotics for 9 year old",
    expectedProvider: "aim-design",
    expectedCategory: "lessons",
    expectedAge: 9
  },
  {
    description: "Alternative phrasing - comma separated",
    input: "nordic ski, 9",
    expectedProvider: null,
    expectedCategory: "lessons",
    expectedAge: 9
  },
  {
    description: "Provider with 'for' preposition",
    input: "sign up for AIM Design",
    expectedProvider: "aim-design",
    expectedCategory: null,
    expectedAge: null
  },
  {
    description: "Provider with 'at' preposition",
    input: "register at AIM Design STEM",
    expectedProvider: "aim-design",
    expectedCategory: null,
    expectedAge: null
  }
];

console.log("🧪 Testing AAP Extraction with OpenAI\n");
console.log("=" .repeat(60));

let passCount = 0;
let failCount = 0;

for (const testCase of testCases) {
  console.log(`\n📝 Test: ${testCase.description}`);
  console.log(`   Input: "${testCase.input}"`);
  
  try {
    const result = await parseIntentWithAI(testCase.input);
    
    console.log(`   ✅ Extracted:`, {
      provider: result.provider || "null",
      category: result.category || "null",
      childAge: result.childAge || "null"
    });
    
    // Validate results
    const providerMatch = result.provider === testCase.expectedProvider;
    const categoryMatch = result.category === testCase.expectedCategory;
    const ageMatch = result.childAge === testCase.expectedAge;
    
    if (providerMatch && categoryMatch && ageMatch) {
      console.log(`   ✅ PASS - All fields match expected`);
      passCount++;
    } else {
      console.log(`   ❌ FAIL - Mismatch detected:`);
      if (!providerMatch) console.log(`      Provider: expected "${testCase.expectedProvider}", got "${result.provider}"`);
      if (!categoryMatch) console.log(`      Category: expected "${testCase.expectedCategory}", got "${result.category}"`);
      if (!ageMatch) console.log(`      Age: expected ${testCase.expectedAge}, got ${result.childAge}`);
      failCount++;
    }
    
  } catch (error: any) {
    console.log(`   ❌ ERROR: ${error.message}`);
    failCount++;
  }
}

console.log("\n" + "=".repeat(60));
console.log(`\n📊 Test Results: ${passCount} passed, ${failCount} failed`);

// Test context merging
console.log("\n\n🔄 Testing Context Merging\n");
console.log("=".repeat(60));

const contextTest = {
  firstMessage: "I'd like to sign up my kids for AIM Design",
  secondMessage: "9 and ski lessons"
};

console.log(`\n📝 Scenario: Two-message flow`);
console.log(`   Message 1: "${contextTest.firstMessage}"`);

const firstResult = await parseIntentWithAI(contextTest.firstMessage);
const firstTriad = mapIntentToAAP(firstResult);

console.log(`   First AAP:`, firstTriad);

console.log(`\n   Message 2: "${contextTest.secondMessage}"`);

const secondResult = await parseIntentWithAI(contextTest.secondMessage);
const secondTriad = mapIntentToAAP(secondResult, {
  provider: firstTriad.provider,
  activity: firstTriad.activity,
  age: firstTriad.age
});

console.log(`   Second AAP:`, secondTriad);

if (secondTriad.complete && secondTriad.provider === "aim-design" && secondTriad.age === 9) {
  console.log(`\n   ✅ PASS - Context preserved and merged correctly`);
  passCount++;
} else {
  console.log(`\n   ❌ FAIL - Context merge failed`);
  console.log(`      Expected: complete=true, provider="aim-design", age=9`);
  console.log(`      Got: complete=${secondTriad.complete}, provider="${secondTriad.provider}", age=${secondTriad.age}`);
  failCount++;
}

console.log("\n" + "=".repeat(60));
console.log(`\n📊 Final Results: ${passCount} passed, ${failCount} failed\n`);

process.exit(failCount > 0 ? 1 : 0);
