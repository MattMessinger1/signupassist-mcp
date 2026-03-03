/**
 * check-aap-first-turn.ts
 *
 * Validates that the AAP orchestrator does not repeat narrowing prompts
 * when a full triad (provider + activity + age) is provided on first turn.
 */

import 'dotenv/config';
import AIOrchestrator from '../mcp_server/ai/AIOrchestrator';

async function checkAAPFirstTurn() {
  console.log('🧪 Testing AAP First Turn Behavior...\n');

  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY is not set; skipping AAP first-turn gate in this environment.');
    process.exit(0);
  }

  const orchestrator = new AIOrchestrator();
  const sessionId = `aap-first-turn-test-${Date.now()}`;

  try {
    const fullTriadMessage = 'I want to sign up my 8-year-old daughter for Blackhawk Ski Club lessons';

    console.log(`📝 User message: "${fullTriadMessage}"\n`);

    const result = await orchestrator.generateResponse(fullTriadMessage, sessionId);

    console.log('🔍 Analyzing response...\n');

    const hasNarrowingQuestion = /which provider|what activity|how old|child.*age|program.*type/i.test(result.assistantMessage);
    if (hasNarrowingQuestion) {
      console.error('❌ VIOLATION: Repeated narrowing detected after full triad provided');
      console.error('   Assistant message:', result.assistantMessage);
      process.exit(1);
    }
    console.log('✅ No repeated narrowing prompts');

    const asksForMoreInfo = /tell me more|need more information|could you provide/i.test(result.assistantMessage);
    if (asksForMoreInfo) {
      console.error('❌ VIOLATION: Asking for more information after full triad');
      console.error('   Assistant message:', result.assistantMessage);
      process.exit(1);
    }
    console.log('✅ No redundant information requests');

    const context = orchestrator.getContext(sessionId) as any;
    const hasProvider = context.provider?.name || context.provider?.orgRef;
    const hasActivity = context.program?.category || context.activity;
    const hasAge = context.child?.age || context.child?.dob || context.age;

    if (!hasProvider || !hasActivity || !hasAge) {
      console.error('❌ VIOLATION: Context incomplete after full triad');
      console.error('   Provider:', hasProvider ? '✓' : '✗');
      console.error('   Activity:', hasActivity ? '✓' : '✗');
      console.error('   Age:', hasAge ? '✓' : '✗');
      console.error('   Context:', JSON.stringify(context, null, 2));
      process.exit(1);
    }
    console.log('✅ Context properly populated with full triad');

    const isStuck = /I need to know|please tell me|which one|what about/i.test(result.assistantMessage);
    if (isStuck) {
      console.error('❌ VIOLATION: Orchestrator appears stuck in narrowing loop');
      console.error('   Assistant message:', result.assistantMessage);
      process.exit(1);
    }
    console.log('✅ Not stuck in narrowing loop');

    console.log('\n✅ AAP First Turn Check: PASSED');
    console.log('   All validations successful. No repeated narrowing after full triad.\n');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ AAP First Turn Check: FAILED');
    console.error('   Error:', error?.message || String(error));
    console.error('   Stack:', error?.stack || 'n/a');
    process.exit(1);
  }
}

void checkAAPFirstTurn();
