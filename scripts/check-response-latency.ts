/**
 * check-response-latency.ts
 *
 * Measures response time for orchestrator requests and fails if latency
 * exceeds the acceptable budget (10 seconds).
 */

import 'dotenv/config';
import AIOrchestrator from '../mcp_server/ai/AIOrchestrator';

const orchestrator = new AIOrchestrator();
const sessionId = `latency-test-${Date.now()}`;

const MAX_LATENCY_MS = 10000;

async function checkResponseLatency() {
  console.log('🧪 Testing Orchestrator Response Latency...\n');
  console.log(`⏱️  Maximum allowed latency: ${MAX_LATENCY_MS}ms\n`);

  try {
    const testMessage = 'I want to sign up for Blackhawk Ski Club';
    console.log(`📝 Sending test message: "${testMessage}"\n`);

    const startTime = Date.now();
    await orchestrator.generateResponse(testMessage, sessionId);
    const latency = Date.now() - startTime;

    console.log(`⏱️  Response time: ${latency}ms\n`);

    if (latency > MAX_LATENCY_MS) {
      console.error('❌ VIOLATION: Response latency exceeds budget');
      console.error(`   Measured: ${latency}ms`);
      console.error(`   Budget: ${MAX_LATENCY_MS}ms`);
      console.error(`   Exceeded by: ${latency - MAX_LATENCY_MS}ms\n`);
      process.exit(1);
    }

    const percentageOfBudget = ((latency / MAX_LATENCY_MS) * 100).toFixed(1);
    console.log('✅ Response Latency Check: PASSED');
    console.log(`   Response time within budget (${percentageOfBudget}% of max)\n`);

    if (latency > MAX_LATENCY_MS * 0.8) {
      console.warn('⚠️  WARNING: Response time is using >80% of latency budget');
      console.warn('   Consider optimizing to maintain headroom\n');
    }

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Response Latency Check: FAILED');
    console.error('   Error:', error?.message || String(error));
    console.error('   Stack:', error?.stack || 'n/a');
    process.exit(1);
  }
}

void checkResponseLatency();
