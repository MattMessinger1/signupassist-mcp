/**
 * OpenAI Boot-Time Smoke Test
 * 
 * Validates that both Responses API and Chat Completions API are correctly configured
 * with proper parameter families (text.format vs response_format).
 * 
 * Runs on server startup to fail fast if OpenAI integration is misconfigured.
 */

import OpenAI from "openai";
import { buildOpenAIBody, supportsCustomTemperature } from "../lib/openaiHelpers.js";

const SMOKE_TEST_TIMEOUT = 10000; // 10 seconds

interface SmokeTestResult {
  success: boolean;
  message: string;
  details?: any;
}

/**
 * Test Responses API with correct text.format structure
 */
async function testResponsesAPI(openai: OpenAI): Promise<SmokeTestResult> {
  try {
    // NOTE: Intentionally using mini model for smoke test to keep boot time fast and costs low
    // This validates API connectivity and parameter structure, not extraction accuracy
    // Production extraction uses OPENAI_MODEL_PROGRAM_* env vars (gpt-4o)
    const model = "gpt-4o-mini";
    const messages = [
      { role: "system", content: "Return valid JSON only." },
      { role: "user", content: '{"test": "smoke test"}' }
    ];
    
    const body = buildOpenAIBody({
      model,
      apiFamily: "responses",
      messages,
      maxTokens: 50,
      temperature: supportsCustomTemperature(model) ? 0.1 : undefined
    });

    console.log('[SMOKE] Testing Responses API...');
    const response = await openai.responses.create(body as any);
    
    const text = (response as any).output_text ?? (response as any).output?.[0]?.content?.[0]?.text;
    if (!text) {
      return {
        success: false,
        message: 'Responses API returned no text output',
        details: response
      };
    }

    return {
      success: true,
      message: '✅ Responses API test passed',
      details: { model, textLength: text.length }
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Responses API test failed: ${error.message}`,
      details: {
        error: error.message,
        param: error?.error?.param || error?.param,
        code: error?.error?.code || error?.code,
        type: error?.error?.type || error?.type
      }
    };
  }
}

/**
 * Test Chat Completions API with correct response_format structure
 */
async function testChatCompletionsAPI(openai: OpenAI): Promise<SmokeTestResult> {
  try {
    // NOTE: Intentionally using mini model for smoke test to keep boot time fast and costs low
    // This validates API connectivity and parameter structure, not extraction accuracy
    // Production extraction uses OPENAI_MODEL_PROGRAM_* env vars (gpt-4o)
    const model = "gpt-4o-mini";
    const messages = [
      { role: "system", content: "Return valid JSON only." },
      { role: "user", content: 'Return this JSON: {"status": "ok"}' }
    ];
    
    const body = buildOpenAIBody({
      model,
      apiFamily: "chat",
      messages,
      maxTokens: 50,
      temperature: supportsCustomTemperature(model) ? 0.1 : undefined
    });

    console.log('[SMOKE] Testing Chat Completions API...');
    const response = await openai.chat.completions.create(body);
    
    const text = response.choices?.[0]?.message?.content;
    if (!text) {
      return {
        success: false,
        message: 'Chat Completions API returned no content',
        details: response
      };
    }

    return {
      success: true,
      message: '✅ Chat Completions API test passed',
      details: { model, textLength: text.length }
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Chat Completions API test failed: ${error.message}`,
      details: {
        error: error.message,
        param: error?.error?.param || error?.param,
        code: error?.error?.code || error?.code,
        type: error?.error?.type || error?.type
      }
    };
  }
}

/**
 * Run all OpenAI smoke tests
 * @param options.failFast - If true, throws on first failure. If false, logs warnings.
 * @returns true if all tests passed, false otherwise
 */
export async function runOpenAISmokeTests(options: { failFast?: boolean } = {}): Promise<boolean> {
  const { failFast = false } = options;
  
  console.log('\n[SMOKE] 🧪 Running OpenAI API smoke tests...');
  
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const msg = '[SMOKE] ⚠️  OPENAI_API_KEY not set - skipping smoke tests';
    console.warn(msg);
    return !failFast; // Don't fail if API key is missing (might be intentional)
  }

  const openai = new OpenAI({ apiKey });
  const results: SmokeTestResult[] = [];

  // Run tests with timeout
  const testsPromise = Promise.all([
    testResponsesAPI(openai),
    testChatCompletionsAPI(openai)
  ]);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Smoke tests timed out')), SMOKE_TEST_TIMEOUT);
  });

  try {
    const testResults = await Promise.race([testsPromise, timeoutPromise]);
    results.push(...testResults);
  } catch (error: any) {
    const msg = `[SMOKE] ❌ Smoke tests failed: ${error.message}`;
    console.error(msg);
    if (failFast) {
      throw new Error(msg);
    }
    return false;
  }

  // Log results
  let allPassed = true;
  for (const result of results) {
    console.log(`[SMOKE] ${result.message}`);
    if (result.details) {
      console.log('[SMOKE]   Details:', JSON.stringify(result.details, null, 2));
    }
    if (!result.success) {
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log('[SMOKE] ✅ OPENAI_SMOKETEST_OK - All tests passed\n');
  } else {
    const msg = '[SMOKE] ❌ OPENAI_SMOKETEST_FAILED - Some tests failed';
    console.error(msg);
    if (failFast) {
      throw new Error(msg);
    }
  }

  return allPassed;
}

/**
 * CLI entry point for running smoke tests standalone
 * Use: node dist/mcp_server/startup/openaiSmokeTest.js
 */
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runOpenAISmokeTests({ failFast: true })
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('[SMOKE] Fatal error:', error);
      process.exit(1);
    });
}
